import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CELL_SIZE,
  CELL_STEP_X,
  CELL_STEP_Y,
  GRID_CELLS,
  MAX_SPIKE_GATE_OBSTACLES,
  MIN_SPIKE_GATE_OBSTACLES,
  SPIKE_GATES_PER_OBSTACLE,
  SPIKE_GATE_COLUMN_STRIDE,
  SPIKE_GATE_TERRAIN_COLUMNS,
  SPIKE_GATE_VERTICAL_STRIDE,
  SPIKE_GATE_VERTICAL_TERRAIN_ROWS,
  TILE_FLOOR,
  TILE_FLOOR_SHADOW,
  WALL_HEIGHT,
  WALL_WIDTH,
  generateMazeLayout,
  getSpikeGateBarrierOffset,
  getSpikeGateCollisionBounds,
  getSpikeGatePlatePlacements,
  getSpikeGateStateIndex,
  isPositionValid,
} from '../dist/index.js';

function areTestCellsConnected(data, mapWidth, cx1, cy1, cx2, cy2) {
  const tx1 = WALL_WIDTH + cx1 * CELL_STEP_X;
  const ty1 = WALL_HEIGHT + cy1 * CELL_STEP_Y;
  if (cy1 === cy2) {
    const tx2 = WALL_WIDTH + cx2 * CELL_STEP_X;
    const wallX = Math.min(tx1, tx2) + CELL_SIZE;
    for (let y = 0; y < CELL_SIZE; y++) {
      for (let x = 0; x < WALL_WIDTH; x++) {
        const tile = data[(ty1 + y) * mapWidth + wallX + x];
        if (tile === TILE_FLOOR || tile === TILE_FLOOR_SHADOW) return true;
      }
    }
    return false;
  }

  const ty2 = WALL_HEIGHT + cy2 * CELL_STEP_Y;
  const wallY = Math.min(ty1, ty2) + CELL_SIZE;
  for (let y = 0; y < WALL_HEIGHT; y++) {
    for (let x = 0; x < CELL_SIZE; x++) {
      const tile = data[(wallY + y) * mapWidth + tx1 + x];
      if (tile === TILE_FLOOR || tile === TILE_FLOOR_SHADOW) return true;
    }
  }
  return false;
}

function getObstacleCellKeys(obstacle) {
  return obstacle.orientation === 'horizontal'
    ? [`${obstacle.cellX},${obstacle.cellY}`, `${obstacle.cellX + 1},${obstacle.cellY}`]
    : [`${obstacle.cellX},${obstacle.cellY}`, `${obstacle.cellX},${obstacle.cellY + 1}`];
}

function getExpectedGateCount(map, obstacle) {
  const secondCellX = obstacle.cellX + (obstacle.orientation === 'horizontal' ? 1 : 0);
  const secondCellY = obstacle.cellY + (obstacle.orientation === 'vertical' ? 1 : 0);
  if (obstacle.orientation === 'horizontal') {
    const continuesEast =
      secondCellX < GRID_CELLS - 1 &&
      areTestCellsConnected(
        map.data,
        map.width,
        secondCellX,
        secondCellY,
        secondCellX + 1,
        secondCellY,
      );
    const opensNorth =
      secondCellY > 0 &&
      areTestCellsConnected(
        map.data,
        map.width,
        secondCellX,
        secondCellY,
        secondCellX,
        secondCellY - 1,
      );
    const opensSouth =
      secondCellY < GRID_CELLS - 1 &&
      areTestCellsConnected(
        map.data,
        map.width,
        secondCellX,
        secondCellY,
        secondCellX,
        secondCellY + 1,
      );
    return continuesEast && !opensNorth && !opensSouth ? 3 : 2;
  }

  return 3;
}

