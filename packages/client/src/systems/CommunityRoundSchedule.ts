export const COMMUNITY_ROUND_TIME_ZONE = 'Europe/Vilnius';
export const COMMUNITY_ROUND_HOUR = 21;

const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

interface ZonedDateTimeParts extends CalendarDate {
  hour: number;
  minute: number;
  second: number;
}

export interface CommunityRoundState {
  occurrence: Date;
  occurrenceKey: string;
  isOpen: boolean;
  remainingMs: number;
}

const zonedDateTimeFormatters = new Map<string, Intl.DateTimeFormat>();

function getZonedDateTimeFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = zonedDateTimeFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    zonedDateTimeFormatters.set(timeZone, formatter);
  }
  return formatter;
}

function getZonedDateTimeParts(date: Date, timeZone: string): ZonedDateTimeParts {
  const values = new Map(
    getZonedDateTimeFormatter(timeZone)
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );

  return {
    year: values.get('year') ?? 0,
    month: values.get('month') ?? 0,
    day: values.get('day') ?? 0,
    hour: values.get('hour') ?? 0,
    minute: values.get('minute') ?? 0,
    second: values.get('second') ?? 0,
  };
}

function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = getZonedDateTimeParts(date, timeZone);
  const representedAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return representedAsUtc - Math.floor(date.getTime() / SECOND_MS) * SECOND_MS;
}

function getUtcDateForZonedTime(
  date: CalendarDate,
  hour: number,
  timeZone: string,
): Date {
  const representedAsUtc = Date.UTC(date.year, date.month - 1, date.day, hour);
  let candidateMs =
    representedAsUtc - getTimeZoneOffsetMs(new Date(representedAsUtc), timeZone);
  const correctedOffset = getTimeZoneOffsetMs(new Date(candidateMs), timeZone);
  candidateMs = representedAsUtc - correctedOffset;
  return new Date(candidateMs);
}

function addCalendarDays(date: CalendarDate, days: number): CalendarDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day) + days * DAY_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function getOccurrenceKey(date: CalendarDate): string {
  return `${date.year.toString().padStart(4, '0')}-${date.month
    .toString()
    .padStart(2, '0')}-${date.day.toString().padStart(2, '0')}`;
}

function formatGoogleCalendarDateTime(date: Date, timeZone: string): string {
  const parts = getZonedDateTimeParts(date, timeZone);
  return [
    parts.year.toString().padStart(4, '0'),
    parts.month.toString().padStart(2, '0'),
    parts.day.toString().padStart(2, '0'),
    'T',
    parts.hour.toString().padStart(2, '0'),
    parts.minute.toString().padStart(2, '0'),
    parts.second.toString().padStart(2, '0'),
  ].join('');
}

/**
 * Return today's scheduled round in the host time zone. It remains open after
 * its start time until that host-local day ends. Once this player's match
 * starts, the card advances to tomorrow's round.
 */
export function getCommunityRoundState(
  now: Date,
  startedOccurrenceKey: string | null,
  timeZone = COMMUNITY_ROUND_TIME_ZONE,
  hour = COMMUNITY_ROUND_HOUR,
): CommunityRoundState {
  const nowInHostTimeZone = getZonedDateTimeParts(now, timeZone);
  const today: CalendarDate = {
    year: nowInHostTimeZone.year,
    month: nowInHostTimeZone.month,
    day: nowInHostTimeZone.day,
  };
  const todayKey = getOccurrenceKey(today);
  const startedToday = startedOccurrenceKey === todayKey;
  const occurrenceDate = startedToday ? addCalendarDays(today, 1) : today;
  const occurrence = getUtcDateForZonedTime(occurrenceDate, hour, timeZone);
  const isOpen = !startedToday && now.getTime() >= occurrence.getTime();

  return {
    occurrence,
    occurrenceKey: getOccurrenceKey(occurrenceDate),
    isOpen,
    remainingMs: Math.max(0, occurrence.getTime() - now.getTime()),
  };
}

/** Return the next future round, even while today's community round is open. */
export function getNextCommunityRoundState(
  now: Date,
  timeZone = COMMUNITY_ROUND_TIME_ZONE,
  hour = COMMUNITY_ROUND_HOUR,
): CommunityRoundState {
  const nowInHostTimeZone = getZonedDateTimeParts(now, timeZone);
  const today: CalendarDate = {
    year: nowInHostTimeZone.year,
    month: nowInHostTimeZone.month,
    day: nowInHostTimeZone.day,
  };
  const todayOccurrence = getUtcDateForZonedTime(today, hour, timeZone);
  const occurrenceDate =
    now.getTime() < todayOccurrence.getTime() ? today : addCalendarDays(today, 1);
  const occurrence = getUtcDateForZonedTime(occurrenceDate, hour, timeZone);

  return {
    occurrence,
    occurrenceKey: getOccurrenceKey(occurrenceDate),
    isOpen: false,
    remainingMs: Math.max(0, occurrence.getTime() - now.getTime()),
  };
}

export function formatCommunityRoundCountdown(remainingMs: number): string {
  const remainingSeconds = Math.max(0, Math.ceil(remainingMs / SECOND_MS));
  const hours = Math.floor(remainingSeconds / 3_600);
  const minutes = Math.floor((remainingSeconds % 3_600) / 60);
  const seconds = remainingSeconds % 60;
  return [hours, minutes, seconds]
    .map((value) => value.toString().padStart(2, '0'))
    .join(':');
}

export function formatCommunityRoundWait(remainingMs: number): string {
  const remainingMinutes = Math.max(0, Math.ceil(remainingMs / MINUTE_MS));
  const hours = Math.floor(remainingMinutes / 60);
  const minutes = remainingMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

/** Build a recurring daily Google Calendar event anchored to the next round. */
export function getCommunityRoundGoogleCalendarUrl(
  occurrence: Date,
  timeZone = COMMUNITY_ROUND_TIME_ZONE,
): string {
  const end = new Date(occurrence.getTime() + HOUR_MS);
  const url = new URL('https://calendar.google.com/calendar/render');
  url.searchParams.set('action', 'TEMPLATE');
  url.searchParams.set('text', 'False Arrow Community Round');
  url.searchParams.set(
    'dates',
    `${formatGoogleCalendarDateTime(occurrence, timeZone)}/${formatGoogleCalendarDateTime(end, timeZone)}`,
  );
  url.searchParams.set('ctz', timeZone);
  url.searchParams.set('recur', 'RRULE:FREQ=DAILY');
  url.searchParams.set('details', 'Join the daily False Arrow community round.');
  return url.toString();
}
