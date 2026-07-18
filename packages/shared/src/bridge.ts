import type { PortalBounds } from './physics.js';
import type { BridgePlacement } from './maps/level1.js';

const BRIDGE_AUTHORING_TILE_SIZE = 16;
const BRIDGE_PATH_RANDOM_SALT = 0x2f6e2b1d;
const BRIDGE_WALKWAY_X = 32;
export const BRIDGE_WALKWAY_ROW_Y = [41, 56, 71, 86, 101, 116] as const;
const BRIDGE_WALKWAY_TILE_WIDTH = 16;
const BRIDGE_WALKWAY_TILE_HEIGHT = 15;

export const BRIDGE_WALKWAY_ROWS = 6;
export const BRIDGE_WALKWAY_COLUMNS = 2;
export const BRIDGE_WALKWAY_TILE_COUNT = BRIDGE_WALKWAY_ROWS * BRIDGE_WALKWAY_COLUMNS;
export const BRIDGE_REPAIR_DURATION_MS = 10_000;
export const BRIDGE_TILE_RESTORE_DURATION_MS = 250;

export type BridgeEntrySide = 'north' | 'south';
export type BridgeTravelDirection = 'north' | 'south';

export interface BridgeTileCoordinate {
  row: number;
  column: number;
}

/** Authoritative mutable state for one generated bridge. */
export interface BridgeState {
  /** Index into GeneratedMazeLayout.bridges. */
  bridgeIndex: number;
  /** Bit row * 2 + column is set when that walkway stone is missing. */
  collapsedTileMask: number;
  /** Circle currently channeling a repair, or null while idle. */
  repairingSide: BridgeEntrySide | null;
  /** Whether a player is currently holding the repair circle. */
  repairActive: boolean;
  /** Authoritative tick on which the current repair began. */
  repairStartedTick: number | null;
  /** Missing stones captured when this repair began. */
  repairInitialCollapsedTileMask: number;
}

export interface BridgeRepairCircleBounds extends PortalBounds {
  side: BridgeEntrySide;
}

/** Return the bit used by a walkway tile in safe/collapsed masks. */
export function getBridgeTileBit(row: number, column: number): number {
  if (
    row < 0 ||
    row >= BRIDGE_WALKWAY_ROWS ||
    column < 0 ||
    column >= BRIDGE_WALKWAY_COLUMNS
  ) {
    return 0;
  }
  return 1 << (row * BRIDGE_WALKWAY_COLUMNS + column);
}

export function isBridgeTileSafe(
  bridge: Pick<BridgePlacement, 'safeTileMask'>,
  row: number,
  column: number,
): boolean {
  const bit = getBridgeTileBit(row, column);
  return bit !== 0 && (bridge.safeTileMask & bit) !== 0;
}

/** Pixel bounds for one of the 12 central puzzle stones. */
export function getBridgeWalkwayTileBounds(
  bridge: Pick<BridgePlacement, 'tileX' | 'tileY'>,
  row: number,
  column: number,
  tileSize: number = BRIDGE_AUTHORING_TILE_SIZE,
): PortalBounds {
  const scale = tileSize / BRIDGE_AUTHORING_TILE_SIZE;
  const left =
    bridge.tileX * tileSize +
    (BRIDGE_WALKWAY_X + column * BRIDGE_WALKWAY_TILE_WIDTH) * scale;
  const top = bridge.tileY * tileSize + BRIDGE_WALKWAY_ROW_Y[row] * scale;
  const width = BRIDGE_WALKWAY_TILE_WIDTH * scale;
  const height = BRIDGE_WALKWAY_TILE_HEIGHT * scale;
  return {
    left,
    top,
    right: left + width - 1,
    bottom: top + height - 1,
  };
}

/** Resolve a world-space point to a bridge walkway tile. */
export function getBridgeWalkwayTileAtPoint(
  bridge: Pick<BridgePlacement, 'tileX' | 'tileY'>,
  x: number,
  y: number,
  tileSize: number = BRIDGE_AUTHORING_TILE_SIZE,
): BridgeTileCoordinate | null {
  for (let row = 0; row < BRIDGE_WALKWAY_ROWS; row++) {
    for (let column = 0; column < BRIDGE_WALKWAY_COLUMNS; column++) {
      const bounds = getBridgeWalkwayTileBounds(bridge, row, column, tileSize);
      if (
        x >= bounds.left &&
        x < bounds.right + 1 &&
        y >= bounds.top &&
        y < bounds.bottom + 1
      ) {
        return { row, column };
      }
    }
  }
  return null;
}

