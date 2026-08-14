import { SPIKE_GATE_COLORS, type SpikeGateColor } from '@labyrinth/shared';

export interface SpikeGatePostSpriteSpec {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SpikeGateTerrainSpriteSpec {
  asset: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export const SPIKE_GATE_CLOSED_FRAME = 6;
export const SPIKE_GATE_TRANSITION_FRAMES = [10, 11, 12, 13] as const;

/** Exact repeated-pillar composition for an east-west passage barrier. */
export const SPIKE_GATE_HORIZONTAL_POST_SPRITES = [
  { x: 23, y: -23, w: 14, h: 35 },
  { x: 30, y: -16, w: 14, h: 35 },
  { x: 23, y: -9, w: 14, h: 35 },
  { x: 30, y: -2, w: 14, h: 35 },
  { x: 23, y: 7, w: 14, h: 35 },
  { x: 30, y: 15, w: 14, h: 35 },
  { x: 23, y: 23, w: 14, h: 35 },
  { x: 30, y: 31, w: 14, h: 35 },
  { x: 23, y: 39, w: 14, h: 35 },
  { x: 30, y: 48, w: 14, h: 35 },
  { x: 23, y: 55, w: 14, h: 35 },
  { x: 30, y: 64, w: 14, h: 35 },
] as const satisfies readonly SpikeGatePostSpriteSpec[];

/** Exact staggered horizontal barrier from style-editor export 67. */
export const SPIKE_GATE_VERTICAL_POST_SPRITES = [
  { x: 2, y: -11, w: 14, h: 35 },
  { x: 19, y: -11, w: 14, h: 35 },
  { x: 36, y: -11, w: 14, h: 35 },
  { x: 53, y: -11, w: 14, h: 35 },
  { x: 70, y: -11, w: 14, h: 35 },
  { x: 85, y: -11, w: 14, h: 35 },
  { x: -6, y: -5, w: 14, h: 35 },
  { x: 11, y: -5, w: 14, h: 35 },
  { x: 28, y: -5, w: 14, h: 35 },
  { x: 45, y: -5, w: 14, h: 35 },
  { x: 62, y: -5, w: 14, h: 35 },
  { x: 77, y: -5, w: 14, h: 35 },
] as const satisfies readonly SpikeGatePostSpriteSpec[];

/** Backward-compatible name for the original horizontal fixture. */
export const SPIKE_GATE_POST_SPRITES = SPIKE_GATE_HORIZONTAL_POST_SPRITES;

/** Exact 4x6 terrain stamp exported for horizontal passages. */
export const SPIKE_GATE_HORIZONTAL_TERRAIN_SPRITES = [
  { asset: 1112, x: 0, y: 0, w: 16, h: 16 },
  { asset: 1113, x: 16, y: 0, w: 16, h: 16 },
  { asset: 1110, x: 32, y: 0, w: 16, h: 16 },
  { asset: 1114, x: 48, y: 0, w: 16, h: 16 },
  { asset: 1159, x: 0, y: 16, w: 16, h: 16 },
  { asset: 404, x: 16, y: 16, w: 16, h: 16 },
  { asset: 405, x: 32, y: 16, w: 16, h: 16 },
  { asset: 1158, x: 48, y: 16, w: 16, h: 16 },
  { asset: 1156, x: 0, y: 32, w: 16, h: 16 },
  { asset: 405, x: 16, y: 32, w: 16, h: 16 },
  { asset: 404, x: 32, y: 32, w: 16, h: 16 },
  { asset: 1164, x: 48, y: 32, w: 16, h: 16 },
  { asset: 1159, x: 0, y: 48, w: 16, h: 16 },
  { asset: 405, x: 16, y: 48, w: 16, h: 16 },
  { asset: 404, x: 32, y: 48, w: 16, h: 16 },
  { asset: 1158, x: 48, y: 48, w: 16, h: 16 },
  { asset: 1156, x: 0, y: 64, w: 16, h: 16 },
  { asset: 404, x: 16, y: 64, w: 16, h: 16 },
  { asset: 405, x: 32, y: 64, w: 16, h: 16 },
  { asset: 1164, x: 48, y: 64, w: 16, h: 16 },
  { asset: 1212, x: 0, y: 80, w: 16, h: 16 },
  { asset: 1207, x: 16, y: 80, w: 16, h: 16 },
  { asset: 1207, x: 32, y: 80, w: 16, h: 16 },
  { asset: 1208, x: 48, y: 80, w: 16, h: 16 },
] as const satisfies readonly SpikeGateTerrainSpriteSpec[];

/** Exact 6x3 terrain stamp exported for vertical passages in export 67. */
export const SPIKE_GATE_VERTICAL_TERRAIN_SPRITES = [
  { asset: 1112, x: 0, y: 0, w: 16, h: 16 },
  { asset: 1113, x: 16, y: 0, w: 16, h: 16 },
  { asset: 1107, x: 32, y: 0, w: 16, h: 16 },
  { asset: 1113, x: 48, y: 0, w: 16, h: 16 },
  { asset: 1113, x: 64, y: 0, w: 16, h: 16 },
  { asset: 1114, x: 80, y: 0, w: 16, h: 16 },
  { asset: 1159, x: 0, y: 16, w: 16, h: 16 },
  { asset: 405, x: 16, y: 16, w: 16, h: 16 },
  { asset: 404, x: 32, y: 16, w: 16, h: 16 },
  { asset: 405, x: 48, y: 16, w: 16, h: 16 },
  { asset: 404, x: 64, y: 16, w: 16, h: 16 },
  { asset: 1158, x: 80, y: 16, w: 16, h: 16 },
  { asset: 1212, x: 0, y: 32, w: 16, h: 16 },
  { asset: 1207, x: 16, y: 32, w: 16, h: 16 },
  { asset: 1213, x: 32, y: 32, w: 16, h: 16 },
  { asset: 1210, x: 48, y: 32, w: 16, h: 16 },
  { asset: 1210, x: 64, y: 32, w: 16, h: 16 },
  { asset: 1208, x: 80, y: 32, w: 16, h: 16 },
] as const satisfies readonly SpikeGateTerrainSpriteSpec[];

/** Backward-compatible name for the original horizontal fixture. */
export const SPIKE_GATE_TERRAIN_SPRITES = SPIKE_GATE_HORIZONTAL_TERRAIN_SPRITES;

export const SPIKE_GATE_BASIC_GRASS_ASSET = 102;

const ASSET_ROOT = '/assets/chained-echoes-assets-sorted';

export const SPIKE_GATE_PLATE_DEACTIVATED_PATH = `${ASSET_ROOT}/plateDeactivated.png`;
export const SPIKE_GATE_PLATE_ACTIVATED_PATH = `${ASSET_ROOT}/plateActivated.png`;

export function getSpikeGatePillarAssetPath(
  color: SpikeGateColor,
  frame: number,
): string {
  return `${ASSET_ROOT}/statuePillars_${color} ${frame}.png`;
}

export function getSpikeGateTerrainAssetPath(asset: number): string {
  return `${ASSET_ROOT}/Assets/Maps/Fiorwoods/Sprite_Fiorwoods_${asset}.png`;
}

const SPIKE_GATE_TERRAIN_ASSETS = [
  SPIKE_GATE_BASIC_GRASS_ASSET,
  ...new Set(
    [
      ...SPIKE_GATE_HORIZONTAL_TERRAIN_SPRITES,
      ...SPIKE_GATE_VERTICAL_TERRAIN_SPRITES,
    ].map((spec) => spec.asset),
  ),
];

export const SPIKE_GATE_ASSET_PATHS = [
  ...SPIKE_GATE_COLORS.flatMap((color) => [
    getSpikeGatePillarAssetPath(color, SPIKE_GATE_CLOSED_FRAME),
    ...SPIKE_GATE_TRANSITION_FRAMES.map((frame) =>
      getSpikeGatePillarAssetPath(color, frame),
    ),
  ]),
  SPIKE_GATE_PLATE_DEACTIVATED_PATH,
  SPIKE_GATE_PLATE_ACTIVATED_PATH,
  ...SPIKE_GATE_TERRAIN_ASSETS.map(getSpikeGateTerrainAssetPath),
] as const;
