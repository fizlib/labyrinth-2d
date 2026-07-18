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
  f563: '/assets/chained-echoes-assets-sorted/Assets/Maps/Fiorwoods/Sprite_Fiorwoods_563.png',
  f1437:
    '/assets/chained-echoes-assets-sorted/Assets/Maps/Fiorwoods/Sprite_Fiorwoods_1437.png',
  f1443:
    '/assets/chained-echoes-assets-sorted/Assets/Maps/Fiorwoods/Sprite_Fiorwoods_1443.png',
  f1446:
    '/assets/chained-echoes-assets-sorted/Assets/Maps/Fiorwoods/Sprite_Fiorwoods_1446.png',
  f1447:
    '/assets/chained-echoes-assets-sorted/Assets/Maps/Fiorwoods/Sprite_Fiorwoods_1447.png',
  f1485:
    '/assets/chained-echoes-assets-sorted/Assets/Maps/Fiorwoods/Sprite_Fiorwoods_1485.png',
  f1537:
    '/assets/chained-echoes-assets-sorted/Assets/Maps/Fiorwoods/Sprite_Fiorwoods_1537.png',
  f1542:
    '/assets/chained-echoes-assets-sorted/Assets/Maps/Fiorwoods/Sprite_Fiorwoods_1542.png',
  f1545:
    '/assets/chained-echoes-assets-sorted/Assets/Maps/Fiorwoods/Sprite_Fiorwoods_1545.png',
  f1587:
    '/assets/chained-echoes-assets-sorted/Assets/Maps/Fiorwoods/Sprite_Fiorwoods_1587.png',
  f1591:
    '/assets/chained-echoes-assets-sorted/Assets/Maps/Fiorwoods/Sprite_Fiorwoods_1591.png',
  f1592:
    '/assets/chained-echoes-assets-sorted/Assets/Maps/Fiorwoods/Sprite_Fiorwoods_1592.png',
  f1987:
    '/assets/chained-echoes-assets-sorted/Assets/Maps/Fiorwoods/Sprite_Fiorwoods_1987.png',
  f1988:
    '/assets/chained-echoes-assets-sorted/Assets/Maps/Fiorwoods/Sprite_Fiorwoods_1988.png',
  f1992:
    '/assets/chained-echoes-assets-sorted/Assets/Maps/Fiorwoods/Sprite_Fiorwoods_1992.png',
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

export const BRIDGE_OBSTACLE_ASSET_PATHS = [
  ...new Set(Object.values(BRIDGE_OBSTACLE_ASSET_PATH_BY_ID)),
];