/**
 * Resolve the stones touched horizontally by a feet hitbox whose center is on
 * the walkway. This prevents the seam between columns from acting as a third,
 * unchecked route while retaining feet-center row tracking.
 */
export function getBridgeWalkwayTileMaskAtFeetCenter(
  bridge: Pick<BridgePlacement, 'tileX' | 'tileY'>,
  x: number,
  y: number,
  feetWidth: number,
  tileSize: number = BRIDGE_AUTHORING_TILE_SIZE,
): number {
  const centerTile = getBridgeWalkwayTileAtPoint(bridge, x, y, tileSize);
  if (!centerTile || feetWidth <= 0) return 0;

  const left = x - feetWidth / 2;
  const right = left + feetWidth - 1;
  let mask = 0;
  for (let column = 0; column < BRIDGE_WALKWAY_COLUMNS; column++) {
    const bounds = getBridgeWalkwayTileBounds(bridge, centerTile.row, column, tileSize);
    if (left <= bounds.right && right >= bounds.left) {
      mask |= getBridgeTileBit(centerTile.row, column);
    }
  }
  return mask;
}

/** Authored north/south treasure-circle trigger bounds. */
export function getBridgeRepairCircleBounds(
  bridge: Pick<BridgePlacement, 'tileX' | 'tileY'>,
  tileSize: number = BRIDGE_AUTHORING_TILE_SIZE,
): BridgeRepairCircleBounds[] {
  const scale = tileSize / BRIDGE_AUTHORING_TILE_SIZE;
  const anchorX = bridge.tileX * tileSize;
  const anchorY = bridge.tileY * tileSize;
  const specs = [
    { side: 'north' as const, x: 16, y: 10 },
    { side: 'south' as const, x: 64, y: 144 },
  ];

  return specs.map((spec) => ({
    side: spec.side,
    left: anchorX + spec.x * scale,
    top: anchorY + spec.y * scale,
    right: anchorX + (spec.x + 16) * scale - 1,
    bottom: anchorY + (spec.y + 16) * scale - 1,
  }));
}

/**
 * Both columns in every row strictly ahead of the failed tile. At a terminal
 * row, where no puzzle stone exists ahead, all other central rows collapse so
 * the mistake cannot leave the bridge intact.
 */
export function getBridgeCollapseMask(
  failedRow: number,
  direction: BridgeTravelDirection,
): number {
  let mask = 0;
  const start = direction === 'north' ? 0 : failedRow + 1;
  const end = direction === 'north' ? failedRow : BRIDGE_WALKWAY_ROWS;

  for (let row = start; row < end; row++) {
    for (let column = 0; column < BRIDGE_WALKWAY_COLUMNS; column++) {
      mask |= getBridgeTileBit(row, column);
    }
  }

  if (mask === 0 && failedRow >= 0 && failedRow < BRIDGE_WALKWAY_ROWS) {
    for (let row = 0; row < BRIDGE_WALKWAY_ROWS; row++) {
      if (row === failedRow) continue;
      for (let column = 0; column < BRIDGE_WALKWAY_COLUMNS; column++) {
        mask |= getBridgeTileBit(row, column);
      }
    }
  }
  return mask;
}

/** Missing-tile bits ordered outward from the circle that began the repair. */
export function getBridgeRepairTileOrder(
  collapsedTileMask: number,
  side: BridgeEntrySide,
): number[] {
  const rows = Array.from({ length: BRIDGE_WALKWAY_ROWS }, (_, row) => row);
  if (side === 'south') rows.reverse();
  const columns = side === 'north' ? [0, 1] : [1, 0];
  const bits: number[] = [];

  for (const row of rows) {
    for (const column of columns) {
      const bit = getBridgeTileBit(row, column);
      if ((collapsedTileMask & bit) !== 0) bits.push(bit);
    }
  }
  return bits;
}

