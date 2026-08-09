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
  findSwampWisdomHintTarget,
  generateMazeLayout,
  getPlayerSwampTerrain,
  getSwampAuthoringWidth,
  getSwampFirmGroundTiles,
  getSwampTerrainAtAuthoringPoint,
  isPlayerInSwamp,
  isSolidTileId,
} from '../dist/index.js';

test('wisdom targeting reveals the nearest swamp within bridge hint range', () => {
  const swamps = [
    {
      westCellX: 0,
      cellY: 0,
      lengthCells: 3,
      decorationSeed: 101,
      tileX: 10,
      tileY: 20,
    },
    {
      westCellX: 4,
      cellY: 0,
      lengthCells: 2,
      decorationSeed: 202,
      tileX: 40,
      tileY: 20,
    },
  ];
  const tileSize = 16;
  const firstLeft = swamps[0].tileX * tileSize;
  const firstMiddleY = (swamps[0].tileY + 3) * tileSize;

  assert.deepEqual(
    findSwampWisdomHintTarget(swamps, firstLeft - 40, firstMiddleY, tileSize),
    { swampIndex: 0 },
  );
  assert.equal(
    findSwampWisdomHintTarget(swamps, firstLeft - 41, firstMiddleY, tileSize),
    null,
  );
  assert.deepEqual(
    findSwampWisdomHintTarget(
      swamps,
      swamps[1].tileX * tileSize + 8,
      firstMiddleY,
      tileSize,
    ),
    { swampIndex: 1 },
  );
});

test('firm-ground reveal geometry follows the route and preserves mud gaps', () => {
  const swamp = {
    westCellX: 0,
    cellY: 0,
    lengthCells: 5,
    decorationSeed: 303,
    tileX: 0,
    tileY: 0,
  };
  const tiles = getSwampFirmGroundTiles(swamp);

  assert.ok(tiles.length > 0);
  const routeColumns = [...new Set(tiles.map((tile) => tile.tileX))].sort(
    (left, right) => left - right,
  );
  assert.ok(
    routeColumns.some(
      (tileX, index) => index > 0 && tileX > routeColumns[index - 1] + 1,
    ),
    'the revealed route must visibly break across at least one mud tile',
  );
  for (const tile of tiles) {
    assert.equal(tile.width, 16);
    assert.equal(tile.height, 16);
    assert.equal(
      getSwampTerrainAtAuthoringPoint(
        swamp,
        tile.x + tile.width / 2,
        tile.y + tile.height / 2,
      ),
      'firm-ground',
    );
  }
  for (let index = 1; index < tiles.length; index++) {
    const previous = tiles[index - 1];
    const tile = tiles[index];
    const distance =
      Math.abs(tile.tileX - previous.tileX) +
      Math.abs(tile.tileY - previous.tileY);
    assert.ok(
      distance === 1 ||
        (distance === 2 && tile.tileY === previous.tileY),
      'the route must stay connected except for single-tile horizontal mud gaps',
    );
  }
});

test('firm-ground routes include multi-tile vertical turns', () => {
  for (
    let lengthCells = MIN_SWAMP_LENGTH_CELLS;
    lengthCells <= MAX_SWAMP_LENGTH_CELLS;
    lengthCells++
  ) {
    const swamp = {
      westCellX: 0,
      cellY: 0,
      lengthCells,
      decorationSeed: 700 + lengthCells,
      tileX: 0,
      tileY: 0,
    };
    const tiles = getSwampFirmGroundTiles(swamp);
    const rowsByColumn = new Map();
    for (const tile of tiles) {
      const rows = rowsByColumn.get(tile.tileX) ?? [];
      rows.push(tile.tileY);
      rowsByColumn.set(tile.tileX, rows);
    }
    const verticalTurns = [...rowsByColumn.values()].filter(
      (rows) => Math.max(...rows) - Math.min(...rows) >= 2,
    );
    assert.ok(
      verticalTurns.length >= 1,
      `${lengthCells}-cell route needs a turn spanning at least two tiles vertically`,
    );
    if (lengthCells >= 3) {
      assert.ok(
        verticalTurns.length >= 2,
        `${lengthCells}-cell route needs multiple multi-tile vertical turns`,
      );
    }
  }
});

