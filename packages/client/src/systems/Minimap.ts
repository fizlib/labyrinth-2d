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

import { Container, Sprite, Texture, Graphics, Rectangle } from 'pixi.js';
import type { BridgePlacement, TileMapData } from '@labyrinth/shared';
import {
  TILE_FLOOR,
  TILE_FLOOR_SHADOW,
  TILE_GATE_HORIZONTAL,
  TILE_GATE_VERTICAL,
} from '@labyrinth/shared';

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

/** Keep the whole-maze texture at 1:1 scale while fitting its frame on screen. */
const EXPANDED_MARGIN = 5;
const EXPANDED_PADDING = 5;

/** Warden-only map toggle styled after the wooden HUD frame. */
const MAP_TOGGLE_SIZE = 18;
const MAP_TOGGLE_OVERLAP = 5;

/** Circular reveal radius in tiles around the player */
const REVEAL_RADIUS = 7;

// ── Tile colour palette (Stardew Valley Inspired RGBA) ─────────────────────

const COL_FLOOR: readonly number[] = [107, 166, 61, 255]; // vibrant grass green
const COL_DIRT: readonly number[] = [142, 110, 78, 255]; // muted dirt brown
const COL_WALL: readonly number[] = [89, 73, 58, 255]; // dark wood/stone wall
const COL_BRIDGE_WATER: readonly number[] = [47, 105, 125, 255]; // deep blue-green water
const COL_BRIDGE_STONE: readonly number[] = [188, 157, 103, 255]; // pale ancient stone
const COL_FOG: readonly number[] = [29, 33, 25, 255]; // deep foliage/parchment tone (uncharted)
const COL_PORTAL: readonly number[] = [0, 242, 255, 255]; // neon cyan (high contrast)
const COL_PORTAL_GLOW: readonly number[] = [255, 255, 255, 255]; // white hot center

// ─────────────────────────────────────────────────────────────────────────────

export interface MinimapOptions {
  isWarden?: boolean;
  bridges?: readonly BridgePlacement[];
  expandButtonTexture?: Texture | null;
  contractButtonTexture?: Texture | null;
  onExpandedChange?: (expanded: boolean) => void;
}

export class Minimap {
  // ── PixiJS display objects ──────────────────────────────────────────────
  private container: Container;
  private compactContainer: Container;
  private mapContainer: Container;
  private sprite: Sprite;
  private texture: Texture;
  private expandedOverlay: Container | null = null;
  private expandedTexture: Texture | null = null;
  private expandedPlayerMarker: Graphics | null = null;
  private expandedPortalMarker: Graphics | null = null;
  private expandedMapScale = 1;

  // ── Offscreen canvas for per-pixel rendering ───────────────────────────
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private imageData: ImageData;
  private pixels: Uint8ClampedArray;

  /** Separate full-resolution buffer for the fixed whole-maze warden view. */
  private expandedCanvas: HTMLCanvasElement | null = null;
  private expandedCtx: CanvasRenderingContext2D | null = null;
  private expandedImageData: ImageData | null = null;
  private expandedPixels: Uint8ClampedArray | null = null;

  // ── Map / fog state ────────────────────────────────────────────────────
  private mapData: TileMapData;
  private dirtMask: Uint8Array;
  private bridgeMask: Uint8Array;
  private fog: Uint8Array;

  // ── Tracking for incremental updates ───────────────────────────────────
  private lastPlayerTileX = -1;
  private lastPlayerTileY = -1;

  // ── Portal marker ──────────────────────────────────────────────────────
  private portalTileX = -1;
  private portalTileY = -1;
  private portalMarked = false;

  private readonly isWarden: boolean;
  private readonly expandButtonTexture: Texture | null;
  private readonly contractButtonTexture: Texture | null;
  private readonly onExpandedChange?: (expanded: boolean) => void;
  private expanded = false;
  private suppressCanvasClick = false;

  // ──────────────────────────────────────────────────────────────────────

