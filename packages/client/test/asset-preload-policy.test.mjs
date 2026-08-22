import assert from 'node:assert/strict';
import test from 'node:test';

import { shouldWarmGameAssetsInBackground } from '../dist/assets/AssetPreloadPolicy.js';

test('warms game assets in the background on pointer-based desktops', () => {
  assert.equal(
    shouldWarmGameAssetsInBackground({ maxTouchPoints: 0, coarsePointer: false }),
    true,
  );
});

test('defers aggregate texture loading on touchscreen phones and tablets', () => {
  assert.equal(
    shouldWarmGameAssetsInBackground({ maxTouchPoints: 5, coarsePointer: true }),
    false,
  );
});

test('uses either touch signal to protect hybrid and privacy-limited browsers', () => {
  assert.equal(
    shouldWarmGameAssetsInBackground({ maxTouchPoints: 1, coarsePointer: false }),
    false,
  );
  assert.equal(
    shouldWarmGameAssetsInBackground({ maxTouchPoints: 0, coarsePointer: true }),
    false,
  );
});
