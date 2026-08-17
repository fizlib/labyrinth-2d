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

    const unsent = scheduler.getUnsentInputs();
    const representedTime =
      commands.reduce((total, command) => total + command.dt, 0) +
      unsent.reduce((total, command) => total + command.dt, 0);
    assert.ok(Math.abs(representedTime - 1) < 1e-9);
  }
});

test('coalesces direction changes without bypassing the send cadence', () => {
  const scheduler = new MovementInputScheduler();

  assert.deepEqual(scheduler.update(UP, 0.01), [{ ...UP, dt: 0.01 }]);
  assert.deepEqual(scheduler.update(UP, 0.01), []);
  assert.deepEqual(scheduler.update(RIGHT, 0.01), []);
  assert.deepEqual(scheduler.getUnsentInputs(), [
    { ...UP, dt: 0.01 },
    { ...RIGHT, dt: 0.01 },
  ]);
  assert.deepEqual(scheduler.update(RIGHT, 0.01), [{ ...RIGHT, dt: 0.03 }]);
});

test('hard-caps alternating joystick directions at 25 messages per second', () => {
  for (const renderRate of [30, 60, 120]) {
    const scheduler = new MovementInputScheduler();
    const commands = [];

    for (let frame = 0; frame < renderRate; frame++) {
      const input = frame % 2 === 0 ? UP : RIGHT;
      commands.push(...scheduler.update(input, 1 / renderRate));
    }

    assert.equal(commands.length, 25, `${renderRate} FPS direction churn exceeded 25 Hz`);
  }
});

test('does not send repeated packets while idle', () => {
  const scheduler = new MovementInputScheduler();

  for (let frame = 0; frame < 120; frame++) {
    assert.deepEqual(scheduler.update(IDLE, 1 / 120), []);
  }
});
