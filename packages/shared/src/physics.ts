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

import { isSolidTileId, type BridgePlacement, type TileMapData } from './maps/level1.js';

/** Optional portal collider for dynamic entity collision. */
export interface PortalCollider {
  /** Portal center X in pixels. */
  x: number;
  /** Portal center Y in pixels. */
  y: number;
}

/** Portal collision hitbox size authored around the stone frame. */
export const PORTAL_HITBOX_W = 26;
export const PORTAL_HITBOX_H = 16;
const PORTAL_HITBOX_LEFT_OFFSET = -14;

/** Four wall tiles opened behind the portal platform's walkable top. */
export const PORTAL_WALL_OPENING_WIDTH = 64;
export const PORTAL_WALL_OPENING_HEIGHT = 16;
export const PORTAL_WALL_OPENING_TOP_OFFSET = -4;

export interface PortalBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface PortalCollisionBounds extends PortalBounds {
  shape: 'rectangle' | 'right-triangle';
  flipX: boolean;
  flipY: boolean;
}

interface PortalCollisionSpec {
  x: number;
  y: number;
  width: number;
  height: number;
  shape: PortalCollisionBounds['shape'];
  flipX?: boolean;
  flipY?: boolean;
}

const BRIDGE_AUTHORING_TILE_SIZE = 16;

/** Collider geometry exported from the authored bridge-obstacle sample. */
const BRIDGE_COLLIDER_SPECS: readonly PortalCollisionSpec[] = [
  { x: 0, y: 28, width: 32, height: 104, shape: 'rectangle' },
  { x: 64, y: 29, width: 32, height: 104, shape: 'rectangle' },
  { x: 1, y: 11, width: 16, height: 16, shape: 'right-triangle' },
  { x: 79, y: 12, width: 16, height: 16, shape: 'right-triangle', flipX: true },
  { x: 1, y: 133, width: 29, height: 25, shape: 'right-triangle', flipY: true },
  {
    x: 66,
    y: 134,
    width: 29,
    height: 25,
    shape: 'right-triangle',
    flipX: true,
    flipY: true,
  },
];

/** Collider geometry exported from the authored portal-platform sample. */
const PORTAL_PLATFORM_COLLIDER_SPECS: readonly PortalCollisionSpec[] = [
  { x: -37, y: 12, width: 5, height: 36, shape: 'rectangle' },
  { x: -31, y: 31, width: 14, height: 13, shape: 'right-triangle' },
  {
    x: -36,
    y: 49,
    width: 20,
    height: 20,
    shape: 'right-triangle',
    flipX: true,
    flipY: true,
  },
  { x: 32, y: 12, width: 5, height: 36, shape: 'rectangle' },
  {
    x: 17,
    y: 31,
    width: 14,
    height: 13,
    shape: 'right-triangle',
    flipX: true,
  },
  {
    x: 16,
    y: 49,
    width: 20,
    height: 20,
    shape: 'right-triangle',
    flipY: true,
  },
];

export const PLAYER_SPEED = 80;
export const FEET_HITBOX_W = 8;
export const FEET_HITBOX_H = 12;

export function getPortalBounds(portal: PortalCollider): PortalBounds {
  const left = portal.x + PORTAL_HITBOX_LEFT_OFFSET;
  const top = portal.y - PORTAL_HITBOX_H / 2;
  return {
    left,
    top,
    right: left + PORTAL_HITBOX_W - 1,
    bottom: top + PORTAL_HITBOX_H - 1,
  };
}

/** Walkable cutout in the otherwise-solid bottom row of the forest wall. */
export function getPortalWallOpeningBounds(portal: PortalCollider): PortalBounds {
  const left = portal.x - PORTAL_WALL_OPENING_WIDTH / 2;
  const top = portal.y + PORTAL_WALL_OPENING_TOP_OFFSET;
  return {
    left,
    top,
    right: left + PORTAL_WALL_OPENING_WIDTH - 1,
    bottom: top + PORTAL_WALL_OPENING_HEIGHT - 1,
  };
}

/** True when a complete map tile belongs to the portal wall cutout. */
export function isPortalWallOpeningTile(
  tileX: number,
  tileY: number,
  tileSize: number,
  portal: PortalCollider,
): boolean {
  const opening = getPortalWallOpeningBounds(portal);
  const left = tileX * tileSize;
  const top = tileY * tileSize;
  const right = left + tileSize - 1;
  const bottom = top + tileSize - 1;
  return (
    left >= opening.left &&
    right <= opening.right &&
    top >= opening.top &&
    bottom <= opening.bottom
  );
}

