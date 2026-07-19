export const FIORWOODS_RUNTIME_ROOT = '/assets/fiorwoods-runtime';

export function getFiorwoodsRuntimeAssetPath(assetId: number): string {
  return `${FIORWOODS_RUNTIME_ROOT}/Sprite_Fiorwoods_${assetId}.png`;
}
