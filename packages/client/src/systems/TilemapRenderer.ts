// packages/client/src/systems/TilemapRenderer.ts
// ─────────────────────────────────────────────────────────────────────────────
// Chunk-based tilemap renderer for optimal performance.
//
// Strategy:
//   - Background (grass/dirt): baked into 32×32 2D chunks
//   - Shadow overlays:         baked into 32×32 2D chunks
//   - Wall tiles:              baked into 32×1 row chunks (preserves Y-sorting)
//   - Trees / runestones:      individual sprites (Y-sorted in entity layer)
//
// All chunks use PixiJS 8 cacheAsTexture() to collapse many Sprites into a
// single GPU texture, drastically reducing scene-graph nodes and draw calls.
// Viewport culling hides off-screen chunks every frame.
// ─────────────────────────────────────────────────────────────────────────────

import { Container, Sprite, Texture, Renderer, Rectangle } from 'pixi.js';
import type { TileMapData, GatePlacement, PressurePlateInfo } from '@labyrinth/shared';
import {
  TILE_FLOOR,
  TILE_FLOOR_SHADOW,
  TILE_WALL_FACE,
  TILE_WALL_TOP_EDGE,
  TILE_TREE,
  TILE_RUNESTONE_1,
  TILE_RUNESTONE_2,
  TILE_RUNESTONE_3,
  TILE_GATE_HORIZONTAL,
  TILE_GATE_VERTICAL,
  TILE_PRESSURE_PLATE,
  INTERNAL_WIDTH,
  INTERNAL_HEIGHT,
  CELL_STEP,
  CELL_SIZE,
  WALL_SIZE,
  GRID_CELLS,
} from '@labyrinth/shared';
import type { DirtTextures, GameAssets, FrontGateTextures } from '../assets/AssetLoader';

// ── Exported types ──────────────────────────────────────────────────────────

export interface RunestoneSpriteData {
  sprite: Sprite;
  index: number;  // 0, 1, or 2
  tileX: number;
  tileY: number;
  activated: boolean;
}

export interface PressurePlateSpriteData {
  sprite: Sprite;
  plateId: number;
  gateIndex: number;
  tileX: number;
  tileY: number;
  side: 'spawn' | 'hub';
  /** Current animation frame index (0=up, 1=mid, 2=pressed). */
  currentFrame: number;
  /** The specific frame set to use for this plate. */
  frameSet: Texture[];
}

const FRONT_GATE_WIDTH_TILES = 6;
const FRONT_GATE_HEIGHT_TILES = 4;
const GATE_SOUTH_SHADOW_OFFSET_PX = 4;
const FRONT_GATE_TILE_ROWS: (keyof FrontGateTextures)[][] = [
  ['topLeft', 'topMid', 'topMid', 'topMid', 'topMid', 'topRight'],
  ['midLeft', 'midCenter', 'midCenter', 'midCenter', 'midCenter', 'midRight'],
  ['midLeft', 'midCenter', 'midCenter', 'midCenter', 'midCenter', 'midRight'],
  ['bottomLeft', 'bottomMid', 'bottomMid', 'bottomMid', 'bottomMid', 'bottomRight'],
];

// ── Chunk configuration ─────────────────────────────────────────────────────

/** Side length for 2D square chunks (background, shadows). */
const BG_CHUNK_SIZE = 32;

/** Width in tiles for a baked, Y-sorted vegetation row segment. */
const FOREST_CHUNK_WIDTH = 64;
const FOREST_CANOPY_OVERFLOW = 16;
const FOREST_SIDE_OVERFLOW = 16;

type ForestStyleDirection = 'north' | 'south' | 'west' | 'east';
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

/**
 * The authored additions in style export (12)'s labyrinth-style-v1.json.
 * Coordinates are pixels in its 352x352 sample (an eight-tile wall around one
 * six-tile maze cell). The ordinary grass and canopy entries are assembled
 * separately; this stencil retains all 106 exported wall-detail sprites so
 * the inner-boundary subset can be selected without changing their geometry.
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

interface ForestStylePlacement {
  texture: Texture;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  flipX: boolean;
  flipY: boolean;
  direction: ForestStyleDirection;
}

// ── Internal chunk metadata ─────────────────────────────────────────────────

interface ChunkMeta {
  container: Container;
  /** World-space bounding box for culling. */
  worldLeft: number;
  worldTop: number;
  worldRight: number;
  worldBottom: number;
  isVisible: boolean;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Deterministic grass variant texture based on tile position. */
function getGrassTexture(x: number, y: number, grassTextures: Texture[]): Texture {
  const h = ((x * 374761393 + y * 668265263) >>> 0) % 100;
  if (h < 47) return grassTextures[0];
  if (h < 94) return grassTextures[1];
  if (h < 97) return grassTextures[2];
  return grassTextures[3];
}

function getCenterDirtTexture(x: number, y: number, textures: DirtTextures): Texture {
  const h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) >>> 0;
  return (h & 1) === 0 ? textures.center : textures.plainAlt;
}

function isDirtAt(
  x: number,
  y: number,
  dirtMask: Uint8Array,
  mapWidth: number,
  mapHeight: number,
): boolean {
  if (x < 0 || x >= mapWidth || y < 0 || y >= mapHeight) return false;
  return dirtMask[y * mapWidth + x] === 1;
}

