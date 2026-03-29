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
  TILE_WALL_FACE, TILE_WALL_TOP, TILE_WALL_INTERIOR,
  TILE_WALL_SIDE_LEFT, TILE_WALL_SIDE_RIGHT, TILE_WALL_BOTTOM,
  TILE_WALL_CORNER_TL, TILE_WALL_CORNER_TR,
  TILE_WALL_CORNER_BL, TILE_WALL_CORNER_BR,
  TILE_WALL_TOP_EDGE,
  TILE_TREE,
  type TileMapData,
} from './maps/level1.js';

export const PLAYER_SPEED = 80;
export const FEET_HITBOX_W = 8;
export const FEET_HITBOX_H = 12;

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
  return tile === TILE_WALL_FACE || 
         tile === TILE_WALL_TOP || 
         tile === TILE_WALL_INTERIOR ||
         tile === TILE_WALL_SIDE_LEFT ||
         tile === TILE_WALL_SIDE_RIGHT ||
         tile === TILE_WALL_BOTTOM ||
         tile === TILE_WALL_CORNER_TL ||
         tile === TILE_WALL_CORNER_TR ||
         tile === TILE_WALL_CORNER_BL ||
         tile === TILE_WALL_CORNER_BR ||
         tile === TILE_WALL_TOP_EDGE ||
         tile === TILE_TREE;
}

export function isPositionValid(x: number, y: number, map: TileMapData): boolean {
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

  return true;
}

export function applyInputWithCollision(
  x: number,
  y: number,
  input: { up: boolean; down: boolean; left: boolean; right: boolean },
  dt: number,
  map: TileMapData,
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
    if (isPositionValid(candidateX, y, map)) {
      newX = candidateX;
    }
  }

  if (dy !== 0) {
    const candidateY = y + dy;
    if (isPositionValid(newX, candidateY, map)) {
      newY = candidateY;
    }
  }

  return { x: newX, y: newY };
}