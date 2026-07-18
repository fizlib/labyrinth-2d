import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BRIDGE_WALKWAY_COLUMNS,
  BRIDGE_WALKWAY_TILE_COUNT,
  BRIDGE_WALKWAY_ROWS,
  FEET_HITBOX_H,
  TILE_FLOOR,
  generateBridgeSafeTileMasks,
  generateMazeLayout,
  getBridgeBankReturnPosition,
  getBridgeCollapseMask,
  getBridgeRepairCircleBounds,
  getBridgeTileBit,
  getBridgeWalkwayTileAtPoint,
  getBridgeWalkwayTileBounds,
  isPositionValid,
} from '../dist/index.js';

function safeTiles(mask) {
  const result = [];
  for (let row = 0; row < BRIDGE_WALKWAY_ROWS; row++) {
    for (let column = 0; column < BRIDGE_WALKWAY_COLUMNS; column++) {
      if ((mask & getBridgeTileBit(row, column)) !== 0) {
        result.push({ row, column });
      }
    }
  }
  return result;
}

function assertConnectedUnbranchedPath(mask) {
  const tiles = safeTiles(mask);
  const keys = new Set(tiles.map(({ row, column }) => `${row}:${column}`));
  const pending = [tiles[0]];
  const visited = new Set();

  while (pending.length > 0) {
    const tile = pending.pop();
    const key = `${tile.row}:${tile.column}`;
    if (visited.has(key)) continue;
    visited.add(key);
    for (const [rowDelta, columnDelta] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ]) {
      const neighbor = `${tile.row + rowDelta}:${tile.column + columnDelta}`;
      if (keys.has(neighbor))
        pending.push({
          row: tile.row + rowDelta,
          column: tile.column + columnDelta,
        });
    }
  }

  assert.equal(visited.size, tiles.length, 'safe route must be connected');
  assert.equal(
    [0, 1].filter((column) => keys.has(`0:${column}`)).length,
    1,
    'north endpoint must have one safe tile',
  );
  assert.equal(
    [0, 1].filter((column) => keys.has(`${BRIDGE_WALKWAY_ROWS - 1}:${column}`)).length,
    1,
    'south endpoint must have one safe tile',
  );
  for (let row = 0; row < BRIDGE_WALKWAY_ROWS - 1; row++) {
    const isFullSquare = [`${row}:0`, `${row}:1`, `${row + 1}:0`, `${row + 1}:1`].every(
      (key) => keys.has(key),
    );
    assert.equal(isFullSquare, false, 'route must not contain a branching 2x2 block');
  }
  assert.ok(tiles.length === 7 || tiles.length === 8, 'route must have 1 or 2 turns');
}

test('bridge path selection is deterministic, unique, and connected', () => {
  const first = generateBridgeSafeTileMasks(12, 123456);
  const second = generateBridgeSafeTileMasks(12, 123456);
  assert.deepEqual(first, second);
  assert.equal(new Set(first).size, first.length);
  for (const mask of first) {
    assert.ok(mask < 1 << BRIDGE_WALKWAY_TILE_COUNT);
    assertConnectedUnbranchedPath(mask);
  }
});

test('generated layouts assign a distinct hidden path to each bridge', () => {
  const layout = generateMazeLayout(44, 10, 3);
  const masks = layout.bridges.map((bridge) => bridge.safeTileMask);
  assert.ok(masks.length >= 4);
  assert.equal(new Set(masks).size, masks.length);
  for (const mask of masks) assertConnectedUnbranchedPath(mask);

  const bridgeStates = layout.bridges.map((_, bridgeIndex) => ({
    bridgeIndex,
    collapsedTileMask: (1 << BRIDGE_WALKWAY_TILE_COUNT) - 1,
  }));
  for (const bridge of layout.bridges) {
    for (const side of ['north', 'south']) {
      const position = getBridgeBankReturnPosition(bridge, side, layout.map.tileSize);
      assert.equal(
        isPositionValid(
          position.x,
          position.y,
          layout.map,
          null,
          layout.bridges,
          bridgeStates,
        ),
        true,
        `${side} bank return must remain valid beside a collapsed bridge`,
      );
    }
  }
});

test('collapse masks select both columns strictly ahead', () => {
  let expectedNorth = 0;
  for (let row = 0; row < 5; row++) {
    expectedNorth |= getBridgeTileBit(row, 0) | getBridgeTileBit(row, 1);
  }
  assert.equal(getBridgeCollapseMask(5, 'north'), expectedNorth);

  let expectedSouth = 0;
  for (let row = 3; row < BRIDGE_WALKWAY_ROWS; row++) {
    expectedSouth |= getBridgeTileBit(row, 0) | getBridgeTileBit(row, 1);
  }
  assert.equal(getBridgeCollapseMask(2, 'south'), expectedSouth);
});

test('walkway, repair-circle, and bank geometry stays aligned to the prefab', () => {
  const bridge = {
    cellX: 0,
    northCellY: 0,
    tileX: 10,
    tileY: 20,
    safeTileMask: getBridgeTileBit(0, 1) | getBridgeTileBit(BRIDGE_WALKWAY_ROWS - 1, 0),
  };
  const rowThree = getBridgeWalkwayTileBounds(bridge, 3, 1);
  assert.deepEqual(
    getBridgeWalkwayTileAtPoint(
      bridge,
      (rowThree.left + rowThree.right) / 2,
      (rowThree.top + rowThree.bottom) / 2,
    ),
    { row: 3, column: 1 },
  );

  const circles = getBridgeRepairCircleBounds(bridge);
  assert.deepEqual(
    circles.map((circle) => circle.side),
    ['north', 'south'],
  );
  const northReturn = getBridgeBankReturnPosition(bridge, 'north');
  const southReturn = getBridgeBankReturnPosition(bridge, 'south');
  assert.ok(northReturn.y < getBridgeWalkwayTileBounds(bridge, 0, 1).top);
  assert.ok(
    southReturn.y - FEET_HITBOX_H >
      getBridgeWalkwayTileBounds(bridge, BRIDGE_WALKWAY_ROWS - 1, 0).bottom,
  );

  const anchorX = bridge.tileX * 16;
  const anchorY = bridge.tileY * 16;
  assert.equal(
    getBridgeWalkwayTileAtPoint(bridge, anchorX + 40, anchorY + 33),
    null,
    'Sprite_Ancient_Ruins_821 must remain outside the puzzle',
  );
  assert.equal(
    getBridgeWalkwayTileAtPoint(bridge, anchorX + 40, anchorY + 139),
    null,
    'Sprite_Ancient_Ruins_819/820 must remain outside the puzzle',
  );
});

test('collapsed stones become solid water gaps while intact stones stay walkable', () => {
  const map = {
    width: 30,
    height: 30,
    tileSize: 16,
    data: new Array(30 * 30).fill(TILE_FLOOR),
  };
  const bridge = {
    cellX: 0,
    northCellY: 0,
    tileX: 5,
    tileY: 5,
    safeTileMask: (1 << BRIDGE_WALKWAY_TILE_COUNT) - 1,
  };
  const bounds = getBridgeWalkwayTileBounds(bridge, 4, 0, map.tileSize);
  const playerX = (bounds.left + bounds.right) / 2;
  const playerY = bounds.top + FEET_HITBOX_H;

  assert.equal(isPositionValid(playerX, playerY, map, null, [bridge], []), true);
  assert.equal(
    isPositionValid(
      playerX,
      playerY,
      map,
      null,
      [bridge],
      [
        {
          bridgeIndex: 0,
          collapsedTileMask: getBridgeTileBit(4, 0),
        },
      ],
    ),
    false,
  );
});