test('spike-gate chains are deterministic and avoid existing solid obstacle cells', () => {
  const generatedOrientations = new Set();
  for (const seed of [0, 1, 2, 44, 99, 123456]) {
    const first = generateMazeLayout(seed, 10, 3);
    const second = generateMazeLayout(seed, 10, 3);
    assert.deepEqual(first.spikeGateObstacles, second.spikeGateObstacles);
    assert.ok(first.spikeGateObstacles.length >= MIN_SPIKE_GATE_OBSTACLES);
    assert.ok(first.spikeGateObstacles.length <= MAX_SPIKE_GATE_OBSTACLES);
    assert.ok(
      first.spikeGateObstacles.some((obstacle) => obstacle.orientation === 'vertical'),
      `seed ${seed} should retain an eligible straight vertical obstacle`,
    );

    const occupied = new Set();
    for (const gate of first.gates) occupied.add(`${gate.cellX},${gate.cellY}`);
    for (const bridge of first.bridges) {
      occupied.add(`${bridge.cellX},${bridge.northCellY}`);
      occupied.add(`${bridge.cellX},${bridge.northCellY + 1}`);
    }
    for (const swamp of first.swamps) {
      for (let offset = 0; offset < swamp.lengthCells; offset++) {
        occupied.add(`${swamp.westCellX + offset},${swamp.cellY}`);
      }
    }
    for (const field of first.swordFields) {
      occupied.add(`${field.westCellX},${field.cellY}`);
      occupied.add(`${field.westCellX + 1},${field.cellY}`);
    }
    for (const chest of first.chestDeadEnds) {
      occupied.add(`${chest.cellX},${chest.cellY}`);
    }

    for (const obstacle of first.spikeGateObstacles) {
      generatedOrientations.add(obstacle.orientation);
      assert.equal(obstacle.gateCount, getExpectedGateCount(first.map, obstacle));
      if (obstacle.orientation === 'vertical') {
        assert.equal(obstacle.tileY, WALL_HEIGHT + obstacle.cellY * CELL_STEP_Y + CELL_SIZE + 5);
        for (const cellY of [obstacle.cellY, obstacle.cellY + 1]) {
          const opensWest =
            obstacle.cellX > 0 &&
            areTestCellsConnected(
              first.map.data,
              first.map.width,
              obstacle.cellX,
              cellY,
              obstacle.cellX - 1,
              cellY,
            );
          const opensEast =
            obstacle.cellX < GRID_CELLS - 1 &&
            areTestCellsConnected(
              first.map.data,
              first.map.width,
              obstacle.cellX,
              cellY,
              obstacle.cellX + 1,
              cellY,
            );
          assert.equal(opensWest || opensEast, false);
        }
      }
      const cellKeys = getObstacleCellKeys(obstacle);
      assert.equal(cellKeys.some((key) => occupied.has(key)), false);
      for (const key of cellKeys) occupied.add(key);
    }
  }
  assert.deepEqual([...generatedOrientations].sort(), ['horizontal', 'vertical']);
});

test('three gates preserve the exported collider and one grass column between terrain stamps', () => {
  const placement = {
    orientation: 'horizontal',
    cellX: 0,
    cellY: 0,
    tileX: 10,
    tileY: 20,
    gateCount: 3,
  };
  const anchorX = placement.tileX * 16;
  const anchorY = placement.tileY * 16;
  const bounds = Array.from({ length: SPIKE_GATES_PER_OBSTACLE }, (_, gateIndex) =>
    getSpikeGateCollisionBounds(placement, gateIndex, 16),
  );

  assert.deepEqual(
    bounds.map(({ left, top, right, bottom }) => ({
      x: left - anchorX,
      y: top - anchorY,
      width: right - left + 1,
      height: bottom - top + 1,
    })),
    [
      { x: 27, y: 0, width: 13, height: 95 },
      { x: 107, y: 0, width: 13, height: 95 },
      { x: 187, y: 0, width: 13, height: 95 },
    ],
  );
  assert.equal(
    SPIKE_GATE_COLUMN_STRIDE,
    SPIKE_GATE_TERRAIN_COLUMNS * 16 + 16,
  );
});

test('each gate has two nearest plates and only its own state index', () => {
  const placement = {
    orientation: 'horizontal',
    cellX: 0,
    cellY: 0,
    tileX: 10,
    tileY: 20,
    gateCount: 3,
  };
  const anchorX = placement.tileX * 16;
  const anchorY = placement.tileY * 16;
  const plates = getSpikeGatePlatePlacements(placement, 0, 16);

  assert.deepEqual(
    plates.map((plate) => ({
      gateIndex: plate.gateIndex,
      side: plate.side,
      x: plate.x - anchorX,
      y: plate.y - anchorY,
    })),
    [
      { gateIndex: 0, side: 'west', x: 0, y: 16 },
      { gateIndex: 0, side: 'east', x: 51, y: 64 },
      { gateIndex: 1, side: 'west', x: 80, y: 16 },
      { gateIndex: 1, side: 'east', x: 131, y: 64 },
      { gateIndex: 2, side: 'west', x: 160, y: 16 },
      { gateIndex: 2, side: 'east', x: 211, y: 64 },
    ],
  );
  assert.deepEqual(
    plates.map((plate) => plate.spikePlateIndex),
    [0, 1, 2, 3, 4, 5],
  );
});

