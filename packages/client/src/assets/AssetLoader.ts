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
  playerAnimations: Record<string, Texture[]>;
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
  let playerAnimations: Record<string, Texture[]>;

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

    console.info('[Assets] Loaded tiles.png (13 tile types)');
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
  }

  // ── Player spritesheet (128×128 — 8 cols × 4 rows, each frame 16×32) ──
  // Cols 0-5: walk frames, Cols 6-7: idle frames
  try {
    const _playerSheet = await Assets.load<Texture>('assets/player.png');
    _playerSheet.source.scaleMode = 'nearest';

    const dirOrder = ['down', 'left', 'right', 'up'] as const;
    const FW = 16;
    const FH = 32;
    const WALK_COLS = 6;
    const IDLE_START = 6;
    const IDLE_COLS = 2;
    const anims: Record<string, Texture[]> = {};

    for (let row = 0; row < 4; row++) {
      const dir = dirOrder[row];

      // Walk frames: cols 0–5
      const walkFrames: Texture[] = [];
      for (let col = 0; col < WALK_COLS; col++) {
        walkFrames.push(new Texture({
          source: _playerSheet.source,
          frame: new Rectangle(col * FW, row * FH, FW, FH),
        }));
      }
      anims[`walk-${dir}`] = walkFrames;

      // Idle frames: cols 6–7
      const idleFrames: Texture[] = [];
      for (let col = IDLE_START; col < IDLE_START + IDLE_COLS; col++) {
        idleFrames.push(new Texture({
          source: _playerSheet.source,
          frame: new Rectangle(col * FW, row * FH, FW, FH),
        }));
      }
      anims[`idle-${dir}`] = idleFrames;
    }

    playerAnimations = anims;
    console.info('[Assets] Loaded player.png (8-col spritesheet)');
  } catch {
    console.info('[Assets] player.png not found — using fallback spritesheet');
    const { animations } = generatePlayerSpritesheet();
    playerAnimations = animations;
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
    playerAnimations,
  };
}