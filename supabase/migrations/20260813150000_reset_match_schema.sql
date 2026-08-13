-- No matches existed when this reset was authored. Remove the earlier
-- competitive_* schema and recreate the canonical player/match tables.

do $$
declare
  old_function regprocedure;
begin
  for old_function in
    select proc.oid::regprocedure
    from pg_catalog.pg_proc as proc
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = proc.pronamespace
    where namespace.nspname = 'public'
      and proc.proname in ('record_ranked_match', 'record_match_result')
  loop
    execute pg_catalog.format('drop function %s', old_function);
  end loop;
end;
$$;

drop trigger if exists ensure_competitive_stats_after_profile_insert
  on public.profiles;
drop function if exists public.ensure_profile_competitive_stats();

drop table if exists public.competitive_match_participants;
drop table if exists public.competitive_matches;
drop table if exists public.competitive_stats;

create table public.player_stats (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  rating integer not null default 1200,
  matches_played integer not null default 0,
  rated_matches integer not null default 0,
  wins integer not null default 0,
  losses integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint player_stats_rating_floor check (rating >= 100),
  constraint player_stats_matches_nonnegative check (matches_played >= 0),
  constraint player_stats_rated_matches_nonnegative check (rated_matches >= 0),
  constraint player_stats_rated_matches_bounded check (rated_matches <= matches_played),
  constraint player_stats_wins_nonnegative check (wins >= 0),
  constraint player_stats_losses_nonnegative check (losses >= 0),
  constraint player_stats_record_balanced check (matches_played = wins + losses)
);

comment on table public.player_stats is
  'Owner-readable match record plus Elo and rated-match count. Only the trusted game server may update it.';

alter table public.player_stats enable row level security;

revoke all on table public.player_stats from public, anon, authenticated;
grant select on table public.player_stats to authenticated;
grant select, insert, update, delete on table public.player_stats to service_role;

create policy "Users can read their own player stats"
  on public.player_stats
  for select
  to authenticated
  using ((select auth.uid()) = profile_id);

create function public.ensure_profile_player_stats()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.player_stats (profile_id)
  values (new.id)
  on conflict (profile_id) do nothing;
  return new;
end;
$$;

revoke execute on function public.ensure_profile_player_stats()
  from public, anon, authenticated;

create trigger ensure_player_stats_after_profile_insert
  after insert on public.profiles
  for each row execute function public.ensure_profile_player_stats();

insert into public.player_stats (profile_id)
select id from public.profiles
on conflict (profile_id) do nothing;

create table public.matches (
  id uuid primary key,
  room_id text not null,
  winner text not null,
  player_count smallint not null,
  authenticated_player_count smallint not null,
  rated boolean not null,
  rating_version smallint not null default 1,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint matches_winner check (winner in ('survivors', 'wardens')),
  constraint matches_player_count check (player_count between 1 and 9),
  constraint matches_authenticated_player_count
    check (authenticated_player_count between 0 and player_count),
  constraint matches_time_order check (ended_at >= started_at)
);

