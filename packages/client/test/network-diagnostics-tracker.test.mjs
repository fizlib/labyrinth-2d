import assert from 'node:assert/strict';
import test from 'node:test';

import { NetworkDiagnosticsTracker } from '../dist/net/NetworkDiagnosticsTracker.js';

test('reports rolling movement and snapshot rates with snapshot age', () => {
  const tracker = new NetworkDiagnosticsTracker();
  tracker.recordMovementSent(100);
  tracker.recordMovementSent(600);
  tracker.recordSnapshotReceived(500);
  tracker.recordSnapshotReceived(900);

  assert.deepEqual(tracker.getDiagnostics(1_000, 321), {
    movementMessagesPerSecond: 2,
    snapshotMessagesPerSecond: 2,
    snapshotAgeMs: 100,
    bufferedAmount: 321,
  });

  assert.deepEqual(tracker.getDiagnostics(1_601, -1), {
    movementMessagesPerSecond: 0,
    snapshotMessagesPerSecond: 1,
    snapshotAgeMs: 701,
    bufferedAmount: 0,
  });
});

test('reset clears all accumulated network measurements', () => {
  const tracker = new NetworkDiagnosticsTracker();
  tracker.recordMovementSent(100);
  tracker.recordSnapshotReceived(100);
  tracker.reset();

  assert.deepEqual(tracker.getDiagnostics(200, 0), {
    movementMessagesPerSecond: 0,
    snapshotMessagesPerSecond: 0,
    snapshotAgeMs: null,
    bufferedAmount: 0,
  });
});
