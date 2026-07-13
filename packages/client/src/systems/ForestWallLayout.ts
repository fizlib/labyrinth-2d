import type { TileMapData } from '@labyrinth/shared';
import {
  CELL_SIZE,
  CELL_STEP_X,
  CELL_STEP_Y,
  GRID_CELLS,
  TILE_WALL_FACE,
  TILE_WALL_TOP_EDGE,
  WALL_HEIGHT,
  WALL_WIDTH,
  getHubTileBounds,
} from '@labyrinth/shared';

export type ForestStyleDirection = 'north' | 'south' | 'west' | 'east' | 'ground' | 'terrain';

export interface ForestStylePlacementSpec {
  name: string;
  assetId: number;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  flipX: boolean;
  flipY: boolean;
  direction: ForestStyleDirection;
}

type ForestStyleTuple = readonly [
  assetId: number,
  x: number,
  y: number,
  width: number,
  height: number,
  zIndex: number,
  flipX: 0 | 1,
  flipY: 0 | 1,
];

const AUTHORED_TILE_SIZE = 16;
const AUTHORED_WALL_SIZE = 8;
const DEFAULT_FOREST_GROUND_ASSET_ID = 301;
const SOUTH_FACE_ROW_STARTS = [38, 88, 138, 188, 238, 288, 338, 388] as const;
const SOUTH_WEST_SOLID_COLUMN_GROUND_IDS = [102, 997, 102, 102, 105, 102, 105, 105, 102, 105] as const;

/**
 * The authored additions in style export (12)'s labyrinth-style-v1.json.
 * Coordinates are pixels in its 352x352 sample (an eight-tile wall around one
 * six-tile maze cell). Straight edges are assembled separately so their
 * patterns continue across logical cell boundaries.
 */
const FOREST_STYLE_STENCIL: readonly ForestStyleTuple[] = [
  [440,128,127,16,6,1,0,0],[441,144,127,16,6,1,0,0],[442,160,127,16,6,1,0,0],[443,176,126,16,6,1,0,0],[438,192,128,16,6,1,0,0],[439,208,128,16,6,1,0,0],
  [1281,224,48,16,16,120,0,0],[1231,224,32,16,16,120,0,0],[1181,224,16,16,16,120,0,0],[1131,224,6,11,10,120,0,0],[549,220,64,16,16,121,0,0],[550,236,64,16,16,120,0,0],[1282,236,48,16,16,125,0,0],[1232,240,32,16,16,126,0,0],
  [599,221,80,14,16,120,0,0],[600,235,80,16,16,120,0,0],[549,220,96,16,16,121,0,0],[550,236,96,16,16,120,0,0],[599,221,112,14,16,120,0,0],[600,235,112,16,16,120,0,0],[549,220,128,16,16,121,0,0],[550,236,128,16,16,120,0,0],[599,221,144,14,16,120,0,0],[600,235,144,16,16,120,0,0],[549,220,160,16,16,121,0,0],[550,236,160,16,16,120,0,0],[599,221,176,14,16,120,0,0],[600,235,176,16,16,120,0,0],[549,220,192,16,16,121,0,0],[550,236,192,16,16,120,0,0],[592,219,208,16,16,120,0,0],[593,235,208,16,16,120,0,0],
  [493,203,210,16,14,120,0,0],[539,187,210,16,14,120,0,0],[493,171,210,16,14,120,0,0],[539,155,210,16,14,120,0,0],[493,139,210,16,14,120,0,0],[539,123,210,16,14,120,0,0],[587,118,208,16,16,121,0,0],
  [580,118,176,14,16,120,0,0],[580,118,144,14,16,120,0,0],[580,118,112,14,16,120,0,0],[580,118,80,14,16,120,0,0],[580,118,48,14,16,120,0,0],
  [1181,112,16,16,16,120,1,0],[1232,96,33,16,16,126,1,0],[550,102,64,16,16,120,1,1],[550,102,96,16,16,120,1,1],[600,102,48,16,16,120,1,1],[600,102,80,16,16,120,1,1],[550,102,128,16,16,120,1,1],[550,102,160,16,16,120,1,1],[600,102,112,16,16,120,1,1],[600,102,144,16,16,120,1,1],[550,102,192,16,16,120,1,1],[600,102,176,16,16,120,1,1],[600,102,208,16,16,120,1,1],
  [636,102,224,16,16,120,0,0],[589,118,224,16,16,120,0,0],[590,134,224,16,16,120,0,0],[589,150,224,16,16,120,0,0],[590,166,224,16,16,120,0,0],[589,182,224,16,16,120,0,0],[590,198,224,16,16,120,0,0],[589,214,224,16,16,120,0,0],[590,230,224,16,16,120,0,0],[636,235,224,16,16,121,1,0],
  [549,0,80,16,16,121,0,0],[550,16,80,16,16,120,0,0],[599,1,96,14,16,120,0,0],[600,15,96,16,16,120,0,0],[549,0,112,16,16,121,0,0],[550,16,112,16,16,120,0,0],[599,1,128,14,16,120,0,0],[600,15,128,16,16,120,0,0],[549,0,144,16,16,121,0,0],[550,16,144,16,16,120,0,0],[599,1,160,14,16,120,0,0],[600,15,160,16,16,120,0,0],[549,0,176,16,16,121,0,0],[550,16,176,16,16,120,0,0],[599,1,192,14,16,120,0,0],[600,15,192,16,16,120,0,0],[549,0,208,16,16,121,0,0],[550,16,208,16,16,120,0,0],
  [549,0,48,16,16,121,0,0],[550,16,48,16,16,120,0,0],[599,1,64,14,16,120,0,0],[600,15,64,16,16,120,0,0],[599,1,32,14,16,120,0,0],[600,15,32,16,16,120,0,0],[492,5,4,12,12,120,0,0],[599,5,36,14,16,120,0,0],[549,1,16,16,16,121,0,0],[539,17,1,16,15,120,0,0],[543,17,16,16,16,120,0,0],[493,33,2,16,14,120,0,0],[590,33,16,16,16,120,0,0],[539,49,2,16,15,120,0,0],[589,49,17,16,16,120,0,0],[493,65,3,16,14,120,0,0],[590,65,17,16,16,120,0,0],
  [599,1,224,14,16,120,0,0],[600,15,224,16,16,120,0,0],[549,0,240,16,16,121,0,0],[550,16,240,16,16,120,0,0],
];

