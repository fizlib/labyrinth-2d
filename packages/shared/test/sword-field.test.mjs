import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CELL_SIZE,
  CELL_STEP_X,
  CELL_STEP_Y,
  GRID_CELLS,
  MAZE_WIDTH,
  SWORD_FIELD_INTERACTION_RANGE,
  TILE_FLOOR,
  TILE_FLOOR_SHADOW,
  WALL_HEIGHT,
  WALL_WIDTH,
  computeTeamRouteSwordFieldPlacements,
  findSwordFieldWisdomTarget,
  generateMazeLayout,
  getHubTileBounds,
  getSwordFieldCollisionBounds,
  isPositionValid,
} from '../dist/index.js';

const cellToTile = (cx, cy) => ({
  tx: WALL_WIDTH + cx * CELL_STEP_X,
  ty: WALL_HEIGHT + cy * CELL_STEP_Y,
});

const spawnPointToCell = (spawnPoint) => ({
  cx: Math.round((spawnPoint.x - Math.floor(CELL_SIZE / 2) - WALL_WIDTH) / CELL_STEP_X),
  cy: Math.round((spawnPoint.y - Math.floor(CELL_SIZE / 2) - WALL_HEIGHT) / CELL_STEP_Y),
});

const isWalkable = (tile) => tile === TILE_FLOOR || tile === TILE_FLOOR_SHADOW;

function cellsAreConnected(data, cx1, cy1, cx2, cy2) {
  const first = cellToTile(cx1, cy1);
  const second = cellToTile(cx2, cy2);
  if (cy1 === cy2) {
    const wallX = Math.min(first.tx, second.tx) + CELL_SIZE;
    for (let y = first.ty; y < first.ty + CELL_SIZE; y++) {
      for (let x = wallX; x < wallX + WALL_WIDTH; x++) {
        if (isWalkable(data[y * MAZE_WIDTH + x])) return true;
      }
    }
    return false;
  }

  const wallY = Math.min(first.ty, second.ty) + CELL_SIZE;
  for (let y = wallY; y < wallY + WALL_HEIGHT; y++) {
    for (let x = first.tx; x < first.tx + CELL_SIZE; x++) {
      if (isWalkable(data[y * MAZE_WIDTH + x])) return true;
    }
  }
  return false;
}

function getHubCells() {
  const bounds = getHubTileBounds();
  const cells = new Set();
  for (let cy = 0; cy < GRID_CELLS; cy++) {
    for (let cx = 0; cx < GRID_CELLS; cx++) {
      const { tx, ty } = cellToTile(cx, cy);
      if (
        tx <= bounds.right &&
        tx + CELL_SIZE - 1 >= bounds.left &&
        ty <= bounds.bottom &&
        ty + CELL_SIZE - 1 >= bounds.top
      ) {
        cells.add(`${cx},${cy}`);
      }
    }
  }
  return cells;
}

function findPathToHub(data, spawnPoint) {
  const start = spawnPointToCell(spawnPoint);
  const hubCells = getHubCells();
  const startKey = `${start.cx},${start.cy}`;
  const queue = [start];
  const parents = new Map([[startKey, null]]);
  const directions = [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ];

  for (let head = 0; head < queue.length; head++) {
    const current = queue[head];
    const currentKey = `${current.cx},${current.cy}`;
    if (hubCells.has(currentKey)) {
      const path = [];
      let key = currentKey;
      while (key) {
        const [cx, cy] = key.split(',').map(Number);
        path.push({ cx, cy });
        key = parents.get(key);
      }
      return path.reverse();
    }

    for (const [dx, dy] of directions) {
      const next = { cx: current.cx + dx, cy: current.cy + dy };
      if (next.cx < 0 || next.cx >= GRID_CELLS || next.cy < 0 || next.cy >= GRID_CELLS)
        continue;
      const nextKey = `${next.cx},${next.cy}`;
      if (parents.has(nextKey)) continue;
      if (!cellsAreConnected(data, current.cx, current.cy, next.cx, next.cy)) continue;
      parents.set(nextKey, currentKey);
      queue.push(next);
    }
  }
  return null;
}

test('every team route has a reserved sword field plus scattered extras', () => {
  const first = generateMazeLayout(44, 10, 3);
  const second = generateMazeLayout(44, 10, 3);

  assert.deepEqual(first.swordFields, second.swordFields);
  const required = computeTeamRouteSwordFieldPlacements(
    first.map.data,
    first.spawnPoints,
    44,
  );
  assert.ok(required.length > 0);
  assert.ok(first.swordFields.length > required.length, 'at least one field is scattered');
  for (const placement of required) {
    assert.ok(
      first.swordFields.some(
        (candidate) =>
          candidate.westCellX === placement.westCellX && candidate.cellY === placement.cellY,
      ),
    );
  }

  for (const spawnPoint of first.spawnPoints) {
    const path = findPathToHub(first.map.data, spawnPoint);
    assert.ok(path);
    const routeFieldCount = path.slice(0, -1).filter((cell, index) => {
        const next = path[index + 1];
        if (cell.cy !== next.cy) return false;
        const westCellX = Math.min(cell.cx, next.cx);
        return first.swordFields.some(
          (field) => field.westCellX === westCellX && field.cellY === cell.cy,
        );
      }).length;
    assert.equal(routeFieldCount, 1, 'spawn-to-hub route must cross exactly one field');
  }

  const occupiedCells = new Set();
  for (const field of first.swordFields) {
    const westKey = `${field.westCellX},${field.cellY}`;
    const eastKey = `${field.westCellX + 1},${field.cellY}`;
    assert.equal(occupiedCells.has(westKey) || occupiedCells.has(eastKey), false);
    occupiedCells.add(westKey);
    occupiedCells.add(eastKey);
  }
});

