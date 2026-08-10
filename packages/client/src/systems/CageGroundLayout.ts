import { getFiorwoodsRuntimeAssetPath } from '../assets/runtimeAssetPaths';

export const CAGE_GROUND_TILE_SIZE = 16;

/**
 * Dark-grass base authored beneath the cage in labyrinth-style-v1 (14).
 * Offsets are measured from the cage's bottom-center/player-feet anchor.
 */
export const CAGE_GROUND_TILES = [
  { assetId: 164, x: -24, y: -17 },
  { assetId: 165, x: -8, y: -17 },
  { assetId: 166, x: 8, y: -17 },
  { assetId: 261, x: -24, y: -1 },
  { assetId: 268, x: -8, y: -1 },
  { assetId: 263, x: 8, y: -1 },
] as const;

export const CAGE_GROUND_ASSET_PATHS = CAGE_GROUND_TILES.map(({ assetId }) =>
  getFiorwoodsRuntimeAssetPath(assetId),
);
