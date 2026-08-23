alter table public.profiles
  add column if not exists suspended_at timestamptz;

comment on column public.profiles.suspended_at is
  'Application suspension timestamp. Suspended profiles cannot enter the game or use administrator tools.';

revoke insert (suspended_at), update (suspended_at)
  on table public.profiles
  from public, anon, authenticated;

create table public.admin_audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid not null references public.profiles (id) on delete restrict,
  target_id uuid not null references public.profiles (id) on delete restrict,
  action text not null,
  before_value jsonb not null default '{}'::jsonb,
  after_value jsonb not null default '{}'::jsonb,
  reason text,
  created_at timestamptz not null default now(),
  constraint admin_audit_log_action
    check (action in ('profile_update', 'admin_grant', 'admin_revoke', 'suspend', 'reactivate')),
  constraint admin_audit_log_reason_length
    check (reason is null or char_length(reason) between 1 and 500)
);

comment on table public.admin_audit_log is
  'Append-only service-role ledger of administrator changes to registered users.';

create index admin_audit_log_created_at_idx
  on public.admin_audit_log (created_at desc, id desc);
create index admin_audit_log_target_id_idx
  on public.admin_audit_log (target_id, created_at desc);

alter table public.admin_audit_log enable row level security;
revoke all on table public.admin_audit_log from public, anon, authenticated;
grant select, insert on table public.admin_audit_log to service_role;
grant usage, select on sequence public.admin_audit_log_id_seq to service_role;

create function public.admin_update_user_profile(
  p_actor_id uuid,
  p_target_id uuid,
  p_display_name text,
  p_avatar_url text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_profile public.profiles;
  new_profile public.profiles;
  normalized_name text;
  normalized_avatar text;
begin
  if not exists (
    select 1 from public.profiles
    where id = p_actor_id and is_admin and suspended_at is null
  ) then
    raise exception 'Active administrator access is required' using errcode = '42501';
  end if;

  normalized_name := regexp_replace(btrim(coalesce(p_display_name, '')), '\s+', ' ', 'g');
  normalized_avatar := nullif(btrim(p_avatar_url), '');
  if char_length(normalized_name) not between 1 and 32 then
    raise exception 'Display name must be between 1 and 32 characters';
  end if;
  if normalized_avatar is not null and (
    char_length(normalized_avatar) > 2048
    or normalized_avatar !~* '^https://[^[:space:]]+$'
  ) then
    raise exception 'Avatar URL must be a valid HTTPS URL';
  end if;

  select * into old_profile
  from public.profiles
  where id = p_target_id
  for update;
  if not found then raise exception 'User not found' using errcode = 'P0002'; end if;

  update public.profiles
  set display_name = normalized_name,
      avatar_url = normalized_avatar
  where id = p_target_id
  returning * into new_profile;

  if old_profile.display_name is distinct from new_profile.display_name
    or old_profile.avatar_url is distinct from new_profile.avatar_url then
    insert into public.admin_audit_log (
      actor_id, target_id, action, before_value, after_value
    ) values (
      p_actor_id,
      p_target_id,
      'profile_update',
      jsonb_build_object('display_name', old_profile.display_name, 'avatar_url', old_profile.avatar_url),
      jsonb_build_object('display_name', new_profile.display_name, 'avatar_url', new_profile.avatar_url)
    );
  end if;
end;
$$;

create function public.admin_set_user_admin(
  p_actor_id uuid,
  p_target_id uuid,
  p_is_admin boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_profile public.profiles;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('false-arrow-admin-access'));
  if not exists (
    select 1 from public.profiles
    where id = p_actor_id and is_admin and suspended_at is null
  ) then
    raise exception 'Active administrator access is required' using errcode = '42501';
  end if;

  select * into target_profile
  from public.profiles
  where id = p_target_id
  for update;
  if not found then raise exception 'User not found' using errcode = 'P0002'; end if;
  if target_profile.is_admin = p_is_admin then return; end if;
  if p_is_admin and target_profile.suspended_at is not null then
    raise exception 'A suspended user cannot be promoted';
  end if;
  if not p_is_admin then
    if p_actor_id = p_target_id then
      raise exception 'Administrators cannot demote themselves';
    end if;
    if (
      select count(*) from public.profiles
      where is_admin and suspended_at is null
    ) <= 1 then
      raise exception 'The final active administrator cannot be demoted';
    end if;
  end if;

  update public.profiles set is_admin = p_is_admin where id = p_target_id;
  insert into public.admin_audit_log (
    actor_id, target_id, action, before_value, after_value
  ) values (
    p_actor_id,
    p_target_id,
    case when p_is_admin then 'admin_grant' else 'admin_revoke' end,
    jsonb_build_object('is_admin', target_profile.is_admin),
    jsonb_build_object('is_admin', p_is_admin)
  );
end;
$$;

create function public.admin_set_user_suspension(
  p_actor_id uuid,
  p_target_id uuid,
  p_suspended boolean,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_profile public.profiles;
  new_suspended_at timestamptz;
  normalized_reason text;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('false-arrow-admin-access'));
  if not exists (
    select 1 from public.profiles
    where id = p_actor_id and is_admin and suspended_at is null
  ) then
    raise exception 'Active administrator access is required' using errcode = '42501';
  end if;
  if p_actor_id = p_target_id then
    raise exception 'Administrators cannot suspend themselves';
  end if;

  normalized_reason := nullif(btrim(p_reason), '');
  if p_suspended and normalized_reason is null then
    raise exception 'A suspension reason is required';
  end if;
  if normalized_reason is not null and char_length(normalized_reason) > 500 then
    raise exception 'Reason must be 500 characters or fewer';
  end if;

  select * into target_profile
  from public.profiles
  where id = p_target_id
  for update;
  if not found then raise exception 'User not found' using errcode = 'P0002'; end if;
  if p_suspended = (target_profile.suspended_at is not null) then return; end if;
  if p_suspended and target_profile.is_admin and (
    select count(*) from public.profiles
    where is_admin and suspended_at is null
  ) <= 1 then
    raise exception 'The final active administrator cannot be suspended';
  end if;

  new_suspended_at := case when p_suspended then now() else null end;
  update public.profiles
  set suspended_at = new_suspended_at
  where id = p_target_id;

  insert into public.admin_audit_log (
    actor_id, target_id, action, before_value, after_value, reason
  ) values (
    p_actor_id,
    p_target_id,
    case when p_suspended then 'suspend' else 'reactivate' end,
    jsonb_build_object('suspended_at', target_profile.suspended_at),
    jsonb_build_object('suspended_at', new_suspended_at),
    normalized_reason
  );
end;
$$;

revoke execute on function public.admin_update_user_profile(uuid, uuid, text, text)
  from public, anon, authenticated;
revoke execute on function public.admin_set_user_admin(uuid, uuid, boolean)
  from public, anon, authenticated;
revoke execute on function public.admin_set_user_suspension(uuid, uuid, boolean, text)
  from public, anon, authenticated;

grant execute on function public.admin_update_user_profile(uuid, uuid, text, text)
  to service_role;
grant execute on function public.admin_set_user_admin(uuid, uuid, boolean)
  to service_role;
grant execute on function public.admin_set_user_suspension(uuid, uuid, boolean, text)
  to service_role;
