import type { SwordFieldPlacement } from './maps/level1.js';

export const SWORD_FIELD_AUTHORING_TILE_SIZE = 16;
export const SWORD_FIELD_WIDTH = 192;
export const SWORD_FIELD_HEIGHT = 96;
export const SWORD_FIELD_INTERACTION_RANGE = 36;
export const SWORD_FIELD_LOWER_DURATION_MS = 1_200;

export interface SwordFieldState {
  swordFieldIndex: number;
  /** Server tick on which the wisdom-orb lowering sequence began. */
  loweringStartedTick: number | null;
  /** The central blocker is removed only after the lowering sequence finishes. */
  cleared: boolean;
}

export interface SwordFieldCollisionBounds {
  kind: 'scenery' | 'barrier';
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface SwordFieldWisdomTarget {
  swordFieldIndex: number;
  entrance: 'west' | 'east';
  x: number;
  y: number;
}

interface SwordFieldColliderSpec {
  kind: SwordFieldCollisionBounds['kind'];
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Permanent fence/marker geometry from the first editor export. */
const SCENERY_COLLIDER_SPECS: readonly SwordFieldColliderSpec[] = [
  { kind: 'scenery', x: 32, y: 2, width: 130, height: 14 },
  { kind: 'scenery', x: 154, y: 16, width: 33, height: 14 },
  { kind: 'scenery', x: 5, y: 17, width: 35, height: 14 },
  { kind: 'scenery', x: 97, y: 18, width: 9, height: 13 },
  { kind: 'scenery', x: 113, y: 18, width: 9, height: 13 },
  { kind: 'scenery', x: 81, y: 19, width: 9, height: 13 },
  { kind: 'scenery', x: 154, y: 63, width: 37, height: 14 },
  { kind: 'scenery', x: 3, y: 64, width: 37, height: 14 },
  { kind: 'scenery', x: 154, y: 76, width: 6, height: 19 },
  { kind: 'scenery', x: 34, y: 78, width: 6, height: 18 },
] as const;

/** The one extra rectangle in the second export: the removable path blocker. */
const BARRIER_COLLIDER_SPEC: SwordFieldColliderSpec = {
  kind: 'barrier',
  x: 19,
  y: 31,
  width: 149,
  height: 32,
};

export function getSwordFieldCollisionBounds(
  placement: SwordFieldPlacement,
  tileSize: number = SWORD_FIELD_AUTHORING_TILE_SIZE,
): SwordFieldCollisionBounds[] {
  const scale = tileSize / SWORD_FIELD_AUTHORING_TILE_SIZE;
  const anchorX = placement.tileX * tileSize;
  const anchorY = placement.tileY * tileSize;

  return [...SCENERY_COLLIDER_SPECS, BARRIER_COLLIDER_SPEC].map((spec) => ({
    kind: spec.kind,
    left: anchorX + spec.x * scale,
    top: anchorY + spec.y * scale,
    right: anchorX + (spec.x + spec.width) * scale - 1,
    bottom: anchorY + (spec.y + spec.height) * scale - 1,
  }));
}

export function getSwordFieldEntrancePoints(
  placement: SwordFieldPlacement,
  tileSize: number = SWORD_FIELD_AUTHORING_TILE_SIZE,
): readonly SwordFieldWisdomTarget[] {
  const scale = tileSize / SWORD_FIELD_AUTHORING_TILE_SIZE;
  const anchorX = placement.tileX * tileSize;
  const anchorY = placement.tileY * tileSize;
  return [
    {
      swordFieldIndex: -1,
      entrance: 'west',
      x: anchorX + 8 * scale,
      y: anchorY + 48 * scale,
    },
    {
      swordFieldIndex: -1,
      entrance: 'east',
      x: anchorX + 184 * scale,
      y: anchorY + 48 * scale,
    },
  ];
}

/** Find the nearest still-blocking sword-field entrance within interaction range. */
export function findSwordFieldWisdomTarget(
  placements: readonly SwordFieldPlacement[],
  states: readonly SwordFieldState[],
  playerX: number,
  playerY: number,
  tileSize: number = SWORD_FIELD_AUTHORING_TILE_SIZE,
): SwordFieldWisdomTarget | null {
  const range =
    (SWORD_FIELD_INTERACTION_RANGE * tileSize) / SWORD_FIELD_AUTHORING_TILE_SIZE;
  const rangeSq = range * range;
  let nearest: SwordFieldWisdomTarget | null = null;
  let nearestDistSq = Number.POSITIVE_INFINITY;

  for (let swordFieldIndex = 0; swordFieldIndex < placements.length; swordFieldIndex++) {
    const state = states.find(
      (candidate) => candidate.swordFieldIndex === swordFieldIndex,
    );
    if (
      state?.cleared ||
      (state?.loweringStartedTick !== null && state?.loweringStartedTick !== undefined)
    ) {
      continue;
    }

    for (const entrance of getSwordFieldEntrancePoints(
      placements[swordFieldIndex],
      tileSize,
    )) {
      const dx = playerX - entrance.x;
      const dy = playerY - entrance.y;
      const distSq = dx * dx + dy * dy;
      if (distSq > rangeSq || distSq >= nearestDistSq) continue;
      nearestDistSq = distSq;
      nearest = { ...entrance, swordFieldIndex };
    }
  }

  return nearest;
}