export function isForestWallTileId(tileId: number): boolean {
  return tileId >= TILE_WALL_FACE && tileId <= TILE_WALL_TOP_EDGE;
}

function isForestAt(x: number, y: number, map: TileMapData): boolean {
  if (x < 0 || x >= map.width || y < 0 || y >= map.height) return false;
  return isForestWallTileId(map.data[y * map.width + x]);
}

function getSouthForestFaceRow(x: number, y: number, map: TileMapData): number | null {
  const faceHeight = 8;
  for (let distanceToBase = 0; distanceToBase < faceHeight; distanceToBase++) {
    if (!isForestAt(x, y + distanceToBase, map)) return null;
    if (!isForestAt(x, y + distanceToBase + 1, map)) return faceHeight - distanceToBase - 1;
  }
  return null;
}

function hasWestEdgeExposureAlongColumn(x: number, y: number, directionY: -1 | 1, map: TileMapData): boolean {
  for (let distance = 1; distance <= CELL_STEP_Y; distance++) {
    const candidateY = y + distance * directionY;
    if (!isForestAt(x, candidateY, map)) return false;
    if (!isForestAt(x + 1, candidateY, map)) return true;
  }
  return false;
}

function shouldRenderWestEdge(x: number, y: number, map: TileMapData): boolean {
  if (!isForestAt(x, y, map)) return false;
  if (!isForestAt(x + 1, y, map)) return true;
  return hasWestEdgeExposureAlongColumn(x, y, -1, map) &&
    hasWestEdgeExposureAlongColumn(x, y, 1, map);
}

function hasEastEdgeExposureAlongColumn(x: number, y: number, directionY: -1 | 1, map: TileMapData): boolean {
  for (let distance = 1; distance <= CELL_STEP_Y; distance++) {
    const candidateY = y + distance * directionY;
    if (!isForestAt(x, candidateY, map)) return false;
    if (!isForestAt(x - 1, candidateY, map)) return true;
  }
  return false;
}

function shouldRenderEastEdge(x: number, y: number, map: TileMapData): boolean {
  if (!isForestAt(x, y, map)) return false;
  if (!isForestAt(x - 1, y, map)) return true;
  return hasEastEdgeExposureAlongColumn(x, y, -1, map) &&
    hasEastEdgeExposureAlongColumn(x, y, 1, map);
}

function hasNorthEdgeExposureAlongRow(x: number, y: number, directionX: -1 | 1, map: TileMapData): boolean {
  for (let distance = 1; distance <= CELL_STEP_X; distance++) {
    const candidateX = x + distance * directionX;
    if (!isForestAt(candidateX, y, map)) return false;
    if (!isForestAt(candidateX, y - 1, map)) return true;
  }
  return false;
}

function shouldRenderNorthEdge(x: number, y: number, map: TileMapData): boolean {
  if (!isForestAt(x, y, map)) return false;
  if (!isForestAt(x, y - 1, map)) return true;
  return hasNorthEdgeExposureAlongRow(x, y, -1, map) &&
    hasNorthEdgeExposureAlongRow(x, y, 1, map);
}

function isTopLeftForestCorner(x: number, y: number, map: TileMapData): boolean {
  return isForestAt(x, y, map) &&
    !isForestAt(x - 1, y, map) &&
    !isForestAt(x, y - 1, map) &&
    isForestAt(x + 1, y, map) &&
    isForestAt(x, y + 1, map);
}

function isTopRightForestCorner(x: number, y: number, map: TileMapData): boolean {
  return isForestAt(x, y, map) &&
    !isForestAt(x + 1, y, map) &&
    !isForestAt(x, y - 1, map) &&
    isForestAt(x - 1, y, map) &&
    isForestAt(x, y + 1, map);
}

function isInnerNorthEastForestCorner(x: number, y: number, map: TileMapData): boolean {
  return isForestAt(x, y, map) &&
    isForestAt(x - 1, y, map) &&
    isForestAt(x, y - 1, map) &&
    !isForestAt(x - 1, y - 1, map);
}

function isInnerNorthWestForestCorner(x: number, y: number, map: TileMapData): boolean {
  return isForestAt(x, y, map) &&
    isForestAt(x + 1, y, map) &&
    isForestAt(x, y - 1, map) &&
    !isForestAt(x + 1, y - 1, map);
}

function isPairedInnerNorthConnection(cornerX: number, cornerY: number, map: TileMapData): boolean {
  return isInnerNorthWestForestCorner(cornerX, cornerY, map) &&
    isInnerNorthEastForestCorner(cornerX - (WALL_WIDTH - 1), cornerY, map);
}

