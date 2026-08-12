import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getLobbyVotesRequired,
  getWardenCountForPlayers,
  isValidRoomCode,
  normalizeRoomCode,
} from '../dist/index.js';

test('a two-thirds vote starts an underfilled lobby', () => {
  assert.equal(getLobbyVotesRequired(6), 4);
  assert.equal(getLobbyVotesRequired(7), 5);
  assert.equal(getLobbyVotesRequired(8), 6);
  assert.equal(getLobbyVotesRequired(9), 6);
});

test('underfilled role counts preserve one or two hidden wardens', () => {
  assert.equal(getWardenCountForPlayers(0), 0);
  assert.equal(getWardenCountForPlayers(6), 1);
  assert.equal(getWardenCountForPlayers(7), 2);
  assert.equal(getWardenCountForPlayers(9), 2);
});

test('room codes are normalized and reject ambiguous characters', () => {
  assert.equal(normalizeRoomCode(' ab2k9z '), 'AB2K9Z');
  assert.equal(isValidRoomCode('AB2K9Z'), true);
  assert.equal(isValidRoomCode('AB0K9Z'), false);
  assert.equal(isValidRoomCode('SHORT'), false);
});
