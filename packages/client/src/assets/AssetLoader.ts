// packages/client/src/assets/AssetLoader.ts
// ─────────────────────────────────────────────────────────────────────────────
// Asset loader with fallback support.
// Attempts to load real PNG assets; if they fail, uses procedurally generated
// textures from FallbackTextures.ts so the game always works.
//
// Step 9: 5 tile textures — floor, floor shadow, wall face, wall top, wall interior.
// ─────────────────────────────────────────────────────────────────────────────

import { Assets, Texture, Rectangle } from 'pixi.js';
import {
  generateGrassTexture,
  generateDirtTexture,
  generateCliffFaceTexture,
  generateCliffBodyTexture,
  generateCliffTopTexture,
  generateCliffBottomTexture,
  generateCornerTLTexture,
  generateCornerTRTexture,
  generateCornerBLTexture,
  generateCornerBRTexture,
  generateTopEdgeTexture,
  generateTreeTexture,
  generatePlayerSpritesheet,
  generateShadowTopTexture,
  generateShadowLeftTexture,
  generateShadowCornerTexture,
} from './FallbackTextures';

export interface GameAssets {
  floorTexture: Texture;
  floorShadowTexture: Texture;
  wallFaceTexture: Texture;
  wallTopTexture: Texture;
  wallInteriorTexture: Texture;
  wallSideLeftTexture: Texture;
  wallSideRightTexture: Texture;
  wallBottomTexture: Texture;
  wallCornerTLTexture: Texture;
  wallCornerTRTexture: Texture;
  wallCornerBLTexture: Texture;
  wallCornerBRTexture: Texture;
  wallTopEdgeTexture: Texture;
  /** 4 grass variant textures: [0-1] plain grass, [2-3] flower grass (rarer). */
  grassVariantTextures: Texture[];
  treeTexture: Texture;
  /** Shadow overlay for tiles directly below a north wall. */
  shadowTopTexture: Texture;
  /** Shadow overlay for tiles directly right of a west wall. */
  shadowLeftTexture: Texture;
  /** Shadow overlay for inner corner tiles (below wall AND right of wall). */
  shadowCornerTexture: Texture;
  /** Per-team animation sets. Access via playerAnimationSets[teamId]. */
  playerAnimationSets: Record<string, Texture[]>[];
  /** Runestone textures: 3 pairs of [inactive, active]. Access via runestoneTextures[index][0|1]. */
  runestoneTextures: [Texture, Texture][];
}