/** Authored solid edges around the walkable portal platform and central stairs. */
export function getPortalPlatformBounds(portal: PortalCollider): PortalCollisionBounds[] {
  return PORTAL_PLATFORM_COLLIDER_SPECS.map((spec) => ({
    left: portal.x + spec.x,
    top: portal.y + spec.y,
    right: portal.x + spec.x + spec.width - 1,
    bottom: portal.y + spec.y + spec.height - 1,
    shape: spec.shape,
    flipX: spec.flipX ?? false,
    flipY: spec.flipY ?? false,
  }));
}

/** Authored solid banks around a bridge's central two-tile walkway. */
export function getBridgeBounds(
  bridge: BridgePlacement,
  tileSize: number = BRIDGE_AUTHORING_TILE_SIZE,
): PortalCollisionBounds[] {
  const scale = tileSize / BRIDGE_AUTHORING_TILE_SIZE;
  const anchorX = bridge.tileX * tileSize;
  const anchorY = bridge.tileY * tileSize;

  return BRIDGE_COLLIDER_SPECS.map((spec) => ({
    left: anchorX + spec.x * scale,
    top: anchorY + spec.y * scale,
    right: anchorX + (spec.x + spec.width) * scale - 1,
    bottom: anchorY + (spec.y + spec.height) * scale - 1,
    shape: spec.shape,
    flipX: spec.flipX ?? false,
    flipY: spec.flipY ?? false,
  }));
}

function intersectsBounds(
  left: number,
  top: number,
  right: number,
  bottom: number,
  bounds: PortalBounds,
): boolean {
  return (
    left <= bounds.right &&
    right >= bounds.left &&
    top <= bounds.bottom &&
    bottom >= bounds.top
  );
}

function intersectsRightTriangle(
  left: number,
  top: number,
  right: number,
  bottom: number,
  bounds: PortalCollisionBounds,
): boolean {
  if (!intersectsBounds(left, top, right, bottom, bounds)) return false;

  const point = (xRatio: number, yRatio: number): [number, number] => [
    bounds.flipX
      ? bounds.right - xRatio * (bounds.right - bounds.left)
      : bounds.left + xRatio * (bounds.right - bounds.left),
    bounds.flipY
      ? bounds.bottom - yRatio * (bounds.bottom - bounds.top)
      : bounds.top + yRatio * (bounds.bottom - bounds.top),
  ];
  const triangle = [point(0, 0), point(0, 1), point(1, 1)];
  const rectangle: Array<[number, number]> = [
    [left, top],
    [right, top],
    [right, bottom],
    [left, bottom],
  ];
  const axes: Array<[number, number]> = [
    [1, 0],
    [0, 1],
  ];

  for (let index = 0; index < triangle.length; index++) {
    const start = triangle[index];
    const end = triangle[(index + 1) % triangle.length];
    axes.push([-(end[1] - start[1]), end[0] - start[0]]);
  }

  for (const [axisX, axisY] of axes) {
    const rectangleProjection = rectangle.map(([x, y]) => x * axisX + y * axisY);
    const triangleProjection = triangle.map(([x, y]) => x * axisX + y * axisY);
    if (
      Math.max(...rectangleProjection) < Math.min(...triangleProjection) ||
      Math.max(...triangleProjection) < Math.min(...rectangleProjection)
    ) {
      return false;
    }
  }

  return true;
}

function intersectsAuthoredCollision(
  left: number,
  top: number,
  right: number,
  bottom: number,
  bounds: PortalCollisionBounds,
): boolean {
  return bounds.shape === 'right-triangle'
    ? intersectsRightTriangle(left, top, right, bottom, bounds)
    : intersectsBounds(left, top, right, bottom, bounds);
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
  bridges: readonly BridgePlacement[] = [],
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
      if (
        isSolidTile(tx, ty, map) &&
        !(portal && isPortalWallOpeningTile(tx, ty, ts, portal))
      ) {
        return false;
      }
    }
  }

  // Check the portal rectangle and authored platform polygons.
  if (portal) {
    if (intersectsBounds(left, top, right, bottom, getPortalBounds(portal))) {
      return false;
    }
    for (const bounds of getPortalPlatformBounds(portal)) {
      if (intersectsAuthoredCollision(left, top, right, bottom, bounds)) return false;
    }
  }

  for (const bridge of bridges) {
    for (const bounds of getBridgeBounds(bridge, ts)) {
      if (intersectsAuthoredCollision(left, top, right, bottom, bounds)) return false;
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
  bridges: readonly BridgePlacement[] = [],
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
    if (isPositionValid(candidateX, y, map, portal, bridges)) {
      newX = candidateX;
    }
  }

  if (dy !== 0) {
    const candidateY = y + dy;
    if (isPositionValid(newX, candidateY, map, portal, bridges)) {
      newY = candidateY;
    }
  }

  return { x: newX, y: newY };
}
