create table public.tutorial_sessions (
  id uuid primary key,
  profile_id uuid references public.profiles (id) on delete restrict,
  participant_id text not null,
  display_name text not null,
  is_guest boolean not null,
  source text not null,
  status text not null default 'in_progress',
  departure_reason text,
  started_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_ms bigint,
  reminder_opened_at timestamptz,
  discord_reminder_clicked_at timestamptz,
  google_calendar_clicked_at timestamptz,
  update_token_hash text not null,
  created_at timestamptz not null default now(),
  constraint tutorial_sessions_participant_id_length
    check (char_length(participant_id) between 1 and 128),
  constraint tutorial_sessions_display_name_length
    check (char_length(display_name) between 1 and 32),
  constraint tutorial_sessions_source
    check (source in ('main_menu', 'first_time_queue')),
  constraint tutorial_sessions_status
    check (status in ('in_progress', 'completed', 'left')),
  constraint tutorial_sessions_departure_reason
    check (
      departure_reason is null
      or departure_reason in ('explicit_exit', 'page_unload', 'inactivity_timeout')
    ),
  constraint tutorial_sessions_token_hash
    check (update_token_hash ~ '^[0-9a-f]{64}$'),
  constraint tutorial_sessions_identity
    check (
      (is_guest and profile_id is null and participant_id like 'guest:%')
      or (
        not is_guest
        and profile_id is not null
        and participant_id = profile_id::text
      )
    ),
  constraint tutorial_sessions_time_order
    check (
      last_activity_at >= started_at
      and (ended_at is null or ended_at >= started_at)
    ),
  constraint tutorial_sessions_duration
    check (duration_ms is null or duration_ms >= 0),
  constraint tutorial_sessions_state_shape
    check (
      (
        status = 'in_progress'
        and ended_at is null
        and duration_ms is null
        and departure_reason is null
      )
      or (
        status = 'completed'
        and ended_at is not null
        and duration_ms is not null
        and departure_reason is null
      )
      or (
        status = 'left'
        and ended_at is not null
        and duration_ms is not null
        and departure_reason is not null
      )
    )
);

comment on table public.tutorial_sessions is
  'Server-authored analytics for authenticated and guest browser-local tutorial attempts.';

create index tutorial_sessions_started_at_idx
  on public.tutorial_sessions (started_at desc, id desc);
create index tutorial_sessions_status_started_at_idx
  on public.tutorial_sessions (status, started_at desc);
create index tutorial_sessions_participant_id_idx
  on public.tutorial_sessions (participant_id, started_at desc);
create index tutorial_sessions_source_started_at_idx
  on public.tutorial_sessions (source, started_at desc);
create index tutorial_sessions_stale_idx
  on public.tutorial_sessions (last_activity_at)
  where status = 'in_progress';

alter table public.tutorial_sessions enable row level security;
revoke all on table public.tutorial_sessions from public, anon, authenticated;
grant select, insert, update, delete on table public.tutorial_sessions to service_role;

create function public.finalize_stale_tutorial_sessions(
  p_stale_before timestamptz
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated_count integer;
begin
  if p_stale_before is null then
    raise exception 'A stale cutoff is required';
  end if;

  update public.tutorial_sessions
  set
    status = 'left',
    departure_reason = 'inactivity_timeout',
    ended_at = last_activity_at,
    duration_ms = greatest(
      0,
      floor(extract(epoch from (last_activity_at - started_at)) * 1000)::bigint
    )
  where status = 'in_progress'
    and last_activity_at < p_stale_before;

  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;

create function public.get_tutorial_statistics()
returns table (
  attempts bigint,
  unique_people bigint,
  in_progress bigint,
  completed bigint,
  left_count bigint,
  average_duration_ms numeric,
  reminder_opened bigint,
  discord_reminder_clicked bigint,
  google_calendar_clicked bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    count(*)::bigint,
    count(distinct participant_id)::bigint,
    count(*) filter (where status = 'in_progress')::bigint,
    count(*) filter (where status = 'completed')::bigint,
    count(*) filter (where status = 'left')::bigint,
    coalesce(avg(duration_ms) filter (where status <> 'in_progress'), 0),
    count(*) filter (where reminder_opened_at is not null)::bigint,
    count(*) filter (where discord_reminder_clicked_at is not null)::bigint,
    count(*) filter (where google_calendar_clicked_at is not null)::bigint
  from public.tutorial_sessions;
$$;

revoke execute on function public.finalize_stale_tutorial_sessions(timestamptz)
  from public, anon, authenticated;
revoke execute on function public.get_tutorial_statistics()
  from public, anon, authenticated;
grant execute on function public.finalize_stale_tutorial_sessions(timestamptz)
  to service_role;
grant execute on function public.get_tutorial_statistics()
  to service_role;
