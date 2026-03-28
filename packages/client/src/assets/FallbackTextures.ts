// packages/client/src/assets/FallbackTextures.ts
// ─────────────────────────────────────────────────────────────────────────────
// Procedural fallback texture generator.
// Creates simple pixel-art textures in-memory using an offscreen <canvas>
// so the game never crashes even without real PNG assets.
//
// Step 9: 4 tile types — grass, dirt, cliff face, cliff top.
// ─────────────────────────────────────────────────────────────────────────────

import { Texture, Rectangle } from 'pixi.js';

const TILE = 16;

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  return [c, ctx];
}

function canvasToTexture(canvas: HTMLCanvasElement): Texture {
  const tex = Texture.from(canvas);
  tex.source.scaleMode = 'nearest';
  return tex;
}

function setPixel(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, 1, 1);
}

// ── Grass Texture (16×16) ───────────────────────────────────────────────────

export function generateGrassTexture(): Texture {
  const [canvas, ctx] = makeCanvas(TILE, TILE);

  // Lush green base
  ctx.fillStyle = '#3a7a2a';
  ctx.fillRect(0, 0, TILE, TILE);

  // Subtle variation patches
  ctx.fillStyle = '#327222';
  ctx.fillRect(2, 3, 4, 3);
  ctx.fillRect(10, 8, 3, 4);
  ctx.fillRect(6, 12, 5, 2);

  // Lighter highlights
  ctx.fillStyle = '#4a8a3a';
  ctx.fillRect(8, 1, 3, 2);
  ctx.fillRect(1, 9, 2, 3);
  ctx.fillRect(12, 5, 2, 2);

  // Tiny grass blade details
  const blades = [
    [4, 1], [7, 5], [13, 3], [2, 7],
    [9, 11], [14, 13], [1, 14], [11, 14],
  ];
  for (const [bx, by] of blades) {
    setPixel(ctx, bx, by, '#4e9e3e');
  }

  return canvasToTexture(canvas);
}

// ── Dirt Texture (16×16) ────────────────────────────────────────────────────

export function generateDirtTexture(): Texture {
  const [canvas, ctx] = makeCanvas(TILE, TILE);

  // Brown-tan base
  ctx.fillStyle = '#7a6a42';
  ctx.fillRect(0, 0, TILE, TILE);

  // Darker patches
  ctx.fillStyle = '#6a5a32';
  ctx.fillRect(3, 2, 4, 3);
  ctx.fillRect(9, 7, 5, 3);
  ctx.fillRect(1, 11, 3, 3);

  // Lighter sandy highlights
  ctx.fillStyle = '#8a7a52';
  ctx.fillRect(7, 0, 3, 2);
  ctx.fillRect(12, 4, 2, 3);
  ctx.fillRect(5, 13, 4, 2);

  // Small pebbles/speckles
  const pebbles = [
    [2, 5], [6, 8], [11, 2], [14, 10],
    [4, 14], [8, 4], [13, 13], [0, 8],
  ];
  for (const [px, py] of pebbles) {
    setPixel(ctx, px, py, '#5a4a2a');
  }

  return canvasToTexture(canvas);
}

// ── Cliff Face Texture (16×16 rocky wall) ───────────────────────────────────

