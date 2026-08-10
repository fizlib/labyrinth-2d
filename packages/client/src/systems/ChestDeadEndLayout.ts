import type { ChestCount, ChestSlot } from '@labyrinth/shared';
import { getFiorwoodsRuntimeAssetPath } from '../assets/runtimeAssetPaths';

export type ChestDeadEndAsset = keyof typeof CHEST_DEAD_END_ASSET_PATH_BY_ID;

export interface ChestDeadEndSpriteSpec {
  asset: ChestDeadEndAsset;
  name: string;
  nativeWidth: number;
  nativeHeight: number;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  layer: 'terrain' | 'backdrop' | 'prop';
}

export interface ChestDeadEndChestSpritePair {
  closed: ChestDeadEndSpriteSpec;
  open: ChestDeadEndSpriteSpec;
}

const CHEST_DEAD_END_ASSET_PATH_BY_ID = {
  chest: '/assets/chest-dead-end/chest01_0.png',
  chestOpen: '/assets/chest-dead-end/chest01_16.png',
  f155: getFiorwoodsRuntimeAssetPath(155),
  f1105: getFiorwoodsRuntimeAssetPath(1105),
  f1110: getFiorwoodsRuntimeAssetPath(1110),
  f1112: getFiorwoodsRuntimeAssetPath(1112),
  f1114: getFiorwoodsRuntimeAssetPath(1114),
  f1154: getFiorwoodsRuntimeAssetPath(1154),
  f1206: getFiorwoodsRuntimeAssetPath(1206),
  f1207: getFiorwoodsRuntimeAssetPath(1207),
  f1211: getFiorwoodsRuntimeAssetPath(1211),
  f1285: getFiorwoodsRuntimeAssetPath(1285),
  f1577: getFiorwoodsRuntimeAssetPath(1577),
  f1578: getFiorwoodsRuntimeAssetPath(1578),
  f1579: getFiorwoodsRuntimeAssetPath(1579),
  f1580: getFiorwoodsRuntimeAssetPath(1580),
  f1581: getFiorwoodsRuntimeAssetPath(1581),
  f1627: getFiorwoodsRuntimeAssetPath(1627),
  f1628: getFiorwoodsRuntimeAssetPath(1628),
  f1629: getFiorwoodsRuntimeAssetPath(1629),
  f1630: getFiorwoodsRuntimeAssetPath(1630),
  f1631: getFiorwoodsRuntimeAssetPath(1631),
} as const;