function isDuplicateInnerNorthEastContinuation(x: number, y: number, map: TileMapData): boolean {
  for (let distanceToCorner = 1; distanceToCorner < WALL_HEIGHT; distanceToCorner++) {
    if (isInnerNorthEastForestCorner(x, y - distanceToCorner, map)) return true;
  }
  return false;
}

function isDuplicateInnerNorthWestContinuation(x: number, y: number, map: TileMapData): boolean {
  for (let distanceToCorner = 0; distanceToCorner < WALL_HEIGHT; distanceToCorner++) {
    if (isInnerNorthWestForestCorner(x, y - distanceToCorner, map)) return true;
  }
  return false;
}

function isDuplicatePairedNorthEdge(
  x: number,
  y: number,
  part: 'top' | 'bottom',
  map: TileMapData,
): boolean {
  if (isInnerNorthWestForestCorner(x - 1, y, map)) return true;
  for (let cornerX = x - 1; cornerX <= x + WALL_WIDTH - 2; cornerX++) {
    if (!isPairedInnerNorthConnection(cornerX, y, map)) continue;
    const startX = cornerX - WALL_WIDTH + (part === 'top' ? 2 : 3);
    if (x >= startX && x <= cornerX + 1) return true;
  }
  return false;
}

function isBottomRightForestCorner(x: number, y: number, map: TileMapData): boolean {
  return x + 1 < map.width &&
    y + 1 < map.height &&
    isForestAt(x, y, map) &&
    !isForestAt(x + 1, y, map) &&
    !isForestAt(x, y + 1, map) &&
    isForestAt(x - 3, y, map) &&
    isForestAt(x, y - 5, map);
}

function isBottomLeftForestCorner(x: number, y: number, map: TileMapData): boolean {
  return x > 1 &&
    y + 1 < map.height &&
    isForestAt(x, y, map) &&
    isForestAt(x - 1, y, map) &&
    !isForestAt(x - 2, y, map) &&
    !isForestAt(x, y + 1, map) &&
    isForestAt(x + 3, y, map) &&
    isForestAt(x, y - 5, map);
}

function getBottomLeftCornerGroundAssetId(x: number, y: number, map: TileMapData): number | null {
  for (let distanceToCorner = 0;
    distanceToCorner < SOUTH_WEST_SOLID_COLUMN_GROUND_IDS.length;
    distanceToCorner++) {
    if (isBottomLeftForestCorner(x + 1, y + distanceToCorner, map)) {
      return SOUTH_WEST_SOLID_COLUMN_GROUND_IDS[distanceToCorner];
    }
  }
  return null;
}

function getBottomLeftCornerRootGroundAssetId(x: number, y: number, map: TileMapData): number | null {
  // The two bottom trunk modules (1048/1049) contain transparent pixels around
  // their roots. Match the authored grass row immediately below the corner so
  // those gaps do not reveal the nearly-black forest interior underlay.
  if (isBottomLeftForestCorner(x, y, map) ||
      isBottomLeftForestCorner(x - 1, y, map)) return 105;
  return null;
}

/** Extra grass fill drawn below the existing ground tile in the root column. */
export function getForestGroundUnderlayAssetId(x: number, y: number, map: TileMapData): number | null {
  for (let distanceToCorner = 0; distanceToCorner <= 4; distanceToCorner++) {
    if (isBottomLeftForestCorner(x + 1, y + distanceToCorner, map)) return 102;
  }
  return null;
}

/** Ground tile used beneath the authored forest modules at a map coordinate. */
export function getForestGroundAssetId(x: number, y: number, map: TileMapData): number {
  const bottomLeftCornerAssetId = getBottomLeftCornerGroundAssetId(x, y, map);
  if (bottomLeftCornerAssetId !== null) return bottomLeftCornerAssetId;
  const bottomLeftCornerRootAssetId = getBottomLeftCornerRootGroundAssetId(x, y, map);
  if (bottomLeftCornerRootAssetId !== null) return bottomLeftCornerRootAssetId;
  if (isBottomRightForestCorner(x, y + 4, map)) return 110;
  if (isBottomRightForestCorner(x, y + 3, map) ||
      isBottomRightForestCorner(x, y + 2, map)) return 160;
  return DEFAULT_FOREST_GROUND_ASSET_ID;
}

function isReplacedByBottomRightCornerFace(x: number, y: number, map: TileMapData): boolean {
  for (let cornerY = y; cornerY <= y + 4; cornerY++) {
    for (let cornerX = x; cornerX <= x + 2; cornerX++) {
      if (!isBottomRightForestCorner(cornerX, cornerY, map)) continue;
      const distanceX = cornerX - x;
      const distanceY = cornerY - y;
      if (distanceY === 4) return distanceX === 0;
      if (distanceY <= 3) return true;
    }
  }
  return false;
}

function isReplacedByBottomRightCornerFringe(x: number, y: number, map: TileMapData): boolean {
  for (let cornerX = x; cornerX <= x + 3; cornerX++) {
    if (isBottomRightForestCorner(cornerX, y, map)) return true;
  }
  return false;
}

function isReplacedByBottomLeftCornerFace(x: number, y: number, map: TileMapData): boolean {
  for (let cornerY = y; cornerY <= y + 4; cornerY++) {
    for (let cornerX = x - 1; cornerX <= x; cornerX++) {
      if (isBottomLeftForestCorner(cornerX, cornerY, map)) return true;
    }
  }
  return false;
}

