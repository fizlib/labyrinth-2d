import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CELL_SIZE,
  CELL_STEP_X,
  CELL_STEP_Y,
  MAX_SWAMP_LENGTH_CELLS,
  MIN_SWAMP_LENGTH_CELLS,
  PLAYER_SPEED,
  SWAMP_SPEED_MULTIPLIER,
  TILE_FLOOR,
  WALL_HEIGHT,
  WALL_WIDTH,
  applyInputWithCollision,
  generateMazeLayout,
  getSwampAuthoringWidth,
  isPlayerInSwamp,
  isSolidTileId,
} from '../dist/index.js';

test('generated swamps deterministically occupy distinct open horizontal passages', () => {
  const first = generateMazeLayout(44, 10, 3);
  const second = generateMazeLayout(44, 10, 3);
  assert.deepEqual(first.swamps, second.swamps);
  assert.ok(first.swamps.length >= 4 && first.swamps.length <= 10);
  assert.ok(
    first.swamps.some((swamp) => swamp.westCellX === 2 && swamp.cellY === 5),
    'seed-44 must retain the style-editor swamp fixture',
  );
  assert.equal(
    new Set(first.swamps.map((swamp) => swamp.decorationSeed)).size,
    first.swamps.length,
  );

  const occupiedCells = new Set();
  const bridgeCells = new Set();
  for (const bridge of first.bridges) {
    bridgeCells.add(`${bridge.cellX},${bridge.northCellY}`);
    bridgeCells.add(`${bridge.cellX},${bridge.northCellY + 1}`);
  }

  for (const swamp of first.swamps) {
    assert.ok(swamp.lengthCells >= MIN_SWAMP_LENGTH_CELLS);
    assert.ok(swamp.lengthCells <= MAX_SWAMP_LENGTH_CELLS);
    assert.equal(swamp.tileX, WALL_WIDTH + swamp.westCellX * CELL_STEP_X + CELL_SIZE);
    assert.equal(swamp.tileY, WALL_HEIGHT + swamp.cellY * CELL_STEP_Y);

    for (let offset = 0; offset < swamp.lengthCells; offset++) {
      const cellKey = `${swamp.westCellX + offset},${swamp.cellY}`;
      assert.equal(occupiedCells.has(cellKey), false);
      assert.equal(bridgeCells.has(cellKey), false);
      occupiedCells.add(cellKey);
    }

    const widthTiles = WALL_WIDTH + (swamp.lengthCells - 2) * CELL_STEP_X;
    for (let dy = 0; dy < CELL_SIZE; dy++) {
      for (let dx = 0; dx < widthTiles; dx++) {
        const tile =
          first.map.data[(swamp.tileY + dy) * first.map.width + swamp.tileX + dx];
        assert.equal(isSolidTileId(tile), false);
      }
    }
  }
});

test('long eligible corridors strongly favor swamps longer than two cells', () => {
  const lengthCounts = new Map();
  for (let seed = 0; seed < 100; seed++) {
    for (const swamp of generateMazeLayout(seed, 10, 3).swamps) {
      lengthCounts.set(swamp.lengthCells, (lengthCounts.get(swamp.lengthCells) ?? 0) + 1);
    }
  }

  const twoCellCount = lengthCounts.get(2) ?? 0;
  const longerCount =
    (lengthCounts.get(3) ?? 0) +
    (lengthCounts.get(4) ?? 0) +
    (lengthCounts.get(5) ?? 0);
  assert.ok(longerCount > twoCellCount * 2);
  assert.ok((lengthCounts.get(MAX_SWAMP_LENGTH_CELLS) ?? 0) > 0);
});

test('the authored shoreline controls wet state and halves movement speed', () => {
  const swamp = {
    westCellX: 0,
    cellY: 0,
    lengthCells: 2,
    decorationSeed: 123,
    tileX: 0,
    tileY: 0,
  };
  const swamps = [swamp];
  const map = {
    width: 30,
    height: 20,
    tileSize: 16,
    data: new Array(30 * 20).fill(TILE_FLOOR),
  };
  const input = { up: false, down: false, left: false, right: true };

  assert.equal(isPlayerInSwamp(swamps, 80, 49, map.tileSize), true);
  assert.equal(isPlayerInSwamp(swamps, 2, 49, map.tileSize), false);
  assert.equal(isPlayerInSwamp(swamps, 80, 5, map.tileSize), false);

  const longSwamp = { ...swamp, lengthCells: 5 };
  assert.equal(
    isPlayerInSwamp([longSwamp], getSwampAuthoringWidth(5) - 40, 49, map.tileSize),
    true,
  );
  assert.equal(isPlayerInSwamp([longSwamp], getSwampAuthoringWidth(5) + 1, 49), false);

  const wetStart = { x: 80, y: 49 };
  const wetResult = applyInputWithCollision(
    wetStart.x,
    wetStart.y,
    input,
    0.1,
    map,
    null,
    [],
    [],
    swamps,
  );
  assert.equal(wetResult.x - wetStart.x, PLAYER_SPEED * SWAMP_SPEED_MULTIPLIER * 0.1);

  const dryStart = { x: 80, y: 150 };
  const dryResult = applyInputWithCollision(
    dryStart.x,
    dryStart.y,
    input,
    0.1,
    map,
    null,
    [],
    [],
    swamps,
  );
  assert.equal(dryResult.x - dryStart.x, PLAYER_SPEED * 0.1);
});