/** Exact south-opening dead-end composition exported from the style editor. */
export const CHEST_DEAD_END_SPRITES = [
  {
    asset: 'f1112',
    name: 'Sprite_Fiorwoods_1112',
    nativeWidth: 32,
    nativeHeight: 32,
    x: 16,
    y: 16,
    w: 16,
    h: 16,
    z: 0,
    layer: 'terrain',
  },
  {
    asset: 'f1110',
    name: 'Sprite_Fiorwoods_1110',
    nativeWidth: 32,
    nativeHeight: 32,
    x: 32,
    y: 16,
    w: 16,
    h: 16,
    z: 0,
    layer: 'terrain',
  },
  {
    asset: 'f1114',
    name: 'Sprite_Fiorwoods_1114',
    nativeWidth: 32,
    nativeHeight: 32,
    x: 48,
    y: 16,
    w: 16,
    h: 16,
    z: 0,
    layer: 'terrain',
  },
  {
    asset: 'f155',
    name: 'Sprite_Fiorwoods_155',
    nativeWidth: 32,
    nativeHeight: 32,
    x: 64,
    y: 16,
    w: 16,
    h: 16,
    z: 0,
    layer: 'terrain',
  },
  {
    asset: 'f1206',
    name: 'Sprite_Fiorwoods_1206',
    nativeWidth: 32,
    nativeHeight: 32,
    x: 16,
    y: 32,
    w: 16,
    h: 16,
    z: 0,
    layer: 'terrain',
  },
  {
    asset: 'f1105',
    name: 'Sprite_Fiorwoods_1105',
    nativeWidth: 32,
    nativeHeight: 32,
    x: 32,
    y: 32,
    w: 16,
    h: 16,
    z: 0,
    layer: 'terrain',
  },
  {
    asset: 'f1154',
    name: 'Sprite_Fiorwoods_1154',
    nativeWidth: 32,
    nativeHeight: 32,
    x: 48,
    y: 32,
    w: 16,
    h: 16,
    z: 0,
    layer: 'terrain',
  },
  {
    asset: 'f1114',
    name: 'Sprite_Fiorwoods_1114',
    nativeWidth: 32,
    nativeHeight: 32,
    x: 64,
    y: 32,
    w: 16,
    h: 16,
    z: 0,
    layer: 'terrain',
  },
  {
    asset: 'f1206',
    name: 'Sprite_Fiorwoods_1206',
    nativeWidth: 32,
    nativeHeight: 32,
    x: 32,
    y: 48,
    w: 16,
    h: 16,
    z: 0,
    layer: 'terrain',
  },
  {
    asset: 'f1207',
    name: 'Sprite_Fiorwoods_1207',
    nativeWidth: 32,
    nativeHeight: 32,
    x: 48,
    y: 48,
    w: 16,
    h: 16,
    z: 0,
    layer: 'terrain',
  },
  {
    asset: 'f1211',
    name: 'Sprite_Fiorwoods_1211',
    nativeWidth: 32,
    nativeHeight: 32,
    x: 64,
    y: 48,
    w: 16,
    h: 16,
    z: 0,
    layer: 'terrain',
  },
  {
    asset: 'f1627',
    name: 'Sprite_Fiorwoods_1627',
    nativeWidth: 20,
    nativeHeight: 27,
    x: 16,
    y: 3,
    w: 10,
    h: 13,
    z: 154002,
    layer: 'backdrop',
  },
  {
    asset: 'f1577',
    name: 'Sprite_Fiorwoods_1577',
    nativeWidth: 20,
    nativeHeight: 17,
    x: 16,
    y: -5,
    w: 10,
    h: 8,
    z: 154108,
    layer: 'backdrop',
  },
  {
    asset: 'f1628',
    name: 'Sprite_Fiorwoods_1628',
    nativeWidth: 32,
    nativeHeight: 30,
    x: 26,
    y: 3,
    w: 16,
    h: 15,
    z: 154108,
    layer: 'backdrop',
  },
  {
    asset: 'f1578',
    name: 'Sprite_Fiorwoods_1578',
    nativeWidth: 32,
    nativeHeight: 17,
    x: 26,
    y: -5,
    w: 16,
    h: 9,
    z: 154108,
    layer: 'backdrop',
  },
  {
    asset: 'f1629',
    name: 'Sprite_Fiorwoods_1629',
    nativeWidth: 32,
    nativeHeight: 32,
    x: 42,
    y: 3,
    w: 16,
    h: 15,
    z: 154108,
    layer: 'backdrop',
  },
  {
    asset: 'f1630',
    name: 'Sprite_Fiorwoods_1630',
    nativeWidth: 32,
    nativeHeight: 30,
    x: 58,
    y: 2,
    w: 16,
    h: 15,
    z: 154108,
    layer: 'backdrop',
  },
  {
    asset: 'f1631',
    name: 'Sprite_Fiorwoods_1631',
    nativeWidth: 29,
    nativeHeight: 29,
    x: 74,
    y: 2,
    w: 15,
    h: 15,
    z: 154108,
    layer: 'backdrop',
  },
  {
    asset: 'f1581',
    name: 'Sprite_Fiorwoods_1581',
    nativeWidth: 27,
    nativeHeight: 10,
    x: 74,
    y: -3,
    w: 14,
    h: 5,
    z: 154108,
    layer: 'backdrop',
  },
  {
    asset: 'f1580',
    name: 'Sprite_Fiorwoods_1580',
    nativeWidth: 32,
    nativeHeight: 14,
    x: 58,
    y: -5,
    w: 16,
    h: 7,
    z: 154108,
    layer: 'backdrop',
  },
  {
    asset: 'f1579',
    name: 'Sprite_Fiorwoods_1579',
    nativeWidth: 32,
    nativeHeight: 10,
    x: 42,
    y: -2,
    w: 16,
    h: 5,
    z: 154108,
    layer: 'backdrop',
  },
  {
    asset: 'f1285',
    name: 'Sprite_Fiorwoods_1285',
    nativeWidth: 31,
    nativeHeight: 29,
    x: 59,
    y: 23,
    w: 15,
    h: 15,
    z: 1,
    layer: 'prop',
  },
] as const satisfies readonly ChestDeadEndSpriteSpec[];

function chestSpritePair(x: number, y: number): ChestDeadEndChestSpritePair {
  return {
    closed: {
      asset: 'chest',
      name: 'chest01 0',
      nativeWidth: 30,
      nativeHeight: 25,
      x,
      y,
      w: 15,
      h: 13,
      z: 500,
      layer: 'prop',
    },
    open: {
      asset: 'chestOpen',
      name: 'chest01 16',
      nativeWidth: 30,
      nativeHeight: 37,
      x,
      y: y - 5,
      w: 15,
      h: 18,
      z: 501,
      layer: 'prop',
    },
  };
}

/** Exact one-, two-, and three-chest arrangements exported from the style editor. */
export const CHEST_DEAD_END_CHEST_LAYOUTS: Readonly<
  Record<ChestCount, readonly ChestDeadEndChestSpritePair[]>
> = {
  1: [chestSpritePair(34, 23)],
  2: [chestSpritePair(34, 23), chestSpritePair(59, 38)],
  3: [chestSpritePair(20, 22), chestSpritePair(44, 22), chestSpritePair(64, 38)],
};

export function getChestDeadEndChestSpritePair(
  chestCount: ChestCount,
  chestSlot: ChestSlot,
): ChestDeadEndChestSpritePair {
  const pair = CHEST_DEAD_END_CHEST_LAYOUTS[chestCount][chestSlot];
  if (!pair) throw new Error(`Missing chest sprites for count ${chestCount}, slot ${chestSlot}`);
  return pair;
}

export function getChestDeadEndAssetPath(asset: ChestDeadEndAsset): string {
  return CHEST_DEAD_END_ASSET_PATH_BY_ID[asset];
}

export const CHEST_DEAD_END_ASSET_PATHS = [
  ...new Set(Object.values(CHEST_DEAD_END_ASSET_PATH_BY_ID)),
];
