// packages/client/src/assets/AssetLoader.ts
// ─────────────────────────────────────────────────────────────────────────────
// Asset loader with fallback support.
// Attempts to load real PNG assets; if they fail, uses procedurally generated
// textures from FallbackTextures.ts so the game always works.
//
// Step 9: 5 tile textures — floor, floor shadow, wall face variants, wall top, wall interior.
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
  generateGateHorizontalTexture,
  generateGateVerticalTexture,
  generateWisdomOrbTexture,
  generatePressurePlateTexture,
} from './FallbackTextures';

export interface FrontGateTextures {
  topLeft: Texture;
  topMid: Texture;
  topRight: Texture;
  midLeft: Texture;
  midCenter: Texture;
  midRight: Texture;
  bottomLeft: Texture;
  bottomMid: Texture;
  bottomRight: Texture;
}

export interface DirtTextures {
  center: Texture;
  plainAlt: Texture;
  north: Texture;
  northEast: Texture;
  east: Texture;
  southEast: Texture;
  south: Texture;
  southWest: Texture;
  west: Texture;
  northWest: Texture;
}

function createFallbackDirtTextures(): DirtTextures {
  const dirt = generateDirtTexture();
  return {
    center: dirt,
    plainAlt: dirt,
    north: dirt,
    northEast: dirt,
    east: dirt,
    southEast: dirt,
    south: dirt,
    southWest: dirt,
    west: dirt,
    northWest: dirt,
  };
}

export interface GameAssets {
  floorTexture: Texture;
  floorShadowTexture: Texture;
  /** 4 wall face variant textures: [base, mixed, cracked, mossy]. */
  wallFaceVariantTextures: Texture[];
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
  frontGateTextures: FrontGateTextures | null;
  gateHorizontalTexture: Texture;
  gateVerticalTexture: Texture;
  /** 4 grass variant textures: [0-1] plain grass, [2-3] flower grass (rarer). */
  grassVariantTextures: Texture[];
  dirtTextures: DirtTextures;
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
  /** Portal animation frames (row 1 emergence + row 2 idle, flattened). */
  portalFrames: Texture[];
  /** Number of emergence frames (the rest are idle). */
  portalEmergenceCount: number;
  /** Wisdom orb HUD texture. */
  wisdomOrbTexture: Texture;
  /** Pressure plate animation frames: [frame0 (up), frame1 (mid), frame2 (pressed)]. */
  pressurePlateFrames: Texture[];
  /** Hub-side pressure plate animation frames (24x16). */
  hubPressurePlateFrames: Texture[];
}

