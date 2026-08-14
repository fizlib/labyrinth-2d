export const FIORWOODS_RUNTIME_ROOT = '/assets/fiorwoods-runtime';
export const STYLE_LIBRARY_PUBLIC_ROOT = '/assets/chained-echoes-assets-sorted';
export const RUNTIME_STYLE_PUBLIC_ROOT = '/assets/runtime-style';

export function getFiorwoodsRuntimeAssetPath(assetId: number): string {
  return `${FIORWOODS_RUNTIME_ROOT}/Sprite_Fiorwoods_${assetId}.png`;
}

/** Resolve a source-library URL to the small, tracked runtime export. */
export function resolveRuntimeStyleAssetPath(assetPath: string): string {
  if (!assetPath.startsWith(`${STYLE_LIBRARY_PUBLIC_ROOT}/`)) return assetPath;
  return `${RUNTIME_STYLE_PUBLIC_ROOT}${assetPath.slice(STYLE_LIBRARY_PUBLIC_ROOT.length)}`;
}

/** Build a URL for a source-library-relative file in the tracked runtime export. */
export function getRuntimeStyleAssetPath(relativePath: string): string {
  return `${RUNTIME_STYLE_PUBLIC_ROOT}/${relativePath
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`;
}
