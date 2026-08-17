import type { SpikeGateObstaclePlacement } from './maps/level1.js';

export const SPIKE_GATE_AUTHORING_TILE_SIZE = 16;
export const SPIKE_GATE_HORIZONTAL_TERRAIN_COLUMNS = 4;
export const SPIKE_GATE_HORIZONTAL_TERRAIN_ROWS = 6;
export const SPIKE_GATE_VERTICAL_TERRAIN_COLUMNS = 6;
export const SPIKE_GATE_VERTICAL_TERRAIN_ROWS = 3;
/** Four authored terrain columns followed by one clear basic-grass column. */
export const SPIKE_GATE_HORIZONTAL_STRIDE = 80;
/** Three authored terrain rows followed by one clear basic-grass row. */
export const SPIKE_GATE_VERTICAL_STRIDE = 64;
/** Backward-compatible aliases for the original horizontal authoring fixture. */
export const SPIKE_GATE_TERRAIN_COLUMNS = SPIKE_GATE_HORIZONTAL_TERRAIN_COLUMNS;
export const SPIKE_GATE_TERRAIN_ROWS = SPIKE_GATE_HORIZONTAL_TERRAIN_ROWS;
export const SPIKE_GATE_COLUMN_STRIDE = SPIKE_GATE_HORIZONTAL_STRIDE;
/** Maximum rendered gates and fixed replicated-state slots per obstacle. */
export const SPIKE_GATES_PER_OBSTACLE = 3;
export const SPIKE_PLATES_PER_GATE = 2;
export const SPIKE_PLATES_PER_OBSTACLE = SPIKE_GATES_PER_OBSTACLE * SPIKE_PLATES_PER_GATE;

export type SpikeGateColor = 'red' | 'blue' | 'yellow';

export const SPIKE_GATE_COLORS = [
  'red',
  'blue',
  'yellow',
] as const satisfies readonly SpikeGateColor[];

export interface SpikeGateBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface SpikeGateState {
  /** Flattened obstacle-local gate index. */
  spikeGateIndex: number;
  open: boolean;
}

export interface SpikePlateState {
  /** Flattened obstacle-local plate index. */
  spikePlateIndex: number;
  pressed: boolean;
  /** Whether a warden explicitly latched this plate with the interaction key. */
  latched: boolean;
}

