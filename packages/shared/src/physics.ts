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

import type { TileMapData } from './maps/level1.js';

/** Player movement speed in pixels per second. */
export const PLAYER_SPEED = 150;

/**
 * Player hitbox size in pixels (centered on the player's x,y position).
 * The player's bounding box is PLAYER_HITBOX × PLAYER_HITBOX, offset so
 * that (x, y) is the top-left of the hitbox.
 * Using 12×12 leaves 2px of "grace" on each side of a 16px tile.
 */
export const PLAYER_HITBOX = 12;

/**
 * Offset from the player's position (top-left of the 16×16 sprite) to
 * the hitbox top-left corner, centering the 12×12 hitbox within 16×16.
 */
export const HITBOX_OFFSET = 2; // (16 - 12) / 2

/**
 * Apply a single input to a position, returning the new position.
 * Used identically on both client (prediction) and server (authoritative).
 *
 * @param x     Current X position (top-left of sprite)
 * @param y     Current Y position (top-left of sprite)
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

/**
 * Check if a tile at grid coordinates (tileX, tileY) is a wall.
 * Returns true if out of bounds (treat out-of-bounds as wall).
 */
function isWallTile(tileX: number, tileY: number, map: TileMapData): boolean {
  if (tileX < 0 || tileX >= map.width || tileY < 0 || tileY >= map.height) {
    return true; // Out of bounds = impassable
  }
  return map.data[tileY * map.width + tileX] === 1;
}

/**
 * Check if a position is valid (no wall collision) using AABB collision.
 *
 * The player's hitbox is a PLAYER_HITBOX × PLAYER_HITBOX rectangle
 * starting at (x + HITBOX_OFFSET, y + HITBOX_OFFSET).
 *
 * We check all tile grid cells that the hitbox overlaps. If ANY of them
 * are wall tiles (ID: 1), the position is invalid.
 *
 * @param x   Player X position (top-left of 16×16 sprite)
 * @param y   Player Y position (top-left of 16×16 sprite)
 * @param map The tile map to check against
 * @returns   true if the position is valid (no wall overlap)
 */
export function isPositionValid(x: number, y: number, map: TileMapData): boolean {
  const ts = map.tileSize;

  // Hitbox bounds (pixel coords)
  const left = x + HITBOX_OFFSET;
  const top = y + HITBOX_OFFSET;
  const right = left + PLAYER_HITBOX - 1; // inclusive pixel
  const bottom = top + PLAYER_HITBOX - 1; // inclusive pixel

  // Convert to tile grid coords
  const tileLeft = Math.floor(left / ts);
  const tileTop = Math.floor(top / ts);
  const tileRight = Math.floor(right / ts);
  const tileBottom = Math.floor(bottom / ts);

  // Check all overlapping tiles
  for (let ty = tileTop; ty <= tileBottom; ty++) {
    for (let tx = tileLeft; tx <= tileRight; tx++) {
      if (isWallTile(tx, ty, map)) {
        return false;
      }
    }
  }

  return true;
}

/**
 * Apply a single input WITH collision detection (axis-independent sliding).
 *
 * Instead of rejecting the entire movement when hitting a wall, we try
 * each axis independently. This allows the player to "slide" along walls
 * rather than getting stuck when pressing into a corner.
 *
 * @param x     Current X position (top-left of sprite)
 * @param y     Current Y position (top-left of sprite)
 * @param input Movement direction flags
 * @param dt    Delta time in seconds
 * @param map   The tile map for collision checking
 * @returns     New { x, y } after applying movement with collision
 */
export function applyInputWithCollision(
  x: number,
  y: number,
  input: { up: boolean; down: boolean; left: boolean; right: boolean },
  dt: number,
  map: TileMapData,
): { x: number; y: number } {
  let newX = x;
  let newY = y;

  // Calculate desired deltas
  let dx = 0;
  let dy = 0;
  if (input.up) dy -= PLAYER_SPEED * dt;
  if (input.down) dy += PLAYER_SPEED * dt;
  if (input.left) dx -= PLAYER_SPEED * dt;
  if (input.right) dx += PLAYER_SPEED * dt;

  // Try X axis independently
  if (dx !== 0) {
    const candidateX = x + dx;
    if (isPositionValid(candidateX, y, map)) {
      newX = candidateX;
    }
  }

  // Try Y axis independently (using the potentially updated X)
  if (dy !== 0) {
    const candidateY = y + dy;
    if (isPositionValid(newX, candidateY, map)) {
      newY = candidateY;
    }
  }

  return { x: newX, y: newY };
}
