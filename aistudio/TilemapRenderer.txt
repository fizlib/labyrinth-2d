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
  TILE_WALL_TOP,
  TILE_WALL_INTERIOR,
  TILE_WALL_SIDE_LEFT,
  TILE_WALL_SIDE_RIGHT,
  TILE_WALL_BOTTOM,
  TILE_WALL_CORNER_TL,
  TILE_WALL_CORNER_TR,
  TILE_WALL_CORNER_BL,
  TILE_WALL_CORNER_BR,
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
import type { GameAssets, FrontGateTextures } from '../assets/AssetLoader';

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

/** Width in tiles for wall row chunks (1 tile high). */
const WALL_CHUNK_WIDTH = 32;

// ── Internal chunk metadata ─────────────────────────────────────────────────

interface ChunkMeta {
  container: Container;
  /** World-space bounding box for culling. */
  worldLeft: number;
  worldTop: number;
  worldRight: number;
  worldBottom: number;
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

function getCenterDirtTexture(x: number, y: number, assets: GameAssets): Texture {
  const h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) >>> 0;
  return (h & 1) === 0 ? assets.dirtTextures.center : assets.dirtTextures.plainAlt;
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
  assets: GameAssets,
): Texture {
  const north = isDirtAt(x, y - 1, dirtMask, mapWidth, mapHeight);
  const east = isDirtAt(x + 1, y, dirtMask, mapWidth, mapHeight);
  const south = isDirtAt(x, y + 1, dirtMask, mapWidth, mapHeight);
  const west = isDirtAt(x - 1, y, dirtMask, mapWidth, mapHeight);

  const missingNorth = !north;
  const missingEast = !east;
  const missingSouth = !south;
  const missingWest = !west;

  if (missingNorth && missingEast) return assets.dirtTextures.northEast;
  if (missingEast && missingSouth) return assets.dirtTextures.southEast;
  if (missingSouth && missingWest) return assets.dirtTextures.southWest;
  if (missingNorth && missingWest) return assets.dirtTextures.northWest;
  if (missingNorth) return assets.dirtTextures.north;
  if (missingEast) return assets.dirtTextures.east;
  if (missingSouth) return assets.dirtTextures.south;
  if (missingWest) return assets.dirtTextures.west;
  return getCenterDirtTexture(x, y, assets);
}

/** Deterministic wall face variant texture based on tile position. */
function getWallFaceTexture(x: number, y: number, wallFaceTextures: Texture[]): Texture {
  const h = ((x * 2246822519 + y * 3266489917) >>> 0) % 100;
  if (h < 70) return wallFaceTextures[0];
  if (h < 80) return wallFaceTextures[1];
  if (h < 90) return wallFaceTextures[2];
  return wallFaceTextures[3];
}

/** Returns true if tileId is a wall-row obstacle that should render on the entity layer. */
function isSolidWallTile(tileId: number, renderSimpleHorizontalGates: boolean): boolean {
  return (tileId >= TILE_WALL_FACE && tileId <= TILE_WALL_TOP_EDGE) ||
    tileId === TILE_GATE_VERTICAL ||
    (renderSimpleHorizontalGates && tileId === TILE_GATE_HORIZONTAL);
}

/** Returns the appropriate texture for a wall tile ID. */
function getWallTexture(tileId: number, x: number, y: number, assets: GameAssets): Texture | null {
  switch (tileId) {
    case TILE_WALL_FACE:      return getWallFaceTexture(x, y, assets.wallFaceVariantTextures);
    case TILE_WALL_TOP:       return assets.wallTopTexture;
    case TILE_WALL_INTERIOR:  return assets.wallInteriorTexture;
    case TILE_WALL_SIDE_LEFT: return assets.wallSideLeftTexture;
    case TILE_WALL_SIDE_RIGHT:return assets.wallSideRightTexture;
    case TILE_WALL_BOTTOM:    return assets.wallBottomTexture;
    case TILE_WALL_CORNER_TL: return assets.wallCornerTLTexture;
    case TILE_WALL_CORNER_TR: return assets.wallCornerTRTexture;
    case TILE_WALL_CORNER_BL: return assets.wallCornerBLTexture;
    case TILE_WALL_CORNER_BR: return assets.wallCornerBRTexture;
    case TILE_WALL_TOP_EDGE:  return assets.wallTopEdgeTexture;
    case TILE_GATE_HORIZONTAL:return assets.gateHorizontalTexture;
    case TILE_GATE_VERTICAL:  return assets.gateVerticalTexture;
    default: return null;
  }
}