function getDirtTexture(
  x: number,
  y: number,
  dirtMask: Uint8Array,
  mapWidth: number,
  mapHeight: number,
  textures: DirtTextures,
): Texture {
  const north = isDirtAt(x, y - 1, dirtMask, mapWidth, mapHeight);
  const east = isDirtAt(x + 1, y, dirtMask, mapWidth, mapHeight);
  const south = isDirtAt(x, y + 1, dirtMask, mapWidth, mapHeight);
  const west = isDirtAt(x - 1, y, dirtMask, mapWidth, mapHeight);

  const missingNorth = !north;
  const missingEast = !east;
  const missingSouth = !south;
  const missingWest = !west;

  if (missingNorth && missingEast) return textures.northEast;
  if (missingEast && missingSouth) return textures.southEast;
  if (missingSouth && missingWest) return textures.southWest;
  if (missingNorth && missingWest) return textures.northWest;
  if (missingNorth) return textures.north;
  if (missingEast) return textures.east;
  if (missingSouth) return textures.south;
  if (missingWest) return textures.west;
  return getCenterDirtTexture(x, y, textures);
}

function positionHash(x: number, y: number, salt = 0): number {
  let h = Math.imul(x + salt * 17, 0x45d9f3b) ^ Math.imul(y - salt * 31, 0x119de1f3);
  h ^= h >>> 16;
  h = Math.imul(h, 0x45d9f3b);
  h ^= h >>> 16;
  return h >>> 0;
}

function isForestWallTileId(tileId: number): boolean {
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
    if (!isForestAt(x, y + distanceToBase + 1, map)) {
      return faceHeight - distanceToBase - 1;
    }
  }
  return null;
}

function hasWestEdgeExposureAlongColumn(
  x: number,
  y: number,
  directionY: -1 | 1,
  map: TileMapData,
): boolean {
  for (let distance = 1; distance <= CELL_STEP; distance++) {
    const candidateY = y + distance * directionY;
    // A carved passage through the wall column is a real interruption.
    if (!isForestAt(x, candidateY, map)) return false;
    if (!isForestAt(x + 1, candidateY, map)) return true;
  }
  return false;
}

function shouldRenderWestEdge(x: number, y: number, map: TileMapData): boolean {
  if (!isForestAt(x, y, map)) return false;
  if (!isForestAt(x + 1, y, map)) return true;

  // At a perpendicular maze turn, the adjoining horizontal wall temporarily
  // occupies the open side. Keep the vertical pattern when it resumes on both
  // sides of that junction instead of drawing an artificial corner break.
  return hasWestEdgeExposureAlongColumn(x, y, -1, map) &&
    hasWestEdgeExposureAlongColumn(x, y, 1, map);
}

