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

export const SWAMP_OBSTACLE_TERRAIN_SPRITES: readonly SwampObstacleSpriteSpec[] =
  TERRAIN_ASSET_GRID.flatMap((row, rowIndex) =>
    row.map((asset, columnIndex) => ({
      asset,
      x: columnIndex * 16,
      y: rowIndex * 16,
      w: 16,
      h: 16,
      z: 0,
    })),
  );

/** Lilies and shoreline vegetation exported from style export (17). */
export const SWAMP_OBSTACLE_DETAIL_SPRITES: readonly SwampObstacleSpriteSpec[] = [
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
];

export function getSwampObstacleAssetPath(asset: SwampObstacleAsset): string {
  return SWAMP_OBSTACLE_ASSET_PATH_BY_ID[asset];
}

export const SWAMP_OBSTACLE_ASSET_PATHS = [
  ...new Set(Object.values(SWAMP_OBSTACLE_ASSET_PATH_BY_ID)),
] as const;
