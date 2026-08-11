import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CELL_SIZE,
  CELL_STEP_X,
  CELL_STEP_Y,
  DECORATED_VERTICAL_PASSAGE_DENSITY,
  TILE_FLOOR,
  WALL_HEIGHT,
  WALL_WIDTH,
  computeDecoratedVerticalPassagePlacements,
  computePortalPosition,
  generateMazeLayout,
  getDecoratedVerticalPassageBounds,
  isPositionValid,
} from '../dist/index.js';

function occupy(set, cellX, cellY) {
  set.add(`${cellX},${cellY}`);
}

test('decorated vertical passages deterministically reserve otherwise empty cell pairs', () => {
  assert.equal(DECORATED_VERTICAL_PASSAGE_DENSITY, 0.16);

  for (const seed of [1, 2, 44, 99, 123456]) {
    const first = generateMazeLayout(seed, 10, 3);
    const second = generateMazeLayout(seed, 10, 3);
    assert.deepEqual(first.decoratedVerticalPassages, second.decoratedVerticalPassages);
    assert.ok(first.decoratedVerticalPassages.length > 0);

    const portal = computePortalPosition(
      first.map.data,
      10,
      first.bridges,
      first.swamps,
      first.chestDeadEnds,
      first.swordFields,
    );
    assert.deepEqual(
      first.decoratedVerticalPassages,
      computeDecoratedVerticalPassagePlacements(
        first.map.data,
        first.spawnPoints,
        first.gates,
        first.bridges,
        first.swamps,
        first.swordFields,
        first.trapCells,
        first.chestDeadEnds,
        first.tIntersectionDecorations,
        portal,
        seed,
      ),
    );

    const occupied = new Set();
    for (const gate of first.gates) occupy(occupied, gate.cellX, gate.cellY);
    for (const bridge of first.bridges) {
      occupy(occupied, bridge.cellX, bridge.northCellY);
      occupy(occupied, bridge.cellX, bridge.northCellY + 1);
    }
    for (const swamp of first.swamps) {
      for (let offset = 0; offset < swamp.lengthCells; offset++) {
        occupy(occupied, swamp.westCellX + offset, swamp.cellY);
      }
    }
    for (const sword of first.swordFields) {
      occupy(occupied, sword.westCellX, sword.cellY);
      occupy(occupied, sword.westCellX + 1, sword.cellY);
    }
    for (const trap of first.trapCells) occupy(occupied, trap.cellX, trap.cellY);
    for (const chest of first.chestDeadEnds) occupy(occupied, chest.cellX, chest.cellY);
    for (const decoration of first.tIntersectionDecorations) {
      const verticalOffset = decoration.closedDirection === 'north' ? 1 : -1;
      occupy(occupied, decoration.cellX, decoration.cellY);
      occupy(occupied, decoration.cellX - 1, decoration.cellY);
      occupy(occupied, decoration.cellX + 1, decoration.cellY);
      occupy(occupied, decoration.cellX, decoration.cellY + verticalOffset);
    }

    for (const passage of first.decoratedVerticalPassages) {
      const northKey = `${passage.cellX},${passage.northCellY}`;
      const southKey = `${passage.cellX},${passage.northCellY + 1}`;
      assert.equal(occupied.has(northKey), false);
      assert.equal(occupied.has(southKey), false);
      assert.equal(passage.tileX, WALL_WIDTH + passage.cellX * CELL_STEP_X);
      assert.equal(
        passage.tileY,
        WALL_HEIGHT + passage.northCellY * CELL_STEP_Y + CELL_SIZE,
      );
      occupied.add(northKey);
      occupied.add(southKey);
    }
  }
});

test('occupying either passage cell suppresses that visual prefab', () => {
  const seed = 44;
  const layout = generateMazeLayout(seed, 10, 3);
  const portal = computePortalPosition(
    layout.map.data,
    10,
    layout.bridges,
    layout.swamps,
    layout.chestDeadEnds,
    layout.swordFields,
  );
  const allCandidates = computeDecoratedVerticalPassagePlacements(
    layout.map.data,
    layout.spawnPoints,
    layout.gates,
    layout.bridges,
    layout.swamps,
    layout.swordFields,
    layout.trapCells,
    layout.chestDeadEnds,
    layout.tIntersectionDecorations,
    portal,
    seed,
    1,
  );
  const candidate = allCandidates[0];
  assert.ok(candidate);

  for (const cellY of [candidate.northCellY, candidate.northCellY + 1]) {
    const withOccupiedCell = computeDecoratedVerticalPassagePlacements(
      layout.map.data,
      layout.spawnPoints,
      layout.gates,
      layout.bridges,
      layout.swamps,
      layout.swordFields,
      [...layout.trapCells, { cellX: candidate.cellX, cellY, tileX: 0, tileY: 0 }],
      layout.chestDeadEnds,
      layout.tIntersectionDecorations,
      portal,
      seed,
      1,
    );
    assert.equal(
      withOccupiedCell.some(
        (passage) =>
          passage.cellX === candidate.cellX &&
          passage.northCellY === candidate.northCellY,
      ),
      false,
    );
  }
});

test('the four authored foliage rectangles block player feet', () => {
  const map = {
    width: 30,
    height: 30,
    tileSize: 16,
    data: new Array(30 * 30).fill(TILE_FLOOR),
  };
  const placement = { cellX: 0, northCellY: 0, tileX: 4, tileY: 4 };
  const anchorX = placement.tileX * map.tileSize;
  const anchorY = placement.tileY * map.tileSize;
  const bounds = getDecoratedVerticalPassageBounds(placement, map.tileSize);

  assert.deepEqual(
    bounds.map(({ left, top, right, bottom }) => ({
      x: left - anchorX,
      y: top - anchorY,
      width: right - left + 1,
      height: bottom - top + 1,
    })),
    [
      { x: 80, y: 1, width: 15, height: 14 },
      { x: 1, y: 65, width: 13, height: 14 },
      { x: 77, y: 72, width: 15, height: 52 },
      { x: 64, y: 149, width: 15, height: 10 },
    ],
  );

  for (const obstacle of bounds) {
    assert.equal(
      isPositionValid(
        (obstacle.left + obstacle.right) / 2,
        obstacle.bottom + 1,
        map,
        null,
        [],
        [],
        [],
        [],
        [],
        [],
        undefined,
        [],
        [placement],
      ),
      false,
    );
  }
});
