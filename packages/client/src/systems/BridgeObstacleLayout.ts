import { BRIDGE_WALKWAY_ROW_Y, type BridgeEntrySide } from '@labyrinth/shared';
import { getFiorwoodsRuntimeAssetPath } from '../assets/runtimeAssetPaths';

export interface BridgeObstacleSpriteSpec {
  asset: BridgeObstacleAsset;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
}

export interface BridgeObstacleHiddenForestSpriteSpec {
  assetId: number;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  direction: 'north';
  flipX: boolean;
  flipY: boolean;
}

const BRIDGE_OBSTACLE_ASSET_PATH_BY_ID = {
  f563: getFiorwoodsRuntimeAssetPath(563),
  f1437: getFiorwoodsRuntimeAssetPath(1437),
  f1443: getFiorwoodsRuntimeAssetPath(1443),
  f1446: getFiorwoodsRuntimeAssetPath(1446),
  f1447: getFiorwoodsRuntimeAssetPath(1447),
  f1485: getFiorwoodsRuntimeAssetPath(1485),
  f1537: getFiorwoodsRuntimeAssetPath(1537),
  f1542: getFiorwoodsRuntimeAssetPath(1542),
  f1545: getFiorwoodsRuntimeAssetPath(1545),
  f1587: getFiorwoodsRuntimeAssetPath(1587),
  f1591: getFiorwoodsRuntimeAssetPath(1591),
  f1592: getFiorwoodsRuntimeAssetPath(1592),
  f1987: getFiorwoodsRuntimeAssetPath(1987),
  f1988: getFiorwoodsRuntimeAssetPath(1988),
  f1992: getFiorwoodsRuntimeAssetPath(1992),
  a105: '/assets/bridge-obstacle/Sprite_Ancient_Ruins_105.png',
  a106: '/assets/bridge-obstacle/Sprite_Ancient_Ruins_106.png',
  a107: '/assets/bridge-obstacle/Sprite_Ancient_Ruins_107.png',
  a108: '/assets/bridge-obstacle/Sprite_Ancient_Ruins_108.png',
  a109: '/assets/bridge-obstacle/Sprite_Ancient_Ruins_109.png',
  a110: '/assets/bridge-obstacle/Sprite_Ancient_Ruins_110.png',
  a819: '/assets/bridge-obstacle/Sprite_Ancient_Ruins_819.png',
  a820: '/assets/bridge-obstacle/Sprite_Ancient_Ruins_820.png',
  a821: '/assets/bridge-obstacle/Sprite_Ancient_Ruins_821.png',
  buried: '/assets/bridge-obstacle/burriedTreasureCircle.png',
  watergrass3: '/assets/bridge-obstacle/watergrass_3.png',
  watergrass6: '/assets/bridge-obstacle/watergrass_6.png',
} as const;

export type BridgeObstacleAsset = keyof typeof BRIDGE_OBSTACLE_ASSET_PATH_BY_ID;

/** Exact visual layout exported from labyrinth-style-v1.json. */
export const BRIDGE_OBSTACLE_SPRITES: readonly BridgeObstacleSpriteSpec[] = [
  { asset: 'f1988', x: 65, y: 44, w: 32, h: 32, z: 0 },
  { asset: 'f563', x: 0, y: 144, w: 16, h: 16, z: 0 },
  { asset: 'f1537', x: 1, y: 11, w: 9, h: 7, z: 1 },
  { asset: 'f1542', x: 86, y: 11, w: 9, h: 7, z: 1 },
  { asset: 'f1592', x: 80, y: 16, w: 16, h: 16, z: 1 },
  { asset: 'f1587', x: 0, y: 17, w: 16, h: 16, z: 1 },
  { asset: 'f1591', x: 64, y: 26, w: 16, h: 6, z: 1 },
  { asset: 'f1591', x: 16, y: 27, w: 16, h: 6, z: 1 },
  { asset: 'a106', x: 32, y: 41, w: 16, h: 15, z: 1 },
  { asset: 'a107', x: 48, y: 41, w: 16, h: 15, z: 1 },
  { asset: 'a106', x: 32, y: 56, w: 16, h: 15, z: 1 },
  { asset: 'a109', x: 48, y: 56, w: 16, h: 15, z: 1 },
  { asset: 'a110', x: 32, y: 71, w: 16, h: 15, z: 1 },
  { asset: 'a110', x: 48, y: 71, w: 16, h: 15, z: 1 },
  { asset: 'a107', x: 32, y: 86, w: 16, h: 15, z: 1 },
  { asset: 'a109', x: 48, y: 86, w: 16, h: 15, z: 1 },
  { asset: 'a106', x: 32, y: 101, w: 16, h: 15, z: 1 },
  { asset: 'a107', x: 48, y: 101, w: 16, h: 15, z: 1 },
  { asset: 'a105', x: 32, y: 116, w: 16, h: 15, z: 1 },
  { asset: 'a108', x: 48, y: 116, w: 16, h: 15, z: 1 },
  { asset: 'f1437', x: 16, y: 131, w: 16, h: 13, z: 1 },
  { asset: 'f1446', x: 32, y: 131, w: 16, h: 13, z: 1 },
  { asset: 'f1447', x: 48, y: 131, w: 16, h: 13, z: 1 },
  { asset: 'f1443', x: 64, y: 131, w: 16, h: 13, z: 1 },
  { asset: 'f1545', x: 80, y: 144, w: 16, h: 16, z: 2 },
  { asset: 'buried', x: 16, y: 10, w: 16, h: 16, z: 500 },
  { asset: 'a821', x: 32, y: 25, w: 16, h: 16, z: 500 },
  { asset: 'a821', x: 48, y: 25, w: 16, h: 16, z: 500 },
  { asset: 'watergrass3', x: 65, y: 60, w: 16, h: 16, z: 500 },
  { asset: 'watergrass6', x: 80, y: 68, w: 12, h: 12, z: 500 },
  { asset: 'watergrass3', x: 65, y: 73, w: 16, h: 16, z: 500 },
  { asset: 'watergrass3', x: 16, y: 115, w: 16, h: 16, z: 500 },
  { asset: 'watergrass6', x: 9, y: 127, w: 12, h: 12, z: 500 },
  { asset: 'a819', x: 32, y: 131, w: 16, h: 16, z: 500 },
  { asset: 'a820', x: 48, y: 131, w: 16, h: 16, z: 500 },
  { asset: 'buried', x: 64, y: 144, w: 16, h: 16, z: 500 },
];

