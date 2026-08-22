import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CELL_SIZE,
  CELL_STEP_X,
  CELL_STEP_Y,
  GRID_CELLS,
  TILE_FLOOR,
  TILE_FLOOR_SHADOW,
  WALL_HEIGHT,
  WALL_WIDTH,
  generateTutorialMazeLayout,
  getChestDeadEndBounds,
  getPlayerSwampTerrain,
} from '../dist/index.js';

function isWalkable(tileId) {
  return tileId === TILE_FLOOR || tileId === TILE_FLOOR_SHADOW;
}

function areCellsConnected(map, cellX, cellY, nextCellX, nextCellY) {
  const tileX = WALL_WIDTH + cellX * CELL_STEP_X;
  const tileY = WALL_HEIGHT + cellY * CELL_STEP_Y;
  const nextTileX = WALL_WIDTH + nextCellX * CELL_STEP_X;
  const nextTileY = WALL_HEIGHT + nextCellY * CELL_STEP_Y;

  if (cellY === nextCellY) {
    const wallX = Math.min(tileX, nextTileX) + CELL_SIZE;
    for (let y = tileY; y < tileY + CELL_SIZE; y++) {
      for (let x = wallX; x < wallX + CELL_STEP_X - CELL_SIZE; x++) {
        if (isWalkable(map.data[y * map.width + x])) return true;
      }
    }
    return false;
  }

  const wallY = Math.min(tileY, nextTileY) + CELL_SIZE;
  for (let y = wallY; y < wallY + CELL_STEP_Y - CELL_SIZE; y++) {
    for (let x = tileX; x < tileX + CELL_SIZE; x++) {
      if (isWalkable(map.data[y * map.width + x])) return true;
    }
  }
  return false;
}

function connectionsForCell(map, cellX, cellY) {
  return [
    cellY > 0 && areCellsConnected(map, cellX, cellY, cellX, cellY - 1),
    cellX < GRID_CELLS - 1 && areCellsConnected(map, cellX, cellY, cellX + 1, cellY),
    cellY < GRID_CELLS - 1 && areCellsConnected(map, cellX, cellY, cellX, cellY + 1),
    cellX > 0 && areCellsConnected(map, cellX, cellY, cellX - 1, cellY),
  ]
    .map((open, index) => (open ? 'NESW'[index] : '-'))
    .join('');
}

test('tutorial maze has the short spawn, T-junction, hub, and portal-dead-end route', () => {
  const layout = generateTutorialMazeLayout();

  assert.equal(layout.spawnPoints.length, 1);
  assert.deepEqual(layout.spawnPoints[0], layout.landmarks.spawnPoint);
  assert.equal(connectionsForCell(layout.map, 5, 8), 'N---');
  assert.equal(connectionsForCell(layout.map, 5, 7), '-ESW');
  assert.equal(connectionsForCell(layout.map, 4, 7), '-ESW');
  assert.equal(connectionsForCell(layout.map, 4, 8), 'N---');
  assert.equal(connectionsForCell(layout.map, 3, 7), 'NE--');
  assert.equal(connectionsForCell(layout.map, 3, 6), 'N-S-');
  assert.equal(connectionsForCell(layout.map, 3, 5), '--S-');
  assert.deepEqual(layout.tIntersectionDecorations, [
    {
      cellX: 5,
      cellY: 7,
      closedDirection: 'north',
      tileX: 96,
      tileY: 122,
    },
  ]);

  assert.equal(layout.gates.length, 0);
  assert.equal(layout.bridges.length, 1);
  assert.deepEqual(
    {
      cellX: layout.bridges[0].cellX,
      northCellY: layout.bridges[0].northCellY,
      tileX: layout.bridges[0].tileX,
      tileY: layout.bridges[0].tileY,
    },
    { cellX: 3, northCellY: 5, tileX: 62, tileY: 96 },
  );
  assert.ok(layout.bridges[0].safeTileMask > 0);
  assert.deepEqual(layout.swamps, [
    {
      westCellX: 3,
      cellY: 7,
      lengthCells: 2,
      decorationSeed: 0x7475746f,
      tileX: 68,
      tileY: 122,
    },
  ]);
  const swamp = layout.swamps[0];
  const swampMiddleY = (swamp.tileY + 3.5) * 16;
  const swampRightX = (swamp.tileX + 11) * 16;
  let eastShorelineX = null;
  for (let x = swampRightX; x >= swamp.tileX * 16; x--) {
    if (getPlayerSwampTerrain(layout.swamps, x, swampMiddleY, 16) !== 'dry') {
      eastShorelineX = x;
      break;
    }
  }
  assert.ok(eastShorelineX !== null);
  assert.equal(
    getPlayerSwampTerrain(layout.swamps, eastShorelineX + 1, swampMiddleY, 16),
    'dry',
  );
  assert.equal(layout.swordFields.length, 0);
  assert.equal(layout.spikeGateObstacles.length, 0);
  assert.deepEqual(layout.trapCells, [{ cellX: 4, cellY: 8, tileX: 79, tileY: 138 }]);
  assert.deepEqual(layout.chestDeadEnds, [
    {
      cellX: 3,
      cellY: 7,
      tileX: 62,
      tileY: 122,
      openDirection: 'north',
      variant: 'south-east',
      preserveTurnOpenings: true,
      chestCount: 1,
      chestSlot: 0,
    },
  ]);
  assert.deepEqual(
    getChestDeadEndBounds(layout.chestDeadEnds[0], 16).map(({ kind }) => kind),
    ['rock', 'chest'],
  );
});
