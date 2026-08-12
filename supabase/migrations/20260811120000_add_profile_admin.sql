alter table public.profiles
  add column is_admin boolean not null default false;

comment on column public.profiles.is_admin is
  'Server-authoritative game administrator status. Only trusted backend roles may change it.';

-- The original profile grants already restrict authenticated updates to
-- display_name and avatar_url. Keep the sensitive column explicitly revoked
-- as defense in depth if broader grants are added later.
revoke insert (is_admin), update (is_admin)
  on table public.profiles
  from public, anon, authenticated;
