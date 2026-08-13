import test from 'node:test';
import assert from 'node:assert/strict';

import { calculateTeamEloRatings } from '../dist/index.js';

function player(playerId, role, rating = 1200, matchesPlayed = 10) {
  return { playerId, role, rating, matchesPlayed };
}

test('equal team averages produce symmetric established Elo changes', () => {
  const results = calculateTeamEloRatings(
    [
      player('survivor-1', 'survivor'),
      player('survivor-2', 'survivor'),
      player('warden-1', 'warden'),
    ],
    'survivors',
  );

  assert.deepEqual(
    results.map((result) => result.ratingDelta),
    [12, 12, -12],
  );
  assert.ok(results.every((result) => result.expectedScore === 0.5));
});

test('provisional players move faster and upsets award more rating', () => {
  const results = calculateTeamEloRatings(
    [player('underdog', 'survivor', 1000, 0), player('favorite', 'warden', 1400, 20)],
    'survivors',
  );

  assert.equal(results[0].kFactor, 40);
  assert.ok(results[0].ratingDelta > 30);
  assert.equal(results[1].kFactor, 24);
  assert.ok(results[1].ratingDelta < -20);
});

test('team strength uses averages rather than the asymmetric player counts', () => {
  const participants = [
    ...Array.from({ length: 7 }, (_, index) => player(`survivor-${index}`, 'survivor')),
    player('warden-1', 'warden'),
    player('warden-2', 'warden'),
  ];
  const results = calculateTeamEloRatings(participants, 'wardens');

  assert.ok(results.every((result) => result.expectedScore === 0.5));
  assert.deepEqual(
    [...new Set(results.map((result) => result.ratingDelta))].sort((a, b) => a - b),
    [-12, 12],
  );
});
