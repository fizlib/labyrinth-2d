// packages/client/src/assets/FallbackTextures.ts
// ─────────────────────────────────────────────────────────────────────────────
// Procedural fallback texture generator.
// Creates simple pixel-art textures in-memory using an offscreen <canvas>
// so the game never crashes even without real PNG assets.
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

// ── Wall Texture (16×16 brick) ──────────────────────────────────────────────

export function generateWallTexture(): Texture {
  const [canvas, ctx] = makeCanvas(TILE, TILE);

  // Base color
  ctx.fillStyle = '#4a4a68';
  ctx.fillRect(0, 0, TILE, TILE);

  // Brick mortar lines (horizontal)
  ctx.fillStyle = '#2e2e42';
  ctx.fillRect(0, 3, TILE, 1);
  ctx.fillRect(0, 7, TILE, 1);
  ctx.fillRect(0, 11, TILE, 1);
  ctx.fillRect(0, 15, TILE, 1);

  // Vertical mortar (offset every other row)
  ctx.fillRect(4, 0, 1, 3);
  ctx.fillRect(12, 0, 1, 3);
  ctx.fillRect(0, 4, 1, 3);
  ctx.fillRect(8, 4, 1, 3);
  ctx.fillRect(4, 8, 1, 3);
  ctx.fillRect(12, 8, 1, 3);
  ctx.fillRect(0, 12, 1, 3);
  ctx.fillRect(8, 12, 1, 3);

  // Slight highlight on top-left edges of bricks
  ctx.fillStyle = '#5a5a7a';
  ctx.fillRect(1, 0, 3, 1);
  ctx.fillRect(5, 0, 7, 1);
  ctx.fillRect(13, 0, 3, 1);
  ctx.fillRect(1, 4, 7, 1);
  ctx.fillRect(9, 4, 3, 1);

  return canvasToTexture(canvas);
}

// ── Floor Texture (16×16 stone) ─────────────────────────────────────────────

export function generateFloorTexture(): Texture {
  const [canvas, ctx] = makeCanvas(TILE, TILE);

  // Dark stone base
  ctx.fillStyle = '#1e1e32';
  ctx.fillRect(0, 0, TILE, TILE);

  // Subtle grid/grout lines
  ctx.fillStyle = '#171729';
  ctx.fillRect(0, 0, TILE, 1);
  ctx.fillRect(0, 0, 1, TILE);

  // Add sparse noise speckles for texture
  const speckles = [
    [3, 5], [7, 2], [11, 9], [14, 6],
    [2, 12], [9, 13], [6, 8], [13, 3],
  ];
  ctx.fillStyle = '#242440';
  for (const [sx, sy] of speckles) {
    setPixel(ctx, sx, sy, '#242440');
  }

  return canvasToTexture(canvas);
}

// ── Player Spritesheet (64×128 — 4 cols × 4 rows, each frame 16×32) ────────
// Layout: 4 directions × 2 frames (idle + walk step)
// Row 0: walk-down  frame 0, walk-down  frame 1, idle-down  frame 0, idle-down  frame 1
// Row 1: walk-left  frame 0, walk-left  frame 1, idle-left  frame 0, idle-left  frame 1
// Row 2: walk-right frame 0, walk-right frame 1, idle-right frame 0, idle-right frame 1
// Row 3: walk-up    frame 0, walk-up    frame 1, idle-up    frame 0, idle-up    frame 1

const FRAME_W = 16;
const FRAME_H = 32;
const SHEET_COLS = 4;
const SHEET_ROWS = 4;

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
      const isWalk = col < 2;
      const frameIdx = col % 2;
      drawCharacter(ctx, ox, oy, dir, isWalk, frameIdx);
    }
  }

  const sheetTexture = canvasToTexture(canvas);

  // Slice into individual frame textures
  const animations: Record<string, Texture[]> = {};

  for (let row = 0; row < SHEET_ROWS; row++) {
    const dir = DIR_ORDER[row];

    // Walk frames: col 0, 1
    const walkFrames: Texture[] = [];
    for (let col = 0; col < 2; col++) {
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

    // Idle frames: col 2, 3 (we use just col 2 as a static idle, col 3 as subtle shift)
    const idleFrames: Texture[] = [];
    for (let col = 2; col < 4; col++) {
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
