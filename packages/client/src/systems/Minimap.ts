// packages/client/src/systems/Minimap.ts
// ─────────────────────────────────────────────────────────────────────────────
// Minimap HUD — Fog-of-war minimap anchored to the bottom-right corner.
//
// Design (Stardew Valley Style - Compact):
//   - Warm, stylized wooden UI border and vibrant nature colors.
//   - Semi-transparent to blend into the game and not obstruct view.
//   - Smooth Sub-tile Scrolling: Map slides fluidly under the viewport.
//   - 2x Scaled Pixels: Chunky and easy to read.
//   - Optimization: CPU canvas only redraws when transitioning between tiles.
// ─────────────────────────────────────────────────────────────────────────────

import { Container, Sprite, Texture, Graphics } from 'pixi.js';
import type { TileMapData } from '@labyrinth/shared';
import { TILE_FLOOR, TILE_FLOOR_SHADOW } from '@labyrinth/shared';

// ── Configuration ───────────────────────────────────────────────────────────

/** Map area in tiles to render to the buffer (Reduced for smaller footprint) */
const VIEW_TILES = 26;
const EXTRA_TILES = 2;
const CANVAS_SIZE = VIEW_TILES + EXTRA_TILES; // 28x28 tiles drawn to off-screen buffer

/** Multiplier for how large each tile appears on the screen */
const SCALE = 2;

/** Final visible window size */
const MINIMAP_SIZE = VIEW_TILES * SCALE; // 52x52 pixels

/** Width of the wooden frame UI */
const MINIMAP_PADDING = 5;

/** Distance from the screen edge */
const MINIMAP_MARGIN = 8;

/** Circular reveal radius in tiles around the player */
const REVEAL_RADIUS = 7;

// ── Tile colour palette (Stardew Valley Inspired RGBA) ─────────────────────

const COL_FLOOR: readonly number[] = [107, 166, 61, 255]; // vibrant grass green
const COL_WALL: readonly number[] = [89, 73, 58, 255]; // dark wood/stone wall
const COL_FOG: readonly number[] = [29, 33, 25, 255]; // deep foliage/parchment tone (uncharted)
const COL_PORTAL: readonly number[] = [0, 242, 255, 255]; // neon cyan (high contrast)
const COL_PORTAL_GLOW: readonly number[] = [255, 255, 255, 255]; // white hot center

// ─────────────────────────────────────────────────────────────────────────────

export class Minimap {
  // ── PixiJS display objects ──────────────────────────────────────────────
  private container: Container;
  private mapContainer: Container;
  private sprite: Sprite;
  private texture: Texture;

  // ── Offscreen canvas for per-pixel rendering ───────────────────────────
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private imageData: ImageData;
  private pixels: Uint8ClampedArray;

  // ── Map / fog state ────────────────────────────────────────────────────
  private mapData: TileMapData;
  private fog: Uint8Array;

  // ── Tracking for incremental updates ───────────────────────────────────
  private lastPlayerTileX = -1;
  private lastPlayerTileY = -1;

  // ── Portal marker ──────────────────────────────────────────────────────
  private portalTileX = -1;
  private portalTileY = -1;
  private portalActive = false;

  // ──────────────────────────────────────────────────────────────────────

