import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MOVEMENT_INPUT_SEND_RATE,
  MovementInputScheduler,
} from '../dist/net/MovementInputScheduler.js';

const IDLE = { up: false, down: false, left: false, right: false };
const UP = { ...IDLE, up: true };
const RIGHT = { ...IDLE, right: true };

test('caps steady movement traffic at 25 Hz while preserving predicted time', () => {
  assert.equal(MOVEMENT_INPUT_SEND_RATE, 25);

  for (const renderRate of [30, 60, 120]) {
    const scheduler = new MovementInputScheduler();
    const commands = [];

    for (let frame = 0; frame < renderRate; frame++) {
      commands.push(...scheduler.update(UP, 1 / renderRate));
    }

    assert.equal(commands.length, 25, `${renderRate} FPS should still send at 25 Hz`);

    const unsent = scheduler.getUnsentInput();
    const representedTime =
      commands.reduce((total, command) => total + command.dt, 0) +
      (unsent?.dt ?? 0);
    assert.ok(Math.abs(representedTime - 1) < 1e-9);
  }
});

test('sends direction changes immediately and in movement order', () => {
  const scheduler = new MovementInputScheduler();

  assert.deepEqual(scheduler.update(UP, 0.01), [{ ...UP, dt: 0.01 }]);
  assert.deepEqual(scheduler.update(UP, 0.01), []);
  assert.deepEqual(scheduler.update(RIGHT, 0.01), [
    { ...UP, dt: 0.01 },
    { ...RIGHT, dt: 0.01 },
  ]);
  assert.deepEqual(scheduler.update(IDLE, 0.01), [{ ...IDLE, dt: 0 }]);
});

test('does not send repeated packets while idle', () => {
  const scheduler = new MovementInputScheduler();

  for (let frame = 0; frame < 120; frame++) {
    assert.deepEqual(scheduler.update(IDLE, 1 / 120), []);
  }
});