test('direct team routes never contain more than one sword field', () => {
  for (let seed = 0; seed < 200; seed++) {
    const layout = generateMazeLayout(seed, 10, 3);
    for (const spawnPoint of layout.spawnPoints) {
      const path = findPathToHub(layout.map.data, spawnPoint);
      assert.ok(path, `seed ${seed} must retain a route to the hub`);
      const routeFieldCount = path.slice(0, -1).filter((cell, index) => {
        const next = path[index + 1];
        if (cell.cy !== next.cy) return false;
        const westCellX = Math.min(cell.cx, next.cx);
        return layout.swordFields.some(
          (field) => field.westCellX === westCellX && field.cellY === cell.cy,
        );
      }).length;
      assert.equal(routeFieldCount, 1, `seed ${seed} route must contain exactly one field`);
    }
  }
});

test('the added editor collider blocks the route until lowering completes', () => {
  const map = {
    width: 20,
    height: 20,
    tileSize: 16,
    data: new Array(20 * 20).fill(TILE_FLOOR),
  };
  const placement = { westCellX: 0, cellY: 0, tileX: 2, tileY: 2 };
  const bounds = getSwordFieldCollisionBounds(placement, map.tileSize);
  const anchorX = placement.tileX * map.tileSize;
  const anchorY = placement.tileY * map.tileSize;

  assert.deepEqual(
    bounds.map(({ kind, left, top, right, bottom }) => ({
      kind,
      x: left - anchorX,
      y: top - anchorY,
      width: right - left + 1,
      height: bottom - top + 1,
    })),
    [
      { kind: 'scenery', x: 32, y: 2, width: 130, height: 14 },
      { kind: 'scenery', x: 154, y: 16, width: 33, height: 14 },
      { kind: 'scenery', x: 5, y: 17, width: 35, height: 14 },
      { kind: 'scenery', x: 97, y: 18, width: 9, height: 13 },
      { kind: 'scenery', x: 113, y: 18, width: 9, height: 13 },
      { kind: 'scenery', x: 81, y: 19, width: 9, height: 13 },
      { kind: 'scenery', x: 154, y: 63, width: 37, height: 14 },
      { kind: 'scenery', x: 3, y: 64, width: 37, height: 14 },
      { kind: 'scenery', x: 154, y: 76, width: 6, height: 19 },
      { kind: 'scenery', x: 34, y: 78, width: 6, height: 18 },
      { kind: 'barrier', x: 19, y: 31, width: 149, height: 32 },
    ],
  );

  const barrier = bounds.find((candidate) => candidate.kind === 'barrier');
  assert.ok(barrier);
  const playerX = (barrier.left + barrier.right) / 2;
  const playerY = barrier.bottom + 1;
  const blockingState = [{ swordFieldIndex: 0, loweringStartedTick: null, cleared: false }];
  const loweringState = [{ swordFieldIndex: 0, loweringStartedTick: 10, cleared: false }];
  const clearedState = [{ swordFieldIndex: 0, loweringStartedTick: 10, cleared: true }];

  assert.equal(
    isPositionValid(playerX, playerY, map, null, [], [], [], [placement], blockingState),
    false,
  );
  assert.equal(
    isPositionValid(playerX, playerY, map, null, [], [], [], [placement], loweringState),
    false,
    'the blocker remains during the shake-and-sink animation',
  );
  assert.equal(
    isPositionValid(playerX, playerY, map, null, [], [], [], [placement], clearedState),
    true,
    'the route opens only after the server marks the animation complete',
  );

  const topFence = bounds[0];
  assert.equal(
    isPositionValid(
      (topFence.left + topFence.right) / 2,
      topFence.bottom + 1,
      map,
      null,
      [],
      [],
      [],
      [placement],
      clearedState,
    ),
    false,
    'authored scenery colliders remain after the swords disappear',
  );
});

test('wisdom targeting works from either entrance and stops after activation', () => {
  const placement = { westCellX: 0, cellY: 0, tileX: 10, tileY: 20 };
  const anchorX = placement.tileX * 16;
  const anchorY = placement.tileY * 16;
  const blockingState = [{ swordFieldIndex: 0, loweringStartedTick: null, cleared: false }];

  assert.deepEqual(
    findSwordFieldWisdomTarget(
      [placement],
      blockingState,
      anchorX + 8 - SWORD_FIELD_INTERACTION_RANGE,
      anchorY + 48,
      16,
    ),
    { swordFieldIndex: 0, entrance: 'west', x: anchorX + 8, y: anchorY + 48 },
  );
  assert.deepEqual(
    findSwordFieldWisdomTarget(
      [placement],
      blockingState,
      anchorX + 184 + SWORD_FIELD_INTERACTION_RANGE,
      anchorY + 48,
      16,
    ),
    { swordFieldIndex: 0, entrance: 'east', x: anchorX + 184, y: anchorY + 48 },
  );
  assert.equal(
    findSwordFieldWisdomTarget(
      [placement],
      [{ swordFieldIndex: 0, loweringStartedTick: 100, cleared: false }],
      anchorX + 8,
      anchorY + 48,
      16,
    ),
    null,
  );
});
