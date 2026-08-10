import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CELL_SIZE,
  CELL_STEP_X,
  CELL_STEP_Y,
  CHEST_DEAD_END_DENSITY,
  CHEST_INTERACTION_RANGE,
  FEET_HITBOX_H,
  MAX_WISDOM_ORBS,
  TILE_FLOOR,
  WALL_HEIGHT,
  WALL_WIDTH,
  chooseChestCount,
  computeChestDeadEndPlacements,
  computePortalPosition,
  generateMazeLayout,
  getChestDeadEndBounds,
  getChestDeadEndVariant,
  getChestInteractionPoint,
  getChestWisdomOrbReward,
  isPositionValid,
} from '../dist/index.js';

test('seed-44 retains the authored south-opening chest dead end', () => {
  const layout = generateMazeLayout(44, 10, 3);

  assert.deepEqual(
    layout.chestDeadEnds,
    computeChestDeadEndPlacements(layout.map.data, 44, layout.spawnPoints),
  );
  const fixture = layout.chestDeadEnds.filter(
    (placement) => placement.cellX === 2 && placement.cellY === 9,
  );
  assert.deepEqual(
    fixture.map(({ openDirection, variant, chestCount, chestSlot }) => ({
      openDirection,
      variant,
      chestCount,
      chestSlot,
    })),
    [
      { openDirection: 'south', variant: 'north-west', chestCount: 3, chestSlot: 0 },
      { openDirection: 'south', variant: 'north-west', chestCount: 3, chestSlot: 1 },
      { openDirection: 'south', variant: 'north-west', chestCount: 3, chestSlot: 2 },
    ],
    'the style-editor fixture must retain its authored three-chest arrangement',
  );

  for (const placement of layout.chestDeadEnds) {
    assert.equal(placement.variant, getChestDeadEndVariant(placement.openDirection));
    assert.equal(placement.tileX, WALL_WIDTH + placement.cellX * CELL_STEP_X);
    assert.equal(placement.tileY, WALL_HEIGHT + placement.cellY * CELL_STEP_Y);
    assert.ok(placement.chestSlot < placement.chestCount);
  }

  assert.deepEqual(
    [...new Set(layout.chestDeadEnds.map((placement) => placement.openDirection))].sort(),
    ['east', 'north', 'south', 'west'],
  );
  // The stored direction is the opening back into the maze, opposite the
  // direction in which the dead end extends.
  assert.equal(getChestDeadEndVariant('south'), 'north-west'); // north dead end
  assert.equal(getChestDeadEndVariant('east'), 'north-west'); // west dead end
  assert.equal(getChestDeadEndVariant('north'), 'south-east'); // south dead end
  assert.equal(getChestDeadEndVariant('west'), 'south-east'); // east dead end
});

test('player spawn cells never become chest cells', () => {
  for (let seed = 0; seed < 100; seed += 1) {
    const layout = generateMazeLayout(seed, 10, 3);
    const spawnCells = new Set(
      layout.spawnPoints.map((spawnPoint) => {
        const cellX = Math.round(
          (spawnPoint.x - CELL_SIZE / 2 - WALL_WIDTH) / CELL_STEP_X,
        );
        const cellY = Math.round(
          (spawnPoint.y - CELL_SIZE / 2 - WALL_HEIGHT) / CELL_STEP_Y,
        );
        return `${cellX},${cellY}`;
      }),
    );

    for (const placement of layout.chestDeadEnds) {
      assert.equal(
        spawnCells.has(`${placement.cellX},${placement.cellY}`),
        false,
        `seed ${seed}: spawn cell ${placement.cellX},${placement.cellY} contains a chest`,
      );
    }
  }
});

test('chest cells occupy exactly 60% of eligible non-spawn dead ends', () => {
  assert.equal(CHEST_DEAD_END_DENSITY, 0.6);

  for (let seed = 0; seed < 100; seed += 1) {
    const layout = generateMazeLayout(seed, 10, 3);
    const allEligiblePlacements = computeChestDeadEndPlacements(
      layout.map.data,
      seed,
      layout.spawnPoints,
      1,
    );
    const selectedPlacements = computeChestDeadEndPlacements(
      layout.map.data,
      seed,
      layout.spawnPoints,
    );
    const allEligibleCells = new Set(
      allEligiblePlacements.map(({ cellX, cellY }) => `${cellX},${cellY}`),
    );
    const selectedCells = new Set(
      selectedPlacements.map(({ cellX, cellY }) => `${cellX},${cellY}`),
    );
    const generatedLayoutCells = new Set(
      layout.chestDeadEnds.map(({ cellX, cellY }) => `${cellX},${cellY}`),
    );
    const expectedCount = Math.round(
      allEligibleCells.size * CHEST_DEAD_END_DENSITY,
    );

    assert.equal(selectedCells.size, expectedCount, `selection for seed ${seed}`);
    assert.equal(generatedLayoutCells.size, expectedCount, `layout for seed ${seed}`);
  }
});