  constructor(
    mapData: TileMapData,
    internalWidth: number,
    internalHeight: number,
  ) {
    this.mapData = mapData;
    this.fog = new Uint8Array(mapData.width * mapData.height); // all 0 (hidden)

    // ── Offscreen canvas (kept small & strictly for the viewable area) ─
    this.canvas = document.createElement('canvas');
    this.canvas.width = CANVAS_SIZE;
    this.canvas.height = CANVAS_SIZE;
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.imageSmoothingEnabled = false;

    // Initialise ImageData — fill with fog colour
    this.imageData = this.ctx.createImageData(CANVAS_SIZE, CANVAS_SIZE);
    this.pixels = this.imageData.data;
    for (let i = 0; i < this.pixels.length; i += 4) {
      this.pixels[i] = COL_FOG[0];
      this.pixels[i + 1] = COL_FOG[1];
      this.pixels[i + 2] = COL_FOG[2];
      this.pixels[i + 3] = COL_FOG[3];
    }
    this.ctx.putImageData(this.imageData, 0, 0);

    // ── PixiJS texture & map sprite ────────────────────────────────────
    this.texture = Texture.from(this.canvas);
    this.texture.source.scaleMode = 'nearest'; // chunky retro pixels
    this.sprite = new Sprite(this.texture);
    this.sprite.scale.set(SCALE);

    // ── Build HUD UI ───────────────────────────────────────────────────
    this.container = new Container();

    // Slight transparency so it doesn't block gameplay too aggressively
    this.container.alpha = 0.85;

    const totalSize = MINIMAP_SIZE + MINIMAP_PADDING * 2;

    // Wooden background & frame
    const bg = new Graphics();

    // Drop shadow
    bg.roundRect(2, 2, totalSize, totalSize, 6);
    bg.fill({ color: 0x000000, alpha: 0.35 });

    // Base thick dark outline
    bg.roundRect(0, 0, totalSize, totalSize, 4);
    bg.fill({ color: 0x3e2312 });

    // Main wood body (Muted to stand out less)
    bg.roundRect(2, 2, totalSize - 4, totalSize - 4, 3);
    bg.fill({ color: 0xa36a43 });

    // Inner brighter wood highlight (Muted)
    bg.roundRect(2, 2, totalSize - 4, totalSize - 4, 3);
    bg.stroke({ color: 0xcd8e5e, alpha: 0.6, width: 2, alignment: 0 });

    // Very dark rim specifically around the map viewport
    bg.rect(MINIMAP_PADDING - 1, MINIMAP_PADDING - 1, MINIMAP_SIZE + 2, MINIMAP_SIZE + 2);
    bg.fill({ color: 0x2a1608 });

    // Unexplored deep map background
    bg.rect(MINIMAP_PADDING, MINIMAP_PADDING, MINIMAP_SIZE, MINIMAP_SIZE);
    bg.fill({ color: 0x1d2119 });

    this.container.addChild(bg);

    // ── Map Mask & Scrolling Container ─────────────────────────────────
    const mask = new Graphics();
    mask.rect(MINIMAP_PADDING, MINIMAP_PADDING, MINIMAP_SIZE, MINIMAP_SIZE);
    mask.fill({ color: 0xffffff });
    this.container.addChild(mask);

    this.mapContainer = new Container();
    this.mapContainer.mask = mask;
    this.mapContainer.addChild(this.sprite);
    this.container.addChild(this.mapContainer);

    // ── Player Icon (Overlayed, fixed in the center) ───────────────────
    const playerMarker = new Graphics();
    playerMarker.circle(0, 0, 2); // Smaller radius (was 3)
    playerMarker.fill({ color: 0xffcc00 }); // Vibrant Gold
    playerMarker.stroke({ color: 0x884400, width: 1 }); // Deep outline
    playerMarker.x = MINIMAP_PADDING + MINIMAP_SIZE / 2;
    playerMarker.y = MINIMAP_PADDING + MINIMAP_SIZE / 2;
    this.container.addChild(playerMarker);

    // Position entire widget at bottom-right
    this.container.x = internalWidth - totalSize - MINIMAP_MARGIN;
    this.container.y = internalHeight - totalSize - MINIMAP_MARGIN;
  }

  // ── Public API ────────────────────────────────────────────────────────

  /** Attach the minimap to the PixiJS stage. */
  addToStage(stage: Container): void {
    stage.addChild(this.container);
  }

  /** Set the portal position (called when portal spawns). */
  setPortalPosition(pixelX: number, pixelY: number): void {
    this.portalTileX = Math.floor(pixelX / this.mapData.tileSize);
    this.portalTileY = Math.floor(pixelY / this.mapData.tileSize);
    this.portalActive = true;
    // Force a redraw on next update
    this.lastPlayerTileX = -1;
    this.lastPlayerTileY = -1;
  }

