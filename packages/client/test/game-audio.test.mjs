import assert from 'node:assert/strict';
import test from 'node:test';

import { getSpatialGain } from '../dist/systems/GameAudio.js';

test('spatial gain stays full near the listener and fades to silence', () => {
  const listener = { x: 10, y: 10 };

  assert.equal(getSpatialGain({ x: 10, y: 10 }, listener, 100), 1);
  assert.equal(getSpatialGain({ x: 34, y: 10 }, listener, 100), 1);
  assert.equal(getSpatialGain({ x: 110, y: 10 }, listener, 100), 0);
  assert.ok(getSpatialGain({ x: 60, y: 10 }, listener, 100) > 0);
  assert.ok(getSpatialGain({ x: 60, y: 10 }, listener, 100) < 1);
});

test('spatial gain rejects unusable attenuation ranges', () => {
  assert.equal(getSpatialGain({ x: 0, y: 0 }, { x: 0, y: 0 }, 24), 0);
});