create table public.match_participants (
  match_id uuid not null references public.matches (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete restrict,
  display_name text not null,
  role text not null,
  outcome text not null,
  escaped boolean not null,
  abandoned boolean not null,
  rating_before integer not null,
  rating_delta integer not null,
  rating_after integer not null,
  primary key (match_id, profile_id),
  constraint match_participants_display_name_length
    check (char_length(display_name) between 1 and 32),
  constraint match_participants_role check (role in ('survivor', 'warden')),
  constraint match_participants_outcome check (outcome in ('win', 'loss')),
  constraint match_participants_rating_before check (rating_before >= 100),
  constraint match_participants_rating_after check (rating_after >= 100),
  constraint match_participants_rating_delta check (rating_delta between -40 and 40),
  constraint match_participants_rating_math
    check (rating_after = greatest(100, rating_before + rating_delta))
);

comment on table public.matches is
  'Immutable server-authored ledger of every completed match.';
comment on table public.match_participants is
  'Immutable authenticated starting-roster results; unrated matches store a zero Elo change.';

alter table public.matches enable row level security;
alter table public.match_participants enable row level security;

revoke all on table public.matches from public, anon, authenticated;
revoke all on table public.match_participants from public, anon, authenticated;
grant select, insert, update, delete on table public.matches to service_role;
grant select, insert, update, delete on table public.match_participants to service_role;

create function public.record_match_result(
  p_match_id uuid,
  p_room_id text,
  p_winner text,
  p_player_count smallint,
  p_rated boolean,
  p_started_at timestamptz,
  p_ended_at timestamptz,
  p_participants jsonb
)
returns table (
  profile_id uuid,
  rating_before integer,
  rating_delta integer,
  rating_after integer,
  matches_played integer,
  rated_matches integer,
  wins integer,
  losses integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  participant jsonb;
  participant_count integer;
  locked_count integer;
  participant_profile_id uuid;
  participant_display_name text;
  participant_role text;
  participant_rating_before integer;
  participant_rated_matches_before integer;
  participant_rating_delta integer;
  participant_rating_after integer;
  current_rating integer;
  current_rated_matches integer;
  participant_won boolean;
begin
  if p_winner not in ('survivors', 'wardens') then
    raise exception 'Invalid match winner';
  end if;
  if p_started_at is null or p_ended_at is null or p_ended_at < p_started_at then
    raise exception 'Invalid match timestamps';
  end if;
  if jsonb_typeof(p_participants) <> 'array' then
    raise exception 'Match participants must be a JSON array';
  end if;

  participant_count := jsonb_array_length(p_participants);
  if p_player_count < 1 or p_player_count > 9 then
    raise exception 'Matches require 1 to 9 starting players';
  end if;
  if participant_count > p_player_count then
    raise exception 'Authenticated participants cannot exceed the starting player count';
  end if;
  if p_rated and (p_player_count <> 9 or participant_count <> p_player_count) then
    raise exception 'Rated matches require a full roster of 9 authenticated starting players';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_match_id::text, 0)
  );

  if exists (select 1 from public.matches where id = p_match_id) then
    return query
      select
        result.profile_id,
        result.rating_before,
        result.rating_delta,
        result.rating_after,
        stats.matches_played,
        stats.rated_matches,
        stats.wins,
        stats.losses
      from public.match_participants as result
      join public.player_stats as stats on stats.profile_id = result.profile_id
      where result.match_id = p_match_id
      order by result.profile_id;
    return;
  end if;

  if (
    select count(distinct (value ->> 'profileId')::uuid)
    from jsonb_array_elements(p_participants)
  ) <> participant_count then
    raise exception 'Match participants must contain distinct profiles';
  end if;

  if p_rated and (not exists (
    select 1 from jsonb_array_elements(p_participants)
    where value ->> 'role' = 'survivor'
  ) or not exists (
    select 1 from jsonb_array_elements(p_participants)
    where value ->> 'role' = 'warden'
  )) then
    raise exception 'Rated matches require both roles';
  end if;

  perform 1
  from public.player_stats as stats
  where stats.profile_id in (
    select (value ->> 'profileId')::uuid
    from jsonb_array_elements(p_participants)
  )
  order by stats.profile_id
  for update;

  select count(*) into locked_count
  from public.player_stats as stats
  where stats.profile_id in (
    select (value ->> 'profileId')::uuid
    from jsonb_array_elements(p_participants)
  );
  if locked_count <> participant_count then
    raise exception 'Every authenticated participant must have player stats';
  end if;

  insert into public.matches (
    id,
    room_id,
    winner,
    player_count,
    authenticated_player_count,
    rated,
    started_at,
    ended_at
  ) values (
    p_match_id,
    p_room_id,
    p_winner,
    p_player_count,
    participant_count,
    p_rated,
    p_started_at,
    p_ended_at
  );

  for participant in select value from jsonb_array_elements(p_participants)
  loop
    participant_profile_id := (participant ->> 'profileId')::uuid;
    participant_role := participant ->> 'role';
    participant_rating_before := (participant ->> 'ratingBefore')::integer;
    participant_rated_matches_before := (participant ->> 'ratedMatchesBefore')::integer;
    participant_rating_delta := (participant ->> 'ratingDelta')::integer;
    participant_rating_after := (participant ->> 'ratingAfter')::integer;

    if participant_role not in ('survivor', 'warden') then
      raise exception 'Invalid match participant role';
    end if;
    if participant_rating_delta < -40 or participant_rating_delta > 40 then
      raise exception 'Invalid match participant rating delta';
    end if;

    select stats.rating, stats.rated_matches
      into current_rating, current_rated_matches
    from public.player_stats as stats
    where stats.profile_id = participant_profile_id;

    if p_rated then
      if current_rating <> participant_rating_before
        or current_rated_matches <> participant_rated_matches_before then
        raise exception 'Player rating changed before match finalization';
      end if;
      if participant_rating_after <> greatest(100, current_rating + participant_rating_delta) then
        raise exception 'Invalid rated participant rating result';
      end if;
    else
      participant_rating_delta := 0;
      participant_rating_after := current_rating;
    end if;

    participant_display_name := participant ->> 'displayName';
    if participant_display_name is null
      or char_length(participant_display_name) < 1
      or char_length(participant_display_name) > 32 then
      raise exception 'Invalid match participant display name';
    end if;

    participant_won :=
      (participant_role = 'survivor' and p_winner = 'survivors')
      or (participant_role = 'warden' and p_winner = 'wardens');

    insert into public.match_participants (
      match_id,
      profile_id,
      display_name,
      role,
      outcome,
      escaped,
      abandoned,
      rating_before,
      rating_delta,
      rating_after
    ) values (
      p_match_id,
      participant_profile_id,
      participant_display_name,
      participant_role,
      case when participant_won then 'win' else 'loss' end,
      coalesce((participant ->> 'escaped')::boolean, false),
      coalesce((participant ->> 'abandoned')::boolean, false),
      current_rating,
      participant_rating_delta,
      participant_rating_after
    );

    update public.player_stats as stats
    set
      rating = participant_rating_after,
      matches_played = stats.matches_played + 1,
      rated_matches = stats.rated_matches + case when p_rated then 1 else 0 end,
      wins = stats.wins + case when participant_won then 1 else 0 end,
      losses = stats.losses + case when participant_won then 0 else 1 end,
      updated_at = now()
    where stats.profile_id = participant_profile_id;
  end loop;

  return query
    select
      result.profile_id,
      result.rating_before,
      result.rating_delta,
      result.rating_after,
      stats.matches_played,
      stats.rated_matches,
      stats.wins,
      stats.losses
    from public.match_participants as result
    join public.player_stats as stats on stats.profile_id = result.profile_id
    where result.match_id = p_match_id
    order by result.profile_id;
end;
$$;

revoke execute on function public.record_match_result(
  uuid,
  text,
  text,
  smallint,
  boolean,
  timestamptz,
  timestamptz,
  jsonb
) from public, anon, authenticated;

grant execute on function public.record_match_result(
  uuid,
  text,
  text,
  smallint,
  boolean,
  timestamptz,
  timestamptz,
  jsonb
) to service_role;
