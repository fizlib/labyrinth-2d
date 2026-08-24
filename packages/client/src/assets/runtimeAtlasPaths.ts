import { BRIDGE_OBSTACLE_ASSET_PATHS } from '../systems/BridgeObstacleLayout';
import { CAGE_GROUND_ASSET_PATHS } from '../systems/CageGroundLayout';
import { CENTRAL_HUB_ASSET_PATHS } from '../systems/CentralHubLayout.generated';
import { CHEST_DEAD_END_ASSET_PATHS } from '../systems/ChestDeadEndLayout';
import { DECORATED_VERTICAL_PASSAGE_ASSET_PATHS } from '../systems/DecoratedVerticalPassageLayout';
import { PORTAL_PLATFORM_ASSET_PATHS } from '../systems/PortalPlatformLayout';
import { SPIKE_GATE_ASSET_PATHS } from '../systems/SpikeGateLayout';
import { SWAMP_OBSTACLE_ASSET_PATHS } from '../systems/SwampObstacleLayout';
import { SWORD_FIELD_ASSET_PATHS } from '../systems/SwordFieldLayout';
import { T_INTERSECTION_DECORATION_ASSET_PATHS } from '../systems/TIntersectionDecorationLayout';
import { getFiorwoodsRuntimeAssetPath } from './runtimeAssetPaths';

export const FOREST_ASSET_NAMES = [
  'tree_primary_02.png',
  'tree_primary_03.png',
  ...Array.from({ length: 8 }, (_, index) => `fior_canopy_${index}.png`),
  'tree_small_04.png',
  'tree_small_05.png',
  'tree_small_06.png',
  'bush_01.png',
  'bush_02.png',
  'bush_03.png',
  'bush_04.png',
  ...Array.from({ length: 4 }, (_, index) => `fior_grass_${index}.png`),
  ...Array.from({ length: 4 }, (_, index) => `fior_ground_${index}.png`),
  'path_center.png',
  'path_plain_alt.png',
  'path_n.png',
  'path_ne.png',
  'path_e.png',
  'path_se.png',
  'path_s.png',
  'path_sw.png',
  'path_w.png',
  'path_nw.png',
  'tree_shadow.png',
] as const;

export const FIORWOODS_FACE_ROW_STARTS = [38, 88, 138, 188, 238, 288, 338, 388] as const;

export const FIORWOODS_STYLE_DECORATION_IDS = [
  110, 160, 438, 439, 440, 441, 442, 443, 492, 493, 539, 543, 549, 550, 580, 587, 589,
  590, 592, 593, 599, 600, 636, 637, 643, 832, 833, 847, 848, 849, 880, 881, 882, 897,
  898, 899, 930, 931, 932, 946, 947, 948, 949, 980, 981, 982, 983, 996, 997, 998, 999,
  1030, 1031, 1032, 1033, 1046, 1047, 1048, 1049, 1080, 1081, 1082, 1089, 1131, 1181,
  1231, 1232, 1281, 1282,
] as const;

export const FIORWOODS_RUNTIME_ASSET_IDS = [
  ...new Set([
    ...FIORWOODS_FACE_ROW_STARTS.flatMap((start) =>
      Array.from({ length: 6 }, (_, column) => start + column),
    ),
    381,
    382,
    380,
    80,
    31,
    32,
    379,
    301,
    438,
    439,
    440,
    441,
    442,
    443,
    549,
    550,
    599,
    600,
    1131,
    1181,
    1231,
    1232,
    1281,
    1282,
    ...FIORWOODS_STYLE_DECORATION_IDS,
    102,
    105,
    108,
    154,
  ]),
] as const;

/** Every source PNG represented by the generated runtime atlas. */
export const RUNTIME_ATLAS_SOURCE_PATHS = [
  ...new Set([
    'assets/tiles.png',
    'assets/wall_tiles.png',
    'assets/gates.png',
    'assets/oak-tree.png',
    ...FOREST_ASSET_NAMES.map((name) => `assets/forest/${name}`),
    ...FIORWOODS_RUNTIME_ASSET_IDS.map(getFiorwoodsRuntimeAssetPath),
    'assets/shadow_top.png',
    'assets/shadow_left.png',
    'assets/shadow_corner.png',
    'assets/runestones.png',
    ...CENTRAL_HUB_ASSET_PATHS,
    'assets/portal_spritesheet.png',
    ...PORTAL_PLATFORM_ASSET_PATHS,
    ...BRIDGE_OBSTACLE_ASSET_PATHS,
    ...SWAMP_OBSTACLE_ASSET_PATHS,
    ...SWORD_FIELD_ASSET_PATHS,
    ...SPIKE_GATE_ASSET_PATHS,
    ...CHEST_DEAD_END_ASSET_PATHS,
    ...T_INTERSECTION_DECORATION_ASSET_PATHS,
    ...DECORATED_VERTICAL_PASSAGE_ASSET_PATHS,
    'assets/cage/birdCage1.png',
    'assets/cage/birdCage2.png',
    'assets/cage/birdCage3.png',
    ...CAGE_GROUND_ASSET_PATHS,
    'assets/wisdom_orb.png',
    'assets/expand_button.png',
    'assets/contract_button.png',
    'assets/plate_spritesheet.png',
  ]),
] as const;

export function normalizeRuntimeAtlasAssetPath(assetPath: string): string {
  const pathname = assetPath.split(/[?#]/, 1)[0].replace(/^\/+/, '');
  return decodeURIComponent(pathname);
}