test('chest-count selection follows deterministic 70/24/6 weighting', () => {
  const counts = [0, 0, 0, 0];
  for (let seed = 0; seed < 10_000; seed++) counts[chooseChestCount(seed, 4, 7)]++;

  assert.ok(counts[1] > 6_700 && counts[1] < 7_300, `one chest: ${counts[1]}`);
  assert.ok(counts[2] > 2_100 && counts[2] < 2_700, `two chests: ${counts[2]}`);
  assert.ok(counts[3] > 400 && counts[3] < 800, `three chests: ${counts[3]}`);
  assert.equal(chooseChestCount(44, 2, 9), 3);
});

test('portal placement excludes cells reserved by chest dead ends', () => {
  for (let seed = 0; seed < 100; seed++) {
    const layout = generateMazeLayout(seed, 10, 3);
    const portal = computePortalPosition(
      layout.map.data,
      10,
      layout.bridges,
      layout.swamps,
      layout.chestDeadEnds,
    );
    assert.ok(portal, `seed ${seed} must retain a portal after directional chest placement`);

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
    variant: 'north-west',
    chestCount: 1,
    chestSlot: 0,
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

test('two- and three-chest arrangements retain every exported collider', () => {
  const expectedByCount = {
    2: [
      { x: 36, y: 25, width: 10, height: 9 },
      { x: 61, y: 40, width: 10, height: 9 },
    ],
    3: [
      { x: 22, y: 24, width: 10, height: 9 },
      { x: 46, y: 24, width: 10, height: 9 },
      { x: 66, y: 40, width: 10, height: 9 },
    ],
  };

  for (const chestCount of [2, 3]) {
    const anchorX = 4 * 16;
    const anchorY = 4 * 16;
    const placements = Array.from({ length: chestCount }, (_, chestSlot) => ({
      cellX: 0,
      cellY: 0,
      tileX: 4,
      tileY: 4,
      openDirection: 'south',
      variant: 'north-west',
      chestCount,
      chestSlot,
    }));
    const chestBounds = placements
      .flatMap((placement) => getChestDeadEndBounds(placement, 16))
      .filter((bounds) => bounds.kind === 'chest')
      .map(({ left, top, right, bottom }) => ({
        x: left - anchorX,
        y: top - anchorY,
        width: right - left + 1,
        height: bottom - top + 1,
      }));

    assert.deepEqual(chestBounds, expectedByCount[chestCount]);
  }
});

test('new south/east variation retains its exported tree wall and three chest colliders', () => {
  const placements = Array.from({ length: 3 }, (_, chestSlot) => ({
    cellX: 0,
    cellY: 0,
    tileX: 4,
    tileY: 4,
    openDirection: 'south',
    variant: 'south-east',
    chestCount: 3,
    chestSlot,
  }));
  const anchorX = 4 * 16;
  const anchorY = 4 * 16;
  const bounds = placements.flatMap((placement) => getChestDeadEndBounds(placement, 16));

  assert.deepEqual(
    bounds.map(({ kind, left, top, right, bottom }) => ({
      kind,
      x: left - anchorX,
      y: top - anchorY,
      width: right - left + 1,
      height: bottom - top + 1,
    })),
    [
      { kind: 'backdrop', x: 74, y: 8, width: 17, height: 55 },
      { kind: 'rock', x: 60, y: 25, width: 13, height: 12 },
      { kind: 'chest', x: 17, y: 24, width: 10, height: 9 },
      { kind: 'chest', x: 41, y: 19, width: 10, height: 9 },
      { kind: 'chest', x: 61, y: 40, width: 10, height: 9 },
    ],
  );
});

test('chest interaction point and wisdom-orb cap stay shared', () => {
  const placement = {
    cellX: 0,
    cellY: 0,
    tileX: 4,
    tileY: 4,
    openDirection: 'south',
    variant: 'north-west',
    chestCount: 1,
    chestSlot: 0,
  };

  assert.deepEqual(getChestInteractionPoint(placement, 16), { x: 106, y: 98 });
  assert.equal(CHEST_INTERACTION_RANGE, 28);
  assert.equal(MAX_WISDOM_ORBS, 3);
  assert.equal(getChestWisdomOrbReward(0), 1);
  assert.equal(getChestWisdomOrbReward(2), 3);
  assert.equal(getChestWisdomOrbReward(3), null);
  assert.equal(getChestWisdomOrbReward(4), null);

  const threeChestPlacement = { ...placement, chestCount: 3 };
  assert.deepEqual(getChestInteractionPoint({ ...threeChestPlacement, chestSlot: 0 }, 16), {
    x: 92,
    y: 97,
  });
  assert.deepEqual(getChestInteractionPoint({ ...threeChestPlacement, chestSlot: 2 }, 16), {
    x: 136,
    y: 113,
  });

  const southEastPlacement = { ...threeChestPlacement, variant: 'south-east' };
  assert.deepEqual(getChestInteractionPoint({ ...southEastPlacement, chestSlot: 0 }, 16), {
    x: 87,
    y: 97,
  });
  assert.deepEqual(getChestInteractionPoint({ ...southEastPlacement, chestSlot: 2 }, 16), {
    x: 131,
    y: 113,
  });
});