const BRIDGE_WATER_ROW_OFFSETS = [48, 64, 80, 96, 112, 128] as const;
const BRIDGE_WEST_WATER_ROW_OFFSETS = [32, 48, 64, 80, 96, 112, 128, 144] as const;
const BRIDGE_EAST_WATER_ROW_OFFSETS = [32, 48, 64, 80, 96, 112] as const;

/** Forest canopy details removed in export (13) so the wider west water edge remains visible. */
export const BRIDGE_OBSTACLE_HIDDEN_FOREST_SPRITES:
readonly BridgeObstacleHiddenForestSpriteSpec[] = [
  {
    assetId: 1181,
    x: -16,
    y: 48,
    w: 16,
    h: 16,
    z: 120,
    direction: 'north',
    flipX: true,
    flipY: false,
  },
  {
    assetId: 580,
    x: -10,
    y: 80,
    w: 14,
    h: 16,
    z: 120,
    direction: 'north',
    flipX: false,
    flipY: false,
  },
  {
    assetId: 32,
    x: -10,
    y: 96,
    w: 16,
    h: 16,
    z: 112,
    direction: 'north',
    flipX: false,
    flipY: false,
  },
  {
    assetId: 580,
    x: -10,
    y: 112,
    w: 14,
    h: 16,
    z: 120,
    direction: 'north',
    flipX: false,
    flipY: false,
  },
  {
    assetId: 32,
    x: -10,
    y: 128,
    w: 16,
    h: 16,
    z: 112,
    direction: 'north',
    flipX: false,
    flipY: false,
  },
  {
    assetId: 580,
    x: -10,
    y: 144,
    w: 14,
    h: 16,
    z: 120,
    direction: 'north',
    flipX: false,
    flipY: false,
  },
];

/**
 * Existing atlas ground elements repainted in the style-editor export.
 * They sort after the UUID elements above, hiding the oversized f1988 bank
 * beneath the water exactly as it appears in the editor.
 */
export const BRIDGE_OBSTACLE_TERRAIN_SPRITES: readonly BridgeObstacleSpriteSpec[] = [
  ...BRIDGE_WEST_WATER_ROW_OFFSETS.map((y) => ({
    asset: 'f563' as const,
    x: -16,
    y,
    w: 16,
    h: 16,
    z: 2,
  })),
  ...BRIDGE_EAST_WATER_ROW_OFFSETS.map((y) => ({
    asset: 'f563' as const,
    x: 96,
    y,
    w: 16,
    h: 16,
    // The final three rows occupy the upper south-west-corner root column,
    // whose corrected forest ground belongs at normal terrain level.
    z: y >= 80 ? 0 : 2,
  })),
  { asset: 'f563', x: 96, y: 128, w: 16, h: 16, z: -1 },
  { asset: 'f1987', x: 0, y: 32, w: 16, h: 16, z: 0 },
  { asset: 'f1988', x: 16, y: 32, w: 16, h: 16, z: 0 },
  { asset: 'f1988', x: 32, y: 32, w: 16, h: 16, z: 0 },
  { asset: 'f1988', x: 48, y: 32, w: 16, h: 16, z: 0 },
  { asset: 'f1988', x: 64, y: 32, w: 16, h: 16, z: 0 },
  { asset: 'f1992', x: 80, y: 32, w: 16, h: 16, z: 0 },
  ...BRIDGE_WATER_ROW_OFFSETS.flatMap((y) =>
    Array.from({ length: 6 }, (_, column) => ({
      asset: 'f563' as const,
      x: column * 16,
      y,
      w: 16,
      h: 16,
      z: 0,
    })),
  ),
  { asset: 'f1485', x: 0, y: 144, w: 16, h: 16, z: 0 },
  { asset: 'f563', x: 80, y: 144, w: 16, h: 16, z: 0 },
];

export function getBridgeObstacleAssetPath(asset: BridgeObstacleAsset): string {
  return BRIDGE_OBSTACLE_ASSET_PATH_BY_ID[asset];
}

/** Resolve sprite pieces that belong to one of the central puzzle stones. */
export function getBridgeWalkwayTileForSpec(
  spec: BridgeObstacleSpriteSpec,
): { row: number; column: number } | null {
  if (spec.x !== 32 && spec.x !== 48) return null;
  const row = BRIDGE_WALKWAY_ROW_Y.findIndex((rowY) => rowY === spec.y);
  return row < 0 ? null : { row, column: spec.x === 32 ? 0 : 1 };
}

export function getBridgeRepairCircleSideForSpec(
  spec: BridgeObstacleSpriteSpec,
): BridgeEntrySide | null {
  if (spec.asset !== 'buried') return null;
  if (spec.x === 16 && spec.y === 10) return 'north';
  if (spec.x === 64 && spec.y === 144) return 'south';
  return null;
}

export const BRIDGE_OBSTACLE_ASSET_PATHS = [
  ...new Set(Object.values(BRIDGE_OBSTACLE_ASSET_PATH_BY_ID)),
];