export function generateCliffFaceTexture(): Texture {
  const [canvas, ctx] = makeCanvas(TILE, TILE);

  // Dark rock base
  ctx.fillStyle = '#4a4a58';
  ctx.fillRect(0, 0, TILE, TILE);

  // Horizontal cracks/strata
  ctx.fillStyle = '#3a3a48';
  ctx.fillRect(0, 3, TILE, 1);
  ctx.fillRect(0, 7, TILE, 1);
  ctx.fillRect(0, 11, TILE, 1);
  ctx.fillRect(0, 15, TILE, 1);

  // Vertical cracks (offset per row for brick-like pattern)
  ctx.fillRect(5, 0, 1, 3);
  ctx.fillRect(11, 0, 1, 3);
  ctx.fillRect(2, 4, 1, 3);
  ctx.fillRect(8, 4, 1, 3);
  ctx.fillRect(14, 4, 1, 3);
  ctx.fillRect(5, 8, 1, 3);
  ctx.fillRect(11, 8, 1, 3);
  ctx.fillRect(2, 12, 1, 3);
  ctx.fillRect(8, 12, 1, 3);
  ctx.fillRect(14, 12, 1, 3);

  // Top highlight (slight light from above, 2.5D style)
  ctx.fillStyle = '#5a5a6a';
  ctx.fillRect(0, 0, TILE, 1);

  // Bottom shadow
  ctx.fillStyle = '#2e2e3e';
  ctx.fillRect(0, 15, TILE, 1);

  return canvasToTexture(canvas);
}

// ── Cliff Body Texture (16×16 dark interior wall) ───────────────────────────

export function generateCliffBodyTexture(): Texture {
  const [canvas, ctx] = makeCanvas(TILE, TILE);

  // Very dark rock — this is the shadowed interior / non-south-facing wall
  ctx.fillStyle = '#2a2a38';
  ctx.fillRect(0, 0, TILE, TILE);

  // Subtle horizontal strata (barely visible)
  ctx.fillStyle = '#242432';
  ctx.fillRect(0, 4, TILE, 1);
  ctx.fillRect(0, 9, TILE, 1);
  ctx.fillRect(0, 14, TILE, 1);

  // A few darker speckles for texture
  const speckles = [
    [3, 2], [10, 6], [7, 11], [13, 3],
    [1, 8], [14, 13], [5, 15], [9, 1],
  ];
  for (const [sx, sy] of speckles) {
    setPixel(ctx, sx, sy, '#1e1e2e');
  }

  return canvasToTexture(canvas);
}

// ── Cliff Top Texture (16×16 grassy overhang) ──────────────────────────────

export function generateCliffTopTexture(): Texture {
  const [canvas, ctx] = makeCanvas(TILE, TILE);

  // Upper portion: grass (the top of the cliff)
  ctx.fillStyle = '#2a6a1a';
  ctx.fillRect(0, 0, TILE, 10);

  // Lower portion: cliff edge shadow (hanging down)
  ctx.fillStyle = '#3a3a48';
  ctx.fillRect(0, 10, TILE, 6);

  // Grass-to-rock transition with irregular edge
  ctx.fillStyle = '#2a6a1a';
  // Irregular grass draping down
  ctx.fillRect(0, 10, 3, 2);
  ctx.fillRect(5, 10, 2, 3);
  ctx.fillRect(9, 10, 3, 2);
  ctx.fillRect(14, 10, 2, 3);

  // Highlight on grass
  ctx.fillStyle = '#3a7a2a';
  ctx.fillRect(2, 1, 4, 2);
  ctx.fillRect(8, 3, 5, 2);
  ctx.fillRect(1, 6, 3, 2);
  ctx.fillRect(11, 7, 4, 2);

  // Shadow beneath overhang
  ctx.fillStyle = '#2a2a3a';
  ctx.fillRect(0, 14, TILE, 2);

  // Tiny vine details hanging from edge
  setPixel(ctx, 3, 12, '#1a5a0a');
  setPixel(ctx, 3, 13, '#1a5a0a');
  setPixel(ctx, 10, 12, '#1a5a0a');
  setPixel(ctx, 10, 13, '#1a5a0a');

  return canvasToTexture(canvas);
}

// ── Cliff Bottom Edge Texture (16×16) ───────────────────────────────────────

