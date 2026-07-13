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

/**
 * Fiorwoods tree-wall modules. The original maps build a south-facing tree
 * facade from eight 32px rows, with a separate low hedge treatment for the
 * other exposed sides of a forest mass.
 */
export interface ForestWallTextures {
  /** Top-to-bottom rows of the full tree face; every row has six repeatable columns. */
  southFaceRows: Texture[][];
  /** Top-to-bottom foliage rows for a north-facing hedge. */
  northHedgeRows: Texture[];
  /** Foliage tiles for a vertical exposed side. Mirror them for the opposite side. */
  sideHedgeTextures: Texture[];
  /** Triangular canopy transition that rounds a side hedge into a tree face. */
  southFaceCornerTexture: Texture;
  /** Dark underlay used behind transparent tree-wall modules. */
  interiorTexture: Texture;
  /** Six-piece grass fringe along the inside base of a northern wall. */
  insideNorthEdgeTextures: Texture[];
  /** Alternating two-piece rows forming the inside face of an eastern wall. */
  insideEastEvenTextures: Texture[];
  insideEastOddTextures: Texture[];
  /** Four rows that turn the north wall into the inside eastern wall. */
  insideNorthEastCapRows: Texture[][];
  /** Sprite modules referenced by the exported labyrinth-style-v1 wall stencil. */
  styleDecorationTextures: Readonly<Record<number, Texture>>;
}

export interface PlayerAnimationSet {
  animations: Record<string, Texture[]>;
  /** Animation keys whose source frames should be mirrored horizontally. */
  mirroredKeys: ReadonlySet<string>;
  scale: number;
}

