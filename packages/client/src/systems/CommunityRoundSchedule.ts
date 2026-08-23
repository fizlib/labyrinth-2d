import {
  COMMUNITY_ROUND_TIME_ZONE,
  DEFAULT_COMMUNITY_ROUND_SCHEDULE,
  type CommunityRoundFrequency,
  type CommunityRoundSchedule,
} from '@labyrinth/shared';

export { COMMUNITY_ROUND_TIME_ZONE, DEFAULT_COMMUNITY_ROUND_SCHEDULE };

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

export interface CommunityRoundScheduleInputValues {
  date: string;
  time: string;
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
  minute: number,
  timeZone: string,
): Date {
  const representedAsUtc = Date.UTC(date.year, date.month - 1, date.day, hour, minute);
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

function compareCalendarDates(left: CalendarDate, right: CalendarDate): number {
  return (
    Date.UTC(left.year, left.month - 1, left.day) -
    Date.UTC(right.year, right.month - 1, right.day)
  );
}

function calendarDaysBetween(left: CalendarDate, right: CalendarDate): number {
  return Math.round(compareCalendarDates(right, left) / DAY_MS);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function monthlyOccurrence(year: number, month: number, anchorDay: number): CalendarDate {
  return { year, month, day: Math.min(anchorDay, daysInMonth(year, month)) };
}

function addCalendarMonths(date: CalendarDate, months: number): CalendarDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1 + months, 1));
  return monthlyOccurrence(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, date.day);
}

function getOccurrenceDateOnOrAfter(
  date: CalendarDate,
  anchor: CalendarDate,
  frequency: CommunityRoundFrequency,
): CalendarDate {
  if (compareCalendarDates(date, anchor) <= 0) return anchor;
  if (frequency === 'daily') return date;
  if (frequency === 'weekly') {
    const daysSinceAnchor = calendarDaysBetween(anchor, date);
    const daysUntilOccurrence = (7 - (daysSinceAnchor % 7)) % 7;
    return addCalendarDays(date, daysUntilOccurrence);
  }

  let candidate = monthlyOccurrence(date.year, date.month, anchor.day);
  if (compareCalendarDates(candidate, date) < 0) {
    const firstOfMonth = { year: date.year, month: date.month, day: anchor.day };
    candidate = addCalendarMonths(firstOfMonth, 1);
  }
  return compareCalendarDates(candidate, anchor) < 0 ? anchor : candidate;
}

function getNextOccurrenceDate(
  occurrence: CalendarDate,
  anchor: CalendarDate,
  frequency: CommunityRoundFrequency,
): CalendarDate {
  if (frequency === 'daily') return addCalendarDays(occurrence, 1);
  if (frequency === 'weekly') return addCalendarDays(occurrence, 7);
  const nextMonth = new Date(Date.UTC(occurrence.year, occurrence.month, 1));
  return monthlyOccurrence(
    nextMonth.getUTCFullYear(),
    nextMonth.getUTCMonth() + 1,
    anchor.day,
  );
}

function getOccurrenceKey(date: CalendarDate): string {
  return `${date.year.toString().padStart(4, '0')}-${date.month
    .toString()
    .padStart(2, '0')}-${date.day.toString().padStart(2, '0')}`;
}