export function generateCliffBottomTexture(): Texture {
  const [canvas, ctx] = makeCanvas(TILE, TILE);

  // Dark rock base (same family as cliff body)
  ctx.fillStyle = '#2a2a38';
  ctx.fillRect(0, 0, TILE, TILE);

  // Bottom edge highlight — lighter strip at bottom to mark the edge
  ctx.fillStyle = '#4a4a58';
  ctx.fillRect(0, 13, TILE, 3);

  // Subtle strata
  ctx.fillStyle = '#242432';
  ctx.fillRect(0, 4, TILE, 1);
  ctx.fillRect(0, 9, TILE, 1);

  // Edge detail
  ctx.fillStyle = '#5a5a6a';
  ctx.fillRect(0, 15, TILE, 1);

  return canvasToTexture(canvas);
}

// ── Cliff Top Edge Texture (16×16 rock rim, NOT the grassy overhang) ────────

export function generateTopEdgeTexture(): Texture {
  const [canvas, ctx] = makeCanvas(TILE, TILE);

  // Dark rock base (same family as cliff body)
  ctx.fillStyle = '#2a2a38';
  ctx.fillRect(0, 0, TILE, TILE);

  // Top edge highlight — lighter strip at top to mark the rim
  ctx.fillStyle = '#4a4a58';
  ctx.fillRect(0, 0, TILE, 3);

  // Subtle strata
  ctx.fillStyle = '#242432';
  ctx.fillRect(0, 7, TILE, 1);
  ctx.fillRect(0, 12, TILE, 1);

  // Bright top edge detail
  ctx.fillStyle = '#5a5a6a';
  ctx.fillRect(0, 0, TILE, 1);

  return canvasToTexture(canvas);
}

// ── Corner Textures (16×16 each) ────────────────────────────────────────────

export function generateCornerTLTexture(): Texture {
  const [canvas, ctx] = makeCanvas(TILE, TILE);

  // Dark body base
  ctx.fillStyle = '#2a2a38';
  ctx.fillRect(0, 0, TILE, TILE);

  // Top edge highlight (like wall top)
  ctx.fillStyle = '#5a5a6a';
  ctx.fillRect(0, 0, TILE, 2);

  // Left edge highlight
  ctx.fillStyle = '#3a3a4a';
  ctx.fillRect(0, 0, 2, TILE);

  // Corner accent
  ctx.fillStyle = '#6a6a7a';
  ctx.fillRect(0, 0, 3, 3);

  return canvasToTexture(canvas);
}

export function generateCornerTRTexture(): Texture {
  const [canvas, ctx] = makeCanvas(TILE, TILE);

  ctx.fillStyle = '#2a2a38';
  ctx.fillRect(0, 0, TILE, TILE);

  // Top edge
  ctx.fillStyle = '#5a5a6a';
  ctx.fillRect(0, 0, TILE, 2);

  // Right edge
  ctx.fillStyle = '#3a3a4a';
  ctx.fillRect(14, 0, 2, TILE);

  // Corner accent
  ctx.fillStyle = '#6a6a7a';
  ctx.fillRect(13, 0, 3, 3);

  return canvasToTexture(canvas);
}

export function generateCornerBLTexture(): Texture {
  const [canvas, ctx] = makeCanvas(TILE, TILE);

  ctx.fillStyle = '#2a2a38';
  ctx.fillRect(0, 0, TILE, TILE);

  // Bottom edge
  ctx.fillStyle = '#4a4a58';
  ctx.fillRect(0, 14, TILE, 2);

  // Left edge
  ctx.fillStyle = '#3a3a4a';
  ctx.fillRect(0, 0, 2, TILE);

  // Corner accent
  ctx.fillStyle = '#5a5a6a';
  ctx.fillRect(0, 13, 3, 3);

  return canvasToTexture(canvas);
}