  constructor(
    mapData: TileMapData,
    dirtMask: Uint8Array,
    internalWidth: number,
    internalHeight: number,
    options: MinimapOptions = {},
  ) {
    this.mapData = mapData;
    this.dirtMask = dirtMask;
    this.bridgeMask = this.createBridgeMask(options.bridges ?? []);
    this.isWarden = options.isWarden ?? false;
    this.expandButtonTexture = options.expandButtonTexture ?? null;
    this.contractButtonTexture = options.contractButtonTexture ?? null;
    this.onExpandedChange = options.onExpandedChange;
    this.fog = new Uint8Array(mapData.width * mapData.height); // all 0 (hidden)
    if (this.isWarden) this.fog.fill(1);

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
    this.compactContainer = new Container();
    this.container.addChild(this.compactContainer);

    // Keep the warden's red frame vivid; survivor maps remain slightly translucent.
    this.compactContainer.alpha = this.isWarden ? 1 : 0.85;

    const totalSize = MINIMAP_SIZE + MINIMAP_PADDING * 2;

    // Wooden background & frame
    const bg = new Graphics();

    // Drop shadow
    bg.roundRect(2, 2, totalSize, totalSize, 6);
    bg.fill({ color: 0x000000, alpha: 0.35 });

    // Base thick dark outline
    bg.roundRect(0, 0, totalSize, totalSize, 4);
    bg.fill({ color: this.isWarden ? 0x5f0c0c : 0x3e2312 });

    // Main frame body
    bg.roundRect(2, 2, totalSize - 4, totalSize - 4, 3);
    bg.fill({ color: this.isWarden ? 0xb42a24 : 0xa36a43 });

    // Inner frame highlight
    bg.roundRect(2, 2, totalSize - 4, totalSize - 4, 3);
    bg.stroke({
      color: this.isWarden ? 0xf06a5d : 0xcd8e5e,
      alpha: this.isWarden ? 0.9 : 0.6,
      width: 2,
      alignment: 0,
    });

    // Very dark rim specifically around the map viewport
    bg.rect(MINIMAP_PADDING - 1, MINIMAP_PADDING - 1, MINIMAP_SIZE + 2, MINIMAP_SIZE + 2);
    bg.fill({ color: this.isWarden ? 0x3a0909 : 0x2a1608 });

    // Unexplored deep map background
    bg.rect(MINIMAP_PADDING, MINIMAP_PADDING, MINIMAP_SIZE, MINIMAP_SIZE);
    bg.fill({ color: 0x1d2119 });

    this.compactContainer.addChild(bg);

    // ── Map Mask & Scrolling Container ─────────────────────────────────
    const mask = new Graphics();
    mask.rect(MINIMAP_PADDING, MINIMAP_PADDING, MINIMAP_SIZE, MINIMAP_SIZE);
    mask.fill({ color: 0xffffff });
    this.compactContainer.addChild(mask);

    this.mapContainer = new Container();
    this.mapContainer.mask = mask;
    this.mapContainer.addChild(this.sprite);
    this.compactContainer.addChild(this.mapContainer);

    // ── Player Icon (Overlayed, fixed in the center) ───────────────────
    const playerMarker = new Graphics();
    playerMarker.circle(0, 0, 2); // Smaller radius (was 3)
    playerMarker.fill({ color: 0xffcc00 }); // Vibrant Gold
    playerMarker.stroke({ color: 0x884400, width: 1 }); // Deep outline
    playerMarker.x = MINIMAP_PADDING + MINIMAP_SIZE / 2;
    playerMarker.y = MINIMAP_PADDING + MINIMAP_SIZE / 2;
    this.compactContainer.addChild(playerMarker);

    if (this.isWarden) {
      const expandButton = this.createMapToggleButton(
        false,
        this.expandButtonTexture,
        () => this.setExpanded(true),
      );
      expandButton.x = totalSize - MAP_TOGGLE_SIZE + MAP_TOGGLE_OVERLAP;
      expandButton.y = -MAP_TOGGLE_OVERLAP;
      this.compactContainer.addChild(expandButton);
    }

    // Position entire widget at bottom-right
    this.compactContainer.x = internalWidth - totalSize - MINIMAP_MARGIN;
    this.compactContainer.y = internalHeight - totalSize - MINIMAP_MARGIN;

    if (this.isWarden) {
      this.compactContainer.eventMode = 'static';
      this.compactContainer.cursor = 'pointer';
      this.compactContainer.hitArea = new Rectangle(
        -MAP_TOGGLE_OVERLAP,
        -MAP_TOGGLE_OVERLAP,
        totalSize + MAP_TOGGLE_OVERLAP * 2,
        totalSize + MAP_TOGGLE_OVERLAP * 2,
      );
      this.compactContainer.on('pointertap', (event) => {
        event.stopPropagation();
        this.markCanvasClickHandled();
        this.setExpanded(true);
      });

      this.expandedOverlay = this.createExpandedOverlay(internalWidth, internalHeight);
      this.container.addChild(this.expandedOverlay);
    }
  }

