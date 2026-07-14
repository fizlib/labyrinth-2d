export interface PortalPlatformSpriteSpec {
  asset: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z?: number;
}

export const PORTAL_VISUAL_OFFSET_X = -1;
/** Below the minimum player-feet Y on the platform, so players sort above it. */
export const PORTAL_PLATFORM_BASE_Z_OFFSET = 13;
/** Also below platform player-feet Y; used by the portal arch in entity sorting. */
export const PORTAL_RENDER_Z_OFFSET = 15;

export const PORTAL_PLATFORM_GROUND_SPRITES: readonly PortalPlatformSpriteSpec[] = [
  { asset: 'f1284', x: 30, y: 3, w: 16, h: 15 },
  { asset: 'f1286', x: -53, y: 7, w: 16, h: 16 },
  { asset: 'f1285', x: 44, y: 7, w: 16, h: 15 },
  { asset: 'f1159', x: -80, y: 12, w: 16, h: 16 },
  { asset: 'f404', x: -64, y: 12, w: 16, h: 16 },
  { asset: 'f405', x: -48, y: 12, w: 16, h: 16 },
  { asset: 'f403', x: 32, y: 12, w: 16, h: 16 },
  { asset: 'f1203', x: 48, y: 12, w: 16, h: 16 },
  { asset: 'f1158', x: 64, y: 12, w: 16, h: 16 },
  { asset: 'f1159', x: -80, y: 28, w: 16, h: 16 },
  { asset: 'f402', x: -64, y: 28, w: 16, h: 16 },
  { asset: 'f403', x: -48, y: 28, w: 16, h: 16 },
  { asset: 'f405', x: 32, y: 28, w: 16, h: 16 },
  { asset: 'f1202', x: 48, y: 28, w: 16, h: 16 },
  { asset: 'f1161', x: 64, y: 28, w: 16, h: 16 },
  { asset: 'f1156', x: -80, y: 44, w: 16, h: 16 },
  { asset: 'f404', x: -64, y: 44, w: 16, h: 16 },
  { asset: 'f405', x: -48, y: 44, w: 16, h: 16 },
  { asset: 'f1202', x: -32, y: 44, w: 16, h: 16 },
  { asset: 'f402', x: 16, y: 44, w: 16, h: 16 },
  { asset: 'f404', x: 32, y: 44, w: 16, h: 16 },
  { asset: 'f404', x: 48, y: 44, w: 16, h: 16 },
  { asset: 'f1164', x: 64, y: 44, w: 16, h: 16 },
  { asset: 'f1209', x: -80, y: 60, w: 16, h: 16 },
  { asset: 'f1105', x: -64, y: 60, w: 16, h: 16 },
  { asset: 'f1203', x: -48, y: 60, w: 16, h: 16 },
  { asset: 'f1202', x: -32, y: 60, w: 16, h: 16 },
  { asset: 'f404', x: 16, y: 60, w: 16, h: 16 },
  { asset: 'f403', x: 32, y: 60, w: 16, h: 16 },
  { asset: 'f1104', x: 48, y: 60, w: 16, h: 16 },
  { asset: 'f1211', x: 64, y: 60, w: 16, h: 16 },
  { asset: 'f1159', x: -64, y: 76, w: 16, h: 16 },
  { asset: 'f404', x: -48, y: 76, w: 16, h: 16 },
  { asset: 'f403', x: -32, y: 76, w: 16, h: 16 },
  { asset: 'f402', x: -16, y: 76, w: 16, h: 16 },
  { asset: 'f404', x: 0, y: 76, w: 16, h: 16 },
  { asset: 'f403', x: 16, y: 76, w: 16, h: 16 },
  { asset: 'f403', x: 32, y: 76, w: 16, h: 16 },
  { asset: 'f1161', x: 48, y: 76, w: 16, h: 16 },
  { asset: 'f1159', x: -64, y: 92, w: 16, h: 16 },
  { asset: 'f402', x: -48, y: 92, w: 16, h: 16 },
  { asset: 'f403', x: -32, y: 92, w: 16, h: 16 },
  { asset: 'f404', x: -16, y: 92, w: 16, h: 16 },
  { asset: 'f402', x: 0, y: 92, w: 16, h: 16 },
  { asset: 'f403', x: 16, y: 92, w: 16, h: 16 },
  { asset: 'f404', x: 32, y: 92, w: 16, h: 16 },
  { asset: 'f1158', x: 48, y: 92, w: 16, h: 16 },
];

