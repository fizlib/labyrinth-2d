import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BRIDGE_COLLAPSE_DECORATION_SPRITES,
  BRIDGE_COLLAPSE_REFERENCE_ROW,
  getBridgeObstacleAssetPath,
  getBridgeRowShadowLayout,
} from '../dist/systems/BridgeObstacleLayout.js';

const tileBit = (row, column) => 1 << (row * 2 + column);

test('preserves the collapse-front composition from style-editor export 73', () => {
  const referenceSprites = BRIDGE_COLLAPSE_DECORATION_SPRITES.filter(
    (spec) => spec.row === BRIDGE_COLLAPSE_REFERENCE_ROW,
  ).map(({ asset, x, y, w, h, z, collapseKind, row, column }) => ({
    asset,
    x,
    y,
    w,
    h,
    z,
    collapseKind,
    row,
    column,
  }));

  assert.deepEqual(referenceSprites, [
    {
      asset: 'a106FrontShadow',
      x: 32,
      y: 120,
      w: 32,
      h: 5,
      z: 499,
      collapseKind: 'shadow',
      row: 4,
      column: undefined,
    },
    {
      asset: 'a106Front',
      x: 32,
      y: 115,
      w: 16,
      h: 5,
      z: 500,
      collapseKind: 'front',
      row: 4,
      column: 0,
    },
    {
      asset: 'a106Front',
      x: 48,
      y: 115,
      w: 16,
      h: 5,
      z: 500,
      collapseKind: 'front',
      row: 4,
      column: 1,
    },
  ]);
  assert.equal(
    getBridgeObstacleAssetPath('a106Front'),
    '/assets/bridge-obstacle/Sprite_Ancient_Ruins_106_front.png',
  );
  assert.equal(
    getBridgeObstacleAssetPath('a106FrontShadow'),
    '/assets/bridge-obstacle/Sprite_Ancient_Ruins_106_front_shadow.png',
  );
});

test('sizes and aligns shadows for complete and partial repair rows', () => {
  assert.deepEqual(getBridgeRowShadowLayout(0, 4), { x: 32, width: 32 });
  assert.deepEqual(getBridgeRowShadowLayout(tileBit(4, 1), 4), {
    x: 32,
    width: 16,
  });
  assert.deepEqual(getBridgeRowShadowLayout(tileBit(4, 0), 4), {
    x: 48,
    width: 16,
  });
  assert.equal(getBridgeRowShadowLayout(tileBit(4, 0) | tileBit(4, 1), 4), null);
});
