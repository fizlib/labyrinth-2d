import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CELL_SIZE,
  CELL_STEP_X,
  CELL_STEP_Y,
  GRID_CELLS,
  T_INTERSECTION_DECORATION_DENSITY,
  TILE_FLOOR,
  TILE_FLOOR_SHADOW,
  WALL_HEIGHT,
  WALL_WIDTH,
  computePortalPosition,
  computeTIntersectionDecorationPlacements,
  generateMazeLayout,
  getTIntersectionDecorationBounds,
  isPositionValid,
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

test('decorative ruins select deterministic unoccupied north- and south-closed T-junctions', () => {
  assert.equal(T_INTERSECTION_DECORATION_DENSITY, 0.85);

  for (const seed of [1, 2, 44, 99, 123456]) {
    const first = generateMazeLayout(seed, 10, 3);
    const second = generateMazeLayout(seed, 10, 3);
    assert.deepEqual(first.tIntersectionDecorations, second.tIntersectionDecorations);

    const portal = computePortalPosition(
      first.map.data,
      10,
      first.bridges,
      first.swamps,
      first.chestDeadEnds,
      first.swordFields,
    );
    assert.deepEqual(
      first.tIntersectionDecorations,
      computeTIntersectionDecorationPlacements(
        first.map.data,
        first.spawnPoints,
        first.gates,
        first.bridges,
        first.swamps,
        first.swordFields,
        first.chestDeadEnds,
        portal,
        seed,
      ),
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
    for (const sword of first.swordFields) {
      occupied.add(`${sword.westCellX},${sword.cellY}`);
      occupied.add(`${sword.westCellX + 1},${sword.cellY}`);
    }
    for (const chest of first.chestDeadEnds) {
      occupied.add(`${chest.cellX},${chest.cellY}`);
    }
    const decorationFootprints = new Set();
    const footprintOffsets = [
      [0, 0],
      [-1, 0],
      [1, 0],
      [0, 1],
    ];
    for (const placement of first.tIntersectionDecorations) {
      const expectedConnections = placement.closedDirection === 'north' ? '-ESW' : 'NE-W';
      assert.equal(
        connectionsForCell(first.map, placement.cellX, placement.cellY),
        expectedConnections,
      );
      assert.equal(placement.tileX, WALL_WIDTH + placement.cellX * CELL_STEP_X);
      assert.equal(placement.tileY, WALL_HEIGHT + placement.cellY * CELL_STEP_Y);

      const orientedFootprintOffsets = footprintOffsets.map(([offsetX, offsetY]) => [
        offsetX,
        placement.closedDirection === 'south' ? -offsetY : offsetY,
      ]);
      for (const [offsetX, offsetY] of orientedFootprintOffsets) {
        const footprintCellX = placement.cellX + offsetX;
        const footprintCellY = placement.cellY + offsetY;
        const footprintKey = `${footprintCellX},${footprintCellY}`;
        assert.equal(occupied.has(footprintKey), false);
        assert.equal(decorationFootprints.has(footprintKey), false);
        decorationFootprints.add(footprintKey);

        const footprintTileX = WALL_WIDTH + footprintCellX * CELL_STEP_X;
        const footprintTileY = WALL_HEIGHT + footprintCellY * CELL_STEP_Y;
        for (let dy = 0; dy < CELL_SIZE; dy++) {
          for (let dx = 0; dx < CELL_SIZE; dx++) {
            assert.ok(
              isWalkable(
                first.map.data[
                  (footprintTileY + dy) * first.map.width + footprintTileX + dx
                ],
              ),
            );
          }
        }
      }
    }
  }

  const fixture = generateMazeLayout(44, 10, 3);
  assert.ok(fixture.chestDeadEnds.some(({ cellX, cellY }) => cellX === 3 && cellY === 6));
  assert.ok(fixture.chestDeadEnds.some(({ cellX, cellY }) => cellX === 5 && cellY === 6));
  assert.equal(
    fixture.tIntersectionDecorations.some(
      ({ cellX, cellY }) => cellX === 4 && cellY === 6,
    ),
    false,
    'seed-44 must omit the prefab because its west and east cells contain chests',
  );
});

test('either expanded prefab is skipped when any neighboring footprint cell is occupied', () => {
  const seed = 1;
  const layout = generateMazeLayout(seed, 10, 3);
  const portal = computePortalPosition(
    layout.map.data,
    10,
    layout.bridges,
    layout.swamps,
    layout.chestDeadEnds,
    layout.swordFields,
  );

  for (const closedDirection of ['north', 'south']) {
    const candidate = layout.tIntersectionDecorations.find(
      (placement) => placement.closedDirection === closedDirection,
    );
    assert.ok(candidate, `seed ${seed} must contain a ${closedDirection}-closed fixture`);
    const neighboringOffsets = [
      [-1, 0],
      [1, 0],
      [0, closedDirection === 'north' ? 1 : -1],
    ];

    for (const [offsetX, offsetY] of neighboringOffsets) {
      const occupiedCellX = candidate.cellX + offsetX;
      const occupiedCellY = candidate.cellY + offsetY;
      const placements = computeTIntersectionDecorationPlacements(
        layout.map.data,
        layout.spawnPoints,
        [...layout.gates, { cellX: occupiedCellX, cellY: occupiedCellY }],
        layout.bridges,
        layout.swamps,
        layout.swordFields,
        layout.chestDeadEnds,
        portal,
        seed,
      );
      assert.equal(
        placements.some(
          (placement) =>
            placement.cellX === candidate.cellX &&
            placement.cellY === candidate.cellY &&
            placement.closedDirection === closedDirection,
        ),
        false,
        `occupied ${closedDirection} footprint cell ${occupiedCellX},${occupiedCellY} must suppress the whole prefab`,
      );
    }
  }
});

test('every maze with a valid candidate contains a supported decorated T-junction', () => {
  const seenDirections = new Set();
  for (let seed = 1; seed <= 500; seed++) {
    const layout = generateMazeLayout(seed, 10, 3);
    const portal = computePortalPosition(
      layout.map.data,
      10,
      layout.bridges,
      layout.swamps,
      layout.chestDeadEnds,
      layout.swordFields,
    );
    const compatible = computeTIntersectionDecorationPlacements(
      layout.map.data,
      layout.spawnPoints,
      layout.gates,
      layout.bridges,
      layout.swamps,
      layout.swordFields,
      layout.chestDeadEnds,
      portal,
      seed,
      1,
    );
    if (compatible.length > 0) {
      assert.ok(
        layout.tIntersectionDecorations.length > 0,
        `seed ${seed} must select at least one compatible T-junction`,
      );
    }
    for (const placement of layout.tIntersectionDecorations) {
      seenDirections.add(placement.closedDirection);
      assert.equal(
        connectionsForCell(layout.map, placement.cellX, placement.cellY),
        placement.closedDirection === 'north' ? '-ESW' : 'NE-W',
      );
    }
  }
  assert.deepEqual([...seenDirections].sort(), ['north', 'south']);
});

test('both authored orientations use solid-object colliders that block player feet', () => {
  const map = {
    width: 20,
    height: 20,
    tileSize: 16,
    data: new Array(20 * 20).fill(TILE_FLOOR),
  };
  const expectedByDirection = {
    north: [
      { kind: 'signpost', x: 67, y: 22, width: 5, height: 9 },
      { kind: 'bush', x: 45, y: 20, width: 19, height: 12 },
      { kind: 'bush', x: -70, y: 13, width: 19, height: 12 },
      { kind: 'bush', x: -46, y: 69, width: 21, height: 12 },
      { kind: 'bush', x: 8, y: 144, width: 21, height: 12 },
      { kind: 'bush', x: 145, y: 66, width: 19, height: 18 },
      { kind: 'rock', x: 69, y: 114, width: 14, height: 14 },
    ],
    south: [
      { kind: 'signpost', x: 71, y: 22, width: 5, height: 9 },
      { kind: 'bush', x: 102, y: 18, width: 19, height: 12 },
      { kind: 'bush', x: -63, y: 16, width: 19, height: 12 },
      { kind: 'bush', x: 11, y: 71, width: 21, height: 12 },
      { kind: 'bush', x: -47, y: 74, width: 19, height: 12 },
    ],
  };

  for (const closedDirection of ['north', 'south']) {
    const placement = { cellX: 0, cellY: 0, closedDirection, tileX: 4, tileY: 4 };
    const anchorX = placement.tileX * map.tileSize;
    const anchorY = placement.tileY * map.tileSize;
    const bounds = getTIntersectionDecorationBounds(placement, map.tileSize);

    assert.deepEqual(
      bounds.map(({ kind, left, top, right, bottom }) => ({
        kind,
        x: left - anchorX,
        y: top - anchorY,
        width: right - left + 1,
        height: bottom - top + 1,
      })),
      expectedByDirection[closedDirection],
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
          [placement],
        ),
        false,
        `${closedDirection} ${obstacle.kind} collider must block the player`,
      );
    }
  }
});
