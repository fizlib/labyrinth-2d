// packages/shared/src/physics.ts
// ─────────────────────────────────────────────────────────────────────────────
// Shared physics constants and helpers.
// Used by BOTH the server (authoritative simulation) and the client
// (client-side prediction & server reconciliation).
//
// Step 9: Feet-based collision.
// The player's (x, y) coordinate represents the BOTTOM-CENTER of the sprite.
// The collision hitbox covers only the player's feet — an 8×12 pixel rectangle
// centered horizontally at x and extending upward from y.
// ─────────────────────────────────────────────────────────────────────────────

import {
  isSolidTileId,
  type TileMapData,
} from './maps/level1.js';

/** Optional portal collider for dynamic entity collision. */
export interface PortalCollider {
  /** Portal center X in pixels. */
  x: number;
  /** Portal center Y in pixels. */
  y: number;
}

/** Portal collision hitbox size (widened to 28px to cover the stone frame). */
export const PORTAL_HITBOX_W = 28;
export const PORTAL_HITBOX_H = 16;

export interface PortalBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export const PLAYER_SPEED = 80;
export const FEET_HITBOX_W = 8;
export const FEET_HITBOX_H = 12;

export function getPortalBounds(portal: PortalCollider): PortalBounds {
  const left = portal.x - PORTAL_HITBOX_W / 2;
  const top = portal.y - PORTAL_HITBOX_H / 2;
  return {
    left,
    top,
    right: left + PORTAL_HITBOX_W - 1,
    bottom: top + PORTAL_HITBOX_H - 1,
  };
}

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

function isSolidTile(tileX: number, tileY: number, map: TileMapData): boolean {
  if (tileX < 0 || tileX >= map.width || tileY < 0 || tileY >= map.height) {
    return true; // Out of bounds = impassable
  }
  const tile = map.data[tileY * map.width + tileX];
  return isSolidTileId(tile);
}

export function isPositionValid(
  x: number,
  y: number,
  map: TileMapData,
  portal?: PortalCollider | null,
): boolean {
  const ts = map.tileSize;

  const left = x - FEET_HITBOX_W / 2;
  const top = y - FEET_HITBOX_H;
  const right = left + FEET_HITBOX_W - 1;
  const bottom = y - 1;

  const tileLeft = Math.floor(left / ts);
  const tileTop = Math.floor(top / ts);
  const tileRight = Math.floor(right / ts);
  const tileBottom = Math.floor(bottom / ts);

  for (let ty = tileTop; ty <= tileBottom; ty++) {
    for (let tx = tileLeft; tx <= tileRight; tx++) {
      if (isSolidTile(tx, ty, map)) {
        return false;
      }
    }
  }

  // Check portal collision (dynamic entity, AABB overlap test)
  if (portal) {
    const bounds = getPortalBounds(portal);

    if (
      left <= bounds.right &&
      right >= bounds.left &&
      top <= bounds.bottom &&
      bottom >= bounds.top
    ) {
      return false;
    }
  }

  return true;
}

export function applyInputWithCollision(
  x: number,
  y: number,
  input: { up: boolean; down: boolean; left: boolean; right: boolean },
  dt: number,
  map: TileMapData,
  portal?: PortalCollider | null,
): { x: number; y: number } {
  let newX = x;
  let newY = y;

  let dx = 0;
  let dy = 0;
  if (input.up) dy -= PLAYER_SPEED * dt;
  if (input.down) dy += PLAYER_SPEED * dt;
  if (input.left) dx -= PLAYER_SPEED * dt;
  if (input.right) dx += PLAYER_SPEED * dt;

  if (dx !== 0) {
    const candidateX = x + dx;
    if (isPositionValid(candidateX, y, map, portal)) {
      newX = candidateX;
    }
  }

  if (dy !== 0) {
    const candidateY = y + dy;
    if (isPositionValid(newX, candidateY, map, portal)) {
      newY = candidateY;
    }
  }

  return { x: newX, y: newY };
}
