import assert from 'node:assert/strict';
import test from 'node:test';

import { LatestSnapshotScheduler } from '../dist/net/LatestSnapshotScheduler.js';

test('applies only the latest snapshot waiting inside one cadence window', () => {
  let now = 0;
  let nextHandle = 1;
  const scheduled = new Map();
  const applied = [];
  const scheduler = new LatestSnapshotScheduler({
    apply: (snapshot) => applied.push(snapshot),
    now: () => now,
    schedule: (callback, delayMs) => {
      const handle = nextHandle++;
      scheduled.set(handle, { callback, delayMs });
      return handle;
    },
    cancel: (handle) => scheduled.delete(handle),
    intervalMs: 100,
    coalesceWindowMs: 16,
  });

  assert.equal(scheduler.enqueue({ tick: 1 }), false);
  assert.equal(scheduler.enqueue({ tick: 2 }), true);
  const first = scheduled.get(1);
  assert.equal(first.delayMs, 16);
  now = 16;
  scheduled.delete(1);
  first.callback();
  assert.deepEqual(applied, [{ tick: 2 }]);

  now = 41;
  assert.equal(scheduler.enqueue({ tick: 3 }), false);
  assert.equal(scheduler.enqueue({ tick: 4 }), true);
  const second = scheduled.get(2);
  assert.equal(second.delayMs, 75);
  now = 116;
  scheduled.delete(2);
  second.callback();
  assert.deepEqual(applied, [{ tick: 2 }, { tick: 4 }]);
});

test('reset cancels a scheduled stale snapshot', () => {
  let cancelled = false;
  const scheduler = new LatestSnapshotScheduler({
    apply: () => assert.fail('reset snapshot must not be applied'),
    now: () => 0,
    schedule: () => 123,
    cancel: (handle) => {
      assert.equal(handle, 123);
      cancelled = true;
    },
  });

  scheduler.enqueue({ tick: 1 });
  scheduler.reset();
  assert.equal(cancelled, true);
});
