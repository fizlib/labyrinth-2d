// packages/client/src/systems/TilemapRenderer.ts
// ─────────────────────────────────────────────────────────────────────────────
// Chunk-based tilemap renderer for optimal performance.
//
// Strategy:
//   - Background (grass/dirt): baked into 32×32 2D chunks
//   - Shadow overlays:         baked into 32×32 2D chunks
//   - Forest underlays:        baked above portal terrain to clip the clearing
//   - Wall tiles:              baked into 32×1 row chunks (preserves Y-sorting)
//   - Trees / runestones:      individual sprites (Y-sorted in entity layer)
//
// All chunks use PixiJS 8 cacheAsTexture() to collapse many Sprites into a
// single GPU texture, drastically reducing scene-graph nodes and draw calls.
// Viewport culling hides off-screen chunks every frame.
// ─────────────────────────────────────────────────────────────────────────────

import { Container, Sprite, Texture, Renderer, Rectangle } from 'pixi.js';
import type {
  TileMapData,
  GatePlacement,
  PressurePlateInfo,
  BridgePlacement,
  BridgeState,
} from '@labyrinth/shared';
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
import {
  buildForestStylePlacementRows,
  getForestGroundAssetId,
  getForestGroundUnderlayAssetId,
  getForestGroundZIndex,
  type ForestStylePlacementSpec,
} from './ForestWallLayout';
import { addBridgeObstacles, type BridgeObstacleVisual } from './BridgeObstacle';
import { BRIDGE_OBSTACLE_HIDDEN_FOREST_SPRITES } from './BridgeObstacleLayout';

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

