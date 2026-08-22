import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldShowTrainingCompletionPrompt } from '../dist/systems/TrainingCompletionPrompt.js';

function lobbyWithOtherPlayers(otherPlayerCount, phase = 'waiting') {
  return {
    roomId: 'ABC234',
    phase,
    players: [
      {
        id: 'local-player',
        displayName: 'Local',
        votedToStart: false,
        connected: true,
      },
      ...Array.from({ length: otherPlayerCount }, (_, index) => ({
        id: `other-${index}`,
        displayName: `Other ${index}`,
        votedToStart: false,
        connected: true,
      })),
    ],
    minPlayers: 6,
    maxPlayers: 9,
    votesRequired: 1,
    voteAvailableAt: 0,
    countdownEndsAt: null,
    startReason: null,
  };
}

test('shows the return prompt with fewer than three other waiting players', () => {
  assert.equal(
    shouldShowTrainingCompletionPrompt(lobbyWithOtherPlayers(0), 'local-player'),
    true,
  );
  assert.equal(
    shouldShowTrainingCompletionPrompt(lobbyWithOtherPlayers(2), 'local-player'),
    true,
  );
});

test('skips the return prompt once three other players are waiting', () => {
  assert.equal(
    shouldShowTrainingCompletionPrompt(lobbyWithOtherPlayers(3), 'local-player'),
    false,
  );
});

test('counts only connected players and never interrupts a starting match', () => {
  const sparseLobby = lobbyWithOtherPlayers(3);
  sparseLobby.players[1].connected = false;
  assert.equal(
    shouldShowTrainingCompletionPrompt(sparseLobby, 'local-player'),
    true,
  );
  assert.equal(
    shouldShowTrainingCompletionPrompt(
      lobbyWithOtherPlayers(1, 'countdown'),
      'local-player',
    ),
    false,
  );
});
