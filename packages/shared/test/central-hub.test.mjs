import assert from 'node:assert/strict';
import test from 'node:test';

import {
  TILE_RUNESTONE_1,
  generateMazeLayout,
  getCentralHubCollisionBounds,
  getCentralHubRunestonePlacements,
  getHubTileBounds,
  isPositionValid,
  isSolidTileId,
} from '../dist/index.js';

test('the redesigned hub exposes its exact authored colliders', () => {
  const { map } = generateMazeLayout(44, 10, 3);
  const hub = getHubTileBounds(map.width, map.height);
  const anchorX = hub.left * map.tileSize;
  const anchorY = hub.top * map.tileSize;
  const colliders = getCentralHubCollisionBounds(map);

  assert.equal(colliders.length, 23);
  assert.deepEqual(colliders[0], {
    left: anchorX + 196,
    top: anchorY + 211,
    right: anchorX + 203,
    bottom: anchorY + 216,
    shape: 'rectangle',
    flipX: false,
    flipY: false,
  });
  assert.equal(colliders.filter((bounds) => bounds.shape === 'right-triangle').length, 2);

  assert.equal(
    isPositionValid(anchorX + 80, anchorY + 100, map),
    false,
    'the north-west ruins mass must block player feet',
  );
  assert.equal(
    isPositionValid(anchorX + 240, anchorY + 240, map),
    true,
    'the central hub crossing must remain walkable',
  );
});

test('moved runestone visuals and interactions use exact pixel anchors', () => {
  const { map } = generateMazeLayout(44, 10, 3);
  const hub = getHubTileBounds(map.width, map.height);
  const anchorX = hub.left * map.tileSize;
  const anchorY = hub.top * map.tileSize;

  assert.deepEqual(
    getCentralHubRunestonePlacements(map).map(({ index, x, y, tileX, tileY }) => ({
      index,
      x,
      y,
      tileX,
      tileY,
    })),
    [
      { index: 0, x: anchorX + 192, y: anchorY + 191, tileX: 130, tileY: 122.9375 },
      { index: 1, x: anchorX + 232, y: anchorY + 231, tileX: 132.5, tileY: 125.4375 },
      { index: 2, x: anchorX + 273, y: anchorY + 191, tileX: 135.0625, tileY: 122.9375 },
    ],
  );
  assert.equal(
    isSolidTileId(TILE_RUNESTONE_1),
    false,
    'legacy marker tiles must not leave ghost colliders at the old positions',
  );
});