function isBottomLeftCornerAddedFaceColumn(x: number, y: number, map: TileMapData): boolean {
  for (let distanceToCorner = 0; distanceToCorner < 8; distanceToCorner++) {
    if (isBottomLeftForestCorner(x + 1, y + distanceToCorner, map)) return true;
  }
  return false;
}

type BottomLeftCornerEdgeMode = 'shifted' | 'transition' | 'replaced' | null;

function getBottomLeftCornerEdgeMode(
  x: number,
  y: number,
  map: TileMapData,
): BottomLeftCornerEdgeMode {
  for (let distanceToCorner = 0; distanceToCorner < CELL_STEP_Y; distanceToCorner++) {
    if (!isBottomLeftForestCorner(x + 1, y + distanceToCorner, map)) continue;
    if (distanceToCorner <= 4) return 'replaced';
    if (distanceToCorner === 5) return 'transition';
    return 'shifted';
  }
  return null;
}

function isBottomRightCornerWestFill(x: number, y: number, map: TileMapData): boolean {
  for (let offset = 0; offset <= 5; offset++) {
    if (isBottomRightForestCorner(x, y + offset, map)) return true;
  }
  return false;
}

function isBottomRightCornerWestHedge(x: number, y: number, map: TileMapData): boolean {
  for (let offset = 0; offset <= 4; offset++) {
    if (isBottomRightForestCorner(x, y + offset, map)) return true;
  }
  return false;
}

function isInsideTopLeftCornerModule(x: number, y: number, map: TileMapData): boolean {
  for (let cornerY = y; cornerY <= y + 1; cornerY++) {
    for (let cornerX = x - 1; cornerX <= x + 1; cornerX++) {
      if (isTopLeftForestCorner(cornerX, cornerY, map)) return true;
    }
  }
  return false;
}

function getStyleDirection(tuple: ForestStyleTuple): ForestStyleDirection {
  const [, x, y, width, height] = tuple;
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  const floorStart = 8 * AUTHORED_TILE_SIZE;
  const floorEnd = 14 * AUTHORED_TILE_SIZE;

  if (centerY < floorStart) return 'north';
  if (centerY >= floorEnd) return 'south';
  if (centerX < floorStart) return 'west';
  if (centerX >= floorEnd) return 'east';

  const distances: Array<[ForestStyleDirection, number]> = [
    ['north', centerY - floorStart],
    ['south', floorEnd - centerY],
    ['west', centerX - floorStart],
    ['east', floorEnd - centerX],
  ];
  distances.sort((a, b) => a[1] - b[1]);
  return distances[0][0];
}

/**
 * Produces the source-asset placements used by both the game and the editable
 * topology fixture. Keeping one placement builder makes editor exports exact
 * references for procedural-rendering changes.
 */
