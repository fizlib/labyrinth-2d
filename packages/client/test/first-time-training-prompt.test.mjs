import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getFirstTimeTrainingPromptStorageKey,
  shouldOfferFirstTimeTrainingPrompt,
} from '../dist/systems/FirstTimeTrainingPrompt.js';

test('offers training to a new authenticated player or guest only before it is seen', () => {
  assert.equal(shouldOfferFirstTimeTrainingPrompt(0, false), true);
  assert.equal(shouldOfferFirstTimeTrainingPrompt(null, false), true);
  assert.equal(shouldOfferFirstTimeTrainingPrompt(0, true), false);
  assert.equal(shouldOfferFirstTimeTrainingPrompt(null, true), false);
});

test('does not introduce the onboarding prompt to an existing competitor', () => {
  assert.equal(shouldOfferFirstTimeTrainingPrompt(1, false), false);
  assert.equal(shouldOfferFirstTimeTrainingPrompt(12, false), false);
});

test('scopes the one-time flag to the player profile', () => {
  assert.equal(
    getFirstTimeTrainingPromptStorageKey('player-one'),
    'labyrinth-first-time-training-prompt-v1:player-one',
  );
  assert.notEqual(
    getFirstTimeTrainingPromptStorageKey('player-one'),
    getFirstTimeTrainingPromptStorageKey('player-two'),
  );
});
