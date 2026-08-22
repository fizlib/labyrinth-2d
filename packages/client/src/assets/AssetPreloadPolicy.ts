export interface AssetPreloadDeviceSignals {
  maxTouchPoints: number;
  coarsePointer: boolean;
}

/**
 * Phones and tablets have a much smaller browser-process memory budget. Avoid
 * decoding the full authored texture library while their renderer is still
 * being created; the normal staged loader starts once Pixi is ready instead.
 */
export function shouldWarmGameAssetsInBackground({
  maxTouchPoints,
  coarsePointer,
}: AssetPreloadDeviceSignals): boolean {
  return maxTouchPoints <= 0 && !coarsePointer;
}