  // ── Public API ────────────────────────────────────────────────────────

  /** Attach the minimap to the PixiJS stage. */
  addToStage(stage: Container): void {
    stage.addChild(this.container);
  }

  /** Whether the fixed whole-maze warden overlay is currently open. */
  isExpanded(): boolean {
    return this.expanded;
  }

  /** Close the whole-maze overlay if it is open. */
  closeExpanded(): void {
    this.setExpanded(false);
  }

  /** Prevent the debug canvas click handler from acting on minimap interactions. */
  shouldBlockCanvasClick(): boolean {
    if (!this.expanded && !this.suppressCanvasClick) return false;
    this.suppressCanvasClick = false;
    return true;
  }

  /** Set the portal position and expose it on the warden's full map. */
  setPortalPosition(pixelX: number, pixelY: number): void {
    this.portalTileX = Math.floor(pixelX / this.mapData.tileSize);
    this.portalTileY = Math.floor(pixelY / this.mapData.tileSize);
    this.portalMarked = true;
    this.updateExpandedPortalMarker();
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

      if (!this.isWarden) this.revealAround(ptx, pty);
      this.redrawCanvas(ptx, pty);

      this.ctx.putImageData(this.imageData, 0, 0);
      this.texture.source.update();
    }

    // Smooth map scrolling (Calculates sub-tile fractional movement)
    const fracX = (playerPixelX % ts) / ts;
    const fracY = (playerPixelY % ts) / ts;

    const viewportCenterX = MINIMAP_PADDING + MINIMAP_SIZE / 2;
    const viewportCenterY = MINIMAP_PADDING + MINIMAP_SIZE / 2;

    const spriteCenterPixelX = Math.floor(CANVAS_SIZE / 2) * SCALE + fracX * SCALE;
    const spriteCenterPixelY = Math.floor(CANVAS_SIZE / 2) * SCALE + fracY * SCALE;

    // Dynamically shift the rendered texture around underneath the UI mask
    this.sprite.x = viewportCenterX - spriteCenterPixelX;
    this.sprite.y = viewportCenterY - spriteCenterPixelY;