export interface SpikePlatePlacement {
  spikePlateIndex: number;
  obstacleIndex: number;
  gateIndex: number;
  side: SpikePlateSide;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type SpikePlateSide = 'west' | 'east' | 'north' | 'south';

const HORIZONTAL_GATE_COLLIDER_X = 27;
const HORIZONTAL_GATE_COLLIDER_Y = 0;
const HORIZONTAL_GATE_COLLIDER_WIDTH = 13;
const HORIZONTAL_GATE_COLLIDER_HEIGHT = 95;
const HORIZONTAL_WEST_PLATE_X = 0;
const HORIZONTAL_WEST_PLATE_Y = 16;
const HORIZONTAL_EAST_PLATE_X = 51;
const HORIZONTAL_EAST_PLATE_Y = 64;
const VERTICAL_GATE_COLLIDER_X = 1;
const VERTICAL_GATE_COLLIDER_Y = 19;
const VERTICAL_GATE_COLLIDER_WIDTH = 95;
const VERTICAL_GATE_COLLIDER_HEIGHT = 9;
const VERTICAL_NORTH_PLATE_X = 64;
const VERTICAL_NORTH_PLATE_Y = -11;
const VERTICAL_SOUTH_PLATE_X = 16;
const VERTICAL_SOUTH_PLATE_Y = 40;
const PLATE_SIZE = 16;

export function getSpikeGateStateIndex(obstacleIndex: number, gateIndex: number): number {
  return obstacleIndex * SPIKE_GATES_PER_OBSTACLE + gateIndex;
}

/** Axis offset for red, blue, and the upper yellow vertical-corridor barrier. */
export function getSpikeGateBarrierOffset(
  placement: Pick<SpikeGateObstaclePlacement, 'orientation'>,
  gateIndex: number,
): number {
  if (placement.orientation === 'horizontal') {
    return gateIndex * SPIKE_GATE_HORIZONTAL_STRIDE;
  }
  return gateIndex === 2 ? -SPIKE_GATE_VERTICAL_STRIDE : gateIndex * SPIKE_GATE_VERTICAL_STRIDE;
}

export function getSpikePlateStateIndex(
  obstacleIndex: number,
  gateIndex: number,
  side: SpikePlateSide,
): number {
  return (
    obstacleIndex * SPIKE_PLATES_PER_OBSTACLE +
    gateIndex * SPIKE_PLATES_PER_GATE +
    (side === 'west' || side === 'north' ? 0 : 1)
  );
}

/** Exact closed-barrier rectangle exported for the selected passage orientation. */
export function getSpikeGateCollisionBounds(
  placement: SpikeGateObstaclePlacement,
  gateIndex: number,
  tileSize: number = SPIKE_GATE_AUTHORING_TILE_SIZE,
): SpikeGateBounds {
  const scale = tileSize / SPIKE_GATE_AUTHORING_TILE_SIZE;
  const anchorX = placement.tileX * tileSize;
  const anchorY = placement.tileY * tileSize;
  const horizontal = placement.orientation === 'horizontal';
  const gateOffset = getSpikeGateBarrierOffset(placement, gateIndex);
  const x = horizontal
    ? HORIZONTAL_GATE_COLLIDER_X + gateOffset
    : VERTICAL_GATE_COLLIDER_X;
  const y = horizontal
    ? HORIZONTAL_GATE_COLLIDER_Y
    : VERTICAL_GATE_COLLIDER_Y + gateOffset;
  const width = horizontal
    ? HORIZONTAL_GATE_COLLIDER_WIDTH
    : VERTICAL_GATE_COLLIDER_WIDTH;
  const height = horizontal
    ? HORIZONTAL_GATE_COLLIDER_HEIGHT
    : VERTICAL_GATE_COLLIDER_HEIGHT;
  return {
    left: anchorX + x * scale,
    top: anchorY + y * scale,
    right: anchorX + (x + width) * scale - 1,
    bottom: anchorY + (y + height) * scale - 1,
  };
}

/** Exact side-plate positions from horizontal export 65 and vertical export 70. */
export function getSpikeGatePlatePlacements(
  placement: SpikeGateObstaclePlacement,
  obstacleIndex: number,
  tileSize: number = SPIKE_GATE_AUTHORING_TILE_SIZE,
): SpikePlatePlacement[] {
  const scale = tileSize / SPIKE_GATE_AUTHORING_TILE_SIZE;
  const anchorX = placement.tileX * tileSize;
  const anchorY = placement.tileY * tileSize;
  const plates: SpikePlatePlacement[] = [];
  const horizontal = placement.orientation === 'horizontal';
  const sides = horizontal ? (['west', 'east'] as const) : (['north', 'south'] as const);

  for (let gateIndex = 0; gateIndex < placement.gateCount; gateIndex++) {
    const gateOffset = getSpikeGateBarrierOffset(placement, gateIndex);
    for (const side of sides) {
      const x = horizontal
        ? side === 'west'
          ? HORIZONTAL_WEST_PLATE_X
          : HORIZONTAL_EAST_PLATE_X
        : side === 'north'
          ? VERTICAL_NORTH_PLATE_X
          : VERTICAL_SOUTH_PLATE_X;
      const y = horizontal
        ? side === 'west'
          ? HORIZONTAL_WEST_PLATE_Y
          : HORIZONTAL_EAST_PLATE_Y
        : side === 'north'
          ? VERTICAL_NORTH_PLATE_Y
          : VERTICAL_SOUTH_PLATE_Y;
      plates.push({
        spikePlateIndex: getSpikePlateStateIndex(obstacleIndex, gateIndex, side),
        obstacleIndex,
        gateIndex,
        side,
        x: anchorX + (x + (horizontal ? gateOffset : 0)) * scale,
        y: anchorY + (y + (horizontal ? 0 : gateOffset)) * scale,
        width: PLATE_SIZE * scale,
        height: PLATE_SIZE * scale,
      });
    }
  }

  return plates;
}
