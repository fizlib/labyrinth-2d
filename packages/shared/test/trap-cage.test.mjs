import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CELL_SIZE,
  CELL_STEP_X,
  CELL_STEP_Y,
  MAX_TRAP_CELLS,
  MIN_TRAP_CELLS,
  TILE_FLOOR,
  TILE_FLOOR_SHADOW,
  applyInputWithCollision,
  findOpenableCage,
  findTrapCellInteractionTarget,
  generateMazeLayout,
  getCageCollisionBounds,
  getCageSeparationPositions,
  getTrapCellPlacementAtWorldPoint,
  getTrapCellWorldBounds,
  isPlayerInTrapCell,
  isPositionValid,
  WALL_HEIGHT,
  WALL_WIDTH,
} from '../dist/index.js';

test('trap cells are deterministic, complete 6x6 floors, and avoid solid authored placements', () => {
  for (const seed of [1, 2, 44, 99, 123456]) {
    const first = generateMazeLayout(seed, 10, 3);
    const second = generateMazeLayout(seed, 10, 3);
    assert.deepEqual(first.trapCells, second.trapCells);
    assert.ok(first.trapCells.length >= MIN_TRAP_CELLS);
    assert.ok(first.trapCells.length <= MAX_TRAP_CELLS);

    const trapKeys = new Set(
      first.trapCells.map(({ cellX, cellY }) => `${cellX},${cellY}`),
    );
    assert.equal(trapKeys.size, first.trapCells.length);

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
    for (const sword of first.swordFields) {
      occupied.add(`${sword.westCellX},${sword.cellY}`);
      occupied.add(`${sword.westCellX + 1},${sword.cellY}`);
    }
    for (const spikeGate of first.spikeGateObstacles) {
      occupied.add(`${spikeGate.cellX},${spikeGate.cellY}`);
      occupied.add(
        `${spikeGate.cellX + (spikeGate.orientation === 'horizontal' ? 1 : 0)},${spikeGate.cellY + (spikeGate.orientation === 'vertical' ? 1 : 0)}`,
      );
    }
    for (const chest of first.chestDeadEnds)
      occupied.add(`${chest.cellX},${chest.cellY}`);
    for (const trap of first.trapCells) {
      assert.equal(occupied.has(`${trap.cellX},${trap.cellY}`), false);
      for (let dy = 0; dy < CELL_SIZE; dy++) {
        for (let dx = 0; dx < CELL_SIZE; dx++) {
          const tile =
            first.map.data[(trap.tileY + dy) * first.map.width + trap.tileX + dx];
          assert.ok(tile === TILE_FLOOR || tile === TILE_FLOOR_SHADOW);
        }
      }
    }
  }
});

test('trap cells may share the center of a decorated T-junction', () => {
  const layout = generateMazeLayout(7, 10, 3);
  const trapKeys = new Set(
    layout.trapCells.map(({ cellX, cellY }) => `${cellX},${cellY}`),
  );
  assert.ok(
    layout.tIntersectionDecorations.some(({ cellX, cellY }) =>
      trapKeys.has(`${cellX},${cellY}`),
    ),
  );
});

test('trap membership and interaction use the full cell rectangle', () => {
  const placement = { cellX: 0, cellY: 0, tileX: 10, tileY: 20 };
  const bounds = getTrapCellWorldBounds(placement, 16);
  assert.equal(isPlayerInTrapCell(placement, bounds.left, bounds.top + 1, 16), true);
  assert.equal(isPlayerInTrapCell(placement, bounds.right, bounds.bottom + 1, 16), true);
  assert.equal(
    isPlayerInTrapCell(placement, bounds.right + 1, bounds.bottom + 1, 16),
    false,
  );

  assert.deepEqual(
    findTrapCellInteractionTarget([placement], bounds.right + 20, bounds.bottom, 16),
    { trapCellIndex: 0, distanceSquared: 400 },
  );
  assert.equal(
    findTrapCellInteractionTarget([placement], bounds.right + 21, bounds.bottom, 16),
    null,
  );
});

