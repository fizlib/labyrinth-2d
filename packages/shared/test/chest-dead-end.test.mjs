import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CELL_SIZE,
  CELL_STEP_X,
  CELL_STEP_Y,
  CHEST_INTERACTION_RANGE,
  FEET_HITBOX_H,
  MAX_WISDOM_ORBS,
  TILE_FLOOR,
  WALL_HEIGHT,
  WALL_WIDTH,
  computeChestDeadEndPlacements,
  computePortalPosition,
  generateMazeLayout,
  getChestDeadEndBounds,
  getChestInteractionPoint,
  getChestWisdomOrbReward,
  isPositionValid,
} from '../dist/index.js';

test('seed-44 retains the authored south-opening chest dead end', () => {
  const layout = generateMazeLayout(44, 10, 3);

  assert.deepEqual(layout.chestDeadEnds, computeChestDeadEndPlacements(layout.map.data));
  assert.ok(
    layout.chestDeadEnds.some(
      (placement) => placement.cellX === 2 && placement.cellY === 9,
    ),
    'the style-editor fixture must remain anchored to cell 2,9',
  );

  for (const placement of layout.chestDeadEnds) {
    assert.equal(placement.openDirection, 'south');
    assert.equal(placement.tileX, WALL_WIDTH + placement.cellX * CELL_STEP_X);
    assert.equal(placement.tileY, WALL_HEIGHT + placement.cellY * CELL_STEP_Y);
  }
});

test('portal placement excludes cells reserved by chest dead ends', () => {
  for (let seed = 0; seed < 40; seed++) {
    const layout = generateMazeLayout(seed, 10, 3);
    const portal = computePortalPosition(
      layout.map.data,
      10,
      layout.bridges,
      layout.swamps,
      layout.chestDeadEnds,
    );
    if (!portal) continue;

    const portalCellX = Math.round((portal.x - CELL_SIZE / 2 - WALL_WIDTH) / CELL_STEP_X);
    const portalCellY = Math.round((portal.y + 0.75 - WALL_HEIGHT) / CELL_STEP_Y);
    assert.equal(
      layout.chestDeadEnds.some(
        (placement) => placement.cellX === portalCellX && placement.cellY === portalCellY,
      ),
      false,
    );
  }
});

test('all three exported chest-cell rectangles block player feet', () => {
  const map = {
    width: 20,
    height: 20,
    tileSize: 16,
    data: new Array(20 * 20).fill(TILE_FLOOR),
  };
  const placement = {
    cellX: 0,
    cellY: 0,
    tileX: 4,
    tileY: 4,
    openDirection: 'south',
  };
  const bounds = getChestDeadEndBounds(placement, map.tileSize);

  assert.deepEqual(
    bounds.map(({ kind, left, top, right, bottom }) => ({
      kind,
      x: left - placement.tileX * map.tileSize,
      y: top - placement.tileY * map.tileSize,
      width: right - left + 1,
      height: bottom - top + 1,
    })),
    [
      { kind: 'backdrop', x: 17, y: -3, width: 70, height: 16 },
      { kind: 'rock', x: 60, y: 25, width: 13, height: 12 },
      { kind: 'chest', x: 36, y: 25, width: 10, height: 9 },
    ],
  );

  for (const obstacle of bounds) {
    const playerX = (obstacle.left + obstacle.right) / 2;
    const collidingFeetY = obstacle.bottom + 1;
    assert.equal(
      isPositionValid(playerX, collidingFeetY, map, null, [], [], [placement]),
      false,
      `${obstacle.kind} collider must block the player`,
    );
  }

  const chest = bounds.find((obstacle) => obstacle.kind === 'chest');
  assert.ok(chest);
  assert.equal(
    isPositionValid(
      (chest.left + chest.right) / 2,
      chest.bottom + FEET_HITBOX_H + 2,
      map,
      null,
      [],
      [],
      [placement],
    ),
    true,
    'the floor immediately south of the chest must remain walkable',
  );
});

test('chest interaction point and wisdom-orb cap stay shared', () => {
  const placement = {
    cellX: 0,
    cellY: 0,
    tileX: 4,
    tileY: 4,
    openDirection: 'south',
  };

  assert.deepEqual(getChestInteractionPoint(placement, 16), { x: 106, y: 98 });
  assert.equal(CHEST_INTERACTION_RANGE, 28);
  assert.equal(MAX_WISDOM_ORBS, 3);
  assert.equal(getChestWisdomOrbReward(0), 1);
  assert.equal(getChestWisdomOrbReward(2), 3);
  assert.equal(getChestWisdomOrbReward(3), null);
  assert.equal(getChestWisdomOrbReward(4), null);
});
