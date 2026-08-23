create table public.community_round_schedule (
  id boolean primary key default true check (id),
  starts_at timestamptz not null,
  frequency text not null check (frequency in ('daily', 'weekly', 'monthly')),
  time_zone text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

comment on table public.community_round_schedule is
  'Singleton server-owned calendar configuration for player-facing community rounds.';

insert into public.community_round_schedule (
  id,
  starts_at,
  frequency,
  time_zone
) values (
  true,
  timestamptz '2026-01-01 19:00:00+00',
  'daily',
  'Europe/Vilnius'
);

alter table public.community_round_schedule enable row level security;
revoke all on table public.community_round_schedule from public, anon, authenticated;
grant select, update on table public.community_round_schedule to service_role;

create function public.admin_update_community_round_schedule(
  p_actor_id uuid,
  p_starts_at timestamptz,
  p_frequency text,
  p_time_zone text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.profiles
    where id = p_actor_id and is_admin and suspended_at is null
  ) then
    raise exception 'Active administrator access is required' using errcode = '42501';
  end if;
  if p_starts_at is null then
    raise exception 'A schedule date and time are required';
  end if;
  if p_frequency not in ('daily', 'weekly', 'monthly') then
    raise exception 'Schedule frequency is not supported';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_timezone_names where name = p_time_zone
  ) then
    raise exception 'Schedule time zone is not supported';
  end if;

  update public.community_round_schedule
  set starts_at = p_starts_at,
      frequency = p_frequency,
      time_zone = p_time_zone,
      updated_at = now(),
      updated_by = p_actor_id
  where id;
end;
$$;

revoke execute on function public.admin_update_community_round_schedule(
  uuid,
  timestamptz,
  text,
  text
) from public, anon, authenticated;
grant execute on function public.admin_update_community_round_schedule(
  uuid,
  timestamptz,
  text,
  text
) to service_role;