    if (this.expandedPlayerMarker) {
      this.expandedPlayerMarker.x =
        EXPANDED_PADDING + (playerPixelX / this.mapData.tileSize) * this.expandedMapScale;
      this.expandedPlayerMarker.y =
        EXPANDED_PADDING + (playerPixelY / this.mapData.tileSize) * this.expandedMapScale;
    }
  }

  /** Remove from stage and free resources. */
  destroy(): void {
    if (this.expanded) this.onExpandedChange?.(false);
    this.container.parent?.removeChild(this.container);
    this.container.destroy({ children: true });
    this.texture.destroy(true);
    this.expandedTexture?.destroy(true);
  }

  // ── Canvas rendering ──────────────────────────────────────────────────

  /**
   * Stamp the authored water channel and central stone walkway into a
   * tile-sized lookup shared by the compact and expanded map renderers.
   */
  private createBridgeMask(bridges: readonly BridgePlacement[]): Uint8Array {
    const mask = new Uint8Array(this.mapData.width * this.mapData.height);

    const stampRect = (
      startX: number,
      startY: number,
      width: number,
      height: number,
      value: number,
    ): void => {
      for (let y = startY; y < startY + height; y++) {
        if (y < 0 || y >= this.mapData.height) continue;
        for (let x = startX; x < startX + width; x++) {
          if (x < 0 || x >= this.mapData.width) continue;
          mask[y * this.mapData.width + x] = value;
        }
      }
    };

    for (const bridge of bridges) {
      // The prefab's water spans x=0..5 and y=3..8 relative to its anchor.
      stampRect(bridge.tileX, bridge.tileY + 3, 6, 6, 1);
      // Its two-column stone path spans x=2..3 and intersects tile rows 2..8.
      stampRect(bridge.tileX + 2, bridge.tileY + 2, 2, 7, 2);
    }

    return mask;
  }

  /** Build a screen-fitted, non-player-centered view of the complete maze. */
  private createExpandedOverlay(
    internalWidth: number,
    internalHeight: number,
  ): Container {
    this.expandedCanvas = document.createElement('canvas');
    this.expandedCanvas.width = this.mapData.width;
    this.expandedCanvas.height = this.mapData.height;
    this.expandedCtx = this.expandedCanvas.getContext('2d')!;
    this.expandedCtx.imageSmoothingEnabled = false;
    this.expandedImageData = this.expandedCtx.createImageData(
      this.mapData.width,
      this.mapData.height,
    );
    this.expandedPixels = this.expandedImageData.data;
    this.redrawExpandedCanvas();

    this.expandedTexture = Texture.from(this.expandedCanvas);
    this.expandedTexture.source.scaleMode = 'nearest';
    const mapSprite = new Sprite(this.expandedTexture);

    const maxMapWidth = internalWidth - (EXPANDED_MARGIN + EXPANDED_PADDING) * 2;
    const maxMapHeight = internalHeight - (EXPANDED_MARGIN + EXPANDED_PADDING) * 2;
    const mapScale = Math.min(
      1,
      maxMapWidth / this.mapData.width,
      maxMapHeight / this.mapData.height,
    );
    this.expandedMapScale = mapScale;
    mapSprite.scale.set(mapScale);
    mapSprite.x = EXPANDED_PADDING;
    mapSprite.y = EXPANDED_PADDING;

    const displayedWidth = this.mapData.width * mapScale;
    const displayedHeight = this.mapData.height * mapScale;
    const panelWidth = displayedWidth + EXPANDED_PADDING * 2;
    const panelHeight = displayedHeight + EXPANDED_PADDING * 2;

    const overlay = new Container();
    overlay.visible = false;

    const backdrop = new Graphics();
    backdrop.rect(0, 0, internalWidth, internalHeight);
    backdrop.fill({ color: 0x050000, alpha: 0.72 });
    backdrop.eventMode = 'static';
    backdrop.cursor = 'pointer';
    backdrop.on('pointertap', (event) => {
      event.stopPropagation();
      this.markCanvasClickHandled();
      this.setExpanded(false);
    });
    overlay.addChild(backdrop);

    const panel = new Container();
    panel.x = Math.round((internalWidth - panelWidth) / 2);
    panel.y = Math.round((internalHeight - panelHeight) / 2);
    panel.eventMode = 'static';
    panel.cursor = 'pointer';
    panel.hitArea = new Rectangle(0, 0, panelWidth, panelHeight);
    panel.on('pointertap', (event) => {
      event.stopPropagation();
      this.markCanvasClickHandled();
      this.setExpanded(false);
    });

    const frame = new Graphics();
    frame.roundRect(0, 0, panelWidth, panelHeight, 4);
    frame.fill({ color: 0xa82520, alpha: 0.98 });
    frame.roundRect(1, 1, panelWidth - 2, panelHeight - 2, 3);
    frame.stroke({ color: 0xf06a5d, alpha: 0.95, width: 1, alignment: 0 });
    panel.addChild(frame);
    panel.addChild(mapSprite);

    this.expandedPortalMarker = new Graphics();
    this.expandedPortalMarker.poly([0, -3, 3, 0, 0, 3, -3, 0]);
    this.expandedPortalMarker.fill({ color: 0x00f2ff });
    this.expandedPortalMarker.stroke({ color: 0xffffff, alpha: 1, width: 1 });
    this.expandedPortalMarker.visible = false;
    panel.addChild(this.expandedPortalMarker);
    this.updateExpandedPortalMarker();

    this.expandedPlayerMarker = new Graphics();
    this.expandedPlayerMarker.circle(0, 0, 2);
    this.expandedPlayerMarker.fill({ color: 0xffd43b });
    this.expandedPlayerMarker.stroke({ color: 0x6b2f00, alpha: 1, width: 1 });
    panel.addChild(this.expandedPlayerMarker);

    const contractButton = this.createMapToggleButton(
      true,
      this.contractButtonTexture,
      () => this.setExpanded(false),
    );
    contractButton.x = panelWidth - MAP_TOGGLE_SIZE + MAP_TOGGLE_OVERLAP;
    contractButton.y = -MAP_TOGGLE_OVERLAP;
    panel.addChild(contractButton);
    overlay.addChild(panel);

    return overlay;
  }

  private updateExpandedPortalMarker(): void {
    if (!this.expandedPortalMarker) return;

    this.expandedPortalMarker.visible = this.portalMarked;
    if (!this.portalMarked) return;

    this.expandedPortalMarker.x =
      EXPANDED_PADDING + (this.portalTileX + 0.5) * this.expandedMapScale;
    this.expandedPortalMarker.y =
      EXPANDED_PADDING + (this.portalTileY + 0.5) * this.expandedMapScale;
  }

  private setExpanded(expanded: boolean): void {
    if (!this.isWarden || !this.expandedOverlay || this.expanded === expanded) return;

    this.expanded = expanded;
    this.expandedOverlay.visible = expanded;
    this.compactContainer.visible = !expanded;

    if (expanded) {
      // Gate tiles can change during play, so refresh the layout every time it opens.
      this.redrawExpandedCanvas();
      this.expandedTexture?.source.update();
      // Keep the modal above other HUD elements created after the minimap.
      this.container.parent?.addChild(this.container);
    }

    this.onExpandedChange?.(expanded);
  }

  private markCanvasClickHandled(): void {
    this.suppressCanvasClick = true;
    setTimeout(() => {
      this.suppressCanvasClick = false;
    }, 0);
  }

  /** Wooden corner button with outward expand or inward contract arrows. */
  private createMapToggleButton(
    contract: boolean,
    buttonTexture: Texture | null,
    onToggle: () => void,
  ): Container {
    const button = new Container();
    button.eventMode = 'static';
    button.cursor = 'pointer';
    button.hitArea = new Rectangle(0, 0, MAP_TOGGLE_SIZE, MAP_TOGGLE_SIZE);

    if (buttonTexture) {
      const sprite = new Sprite(buttonTexture);
      sprite.width = MAP_TOGGLE_SIZE;
      sprite.height = MAP_TOGGLE_SIZE;
      button.addChild(sprite);
    } else {
      const frame = new Graphics();
      frame.roundRect(2, 2, MAP_TOGGLE_SIZE, MAP_TOGGLE_SIZE, 3);
      frame.fill({ color: 0x160b08, alpha: 0.55 });
      frame.roundRect(0, 0, MAP_TOGGLE_SIZE, MAP_TOGGLE_SIZE, 3);
      frame.fill({ color: 0x3a2115 });
      frame.roundRect(2, 2, MAP_TOGGLE_SIZE - 4, MAP_TOGGLE_SIZE - 4, 2);
      frame.fill({ color: 0x725039 });
      frame.roundRect(2, 2, MAP_TOGGLE_SIZE - 4, MAP_TOGGLE_SIZE - 4, 2);
      frame.stroke({ color: 0xb77b50, alpha: 0.75, width: 1, alignment: 0 });
      button.addChild(frame);

      const glyph = new Graphics();
      const arrowColor = 0xe3cfaa;
      const drawPath = (points: ReadonlyArray<readonly [number, number]>): void => {
        glyph.moveTo(points[0][0], points[0][1]);
        for (let i = 1; i < points.length; i++) glyph.lineTo(points[i][0], points[i][1]);
        glyph.stroke({ color: arrowColor, width: 1.75, cap: 'square', join: 'miter' });
      };

      if (contract) {
        drawPath([
          [3.5, 3.5],
          [7.5, 7.5],
          [7.5, 4.5],
        ]);
        drawPath([
          [7.5, 7.5],
          [4.5, 7.5],
        ]);
        drawPath([
          [14.5, 3.5],
          [10.5, 7.5],
          [13.5, 7.5],
        ]);
        drawPath([
          [10.5, 7.5],
          [10.5, 4.5],
        ]);
        drawPath([
          [3.5, 14.5],
          [7.5, 10.5],
          [4.5, 10.5],
        ]);
        drawPath([
          [7.5, 10.5],
          [7.5, 13.5],
        ]);
        drawPath([
          [14.5, 14.5],
          [10.5, 10.5],
          [10.5, 13.5],
        ]);
        drawPath([
          [10.5, 10.5],
          [13.5, 10.5],
        ]);
      } else {
        drawPath([
          [7.5, 7.5],
          [3.5, 3.5],
          [7.5, 3.5],
        ]);
        drawPath([
          [3.5, 3.5],
          [3.5, 7.5],
        ]);
        drawPath([
          [10.5, 7.5],
          [14.5, 3.5],
          [10.5, 3.5],
        ]);
        drawPath([
          [14.5, 3.5],
          [14.5, 7.5],
        ]);
        drawPath([
          [7.5, 10.5],
          [3.5, 14.5],
          [7.5, 14.5],
        ]);
        drawPath([
          [3.5, 14.5],
          [3.5, 10.5],
        ]);
        drawPath([
          [10.5, 10.5],
          [14.5, 14.5],
          [10.5, 14.5],
        ]);
        drawPath([
          [14.5, 14.5],
          [14.5, 10.5],
        ]);
      }
      button.addChild(glyph);
    }

    button.on('pointertap', (event) => {
      event.stopPropagation();
      this.markCanvasClickHandled();
      onToggle();
    });

    return button;
  }

  /** Render every maze tile without fog or entity/objective markers. */
  private redrawExpandedCanvas(): void {
    if (!this.expandedPixels || !this.expandedImageData || !this.expandedCtx) return;

    const { width, height, data } = this.mapData;
    for (let tileIndex = 0; tileIndex < width * height; tileIndex++) {
      const col = this.tileColor(tileIndex, data[tileIndex]);
      const pixelIndex = tileIndex * 4;
      this.expandedPixels[pixelIndex] = col[0];
      this.expandedPixels[pixelIndex + 1] = col[1];
      this.expandedPixels[pixelIndex + 2] = col[2];
      this.expandedPixels[pixelIndex + 3] = col[3];
    }

    this.expandedCtx.putImageData(this.expandedImageData, 0, 0);
  }

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
            if (this.portalMarked) {
              const dx = Math.abs(tx - this.portalTileX);
              const dy = Math.abs(ty - this.portalTileY);

              if (dx === 0 && dy === 0) {
                col = COL_PORTAL_GLOW; // center
              } else if (dx + dy === 1) {
                col = COL_PORTAL; // diamond edges
              } else {
                col = this.tileColor(fogIdx, data[fogIdx]);
              }
            } else {
              col = this.tileColor(fogIdx, data[fogIdx]);
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
  private tileColor(tileIndex: number, id: number): readonly number[] {
    if (this.bridgeMask[tileIndex] === 2) return COL_BRIDGE_STONE;
    if (this.bridgeMask[tileIndex] === 1) return COL_BRIDGE_WATER;

    const isGroundTile =
      id === TILE_FLOOR ||
      id === TILE_FLOOR_SHADOW ||
      id === TILE_GATE_HORIZONTAL ||
      id === TILE_GATE_VERTICAL;

    if (isGroundTile && this.dirtMask[tileIndex] === 1) return COL_DIRT;
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