export async function loadAssets(): Promise<GameAssets> {
  let floorTexture: Texture;
  let floorShadowTexture: Texture;
  let wallFaceVariantTextures: Texture[] = [];
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
  let frontGateTextures: FrontGateTextures | null = null;
  let gateHorizontalTexture = generateGateHorizontalTexture();
  let gateVerticalTexture = generateGateVerticalTexture();
  let grassVariantTextures: Texture[] = [];
  let dirtTextures = createFallbackDirtTextures();
  let treeTexture: Texture;
  let shadowTopTexture: Texture;
  let shadowLeftTexture: Texture;
  let shadowCornerTexture: Texture;
  const playerAnimationSets: Record<string, Texture[]>[] = [];
  let runestoneTextures: [Texture, Texture][] = [];
  let portalFrames: Texture[] = [];
  let portalEmergenceCount = 6;
  let wisdomOrbTexture: Texture;
  let pressurePlateFrames: Texture[] = [];
  let hubPressurePlateFrames: Texture[] = [];

  try {
    const tilesheet = await Assets.load<Texture>('assets/tiles.png');
    tilesheet.source.scaleMode = 'nearest';
    if (tilesheet.width < 272 || tilesheet.height < 16) {
      throw new Error(`Expected tiles.png to be at least 272x16 but received ${tilesheet.width}x${tilesheet.height}`);
    }

    floorTexture = new Texture({ source: tilesheet.source, frame: new Rectangle(0, 0, 16, 16) });
    floorShadowTexture = new Texture({ source: tilesheet.source, frame: new Rectangle(16, 0, 16, 16) });
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

    if (tilesheet.height >= 32) {
      dirtTextures = {
        center: new Texture({ source: tilesheet.source, frame: new Rectangle(0, 16, 16, 16) }),
        plainAlt: new Texture({ source: tilesheet.source, frame: new Rectangle(16, 16, 16, 16) }),
        north: new Texture({ source: tilesheet.source, frame: new Rectangle(32, 16, 16, 16) }),
        northEast: new Texture({ source: tilesheet.source, frame: new Rectangle(48, 16, 16, 16) }),
        east: new Texture({ source: tilesheet.source, frame: new Rectangle(64, 16, 16, 16) }),
        southEast: new Texture({ source: tilesheet.source, frame: new Rectangle(80, 16, 16, 16) }),
        south: new Texture({ source: tilesheet.source, frame: new Rectangle(96, 16, 16, 16) }),
        southWest: new Texture({ source: tilesheet.source, frame: new Rectangle(112, 16, 16, 16) }),
        west: new Texture({ source: tilesheet.source, frame: new Rectangle(128, 16, 16, 16) }),
        northWest: new Texture({ source: tilesheet.source, frame: new Rectangle(144, 16, 16, 16) }),
      };
    } else {
      console.warn('[Assets] tiles.png is missing the dirt row - using fallback dirt textures');
    }

    console.info('[Assets] Loaded tiles.png (wall tiles, grass variants, dirt transitions)');
  } catch {
    console.info('[Assets] tiles.png not found — using fallback textures');
    // Map existing fallback generators to the new semantic naming
    floorTexture = generateGrassTexture();
    floorShadowTexture = generateDirtTexture();
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
    dirtTextures = createFallbackDirtTextures();
  }

  try {
    const wallFaceSheet = await Assets.load<Texture>('assets/wall_tiles.png');
    wallFaceSheet.source.scaleMode = 'nearest';

    for (let i = 0; i < 4; i++) {
      wallFaceVariantTextures.push(
        new Texture({ source: wallFaceSheet.source, frame: new Rectangle(i * 16, 0, 16, 16) }),
      );
    }

    console.info('[Assets] Loaded wall_tiles.png (4 wall face variants)');
  } catch {
    console.info('[Assets] wall_tiles.png not found — using fallback wall face variants');
    const fallbackWallFace = generateCliffFaceTexture();
    wallFaceVariantTextures = [
      fallbackWallFace,
      fallbackWallFace,
      fallbackWallFace,
      fallbackWallFace,
    ];
  }
  // Gate atlas asset: 3x3 grid of 16x16 gate pieces packed into one 48x48 PNG.
  try {
    const gateSheet = await Assets.load<Texture>('assets/gates.png');
    gateSheet.source.scaleMode = 'nearest';
    if (gateSheet.width < 48 || gateSheet.height < 48) {
      throw new Error(`Expected a 48x48 front-gate atlas but received ${gateSheet.width}x${gateSheet.height}`);
    }

    frontGateTextures = {
      topLeft: new Texture({ source: gateSheet.source, frame: new Rectangle(0, 0, 16, 16) }),
      topMid: new Texture({ source: gateSheet.source, frame: new Rectangle(16, 0, 16, 16) }),
      topRight: new Texture({ source: gateSheet.source, frame: new Rectangle(32, 0, 16, 16) }),
      midLeft: new Texture({ source: gateSheet.source, frame: new Rectangle(0, 16, 16, 16) }),
      midCenter: new Texture({ source: gateSheet.source, frame: new Rectangle(16, 16, 16, 16) }),
      midRight: new Texture({ source: gateSheet.source, frame: new Rectangle(32, 16, 16, 16) }),
      bottomLeft: new Texture({ source: gateSheet.source, frame: new Rectangle(0, 32, 16, 16) }),
      bottomMid: new Texture({ source: gateSheet.source, frame: new Rectangle(16, 32, 16, 16) }),
      bottomRight: new Texture({ source: gateSheet.source, frame: new Rectangle(32, 32, 16, 16) }),
    };
    console.info('[Assets] Loaded gates.png (front-facing 3x3 gate atlas)');
  } catch (err) {
    console.info('[Assets] gates.png not found or invalid - using fallback gate textures');
    if (err instanceof Error) {
      console.warn('[Assets] Gate atlas load error:', err.message);
    }
  }

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

  // ── Portal spritesheet (2 rows: row 1 = emergence, row 2 = idle) ──────────
  try {
    const portalSheet = await Assets.load<Texture>('assets/portal_spritesheet.png');
    portalSheet.source.scaleMode = 'nearest';

    // Frame size: each row is half the sheet height, frames are square
    const frameH = Math.floor(portalSheet.height / 2);
    const frameW = frameH;
    const framesPerRow = Math.floor(portalSheet.width / frameW);

    portalFrames = [];
    // Row 1 (y=0): emergence frames
    for (let i = 0; i < framesPerRow; i++) {
      portalFrames.push(new Texture({
        source: portalSheet.source,
        frame: new Rectangle(i * frameW, 0, frameW, frameH),
      }));
    }
    const emergenceCount = framesPerRow;
    portalEmergenceCount = emergenceCount;
    // Row 2 (y=frameH): idle frames
    for (let i = 0; i < framesPerRow; i++) {
      portalFrames.push(new Texture({
        source: portalSheet.source,
        frame: new Rectangle(i * frameW, frameH, frameW, frameH),
      }));
    }
    console.info(`[Assets] Loaded portal_spritesheet.png (${emergenceCount} emergence + ${framesPerRow} idle, ${frameW}×${frameH} each)`);
  } catch {
    console.info('[Assets] portal_spritesheet.png not found — using fallback portal textures');
    portalFrames = [];
    for (let i = 0; i < 12; i++) {
      const c = document.createElement('canvas');
      c.width = 32;
      c.height = 32;
      const ctx = c.getContext('2d')!;
      ctx.clearRect(0, 0, 32, 32);
      const alpha = i < 6 ? (i + 1) / 6 : 1;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#8844ff';
      ctx.beginPath();
      ctx.arc(16, 16, 10 + Math.sin(i * 0.5) * 3, 0, Math.PI * 2);
      ctx.fill();
      const tex = Texture.from(c);
      tex.source.scaleMode = 'nearest';
      portalFrames.push(tex);
    }
  }

  // ── Pixel Fonts (TTF) ─────────────────────────────────────────────────────
  try {
    wisdomOrbTexture = await Assets.load<Texture>('assets/wisdom_orb.png');
    wisdomOrbTexture.source.scaleMode = 'nearest';
    console.info(`[Assets] Loaded wisdom_orb.png (${wisdomOrbTexture.width}x${wisdomOrbTexture.height})`);
  } catch {
    console.info('[Assets] wisdom_orb.png not found - using fallback orb texture');
     wisdomOrbTexture = generateWisdomOrbTexture();
  }

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

  // ── Pressure plate spritesheet (48×16 — 3 frames of 16×16) ────────────────
  try {
    const plateSheet = await Assets.load<Texture>('assets/plate_spritesheet.png');
    plateSheet.source.scaleMode = 'nearest';

    // Row 1: 16x16 frames
    pressurePlateFrames = [];
    for (let i = 0; i < 3; i++) {
      pressurePlateFrames.push(new Texture({
        source: plateSheet.source,
        frame: new Rectangle(i * 16, 0, 16, 16),
      }));
    }

    // Row 2: 24x16 frames
    hubPressurePlateFrames = [];
    if (plateSheet.height >= 32) {
      for (let i = 0; i < 3; i++) {
        hubPressurePlateFrames.push(new Texture({
          source: plateSheet.source,
          frame: new Rectangle(i * 24, 16, 24, 16),
        }));
      }
      console.info('[Assets] Loaded plate_spritesheet.png Row 2 (24x16 hub plates)');
    } else {
      console.warn('[Assets] plate_spritesheet.png missing Row 2 — falling back');
      hubPressurePlateFrames = pressurePlateFrames;
    }
  } catch {
    console.info('[Assets] plate_spritesheet.png not found — using fallback pressure plate textures');
    pressurePlateFrames = [
      generatePressurePlateTexture(0),
      generatePressurePlateTexture(1),
      generatePressurePlateTexture(2),
    ];
    hubPressurePlateFrames = pressurePlateFrames;
  }

  return {
    floorTexture,
    floorShadowTexture,
    wallFaceVariantTextures,
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
    frontGateTextures,
    gateHorizontalTexture,
    gateVerticalTexture,
    grassVariantTextures,
    dirtTextures,
    treeTexture,
    shadowTopTexture,
    shadowLeftTexture,
    shadowCornerTexture,
    playerAnimationSets,
    runestoneTextures,
    portalFrames,
    portalEmergenceCount,
    wisdomOrbTexture,
    pressurePlateFrames,
    hubPressurePlateFrames,
  };
}