test('world positions resolve only to the 6x6 maze cell under the player feet', () => {
  const tileSize = 16;
  const cellX = 3;
  const cellY = 4;
  const tileX = WALL_WIDTH + cellX * CELL_STEP_X;
  const tileY = WALL_HEIGHT + cellY * CELL_STEP_Y;

  assert.deepEqual(
    getTrapCellPlacementAtWorldPoint(
      (tileX + CELL_SIZE - 0.5) * tileSize,
      (tileY + CELL_SIZE - 0.5) * tileSize,
      tileSize,
    ),
    { cellX, cellY, tileX, tileY },
  );
  assert.equal(
    getTrapCellPlacementAtWorldPoint(
      (tileX + CELL_SIZE + 0.5) * tileSize,
      (tileY + 2.5) * tileSize,
      tileSize,
    ),
    null,
    'the wall/passage band between logical cells is not itself a trap cell',
  );
});

test('closed cages immobilize prisoners, opened cages allow only vertical escape', () => {
  const map = {
    width: 30,
    height: 30,
    tileSize: 16,
    data: new Array(30 * 30).fill(TILE_FLOOR),
  };
  const cage = {
    cageId: 0,
    prisonerPlayerId: 'survivor',
    x: 160,
    y: 160,
    opened: false,
    vacated: false,
  };
  const input = { up: true, down: false, left: true, right: false };

  assert.deepEqual(
    applyInputWithCollision(
      160,
      160,
      input,
      0.1,
      map,
      null,
      [],
      [],
      [],
      [],
      [],
      [],
      [cage],
      'survivor',
    ),
    { x: 160, y: 160 },
  );

  cage.opened = true;
  assert.deepEqual(
    applyInputWithCollision(
      160,
      160,
      input,
      0.1,
      map,
      null,
      [],
      [],
      [],
      [],
      [],
      [],
      [cage],
      'survivor',
    ),
    { x: 160, y: 152 },
  );
});

test('cages block outsiders and only a nearby different player may open one', () => {
  const map = {
    width: 30,
    height: 30,
    tileSize: 16,
    data: new Array(30 * 30).fill(TILE_FLOOR),
  };
  const cage = {
    cageId: 4,
    prisonerPlayerId: 'survivor',
    x: 160,
    y: 160,
    opened: false,
    vacated: false,
  };

  assert.deepEqual(getCageCollisionBounds(cage), {
    left: 151,
    top: 148,
    right: 168,
    bottom: 161,
  });

  const centeredSeparation = getCageSeparationPositions(cage, 160, 160, 8, 12);
  assert.deepEqual(centeredSeparation[0], { x: 160, y: 146 });
  assert.equal(
    isPositionValid(
      centeredSeparation[0].x,
      centeredSeparation[0].y,
      map,
      null,
      [],
      [],
      [],
      [],
      [],
      [cage],
      'warden',
    ),
    true,
  );
  assert.deepEqual(getCageSeparationPositions(cage, 150, 160, 8, 12)[0], {
    x: 145,
    y: 160,
  });
  assert.deepEqual(getCageSeparationPositions(cage, 140, 160, 8, 12), []);

  assert.deepEqual(
    applyInputWithCollision(
      140,
      160,
      { up: false, down: false, left: false, right: true },
      0.1,
      map,
      null,
      [],
      [],
      [],
      [],
      [],
      [],
      [cage],
      'helper',
    ),
    { x: 140, y: 160 },
  );
  assert.equal(findOpenableCage([cage], 'survivor', 160, 152), null);
  assert.equal(findOpenableCage([cage], 'helper', 160, 152)?.cage.cageId, 4);
  assert.equal(findOpenableCage([cage], 'helper', 200, 152), null);
});
