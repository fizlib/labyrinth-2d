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
const FOREST_FACE_HEIGHT = 8;
const FOREST_NORTH_HEDGE_HEIGHT = 3;

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

/**
 * Return the row in the original eight-piece Fiorwoods south-facing tree
 * facade for this solid tile, or null when it is not part of such a facade.
 */
function getSouthForestFaceRow(x: number, y: number, map: TileMapData): number | null {
  for (let distanceToBase = 0; distanceToBase < FOREST_FACE_HEIGHT; distanceToBase++) {
    if (!isForestAt(x, y + distanceToBase, map)) return null;
    if (!isForestAt(x, y + distanceToBase + 1, map)) {
      return FOREST_FACE_HEIGHT - distanceToBase - 1;
    }
  }
  return null;
}

/** Return the row in the low foliage treatment used on a north-facing edge. */
function getNorthForestHedgeRow(x: number, y: number, map: TileMapData): number | null {
  for (let distanceFromTop = 0; distanceFromTop < FOREST_NORTH_HEDGE_HEIGHT; distanceFromTop++) {
    if (!isForestAt(x, y - distanceFromTop, map)) return null;
    if (!isForestAt(x, y - distanceFromTop - 1, map)) return distanceFromTop;
  }
  return null;
}

function isInsideEastForestEdge(x: number, y: number, map: TileMapData): boolean {
  return isForestAt(x, y, map) && !isForestAt(x - 1, y, map);
}

function getInsideEastEdgeRow(x: number, y: number, map: TileMapData): number | null {
  if (!isInsideEastForestEdge(x, y, map)) return null;
  let startY = y;
  while (isInsideEastForestEdge(x, startY - 1, map)) startY--;
  return y - startY;
}

function getInsideEastEdgeStartBelow(x: number, y: number, map: TileMapData): number | null {
  for (let distance = 1; distance <= FOREST_FACE_HEIGHT; distance++) {
    const edgeY = y + distance;
    if (isInsideEastForestEdge(x, edgeY, map) && !isInsideEastForestEdge(x, edgeY - 1, map)) {
      return distance;
    }
  }
  return null;
}

function getInsideNorthEdgeColumn(x: number, y: number, map: TileMapData): number | null {
  if (!isForestAt(x, y, map) || isForestAt(x, y + 1, map)) return null;
  let startX = x;
  while (isForestAt(startX - 1, y, map) && !isForestAt(startX - 1, y + 1, map)) startX--;
  const column = x - startX;
  return column % 6;
}