export async function loadAssets(): Promise<GameAssets> {
  let floorTexture: Texture;
  let floorShadowTexture: Texture;
  let wallFaceTexture: Texture;
  let wallTopTexture: Texture;
  let wallInteriorTexture: Texture;
  let wallSideLeftTexture: Texture;
  let wallSideRightTexture: Texture;
  let wallBottomTexture: Texture;
  let wallCornerTLTexture: Texture;
  let wallCornerTRTexture: Texture;
  let wallCornerBLTexture: Texture;
  let wallCornerBRTexture: Texture;
  let wallTopEdgeTexture: Texture;
  let grassVariantTextures: Texture[] = [];
  let treeTexture: Texture;
  let shadowTopTexture: Texture;
  let shadowLeftTexture: Texture;
  let shadowCornerTexture: Texture;
  const playerAnimationSets: Record<string, Texture[]>[] = [];
  let runestoneTextures: [Texture, Texture][] = [];

  try {
    const tilesheet = await Assets.load<Texture>('assets/tiles.png');
    tilesheet.source.scaleMode = 'nearest';

    floorTexture = new Texture({ source: tilesheet.source, frame: new Rectangle(0, 0, 16, 16) });
    floorShadowTexture = new Texture({ source: tilesheet.source, frame: new Rectangle(16, 0, 16, 16) });
    wallFaceTexture = new Texture({ source: tilesheet.source, frame: new Rectangle(32, 0, 16, 16) });
    wallTopTexture = new Texture({ source: tilesheet.source, frame: new Rectangle(48, 0, 16, 16) });
    wallInteriorTexture = new Texture({ source: tilesheet.source, frame: new Rectangle(64, 0, 16, 16) });
    wallSideLeftTexture = new Texture({ source: tilesheet.source, frame: new Rectangle(80, 0, 16, 16) });
    wallSideRightTexture = new Texture({ source: tilesheet.source, frame: new Rectangle(96, 0, 16, 16) });
    wallBottomTexture = new Texture({ source: tilesheet.source, frame: new Rectangle(112, 0, 16, 16) });
    wallCornerTLTexture = new Texture({ source: tilesheet.source, frame: new Rectangle(128, 0, 16, 16) });
    wallCornerTRTexture = new Texture({ source: tilesheet.source, frame: new Rectangle(144, 0, 16, 16) });
    wallCornerBLTexture = new Texture({ source: tilesheet.source, frame: new Rectangle(160, 0, 16, 16) });
    wallCornerBRTexture = new Texture({ source: tilesheet.source, frame: new Rectangle(176, 0, 16, 16) });
    wallTopEdgeTexture = new Texture({ source: tilesheet.source, frame: new Rectangle(192, 0, 16, 16) });

    // 4 grass variant textures at positions 13–16 (208–272 px)
    for (let i = 0; i < 4; i++) {
      grassVariantTextures.push(
        new Texture({ source: tilesheet.source, frame: new Rectangle(208 + i * 16, 0, 16, 16) }),
      );
    }

    console.info('[Assets] Loaded tiles.png (17 tile types)');
  } catch {
    console.info('[Assets] tiles.png not found — using fallback textures');
    // Map existing fallback generators to the new semantic naming
    floorTexture = generateGrassTexture();
    floorShadowTexture = generateDirtTexture();
    wallFaceTexture = generateCliffFaceTexture();
    wallTopTexture = generateCliffTopTexture();
    wallInteriorTexture = generateCliffBodyTexture();
    wallSideLeftTexture = generateCliffBodyTexture();
    wallSideRightTexture = generateCliffBodyTexture();
    wallBottomTexture = generateCliffBottomTexture();
    wallCornerTLTexture = generateCornerTLTexture();
    wallCornerTRTexture = generateCornerTRTexture();
    wallCornerBLTexture = generateCornerBLTexture();
    wallCornerBRTexture = generateCornerBRTexture();
    wallTopEdgeTexture = generateTopEdgeTexture();
    // Fallback: reuse the same grass texture for all variants
    grassVariantTextures = [floorTexture, floorTexture, floorTexture, floorTexture];
  }

  // ── Tree asset (separate from tilesheet — different dimensions) ──────────
  try {
    treeTexture = await Assets.load<Texture>('assets/oak-tree.png');
    treeTexture.source.scaleMode = 'nearest';
    console.info(`[Assets] Loaded oak-tree.png (${treeTexture.width}×${treeTexture.height})`);
  } catch {
    console.info('[Assets] oak-tree.png not found — using fallback tree');
    treeTexture = generateTreeTexture();
  }

  // ── Shadow overlay assets (16×16 semi-transparent PNGs) ───────────────────
  try {
    shadowTopTexture = await Assets.load<Texture>('assets/shadow_top.png');
    shadowTopTexture.source.scaleMode = 'nearest';
    shadowLeftTexture = await Assets.load<Texture>('assets/shadow_left.png');
    shadowLeftTexture.source.scaleMode = 'nearest';
    shadowCornerTexture = await Assets.load<Texture>('assets/shadow_corner.png');
    shadowCornerTexture.source.scaleMode = 'nearest';
    console.info('[Assets] Loaded shadow overlay textures (top, left, corner)');
  } catch {
    console.info('[Assets] Shadow overlay PNGs not found — using fallback');
    shadowTopTexture = generateShadowTopTexture();
    shadowLeftTexture = generateShadowLeftTexture();
    shadowCornerTexture = generateShadowCornerTexture();
  }

  // ── Player spritesheets (128×128 — 8 cols × 4 rows, each frame 16×32) ──
  // One file per team: player_0.png, player_1.png, …
  // Teams without a dedicated file reuse team 0's animations.
  const PLAYER_FILES = ['assets/player_0.png', 'assets/player_1.png', 'assets/player_2.png'];
  const dirOrder = ['down', 'left', 'right', 'up'] as const;
  const FW = 16;
  const FH = 32;
  const WALK_COLS = 6;
  const IDLE_START = 6;
  const IDLE_COLS = 2;

  for (let i = 0; i < PLAYER_FILES.length; i++) {
    try {
      const sheet = await Assets.load<Texture>(PLAYER_FILES[i]);
      sheet.source.scaleMode = 'nearest';

      const anims: Record<string, Texture[]> = {};
      for (let row = 0; row < 4; row++) {
        const dir = dirOrder[row];

        const walkFrames: Texture[] = [];
        for (let col = 0; col < WALK_COLS; col++) {
          walkFrames.push(new Texture({
            source: sheet.source,
            frame: new Rectangle(col * FW, row * FH, FW, FH),
          }));
        }
        anims[`walk-${dir}`] = walkFrames;

        const idleFrames: Texture[] = [];
        for (let col = IDLE_START; col < IDLE_START + IDLE_COLS; col++) {
          idleFrames.push(new Texture({
            source: sheet.source,
            frame: new Rectangle(col * FW, row * FH, FW, FH),
          }));
        }
        anims[`idle-${dir}`] = idleFrames;
      }

      playerAnimationSets.push(anims);
      console.info(`[Assets] Loaded ${PLAYER_FILES[i]}`);
    } catch {
      console.info(`[Assets] ${PLAYER_FILES[i]} not found — using fallback`);
      const { animations } = generatePlayerSpritesheet();
      playerAnimationSets.push(animations);
    }
  }

  // ── Runestone spritesheet (96×32 — 6 cols × 1 row, each frame 16×32) ──────
  // Layout: [inactive0, active0, inactive1, active1, inactive2, active2]
  try {
    const rsSheet = await Assets.load<Texture>('assets/runestones.png');
    rsSheet.source.scaleMode = 'nearest';

    runestoneTextures = [];
    for (let i = 0; i < 3; i++) {
      const inactive = new Texture({
        source: rsSheet.source,
        frame: new Rectangle(i * 2 * 16, 0, 16, 32),
      });
      const active = new Texture({
        source: rsSheet.source,
        frame: new Rectangle((i * 2 + 1) * 16, 0, 16, 32),
      });
      runestoneTextures.push([inactive, active]);
    }
    console.info('[Assets] Loaded runestones.png (3 pairs)');
  } catch {
    console.info('[Assets] runestones.png not found — using fallback runestone textures');
    // Procedural fallback: simple colored rectangles
    runestoneTextures = [];
    const colors = ['#6a6a8a', '#7a5a4a', '#5a7a5a'];
    for (let i = 0; i < 3; i++) {
      const makeFallback = (color: string, glow: boolean): Texture => {
        const c = document.createElement('canvas');
        c.width = 16;
        c.height = 32;
        const ctx = c.getContext('2d')!;
        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, 16, 32);
        // Stone body
        ctx.fillStyle = color;
        ctx.fillRect(4, 4, 8, 26);
        ctx.fillRect(3, 8, 10, 18);
        if (glow) {
          ctx.fillStyle = '#44ff88';
          ctx.fillRect(6, 10, 4, 4);
        }
        const tex = Texture.from(c);
        tex.source.scaleMode = 'nearest';
        return tex;
      };
      runestoneTextures.push([makeFallback(colors[i], false), makeFallback(colors[i], true)]);
    }
  }

  // ── Pixel Fonts (TTF) ─────────────────────────────────────────────────────
  try {
    // Load the fonts so they are registered with the browser
    await Assets.load([
      'assets/pixel_operator/PixelOperator.ttf',
      'assets/pixel_operator/PixelOperator8.ttf',
    ]);
    console.info('[Assets] Loaded Pixel Operator fonts');
  } catch (err) {
    console.warn('[Assets] Failed to load Pixel Operator fonts:', err);
    // Fallback: standard system fonts will be used if these fail.
  }

  return {
    floorTexture,
    floorShadowTexture,
    wallFaceTexture,
    wallTopTexture,
    wallInteriorTexture,
    wallSideLeftTexture,
    wallSideRightTexture,
    wallBottomTexture,
    wallCornerTLTexture,
    wallCornerTRTexture,
    wallCornerBLTexture,
    wallCornerBRTexture,
    wallTopEdgeTexture,
    grassVariantTextures,
    treeTexture,
    shadowTopTexture,
    shadowLeftTexture,
    shadowCornerTexture,
    playerAnimationSets,
    runestoneTextures,
  };
}