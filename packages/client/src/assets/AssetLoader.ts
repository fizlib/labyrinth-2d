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
  treeTexture: Texture;
  /** Per-team animation sets. Access via playerAnimationSets[teamId]. */
  playerAnimationSets: Record<string, Texture[]>[];
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
  let treeTexture: Texture;
  const playerAnimationSets: Record<string, Texture[]>[] = [];

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
    treeTexture = generateTreeTexture(); // Tree is always procedural (tall 16×32 sprite)

    console.info('[Assets] Loaded tiles.png (13 tile types + procedural tree)');
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
    treeTexture = generateTreeTexture();
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
    treeTexture,
    playerAnimationSets,
  };
}