/**
 * Remaining collapsed mask at an elapsed repair time. Tile rise animations
 * are distributed across the fixed ten-second channel and finish at its end.
 */
export function getBridgeRepairCollapsedMask(
  initialCollapsedTileMask: number,
  side: BridgeEntrySide,
  elapsedMs: number,
): number {
  const orderedBits = getBridgeRepairTileOrder(initialCollapsedTileMask, side);
  if (orderedBits.length === 0) return 0;

  const restoreWindowMs = BRIDGE_REPAIR_DURATION_MS - BRIDGE_TILE_RESTORE_DURATION_MS;
  const clampedElapsedMs = Math.max(0, Math.min(elapsedMs, restoreWindowMs));
  const restoredCount =
    orderedBits.length === 1
      ? clampedElapsedMs >= restoreWindowMs
        ? 1
        : 0
      : Math.min(
          orderedBits.length,
          1 +
            Math.floor(
              (clampedElapsedMs * (orderedBits.length - 1)) / restoreWindowMs,
            ),
        );

  let mask = initialCollapsedTileMask;
  for (let index = 0; index < restoredCount; index++) {
    mask &= ~orderedBits[index];
  }
  return mask;
}

/** Safe bottom-center player position just outside the requested bridge end. */
export function getBridgeBankReturnPosition(
  bridge: Pick<BridgePlacement, 'tileX' | 'tileY' | 'safeTileMask'>,
  side: BridgeEntrySide,
  tileSize: number = BRIDGE_AUTHORING_TILE_SIZE,
): { x: number; y: number } {
  const row = side === 'north' ? 0 : BRIDGE_WALKWAY_ROWS - 1;
  const safeColumn = [0, 1].find((column) => isBridgeTileSafe(bridge, row, column)) ?? 0;
  const scale = tileSize / BRIDGE_AUTHORING_TILE_SIZE;
  return {
    x:
      bridge.tileX * tileSize +
      (BRIDGE_WALKWAY_X + safeColumn * BRIDGE_WALKWAY_TILE_WIDTH + 8) * scale,
    y: bridge.tileY * tileSize + (side === 'north' ? 24 : 160) * scale,
  };
}

function mulberry32(seed: number): () => number {
  return () => {
    let value = (seed += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function collectTurnSets(
  nextRow: number,
  remaining: number,
  selected: number[],
  output: number[][],
): void {
  if (remaining === 0) {
    output.push([...selected]);
    return;
  }

  for (let row = nextRow; row <= BRIDGE_WALKWAY_ROWS - 2; row++) {
    selected.push(row);
    collectTurnSets(row + 2, remaining - 1, selected, output);
    selected.pop();
  }
}

function buildBridgePathCatalogue(): number[] {
  const turnSets: number[][] = [];
  collectTurnSets(1, 1, [], turnSets);
  collectTurnSets(1, 2, [], turnSets);
  const masks: number[] = [];

  for (const firstColumn of [0, 1]) {
    for (const turns of turnSets) {
      const turnRows = new Set(turns);
      let column = firstColumn;
      let mask = getBridgeTileBit(0, column);

      for (let row = 1; row < BRIDGE_WALKWAY_ROWS - 1; row++) {
        if (turnRows.has(row)) {
          mask |= getBridgeTileBit(row, 0) | getBridgeTileBit(row, 1);
          column = 1 - column;
        } else {
          mask |= getBridgeTileBit(row, column);
        }
      }
      mask |= getBridgeTileBit(BRIDGE_WALKWAY_ROWS - 1, column);
      masks.push(mask);
    }
  }
  return masks;
}

/** Deterministically choose distinct connected paths for a room's bridges. */
export function generateBridgeSafeTileMasks(count: number, seed: number): number[] {
  const catalogue = buildBridgePathCatalogue();
  if (count > catalogue.length) {
    throw new Error(`Requested ${count} bridge paths from ${catalogue.length} templates`);
  }

  const random = mulberry32(seed ^ BRIDGE_PATH_RANDOM_SALT);
  for (let index = catalogue.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(random() * (index + 1));
    [catalogue[index], catalogue[swapIndex]] = [catalogue[swapIndex], catalogue[index]];
  }
  return catalogue.slice(0, count);
}