export function generateCornerBRTexture(): Texture {
  const [canvas, ctx] = makeCanvas(TILE, TILE);

  ctx.fillStyle = '#2a2a38';
  ctx.fillRect(0, 0, TILE, TILE);

  // Bottom edge
  ctx.fillStyle = '#4a4a58';
  ctx.fillRect(0, 14, TILE, 2);

  // Right edge
  ctx.fillStyle = '#3a3a4a';
  ctx.fillRect(14, 0, 2, TILE);

  // Corner accent
  ctx.fillStyle = '#5a5a6a';
  ctx.fillRect(13, 13, 3, 3);

  return canvasToTexture(canvas);
}

// ── Tree Texture (16×32 — tall sprite, anchored at bottom-center) ───────────

export function generateTreeTexture(): Texture {
  const TREE_W = 16;
  const TREE_H = 32;
  const [canvas, ctx] = makeCanvas(TREE_W, TREE_H);

  // Clear with transparency
  ctx.clearRect(0, 0, TREE_W, TREE_H);

  // Trunk (centered, 4px wide, 10px tall at bottom)
  ctx.fillStyle = '#5a3a1a';
  ctx.fillRect(6, 22, 4, 10);
  // Bark detail
  ctx.fillStyle = '#4a2a0a';
  ctx.fillRect(7, 24, 1, 6);
  ctx.fillStyle = '#6a4a2a';
  ctx.fillRect(9, 23, 1, 4);

  // Canopy — layered circles of green for a lush look
  // Bottom canopy layer (widest)
  ctx.fillStyle = '#1a5a0a';
  ctx.fillRect(1, 14, 14, 10);
  // Middle canopy layer
  ctx.fillStyle = '#2a7a1a';
  ctx.fillRect(2, 8, 12, 12);
  // Top canopy layer
  ctx.fillStyle = '#3a8a2a';
  ctx.fillRect(3, 4, 10, 10);
  // Crown
  ctx.fillStyle = '#4a9a3a';
  ctx.fillRect(5, 1, 6, 6);

  // Canopy highlights (sunlit spots)
  ctx.fillStyle = '#5aaa4a';
  ctx.fillRect(4, 6, 3, 3);
  ctx.fillRect(9, 3, 2, 3);
  ctx.fillRect(6, 11, 4, 2);

  // Canopy shadow details
  ctx.fillStyle = '#0a4a00';
  ctx.fillRect(3, 18, 3, 3);
  ctx.fillRect(10, 16, 3, 4);
  ctx.fillRect(6, 20, 2, 2);

  // Small highlight dots
  setPixel(ctx, 5, 2, '#6aba5a');
  setPixel(ctx, 11, 7, '#6aba5a');
  setPixel(ctx, 3, 12, '#5aaa4a');

  return canvasToTexture(canvas);
}

// ── Player Spritesheet (128×128 — 8 cols × 4 rows, each frame 16×32) ───────
// Layout: 4 directions × (6 walk frames + 2 idle frames)
// Cols 0-5: walk frames, Cols 6-7: idle frames
// Row 0: down, Row 1: left, Row 2: right, Row 3: up

const FRAME_W = 16;
const FRAME_H = 32;
const SHEET_COLS = 8;
const SHEET_ROWS = 4;
const WALK_COLS = 6;
const IDLE_START = 6;
const IDLE_COLS = 2;

interface EyePos { lx: number; ly: number; rx: number; ry: number }

const EYES: Record<string, EyePos> = {
  down:  { lx: 5, ly: 10, rx: 10, ry: 10 },
  left:  { lx: 3, ly: 10, rx: 6,  ry: 10 },
  right: { lx: 9, ly: 10, rx: 12, ry: 10 },
  up:    { lx: 5, ly: 9,  rx: 10, ry: 9  },
};

const DIR_ORDER = ['down', 'left', 'right', 'up'] as const;

