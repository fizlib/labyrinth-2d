alter table public.profiles
  add column display_name_chosen boolean;

-- Profiles that existed before this onboarding step have already been usable
-- in the game, so do not interrupt those players on their next sign-in.
update public.profiles
set display_name_chosen = true;

alter table public.profiles
  alter column display_name_chosen set not null,
  alter column display_name_chosen set default false;

comment on column public.profiles.display_name_chosen is
  'Whether the player has completed the required display-name onboarding step.';

grant update (display_name_chosen) on table public.profiles to authenticated;
