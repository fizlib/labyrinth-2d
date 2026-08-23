import assert from 'node:assert/strict';
import test from 'node:test';

import { buildTutorialApiUrl } from '../dist/systems/TutorialApiUrl.js';

test('uses the local tutorial API proxy during development', () => {
  assert.equal(
    buildTutorialApiUrl(
      'sessions',
      'ws://127.0.0.1:9001/ws',
      'http://localhost:5173',
      true,
    ),
    'http://localhost:5173/tutorial-api/sessions',
  );
});

test('maps secure production sockets to tutorial HTTPS endpoints', () => {
  assert.equal(
    buildTutorialApiUrl(
      'sessions/attempt-id',
      'wss://game.example.com/ws',
      'https://falsearrow.com',
      false,
    ),
    'https://game.example.com/tutorial-api/sessions/attempt-id',
  );
});