function getScheduleParts(schedule: CommunityRoundSchedule): ZonedDateTimeParts {
  const startsAt = new Date(schedule.startsAt);
  if (Number.isNaN(startsAt.getTime())) {
    return getZonedDateTimeParts(
      new Date(DEFAULT_COMMUNITY_ROUND_SCHEDULE.startsAt),
      DEFAULT_COMMUNITY_ROUND_SCHEDULE.timeZone,
    );
  }
  return getZonedDateTimeParts(startsAt, schedule.timeZone);
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
 * Return the occurrence for today when one is scheduled. It remains open after
 * its start time until that host-local day ends. Once this player's match
 * starts, the card advances to the next configured occurrence.
 */
export function getCommunityRoundState(
  now: Date,
  startedOccurrenceKey: string | null,
  schedule: CommunityRoundSchedule = DEFAULT_COMMUNITY_ROUND_SCHEDULE,
): CommunityRoundState {
  const nowInHostTimeZone = getZonedDateTimeParts(now, schedule.timeZone);
  const today: CalendarDate = {
    year: nowInHostTimeZone.year,
    month: nowInHostTimeZone.month,
    day: nowInHostTimeZone.day,
  };
  const anchor = getScheduleParts(schedule);
  let occurrenceDate = getOccurrenceDateOnOrAfter(today, anchor, schedule.frequency);
  if (startedOccurrenceKey === getOccurrenceKey(occurrenceDate)) {
    occurrenceDate = getNextOccurrenceDate(occurrenceDate, anchor, schedule.frequency);
  }
  const occurrence = getUtcDateForZonedTime(
    occurrenceDate,
    anchor.hour,
    anchor.minute,
    schedule.timeZone,
  );
  const isToday = compareCalendarDates(occurrenceDate, today) === 0;
  const isOpen = isToday && now.getTime() >= occurrence.getTime();

  return {
    occurrence,
    occurrenceKey: getOccurrenceKey(occurrenceDate),
    isOpen,
    remainingMs: Math.max(0, occurrence.getTime() - now.getTime()),
  };
}

/** Return the next future occurrence, even while today's round is open. */
export function getNextCommunityRoundState(
  now: Date,
  schedule: CommunityRoundSchedule = DEFAULT_COMMUNITY_ROUND_SCHEDULE,
): CommunityRoundState {
  const nowInHostTimeZone = getZonedDateTimeParts(now, schedule.timeZone);
  const today: CalendarDate = {
    year: nowInHostTimeZone.year,
    month: nowInHostTimeZone.month,
    day: nowInHostTimeZone.day,
  };
  const anchor = getScheduleParts(schedule);
  let occurrenceDate = getOccurrenceDateOnOrAfter(today, anchor, schedule.frequency);
  let occurrence = getUtcDateForZonedTime(
    occurrenceDate,
    anchor.hour,
    anchor.minute,
    schedule.timeZone,
  );
  if (occurrence.getTime() <= now.getTime()) {
    occurrenceDate = getNextOccurrenceDate(occurrenceDate, anchor, schedule.frequency);
    occurrence = getUtcDateForZonedTime(
      occurrenceDate,
      anchor.hour,
      anchor.minute,
      schedule.timeZone,
    );
  }

  return {
    occurrence,
    occurrenceKey: getOccurrenceKey(occurrenceDate),
    isOpen: false,
    remainingMs: Math.max(0, occurrence.getTime() - now.getTime()),
  };
}

export function getCommunityRoundScheduleInputValues(
  schedule: CommunityRoundSchedule,
): CommunityRoundScheduleInputValues {
  const parts = getScheduleParts(schedule);
  return {
    date: getOccurrenceKey(parts),
    time: `${parts.hour.toString().padStart(2, '0')}:${parts.minute
      .toString()
      .padStart(2, '0')}`,
  };
}

export function communityRoundStartAtFromZonedInput(
  dateValue: string,
  timeValue: string,
  timeZone: string,
): Date | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(timeValue);
  if (!dateMatch || !timeMatch) return null;
  const date = {
    year: Number(dateMatch[1]),
    month: Number(dateMatch[2]),
    day: Number(dateMatch[3]),
  };
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  if (
    date.month < 1 ||
    date.month > 12 ||
    date.day < 1 ||
    date.day > daysInMonth(date.year, date.month) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }
  const result = getUtcDateForZonedTime(date, hour, minute, timeZone);
  const roundTrip = getZonedDateTimeParts(result, timeZone);
  return roundTrip.year === date.year &&
    roundTrip.month === date.month &&
    roundTrip.day === date.day &&
    roundTrip.hour === hour &&
    roundTrip.minute === minute
    ? result
    : null;
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

/** Build a recurring Google Calendar event anchored to the next round. */
export function getCommunityRoundGoogleCalendarUrl(
  occurrence: Date,
  schedule: CommunityRoundSchedule = DEFAULT_COMMUNITY_ROUND_SCHEDULE,
): string {
  const end = new Date(occurrence.getTime() + HOUR_MS);
  const url = new URL('https://calendar.google.com/calendar/render');
  url.searchParams.set('action', 'TEMPLATE');
  url.searchParams.set('text', 'False Arrow Community Round');
  url.searchParams.set(
    'dates',
    `${formatGoogleCalendarDateTime(occurrence, schedule.timeZone)}/${formatGoogleCalendarDateTime(end, schedule.timeZone)}`,
  );
  url.searchParams.set('ctz', schedule.timeZone);
  url.searchParams.set('recur', `RRULE:FREQ=${schedule.frequency.toUpperCase()}`);
  url.searchParams.set(
    'details',
    `Join the ${schedule.frequency} False Arrow community round.`,
  );
  return url.toString();
}
