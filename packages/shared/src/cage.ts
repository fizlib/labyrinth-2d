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

/** 18x14 collider authored around the cage base in labyrinth-style-v1 (14). */
export const CAGE_COLLIDER_WIDTH = 18;
export const CAGE_COLLIDER_TOP_OFFSET = -12;
export const CAGE_COLLIDER_BOTTOM_OFFSET = 1;

/** Empty space left between a newly spawned cage and a displaced warden. */
export const CAGE_SPAWN_CLEARANCE = 2;

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

/**
 * Nearest feet positions that clear an overlapping newly spawned cage.
 * The caller chooses the first position that is valid against the full map.
 */
export function getCageSeparationPositions(
  cage: Pick<CageState, 'x' | 'y'>,
  playerX: number,
  playerY: number,
  playerFeetWidth: number,
  playerFeetHeight: number,
  clearance: number = CAGE_SPAWN_CLEARANCE,
): Array<{ x: number; y: number }> {
  const bounds = getCageCollisionBounds(cage);
  const playerLeft = playerX - playerFeetWidth / 2;
  const playerTop = playerY - playerFeetHeight;
  const playerRight = playerLeft + playerFeetWidth - 1;
  const playerBottom = playerY - 1;
  const overlaps =
    playerLeft <= bounds.right &&
    playerRight >= bounds.left &&
    playerTop <= bounds.bottom &&
    playerBottom >= bounds.top;
  if (!overlaps) return [];

  const gap = Math.max(0, clearance);
  const positions = [
    { x: bounds.left - gap - playerFeetWidth / 2, y: playerY },
    { x: bounds.right + 1 + gap + playerFeetWidth / 2, y: playerY },
    { x: playerX, y: bounds.top - gap },
    { x: playerX, y: bounds.bottom + 1 + gap + playerFeetHeight },
  ];

  return positions.sort((a, b) => {
    const aDistance = (a.x - playerX) ** 2 + (a.y - playerY) ** 2;
    const bDistance = (b.x - playerX) ** 2 + (b.y - playerY) ** 2;
    return aDistance - bDistance;
  });
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
