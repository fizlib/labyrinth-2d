import swordFieldRuntimeAssets from '../assets/swordFieldRuntimeAssets.json';
import { getRuntimeStyleAssetPath } from '../assets/runtimeAssetPaths';

export type SwordFieldAssetId = keyof typeof swordFieldRuntimeAssets;

export interface SwordFieldSpriteSpec {
  asset: SwordFieldAssetId;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Exact 12×6 ground repaint from the supplied style-editor layout. */
const TERRAIN_GRID: readonly (readonly SwordFieldAssetId[])[] = [
  [
    'Sprite_Fiorwoods_1109',
    'Sprite_Fiorwoods_1110',
    'Sprite_Fiorwoods_1113',
    'Sprite_Fiorwoods_1107',
    'Sprite_Fiorwoods_1113',
    'Sprite_Fiorwoods_1110',
    'Sprite_Fiorwoods_1113',
    'Sprite_Fiorwoods_1110',
    'Sprite_Fiorwoods_1113',
    'Sprite_Fiorwoods_1107',
    'Sprite_Fiorwoods_1108',
    'Sprite_Fiorwoods_105',
  ],
  [
    'Sprite_Fiorwoods_1212',
    'Sprite_Fiorwoods_1103',
    'Sprite_Fiorwoods_1202',
    'Sprite_Fiorwoods_1205',
    'Sprite_Fiorwoods_1203',
    'Sprite_Fiorwoods_1202',
    'Sprite_Fiorwoods_1205',
    'Sprite_Fiorwoods_1205',
    'Sprite_Fiorwoods_1202',
    'Sprite_Fiorwoods_1205',
    'Sprite_Fiorwoods_1152',
    'Sprite_Fiorwoods_1114',
  ],
  [
    'Sprite_Fiorwoods_1112',
    'Sprite_Fiorwoods_1153',
    'Sprite_Fiorwoods_1203',
    'Sprite_Fiorwoods_1204',
    'Sprite_Fiorwoods_1202',
    'Sprite_Fiorwoods_1203',
    'Sprite_Fiorwoods_1204',
    'Sprite_Fiorwoods_1203',
    'Sprite_Fiorwoods_1203',
    'Sprite_Fiorwoods_1204',
    'Sprite_Fiorwoods_1202',
    'Sprite_Fiorwoods_1164',
  ],
  [
    'Sprite_Fiorwoods_1156',
    'Sprite_Fiorwoods_1204',
    'Sprite_Fiorwoods_1204',
    'Sprite_Fiorwoods_1203',
    'Sprite_Fiorwoods_1205',
    'Sprite_Fiorwoods_1204',
    'Sprite_Fiorwoods_1202',
    'Sprite_Fiorwoods_1204',
    'Sprite_Fiorwoods_1204',
    'Sprite_Fiorwoods_1203',
    'Sprite_Fiorwoods_1205',
    'Sprite_Fiorwoods_1158',
  ],
  [
    'Sprite_Fiorwoods_1162',
    'Sprite_Fiorwoods_1203',
    'Sprite_Fiorwoods_1205',
    'Sprite_Fiorwoods_1202',
    'Sprite_Fiorwoods_1204',
    'Sprite_Fiorwoods_1205',
    'Sprite_Fiorwoods_1202',
    'Sprite_Fiorwoods_1203',
    'Sprite_Fiorwoods_1205',
    'Sprite_Fiorwoods_1202',
    'Sprite_Fiorwoods_1204',
    'Sprite_Fiorwoods_1161',
  ],
  [
    'Sprite_Fiorwoods_1212',
    'Sprite_Fiorwoods_1202',
    'Sprite_Fiorwoods_1202',
    'Sprite_Fiorwoods_1205',
    'Sprite_Fiorwoods_1202',
    'Sprite_Fiorwoods_1205',
    'Sprite_Fiorwoods_1205',
    'Sprite_Fiorwoods_1202',
    'Sprite_Fiorwoods_1202',
    'Sprite_Fiorwoods_1205',
    'Sprite_Fiorwoods_1202',
    'Sprite_Fiorwoods_1211',
  ],
] as const;

export const SWORD_FIELD_TERRAIN_SPRITES: readonly SwordFieldSpriteSpec[] =
  TERRAIN_GRID.flatMap((row, rowIndex) =>
    row.map((asset, columnIndex) => ({
      asset,
      x: columnIndex * 16,
      y: rowIndex * 16,
      w: 16,
      h: 16,
    })),
  );

/** Fence, posts, and grave markers that remain after the swords are lowered. */
export const SWORD_FIELD_SCENERY_SPRITES = [
  { asset: 'Sprite_Village_159', x: 41, y: 1, w: 16, h: 16 },
  { asset: 'Sprite_Village_160', x: 57, y: 1, w: 16, h: 16 },
  { asset: 'Sprite_Village_159', x: 73, y: 1, w: 16, h: 16 },
  { asset: 'Sprite_Village_159', x: 89, y: 1, w: 16, h: 16 },
  { asset: 'Sprite_Village_160', x: 105, y: 1, w: 16, h: 16 },
  { asset: 'Sprite_Village_159', x: 121, y: 1, w: 16, h: 16 },
  { asset: 'Sprite_Village_159', x: 137, y: 1, w: 16, h: 16 },
  { asset: 'Sprite_Village_67', x: 32, y: 2, w: 9, h: 16 },
  { asset: 'Sprite_Village_68', x: 153, y: 2, w: 9, h: 16 },
  { asset: 'Sprite_Village_65', x: 6, y: 16, w: 10, h: 16 },
  { asset: 'Sprite_Village_159', x: 16, y: 16, w: 16, h: 16 },
  { asset: 'Sprite_Village_70', x: 32, y: 16, w: 10, h: 16 },
  { asset: 'Sprite_Village_158', x: 153, y: 16, w: 9, h: 16 },
  { asset: 'Sprite_Village_159', x: 162, y: 16, w: 16, h: 16 },
  { asset: 'Sprite_Village_70', x: 178, y: 16, w: 10, h: 16 },
  { asset: 'grave1', x: 80, y: 18, w: 14, h: 14 },
  { asset: 'grave1', x: 96, y: 18, w: 14, h: 14 },
  { asset: 'grave1', x: 112, y: 18, w: 14, h: 14 },
  { asset: 'Sprite_Village_158', x: 153, y: 62, w: 9, h: 16 },
  { asset: 'Sprite_Village_159', x: 162, y: 62, w: 16, h: 16 },
  { asset: 'Sprite_Village_71', x: 178, y: 62, w: 15, h: 16 },
  { asset: 'Sprite_Village_64', x: 0, y: 64, w: 16, h: 16 },
  { asset: 'Sprite_Village_159', x: 16, y: 64, w: 16, h: 16 },
  { asset: 'Sprite_Village_70', x: 32, y: 64, w: 10, h: 16 },
  { asset: 'Sprite_Village_112', x: 34, y: 71, w: 5, h: 16 },
  { asset: 'Sprite_Village_112', x: 155, y: 71, w: 5, h: 16 },
] as const satisfies readonly SwordFieldSpriteSpec[];

/** Every sword position and size from the editor export. */
export const SWORD_FIELD_SWORD_SPRITES = [
  { asset: 'sword03', x: 41, y: 1, w: 11, h: 28 },
  { asset: 'sword03', x: 128, y: 5, w: 11, h: 28 },
  { asset: 'sword04', x: 142, y: 7, w: 6, h: 23 },
  { asset: 'sword04', x: 66, y: 8, w: 6, h: 23 },
  { asset: 'sword03', x: 88, y: 14, w: 11, h: 28 },
  { asset: 'sword04', x: 78, y: 15, w: 6, h: 23 },
  { asset: 'sword04', x: 107, y: 15, w: 6, h: 23 },
  { asset: 'sword03', x: 56, y: 16, w: 11, h: 28 },
  { asset: 'sword05', x: 37, y: 19, w: 5, h: 22 },
  { asset: 'sword04', x: 29, y: 20, w: 6, h: 23 },
  { asset: 'sword04', x: 150, y: 21, w: 6, h: 23 },
  { asset: 'sword05', x: 49, y: 22, w: 5, h: 22 },
  { asset: 'sword05', x: 137, y: 22, w: 5, h: 22 },
  { asset: 'sword04', x: 68, y: 26, w: 6, h: 23 },
  { asset: 'sword03', x: 123, y: 26, w: 11, h: 28 },
  { asset: 'sword03', x: 37, y: 28, w: 11, h: 28 },
  { asset: 'sword05', x: 161, y: 28, w: 5, h: 22 },
  { asset: 'sword05', x: 99, y: 29, w: 5, h: 22 },
  { asset: 'sword04', x: 86, y: 32, w: 6, h: 23 },
  { asset: 'sword05', x: 117, y: 32, w: 5, h: 22 },
  { asset: 'sword05', x: 20, y: 33, w: 5, h: 22 },
  { asset: 'sword03', x: 139, y: 35, w: 11, h: 28 },
  { asset: 'sword03', x: 59, y: 38, w: 11, h: 28 },
  { asset: 'sword03', x: 92, y: 38, w: 11, h: 28 },
  { asset: 'sword04', x: 153, y: 38, w: 6, h: 23 },
  { asset: 'sword05', x: 77, y: 39, w: 5, h: 22 },
  { asset: 'sword04', x: 50, y: 40, w: 6, h: 23 },
  { asset: 'sword04', x: 131, y: 40, w: 6, h: 23 },
  { asset: 'sword04', x: 30, y: 42, w: 6, h: 23 },
  { asset: 'sword04', x: 107, y: 42, w: 6, h: 23 },
  { asset: 'sword03', x: 116, y: 50, w: 11, h: 28 },
  { asset: 'sword04', x: 83, y: 54, w: 6, h: 23 },
  { asset: 'sword03', x: 44, y: 55, w: 11, h: 28 },
  { asset: 'sword05', x: 69, y: 57, w: 5, h: 22 },
  { asset: 'sword04', x: 132, y: 59, w: 6, h: 23 },
  { asset: 'sword04', x: 58, y: 60, w: 6, h: 23 },
  { asset: 'sword05', x: 105, y: 60, w: 5, h: 22 },
  { asset: 'sword03', x: 74, y: 61, w: 11, h: 28 },
  { asset: 'sword04', x: 92, y: 62, w: 6, h: 23 },
  { asset: 'sword05', x: 145, y: 64, w: 5, h: 22 },
  { asset: 'sword05', x: 112, y: 67, w: 5, h: 22 },
] as const satisfies readonly SwordFieldSpriteSpec[];

export function getSwordFieldAssetPath(asset: SwordFieldAssetId): string {
  return getRuntimeStyleAssetPath(swordFieldRuntimeAssets[asset]);
}

export const SWORD_FIELD_ASSET_PATHS = [
  ...new Set(
    [
      ...SWORD_FIELD_TERRAIN_SPRITES,
      ...SWORD_FIELD_SCENERY_SPRITES,
      ...SWORD_FIELD_SWORD_SPRITES,
    ].map((spec) => getSwordFieldAssetPath(spec.asset)),
  ),
] as const;