function hasEastEdgeExposureAlongColumn(
  x: number,
  y: number,
  directionY: -1 | 1,
  map: TileMapData,
): boolean {
  for (let distance = 1; distance <= CELL_STEP; distance++) {
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

function hasNorthEdgeExposureAlongRow(
  x: number,
  y: number,
  directionX: -1 | 1,
  map: TileMapData,
): boolean {
  for (let distance = 1; distance <= CELL_STEP; distance++) {
    const candidateX = x + distance * directionX;
    // A carved passage through the wall row is a real interruption.
    if (!isForestAt(candidateX, y, map)) return false;
    if (!isForestAt(candidateX, y - 1, map)) return true;
  }
  return false;
}

function shouldRenderNorthEdge(x: number, y: number, map: TileMapData): boolean {
  if (!isForestAt(x, y, map)) return false;
  if (!isForestAt(x, y - 1, map)) return true;

  // Preserve a horizontal edge through a perpendicular wall junction when
  // the same exposed edge resumes to both the left and right.
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

function isInsideTopLeftCornerModule(x: number, y: number, map: TileMapData): boolean {
  // The 33x32px module starts one tile above and half a tile left.
  for (let cornerY = y; cornerY <= y + 1; cornerY++) {
    for (let cornerX = x - 1; cornerX <= x + 1; cornerX++) {
      if (isTopLeftForestCorner(cornerX, cornerY, map)) return true;
    }
  }
  return false;
}

function getForestGroundTexture(assets: GameAssets): Texture {
  // The source map keeps the space behind the transparent canopy/trunk tiles
  // nearly black. Using the playable grass here caused visible rectangular
  // patches on the east and west walls.
  return assets.forestWallTextures.interiorTexture;
}

function getStyleDirection(tuple: ForestStyleTuple): ForestStyleDirection {
  const [, x, y, width, height] = tuple;
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  const floorStart = 8 * 16;
  const floorEnd = 14 * 16;

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

function buildForestStyleRows(
  map: TileMapData,
  assets: GameAssets,
): ReadonlyMap<number, readonly ForestStylePlacement[]> {
  const ts = map.tileSize;
  const authoredTileSize = 16;
  const authoredWallSize = 8;
  const templateShift = (WALL_SIZE - authoredWallSize) * authoredTileSize;
  const rows = new Map<number, ForestStylePlacement[]>();
  const seen = new Set<string>();

  const addWorldPlacement = (
    placementId: string,
    texture: Texture,
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
    const key = [placementId, worldX, worldY, worldWidth, worldHeight, flipX, flipY].join(':');
    if (seen.has(key)) return;
    seen.add(key);

    const row = renderRow ?? Math.floor(worldY / ts);
    const placements = rows.get(row) ?? [];
    placements.push({
      texture,
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
    placementId: string,
    texture: Texture,
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
    const centerTileX = Math.floor((x + width / 2) / authoredTileSize);
    const centerTileY = Math.floor((y + height / 2) / authoredTileSize);
    const ownerLocalX = direction === 'west'
      ? Math.min(WALL_SIZE - 1, centerTileX)
      : direction === 'east'
        ? Math.max(WALL_SIZE + CELL_SIZE, centerTileX)
        : centerTileX;
    const ownerLocalY = direction === 'north'
      ? Math.min(WALL_SIZE - 1, centerTileY)
      : direction === 'south'
        ? Math.max(WALL_SIZE + CELL_SIZE, centerTileY)
        : centerTileY;
    if (!isForestAt(originTileX + ownerLocalX, originTileY + ownerLocalY, map)) return;

    addWorldPlacement(
      placementId,
      texture,
      originTileX * ts + x * ts / authoredTileSize,
      originTileY * ts + y * ts / authoredTileSize,
      width * ts / authoredTileSize,
      height * ts / authoredTileSize,
      zIndex,
      flipX,
      flipY,
      direction,
    );
  };

  // Northern walls are continuous topology, not one facade per maze cell.
  // Repeat the exported six-column trunk row across each uninterrupted run.
  for (let y = 0; y < map.height; y++) {
    let runColumn = 0;
    for (let x = 0; x < map.width; x++) {
      const faceRow = getSouthForestFaceRow(x, y, map);
      if (faceRow === null) {
        runColumn = 0;
        continue;
      }

      const column = runColumn % 6;
      const texture = assets.forestWallTextures.southFaceRows[faceRow]?.[column];
      if (texture) {
        addWorldPlacement(
          `continuous-face-${faceRow}-${column}`,
          texture,
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

      if (faceRow === 7) {
        // Repeating left-to-right order requested for South face columns:
        // 438, 439, 440, 441, 442, 443.
        const fringe = assets.forestWallTextures.insideNorthEdgeTextures[column];
        if (fringe) {
          // Preserve export (12)'s authored Y positions. These intentionally
          // overlap the root row by 0-2px so the grass blends into the trunks.
          const authoredYOffsets = [16, 16, 15, 15, 15, 14];
          addWorldPlacement(
            `continuous-fringe-${column}`,
            fringe,
            x * ts,
            y * ts + authoredYOffsets[column] * ts / authoredTileSize,
            ts,
            6 * ts / authoredTileSize,
            1,
            false,
            false,
            'north',
            y,
          );
        }
      }
      runColumn++;
    }
  }

  // The exported west/left wall uses one invariant two-piece row. From the
  // playable side toward the forest mass: Side hedge 7,12 (sprite 32), then
  // Sprite_Fiorwoods_550 flipped on both axes, exactly as in the JSON. Repeat
  // it for every exposed tile; do not alternate in sprites 580/587/600.
  const westSideHedge = assets.forestWallTextures.sideHedgeTextures[2];
  const westSideFill = assets.forestWallTextures.styleDecorationTextures[550];
  if (westSideHedge && westSideFill) {
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        if (!shouldRenderWestEdge(x, y, map)) continue;
        addWorldPlacement(
          'west-side-550',
          westSideFill,
          x * ts - 10 * ts / authoredTileSize,
          y * ts,
          ts,
          ts,
          201,
          true,
          true,
          'west',
        );
        addWorldPlacement(
          'west-side-32',
          westSideHedge,
          x * ts + 6 * ts / authoredTileSize,
          y * ts,
          ts,
          ts,
          200,
          false,
          false,
          'west',
        );
      }
    }
  }

  // The opposite vertical face alternates the two JSON-authored rows
  // 549+550 and 599+600. Keep one phase for the full uninterrupted edge.
  const eastSideEvenLeft = assets.forestWallTextures.styleDecorationTextures[549];
  const eastSideEvenRight = assets.forestWallTextures.styleDecorationTextures[550];
  const eastSideOddLeft = assets.forestWallTextures.styleDecorationTextures[599];
  const eastSideOddRight = assets.forestWallTextures.styleDecorationTextures[600];
  if (eastSideEvenLeft && eastSideEvenRight && eastSideOddLeft && eastSideOddRight) {
    for (let x = 0; x < map.width; x++) {
      let runRow = 0;
      for (let y = 0; y < map.height; y++) {
        if (!shouldRenderEastEdge(x, y, map) || isInsideTopLeftCornerModule(x, y, map)) {
          runRow = 0;
          continue;
        }
        const odd = runRow % 2 === 1;
        addWorldPlacement(
          odd ? 'east-side-left-599' : 'east-side-left-549',
          odd ? eastSideOddLeft : eastSideEvenLeft,
          x * ts - (odd ? 3 : 4) * ts / authoredTileSize,
          y * ts,
          (odd ? 14 : 16) * ts / authoredTileSize,
          ts,
          201,
          false,
          false,
          'east',
        );
        addWorldPlacement(
          odd ? 'east-side-right-600' : 'east-side-right-550',
          odd ? eastSideOddRight : eastSideEvenRight,
          x * ts + (odd ? 11 : 12) * ts / authoredTileSize,
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
  }

  // The top of a horizontal wall repeats export (12)'s exact two-column
  // module: 493/590, then 539/589.
  const northEdgeTopEven = assets.forestWallTextures.styleDecorationTextures[493];
  const northEdgeTopOdd = assets.forestWallTextures.styleDecorationTextures[539];
  const northEdgeBottomEven = assets.forestWallTextures.styleDecorationTextures[590];
  const northEdgeBottomOdd = assets.forestWallTextures.styleDecorationTextures[589];
  if (northEdgeTopEven && northEdgeTopOdd && northEdgeBottomEven && northEdgeBottomOdd) {
    for (let y = 0; y < map.height; y++) {
      let runColumn = 0;
      for (let x = 0; x < map.width; x++) {
        if (!shouldRenderNorthEdge(x, y, map) || isInsideTopLeftCornerModule(x, y, map)) {
          runColumn = 0;
          continue;
        }
        const odd = runColumn % 2 === 1;
        addWorldPlacement(
          odd ? 'north-edge-top-539' : 'north-edge-top-493',
          odd ? northEdgeTopOdd : northEdgeTopEven,
          (x - 1) * ts + ts / authoredTileSize,
          (y - 1) * ts + 2 * ts / authoredTileSize,
          ts,
          (odd ? 15 : 14) * ts / authoredTileSize,
          211,
          false,
          false,
          'south',
        );
        addWorldPlacement(
          odd ? 'north-edge-bottom-589' : 'north-edge-bottom-590',
          odd ? northEdgeBottomOdd : northEdgeBottomEven,
          (x - 1) * ts + ts / authoredTileSize,
          y * ts,
          ts,
          ts,
          210,
          false,
          false,
          'south',
        );
        runColumn++;
      }
    }
  }

  // Convex top-left corner copied verbatim from export (12).
  const topLeft492 = assets.forestWallTextures.styleDecorationTextures[492];
  const topLeft539 = assets.forestWallTextures.styleDecorationTextures[539];
  const topLeft549 = assets.forestWallTextures.styleDecorationTextures[549];
  const topLeft543 = assets.forestWallTextures.styleDecorationTextures[543];
  if (topLeft492 && topLeft539 && topLeft549 && topLeft543) {
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        if (!isTopLeftForestCorner(x, y, map)) continue;
        const cornerX = x * ts - ts / 2 + 2 * ts / authoredTileSize;
        const cornerY = (y - 1) * ts;
        addWorldPlacement('top-left-492', topLeft492,
          cornerX + 5 * ts / authoredTileSize,
          cornerY + 4 * ts / authoredTileSize,
          12 * ts / authoredTileSize, 12 * ts / authoredTileSize,
          120, false, false, 'east');
        addWorldPlacement('top-left-539', topLeft539,
          cornerX + 17 * ts / authoredTileSize,
          cornerY + 1 * ts / authoredTileSize,
          ts, 15 * ts / authoredTileSize,
          120, false, false, 'east');
        addWorldPlacement('top-left-549', topLeft549,
          cornerX + 1 * ts / authoredTileSize,
          cornerY + ts,
          ts, ts,
          121, false, false, 'east');
        addWorldPlacement('top-left-543', topLeft543,
          cornerX + 17 * ts / authoredTileSize,
          cornerY + ts,
          ts, ts,
          120, false, false, 'east');
      }
    }
  }

  // Convex top-right corner: mirror export (12)'s 492+539 top cap.
  const topRight492 = assets.forestWallTextures.styleDecorationTextures[492];
  const topRight539 = assets.forestWallTextures.styleDecorationTextures[539];
  if (topRight492 && topRight539) {
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        if (!isTopRightForestCorner(x, y, map)) continue;
        const capX = x * ts - ts / 2;
        const capY = (y - 1) * ts;
        addWorldPlacement(
          'top-right-539',
          topRight539,
          capX,
          capY + ts / authoredTileSize,
          ts,
          15 * ts / authoredTileSize,
          300,
          true,
          false,
          'west',
        );
        addWorldPlacement(
          'top-right-492',
          topRight492,
          capX + ts,
          capY + 4 * ts / authoredTileSize,
          12 * ts / authoredTileSize,
          12 * ts / authoredTileSize,
          300,
          true,
          false,
          'west',
        );
      }
    }
  }

  for (let cellY = 0; cellY < GRID_CELLS; cellY++) {
    for (let cellX = 0; cellX < GRID_CELLS; cellX++) {
      const originTileX = cellX * CELL_STEP;
      const originTileY = cellY * CELL_STEP;
      const faceBaseY = originTileY + WALL_SIZE - 1;
      const faceStartX = originTileX + WALL_SIZE;
      const faceEndX = faceStartX + CELL_SIZE - 1;
      const hasCellFace = getSouthForestFaceRow(faceStartX, faceBaseY, map) === 7;
      const showWestDetails = getSouthForestFaceRow(faceStartX - 1, faceBaseY, map) === null;
      const showEastDetails = getSouthForestFaceRow(faceEndX + 1, faceBaseY, map) === null;

      // Six canopy pieces in export (12): one northwest cap and the five
      // explicitly spaced modules down the inner west edge.
      const northWestCap = assets.forestWallTextures.northHedgeRows[2];
      if (northWestCap && hasCellFace && showWestDetails) {
        addPlacement('canopy-380', northWestCap, originTileX, originTileY,
          112 + templateShift, 32 + templateShift, 16, 16, 102, false, false, 'north');
      }
      const westCanopy = assets.forestWallTextures.sideHedgeTextures[2];
      if (westCanopy && showWestDetails) {
        for (const y of [64, 96]) {
          addPlacement(`canopy-32-${y}`, westCanopy, originTileX, originTileY,
            118 + templateShift, y + templateShift, 16, 16, 112, false, false,
            y < 128 ? 'north' : 'west');
        }
      }

      // The JSON also contains decorations on the sample image's outer frame.
      // They demonstrate clipping at the preview boundary and are not part of
      // the central playable cell. Only x>=96 belongs to its inner wall/corners.
      for (const tuple of FOREST_STYLE_STENCIL) {
        const [assetId, x, y, width, height, zIndex, flipX, flipY] = tuple;
        if (x + width / 2 < 6 * authoredTileSize) continue;
        const texture = assets.forestWallTextures.styleDecorationTextures[assetId];
        if (!texture) continue;
        const direction = getStyleDirection(tuple);
        const centerX = x + width / 2;

        // West-facing straight walls are generated above from the exact
        // invariant 32 + flipped-550 pair.
        if (direction === 'west') continue;

        // East-facing straight walls are generated above from continuous
        // alternating 549/550 and 599/600 rows.
        if (direction === 'east') continue;

        // North-facing horizontal edges are generated above as continuous
        // alternating 539/589 and 493/590 stacks.
        if (direction === 'south') continue;

        // The face fringe is generated along the continuous run above. Cell
        // copies would restart its six-column phase and leave seams.
        if (assetId >= 438 && assetId <= 443) continue;

        // Corner/side decorations belong only at the true ends of a trunk
        // run. Internal logical-cell boundaries must remain uninterrupted bark.
        if (direction === 'north' && centerX < 128 && !showWestDetails) {
          continue;
        }
        if (direction === 'north' && centerX >= 224 && !showEastDetails) {
          continue;
        }
        addPlacement(
          `detail-${assetId}`,
          texture,
          originTileX,
          originTileY,
          x + templateShift,
          y + templateShift,
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

function usesGroundBackgroundTile(tileId: number): boolean {
  return isForestWallTileId(tileId) ||
    tileId === TILE_FLOOR ||
    tileId === TILE_FLOOR_SHADOW ||
    tileId === TILE_TREE ||
    tileId === TILE_RUNESTONE_1 ||
    tileId === TILE_RUNESTONE_2 ||
    tileId === TILE_RUNESTONE_3 ||
    tileId === TILE_GATE_HORIZONTAL ||
    tileId === TILE_GATE_VERTICAL ||
    tileId === TILE_PRESSURE_PLATE;
}

function isGateTileId(tileId: number): boolean {
  return tileId === TILE_GATE_HORIZONTAL || tileId === TILE_GATE_VERTICAL;
}

function usesGroundShadowOverlay(tileId: number): boolean {
  return tileId === TILE_FLOOR ||
    tileId === TILE_FLOOR_SHADOW ||
    tileId === TILE_GATE_HORIZONTAL ||
    tileId === TILE_GATE_VERTICAL ||
    tileId === TILE_PRESSURE_PLATE;
}

function isSouthGroundShadowCasterTileId(tileId: number): boolean {
  return tileId === TILE_GATE_HORIZONTAL ||
    tileId === TILE_GATE_VERTICAL;
}

function isEastGroundShadowCasterTileId(tileId: number): boolean {
  return tileId === TILE_GATE_HORIZONTAL || tileId === TILE_GATE_VERTICAL;
}

function createFrontGateSprite(
  gate: GatePlacement,
  textures: FrontGateTextures,
  renderer: Renderer,
  tileSize: number,
): Sprite {
  const gateContainer = new Container();

  for (let row = 0; row < FRONT_GATE_TILE_ROWS.length; row++) {
    const tileRow = FRONT_GATE_TILE_ROWS[row];
    for (let col = 0; col < tileRow.length; col++) {
      const tile = new Sprite(textures[tileRow[col]]);
      tile.x = col * tileSize;
      tile.y = row * tileSize;
      tile.width = tileSize;
      tile.height = tileSize;
      gateContainer.addChild(tile);
    }
  }

  const frame = new Rectangle(
    0,
    0,
    FRONT_GATE_WIDTH_TILES * tileSize,
    FRONT_GATE_HEIGHT_TILES * tileSize,
  );
  const bakedTexture = renderer.generateTexture({
    target: gateContainer,
    frame,
    resolution: 1,
    antialias: false,
  });
  bakedTexture.source.style.scaleMode = 'nearest';
  bakedTexture.source.style.update();

  const sprite = new Sprite(bakedTexture);
  sprite.anchor.set(0, 1);
  sprite.x = gate.tileX * tileSize;
  sprite.y = (gate.tileY + 1) * tileSize;
  sprite.zIndex = (gate.tileY + 1) * tileSize;

  gateContainer.destroy({ children: true });
  return sprite;
}

/** Check if tile at (tx, ty) should cast a south-dropping ground shadow. */
function isSouthGroundShadowCaster(tx: number, ty: number, map: TileMapData): boolean {
  if (tx < 0 || tx >= map.width || ty < 0 || ty >= map.height) return true;
  const id = map.data[ty * map.width + tx];
  return isSouthGroundShadowCasterTileId(id);
}

/** Check if tile at (tx, ty) should cast an east-dropping ground shadow. */
function isEastGroundShadowCaster(tx: number, ty: number, map: TileMapData): boolean {
  if (tx < 0 || tx >= map.width || ty < 0 || ty >= map.height) return true;
  const id = map.data[ty * map.width + tx];
  return isEastGroundShadowCasterTileId(id);
}

function getGroundTexture(
  x: number,
  y: number,
  dirtMask: Uint8Array,
  map: TileMapData,
  assets: GameAssets,
): Texture {
  if (dirtMask[y * map.width + x] === 1) {
    return getDirtTexture(x, y, dirtMask, map.width, map.height, assets.forestPathTextures);
  }

  const tileId = map.data[y * map.width + x];
  if (isForestWallTileId(tileId)) {
    return getForestGroundTexture(assets);
  }

  return getGrassTexture(x, y, assets.grassVariantTextures);
}

// ─────────────────────────────────────────────────────────────────────────────

export class TilemapRenderer {
  // ── Public layers to attach to the scene graph ──────────────────────────
  /** Background chunks (grass, dirt). Attach first in worldContainer. */
  readonly backgroundLayer: Container;
  /** Shadow overlay chunks. Attach after backgroundLayer. */
  readonly shadowLayer: Container;

  // ── Forest/gate row chunks — attach to the foreground wall layer ──────
  readonly wallRowChunks: Container[] = [];
  /** Northern tree facades retain normal feet-based sorting with players. */
  readonly northWallRowChunks: Container[] = [];

  // ── Extracted entities — add individually to entityLayer ────────────────
  readonly treeSprites: Sprite[] = [];
  readonly runestoneSprites: RunestoneSpriteData[] = [];
  readonly gateSprites: Sprite[] = [];
  readonly pressurePlateSprites: PressurePlateSpriteData[] = [];

  // ── Internal tracking for culling + cleanup ────────────────────────────
  private allChunks: ChunkMeta[] = [];

  // ──────────────────────────────────────────────────────────────────────

  constructor(
    map: TileMapData,
    gates: GatePlacement[],
    pressurePlates: PressurePlateInfo[],
    dirtMask: Uint8Array,
    assets: GameAssets,
    renderer: Renderer,
  ) {
    const ts = map.tileSize;
    const renderSimpleHorizontalGates = !assets.frontGateTextures;
    const forestStyleRows = buildForestStyleRows(map, assets);

    this.backgroundLayer = new Container();
    this.shadowLayer = new Container();

    // ── Step 1: Build 32×32 2D Chunks (Background + Shadows) ─────────

    const bgChunkCols = Math.ceil(map.width / BG_CHUNK_SIZE);
    const bgChunkRows = Math.ceil(map.height / BG_CHUNK_SIZE);

    for (let cr = 0; cr < bgChunkRows; cr++) {
      for (let cc = 0; cc < bgChunkCols; cc++) {
        const startX = cc * BG_CHUNK_SIZE;
        const startY = cr * BG_CHUNK_SIZE;
        const endX = Math.min(startX + BG_CHUNK_SIZE, map.width);
        const endY = Math.min(startY + BG_CHUNK_SIZE, map.height);

        const bgChunk = new Container();
        let bgHasContent = false;

        const shadowChunk = new Container();
        let shadowHasContent = false;
        let shadowChunkTopOverflow = 0;

        for (let y = startY; y < endY; y++) {
          for (let x = startX; x < endX; x++) {
            const tileId = map.data[y * map.width + x];
            const localX = (x - startX) * ts;
            const localY = (y - startY) * ts;

            // ── Background tile ──────────────────────────────────
            if (usesGroundBackgroundTile(tileId)) {
              const sprite = new Sprite(getGroundTexture(x, y, dirtMask, map, assets));
              sprite.x = localX;
              sprite.y = localY;
              sprite.width = ts;
              sprite.height = ts;
              bgChunk.addChild(sprite);
              bgHasContent = true;
            }

            // ── Shadow overlay ───────────────────────────────────
            if (usesGroundShadowOverlay(tileId)) {
              const wallAbove = isSouthGroundShadowCaster(x, y - 1, map);
              const wallLeft = isEastGroundShadowCaster(x - 1, y, map);
              const aboveTileId = y > 0 ? map.data[(y - 1) * map.width + x] : null;
              const gateSouthShadowOffset =
                wallAbove && aboveTileId !== null && isGateTileId(aboveTileId)
                  ? GATE_SOUTH_SHADOW_OFFSET_PX
                  : 0;

              const shadowOverlays: { texture: Texture; offsetY: number }[] = [];
              if (wallAbove && wallLeft && gateSouthShadowOffset === 0) {
                shadowOverlays.push({ texture: assets.shadowCornerTexture, offsetY: 0 });
              } else {
                if (wallAbove) {
                  shadowOverlays.push({
                    texture: assets.shadowTopTexture,
                    offsetY: -gateSouthShadowOffset,
                  });
                }
                if (wallLeft) {
                  shadowOverlays.push({ texture: assets.shadowLeftTexture, offsetY: 0 });
                }
              }

              for (const shadow of shadowOverlays) {
                const overlay = new Sprite(shadow.texture);
                overlay.x = localX;
                overlay.y = localY + shadow.offsetY;
                overlay.width = ts;
                overlay.height = ts;
                overlay.alpha = 0.62;
                overlay.tint = 0x6f8560;
                shadowChunk.addChild(overlay);
                shadowHasContent = true;
                shadowChunkTopOverflow = Math.min(shadowChunkTopOverflow, overlay.y);
              }
            }
          }
        }

        // Calculate the exact pixel dimensions of this chunk (handles map edges correctly)
        const chunkPixelW = (endX - startX) * ts;
        const chunkPixelH = (endY - startY) * ts;
        const chunkFrame = new Rectangle(0, 0, chunkPixelW, chunkPixelH);

        // Bake and register background chunk
        if (bgHasContent) {
          const tex = renderer.generateTexture({
            target: bgChunk,
            frame: chunkFrame, // <-- Force exact dimensions
            resolution: 1,
            antialias: false
          });
          tex.source.style.scaleMode = 'nearest';
          tex.source.style.update(); // Force the GPU to apply the nearest filter

          const bgSprite = new Sprite(tex);
          bgSprite.x = startX * ts;
          bgSprite.y = startY * ts;

          this.backgroundLayer.addChild(bgSprite);
          this.allChunks.push({
            container: bgSprite,
            worldLeft: startX * ts,
            worldTop: startY * ts,
            worldRight: endX * ts,
            worldBottom: endY * ts,
            isVisible: true,
          });

          bgChunk.destroy({ children: true }); // Free memory!
        }

        // Bake and register shadow chunk
        if (shadowHasContent) {
          const shadowFrame = new Rectangle(
            0,
            shadowChunkTopOverflow,
            chunkPixelW,
            chunkPixelH - shadowChunkTopOverflow,
          );
          const tex = renderer.generateTexture({
            target: shadowChunk,
            frame: shadowFrame,
            resolution: 1,
            antialias: false
          });
          tex.source.style.scaleMode = 'nearest';
          tex.source.style.update();

          const shadowSprite = new Sprite(tex);
          shadowSprite.x = startX * ts;
          shadowSprite.y = startY * ts + shadowChunkTopOverflow;

          this.shadowLayer.addChild(shadowSprite);
          this.allChunks.push({
            container: shadowSprite,
            worldLeft: startX * ts,
            worldTop: startY * ts + shadowChunkTopOverflow,
            worldRight: endX * ts,
            worldBottom: endY * ts,
            isVisible: true,
          });

          shadowChunk.destroy({ children: true }); // Free memory!
        }
      }
    }

    // ── Step 2: Build JSON-authored Fiorwoods wall row chunks ───────────
    // Placements come from the inner wall and corner layout in style export
    // (12). No positional hashing or procedural side-tile selection is used.
    const forestChunkCols = Math.ceil(map.width / FOREST_CHUNK_WIDTH);

    for (let y = 0; y < map.height; y++) {
      for (let chunkCol = 0; chunkCol < forestChunkCols; chunkCol++) {
        const startX = chunkCol * FOREST_CHUNK_WIDTH;
        const endX = Math.min(startX + FOREST_CHUNK_WIDTH, map.width);
        const rowContainer = new Container();
        const northRowContainer = new Container();
        let hasContent = false;
        let northHasContent = false;

        for (let x = startX; x < endX; x++) {
          const tileId = map.data[y * map.width + x];
          const localX = (x - startX) * ts;

          // Keep simple gates visible when the full front-gate atlas is absent.
          const gateTexture = tileId === TILE_GATE_VERTICAL
            ? assets.gateVerticalTexture
            : tileId === TILE_GATE_HORIZONTAL && renderSimpleHorizontalGates
              ? assets.gateHorizontalTexture
              : null;
          if (gateTexture) {
            const gateSprite = new Sprite(gateTexture);
            gateSprite.x = localX;
            gateSprite.y = 0;
            gateSprite.width = ts;
            gateSprite.height = ts;
            northRowContainer.addChild(gateSprite);
            northHasContent = true;
          }

        }

        // Add this row's exact template pieces, preserving the JSON z-order.
        for (const placement of forestStyleRows.get(y) ?? []) {
          const chunkLeft = startX * ts;
          const chunkRight = endX * ts;
          if (placement.x < chunkLeft || placement.x >= chunkRight) continue;

          const northWall = placement.direction === 'north';
          const module = new Sprite(placement.texture);
          module.anchor.set(0.5);
          module.x = placement.x - chunkLeft + placement.width / 2;
          module.y = placement.y - y * ts + placement.height / 2;
          module.width = placement.width;
          module.height = placement.height;
          module.scale.x = Math.abs(module.scale.x) * (placement.flipX ? -1 : 1);
          module.scale.y = Math.abs(module.scale.y) * (placement.flipY ? -1 : 1);
          (northWall ? northRowContainer : rowContainer).addChild(module);
          if (northWall) northHasContent = true;
          else hasContent = true;
        }

        const bakeRow = (
          source: Container,
          content: boolean,
          destination: Container[],
        ): void => {
          if (!content) {
            source.destroy({ children: true });
            return;
          }
          const chunkPixelWidth = (endX - startX) * ts;
          const frame = new Rectangle(
            -FOREST_SIDE_OVERFLOW,
            -FOREST_CANOPY_OVERFLOW,
            chunkPixelWidth + FOREST_SIDE_OVERFLOW * 2,
            FOREST_CANOPY_OVERFLOW + ts + 48,
          );
          const texture = renderer.generateTexture({
            target: source,
            frame,
            resolution: 1,
            antialias: false,
          });
          texture.source.style.scaleMode = 'nearest';
          texture.source.style.update();

          const rowSprite = new Sprite(texture);
          rowSprite.x = startX * ts - FOREST_SIDE_OVERFLOW;
          rowSprite.y = y * ts - FOREST_CANOPY_OVERFLOW;
          rowSprite.zIndex = (y + 1) * ts;
          destination.push(rowSprite);
          this.allChunks.push({
            container: rowSprite,
            worldLeft: rowSprite.x,
            worldTop: rowSprite.y,
            worldRight: endX * ts + FOREST_SIDE_OVERFLOW,
            worldBottom: (y + 4) * ts + 16,
            isVisible: true,
          });
          source.destroy({ children: true });
        };

        bakeRow(rowContainer, hasContent, this.wallRowChunks);
        bakeRow(northRowContainer, northHasContent, this.northWallRowChunks);
      }
    }

    // ── Step 3: Extract Special Entities ──────────────────────────────

    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const tileId = map.data[y * map.width + x];

        if (tileId === TILE_TREE) {
          const treeTex = assets.forestTreeTextures[positionHash(x, y, 23) % assets.forestTreeTextures.length];
          const treeHeight = 112;
          const treeWidth = Math.round(treeTex.width * treeHeight / treeTex.height);
          const treeShadow = new Sprite(assets.forestShadowTexture);
          treeShadow.anchor.set(0.5);
          treeShadow.x = x * ts + ts / 2;
          treeShadow.y = (y + 1) * ts - 4;
          treeShadow.width = 54;
          treeShadow.height = 24;
          treeShadow.alpha = 0.68;
          this.shadowLayer.addChild(treeShadow);

          const treeSprite = new Sprite(treeTex);
          treeSprite.anchor.set(0.5, 1.0);
          treeSprite.x = x * ts + ts / 2;
          treeSprite.y = (y + 1) * ts;
          treeSprite.width = treeWidth;
          treeSprite.height = treeHeight;
          treeSprite.zIndex = (y + 1) * ts;
          this.treeSprites.push(treeSprite);
        }

        if (tileId === TILE_RUNESTONE_1 || tileId === TILE_RUNESTONE_2 || tileId === TILE_RUNESTONE_3) {
          const rsIdx = tileId === TILE_RUNESTONE_1 ? 0 : tileId === TILE_RUNESTONE_2 ? 1 : 2;
          const rsTex = assets.runestoneTextures[rsIdx][0]; // start inactive
          const rsSprite = new Sprite(rsTex);
          rsSprite.anchor.set(0.5, 1.0);
          rsSprite.x = x * ts + ts / 2;
          rsSprite.y = (y + 1) * ts;
          rsSprite.width = 16;
          rsSprite.height = 32;
          rsSprite.zIndex = (y + 1) * ts;

          this.runestoneSprites.push({
            sprite: rsSprite,
            index: rsIdx,
            tileX: x,
            tileY: y,
            activated: false,
          });
        }
      }
    }

    // ── Step 3b: Extract Pressure Plate Sprites ────────────────────────
    for (const plate of pressurePlates) {
      const isHub = plate.side === 'hub';
      const frameSet = isHub ? assets.hubPressurePlateFrames : assets.pressurePlateFrames;
      const plateTex = frameSet[0]; // Start at frame 0 (up)
      const plateSprite = new Sprite(plateTex);
      plateSprite.anchor.set(0, 0);

      if (isHub) {
        // Hub-side plate: 24x16, centered horizontally on 16x16 tile
        plateSprite.x = plate.tileX * ts - 4;
        plateSprite.y = plate.tileY * ts;
        plateSprite.width = 24;
        plateSprite.height = 16;
      } else {
        // Spawn-side plate: standard 16x16
        plateSprite.x = plate.tileX * ts;
        plateSprite.y = plate.tileY * ts;
        plateSprite.width = ts;
        plateSprite.height = ts;
      }

      plateSprite.zIndex = plate.tileY * ts; // Below player feet

      this.pressurePlateSprites.push({
        sprite: plateSprite,
        plateId: plate.id,
        gateIndex: plate.gateIndex,
        tileX: plate.tileX,
        tileY: plate.tileY,
        side: plate.side,
        currentFrame: 0,
        frameSet: frameSet,
      });
    }

    if (assets.frontGateTextures) {
      for (const gate of gates) {
        if (gate.orientation !== 'horizontal') continue;
        this.gateSprites.push(createFrontGateSprite(gate, assets.frontGateTextures, renderer, ts));
      }
    }
  }

  // ── Per-frame viewport culling ────────────────────────────────────────

  /**
   * Hide chunks that are entirely outside the camera viewport.
   * Call every frame after updating the camera.
   *
   * @param camX  worldContainer.x (negative when camera moves right)
   * @param camY  worldContainer.y (negative when camera moves right)
   * @param zoom  Current zoom scale applied to worldContainer
   */
  updateVisibility(camX: number, camY: number, zoom: number): void {
    // Camera viewport in world-space coordinates
    const viewL = -camX / zoom;
    const viewT = -camY / zoom;
    const viewR = viewL + INTERNAL_WIDTH / zoom;
    const viewB = viewT + INTERNAL_HEIGHT / zoom;

    for (let i = 0; i < this.allChunks.length; i++) {
      const chunk = this.allChunks[i];
      const isVisible =
        chunk.worldRight >= viewL && chunk.worldLeft <= viewR &&
        chunk.worldBottom >= viewT && chunk.worldTop <= viewB;
      if (chunk.isVisible !== isVisible) {
        chunk.isVisible = isVisible;
        chunk.container.visible = isVisible;
      }
    }
  }

  // ── Cleanup ───────────────────────────────────────────────────────────

  /** Remove all chunks from the scene and free GPU resources. */
  destroy(): void {
    this.backgroundLayer.destroy({ children: true });
    this.shadowLayer.destroy({ children: true });

    for (const chunk of this.wallRowChunks) {
      chunk.parent?.removeChild(chunk);
      chunk.destroy({ children: true });
    }

    for (const chunk of this.northWallRowChunks) {
      chunk.parent?.removeChild(chunk);
      chunk.destroy({ children: true });
    }

    for (const tree of this.treeSprites) {
      tree.parent?.removeChild(tree);
      tree.destroy();
    }

    for (const rs of this.runestoneSprites) {
      rs.sprite.parent?.removeChild(rs.sprite);
      rs.sprite.destroy();
    }

    for (const gate of this.gateSprites) {
      gate.parent?.removeChild(gate);
      gate.destroy();
    }

    for (const plate of this.pressurePlateSprites) {
      plate.sprite.parent?.removeChild(plate.sprite);
      plate.sprite.destroy();
    }

    this.wallRowChunks.length = 0;
    this.northWallRowChunks.length = 0;
    this.treeSprites.length = 0;
    this.runestoneSprites.length = 0;
    this.gateSprites.length = 0;
    this.pressurePlateSprites.length = 0;
    this.allChunks.length = 0;
  }
}