test('vertical gates use the upper yellow slot and reduced export-70 collider', () => {
  const placement = {
    orientation: 'vertical',
    cellX: 0,
    cellY: 0,
    tileX: 10,
    tileY: 20,
    gateCount: 3,
  };
  const anchorX = placement.tileX * 16;
  const anchorY = placement.tileY * 16;
  const bounds = Array.from({ length: SPIKE_GATES_PER_OBSTACLE }, (_, gateIndex) =>
    getSpikeGateCollisionBounds(placement, gateIndex, 16),
  );
  assert.deepEqual(
    bounds.map(({ left, top, right, bottom }) => ({
      x: left - anchorX,
      y: top - anchorY,
      width: right - left + 1,
      height: bottom - top + 1,
    })),
    [
      { x: 1, y: 19, width: 95, height: 9 },
      { x: 1, y: 83, width: 95, height: 9 },
      { x: 1, y: -45, width: 95, height: 9 },
    ],
  );
  assert.deepEqual(
    Array.from({ length: SPIKE_GATES_PER_OBSTACLE }, (_, gateIndex) =>
      getSpikeGateBarrierOffset(placement, gateIndex),
    ),
    [0, 64, -64],
  );
  assert.equal(
    SPIKE_GATE_VERTICAL_STRIDE,
    SPIKE_GATE_VERTICAL_TERRAIN_ROWS * 16 + 16,
  );

  const plates = getSpikeGatePlatePlacements(placement, 0, 16);
  assert.deepEqual(
    plates.map((plate) => ({
      gateIndex: plate.gateIndex,
      side: plate.side,
      x: plate.x - anchorX,
      y: plate.y - anchorY,
    })),
    [
      { gateIndex: 0, side: 'north', x: 64, y: -11 },
      { gateIndex: 0, side: 'south', x: 16, y: 40 },
      { gateIndex: 1, side: 'north', x: 64, y: 53 },
      { gateIndex: 1, side: 'south', x: 16, y: 104 },
      { gateIndex: 2, side: 'north', x: 64, y: -75 },
      { gateIndex: 2, side: 'south', x: 16, y: -24 },
    ],
  );
});

test('short horizontal corridors omit the third gate and its plates', () => {
  const placement = {
    orientation: 'horizontal',
    cellX: 0,
    cellY: 0,
    tileX: 10,
    tileY: 20,
    gateCount: 2,
  };
  const plates = getSpikeGatePlatePlacements(placement, 0, 16);
  assert.equal(plates.length, 4);
  assert.deepEqual(
    [...new Set(plates.map((plate) => plate.gateIndex))],
    [0, 1],
  );
});

test('only an open spike-gate state removes that gate collider', () => {
  const map = {
    width: 40,
    height: 40,
    tileSize: 16,
    data: new Array(40 * 40).fill(TILE_FLOOR),
  };
  const placement = {
    orientation: 'horizontal',
    cellX: 0,
    cellY: 0,
    tileX: 10,
    tileY: 20,
    gateCount: 3,
  };
  const gateIndex = 1;
  const barrier = getSpikeGateCollisionBounds(placement, gateIndex, 16);
  const x = (barrier.left + barrier.right) / 2;
  const y = barrier.bottom + 1;
  const closedStates = Array.from({ length: 3 }, (_, index) => ({
    spikeGateIndex: getSpikeGateStateIndex(0, index),
    open: false,
  }));
  const openStates = closedStates.map((state) => ({
    ...state,
    open: state.spikeGateIndex === getSpikeGateStateIndex(0, gateIndex),
  }));

  assert.equal(
    isPositionValid(
      x,
      y,
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
      [],
      [placement],
      closedStates,
    ),
    false,
  );
  assert.equal(
    isPositionValid(
      x,
      y,
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
      [],
      [placement],
      openStates,
    ),
    true,
  );
});
