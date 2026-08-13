-- Upgrade the original Elo-only match ledger without rerunning its migration.
-- Existing rows were all rated, so their total-match counts are the correct
-- backfill for rated_matches.

alter table public.competitive_stats
  add column if not exists rated_matches integer;

update public.competitive_stats
set rated_matches = matches_played
where rated_matches is null;

alter table public.competitive_stats
  alter column rated_matches set default 0,
  alter column rated_matches set not null;

alter table public.competitive_stats
  drop constraint if exists competitive_stats_rated_matches_nonnegative,
  drop constraint if exists competitive_stats_rated_matches_bounded;

alter table public.competitive_stats
  add constraint competitive_stats_rated_matches_nonnegative
    check (rated_matches >= 0),
  add constraint competitive_stats_rated_matches_bounded
    check (rated_matches <= matches_played);

comment on table public.competitive_stats is
  'Owner-readable all-match record plus Elo and rated-match count. Only the trusted game server may update it.';

alter table public.competitive_matches
  add column if not exists authenticated_player_count smallint,
  add column if not exists rated boolean;

update public.competitive_matches
set
  authenticated_player_count = coalesce(authenticated_player_count, player_count),
  rated = coalesce(rated, true)
where authenticated_player_count is null or rated is null;

alter table public.competitive_matches
  alter column authenticated_player_count set not null,
  alter column rated set not null;

alter table public.competitive_matches
  drop constraint if exists competitive_matches_player_count,
  drop constraint if exists competitive_matches_authenticated_player_count;

alter table public.competitive_matches
  add constraint competitive_matches_player_count
    check (player_count between 1 and 9),
  add constraint competitive_matches_authenticated_player_count
    check (authenticated_player_count between 0 and player_count);

comment on table public.competitive_matches is
  'Immutable server-authored ledger of every completed match.';
comment on table public.competitive_match_participants is
  'Immutable authenticated starting-roster results; unranked matches store a zero Elo change.';

-- Remove every overload of the superseded ranked-only RPC.
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
      and proc.proname = 'record_ranked_match'
  loop
    execute pg_catalog.format('drop function %s', old_function);
  end loop;
end;
$$;

create or replace function public.record_match_result(
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

  if exists (select 1 from public.competitive_matches where id = p_match_id) then
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
      from public.competitive_match_participants as result
      join public.competitive_stats as stats on stats.profile_id = result.profile_id
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
  from public.competitive_stats as stats
  where stats.profile_id in (
    select (value ->> 'profileId')::uuid
    from jsonb_array_elements(p_participants)
  )
  order by stats.profile_id
  for update;

  select count(*) into locked_count
  from public.competitive_stats as stats
  where stats.profile_id in (
    select (value ->> 'profileId')::uuid
    from jsonb_array_elements(p_participants)
  );
  if locked_count <> participant_count then
    raise exception 'Every authenticated participant must have competitive stats';
  end if;

  insert into public.competitive_matches (
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
    from public.competitive_stats as stats
    where stats.profile_id = participant_profile_id;

    if p_rated then
      if current_rating <> participant_rating_before
        or current_rated_matches <> participant_rated_matches_before then
        raise exception 'Competitive rating changed before match finalization';
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

    insert into public.competitive_match_participants (
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

    update public.competitive_stats as stats
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
    from public.competitive_match_participants as result
    join public.competitive_stats as stats on stats.profile_id = result.profile_id
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
