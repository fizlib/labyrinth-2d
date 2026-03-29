// packages/client/src/systems/Minimap.ts
// ─────────────────────────────────────────────────────────────────────────────
// Minimap HUD — Fog-of-war minimap anchored to the bottom-right corner.
//
// Design:
//   - 80×80 pixel viewport at 1 pixel per tile (zoomed-in portion of the map)
//   - Always centered on the player's current position (scrolls with movement)
//   - All tiles start black (fog); explored tiles revealed in a circular radius
//   - Player position shown as a bright gold dot at the center
//   - Semi-transparent dark frame with subtle border
// ─────────────────────────────────────────────────────────────────────────────

import { Container, Sprite, Texture, Graphics } from 'pixi.js';
import type { TileMapData } from '@labyrinth/shared';
import { TILE_FLOOR, TILE_FLOOR_SHADOW } from '@labyrinth/shared';

// ── Configuration ───────────────────────────────────────────────────────────

/** Minimap viewport in pixels (1 px = 1 tile). */
const MINIMAP_SIZE = 80;

/** Distance from the screen edge. */
const MINIMAP_MARGIN = 6;

/** Padding inside the frame around the map sprite. */
const MINIMAP_PADDING = 3;

/** Circular reveal radius in tiles around the player. */
const REVEAL_RADIUS = 5;

// ── Tile colour palette (RGBA tuples) ───────────────────────────────────────

const COL_FLOOR:  readonly number[] = [74, 122, 74, 255];   // #4a7a4a  muted green
const COL_DIRT:   readonly number[] = [107, 90, 62, 255];    // #6b5a3e  warm brown
const COL_WALL:   readonly number[] = [42, 42, 58, 255];     // #2a2a3a  dark blue-gray
const COL_PLAYER: readonly number[] = [255, 215, 0, 255];    // #FFD700  gold
const COL_FOG:    readonly number[] = [0, 0, 0, 255];        // black

// ─────────────────────────────────────────────────────────────────────────────

export class Minimap {
  // ── PixiJS display objects ──────────────────────────────────────────────
  private container: Container;
  private sprite: Sprite;
  private texture: Texture;

  // ── Offscreen canvas for per-pixel rendering ───────────────────────────
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private imageData: ImageData;
  private pixels: Uint8ClampedArray;

  // ── Map / fog state ────────────────────────────────────────────────────
  private mapData: TileMapData;
  private fog: Uint8Array;               // 0 = hidden, 1 = revealed

  /** Half the viewport size — used to convert tile ↔ canvas coords. */
  private half: number;

  // ── Tracking for incremental updates ───────────────────────────────────
  private lastPlayerTileX = -1;
  private lastPlayerTileY = -1;

  // ──────────────────────────────────────────────────────────────────────

  constructor(
    mapData: TileMapData,
    internalWidth: number,
    internalHeight: number,
  ) {
    this.mapData = mapData;
    this.fog = new Uint8Array(mapData.width * mapData.height); // all 0
    this.half = Math.floor(MINIMAP_SIZE / 2);

    // ── Offscreen canvas ───────────────────────────────────────────────
    this.canvas = document.createElement('canvas');
    this.canvas.width = MINIMAP_SIZE;
    this.canvas.height = MINIMAP_SIZE;
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.imageSmoothingEnabled = false;

    // Initialise ImageData — fill with opaque black (fog)
    this.imageData = this.ctx.createImageData(MINIMAP_SIZE, MINIMAP_SIZE);
    this.pixels = this.imageData.data;
    for (let i = 3; i < this.pixels.length; i += 4) {
      this.pixels[i] = 255; // alpha = fully opaque
    }
    this.ctx.putImageData(this.imageData, 0, 0);

    // ── PixiJS texture from canvas (matches FallbackTextures pattern) ──
    this.texture = Texture.from(this.canvas);
    this.texture.source.scaleMode = 'nearest';
    this.sprite = new Sprite(this.texture);

    // ── Build HUD container ────────────────────────────────────────────
    this.container = new Container();

    const totalSize = MINIMAP_SIZE + MINIMAP_PADDING * 2;

    // Background panel
    const bg = new Graphics();
    bg.roundRect(0, 0, totalSize, totalSize, 3);
    bg.fill({ color: 0x0a0a14, alpha: 0.75 });
    bg.roundRect(0, 0, totalSize, totalSize, 3);
    bg.stroke({ color: 0x8899aa, alpha: 0.4, width: 1 });
    this.container.addChild(bg);

    // Map sprite (positioned inside padding)
    this.sprite.x = MINIMAP_PADDING;
    this.sprite.y = MINIMAP_PADDING;
    this.container.addChild(this.sprite);

    // Inner subtle border right around the map pixels
    const innerBorder = new Graphics();
    innerBorder.rect(
      MINIMAP_PADDING - 1,
      MINIMAP_PADDING - 1,
      MINIMAP_SIZE + 2,
      MINIMAP_SIZE + 2,
    );
    innerBorder.stroke({ color: 0x556677, alpha: 0.3, width: 1 });
    this.container.addChild(innerBorder);

    // Position container at bottom-right of internal resolution
    this.container.x = internalWidth - totalSize - MINIMAP_MARGIN;
    this.container.y = internalHeight - totalSize - MINIMAP_MARGIN;
  }

