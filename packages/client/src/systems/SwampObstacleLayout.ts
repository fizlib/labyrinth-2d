import {
  getSwampAuthoringWidth,
  isSwampWaterAtAuthoringPoint,
  type SwampPlacement,
} from '@labyrinth/shared';

export interface SwampObstacleSpriteSpec {
  asset: SwampObstacleAsset;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
}

const SWAMP_OBSTACLE_ASSET_PATH_BY_ID = {
  r9: '/assets/swamp-obstacle/Sprite_Rohlan_Fields_9.png',
  r48: '/assets/swamp-obstacle/Sprite_Rohlan_Fields_48.png',
  r49: '/assets/swamp-obstacle/Sprite_Rohlan_Fields_49.png',
  r98: '/assets/swamp-obstacle/Sprite_Rohlan_Fields_98.png',
  r99: '/assets/swamp-obstacle/Sprite_Rohlan_Fields_99.png',
  r100: '/assets/swamp-obstacle/Sprite_Rohlan_Fields_100.png',
  r563: '/assets/swamp-obstacle/Sprite_Rohlan_Fields_563.png',
  r1115: '/assets/swamp-obstacle/Sprite_Rohlan_Fields_1115.png',
  r1118: '/assets/swamp-obstacle/Sprite_Rohlan_Fields_1118.png',
  r1119: '/assets/swamp-obstacle/Sprite_Rohlan_Fields_1119.png',
  r1120: '/assets/swamp-obstacle/Sprite_Rohlan_Fields_1120.png',
  r1121: '/assets/swamp-obstacle/Sprite_Rohlan_Fields_1121.png',
  r1125: '/assets/swamp-obstacle/Sprite_Rohlan_Fields_1125.png',
  r1126: '/assets/swamp-obstacle/Sprite_Rohlan_Fields_1126.png',
  r1127: '/assets/swamp-obstacle/Sprite_Rohlan_Fields_1127.png',
  r1165: '/assets/swamp-obstacle/Sprite_Rohlan_Fields_1165.png',
  r1166: '/assets/swamp-obstacle/Sprite_Rohlan_Fields_1166.png',
  r1167: '/assets/swamp-obstacle/Sprite_Rohlan_Fields_1167.png',
  r1172: '/assets/swamp-obstacle/Sprite_Rohlan_Fields_1172.png',
  r1175: '/assets/swamp-obstacle/Sprite_Rohlan_Fields_1175.png',
  r1177: '/assets/swamp-obstacle/Sprite_Rohlan_Fields_1177.png',
  r1220: '/assets/swamp-obstacle/Sprite_Rohlan_Fields_1220.png',
  r1221: '/assets/swamp-obstacle/Sprite_Rohlan_Fields_1221.png',
  r1222: '/assets/swamp-obstacle/Sprite_Rohlan_Fields_1222.png',
  watergrass0: '/assets/swamp-obstacle/watergrass_0.png',
  watergrass3: '/assets/bridge-obstacle/watergrass_3.png',
  watergrass6: '/assets/bridge-obstacle/watergrass_6.png',
} as const;

export type SwampObstacleAsset = keyof typeof SWAMP_OBSTACLE_ASSET_PATH_BY_ID;

const TERRAIN_ASSET_GRID: readonly (readonly SwampObstacleAsset[])[] = [
  [
    'r1125',
    'r1126',
    'r1126',
    'r1120',
    'r1126',
    'r1126',
    'r1120',
    'r1120',
    'r1126',
    'r1121',
    'r9',
  ],
  [
    'r1222',
    'r1220',
    'r1118',
    'r563',
    'r563',
    'r563',
    'r563',
    'r563',
    'r563',
    'r1177',
    'r9',
  ],
  [
    'r9',
    'r1119',
    'r1166',
    'r563',
    'r563',
    'r563',
    'r563',
    'r563',
    'r563',
    'r1167',
    'r1127',
  ],
  [
    'r9',
    'r1175',
    'r563',
    'r563',
    'r563',
    'r563',
    'r563',
    'r563',
    'r563',
    'r1115',
    'r1221',
  ],
  [
    'r9',
    'r1172',
    'r563',
    'r563',
    'r563',
    'r563',
    'r563',
    'r563',
    'r563',
    'r1165',
    'r1127',
  ],
  [
    'r9',
    'r1222',
    'r1118',
    'r563',
    'r563',
    'r563',
    'r563',
    'r563',
    'r563',
    'r563',
    'r1177',
  ],
] as const;

