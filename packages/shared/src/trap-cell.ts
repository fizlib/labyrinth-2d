import { CELL_SIZE, type TrapCellPlacement } from './maps/level1.js';

/** Distance outside a 6x6 trap-cell edge at which a warden may activate it. */
export const TRAP_CELL_INTERACTION_RANGE = 20;

/** Grace period after a cage opens during which its trap cell cannot capture anyone. */
export const TRAP_CELL_RELEASE_COOLDOWN_MS = 10_000;

export interface TrapCellWorldBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface TrapCellInteractionTarget {
  trapCellIndex: number;
  distanceSquared: number;
}

export function getTrapCellWorldBounds(
  placement: Pick<TrapCellPlacement, 'tileX' | 'tileY'>,
  tileSize: number,
): TrapCellWorldBounds {
  const left = placement.tileX * tileSize;
  const top = placement.tileY * tileSize;
  return {
    left,
    top,
    right: left + CELL_SIZE * tileSize - 1,
    bottom: top + CELL_SIZE * tileSize - 1,
  };
}

function distanceSquaredToBounds(
  x: number,
  y: number,
  bounds: TrapCellWorldBounds,
): number {
  const dx = x < bounds.left ? bounds.left - x : x > bounds.right ? x - bounds.right : 0;
  const dy = y < bounds.top ? bounds.top - y : y > bounds.bottom ? y - bounds.bottom : 0;
  return dx * dx + dy * dy;
}

/** Feet-based membership test used when a warden triggers the trap network. */
export function isPlayerInTrapCell(
  placement: TrapCellPlacement,
  playerX: number,
  playerY: number,
  tileSize: number,
): boolean {
  const bounds = getTrapCellWorldBounds(placement, tileSize);
  const feetY = playerY - 1;
  return (
    playerX >= bounds.left &&
    playerX <= bounds.right &&
    feetY >= bounds.top &&
    feetY <= bounds.bottom
  );
}

/** Find the closest trap rectangle within the warden's activation range. */
export function findTrapCellInteractionTarget(
  placements: readonly TrapCellPlacement[],
  playerX: number,
  playerY: number,
  tileSize: number,
): TrapCellInteractionTarget | null {
  const rangeSquared = TRAP_CELL_INTERACTION_RANGE * TRAP_CELL_INTERACTION_RANGE;
  let nearest: TrapCellInteractionTarget | null = null;

  for (let trapCellIndex = 0; trapCellIndex < placements.length; trapCellIndex++) {
    const distanceSquared = distanceSquaredToBounds(
      playerX,
      playerY - 1,
      getTrapCellWorldBounds(placements[trapCellIndex], tileSize),
    );
    if (distanceSquared > rangeSquared) continue;
    if (!nearest || distanceSquared < nearest.distanceSquared) {
      nearest = { trapCellIndex, distanceSquared };
    }
  }

  return nearest;
}