export function buildForestStylePlacementRows(
  map: TileMapData,
): ReadonlyMap<number, readonly ForestStylePlacementSpec[]> {
  const ts = map.tileSize;
  const templateShiftX = (WALL_WIDTH - AUTHORED_WALL_SIZE) * AUTHORED_TILE_SIZE;
  const templateShiftY = (WALL_HEIGHT - AUTHORED_WALL_SIZE) * AUTHORED_TILE_SIZE;
  const rows = new Map<number, ForestStylePlacementSpec[]>();
  const seen = new Set<string>();
  const hubBounds = getHubTileBounds(map.width, map.height);
  const hubWestReferenceCellX = Math.floor((hubBounds.left - WALL_WIDTH) / CELL_STEP_X);
  const hubEastReferenceCellX = Math.floor((hubBounds.right + 1 - WALL_WIDTH) / CELL_STEP_X);
  const hubReferenceCellY = Math.floor((hubBounds.top - WALL_HEIGHT) / CELL_STEP_Y);

  const addWorldPlacement = (
    name: string,
    assetId: number,
    worldX: number,
    worldY: number,
    worldWidth: number,
    worldHeight: number,
    zIndex: number,
    flipX: boolean,
    flipY: boolean,
    direction: ForestStyleDirection,
    renderRow?: number,
  ): void => {
    const key = [name, worldX, worldY, worldWidth, worldHeight, flipX, flipY].join(':');
    if (seen.has(key)) return;
    seen.add(key);

    const row = renderRow ?? Math.floor(worldY / ts);
    const placements = rows.get(row) ?? [];
    placements.push({
      name,
      assetId,
      x: worldX,
      y: worldY,
      width: worldWidth,
      height: worldHeight,
      zIndex,
      flipX,
      flipY,
      direction,
    });
    rows.set(row, placements);
  };

  const addPlacement = (
    name: string,
    assetId: number,
    originTileX: number,
    originTileY: number,
    x: number,
    y: number,
    width: number,
    height: number,
    zIndex: number,
    flipX: boolean,
    flipY: boolean,
    direction: ForestStyleDirection,
  ): void => {
    const centerTileX = Math.floor((x + width / 2) / AUTHORED_TILE_SIZE);
    const centerTileY = Math.floor((y + height / 2) / AUTHORED_TILE_SIZE);
    const ownerLocalX = direction === 'west'
      ? Math.min(WALL_WIDTH - 1, centerTileX)
      : direction === 'east'
        ? Math.max(WALL_WIDTH + CELL_SIZE, centerTileX)
        : centerTileX;
    const ownerLocalY = direction === 'north'
      ? Math.min(WALL_HEIGHT - 1, centerTileY)
      : direction === 'south'
        ? Math.max(WALL_HEIGHT + CELL_SIZE, centerTileY)
        : centerTileY;
    if (!isForestAt(originTileX + ownerLocalX, originTileY + ownerLocalY, map)) return;

    addWorldPlacement(
      name,
      assetId,
      originTileX * ts + x * ts / AUTHORED_TILE_SIZE,
      originTileY * ts + y * ts / AUTHORED_TILE_SIZE,
      width * ts / AUTHORED_TILE_SIZE,
      height * ts / AUTHORED_TILE_SIZE,
      zIndex,
      flipX,
      flipY,
      direction,
    );
  };

  // Eight-row southern forest face, continuous across logical cells.
  for (let y = 0; y < map.height; y++) {
    let runColumn = 0;
    for (let x = 0; x < map.width; x++) {
      const faceRow = getSouthForestFaceRow(x, y, map);
      if (faceRow === null) {
        runColumn = 0;
        continue;
      }
      const column = runColumn % 6;
      const bottomLeftAddedColumn = isBottomLeftCornerAddedFaceColumn(x, y, map);
      if (!bottomLeftAddedColumn &&
          !isReplacedByBottomRightCornerFace(x, y, map) &&
          !isReplacedByBottomLeftCornerFace(x, y, map)) {
        addWorldPlacement(
          `South face row ${faceRow + 1}/8, column ${column + 1}/6`,
          SOUTH_FACE_ROW_STARTS[faceRow] + column,
          x * ts,
          y * ts,
          ts,
          ts,
          100 + faceRow,
          false,
          false,
          'north',
        );
      }

      if (faceRow === 7 &&
          !bottomLeftAddedColumn &&
          !isReplacedByBottomRightCornerFringe(x, y, map)) {
        const authoredYOffsets = [16, 16, 15, 15, 15, 14];
        addWorldPlacement(
          `South face grass fringe column ${column + 1}/6`,
          438 + column,
          x * ts,
          y * ts + authoredYOffsets[column] * ts / AUTHORED_TILE_SIZE,
          ts,
          6 * ts / AUTHORED_TILE_SIZE,
          1,
          false,
          false,
          'north',
          y,
        );
      }
      if (!bottomLeftAddedColumn) runColumn++;
    }
  }

  // West-facing exposed edge: invariant flipped 550 + 32 pair.
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (!shouldRenderWestEdge(x, y, map)) continue;
      if (isDuplicateInnerNorthWestContinuation(x, y, map)) continue;
      const innerNorthWestConnection = isInnerNorthWestForestCorner(x, y + 1, map);
      if (!isBottomRightCornerWestFill(x, y, map)) {
        addWorldPlacement('West wall fill', 550, x * ts - 10 * ts / AUTHORED_TILE_SIZE,
          y * ts, ts, ts, 201, true, true, 'west');
      }
      if (!isBottomRightCornerWestHedge(x, y, map)) {
        addWorldPlacement(
          innerNorthWestConnection ? 'West wall inner north-west connection hedge' : 'West wall hedge',
          innerNorthWestConnection ? 587 : 32,
          x * ts + 6 * ts / AUTHORED_TILE_SIZE,
          y * ts, ts, ts, 200, false, false, 'west');
      }
    }
  }

  // East-facing edge: alternating 549/550 and 599/600 rows.
  for (let x = 0; x < map.width; x++) {
    let runRow = 0;
    for (let y = 0; y < map.height; y++) {
      if (!shouldRenderEastEdge(x, y, map) || isInsideTopLeftCornerModule(x, y, map)) {
        runRow = 0;
        continue;
      }
      if (isDuplicateInnerNorthEastContinuation(x, y, map)) {
        runRow++;
        continue;
      }
      const odd = runRow % 2 === 1;
      const bottomLeftCornerMode = getBottomLeftCornerEdgeMode(x, y, map);
      if (bottomLeftCornerMode === 'replaced') {
        runRow++;
        continue;
      }
      if (bottomLeftCornerMode === 'transition') {
        addWorldPlacement(
          'South-west corner vertical transition',
          549,
          x * ts - 5 * ts / AUTHORED_TILE_SIZE,
          y * ts,
          ts,
          ts,
          201,
          false,
          false,
          'east',
        );
        runRow++;
        continue;
      }
      const cornerShift = bottomLeftCornerMode === 'shifted'
        ? ts / AUTHORED_TILE_SIZE
        : 0;
      const innerNorthEastConnection = isInnerNorthEastForestCorner(x, y + 1, map);
      addWorldPlacement(
        innerNorthEastConnection
          ? 'East wall inner north-east connection left'
          : `East wall ${odd ? 'odd' : 'even'} left`,
        innerNorthEastConnection ? 592 : odd ? 599 : 549,
        x * ts - (innerNorthEastConnection || odd ? 3 : 4) * ts / AUTHORED_TILE_SIZE - cornerShift,
        y * ts,
        (innerNorthEastConnection ? 16 : odd ? 14 : 16) * ts / AUTHORED_TILE_SIZE,
        ts,
        201,
        false,
        false,
        'east',
      );
      addWorldPlacement(
        `East wall ${odd ? 'odd' : 'even'} right`,
        odd ? 600 : 550,
        x * ts + (odd ? 11 : 12) * ts / AUTHORED_TILE_SIZE - cornerShift,
        y * ts,
        ts,
        ts,
        200,
        false,
        false,
        'east',
      );
      runRow++;
    }
  }

  // Authored bottom-left transition where a south-facing trunk facade meets
  // an east-facing vertical edge. Its extra left tile is the first solid
  // column of the widened vertical wall, so artwork and collision agree while
  // the neighboring walkable cell remains six tiles wide.
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (!isBottomLeftForestCorner(x, y, map)) continue;
      const cornerX = x * ts;
      const cornerY = y * ts;
      const unit = ts / AUTHORED_TILE_SIZE;

      for (const [name, assetId, pixelX, pixelY, width, height, zIndex] of [
        ['upper root', 847, -16, -64, 16, 16, 1],
        ['upper-middle root', 897, -12, -48, 13, 16, 1],
        ['lower-middle root', 947, -16, -32, 16, 16, 1],
        ['inner root cap', 946, -19, -20, 4, 4, 1],
        ['lower root', 996, -25, -16, 9, 16, 1],
        ['bottom root edge', 1046, -25, -3, 9, 15, 1],
        ['bottom ground fill', 1047, -16, 0, 16, 16, 7],
      ] as const) {
        addWorldPlacement(
          `South-west corner ground ${name}`,
          assetId,
          cornerX + pixelX * unit,
          cornerY + pixelY * unit,
          width * unit,
          height * unit,
          zIndex,
          false,
          false,
          'terrain',
        );
      }

      addWorldPlacement(
        'South-west corner wall row 3 extension',
        138,
        cornerX - 9 * unit,
        cornerY - 5 * ts,
        ts,
        ts,
        102,
        false,
        false,
        'north',
      );

      for (const [rowOffset, assetIds, zIndex] of [
        [-4, [848, 849], 103],
        [-3, [898, 899], 104],
        [-2, [948, 949], 105],
        [-1, [998, 999], 106],
        [0, [1048, 1049], 107],
      ] as const) {
        for (let column = 0; column < assetIds.length; column++) {
          addWorldPlacement(
            `South-west corner wall row ${rowOffset + 8}, column ${column + 1}`,
            assetIds[column],
            cornerX + column * ts,
            cornerY + rowOffset * ts,
            ts,
            ts,
            zIndex,
            false,
            false,
            'north',
          );
        }
      }
    }
  }

  // North-facing exposed edge: alternating 493/590 and 539/589 stacks.
  for (let y = 0; y < map.height; y++) {
    let runColumn = 0;
    for (let x = 0; x < map.width; x++) {
      if (!shouldRenderNorthEdge(x, y, map) || isInsideTopLeftCornerModule(x, y, map)) {
        runColumn = 0;
        continue;
      }
      const odd = runColumn % 2 === 1;
      if (!isDuplicatePairedNorthEdge(x, y, 'top', map)) {
        addWorldPlacement(
          `North wall ${odd ? 'odd' : 'even'} top`,
          odd ? 539 : 493,
          (x - 1) * ts + ts / AUTHORED_TILE_SIZE,
          (y - 1) * ts + 2 * ts / AUTHORED_TILE_SIZE,
          ts,
          (odd ? 15 : 14) * ts / AUTHORED_TILE_SIZE,
          211,
          false,
          false,
          'south',
        );
      }
      if (!isDuplicatePairedNorthEdge(x, y, 'bottom', map)) {
        addWorldPlacement(
          `North wall ${odd ? 'odd' : 'even'} bottom`,
          odd ? 589 : 590,
          (x - 1) * ts + ts / AUTHORED_TILE_SIZE,
          y * ts,
          ts,
          ts,
          210,
          false,
          false,
          'south',
        );
      }
      runColumn++;
    }
  }

  // Concave north-west ground connection authored in style export (18).
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (!isInnerNorthWestForestCorner(x, y, map)) continue;
      const cornerX = x * ts;
      const cornerY = y * ts;
      const unit = ts / AUTHORED_TILE_SIZE;
      addWorldPlacement(
        'Inner north-west corner ground left',
        636,
        cornerX - 14 * unit,
        cornerY,
        ts,
        ts,
        1,
        false,
        false,
        'terrain',
      );
      addWorldPlacement(
        'Inner north-west corner ground right',
        637,
        cornerX + 2 * unit,
        cornerY,
        ts,
        ts,
        1,
        false,
        false,
        'terrain',
      );
    }
  }

  // Concave north-east connection authored in style export (17). The normal
  // north and east strips remain in place; these pieces bridge their gap and
  // cap the lower end of the vertical hedge.
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (!isInnerNorthEastForestCorner(x, y, map)) continue;
      const cornerX = x * ts;
      const cornerY = y * ts;
      const unit = ts / AUTHORED_TILE_SIZE;

      addWorldPlacement(
        'North wall inner north-east extension top',
        493,
        cornerX - ts + unit,
        cornerY - ts + 2 * unit,
        ts,
        14 * unit,
        211,
        false,
        false,
        'south',
      );
      addWorldPlacement(
        'North wall inner north-east extension bottom',
        590,
        cornerX - ts + unit,
        cornerY,
        ts,
        ts,
        210,
        false,
        false,
        'south',
      );
      addWorldPlacement(
        'North wall inner north-east overlap bottom',
        590,
        cornerX - 4 * unit,
        cornerY,
        ts,
        ts,
        210,
        false,
        false,
        'south',
      );
      addWorldPlacement(
        'South face inner north-east corner cap',
        643,
        cornerX + 12 * unit,
        cornerY,
        ts,
        ts,
        5103,
        false,
        false,
        'south',
      );
    }
  }

  // Convex north-west corner module.
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (!isTopLeftForestCorner(x, y, map)) continue;
      const cornerX = x * ts - ts / 2 + 2 * ts / AUTHORED_TILE_SIZE;
      const cornerY = (y - 1) * ts;
      addWorldPlacement('North-west corner cap', 492,
        cornerX + 5 * ts / AUTHORED_TILE_SIZE, cornerY + 4 * ts / AUTHORED_TILE_SIZE,
        12 * ts / AUTHORED_TILE_SIZE, 12 * ts / AUTHORED_TILE_SIZE,
        120, false, false, 'east');
      addWorldPlacement('North-west corner top', 539,
        cornerX + 17 * ts / AUTHORED_TILE_SIZE, cornerY + ts / AUTHORED_TILE_SIZE,
        ts, 15 * ts / AUTHORED_TILE_SIZE, 120, false, false, 'east');
      addWorldPlacement('North-west corner left', 549,
        cornerX + ts / AUTHORED_TILE_SIZE, cornerY + ts,
        ts, ts, 121, false, false, 'east');
      addWorldPlacement('North-west corner right', 543,
        cornerX + 17 * ts / AUTHORED_TILE_SIZE, cornerY + ts,
        ts, ts, 120, false, false, 'east');
    }
  }

  // Convex north-east corner module.
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (!isTopRightForestCorner(x, y, map)) continue;
      const capX = x * ts - ts / 2;
      const capY = (y - 1) * ts;
      addWorldPlacement('North-east corner top', 539,
        capX, capY + ts / AUTHORED_TILE_SIZE,
        ts, 15 * ts / AUTHORED_TILE_SIZE, 300, true, false, 'west');
      addWorldPlacement('North-east corner cap', 492,
        capX + ts, capY + 4 * ts / AUTHORED_TILE_SIZE,
        12 * ts / AUTHORED_TILE_SIZE, 12 * ts / AUTHORED_TILE_SIZE,
        300, true, false, 'west');
    }
  }

  // Authored bottom-right transition where a south-facing trunk facade meets
  // the end of a west-facing hedge. It replaces the overlapping generic face
  // and side strips with the corrected module from style export (15).
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (!isBottomRightForestCorner(x, y, map)) continue;
      const cornerX = x * ts;
      const cornerY = y * ts;
      const unit = ts / AUTHORED_TILE_SIZE;

      // Small ground-edge details sit beneath the trunk facade.
      addWorldPlacement('South-east corner ground upper edge', 983,
        cornerX + ts, cornerY - 2 * ts + 15 * unit,
        9 * unit, ts, 0, false, false, 'ground');
      addWorldPlacement('South-east corner ground lower fill', 160,
        cornerX + unit, cornerY,
        ts, ts, 3, false, false, 'ground');
      addWorldPlacement('South-east corner ground top cap', 833,
        cornerX + 12 * unit, cornerY - 5 * ts + 15 * unit,
        8 * unit, 9 * unit, 5, false, false, 'ground');
      addWorldPlacement('South-east corner ground lower edge', 1033,
        cornerX + ts, cornerY - ts + 9 * unit,
        9 * unit, 21 * unit, 108, false, false, 'ground', y);

      addWorldPlacement('South-east corner wall upper cap', 832,
        cornerX, cornerY - 4 * ts,
        ts, ts, 103, false, false, 'ground');

      for (const [rowOffset, assetIds, widths, zIndex] of [
        [-3, [880, 881, 882], [16, 16, 12], 104],
        [-2, [930, 931, 932], [16, 16, 16], 105],
        [-1, [980, 981, 982], [16, 16, 16], 106],
        [0, [1030, 1031, 1032], [16, 16, 16], 107],
      ] as const) {
        for (let column = 0; column < assetIds.length; column++) {
          addWorldPlacement(
            `South-east corner wall row ${rowOffset + 4}, column ${column + 1}`,
            assetIds[column],
            cornerX + (column - 2) * ts,
            cornerY + rowOffset * ts,
            widths[column] * unit,
            ts,
            zIndex,
            false,
            false,
            'ground',
          );
        }
      }

      for (const [assetId, columnOffset, pixelYOffset] of [
        [1081, -1, 15],
        [1082, 0, 15],
        [1089, -3, 16],
        [1080, -2, 16],
      ] as const) {
        addWorldPlacement(
          'South-east corner wall grass fringe',
          assetId,
          cornerX + columnOffset * ts,
          cornerY + pixelYOffset * unit,
          ts,
          6 * unit,
          1,
          false,
          false,
          'ground',
          y,
        );
      }
    }
  }

  // The central hub cuts across the logical cell grid, so its thicker walls
  // need dedicated north-corner transitions instead of more copies of the
  // ordinary one-cell stencil. The east module is a true horizontal mirror of
  // the corrected west module, keeping both sides locked together.
  const hubMirrorSpan = (hubBounds.left + hubBounds.right + 1) * ts;
  const addHubNorthCorner = (side: 'west' | 'east'): void => {
    const mirror = side === 'east';
    const hasCorner = mirror
      ? isForestAt(hubBounds.right, hubBounds.top - 1, map) &&
        isForestAt(hubBounds.right + 1, hubBounds.top, map)
      : isForestAt(hubBounds.left, hubBounds.top - 1, map) &&
        isForestAt(hubBounds.left - 1, hubBounds.top, map);
    if (!hasCorner) return;

    const leftFillX = (hubBounds.left - 2) * ts + 6 * ts / AUTHORED_TILE_SIZE;
    const rightHedgeX = (hubBounds.left - 1) * ts + 6 * ts / AUTHORED_TILE_SIZE;
    const addCornerPlacement = (
      label: string,
      assetId: number,
      westX: number,
      worldY: number,
      worldWidth: number,
      worldHeight: number,
      zIndex: number,
      flipX: boolean,
      flipY: boolean,
      direction: ForestStyleDirection,
    ): void => {
      const mirroredDirection = mirror
        ? direction === 'west'
          ? 'east'
          : direction === 'east'
            ? 'west'
            : direction
        : direction;
      addWorldPlacement(
        `Hub north-${side} corner ${label}`,
        assetId,
        mirror ? hubMirrorSpan - westX - worldWidth : westX,
        worldY,
        worldWidth,
        worldHeight,
        zIndex,
        mirror ? !flipX : flipX,
        flipY,
        mirroredDirection,
      );
    };

    addCornerPlacement(
      'upper cap',
      1181,
      (hubBounds.left - 1) * ts,
      (hubBounds.top - 7) * ts,
      ts,
      ts,
      120,
      true,
      false,
      'north',
    );
    addCornerPlacement(
      'canopy',
      380,
      (hubBounds.left - 1) * ts,
      (hubBounds.top - 6) * ts,
      ts,
      ts,
      102,
      false,
      false,
      'north',
    );
    addCornerPlacement(
      'lower cap',
      1232,
      (hubBounds.left - 2) * ts,
      (hubBounds.top - 6) * ts + ts / AUTHORED_TILE_SIZE,
      ts,
      ts,
      126,
      true,
      false,
      'north',
    );

    for (const [rowOffset, leftAssetId, rightAssetId] of [
      [-5, 600, 580],
      [-4, 550, 32],
      [-3, 600, 580],
      [-2, 550, 32],
    ] as const) {
      const oddRow = leftAssetId === 600;
      addCornerPlacement(
        `${oddRow ? 'odd' : 'even'} fill`,
        leftAssetId,
        leftFillX,
        (hubBounds.top + rowOffset) * ts,
        ts,
        ts,
        120,
        true,
        true,
        'north',
      );
      addCornerPlacement(
        `${oddRow ? 'odd' : 'even'} hedge`,
        rightAssetId,
        rightHedgeX,
        (hubBounds.top + rowOffset) * ts,
        oddRow ? 14 * ts / AUTHORED_TILE_SIZE : ts,
        ts,
        oddRow ? 120 : 112,
        false,
        false,
        'north',
      );
    }

    addCornerPlacement(
      `${side} fill`,
      550,
      leftFillX,
      (hubBounds.top - 1) * ts,
      ts,
      ts,
      201,
      true,
      true,
      'west',
    );
    addCornerPlacement(
      `${side} hedge`,
      32,
      rightHedgeX,
      (hubBounds.top - 1) * ts,
      ts,
      ts,
      200,
      false,
      false,
      'west',
    );
  };

  addHubNorthCorner('west');
  addHubNorthCorner('east');

  // Per-cell authored transition details and terminal caps.
  for (let cellY = 0; cellY < GRID_CELLS; cellY++) {
    for (let cellX = 0; cellX < GRID_CELLS; cellX++) {
      const originTileX = cellX * CELL_STEP_X;
      const originTileY = cellY * CELL_STEP_Y;
      const faceBaseY = originTileY + WALL_HEIGHT - 1;
      const faceStartX = originTileX + WALL_WIDTH;
      const faceEndX = faceStartX + CELL_SIZE - 1;
      const hasCellFace = getSouthForestFaceRow(faceStartX, faceBaseY, map) === 7;
      const insideThickHubWestWall = cellX === hubWestReferenceCellX &&
        cellY >= hubReferenceCellY &&
        cellY <= hubReferenceCellY + 2;
      const insideThickHubEastWall = cellX === hubEastReferenceCellX &&
        cellY >= hubReferenceCellY &&
        cellY <= hubReferenceCellY + 2;
      const showWestDetails = !insideThickHubWestWall &&
        getSouthForestFaceRow(faceStartX - 1, faceBaseY, map) === null;
      const showEastDetails = !insideThickHubEastWall &&
        getSouthForestFaceRow(faceEndX + 1, faceBaseY, map) === null;

      if (hasCellFace && showWestDetails) {
        addPlacement('North-west canopy cap', 380, originTileX, originTileY,
          112 + templateShiftX, 32 + templateShiftY, 16, 16, 102, false, false, 'north');
      }
      if (showWestDetails) {
        for (const y of [64, 96]) {
          addPlacement('West canopy transition', 32, originTileX, originTileY,
            118 + templateShiftX, y + templateShiftY, 16, 16, 112, false, false,
            y < 128 ? 'north' : 'west');
        }
      }

      for (const tuple of FOREST_STYLE_STENCIL) {
        const [assetId, x, y, width, height, zIndex, flipX, flipY] = tuple;
        if (x + width / 2 < 6 * AUTHORED_TILE_SIZE) continue;
        const direction = getStyleDirection(tuple);
        const centerX = x + width / 2;
        if (direction === 'west' || direction === 'east' || direction === 'south') continue;
        if (assetId >= 438 && assetId <= 443) continue;
        if (direction === 'north' && centerX < 128 && !showWestDetails) continue;
        if (direction === 'north' && centerX >= 224 && !showEastDetails) continue;
        addPlacement(
          `Authored ${direction} detail ${assetId}`,
          assetId,
          originTileX,
          originTileY,
          x + templateShiftX,
          y + templateShiftY,
          width,
          height,
          zIndex,
          flipX === 1,
          flipY === 1,
          direction,
        );
      }
    }
  }

  for (const placements of rows.values()) {
    placements.sort((a, b) => a.zIndex - b.zIndex || a.y - b.y || a.x - b.x);
  }
  return rows;
}