export const PORTAL_PLATFORM_STRUCTURE_SPRITES: readonly PortalPlatformSpriteSpec[] = [
  { asset: 't9', x: -32, y: -4, w: 16, h: 16 },
  { asset: 't8', x: -16, y: -4, w: 16, h: 16 },
  { asset: 't11', x: 0, y: -4, w: 16, h: 16 },
  { asset: 't8', x: 16, y: -4, w: 16, h: 16 },
  { asset: 't157', x: -39, y: 12, w: 7, h: 16 },
  { asset: 't11', x: -32, y: 12, w: 16, h: 16 },
  { asset: 't8', x: -16, y: 12, w: 16, h: 16 },
  { asset: 't11', x: 0, y: 12, w: 16, h: 16 },
  { asset: 't9', x: 16, y: 12, w: 16, h: 16 },
  { asset: 't163', x: 32, y: 12, w: 7, h: 16 },
  { asset: 't157', x: -39, y: 28, w: 7, h: 16 },
  { asset: 't3', x: -32, y: 28, w: 16, h: 16 },
  { asset: 't108', x: -32, y: 28, w: 16, h: 16 },
  { asset: 't11', x: -16, y: 28, w: 16, h: 16 },
  { asset: 't8', x: 0, y: 28, w: 16, h: 16 },
  { asset: 't9', x: 16, y: 28, w: 16, h: 16 },
  { asset: 't163', x: 32, y: 28, w: 7, h: 16 },
  { asset: 't207', x: -39, y: 44, w: 7, h: 13 },
  { asset: 't258', x: -32, y: 44, w: 16, h: 16 },
  { asset: 't56', x: -16, y: 44, w: 16, h: 16 },
  { asset: 't58', x: 0, y: 44, w: 16, h: 16 },
  { asset: 't262', x: 16, y: 44, w: 16, h: 16 },
  { asset: 't213', x: 32, y: 44, w: 7, h: 13 },
  { asset: 't308', x: -29, y: 60, w: 13, h: 9 },
  { asset: 't56', x: -16, y: 60, w: 16, h: 16 },
  { asset: 't58', x: 0, y: 60, w: 16, h: 16 },
  { asset: 't312', x: 16, y: 60, w: 13, h: 9 },
  { asset: 't311', x: -32, y: -11, w: 16, h: 9, z: 1 },
  { asset: 't310', x: -16, y: -11, w: 16, h: 9, z: 1 },
  { asset: 't310', x: 0, y: -11, w: 16, h: 9, z: 1 },
  { asset: 't310', x: 16, y: -11, w: 16, h: 9, z: 1 },
  { asset: 't112', x: 16, y: 28, w: 16, h: 16, z: 1 },
];

export function getPortalPlatformAssetPath(asset: string): string {
  const assetId = asset.slice(1);
  return asset.startsWith('t')
    ? `/assets/portal-platform/Sprite_Tormund_${assetId}.png`
    : `/assets/chained-echoes-assets-sorted/Assets/Maps/Fiorwoods/Sprite_Fiorwoods_${assetId}.png`;
}

export const PORTAL_PLATFORM_ASSET_PATHS = [
  ...new Set(
    [...PORTAL_PLATFORM_GROUND_SPRITES, ...PORTAL_PLATFORM_STRUCTURE_SPRITES].map(
      (spec) => getPortalPlatformAssetPath(spec.asset),
    ),
  ),
];
