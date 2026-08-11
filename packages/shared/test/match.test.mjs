import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PORTAL_INTERACTION_RANGE,
  getRemainingSurvivorsToEscape,
  getSurvivorEscapeThreshold,
  isWithinPortalInteractionRange,
} from '../dist/index.js';

test('escape thresholds preserve the rounded-up five-of-seven ratio', () => {
  const expected = [1, 1, 2, 3, 3, 4, 5, 5];
  for (let survivorCount = 0; survivorCount < expected.length; survivorCount++) {
    assert.equal(getSurvivorEscapeThreshold(survivorCount), expected[survivorCount]);
  }
});

test('remaining escape count is clamped at zero', () => {
  assert.equal(getRemainingSurvivorsToEscape(0, 7), 5);
  assert.equal(getRemainingSurvivorsToEscape(3, 4), 0);
  assert.equal(getRemainingSurvivorsToEscape(10, 7), 0);
});

test('portal interaction includes the exact range boundary', () => {
  const portal = { x: 100, y: 200 };
  assert.equal(isWithinPortalInteractionRange(portal, portal), true);
  assert.equal(
    isWithinPortalInteractionRange(
      { x: portal.x + PORTAL_INTERACTION_RANGE, y: portal.y },
      portal,
    ),
    true,
  );
  assert.equal(
    isWithinPortalInteractionRange(
      { x: portal.x + PORTAL_INTERACTION_RANGE + 0.01, y: portal.y },
      portal,
    ),
    false,
  );
});