function drawCharacter(
  ctx: CanvasRenderingContext2D,
  ox: number, oy: number,
  dir: string,
  isWalkFrame: boolean,
  frameIdx: number,
): void {
  // Body (centered on the frame's lower half)
  ctx.fillStyle = '#3a8a4a'; // green body
  ctx.fillRect(ox + 4, oy + 6, 8, 14); // torso

  // Head
  ctx.fillStyle = '#f0c08a'; // skin tone
  ctx.fillRect(ox + 4, oy + 2, 8, 8);

  // Hair (top of head)
  ctx.fillStyle = '#5a3a1a';
  ctx.fillRect(ox + 4, oy + 1, 8, 3);

  // Eyes
  const eyes = EYES[dir];
  if (dir !== 'up') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(ox + eyes.lx, oy + eyes.ly, 2, 2);
    ctx.fillRect(ox + eyes.rx, oy + eyes.ry, 2, 2);
    // Pupils
    ctx.fillStyle = '#1a1a2e';
    setPixel(ctx, ox + eyes.lx + (dir === 'left' ? 0 : 1), oy + eyes.ly + 1, '#1a1a2e');
    setPixel(ctx, ox + eyes.rx + (dir === 'left' ? 0 : 1), oy + eyes.ry + 1, '#1a1a2e');
  } else {
    // Back of head — just hair, no eyes
    ctx.fillStyle = '#5a3a1a';
    ctx.fillRect(ox + 4, oy + 4, 8, 4);
  }

  // Legs
  ctx.fillStyle = '#2a2a5a'; // dark pants
  const legOffset = isWalkFrame ? (frameIdx === 0 ? 1 : -1) : 0;
  // Left leg
  ctx.fillRect(ox + 5 + legOffset, oy + 20, 3, 10);
  // Right leg
  ctx.fillRect(ox + 8 - legOffset, oy + 20, 3, 10);

  // Feet
  ctx.fillStyle = '#4a2a1a';
  ctx.fillRect(ox + 5 + legOffset, oy + 29, 3, 2);
  ctx.fillRect(ox + 8 - legOffset, oy + 29, 3, 2);
}

export function generatePlayerSpritesheet(): {
  texture: Texture;
  animations: Record<string, Texture[]>;
} {
  const w = SHEET_COLS * FRAME_W;
  const h = SHEET_ROWS * FRAME_H;
  const [canvas, ctx] = makeCanvas(w, h);

  // Clear with transparency
  ctx.clearRect(0, 0, w, h);

  // Draw all frames
  for (let row = 0; row < SHEET_ROWS; row++) {
    const dir = DIR_ORDER[row];
    for (let col = 0; col < SHEET_COLS; col++) {
      const ox = col * FRAME_W;
      const oy = row * FRAME_H;
      const isWalk = col < WALK_COLS;
      const frameIdx = col % WALK_COLS;
      drawCharacter(ctx, ox, oy, dir, isWalk, frameIdx);
    }
  }

  const sheetTexture = canvasToTexture(canvas);

  // Slice into individual frame textures
  const animations: Record<string, Texture[]> = {};

  for (let row = 0; row < SHEET_ROWS; row++) {
    const dir = DIR_ORDER[row];

    // Walk frames: cols 0–5
    const walkFrames: Texture[] = [];
    for (let col = 0; col < WALK_COLS; col++) {
      const frame = new Texture({
        source: sheetTexture.source,
        frame: new Rectangle(
          col * FRAME_W,
          row * FRAME_H,
          FRAME_W,
          FRAME_H,
        ),
      });
      walkFrames.push(frame);
    }
    animations[`walk-${dir}`] = walkFrames;

    // Idle frames: cols 6–7
    const idleFrames: Texture[] = [];
    for (let col = IDLE_START; col < IDLE_START + IDLE_COLS; col++) {
      const frame = new Texture({
        source: sheetTexture.source,
        frame: new Rectangle(
          col * FRAME_W,
          row * FRAME_H,
          FRAME_W,
          FRAME_H,
        ),
      });
      idleFrames.push(frame);
    }
    animations[`idle-${dir}`] = idleFrames;
  }

  return { texture: sheetTexture, animations };
}
