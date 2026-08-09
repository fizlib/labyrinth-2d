import {
  CELL_STEP_X,
  MAX_SWAMP_LENGTH_CELLS,
  MIN_SWAMP_LENGTH_CELLS,
  WALL_WIDTH,
  type SwampPlacement,
} from './maps/level1.js';

const SWAMP_AUTHORING_TILE_SIZE = 16;
const SWAMP_AUTHORING_HEIGHT = 96;

/** A swamp cuts movement speed in half while the player's feet are in water. */
export const SWAMP_SPEED_MULTIPLIER = 0.5;

// Main water span on each authored pixel row. Tiny disconnected shoreline
// glints are intentionally excluded so the wet-state cannot flicker on grass.
const WATER_LEFT_BY_ROW = [
  -1, -1, -1, -1, -1, -1, -1, -1, 8, 7, 6, 5, 4, 6, 6, 8, 11, 11, 13, 15, 14, 15, 34, 36,
  38, 39, 39, 40, 40, 41, 41, 40, 40, 39, 35, 35, 34, 34, 33, 33, 29, 29, 27, 27, 26, 26,
  25, 24, 25, 24, 26, 26, 28, 29, 28, 29, 29, 29, 28, 27, 26, 26, 24, 24, 24, 24, 24, 24,
  25, 24, 23, 23, 21, 21, 20, 21, 22, 22, 23, 24, 27, 27, 29, 31, 30, 31, 34, 36, 38, 39,
  39, 40, 40, 41, 41, 40,
] as const;

const WATER_RIGHT_BY_ROW = [
  -1, -1, -1, -1, -1, -1, -1, -1, 54, 146, 147, 148, 148, 150, 151, 151, 150, 150, 149,
  149, 147, 146, 146, 146, 146, 146, 146, 148, 149, 149, 151, 150, 149, 150, 150, 150,
  151, 152, 153, 155, 167, 167, 168, 170, 170, 168, 168, 167, 166, 166, 166, 166, 164,
  163, 158, 157, 157, 156, 156, 154, 154, 152, 150, 150, 150, 151, 156, 156, 156, 156,
  157, 157, 167, 167, 168, 170, 170, 168, 168, 167, 166, 166, 165, 165, 163, 162, 162,
  162, 162, 162, 162, 164, 165, 165, 167, 166,
] as const;

function normalizeLengthCells(lengthCells: number): number {
  return Math.max(
    MIN_SWAMP_LENGTH_CELLS,
    Math.min(MAX_SWAMP_LENGTH_CELLS, Math.round(lengthCells)),
  );
}

/** Pixel width of the rendered swamp at its original 16px authoring scale. */
export function getSwampAuthoringWidth(lengthCells: number): number {
  const normalizedLength = normalizeLengthCells(lengthCells);
  const widthTiles = WALL_WIDTH + (normalizedLength - MIN_SWAMP_LENGTH_CELLS) * CELL_STEP_X;
  return widthTiles * SWAMP_AUTHORING_TILE_SIZE;
}

/** True when an authoring-space point is inside the extended shoreline. */
export function isSwampWaterAtAuthoringPoint(
  lengthCells: number,
  x: number,
  y: number,
): boolean {
  const pixelX = Math.floor(x);
  const pixelY = Math.floor(y);
  const width = getSwampAuthoringWidth(lengthCells);
  if (pixelX < 0 || pixelX >= width || pixelY < 0 || pixelY >= SWAMP_AUTHORING_HEIGHT) {
    return false;
  }

  const waterLeft = WATER_LEFT_BY_ROW[pixelY];
  const waterRight = WATER_RIGHT_BY_ROW[pixelY];
  const extendedWaterRight = waterRight + width - WALL_WIDTH * SWAMP_AUTHORING_TILE_SIZE;
  return waterLeft >= 0 && pixelX >= waterLeft && pixelX <= extendedWaterRight;
}

/** True when a bottom-center player position falls inside the authored water shape. */
export function isPlayerInSwamp(
  swamps: readonly SwampPlacement[],
  x: number,
  y: number,
  tileSize: number = SWAMP_AUTHORING_TILE_SIZE,
): boolean {
  const scale = tileSize / SWAMP_AUTHORING_TILE_SIZE;
  if (scale <= 0) return false;

  for (const swamp of swamps) {
    const anchorX = swamp.tileX * tileSize;
    const anchorY = swamp.tileY * tileSize;
    const localX = Math.floor((x - anchorX) / scale);
    const localY = Math.floor((y - 1 - anchorY) / scale);
    if (isSwampWaterAtAuthoringPoint(swamp.lengthCells, localX, localY)) return true;
  }

  return false;
}
