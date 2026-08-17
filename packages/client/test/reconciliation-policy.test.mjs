import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_RECONCILIATION_REPLAY_INPUTS,
  getReconciliationInputs,
} from '../dist/net/ReconciliationPolicy.js';

test('replays a normal acknowledgement window in order', () => {
  const pending = [{ id: 1 }, { id: 2 }];
  const unsent = [{ id: 3 }];

  assert.deepEqual(getReconciliationInputs(pending, unsent), [
    { id: 1 },
    { id: 2 },
    { id: 3 },
  ]);
});

test('skips collision replay when the acknowledgement backlog is unsafe', () => {
  const pending = Array.from(
    { length: MAX_RECONCILIATION_REPLAY_INPUTS + 1 },
    (_, id) => ({ id }),
  );

  assert.equal(getReconciliationInputs(pending, []), null);
});
