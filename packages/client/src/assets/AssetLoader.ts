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

    console.info('[Assets] Loaded tiles.png (7 tile types)');
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
  }

  // ── Player spritesheet ─────────────────────────────────────────────────
  try {
    const _playerSheet = await Assets.load<Texture>('assets/player.png');
    _playerSheet.source.scaleMode = 'nearest';

    const dirOrder = ['down', 'left', 'right', 'up'] as const;
    const FW = 16;
    const FH = 32;
    const anims: Record<string, Texture[]> = {};

    for (let row = 0; row < 4; row++) {
      const dir = dirOrder[row];
      const walkFrames: Texture[] = [];
      for (let col = 0; col < 2; col++) {
        walkFrames.push(new Texture({
          source: _playerSheet.source,
          frame: new Rectangle(col * FW, row * FH, FW, FH),
        }));
      }
      anims[`walk-${dir}`] = walkFrames;

      const idleFrames: Texture[] = [];
      for (let col = 2; col < 4; col++) {
        idleFrames.push(new Texture({
          source: _playerSheet.source,
          frame: new Rectangle(col * FW, row * FH, FW, FH),
        }));
      }
      anims[`idle-${dir}`] = idleFrames;
    }

    playerAnimations = anims;
    console.info('[Assets] Loaded player.png');
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
    playerAnimations,
  };
}