const AUTHORING_TILE_SIZE = 16;
const BASE_TERRAIN_WIDTH_TILES = TERRAIN_ASSET_GRID[0].length;
const LEFT_EDGE_COLUMNS = 3;
const RIGHT_EDGE_COLUMNS = 2;
const FOREGROUND_Z_INDEX = 500;
const BASE_DETAIL_COUNT = 41;
const BASE_SWAMP_WIDTH = BASE_TERRAIN_WIDTH_TILES * AUTHORING_TILE_SIZE;
const DETAIL_MIN_SPACING = 10;

const FOREGROUND_ASSETS = ['watergrass0', 'watergrass3', 'watergrass6'] as const;
const LILY_ASSETS = ['r98', 'r99', 'r100'] as const;

const ASSET_DIMENSIONS: Readonly<
  Record<(typeof FOREGROUND_ASSETS)[number] | (typeof LILY_ASSETS)[number], readonly [number, number]>
> = {
  watergrass0: [13, 16],
  watergrass3: [16, 16],
  watergrass6: [13, 12],
  r98: [15, 12],
  r99: [15, 14],
  r100: [12, 9],
};

/**
 * The original two-cell swamp composition authored in the style editor.
 *
 * Runtime swamps use seeded, generative decoration. The topology atlas keeps
 * this fixed arrangement so resetting the editor restores the approved visual
 * reference exactly.
 */
export const SWAMP_OBSTACLE_AUTHORED_DETAIL_SPRITES = [
  { asset: 'watergrass3', x: 14, y: 8, w: 16, h: 16, z: 500 },
  { asset: 'watergrass0', x: 7, y: 2, w: 13, h: 16, z: 500 },
  { asset: 'watergrass6', x: 29, y: 6, w: 13, h: 12, z: 500 },
  { asset: 'r99', x: 48, y: 9, w: 15, h: 14, z: 1 },
  { asset: 'r98', x: 64, y: 11, w: 15, h: 12, z: 1 },
  { asset: 'watergrass3', x: 81, y: 6, w: 16, h: 16, z: 500 },
  { asset: 'watergrass6', x: 42, y: 22, w: 13, h: 12, z: 500 },
  { asset: 'r100', x: 37, y: 36, w: 12, h: 9, z: 1 },
  { asset: 'watergrass3', x: 28, y: 37, w: 16, h: 16, z: 500 },
  { asset: 'watergrass0', x: 47, y: 33, w: 13, h: 16, z: 500 },
  { asset: 'r48', x: 94, y: 50, w: 13, h: 16, z: 1 },
  { asset: 'r49', x: 107, y: 50, w: 15, h: 16, z: 1 },
  { asset: 'watergrass6', x: 59, y: 22, w: 13, h: 12, z: 500 },
  { asset: 'r99', x: 69, y: 41, w: 15, h: 14, z: 1 },
  { asset: 'watergrass3', x: 79, y: 46, w: 16, h: 16, z: 500 },
  { asset: 'watergrass3', x: 25, y: 66, w: 16, h: 16, z: 500 },
  { asset: 'watergrass0', x: 36, y: 73, w: 13, h: 16, z: 500 },
  { asset: 'watergrass6', x: 43, y: 49, w: 13, h: 12, z: 500 },
  { asset: 'r99', x: 52, y: 62, w: 15, h: 14, z: 1 },
  { asset: 'r100', x: 116, y: 64, w: 12, h: 9, z: 1 },
  { asset: 'r98', x: 81, y: 76, w: 15, h: 12, z: 1 },
  { asset: 'watergrass6', x: 69, y: 74, w: 13, h: 12, z: 500 },
  { asset: 'watergrass6', x: 77, y: 63, w: 13, h: 12, z: 500 },
  { asset: 'watergrass6', x: 92, y: 38, w: 13, h: 12, z: 500 },
  { asset: 'watergrass6', x: 78, y: 24, w: 13, h: 12, z: 500 },
  { asset: 'r98', x: 97, y: 10, w: 15, h: 12, z: 1 },
  { asset: 'r99', x: 100, y: 23, w: 15, h: 14, z: 1 },
  { asset: 'watergrass6', x: 114, y: 9, w: 13, h: 12, z: 500 },
  { asset: 'watergrass3', x: 117, y: 20, w: 16, h: 16, z: 500 },
  { asset: 'watergrass0', x: 108, y: 32, w: 13, h: 16, z: 500 },
  { asset: 'watergrass6', x: 99, y: 67, w: 13, h: 12, z: 500 },
  { asset: 'watergrass6', x: 118, y: 74, w: 13, h: 12, z: 500 },
  { asset: 'r98', x: 131, y: 66, w: 15, h: 12, z: 1 },
  { asset: 'watergrass0', x: 154, y: 66, w: 13, h: 16, z: 500 },
  { asset: 'r99', x: 136, y: 76, w: 15, h: 14, z: 1 },
  { asset: 'watergrass0', x: 134, y: 32, w: 13, h: 16, z: 500 },
  { asset: 'r100', x: 151, y: 42, w: 12, h: 9, z: 1 },
  { asset: 'watergrass6', x: 138, y: 53, w: 13, h: 12, z: 500 },
  { asset: 'watergrass6', x: 121, y: 44, w: 13, h: 12, z: 500 },
  { asset: 'watergrass6', x: 130, y: 8, w: 13, h: 12, z: 500 },
  { asset: 'watergrass6', x: 133, y: 19, w: 13, h: 12, z: 500 },
] as const satisfies readonly SwampObstacleSpriteSpec[];