  // ── Public API ────────────────────────────────────────────────────────

  /** Attach the minimap to the PixiJS stage (call once). */
  addToStage(stage: Container): void {
    stage.addChild(this.container);
  }

  /** Call every frame with the local player's current pixel position. */
  update(playerPixelX: number, playerPixelY: number): void {
    const ptx = Math.floor(playerPixelX / this.mapData.tileSize);
    const pty = Math.floor(playerPixelY / this.mapData.tileSize);

    // Only redraw when the player crosses a tile boundary
    if (ptx === this.lastPlayerTileX && pty === this.lastPlayerTileY) return;

    this.lastPlayerTileX = ptx;
    this.lastPlayerTileY = pty;

    // Reveal fog around the player
    this.revealAround(ptx, pty);

    // Redraw the entire viewport centered on the player
    this.redrawCanvas(ptx, pty);

    // Push canvas changes to GPU
    this.ctx.putImageData(this.imageData, 0, 0);
    this.texture.source.update();
  }

  /** Remove from stage and free resources. */
  destroy(): void {
    this.container.parent?.removeChild(this.container);
    this.container.destroy({ children: true });
    this.texture.destroy(true);
  }

  // ── Canvas rendering ──────────────────────────────────────────────────

  /**
   * Redraw the entire 80×80 canvas with the player at the center.
   * Each canvas pixel maps to a map tile; fog-hidden tiles are black.
   */
  private redrawCanvas(centerTX: number, centerTY: number): void {
    const { width, height, data } = this.mapData;

    for (let cy = 0; cy < MINIMAP_SIZE; cy++) {
      for (let cx = 0; cx < MINIMAP_SIZE; cx++) {
        const tx = centerTX + (cx - this.half);
        const ty = centerTY + (cy - this.half);

        // Out of map bounds → fog
        if (tx < 0 || tx >= width || ty < 0 || ty >= height) {
          this.setPixel(cx, cy, COL_FOG);
          continue;
        }

        const fogIdx = ty * width + tx;
        if (this.fog[fogIdx] === 0) {
          this.setPixel(cx, cy, COL_FOG);
        } else {
          this.setPixel(cx, cy, this.tileColor(data[fogIdx]));
        }
      }
    }

    // Player dot always at center
    this.setPixel(this.half, this.half, COL_PLAYER);
  }

  // ── Pixel manipulation ────────────────────────────────────────────────

  private setPixel(cx: number, cy: number, col: readonly number[]): void {
    const i = (cy * MINIMAP_SIZE + cx) * 4;
    this.pixels[i]     = col[0];
    this.pixels[i + 1] = col[1];
    this.pixels[i + 2] = col[2];
    this.pixels[i + 3] = col[3];
  }

  /** Get the minimap colour for a given tile ID. */
  private tileColor(id: number): readonly number[] {
    if (id === TILE_FLOOR) return COL_FLOOR;
    if (id === TILE_FLOOR_SHADOW) return COL_DIRT;
    return COL_WALL; // all solid / unknown tiles
  }

  // ── Fog reveal ────────────────────────────────────────────────────────

  /**
   * Reveal tiles in a circular area around the player's current tile.
   */
  private revealAround(ptx: number, pty: number): void {
    const r = REVEAL_RADIUS;
    const rSq = r * r;
    const { width, height } = this.mapData;

    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > rSq) continue; // circular mask

        const tx = ptx + dx;
        const ty = pty + dy;

        if (tx < 0 || tx >= width || ty < 0 || ty >= height) continue;

        this.fog[ty * width + tx] = 1;
      }
    }
  }
}
