import assert from 'node:assert/strict';
import test from 'node:test';

import {
  formatCommunityRoundCountdown,
  getCommunityRoundState,
} from '../dist/systems/CommunityRoundSchedule.js';

test('unlocks the summer Kyiv round at 18:00', () => {
  const before = getCommunityRoundState(new Date('2026-08-20T14:59:00.000Z'), null);
  assert.equal(before.occurrence.toISOString(), '2026-08-20T15:00:00.000Z');
  assert.equal(before.occurrenceKey, '2026-08-20');
  assert.equal(before.isOpen, false);
  assert.equal(before.remainingMs, 60_000);

  const open = getCommunityRoundState(new Date('2026-08-20T15:00:00.000Z'), null);
  assert.equal(open.occurrence.toISOString(), '2026-08-20T15:00:00.000Z');
  assert.equal(open.isOpen, true);
  assert.equal(open.remainingMs, 0);
});

test('keeps 18:00 Kyiv across the winter daylight-saving offset', () => {
  const before = getCommunityRoundState(new Date('2026-12-20T15:59:00.000Z'), null);
  assert.equal(before.occurrence.toISOString(), '2026-12-20T16:00:00.000Z');
  assert.equal(before.isOpen, false);

  const open = getCommunityRoundState(new Date('2026-12-20T16:00:00.000Z'), null);
  assert.equal(open.isOpen, true);
});

test("advances to tomorrow after this player's match starts", () => {
  const next = getCommunityRoundState(new Date('2026-08-20T15:05:00.000Z'), '2026-08-20');
  assert.equal(next.occurrence.toISOString(), '2026-08-21T15:00:00.000Z');
  assert.equal(next.occurrenceKey, '2026-08-21');
  assert.equal(next.isOpen, false);
});

test('starts a fresh locked schedule after the host-local day changes', () => {
  const nextDay = getCommunityRoundState(
    new Date('2026-08-20T22:30:00.000Z'),
    '2026-08-20',
  );
  assert.equal(nextDay.occurrence.toISOString(), '2026-08-21T15:00:00.000Z');
  assert.equal(nextDay.occurrenceKey, '2026-08-21');
  assert.equal(nextDay.isOpen, false);
});

test('formats countdowns with stable tabular fields', () => {
  assert.equal(formatCommunityRoundCountdown(0), '00:00:00');
  assert.equal(formatCommunityRoundCountdown(1), '00:00:01');
  assert.equal(formatCommunityRoundCountdown(3_661_000), '01:01:01');
  assert.equal(formatCommunityRoundCountdown(86_399_100), '24:00:00');
});