function isNorthHedgeReplacedByInsideCorner(
  x: number,
  y: number,
  northHedgeRow: number,
  map: TileMapData,
): boolean {
  const edgeStartY = y - northHedgeRow + FOREST_FACE_HEIGHT;
  for (let offsetX = 0; offsetX < 4; offsetX++) {
    const edgeX = x - offsetX;
    if (isInsideEastForestEdge(edgeX, edgeStartY, map) &&
        !isInsideEastForestEdge(edgeX, edgeStartY - 1, map)) {
      return true;
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

  // ── Forest/gate row chunks — add individually for feet-based Y-sorting ─
  readonly wallRowChunks: Container[] = [];

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

    // ── Step 2: Build hand-authored Fiorwoods tree-wall row chunks ──────
    // Tree walls are a directional tile assembly, not a scatter of tree
    // sprites. The eight-row south face, low north hedge, and mirrored side
    // hedges follow the source Fiorwoods map layouts while retaining this
    // game's collision grid and Y-sorting behaviour.
    const forestChunkCols = Math.ceil(map.width / FOREST_CHUNK_WIDTH);

    for (let y = 0; y < map.height; y++) {
      for (let chunkCol = 0; chunkCol < forestChunkCols; chunkCol++) {
        const startX = chunkCol * FOREST_CHUNK_WIDTH;
        const endX = Math.min(startX + FOREST_CHUNK_WIDTH, map.width);
        const rowContainer = new Container();
        let hasContent = false;

        const addForestModule = (texture: Texture, localX: number, flipX = false): void => {
          const module = new Sprite(texture);
          const moduleHeight = Math.round(texture.height * ts / texture.width);
          module.anchor.set(flipX ? 1 : 0, 1);
          module.x = localX + (flipX ? ts : 0);
          module.y = ts;
          module.width = ts;
          module.height = moduleHeight;
          rowContainer.addChild(module);
          hasContent = true;
        };

        const addSizedForestModule = (
          texture: Texture,
          localX: number,
          localY: number,
          width: number,
          height: number,
        ): void => {
          const module = new Sprite(texture);
          module.x = localX;
          module.y = localY;
          module.width = width;
          module.height = height;
          rowContainer.addChild(module);
          hasContent = true;
        };

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
            rowContainer.addChild(gateSprite);
            hasContent = true;
          }

          if (!isForestWallTileId(tileId)) continue;

          const eastOpen = !isForestAt(x + 1, y, map);
          const westOpen = !isForestAt(x - 1, y, map);

          const insideNorthColumn = getInsideNorthEdgeColumn(x, y, map);

          const insideEastRow = getInsideEastEdgeRow(x, y, map);
          const edgeStartBelow = getInsideEastEdgeStartBelow(x, y, map);
          const extendedEastRow = insideEastRow ?? (edgeStartBelow !== null && edgeStartBelow <= 4
            ? 4 - edgeStartBelow
            : null);
          if (extendedEastRow !== null) {
            const odd = extendedEastRow % 2 === 1;
            const pair = odd
              ? assets.forestWallTextures.insideEastOddTextures
              : assets.forestWallTextures.insideEastEvenTextures;
            addSizedForestModule(pair[0], localX - (odd ? 3 : 4), 0, odd ? 14 : ts, ts);
            addSizedForestModule(pair[1], localX + (odd ? 11 : 12), 0, ts, ts);
          } else if (edgeStartBelow !== null && edgeStartBelow >= 5) {
            const capRow = assets.forestWallTextures.insideNorthEastCapRows[8 - edgeStartBelow];
            if (edgeStartBelow === 8) {
              addSizedForestModule(capRow[0], localX, 6, 11, 10);
            } else {
              addSizedForestModule(capRow[0], localX, 0, ts, ts);
              if (capRow[1]) addSizedForestModule(capRow[1], localX + 12, 0, ts, ts);
            }
          }

          const southFaceRow = getSouthForestFaceRow(x, y, map);
          if (southFaceRow !== null) {
            // Fiorwoods softens a face/side junction over two rows before the
            // trunks begin. This avoids a rectangular cutoff where a western
            // or eastern hedge meets the south-facing tree wall.
            const sideCorner = westOpen || eastOpen;
            if (!sideCorner || southFaceRow >= 2) {
              const faceRow = assets.forestWallTextures.southFaceRows[southFaceRow];
              addForestModule(faceRow[x % faceRow.length], localX);
            }

            // The source corner leaves the uppermost cell open and places the
            // small diagonal hedge cap one row below it. That two-step taper is
            // what turns the tree front into the rounded side wall shown in the
            // Fiorwoods layouts.
            if (sideCorner && southFaceRow === 1) {
              addForestModule(assets.forestWallTextures.sideHedgeTextures[0], localX, westOpen);
            }

            if (sideCorner && southFaceRow === 2) {
              // The transparent triangular module is positioned in the open
              // neighbour cell, exactly as in the source tilemap stencil.
              addForestModule(
                assets.forestWallTextures.southFaceCornerTexture,
                westOpen ? localX - ts : localX + ts,
                eastOpen,
              );
            }

            // Draw the JSON-authored ground-shadow fringe after the tree face
            // so its dark pixels are not covered by the facade's bottom row.
            if (insideNorthColumn !== null) {
              const texture = assets.forestWallTextures.insideNorthEdgeTextures[insideNorthColumn];
              const yOffsets = [15, 15, 15, 14, 16, 16];
              addSizedForestModule(texture, localX, yOffsets[insideNorthColumn], ts, 6);
            }
            continue;
          }

          const northHedgeRow = getNorthForestHedgeRow(x, y, map);
          if (northHedgeRow !== null) {
            if (!isNorthHedgeReplacedByInsideCorner(x, y, northHedgeRow, map)) {
              addForestModule(assets.forestWallTextures.northHedgeRows[
                northHedgeRow % assets.forestWallTextures.northHedgeRows.length
              ], localX);
            }
            continue;
          }

          if (eastOpen || westOpen) {
            if (westOpen) continue;
            const isVerticalEnd = !isForestAt(x, y - 1, map) || !isForestAt(x, y + 1, map);
            const sideIndex = isVerticalEnd
              ? 0
              : 1 + (positionHash(x, y, 29) % (assets.forestWallTextures.sideHedgeTextures.length - 1));
            addForestModule(assets.forestWallTextures.sideHedgeTextures[sideIndex], localX, westOpen);
          }
        }

        if (hasContent) {
          const chunkPixelWidth = (endX - startX) * ts;
          const frame = new Rectangle(
            -FOREST_SIDE_OVERFLOW,
            -FOREST_CANOPY_OVERFLOW,
            chunkPixelWidth + FOREST_SIDE_OVERFLOW * 2,
            FOREST_CANOPY_OVERFLOW + ts + 48,
          );
          const texture = renderer.generateTexture({
            target: rowContainer,
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
          this.wallRowChunks.push(rowSprite);
          this.allChunks.push({
            container: rowSprite,
            worldLeft: rowSprite.x,
            worldTop: rowSprite.y,
            worldRight: endX * ts + FOREST_SIDE_OVERFLOW,
            worldBottom: (y + 4) * ts + 16,
            isVisible: true,
          });
          rowContainer.destroy({ children: true });
        }
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
    this.treeSprites.length = 0;
    this.runestoneSprites.length = 0;
    this.gateSprites.length = 0;
    this.pressurePlateSprites.length = 0;
    this.allChunks.length = 0;
  }
}