function addDiagonalFallbacks(animations: Record<string, Texture[]>): void {
  for (const state of ['idle', 'walk']) {
    animations[`${state}-up-left`] = animations[`${state}-up`];
    animations[`${state}-up-right`] = animations[`${state}-up`];
    animations[`${state}-down-left`] = animations[`${state}-down`];
    animations[`${state}-down-right`] = animations[`${state}-down`];
  }
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
  /** Dominant canopy trees used to build solid forest-wall clusters. */
  forestTreeTextures: Texture[];
  /** Trunk-free canopy crowns tiled across every solid forest cell. */
  forestCanopyTextures: Texture[];
  /** Smaller trees and bushes used to break up repeated canopy silhouettes. */
  forestUnderstoryTextures: Texture[];
  /** Dark ground rendered beneath every solid forest tile. */
  forestGroundTextures: Texture[];
  /** Mossy path tiles using the same transition contract as dirtTextures. */
  forestPathTextures: DirtTextures;
  /** Directional Fiorwoods modules used to assemble the labyrinth's tree walls. */
  forestWallTextures: ForestWallTextures;
  /** Soft oval contact shadow rendered beneath forest vegetation. */
  forestShadowTexture: Texture;
  /** Shadow overlay for tiles directly below a north wall. */
  shadowTopTexture: Texture;
  /** Shadow overlay for tiles directly right of a west wall. */
  shadowLeftTexture: Texture;
  /** Shadow overlay for inner corner tiles (below wall AND right of wall). */
  shadowCornerTexture: Texture;
  /** Per-player animation sets. Index 0 is the default Lenne character. */
  playerAnimationSets: PlayerAnimationSet[];
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
  let forestTreeTextures: Texture[] = [];
  let forestCanopyTextures: Texture[] = [];
  let forestUnderstoryTextures: Texture[] = [];
  let forestGroundTextures: Texture[] = [];
  let forestPathTextures = createFallbackDirtTextures();
  let forestWallTextures: ForestWallTextures = {
    southFaceRows: [],
    northHedgeRows: [],
    sideHedgeTextures: [],
    southFaceCornerTexture: Texture.EMPTY,
    interiorTexture: Texture.EMPTY,
    insideNorthEdgeTextures: [],
    insideEastEvenTextures: [],
    insideEastOddTextures: [],
    insideNorthEastCapRows: [],
    styleDecorationTextures: {},
  };
  let forestShadowTexture: Texture;
  let shadowTopTexture: Texture;
  let shadowLeftTexture: Texture;
  let shadowCornerTexture: Texture;
  const playerAnimationSets: PlayerAnimationSet[] = [];
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

  // ── Forest labyrinth reskin ─────────────────────────────────────────────
  try {
    const loadForestTexture = async (name: string): Promise<Texture> => {
      const texture = await Assets.load<Texture>(`assets/forest/${name}`);
      texture.source.scaleMode = 'nearest';
      return texture;
    };

    forestTreeTextures = await Promise.all([
      loadForestTexture('tree_primary_02.png'),
      loadForestTexture('tree_primary_03.png'),
    ]);
    forestCanopyTextures = await Promise.all([
      loadForestTexture('fior_canopy_0.png'),
      loadForestTexture('fior_canopy_1.png'),
      loadForestTexture('fior_canopy_2.png'),
      loadForestTexture('fior_canopy_3.png'),
      loadForestTexture('fior_canopy_4.png'),
      loadForestTexture('fior_canopy_5.png'),
      loadForestTexture('fior_canopy_6.png'),
      loadForestTexture('fior_canopy_7.png'),
    ]);
    forestUnderstoryTextures = await Promise.all([
      loadForestTexture('tree_small_04.png'),
      loadForestTexture('tree_small_05.png'),
      loadForestTexture('tree_small_06.png'),
      loadForestTexture('bush_01.png'),
      loadForestTexture('bush_02.png'),
      loadForestTexture('bush_03.png'),
      loadForestTexture('bush_04.png'),
    ]);
    grassVariantTextures = await Promise.all([
      loadForestTexture('fior_grass_0.png'),
      loadForestTexture('fior_grass_1.png'),
      loadForestTexture('fior_grass_2.png'),
      loadForestTexture('fior_grass_3.png'),
    ]);
    forestGroundTextures = await Promise.all([
      loadForestTexture('fior_ground_0.png'),
      loadForestTexture('fior_ground_1.png'),
      loadForestTexture('fior_ground_2.png'),
      loadForestTexture('fior_ground_3.png'),
    ]);
    forestPathTextures = {
      center: await loadForestTexture('path_center.png'),
      plainAlt: await loadForestTexture('path_plain_alt.png'),
      north: await loadForestTexture('path_n.png'),
      northEast: await loadForestTexture('path_ne.png'),
      east: await loadForestTexture('path_e.png'),
      southEast: await loadForestTexture('path_se.png'),
      south: await loadForestTexture('path_s.png'),
      southWest: await loadForestTexture('path_sw.png'),
      west: await loadForestTexture('path_w.png'),
      northWest: await loadForestTexture('path_nw.png'),
    };
    forestShadowTexture = await loadForestTexture('tree_shadow.png');
    treeTexture = forestTreeTextures[0];
    console.info('[Assets] Loaded forest trees, understory, terrain, paths, and shadows');
  } catch {
    console.warn('[Assets] Forest asset set incomplete — using existing terrain fallbacks');
    forestTreeTextures = [treeTexture, treeTexture];
    forestCanopyTextures = [treeTexture, treeTexture];
    forestUnderstoryTextures = [treeTexture];
    forestGroundTextures = [floorShadowTexture, floorShadowTexture, floorShadowTexture, floorShadowTexture];
    forestPathTextures = dirtTextures;
    forestShadowTexture = generateShadowCornerTexture();
  }

  // Fiorwoods uses hand-authored 32px wall modules rather than a random
  // scattering of trees. Keep them in the source library so the module names
  // and placement match the extracted map layouts exactly.
  try {
    const fiorwoodsRoot = 'assets/chained-echoes-assets-sorted/Assets/Maps/Fiorwoods';
    const loadFiorwoodsTile = async (id: number): Promise<Texture> => {
      const texture = await Assets.load<Texture>(`${fiorwoodsRoot}/Sprite_Fiorwoods_${id}.png`);
      texture.source.scaleMode = 'nearest';
      return texture;
    };
    const faceRowStarts = [38, 88, 138, 188, 238, 288, 338, 388];
    forestWallTextures = {
      southFaceRows: await Promise.all(
        faceRowStarts.map((start) =>
          Promise.all(Array.from({ length: 6 }, (_, column) => loadFiorwoodsTile(start + column))),
        ),
      ),
      // The three modules are the bright crown, dark leaf underside, and
      // deep canopy that Fiorwoods stacks on its north-facing tree edges.
      northHedgeRows: await Promise.all([381, 382, 380].map(loadFiorwoodsTile)),
      // 80 is the cap; 31/32 are the paired, vertical hedge modules used on
      // the east and west sides of Fiorwoods clearings.
      sideHedgeTextures: await Promise.all([80, 31, 32].map(loadFiorwoodsTile)),
      southFaceCornerTexture: await loadFiorwoodsTile(379),
      interiorTexture: await loadFiorwoodsTile(301),
      insideNorthEdgeTextures: await Promise.all([438, 439, 440, 441, 442, 443].map(loadFiorwoodsTile)),
      insideEastEvenTextures: await Promise.all([549, 550].map(loadFiorwoodsTile)),
      insideEastOddTextures: await Promise.all([599, 600].map(loadFiorwoodsTile)),
      insideNorthEastCapRows: await Promise.all([
        [1131],
        [1181],
        [1231, 1232],
        [1281, 1282],
      ].map((row) => Promise.all(row.map(loadFiorwoodsTile)))),
      styleDecorationTextures: Object.fromEntries(await Promise.all([
        110, 160, 438, 439, 440, 441, 442, 443, 492, 493, 539, 543, 549, 550,
        580, 587, 589, 590, 592, 593, 599, 600, 636, 637, 643, 832, 833, 847, 848, 849,
        880, 881, 882, 897, 898, 899, 930, 931, 932, 946, 947, 948, 949, 980,
        981, 982, 983, 996, 997, 998, 999, 1030, 1031, 1032, 1033, 1046, 1047,
        1048, 1049, 1080, 1081, 1082, 1089, 1131, 1181, 1231, 1232, 1281, 1282,
      ].map(async (id) => [id, await loadFiorwoodsTile(id)] as const))),
    };
    // These grass modules are the same ground-family tiles used on Fiorwoods'
    // playable floor layers. They replace the earlier generic green fill.
    grassVariantTextures = await Promise.all([102, 105, 108, 154].map(loadFiorwoodsTile));
    console.info('[Assets] Loaded Fiorwoods terrain and directional tree-wall modules');
  } catch {
    // The smaller curated forest pack remains a complete fallback for builds
    // that do not include the locally licensed source library.
    forestWallTextures = {
      southFaceRows: Array.from({ length: 8 }, () => forestCanopyTextures),
      northHedgeRows: forestCanopyTextures.slice(0, 3),
      sideHedgeTextures: forestCanopyTextures.slice(0, 3),
      southFaceCornerTexture: forestCanopyTextures[0],
      interiorTexture: forestGroundTextures[0],
      insideNorthEdgeTextures: forestCanopyTextures.slice(0, 6),
      insideEastEvenTextures: forestCanopyTextures.slice(0, 2),
      insideEastOddTextures: forestCanopyTextures.slice(2, 4),
      insideNorthEastCapRows: forestCanopyTextures.slice(0, 4).map((texture) => [texture]),
      styleDecorationTextures: {},
    };
    console.warn('[Assets] Fiorwoods wall modules unavailable — using curated forest fallback');
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

  // ── Player characters ───────────────────────────────────────────────────
  // Keep this order in sync with the server's sprite assignment. Lenne must
  // remain index 0 so the first player always receives the default character.
  const PLAYER_CHARACTERS = [
    { id: 'lenne', displayName: 'Lenne', lyingFrame: 51 },
    { id: 'glenn', displayName: 'Glenn', lyingFrame: 55 },
    { id: 'amalia', displayName: 'Amalia', lyingFrame: 48 },
    { id: 'robb', displayName: 'Robb', lyingFrame: 55 },
    { id: 'sienna', displayName: 'Sienna', lyingFrame: 50 },
  ] as const;

  // The source pack supplies individually cropped frames. Five right-facing
  // directions cover all eight movement directions by mirroring the left side.
  for (const character of PLAYER_CHARACTERS) {
    try {
      const loadCharacterFrame = async (frame: number): Promise<Texture> => {
        const texture = await Assets.load<Texture>(
          `assets/${character.id}/${character.id}_${frame}.png`,
        );
        texture.source.scaleMode = 'nearest';
        return texture;
      };

      const [idleFrames, walkFrames, lyingFrame] = await Promise.all([
        Promise.all([0, 1, 2, 3, 4].map(loadCharacterFrame)),
        Promise.all(
          Array.from({ length: 30 }, (_, index) => index + 16).map(loadCharacterFrame),
        ),
        loadCharacterFrame(character.lyingFrame),
      ]);
      const animations: Record<string, Texture[]> = {
        'idle-down': [idleFrames[0]],
        'idle-right': [idleFrames[1]],
        'idle-up': [idleFrames[2]],
        'idle-up-right': [idleFrames[3]],
        'idle-down-right': [idleFrames[4]],
        'walk-down': walkFrames.slice(0, 6),
        'walk-right': walkFrames.slice(6, 12),
        'walk-up': walkFrames.slice(12, 18),
        'walk-down-right': walkFrames.slice(18, 24),
        'walk-up-right': walkFrames.slice(24, 30),
        lying: [lyingFrame],
      };
      const mirroredKeys = new Set<string>();
      for (const state of ['idle', 'walk']) {
        for (const [leftDirection, rightDirection] of [
          ['left', 'right'],
          ['up-left', 'up-right'],
          ['down-left', 'down-right'],
        ]) {
          const leftKey = `${state}-${leftDirection}`;
          animations[leftKey] = animations[`${state}-${rightDirection}`];
          mirroredKeys.add(leftKey);
        }
      }

      // The remade source art is roughly 2x the width and height of the game's
      // legacy frames. Retain its source resolution and render it at half size.
      playerAnimationSets.push({ animations, mirroredKeys, scale: 0.5 });
      console.info(
        `[Assets] Loaded ${character.displayName} standing, lying, and eight-way movement animations`,
      );
    } catch {
      console.warn(
        `[Assets] ${character.displayName} frames missing — using fallback character`,
      );
      const { animations } = generatePlayerSpritesheet();
      addDiagonalFallbacks(animations);
      animations.lying = [animations['idle-down'][0]];
      playerAnimationSets.push({ animations, mirroredKeys: new Set(), scale: 1 });
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
    forestTreeTextures,
    forestCanopyTextures,
    forestUnderstoryTextures,
    forestGroundTextures,
    forestPathTextures,
    forestWallTextures,
    forestShadowTexture,
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
