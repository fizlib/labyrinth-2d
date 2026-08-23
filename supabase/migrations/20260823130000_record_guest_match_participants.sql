-- Persist guest roster details without attaching them to authenticated profiles.

create table public.match_guest_participants (
  match_id uuid not null references public.matches (id) on delete cascade,
  participant_id text not null,
  display_name text not null,
  role text not null,
  outcome text not null,
  escaped boolean not null,
  abandoned boolean not null,
  primary key (match_id, participant_id),
  constraint match_guest_participants_id_length
    check (char_length(participant_id) between 1 and 128),
  constraint match_guest_participants_display_name_length
    check (char_length(display_name) between 1 and 32),
  constraint match_guest_participants_role
    check (role in ('survivor', 'warden')),
  constraint match_guest_participants_outcome
    check (outcome in ('win', 'loss'))
);

comment on table public.match_guest_participants is
  'Immutable server-authored starting-roster results for guest and unverified players.';

alter table public.match_guest_participants enable row level security;

revoke all on table public.match_guest_participants from public, anon, authenticated;
grant select, insert, update, delete on table public.match_guest_participants to service_role;

create function public.record_guest_match_participants(
  p_match_id uuid,
  p_participants jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  recorded_match public.matches%rowtype;
  participant jsonb;
  participant_count integer;
  expected_guest_count integer;
  existing_count integer;
  guest_participant_id text;
  guest_display_name text;
  guest_role text;
  guest_won boolean;
begin
  if jsonb_typeof(p_participants) <> 'array' then
    raise exception 'Guest match participants must be a JSON array';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_match_id::text, 0)
  );

  select * into recorded_match
  from public.matches
  where id = p_match_id;
  if not found then
    raise exception 'The completed match must be recorded before its guest roster';
  end if;

  participant_count := jsonb_array_length(p_participants);
  expected_guest_count :=
    recorded_match.player_count - recorded_match.authenticated_player_count;
  if participant_count <> expected_guest_count then
    raise exception 'Guest participant count does not match the completed match roster';
  end if;

  if (
    select count(distinct value ->> 'participantId')
    from jsonb_array_elements(p_participants)
  ) <> participant_count then
    raise exception 'Guest match participants must contain distinct participant IDs';
  end if;

  select count(*) into existing_count
  from public.match_guest_participants
  where match_id = p_match_id;
  if existing_count = expected_guest_count then
    return;
  end if;
  if existing_count <> 0 then
    raise exception 'Stored guest participant count is inconsistent';
  end if;

  for participant in select value from jsonb_array_elements(p_participants)
  loop
    guest_participant_id := participant ->> 'participantId';
    guest_display_name := participant ->> 'displayName';
    guest_role := participant ->> 'role';

    if guest_participant_id is null
      or char_length(guest_participant_id) < 1
      or char_length(guest_participant_id) > 128 then
      raise exception 'Invalid guest participant ID';
    end if;
    if guest_display_name is null
      or char_length(guest_display_name) < 1
      or char_length(guest_display_name) > 32 then
      raise exception 'Invalid guest participant display name';
    end if;
    if guest_role not in ('survivor', 'warden') then
      raise exception 'Invalid guest participant role';
    end if;

    guest_won :=
      (guest_role = 'survivor' and recorded_match.winner = 'survivors')
      or (guest_role = 'warden' and recorded_match.winner = 'wardens');

    insert into public.match_guest_participants (
      match_id,
      participant_id,
      display_name,
      role,
      outcome,
      escaped,
      abandoned
    ) values (
      p_match_id,
      guest_participant_id,
      guest_display_name,
      guest_role,
      case when guest_won then 'win' else 'loss' end,
      coalesce((participant ->> 'escaped')::boolean, false),
      coalesce((participant ->> 'abandoned')::boolean, false)
    );
  end loop;
end;
$$;

revoke execute on function public.record_guest_match_participants(uuid, jsonb)
  from public, anon, authenticated, service_role;

-- Keep the existing authenticated ledger update and the guest roster insert in
-- the same Postgres transaction, including on an idempotent retry.
create function public.record_match_result_with_guests(
  p_match_id uuid,
  p_room_id text,
  p_winner text,
  p_player_count smallint,
  p_rated boolean,
  p_started_at timestamptz,
  p_ended_at timestamptz,
  p_participants jsonb,
  p_guest_participants jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform *
  from public.record_match_result(
    p_match_id,
    p_room_id,
    p_winner,
    p_player_count,
    p_rated,
    p_started_at,
    p_ended_at,
    p_participants
  );

  perform public.record_guest_match_participants(
    p_match_id,
    p_guest_participants
  );
end;
$$;

revoke execute on function public.record_match_result_with_guests(
  uuid,
  text,
  text,
  smallint,
  boolean,
  timestamptz,
  timestamptz,
  jsonb,
  jsonb
) from public, anon, authenticated;

grant execute on function public.record_match_result_with_guests(
  uuid,
  text,
  text,
  smallint,
  boolean,
  timestamptz,
  timestamptz,
  jsonb,
  jsonb
) to service_role;
