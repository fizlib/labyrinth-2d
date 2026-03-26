// packages/client/src/assets/AssetLoader.ts
// ─────────────────────────────────────────────────────────────────────────────
// Asset loader with fallback support.
// Attempts to load real PNG assets; if they fail, uses procedurally generated
// textures from FallbackTextures.ts so the game always works.
// ─────────────────────────────────────────────────────────────────────────────

import { Assets, Texture, Rectangle } from 'pixi.js';
import {
  generateWallTexture,
  generateFloorTexture,
  generatePlayerSpritesheet,
} from './FallbackTextures';

/** All game assets needed for rendering. */
export interface GameAssets {
  wallTexture: Texture;
  floorTexture: Texture;
  /** Named animation → array of frame textures. */
  playerAnimations: Record<string, Texture[]>;
}

/**
 * Load game assets with fallback support.
 * Tries loading real PNGs first; on failure, generates textures procedurally.
 */
export async function loadAssets(): Promise<GameAssets> {
  let wallTexture: Texture;
  let floorTexture: Texture;
  let playerAnimations: Record<string, Texture[]>;

  // ── Tile textures ──────────────────────────────────────────────────────
  try {
    const tilesheet = await Assets.load<Texture>('assets/tiles.png');
    tilesheet.source.scaleMode = 'nearest';
    
    // If real tiles.png is found, slice it:
    // Assumes 32×16 layout: col 0 = floor, col 1 = wall (each 16×16)
    floorTexture = new Texture({
      source: tilesheet.source,
      frame: new Rectangle(0, 0, 16, 16),
    });
    wallTexture = new Texture({
      source: tilesheet.source,
      frame: new Rectangle(16, 0, 16, 16),
    });
    console.info('[Assets] Loaded tiles.png');
  } catch {
    console.info('[Assets] tiles.png not found — using fallback textures');
    wallTexture = generateWallTexture();
    floorTexture = generateFloorTexture();
  }

  // ── Player spritesheet ─────────────────────────────────────────────────
  try {
    const _playerSheet = await Assets.load<Texture>('assets/player.png');
    _playerSheet.source.scaleMode = 'nearest';
    
    // If real player.png found, slice it into animation frames.
    // Expected layout: 4 cols × 4 rows, each frame 16×32
    // Same layout as fallback spritesheet.
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

  return { wallTexture, floorTexture, playerAnimations };
}
