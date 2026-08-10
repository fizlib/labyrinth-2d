/** Shared authoritative state for one magically spawned survivor cage. */
export interface CageState {
  cageId: number;
  /** The survivor originally captured by this cage. */
  prisonerPlayerId: string;
  /** Bottom-center world position matching the captured player's feet. */
  x: number;
  y: number;
  /** The front gate has been opened by a different nearby player. */
  opened: boolean;
  /** The prisoner cleared the cage vertically; the empty cage is now permanently solid. */
  vacated: boolean;
}

export interface CageCollisionBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Maximum feet-to-cage distance for another player to open its gate. */
export const CAGE_INTERACTION_RANGE = 28;

/** Footprint of the authored 20x32 cage around player feet. */
export const CAGE_COLLIDER_WIDTH = 20;
export const CAGE_COLLIDER_TOP_OFFSET = -14;
export const CAGE_COLLIDER_BOTTOM_OFFSET = 4;

/** Vertical travel required before an opened cage becomes empty and solid. */
export const CAGE_EXIT_DISTANCE = 20;

export function getCageCollisionBounds(
  cage: Pick<CageState, 'x' | 'y'>,
): CageCollisionBounds {
  const left = cage.x - CAGE_COLLIDER_WIDTH / 2;
  return {
    left,
    top: cage.y + CAGE_COLLIDER_TOP_OFFSET,
    right: left + CAGE_COLLIDER_WIDTH - 1,
    bottom: cage.y + CAGE_COLLIDER_BOTTOM_OFFSET,
  };
}

/** Point used by matching client and server proximity checks. */
export function getCageInteractionPoint(cage: Pick<CageState, 'x' | 'y'>): {
  x: number;
  y: number;
} {
  return { x: cage.x, y: cage.y - 8 };
}

export function isPlayerActivelyCaged(cage: CageState, playerId: string): boolean {
  return cage.prisonerPlayerId === playerId && !cage.vacated;
}

export function findActivePlayerCage(
  cages: readonly CageState[],
  playerId: string,
): CageState | null {
  return cages.find((cage) => isPlayerActivelyCaged(cage, playerId)) ?? null;
}

/** True once an opened prisoner has walked clear through the north or south gate. */
export function hasPrisonerExitedCage(
  cage: Pick<CageState, 'y'>,
  playerY: number,
): boolean {
  return Math.abs(playerY - cage.y) >= CAGE_EXIT_DISTANCE;
}

/** Find the closest closed cage this outside player is allowed to open. */
export function findOpenableCage(
  cages: readonly CageState[],
  playerId: string,
  playerX: number,
  playerY: number,
): { cage: CageState; distanceSquared: number } | null {
  let nearest: { cage: CageState; distanceSquared: number } | null = null;
  const rangeSquared = CAGE_INTERACTION_RANGE * CAGE_INTERACTION_RANGE;

  for (const cage of cages) {
    if (cage.opened || cage.vacated || cage.prisonerPlayerId === playerId) continue;
    const point = getCageInteractionPoint(cage);
    const dx = playerX - point.x;
    const dy = playerY - point.y;
    const distanceSquared = dx * dx + dy * dy;
    if (distanceSquared > rangeSquared) continue;
    if (!nearest || distanceSquared < nearest.distanceSquared) {
      nearest = { cage, distanceSquared };
    }
  }

  return nearest;
}