function usesGroundBackgroundTile(tileId: number): boolean {
  return tileId === TILE_FLOOR ||
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
  return (tileId >= TILE_WALL_FACE && tileId <= TILE_TREE) ||
    tileId === TILE_GATE_HORIZONTAL ||
    tileId === TILE_GATE_VERTICAL;
}

function isEastGroundShadowCasterTileId(tileId: number): boolean {
  return tileId >= TILE_WALL_FACE && tileId <= TILE_TREE;
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
    return getDirtTexture(x, y, dirtMask, map.width, map.height, assets);
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

  // ── Wall row chunks — add individually to entityLayer for Y-sorting ────
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
          });

          shadowChunk.destroy({ children: true }); // Free memory!
        }
      }
    }

    // ── Step 2: Build 32×1 Row Chunks (Walls) ────────────────────────

    const wallChunkCols = Math.ceil(map.width / WALL_CHUNK_WIDTH);

    for (let y = 0; y < map.height; y++) {
      for (let wc = 0; wc < wallChunkCols; wc++) {
        const startX = wc * WALL_CHUNK_WIDTH;
        const endX = Math.min(startX + WALL_CHUNK_WIDTH, map.width);

        const rowContainer = new Container();
        let hasWalls = false;

        for (let x = startX; x < endX; x++) {
          const tileId = map.data[y * map.width + x];

          if (isSolidWallTile(tileId, renderSimpleHorizontalGates)) {
            const tex = getWallTexture(tileId, x, y, assets);
            if (tex) {
              const sprite = new Sprite(tex);
              sprite.x = (x - startX) * ts;
              sprite.y = 0;
              sprite.width = ts;
              sprite.height = ts;
              rowContainer.addChild(sprite);
              hasWalls = true;
            }
          }
        }

        if (hasWalls) {
          const wallPixelW = (endX - startX) * ts;
          const wallFrame = new Rectangle(0, 0, wallPixelW, ts);

          // Manually bake texture
          const tex = renderer.generateTexture({
            target: rowContainer,
            frame: wallFrame, // <-- Force exact dimensions
            resolution: 1,
            antialias: false
          });
          tex.source.style.scaleMode = 'nearest';
          tex.source.style.update();

          const rowSprite = new Sprite(tex);
          rowSprite.x = startX * ts;
          rowSprite.y = y * ts;
          rowSprite.zIndex = (y + 1) * ts; // Precise per-row Y-sort on the Sprite

          this.wallRowChunks.push(rowSprite);
          this.allChunks.push({
            container: rowSprite,
            worldLeft: startX * ts,
            worldTop: y * ts,
            worldRight: endX * ts,
            worldBottom: (y + 1) * ts,
          });

          rowContainer.destroy({ children: true }); // Free memory!
        }
      }
    }

    // ── Step 3: Extract Special Entities ──────────────────────────────

    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const tileId = map.data[y * map.width + x];

        if (tileId === TILE_TREE) {
          const treeTex = assets.treeTexture;
          const treeSprite = new Sprite(treeTex);
          treeSprite.anchor.set(0.5, 1.0);
          treeSprite.x = x * ts + ts / 2;
          treeSprite.y = (y + 1) * ts;
          treeSprite.width = treeTex.width;
          treeSprite.height = treeTex.height;
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
      chunk.container.visible =
        chunk.worldRight >= viewL && chunk.worldLeft <= viewR &&
        chunk.worldBottom >= viewT && chunk.worldTop <= viewB;
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
