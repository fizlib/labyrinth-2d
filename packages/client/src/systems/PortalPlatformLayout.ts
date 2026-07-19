import { getFiorwoodsRuntimeAssetPath } from '../assets/runtimeAssetPaths';

export interface PortalPlatformSpriteSpec {
  asset: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z?: number;
}

export const PORTAL_VISUAL_OFFSET_X = -1;
/** Default masonry-edge sort pivot: upper players render behind it, lower players in front. */
export const PORTAL_PLATFORM_BASE_Z_OFFSET = 15;
/** Portal Y + 13: one layer above the portal's north forest-wall row. */
const PORTAL_PLATFORM_SURFACE_Z_OFFSET = -2;
/** Keeps players above the surface while they occupy its non-rectangular footprint. */
const PORTAL_PLATFORM_PLAYER_Z_FLOOR_OFFSET =
  PORTAL_PLATFORM_BASE_Z_OFFSET + PORTAL_PLATFORM_SURFACE_Z_OFFSET + 1;
/** Portal arch sort pivot, slightly in front of the masonry base. */
export const PORTAL_RENDER_Z_OFFSET = 15;

export function getPortalPlatformPlayerZFloor(
  playerX: number,
  playerY: number,
  portalX: number,
  portalY: number,
): number | null {
  const localX = playerX - portalX;
  const localY = playerY - portalY;
  const onUpperPlatform = localX >= -32 && localX <= 31 &&
    localY >= 8 && localY <= 49;
  const onStairs = localX >= -16 && localX <= 15 &&
    localY > 49 && localY <= 108;
  return onUpperPlatform || onStairs
    ? Math.round(portalY) + PORTAL_PLATFORM_PLAYER_Z_FLOOR_OFFSET
    : null;
}

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

/** Ground-edge tiles authored above the forest underlay at the platform foot. */
export const PORTAL_PLATFORM_GROUND_DETAIL_SPRITES: readonly PortalPlatformSpriteSpec[] =
  [
    { asset: 'f1209', x: -63, y: 108, w: 16, h: 16 },
    { asset: 'f1213', x: -47, y: 108, w: 16, h: 16 },
    { asset: 'f1213', x: -31, y: 108, w: 16, h: 16 },
    { asset: 'f1210', x: -15, y: 108, w: 16, h: 16 },
    { asset: 'f1207', x: 1, y: 108, w: 16, h: 16 },
    { asset: 'f1210', x: 17, y: 108, w: 16, h: 16 },
    { asset: 'f1213', x: 33, y: 108, w: 16, h: 16 },
    { asset: 'f1214', x: 49, y: 108, w: 16, h: 16 },
  ];

export const PORTAL_PLATFORM_STRUCTURE_SPRITES: readonly PortalPlatformSpriteSpec[] = [
  { asset: 't9', x: -32, y: -4, w: 16, h: 16, z: PORTAL_PLATFORM_SURFACE_Z_OFFSET },
  { asset: 't8', x: -16, y: -4, w: 16, h: 16, z: PORTAL_PLATFORM_SURFACE_Z_OFFSET },
  { asset: 't11', x: 0, y: -4, w: 16, h: 16, z: PORTAL_PLATFORM_SURFACE_Z_OFFSET },
  { asset: 't8', x: 16, y: -4, w: 16, h: 16, z: PORTAL_PLATFORM_SURFACE_Z_OFFSET },
  { asset: 't157', x: -39, y: 12, w: 7, h: 16 },
  { asset: 't11', x: -32, y: 12, w: 16, h: 16, z: PORTAL_PLATFORM_SURFACE_Z_OFFSET },
  { asset: 't8', x: -16, y: 12, w: 16, h: 16, z: PORTAL_PLATFORM_SURFACE_Z_OFFSET },
  { asset: 't11', x: 0, y: 12, w: 16, h: 16, z: PORTAL_PLATFORM_SURFACE_Z_OFFSET },
  { asset: 't9', x: 16, y: 12, w: 16, h: 16, z: PORTAL_PLATFORM_SURFACE_Z_OFFSET },
  { asset: 't163', x: 32, y: 12, w: 7, h: 16 },
  { asset: 't157', x: -39, y: 28, w: 7, h: 16 },
  { asset: 't3', x: -32, y: 28, w: 16, h: 16 },
  { asset: 't108', x: -32, y: 28, w: 16, h: 16 },
  { asset: 't11', x: -16, y: 28, w: 16, h: 16, z: PORTAL_PLATFORM_SURFACE_Z_OFFSET },
  { asset: 't8', x: 0, y: 28, w: 16, h: 16, z: PORTAL_PLATFORM_SURFACE_Z_OFFSET },
  { asset: 't9', x: 16, y: 28, w: 16, h: 16, z: PORTAL_PLATFORM_SURFACE_Z_OFFSET },
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
  { asset: 't311', x: -32, y: -11, w: 16, h: 9, z: PORTAL_PLATFORM_SURFACE_Z_OFFSET },
  { asset: 't310', x: -16, y: -11, w: 16, h: 9, z: PORTAL_PLATFORM_SURFACE_Z_OFFSET },
  { asset: 't310', x: 0, y: -11, w: 16, h: 9, z: PORTAL_PLATFORM_SURFACE_Z_OFFSET },
  { asset: 't310', x: 16, y: -11, w: 16, h: 9, z: PORTAL_PLATFORM_SURFACE_Z_OFFSET },
  { asset: 't112', x: 16, y: 28, w: 16, h: 16, z: 1 },
];

export function getPortalPlatformAssetPath(asset: string): string {
  const assetId = asset.slice(1);
  return asset.startsWith('t')
    ? `/assets/portal-platform/Sprite_Tormund_${assetId}.png`
    : getFiorwoodsRuntimeAssetPath(Number(assetId));
}

export const PORTAL_PLATFORM_ASSET_PATHS = [
  ...new Set(
    [
      ...PORTAL_PLATFORM_GROUND_SPRITES,
      ...PORTAL_PLATFORM_GROUND_DETAIL_SPRITES,
      ...PORTAL_PLATFORM_STRUCTURE_SPRITES,
    ].map((spec) => getPortalPlatformAssetPath(spec.asset)),
  ),
];