function bridgeHidesForestPlacement(
  placement: ForestStylePlacementSpec,
  bridges: readonly BridgePlacement[],
  tileSize: number,
): boolean {
  const scale = tileSize / 16;
  return bridges.some((bridge) => {
    const anchorX = bridge.tileX * tileSize;
    const anchorY = bridge.tileY * tileSize;
    return BRIDGE_OBSTACLE_HIDDEN_FOREST_SPRITES.some((hidden) =>
      placement.assetId === hidden.assetId &&
      placement.x === anchorX + hidden.x * scale &&
      placement.y === anchorY + hidden.y * scale &&
      placement.width === hidden.w * scale &&
      placement.height === hidden.h * scale &&
      placement.zIndex === hidden.z &&
      placement.direction === hidden.direction &&
      placement.flipX === hidden.flipX &&
      placement.flipY === hidden.flipY);
  });
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

function getForestStyleTexture(assetId: number, assets: GameAssets): Texture | undefined {
  const wallTextures = assets.forestWallTextures;
  const authoredDecoration = wallTextures.styleDecorationTextures[assetId];
  if (authoredDecoration) return authoredDecoration;

  const grassIndex = [102, 105, 108, 154].indexOf(assetId);
  if (grassIndex >= 0) return assets.grassVariantTextures[grassIndex];

  const faceRowStarts = [38, 88, 138, 188, 238, 288, 338, 388];
  for (let row = 0; row < faceRowStarts.length; row++) {
    const column = assetId - faceRowStarts[row];
    if (column >= 0 && column < 6) return wallTextures.southFaceRows[row]?.[column];
  }

  const northHedgeIndex = [381, 382, 380].indexOf(assetId);
  if (northHedgeIndex >= 0) return wallTextures.northHedgeRows[northHedgeIndex];

  const sideHedgeIndex = [80, 31, 32].indexOf(assetId);
  if (sideHedgeIndex >= 0) return wallTextures.sideHedgeTextures[sideHedgeIndex];

  if (assetId === 379) return wallTextures.southFaceCornerTexture;
  if (assetId >= 438 && assetId <= 443) {
    return wallTextures.insideNorthEdgeTextures[assetId - 438];
  }
  return undefined;
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
    const groundAssetId = getForestGroundAssetId(x, y, map);
    return getForestStyleTexture(groundAssetId, assets) ?? getForestGroundTexture(assets);
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
  /** Portal clearing terrain. Attach below solid forest underlays. */
  readonly portalTerrainLayer: Container;
  /** Solid forest ground. Attach above portal terrain, below authored details. */
  readonly forestUnderlayLayer: Container;
  /** Authored ground-edge modules. Attach below entities, above terrain. */
  readonly groundDetailLayer: Container;

  // ── Forest/gate row chunks — attach to the foreground wall layer ──────
  readonly wallRowChunks: Container[] = [];
  /** Northern tree facades retain normal feet-based sorting with players. */
  readonly northWallRowChunks: Container[] = [];
  readonly groundDetailRowChunks: Container[] = [];

  // ── Extracted entities — add individually to entityLayer ────────────────
  readonly treeSprites: Sprite[] = [];
  readonly runestoneSprites: RunestoneSpriteData[] = [];
  readonly gateSprites: Sprite[] = [];
  readonly pressurePlateSprites: PressurePlateSpriteData[] = [];
  /** Stateful visual controllers in generated bridge-index order. */
  readonly bridgeVisuals: BridgeObstacleVisual[];

  // ── Internal tracking for culling + cleanup ────────────────────────────
  private allChunks: ChunkMeta[] = [];

  // ──────────────────────────────────────────────────────────────────────

  constructor(
    map: TileMapData,
    gates: GatePlacement[],
    pressurePlates: PressurePlateInfo[],
    bridges: BridgePlacement[],
    dirtMask: Uint8Array,
    assets: GameAssets,
    renderer: Renderer,
  ) {
    const ts = map.tileSize;
    const renderSimpleHorizontalGates = !assets.frontGateTextures;
    const forestStyleRows = buildForestStylePlacementRows(map);

    this.backgroundLayer = new Container();
    this.shadowLayer = new Container();
    this.portalTerrainLayer = new Container();
    this.portalTerrainLayer.sortableChildren = true;
    this.forestUnderlayLayer = new Container();
    this.forestUnderlayLayer.sortableChildren = true;
    this.groundDetailLayer = new Container();
    this.groundDetailLayer.sortableChildren = true;

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

        const forestUnderlayChunk = new Container();
        let forestUnderlayHasContent = false;

        for (let y = startY; y < endY; y++) {
          for (let x = startX; x < endX; x++) {
            const tileId = map.data[y * map.width + x];
            const localX = (x - startX) * ts;
            const localY = (y - startY) * ts;

            // ── Background tile ──────────────────────────────────
            if (usesGroundBackgroundTile(tileId)) {
              const forestTile = isForestWallTileId(tileId);
              const forestGroundInUnderlayLayer = forestTile &&
                getForestGroundZIndex(x, y, map) > 0;
              const underlayAssetId = getForestGroundUnderlayAssetId(x, y, map);
              const underlayTexture = underlayAssetId === null
                ? undefined
                : getForestStyleTexture(underlayAssetId, assets);
              if (underlayTexture) {
                const underlay = new Sprite(underlayTexture);
                underlay.x = localX;
                underlay.y = localY;
                underlay.width = ts;
                underlay.height = ts;
                bgChunk.addChild(underlay);

                if (forestGroundInUnderlayLayer) {
                  const forestUnderlay = new Sprite(underlayTexture);
                  forestUnderlay.x = localX;
                  forestUnderlay.y = localY;
                  forestUnderlay.width = ts;
                  forestUnderlay.height = ts;
                  forestUnderlayChunk.addChild(forestUnderlay);
                }
              }

              const groundTexture = getGroundTexture(x, y, dirtMask, map, assets);
              const sprite = new Sprite(groundTexture);
              sprite.x = localX;
              sprite.y = localY;
              sprite.width = ts;
              sprite.height = ts;
              bgChunk.addChild(sprite);
              bgHasContent = true;

              if (forestGroundInUnderlayLayer) {
                const forestUnderlay = new Sprite(groundTexture);
                forestUnderlay.x = localX;
                forestUnderlay.y = localY;
                forestUnderlay.width = ts;
                forestUnderlay.height = ts;
                forestUnderlayChunk.addChild(forestUnderlay);
                forestUnderlayHasContent = true;
              }
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
            antialias: false,
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

        // Re-bake solid forest ground into its own layer so portal clearing
        // terrain cannot spill across wall tiles. Authored forest details are
        // attached later and remain above this occlusion layer.
        if (forestUnderlayHasContent) {
          const texture = renderer.generateTexture({
            target: forestUnderlayChunk,
            frame: chunkFrame,
            resolution: 1,
            antialias: false
          });
          texture.source.style.scaleMode = 'nearest';
          texture.source.style.update();

          const forestUnderlaySprite = new Sprite(texture);
          forestUnderlaySprite.x = startX * ts;
          forestUnderlaySprite.y = startY * ts;
          this.forestUnderlayLayer.addChild(forestUnderlaySprite);
          this.allChunks.push({
            container: forestUnderlaySprite,
            worldLeft: startX * ts,
            worldTop: startY * ts,
            worldRight: endX * ts,
            worldBottom: endY * ts,
            isVisible: true,
          });

          forestUnderlayChunk.destroy({ children: true });
        } else {
          forestUnderlayChunk.destroy({ children: true });
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
        const groundRowContainer = new Container();
        rowContainer.sortableChildren = true;
        northRowContainer.sortableChildren = true;
        groundRowContainer.sortableChildren = true;
        let hasContent = false;
        let northHasContent = false;
        let groundHasContent = false;

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
          if (bridgeHidesForestPlacement(placement, bridges, ts)) continue;

          const chunkLeft = startX * ts;
          const chunkRight = endX * ts;
          if (placement.x < chunkLeft || placement.x >= chunkRight) continue;

          const texture = getForestStyleTexture(placement.assetId, assets);
          if (!texture) continue;

          const groundDetail = placement.direction === 'ground' || placement.direction === 'terrain';
          const northWall = placement.direction === 'north';
          const module = new Sprite(texture);
          module.anchor.set(0.5);
          module.x = placement.x - chunkLeft + placement.width / 2;
          module.y = placement.y - y * ts + placement.height / 2;
          module.width = placement.width;
          module.height = placement.height;
          module.scale.x = Math.abs(module.scale.x) * (placement.flipX ? -1 : 1);
          module.scale.y = Math.abs(module.scale.y) * (placement.flipY ? -1 : 1);
          module.zIndex = placement.zIndex;
          if (groundDetail) {
            groundRowContainer.addChild(module);
            groundHasContent = true;
          } else if (northWall) {
            northRowContainer.addChild(module);
            northHasContent = true;
          } else {
            rowContainer.addChild(module);
            hasContent = true;
          }
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
        bakeRow(groundRowContainer, groundHasContent, this.groundDetailRowChunks);
      }
    }

    for (const groundChunk of this.groundDetailRowChunks) {
      this.groundDetailLayer.addChild(groundChunk);
    }

    this.bridgeVisuals = addBridgeObstacles(
      bridges,
      ts,
      assets.bridgeObstacleTextures,
      this.forestUnderlayLayer,
      this.groundDetailLayer,
    );

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

  /** Apply an authoritative bridge snapshot to walkway visuals. */
  syncBridgeStates(bridgeStates: readonly BridgeState[], animate: boolean): void {
    for (let bridgeIndex = 0; bridgeIndex < this.bridgeVisuals.length; bridgeIndex++) {
      const state = bridgeStates.find(
        (candidate) => candidate.bridgeIndex === bridgeIndex,
      );
      this.bridgeVisuals[bridgeIndex].syncCollapsedTileMask(
        state?.collapsedTileMask ?? 0,
        animate,
      );
    }
  }

  updateBridgeAnimations(dt: number): void {
    for (const bridge of this.bridgeVisuals) bridge.update(dt);
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
    this.portalTerrainLayer.destroy({ children: true });
    this.forestUnderlayLayer.destroy({ children: true });
    this.groundDetailLayer.destroy({ children: true });

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
    this.groundDetailRowChunks.length = 0;
    this.treeSprites.length = 0;
    this.runestoneSprites.length = 0;
    this.gateSprites.length = 0;
    this.pressurePlateSprites.length = 0;
    this.bridgeVisuals.length = 0;
    this.allChunks.length = 0;
  }
}
