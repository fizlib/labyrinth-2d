import assert from 'node:assert/strict';
import test from 'node:test';

import {
  communityRoundStartAtFromZonedInput,
  formatCommunityRoundCountdown,
  formatCommunityRoundWait,
  getCommunityRoundScheduleInputValues,
  getCommunityRoundGoogleCalendarUrl,
  getCommunityRoundState,
  getNextCommunityRoundState,
} from '../dist/systems/CommunityRoundSchedule.js';

const weeklySchedule = {
  startsAt: '2026-08-20T18:00:00.000Z',
  frequency: 'weekly',
  timeZone: 'Europe/Vilnius',
  updatedAt: null,
};

test('unlocks the summer Vilnius round at 21:00', () => {
  const before = getCommunityRoundState(new Date('2026-08-20T17:59:00.000Z'), null);
  assert.equal(before.occurrence.toISOString(), '2026-08-20T18:00:00.000Z');
  assert.equal(before.occurrenceKey, '2026-08-20');
  assert.equal(before.isOpen, false);
  assert.equal(before.remainingMs, 60_000);

  const open = getCommunityRoundState(new Date('2026-08-20T18:00:00.000Z'), null);
  assert.equal(open.occurrence.toISOString(), '2026-08-20T18:00:00.000Z');
  assert.equal(open.isOpen, true);
  assert.equal(open.remainingMs, 0);
});

test('keeps 21:00 Vilnius across the winter daylight-saving offset', () => {
  const before = getCommunityRoundState(new Date('2026-12-20T18:59:00.000Z'), null);
  assert.equal(before.occurrence.toISOString(), '2026-12-20T19:00:00.000Z');
  assert.equal(before.isOpen, false);

  const open = getCommunityRoundState(new Date('2026-12-20T19:00:00.000Z'), null);
  assert.equal(open.isOpen, true);
});

test("advances to tomorrow after this player's match starts", () => {
  const next = getCommunityRoundState(new Date('2026-08-20T18:05:00.000Z'), '2026-08-20');
  assert.equal(next.occurrence.toISOString(), '2026-08-21T18:00:00.000Z');
  assert.equal(next.occurrenceKey, '2026-08-21');
  assert.equal(next.isOpen, false);
});

test('starts a fresh locked schedule after the host-local day changes', () => {
  const nextDay = getCommunityRoundState(
    new Date('2026-08-20T22:30:00.000Z'),
    '2026-08-20',
  );
  assert.equal(nextDay.occurrence.toISOString(), '2026-08-21T18:00:00.000Z');
  assert.equal(nextDay.occurrenceKey, '2026-08-21');
  assert.equal(nextDay.isOpen, false);
});

test('returns the next future round after the current round opens', () => {
  const before = getNextCommunityRoundState(new Date('2026-08-20T17:30:00.000Z'));
  assert.equal(before.occurrence.toISOString(), '2026-08-20T18:00:00.000Z');
  assert.equal(before.remainingMs, 30 * 60_000);

  const after = getNextCommunityRoundState(new Date('2026-08-20T18:05:00.000Z'));
  assert.equal(after.occurrence.toISOString(), '2026-08-21T18:00:00.000Z');
  assert.equal(after.occurrenceKey, '2026-08-21');
});

test('keeps a weekly schedule anchored to its configured weekday', () => {
  const friday = getCommunityRoundState(
    new Date('2026-08-21T10:00:00.000Z'),
    null,
    weeklySchedule,
  );
  assert.equal(friday.occurrence.toISOString(), '2026-08-27T18:00:00.000Z');
  assert.equal(friday.isOpen, false);

  const thursday = getCommunityRoundState(
    new Date('2026-08-27T18:00:00.000Z'),
    null,
    weeklySchedule,
  );
  assert.equal(thursday.occurrenceKey, '2026-08-27');
  assert.equal(thursday.isOpen, true);
});

test('clamps monthly schedules to the last available calendar day', () => {
  const monthlySchedule = {
    startsAt: '2026-01-31T19:00:00.000Z',
    frequency: 'monthly',
    timeZone: 'Europe/Vilnius',
    updatedAt: null,
  };
  const february = getCommunityRoundState(
    new Date('2026-02-28T19:00:00.000Z'),
    null,
    monthlySchedule,
  );
  assert.equal(february.occurrenceKey, '2026-02-28');
  assert.equal(february.isOpen, true);

  const march = getNextCommunityRoundState(
    new Date('2026-02-28T19:01:00.000Z'),
    monthlySchedule,
  );
  assert.equal(march.occurrence.toISOString(), '2026-03-31T18:00:00.000Z');
});

test('round-trips admin date and time inputs in the schedule time zone', () => {
  const startsAt = communityRoundStartAtFromZonedInput(
    '2026-08-23',
    '21:30',
    'Europe/Vilnius',
  );
  assert.equal(startsAt?.toISOString(), '2026-08-23T18:30:00.000Z');
  assert.deepEqual(
    getCommunityRoundScheduleInputValues({
      ...weeklySchedule,
      startsAt: startsAt.toISOString(),
    }),
    { date: '2026-08-23', time: '21:30' },
  );
});

test('formats the compact wait shown after training', () => {
  assert.equal(formatCommunityRoundWait(0), '0m');
  assert.equal(formatCommunityRoundWait(1), '1m');
  assert.equal(formatCommunityRoundWait(3_720_000), '1h 2m');
});

test('creates a daily 21:00 Vilnius Google Calendar reminder', () => {
  const url = new URL(
    getCommunityRoundGoogleCalendarUrl(new Date('2026-08-20T18:00:00.000Z')),
  );
  assert.equal(url.origin, 'https://calendar.google.com');
  assert.equal(url.searchParams.get('dates'), '20260820T210000/20260820T220000');
  assert.equal(url.searchParams.get('ctz'), 'Europe/Vilnius');
  assert.equal(url.searchParams.get('recur'), 'RRULE:FREQ=DAILY');
});

test('uses the configured recurrence in Google Calendar reminders', () => {
  const url = new URL(
    getCommunityRoundGoogleCalendarUrl(
      new Date('2026-08-20T18:00:00.000Z'),
      weeklySchedule,
    ),
  );
  assert.equal(url.searchParams.get('recur'), 'RRULE:FREQ=WEEKLY');
});

test('formats countdowns with stable tabular fields', () => {
  assert.equal(formatCommunityRoundCountdown(0), '00:00:00');
  assert.equal(formatCommunityRoundCountdown(1), '00:00:01');
  assert.equal(formatCommunityRoundCountdown(3_661_000), '01:01:01');
  assert.equal(formatCommunityRoundCountdown(86_399_100), '24:00:00');
});
