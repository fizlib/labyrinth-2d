import test from 'node:test';
import assert from 'node:assert/strict';

import { isAdminApiOriginAllowed } from '../dist/adminApi.js';

test('admin API allows both canonical production browser origins', () => {
  const gameHost = 'game--labyrinth-2d--deployment.code.run';

  assert.equal(isAdminApiOriginAllowed('https://falsearrow.com', gameHost), true);
  assert.equal(
    isAdminApiOriginAllowed('https://www.falsearrow.com', gameHost),
    true,
  );
});

test('admin API allows same-origin requests and rejects unrelated sites', () => {
  const gameHost = 'game.example.com';

  assert.equal(isAdminApiOriginAllowed('https://game.example.com', gameHost), true);
  assert.equal(isAdminApiOriginAllowed('https://attacker.example', gameHost), false);
});