function createRandom(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function getExtendedTerrainAsset(
  swamp: SwampPlacement,
  rowIndex: number,
  columnIndex: number,
  widthTiles: number,
): SwampObstacleAsset {
  if (widthTiles === BASE_TERRAIN_WIDTH_TILES) {
    return TERRAIN_ASSET_GRID[rowIndex][columnIndex];
  }
  if (columnIndex < LEFT_EDGE_COLUMNS) {
    return TERRAIN_ASSET_GRID[rowIndex][columnIndex];
  }
  if (columnIndex >= widthTiles - RIGHT_EDGE_COLUMNS) {
    const edgeOffset = widthTiles - columnIndex;
    return TERRAIN_ASSET_GRID[rowIndex][BASE_TERRAIN_WIDTH_TILES - edgeOffset];
  }
  if (rowIndex !== 0) return 'r563';

  let variation = swamp.decorationSeed ^ Math.imul(columnIndex + 1, 0x45d9f3b);
  variation ^= variation >>> 16;
  return (variation >>> 0) % 4 === 0 ? 'r1120' : 'r1126';
}

/** Terrain modules with authored banks and a repeatable water middle section. */
export function getSwampObstacleTerrainSprites(
  swamp: SwampPlacement,
): readonly SwampObstacleSpriteSpec[] {
  const widthTiles = getSwampAuthoringWidth(swamp.lengthCells) / AUTHORING_TILE_SIZE;
  const specs: SwampObstacleSpriteSpec[] = [];

  for (let rowIndex = 0; rowIndex < TERRAIN_ASSET_GRID.length; rowIndex++) {
    for (let columnIndex = 0; columnIndex < widthTiles; columnIndex++) {
      specs.push({
        asset: getExtendedTerrainAsset(swamp, rowIndex, columnIndex, widthTiles),
        x: columnIndex * AUTHORING_TILE_SIZE,
        y: rowIndex * AUTHORING_TILE_SIZE,
        w: AUTHORING_TILE_SIZE,
        h: AUTHORING_TILE_SIZE,
        z: 0,
      });
    }
  }

  return specs;
}

interface DecorationCandidate {
  x: number;
  y: number;
  score: number;
  categoryRoll: number;
}

function decorationFitsWater(
  lengthCells: number,
  spec: SwampObstacleSpriteSpec,
): boolean {
  const sampleY = spec.z >= FOREGROUND_Z_INDEX ? spec.y + spec.h - 2 : spec.y + spec.h / 2;
  return (
    isSwampWaterAtAuthoringPoint(lengthCells, spec.x + 2, sampleY) &&
    isSwampWaterAtAuthoringPoint(lengthCells, spec.x + spec.w / 2, sampleY) &&
    isSwampWaterAtAuthoringPoint(lengthCells, spec.x + spec.w - 2, sampleY)
  );
}

function makeDecorationSpec(
  asset: (typeof FOREGROUND_ASSETS)[number] | (typeof LILY_ASSETS)[number],
  candidate: DecorationCandidate,
  foreground: boolean,
): SwampObstacleSpriteSpec {
  const [w, h] = ASSET_DIMENSIONS[asset];
  return {
    asset,
    x: Math.round(candidate.x - w / 2),
    y: Math.round(foreground ? candidate.y - h + 2 : candidate.y - h / 2),
    w,
    h,
    z: foreground ? FOREGROUND_Z_INDEX : 1,
  };
}

/** Seeded lilies and reeds, populated at the same density as the authored swamp. */
export function getSwampObstacleDetailSprites(
  swamp: SwampPlacement,
): readonly SwampObstacleSpriteSpec[] {
  const width = getSwampAuthoringWidth(swamp.lengthCells);
  const random = createRandom(swamp.decorationSeed ^ 0x6a09e667);
  const candidates: DecorationCandidate[] = [];

  let rowIndex = 0;
  for (let y = 10; y <= 88; y += 11, rowIndex++) {
    const rowOffset = rowIndex % 2 === 0 ? 0 : 6;
    for (let x = 8 + rowOffset; x < width - 8; x += 12) {
      const candidateX = x + (random() - 0.5) * 6;
      const candidateY = y + (random() - 0.5) * 5;
      if (!isSwampWaterAtAuthoringPoint(swamp.lengthCells, candidateX, candidateY)) continue;
      candidates.push({
        x: candidateX,
        y: candidateY,
        score: random(),
        categoryRoll: random(),
      });
    }
  }
  candidates.sort((a, b) => b.score - a.score);

  const targetCount = Math.round((BASE_DETAIL_COUNT * width) / BASE_SWAMP_WIDTH);
  const foregroundTarget = Math.round(targetCount * 0.68);
  const groundTarget = targetCount - foregroundTarget;
  const occupiedPoints: Array<{ x: number; y: number }> = [];
  const specs: SwampObstacleSpriteSpec[] = [];
  let foregroundCount = 0;
  let groundCount = 0;

  for (const candidate of candidates) {
    if (foregroundCount >= foregroundTarget && groundCount >= groundTarget) break;
    if (
      occupiedPoints.some(
        (point) =>
          (point.x - candidate.x) ** 2 + (point.y - candidate.y) ** 2 <
          DETAIL_MIN_SPACING ** 2,
      )
    ) {
      continue;
    }

    const foregroundRemaining = foregroundTarget - foregroundCount;
    const groundRemaining = groundTarget - groundCount;
    const useForeground =
      foregroundRemaining > 0 &&
      (groundRemaining <= 0 ||
        candidate.categoryRoll < foregroundRemaining / (foregroundRemaining + groundRemaining));

    if (!useForeground && random() < 0.12) {
      const pairX = Math.round(candidate.x - 14);
      const pairY = Math.round(candidate.y - 8);
      const largeLilySpecs: readonly SwampObstacleSpriteSpec[] = [
        { asset: 'r48', x: pairX, y: pairY, w: 13, h: 16, z: 1 },
        { asset: 'r49', x: pairX + 13, y: pairY, w: 15, h: 16, z: 1 },
      ];
      if (largeLilySpecs.every((spec) => decorationFitsWater(swamp.lengthCells, spec))) {
        specs.push(...largeLilySpecs);
        occupiedPoints.push({ x: candidate.x, y: candidate.y });
        groundCount++;
        continue;
      }
    }

    const assetPool = useForeground ? FOREGROUND_ASSETS : LILY_ASSETS;
    const asset = assetPool[Math.floor(random() * assetPool.length)];
    const spec = makeDecorationSpec(asset, candidate, useForeground);
    if (!decorationFitsWater(swamp.lengthCells, spec)) continue;

    specs.push(spec);
    occupiedPoints.push({ x: candidate.x, y: candidate.y });
    if (useForeground) foregroundCount++;
    else groundCount++;
  }

  return specs;
}

export function getSwampObstacleAssetPath(asset: SwampObstacleAsset): string {
  return SWAMP_OBSTACLE_ASSET_PATH_BY_ID[asset];
}

export const SWAMP_OBSTACLE_ASSET_PATHS = [
  ...new Set(Object.values(SWAMP_OBSTACLE_ASSET_PATH_BY_ID)),
] as const;