test('firm-ground route shapes vary by seed instead of repeating a fixed wave', () => {
  const signatures = new Set();
  const turnSpacingSignatures = new Set();

  for (let decorationSeed = 900; decorationSeed < 920; decorationSeed++) {
    const swamp = {
      westCellX: 0,
      cellY: 0,
      lengthCells: 5,
      decorationSeed,
      tileX: 0,
      tileY: 0,
    };
    const tiles = getSwampFirmGroundTiles(swamp);
    signatures.add(
      tiles.map((tile) => `${tile.tileX}:${tile.tileY}`).join('|'),
    );

    const rowsByColumn = new Map();
    for (const tile of tiles) {
      const rows = rowsByColumn.get(tile.tileX) ?? new Set();
      rows.add(tile.tileY);
      rowsByColumn.set(tile.tileX, rows);
    }
    const turns = [...rowsByColumn.entries()]
      .filter(([, rows]) => rows.size >= 2)
      .map(([tileX]) => tileX)
      .sort((left, right) => left - right);
    turnSpacingSignatures.add(
      turns.slice(1).map((turn, index) => turn - turns[index]).join(','),
    );
  }

  assert.equal(signatures.size, 20, 'every tested seed should produce a distinct route');
  assert.ok(
    turnSpacingSignatures.size >= 16,
    'turn spacing should vary substantially between generated swamps',
  );
});

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

test('hidden firm-ground paths contain mandatory deep-mud breaks', () => {
  for (
    let lengthCells = MIN_SWAMP_LENGTH_CELLS;
    lengthCells <= MAX_SWAMP_LENGTH_CELLS;
    lengthCells++
  ) {
    const swamp = {
      westCellX: 0,
      cellY: 0,
      lengthCells,
      decorationSeed: 123 + lengthCells,
      tileX: 0,
      tileY: 0,
    };
    const widthTiles = getSwampAuthoringWidth(lengthCells) / 16;
    const tileContainsFirmGround = [];

    for (let tileIndex = 0; tileIndex < widthTiles; tileIndex++) {
      let containsFirmGround = false;
      for (let y = 0; y < 96 && !containsFirmGround; y++) {
        for (let x = tileIndex * 16; x < (tileIndex + 1) * 16; x++) {
          if (getSwampTerrainAtAuthoringPoint(swamp, x, y) === 'firm-ground') {
            containsFirmGround = true;
            break;
          }
        }
      }
      tileContainsFirmGround.push(containsFirmGround);
    }

    const interruptedTiles = tileContainsFirmGround.filter(
      (containsFirmGround, tileIndex) =>
        tileIndex >= 2 &&
        tileIndex < widthTiles - 2 &&
        !containsFirmGround &&
        tileContainsFirmGround[tileIndex - 1] &&
        tileContainsFirmGround[tileIndex + 1],
    );
    assert.ok(interruptedTiles.length >= 1, `${lengthCells}-cell swamp needs a mud break`);
  }
});

test('firm ground restores normal speed while deep mud moves at quarter speed', () => {
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

  const findTerrainPoint = (terrain) => {
    for (let x = 32; x < getSwampAuthoringWidth(swamp.lengthCells) - 32; x++) {
      for (let y = 24; y < 80; y++) {
        if (getPlayerSwampTerrain(swamps, x, y + 1, map.tileSize) === terrain) {
          return { x, y: y + 1 };
        }
      }
    }
    throw new Error(`Unable to find ${terrain}`);
  };

  const firmStart = findTerrainPoint('firm-ground');
  const firmResult = applyInputWithCollision(
    firmStart.x,
    firmStart.y,
    input,
    0.1,
    map,
    null,
    [],
    [],
    swamps,
  );
  assert.equal(firmResult.x - firmStart.x, PLAYER_SPEED * 0.1);

  const deepMudStart = findTerrainPoint('deep-mud');
  const deepMudResult = applyInputWithCollision(
    deepMudStart.x,
    deepMudStart.y,
    input,
    0.1,
    map,
    null,
    [],
    [],
    swamps,
  );
  assert.equal(SWAMP_SPEED_MULTIPLIER, 0.25);
  assert.equal(
    deepMudResult.x - deepMudStart.x,
    PLAYER_SPEED * SWAMP_SPEED_MULTIPLIER * 0.1,
  );

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
