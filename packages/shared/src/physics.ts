// packages/shared/src/physics.ts
// ─────────────────────────────────────────────────────────────────────────────
// Shared physics constants and helpers.
// Used by BOTH the server (authoritative simulation) and the client
// (client-side prediction & server reconciliation).
//
// Keeping physics in a shared module guarantees that the client's predicted
// movement matches the server's authoritative movement exactly, preventing
// reconciliation jitter.
// ─────────────────────────────────────────────────────────────────────────────

/** Player movement speed in pixels per second. */
export const PLAYER_SPEED = 150;

/**
 * Apply a single input to a position, returning the new position.
 * Used identically on both client (prediction) and server (authoritative).
 *
 * @param x     Current X position
 * @param y     Current Y position
 * @param input Movement direction flags
 * @param dt    Delta time in seconds
 * @returns     New { x, y } after applying movement
 */
export function applyInput(
  x: number,
  y: number,
  input: { up: boolean; down: boolean; left: boolean; right: boolean },
  dt: number,
): { x: number; y: number } {
  let newX = x;
  let newY = y;

  if (input.up) newY -= PLAYER_SPEED * dt;
  if (input.down) newY += PLAYER_SPEED * dt;
  if (input.left) newX -= PLAYER_SPEED * dt;
  if (input.right) newX += PLAYER_SPEED * dt;

  return { x: newX, y: newY };
}
