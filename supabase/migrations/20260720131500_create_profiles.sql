create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_display_name_length
    check (char_length(display_name) between 1 and 32),
  constraint profiles_display_name_trimmed
    check (display_name = btrim(display_name)),
  constraint profiles_avatar_url_https
    check (
      avatar_url is null
      or (
        char_length(avatar_url) <= 2048
        and avatar_url ~* '^https://[^[:space:]]+$'
      )
    )
);

comment on table public.profiles is
  'Application-owned profile data linked one-to-one with Supabase Auth users.';

alter table public.profiles enable row level security;

revoke all on table public.profiles from public, anon, authenticated;
grant usage on schema public to authenticated;
grant select on table public.profiles to authenticated;
grant insert (id, display_name, avatar_url) on table public.profiles to authenticated;
grant update (display_name, avatar_url) on table public.profiles to authenticated;
grant select, insert, update, delete on table public.profiles to service_role;

create policy "Users can read their own profile"
  on public.profiles
  for select
  to authenticated
  using ((select auth.uid()) = id);

create policy "Users can create their own profile"
  on public.profiles
  for insert
  to authenticated
  with check ((select auth.uid()) = id);

create policy "Users can update their own profile"
  on public.profiles
  for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create function public.normalize_profile_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.display_name := regexp_replace(btrim(new.display_name), '\s+', ' ', 'g');
  new.avatar_url := nullif(btrim(new.avatar_url), '');
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

revoke execute on function public.normalize_profile_update() from public, anon, authenticated;

create trigger normalize_profile_before_write
  before insert or update on public.profiles
  for each row execute function public.normalize_profile_update();

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  profile_display_name text;
  profile_avatar_url text;
begin
  profile_display_name := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'user_name'), ''),
    nullif(btrim(split_part(coalesce(new.email, ''), '@', 1)), ''),
    'Explorer'
  );
  profile_display_name := left(
    regexp_replace(profile_display_name, '\s+', ' ', 'g'),
    32
  );

  profile_avatar_url := coalesce(
    nullif(btrim(new.raw_user_meta_data ->> 'avatar_url'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'picture'), '')
  );
  if profile_avatar_url is not null and (
    char_length(profile_avatar_url) > 2048
    or profile_avatar_url !~* '^https://[^[:space:]]+$'
  ) then
    profile_avatar_url := null;
  end if;

  insert into public.profiles (id, display_name, avatar_url)
  values (new.id, profile_display_name, profile_avatar_url)
  on conflict (id) do nothing;

  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

insert into public.profiles (id, display_name, avatar_url, created_at, updated_at)
select
  users.id,
  left(
    regexp_replace(
      coalesce(
        nullif(btrim(users.raw_user_meta_data ->> 'full_name'), ''),
        nullif(btrim(users.raw_user_meta_data ->> 'name'), ''),
        nullif(btrim(users.raw_user_meta_data ->> 'user_name'), ''),
        nullif(btrim(split_part(coalesce(users.email, ''), '@', 1)), ''),
        'Explorer'
      ),
      '\s+',
      ' ',
      'g'
    ),
    32
  ),
  case
    when coalesce(
      nullif(btrim(users.raw_user_meta_data ->> 'avatar_url'), ''),
      nullif(btrim(users.raw_user_meta_data ->> 'picture'), '')
    ) ~* '^https://[^[:space:]]+$'
    and char_length(
      coalesce(
        nullif(btrim(users.raw_user_meta_data ->> 'avatar_url'), ''),
        nullif(btrim(users.raw_user_meta_data ->> 'picture'), '')
      )
    ) <= 2048
    then coalesce(
      nullif(btrim(users.raw_user_meta_data ->> 'avatar_url'), ''),
      nullif(btrim(users.raw_user_meta_data ->> 'picture'), '')
    )
    else null
  end,
  users.created_at,
  coalesce(users.updated_at, users.created_at, now())
from auth.users as users
on conflict (id) do nothing;
