import {
  CELL_STEP_X,
  MAX_SWAMP_LENGTH_CELLS,
  MIN_SWAMP_LENGTH_CELLS,
  WALL_WIDTH,
  type SwampPlacement,
} from './maps/level1.js';

const SWAMP_AUTHORING_TILE_SIZE = 16;
const SWAMP_AUTHORING_HEIGHT = 96;

/** Deep mud moves at one eighth of normal speed; firm ground remains full speed. */
export const SWAMP_SPEED_MULTIPLIER = 0.125;
/** Authoring-space pixels hidden from the bottom of a player standing in deep mud. */
export const SWAMP_DEEP_MUD_SUBMERGE_DEPTH = 6;

export type SwampTerrain = 'dry' | 'firm-ground' | 'deep-mud';

export interface SwampFirmGroundTile {
  pathIndex: number;
  tileX: number;
  tileY: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SwampWisdomHintTarget {
  swampIndex: number;
}

const FIRM_PATH_MIN_TILE_Y = 0;
const FIRM_PATH_MAX_TILE_Y = SWAMP_AUTHORING_HEIGHT / SWAMP_AUTHORING_TILE_SIZE - 1;
const FIRM_PATH_START_TILE_X = 3;
const FIRM_PATH_END_INSET_TILES = 4;
const FIRM_PATH_MAX_HORIZONTAL_RUN = 6;
const FIRM_PATH_HORIZONTAL_MOTIF_PERCENT = 45;
const FIRM_PATH_STAIRCASE_MOTIF_PERCENT = 80;
const FIRM_GAP_TILE_INTERVAL = 10;

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
  const widthTiles =
    WALL_WIDTH + (normalizedLength - MIN_SWAMP_LENGTH_CELLS) * CELL_STEP_X;
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

function hashFirmPath(seed: number, value: number, salt: number): number {
  let hash = seed ^ salt;
  hash = Math.imul(hash ^ (value + 1), 0x45d9f3b);
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x119de1f3);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

interface FirmPathCoordinate {
  tileX: number;
  tileY: number;
}

const firmPathCoordinateCache = new WeakMap<
  SwampPlacement,
  readonly FirmPathCoordinate[]
>();

function getFirmGapTileCount(widthTiles: number): number {
  return Math.max(1, Math.floor(widthTiles / FIRM_GAP_TILE_INTERVAL));
}

function getFirmGapTile(
  swamp: SwampPlacement,
  gapIndex: number,
  widthTiles: number,
): number {
  const gapCount = getFirmGapTileCount(widthTiles);
  const evenPosition = Math.round(((gapIndex + 1) * widthTiles) / (gapCount + 1));
  const jitter = (hashFirmPath(swamp.decorationSeed, gapIndex, 0xa54ff53a) % 3) - 1;
  return Math.max(2, Math.min(widthTiles - 3, evenPosition + jitter));
}

function isFirmPathGap(
  swamp: SwampPlacement,
  tileIndex: number,
  widthTiles: number,
): boolean {
  const gapCount = getFirmGapTileCount(widthTiles);
  for (let gapIndex = 0; gapIndex < gapCount; gapIndex++) {
    if (getFirmGapTile(swamp, gapIndex, widthTiles) === tileIndex) return true;
  }
  return false;
}

function getFirmPathNextTileY(
  seed: number,
  motifIndex: number,
  currentTileY: number,
): number {
  const candidates: number[] = [];
  for (let tileY = FIRM_PATH_MIN_TILE_Y; tileY <= FIRM_PATH_MAX_TILE_Y; tileY++) {
    if (tileY !== currentTileY) candidates.push(tileY);
  }
  const candidateIndex = hashFirmPath(seed, motifIndex, 0x3c6ef372) % candidates.length;
  return candidates[candidateIndex];
}

function getFirmPathCoordinates(swamp: SwampPlacement): readonly FirmPathCoordinate[] {
  const cached = firmPathCoordinateCache.get(swamp);
  if (cached) return cached;

  const widthTiles =
    getSwampAuthoringWidth(swamp.lengthCells) / SWAMP_AUTHORING_TILE_SIZE;
  const endTileX = widthTiles - FIRM_PATH_END_INSET_TILES;
  const coordinates: FirmPathCoordinate[] = [];
  const append = (tileX: number, tileY: number): void => {
    const previous = coordinates[coordinates.length - 1];
    if (previous?.tileX === tileX && previous.tileY === tileY) return;
    coordinates.push({ tileX, tileY });
  };

  let tileX = FIRM_PATH_START_TILE_X;
  let tileY =
    FIRM_PATH_MIN_TILE_Y +
    (hashFirmPath(swamp.decorationSeed, 0, 0xbb67ae85) %
      (FIRM_PATH_MAX_TILE_Y - FIRM_PATH_MIN_TILE_Y + 1));
  append(tileX, tileY);

  for (let motifIndex = 0; tileX < endTileX && motifIndex < 128; motifIndex++) {
    const motifRoll = hashFirmPath(swamp.decorationSeed, motifIndex, 0x510e527f) % 100;

    if (motifRoll < FIRM_PATH_HORIZONTAL_MOTIF_PERCENT) {
      const remainingColumns = endTileX - tileX;
      const horizontalRun =
        1 +
        (hashFirmPath(swamp.decorationSeed, motifIndex, 0x9b05688c) %
          Math.min(FIRM_PATH_MAX_HORIZONTAL_RUN, remainingColumns));
      for (let step = 0; step < horizontalRun; step++) {
        tileX++;
        append(tileX, tileY);
      }
      continue;
    }

    // Every turn begins with a horizontal tile. Besides keeping the route
    // readable, this guarantees that a mandatory mud-gap column is crossed
    // straight instead of silently moving the safe lane inside the gap.
    tileX++;
    append(tileX, tileY);
    if (tileX >= endTileX || isFirmPathGap(swamp, tileX, widthTiles)) continue;

    const nextTileY = getFirmPathNextTileY(swamp.decorationSeed, motifIndex, tileY);
    const verticalStep = Math.sign(nextTileY - tileY);
    const useStaircase =
      motifRoll < FIRM_PATH_STAIRCASE_MOTIF_PERCENT && Math.abs(nextTileY - tileY) >= 2;

    if (!useStaircase) {
      while (tileY !== nextTileY) {
        tileY += verticalStep;
        append(tileX, tileY);
      }
      continue;
    }

    // Spread taller turns over adjacent columns to make diagonal staircases
    // and zig-zags instead of repeating the same square-wave silhouette.
    while (tileY !== nextTileY) {
      tileY += verticalStep;
      append(tileX, tileY);
      if (tileY === nextTileY || tileX >= endTileX) break;

      tileX++;
      append(tileX, tileY);
      while (tileX < endTileX && isFirmPathGap(swamp, tileX, widthTiles)) {
        tileX++;
        append(tileX, tileY);
      }
    }
  }

  firmPathCoordinateCache.set(swamp, coordinates);
  return coordinates;
}

/** Terrain beneath a point in a swamp's original authoring coordinate space. */
export function getSwampTerrainAtAuthoringPoint(
  swamp: SwampPlacement,
  x: number,
  y: number,
): SwampTerrain {
  if (!isSwampWaterAtAuthoringPoint(swamp.lengthCells, x, y)) return 'dry';

  const widthTiles =
    getSwampAuthoringWidth(swamp.lengthCells) / SWAMP_AUTHORING_TILE_SIZE;
  const tileX = Math.floor(x / SWAMP_AUTHORING_TILE_SIZE);
  if (isFirmPathGap(swamp, tileX, widthTiles)) return 'deep-mud';

  return getFirmPathCoordinates(swamp).some(
    (coordinate) =>
      coordinate.tileX === tileX &&
      y >= coordinate.tileY * SWAMP_AUTHORING_TILE_SIZE &&
      y <
        (coordinate.tileY + 1) * SWAMP_AUTHORING_TILE_SIZE +
          SWAMP_DEEP_MUD_SUBMERGE_DEPTH,
  )
    ? 'firm-ground'
    : 'deep-mud';
}

/** Firm route segments in authoring space, excluding mandatory deep-mud gaps. */
export function getSwampFirmGroundTiles(
  swamp: SwampPlacement,
): readonly SwampFirmGroundTile[] {
  const widthTiles =
    getSwampAuthoringWidth(swamp.lengthCells) / SWAMP_AUTHORING_TILE_SIZE;
  const tiles: SwampFirmGroundTile[] = [];

  for (const coordinate of getFirmPathCoordinates(swamp)) {
    if (isFirmPathGap(swamp, coordinate.tileX, widthTiles)) continue;
    const centerX = (coordinate.tileX + 0.5) * SWAMP_AUTHORING_TILE_SIZE;
    // The authored north bank covers the upper half of row zero. Sampling the
    // tile's lower edge keeps valid top-lane route tiles without treating the
    // dry pixels above the shoreline as mud.
    const waterSampleY = (coordinate.tileY + 1) * SWAMP_AUTHORING_TILE_SIZE - 1;
    if (!isSwampWaterAtAuthoringPoint(swamp.lengthCells, centerX, waterSampleY)) continue;
    tiles.push({
      pathIndex: tiles.length,
      tileX: coordinate.tileX,
      tileY: coordinate.tileY,
      x: coordinate.tileX * SWAMP_AUTHORING_TILE_SIZE,
      y: coordinate.tileY * SWAMP_AUTHORING_TILE_SIZE,
      width: SWAMP_AUTHORING_TILE_SIZE,
      height: SWAMP_AUTHORING_TILE_SIZE + SWAMP_DEEP_MUD_SUBMERGE_DEPTH,
    });
  }

  return tiles;
}

/** Find the closest swamp eligible to replace a directional wisdom hint. */
export function findSwampWisdomHintTarget(
  swamps: readonly SwampPlacement[],
  playerX: number,
  playerY: number,
  tileSize: number = SWAMP_AUTHORING_TILE_SIZE,
  maxDistance: number = tileSize * 2.5,
): SwampWisdomHintTarget | null {
  const scale = tileSize / SWAMP_AUTHORING_TILE_SIZE;
  const maxDistanceSquared = maxDistance * maxDistance;
  let nearest: (SwampWisdomHintTarget & { distanceSquared: number }) | null = null;

  for (let swampIndex = 0; swampIndex < swamps.length; swampIndex++) {
    const swamp = swamps[swampIndex];
    const left = swamp.tileX * tileSize;
    const top = swamp.tileY * tileSize;
    const right = left + getSwampAuthoringWidth(swamp.lengthCells) * scale;
    const bottom = top + SWAMP_AUTHORING_HEIGHT * scale;
    const nearestX = Math.max(left, Math.min(right, playerX));
    const nearestY = Math.max(top, Math.min(bottom, playerY));
    const dx = playerX - nearestX;
    const dy = playerY - nearestY;
    const distanceSquared = dx * dx + dy * dy;
    if (
      distanceSquared <= maxDistanceSquared &&
      (nearest === null || distanceSquared < nearest.distanceSquared)
    ) {
      nearest = { swampIndex, distanceSquared };
    }
  }

  return nearest ? { swampIndex: nearest.swampIndex } : null;
}

/** Swamp terrain beneath a bottom-center player position. */
export function getPlayerSwampTerrain(
  swamps: readonly SwampPlacement[],
  x: number,
  y: number,
  tileSize: number = SWAMP_AUTHORING_TILE_SIZE,
): SwampTerrain {
  const scale = tileSize / SWAMP_AUTHORING_TILE_SIZE;
  if (scale <= 0) return 'dry';

  for (const swamp of swamps) {
    const anchorX = swamp.tileX * tileSize;
    const anchorY = swamp.tileY * tileSize;
    const localX = (x - anchorX) / scale;
    const localY = (y - 1 - anchorY) / scale;
    const terrain = getSwampTerrainAtAuthoringPoint(swamp, localX, localY);
    if (terrain !== 'dry') return terrain;
  }

  return 'dry';
}

/** True when a bottom-center player position falls inside the authored water shape. */
export function isPlayerInSwamp(
  swamps: readonly SwampPlacement[],
  x: number,
  y: number,
  tileSize: number = SWAMP_AUTHORING_TILE_SIZE,
): boolean {
  return getPlayerSwampTerrain(swamps, x, y, tileSize) !== 'dry';
}