  /**
   * Call every frame with the local player's precise pixel position.
   * Handles both optimized CPU fog updates and GPU smooth scrolling.
   */
  update(playerPixelX: number, playerPixelY: number): void {
    const ts = this.mapData.tileSize;
    const ptx = Math.floor(playerPixelX / ts);
    const pty = Math.floor(playerPixelY / ts);

    // Only redraw the canvas map when the player officially changes grid tiles
    if (ptx !== this.lastPlayerTileX || pty !== this.lastPlayerTileY) {
      this.lastPlayerTileX = ptx;
      this.lastPlayerTileY = pty;

      this.revealAround(ptx, pty);
      this.redrawCanvas(ptx, pty);

      this.ctx.putImageData(this.imageData, 0, 0);
      this.texture.source.update();
    }

    // Smooth map scrolling (Calculates sub-tile fractional movement)
    const fracX = (playerPixelX % ts) / ts;
    const fracY = (playerPixelY % ts) / ts;

    const viewportCenterX = MINIMAP_PADDING + MINIMAP_SIZE / 2;
    const viewportCenterY = MINIMAP_PADDING + MINIMAP_SIZE / 2;

    const spriteCenterPixelX = Math.floor(CANVAS_SIZE / 2) * SCALE + (fracX * SCALE);
    const spriteCenterPixelY = Math.floor(CANVAS_SIZE / 2) * SCALE + (fracY * SCALE);

    // Dynamically shift the rendered texture around underneath the UI mask
    this.sprite.x = viewportCenterX - spriteCenterPixelX;
    this.sprite.y = viewportCenterY - spriteCenterPixelY;
  }

  /** Remove from stage and free resources. */
  destroy(): void {
    this.container.parent?.removeChild(this.container);
    this.container.destroy({ children: true });
    this.texture.destroy(true);
  }

  // ── Canvas rendering ──────────────────────────────────────────────────

  /**
   * Redraw the local off-screen canvas window with the player at the center.
   */
  private redrawCanvas(centerTX: number, centerTY: number): void {
    const { width, height, data } = this.mapData;
    const centerIndex = Math.floor(CANVAS_SIZE / 2);

    for (let cy = 0; cy < CANVAS_SIZE; cy++) {
      for (let cx = 0; cx < CANVAS_SIZE; cx++) {
        const tx = centerTX + (cx - centerIndex);
        const ty = centerTY + (cy - centerIndex);

        let col = COL_FOG;

        // Inside map bounds?
        if (tx >= 0 && tx < width && ty >= 0 && ty < height) {
          const fogIdx = ty * width + tx;
          if (this.fog[fogIdx] === 1) {
            // Check if this tile is the portal (drawn as a high-visibility diamond)
            if (this.portalActive) {
              const dx = Math.abs(tx - this.portalTileX);
              const dy = Math.abs(ty - this.portalTileY);
              
              if (dx === 0 && dy === 0) {
                col = COL_PORTAL_GLOW; // center
              } else if (dx + dy === 1) {
                col = COL_PORTAL; // diamond edges
              } else {
                col = this.tileColor(data[fogIdx]);
              }
            } else {
              col = this.tileColor(data[fogIdx]);
            }
          }
        }

        const i = (cy * CANVAS_SIZE + cx) * 4;
        this.pixels[i] = col[0];
        this.pixels[i + 1] = col[1];
        this.pixels[i + 2] = col[2];
        this.pixels[i + 3] = col[3];
      }
    }
  }

  // ── Pixel manipulation ────────────────────────────────────────────────

  /** Get the minimap colour for a given tile ID. */
  private tileColor(id: number): readonly number[] {
    if (id === TILE_FLOOR) return COL_FLOOR;
    if (id === TILE_FLOOR_SHADOW) return COL_FLOOR; // shadows are now overlays, base is grass
    return COL_WALL; // solid walls, trees, unknown
  }

  // ── Fog reveal ────────────────────────────────────────────────────────

  /**
   * Reveal fog-of-war in a circular radius around the player.
   */
  private revealAround(ptx: number, pty: number): void {
    const r = REVEAL_RADIUS;
    const rSq = r * r;
    const { width, height } = this.mapData;

    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > rSq) continue;

        const tx = ptx + dx;
        const ty = pty + dy;

        if (tx >= 0 && tx < width && ty >= 0 && ty < height) {
          this.fog[ty * width + tx] = 1;
        }
      }
    }
  }
}
