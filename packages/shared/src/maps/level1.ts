// packages/shared/src/maps/level1.ts
// ─────────────────────────────────────────────────────────────────────────────
// Level 1 — Procedurally-generated labyrinth with multi-layer 2.5D tiles.
//
// Tile IDs:
//   0 = Floor           (walkable, background layer)
//   1 = Floor Shadow    (walkable, background layer — ambient occlusion)
//   2 = Wall Face       (solid, entity layer — vertical drop)
//   3 = Wall Top        (solid, entity layer — bright rim border)
//   4 = Wall Interior   (solid, entity layer — deep rock mass)
//
// Layout:
//   - 218×218 tile grid at 16px/tile
//   - 30×30 central hub room
//   - Recursive-backtracking maze fills the entire space
//   - All corridors are 6 tiles wide
//   - Hub has 3 entrances: north, west, east
//   - 3 spawn points near corners
//
// Post-processing:
//   - 2-tile high South-facing wall profiles
//   - Dirt shadows hugging the bases of the walls
// ─────────────────────────────────────────────────────────────────────────────

import { generateBridgeSafeTileMasks } from '../bridge.js';

export interface TileMapData {
  width: number;
  height: number;
  tileSize: number;
  data: number[];
}

export interface SpawnPoint {
  x: number;
  y: number;
}

export type GateOrientation = 'horizontal' | 'vertical';

/** Direction from the gate toward the team's spawn point. */
export type GateSpawnDirection = 'north' | 'south';

export interface GatePlacement {
  teamIndex: number;
  cellX: number;
  cellY: number;
  /** Barrier origin tile. Horizontal gates start at the left edge; vertical gates start at the top edge. */
  tileX: number;
  tileY: number;
  orientation: GateOrientation;
  /** Which side of the gate faces the team's spawn. */
  spawnDirection: GateSpawnDirection;
}

export interface PressurePlateInfo {
  /** Unique pressure plate index within the layout. */
  id: number;
  /** Index into the gates array this plate belongs to. */
  gateIndex: number;
  /** Tile X coordinate of this plate. */
  tileX: number;
  /** Tile Y coordinate of this plate. */
  tileY: number;
  /** Which side of the gate this plate is on. */
  side: 'spawn' | 'hub';
}

/** Authored bridge obstacle spanning the wall opening between two cells. */
export interface BridgePlacement {
  /** Shared cell column. */
  cellX: number;
  /** Row of the cell north of the bridge. */
  northCellY: number;
  /** Top-left tile of the 6×10 vertical passage occupied by the bridge. */
  tileX: number;
  tileY: number;
  /** Bit row * 2 + column is set when that hidden-route stone is safe. */
  safeTileMask: number;
}

/** Authored swamp spanning a straight run of horizontally adjacent cells. */
export interface SwampPlacement {
  /** Column of the cell west of the swamp. */
  westCellX: number;
  /** Shared cell row. */
  cellY: number;
  /** Number of cells joined by the swamp, from 2 through 5. */
  lengthCells: number;
  /** Stable seed used for this swamp's terrain variation and decorations. */
  decorationSeed: number;
  /** Top-left tile of the first 11×6 east-west passage occupied by the swamp. */
  tileX: number;
  tileY: number;
}

/** Authored sword barrier spanning one open east-west wall passage. */
export interface SwordFieldPlacement {
  /** Cell immediately west of the blocked passage. */
  westCellX: number;
  /** Shared cell row. */
  cellY: number;
  /** Top-left tile of the 12×6 authored sword-field composition. */
  tileX: number;
  tileY: number;
}

/** Authored ruins/signpost decoration centered on a north- or south-closed T-junction. */
export interface TIntersectionDecorationPlacement {
  cellX: number;
  cellY: number;
  /** The only supported authored variants currently close north or south. */
  closedDirection: 'north' | 'south';
  /** Top-left tile of the walkable 6×6 intersection cell. */
  tileX: number;
  tileY: number;
}

/** Authored visual composition spanning one open north-south cell boundary. */
export interface DecoratedVerticalPassagePlacement {
  /** Shared cell column. */
  cellX: number;
  /** Row of the logical cell north of the decorated passage. */
  northCellY: number;
  /** Top-left tile of the authored 6x12 passage composition. */
  tileX: number;
  tileY: number;
}

/** One complete 6x6 maze cell belonging to the wardens' trap network. */
export interface TrapCellPlacement {
  cellX: number;
  cellY: number;
  /** Top-left tile of the walkable 6x6 cell. */
  tileX: number;
  tileY: number;
}

/** Authored treasure-cell prefab placed in a maze dead end. */
export type ChestCount = 1 | 2 | 3;
export type ChestSlot = 0 | 1 | 2;
export type ChestDeadEndDirection = 'north' | 'east' | 'south' | 'west';
export type ChestDeadEndVariant = 'north-west' | 'south-east';

export interface ChestDeadEndPlacement {
  cellX: number;
  cellY: number;
  /** Top-left tile of the 6×6 walkable dead-end cell. */
  tileX: number;
  tileY: number;
  /** The cell's sole opening toward the rest of the maze. */
  openDirection: ChestDeadEndDirection;
  /** Authored art/collider family selected from the opening direction. */
  variant: ChestDeadEndVariant;
  /** Number of independently openable chests authored into this dead-end cell. */
  chestCount: ChestCount;
  /** Position of this chest within the count-specific authored arrangement. */
  chestSlot: ChestSlot;
}

export interface GeneratedMazeLayout {
  map: TileMapData;
  spawnPoints: SpawnPoint[];
  gates: GatePlacement[];
  /** Pressure plate positions for gate activation. */
  pressurePlates: PressurePlateInfo[];
  /** Decorative, collidable bridges placed in qualifying vertical passages. */
  bridges: BridgePlacement[];
  /** Walkable swamps placed in qualifying horizontal passages. */
  swamps: SwampPlacement[];
  /** Role-interactive sword barriers placed in qualifying horizontal passages. */
  swordFields: SwordFieldPlacement[];
  /** Visual ruins/signpost prefabs spanning free cells around selected T-junctions. */
  tIntersectionDecorations: TIntersectionDecorationPlacement[];
  /** Visual-only authored compositions spanning free vertical cell pairs. */
  decoratedVerticalPassages: DecoratedVerticalPassagePlacement[];
  /** Warden-visible 6x6 cells that can capture survivors when the network fires. */
  trapCells: TrapCellPlacement[];
  /** Independently openable treasure instances placed in every maze dead end. */
  chestDeadEnds: ChestDeadEndPlacement[];
  /** Visual-only dirt overlay for gate approaches. 1 = render dirt on the ground layer. */
  dirtMask: Uint8Array;
}

// ── Tile ID Constants ───────────────────────────────────────────────────────

/** Base floor — walkable, rendered on background layer. */
export const TILE_FLOOR = 0;

/** Dirt floor / shadow — walkable, rendered on background layer. Ambient occlusion near walls. */
export const TILE_FLOOR_SHADOW = 1;

/** Vertical rock wall face — solid, Y-sorted on entity layer. */
export const TILE_WALL_FACE = 2;

/** Flat top edge of the rock wall — solid, Y-sorted on entity layer. */
export const TILE_WALL_TOP = 3;

/** Deep rock interior — solid, Y-sorted on entity layer. */
export const TILE_WALL_INTERIOR = 4;

/** Left vertical edge of a cliff mass — solid, Y-sorted. */
export const TILE_WALL_SIDE_LEFT = 5;

/** Right vertical edge of a cliff mass — solid, Y-sorted. */
export const TILE_WALL_SIDE_RIGHT = 6;

/** Bottom horizontal edge of a cliff mass — solid, Y-sorted. */
export const TILE_WALL_BOTTOM = 7;

/** Outer corner: top-left of cliff mass — solid, Y-sorted. */
export const TILE_WALL_CORNER_TL = 8;

/** Outer corner: top-right of cliff mass — solid, Y-sorted. */
export const TILE_WALL_CORNER_TR = 9;

/** Outer corner: bottom-left of cliff mass — solid, Y-sorted. */
export const TILE_WALL_CORNER_BL = 10;

/** Outer corner: bottom-right of cliff mass — solid, Y-sorted. */
export const TILE_WALL_CORNER_BR = 11;

/** Top horizontal edge (rock rim) of cliff body — solid, Y-sorted. Distinct from WALL_TOP (grassy overhang). */
export const TILE_WALL_TOP_EDGE = 12;

/** Decorative tree — solid, rendered as a taller sprite on the entity layer. */
export const TILE_TREE = 13;

/** Runestone 1 objective marker. Exact art and collision use the authored hub layout. */
export const TILE_RUNESTONE_1 = 14;

/** Runestone 2 objective marker. Exact art and collision use the authored hub layout. */
export const TILE_RUNESTONE_2 = 15;

/** Runestone 3 objective marker. Exact art and collision use the authored hub layout. */
export const TILE_RUNESTONE_3 = 16;

/** Closed gate segment spanning left-to-right across a cell. */
export const TILE_GATE_HORIZONTAL = 17;

/** Closed gate segment spanning top-to-bottom across a cell. */
export const TILE_GATE_VERTICAL = 18;

/** Pressure plate — walkable, decorative tile checked for player overlap by the server. */
export const TILE_PRESSURE_PLATE = 19;

// ── Constants ───────────────────────────────────────────────────────────────

export const CELL_SIZE = 6;
/** Width of solid wall bands separating cells horizontally. */
export const WALL_WIDTH = 11;
/** Height of solid wall bands separating cells vertically. */
export const WALL_HEIGHT = 10;
export const CELL_STEP_X = CELL_SIZE + WALL_WIDTH;
export const CELL_STEP_Y = CELL_SIZE + WALL_HEIGHT;
export const GRID_CELLS = 15;
export const MAP_WIDTH = WALL_WIDTH + GRID_CELLS * CELL_STEP_X; // = 266
export const MAP_HEIGHT = WALL_HEIGHT + GRID_CELLS * CELL_STEP_Y; // = 250
const TILE_PX = 16;

/** Size of the central hub room in tiles. Matches CELL_SIZE to prevent cutting wall corners, resulting in a clean cross-shaped hub area. */
const HUB_SIZE = 30;

export interface HubTileBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function getHubTileBounds(
  width: number = MAP_WIDTH,
  height: number = MAP_HEIGHT,
): HubTileBounds {
  const left = Math.floor((width - HUB_SIZE) / 2);
  const top = Math.floor((height - HUB_SIZE) / 2);
  return {
    left,
    top,
    right: left + HUB_SIZE - 1,
    bottom: top + HUB_SIZE - 1,
  };
}

export function isGateTileId(tile: number): boolean {
  return tile === TILE_GATE_HORIZONTAL || tile === TILE_GATE_VERTICAL;
}

export function isSolidTileId(tile: number): boolean {
  return (
    tile === TILE_WALL_FACE ||
    tile === TILE_WALL_TOP ||
    tile === TILE_WALL_INTERIOR ||
    tile === TILE_WALL_SIDE_LEFT ||
    tile === TILE_WALL_SIDE_RIGHT ||
    tile === TILE_WALL_BOTTOM ||
    tile === TILE_WALL_CORNER_TL ||
    tile === TILE_WALL_CORNER_TR ||
    tile === TILE_WALL_CORNER_BL ||
    tile === TILE_WALL_CORNER_BR ||
    tile === TILE_WALL_TOP_EDGE ||
    tile === TILE_TREE ||
    isGateTileId(tile)
  );
}

// ── Seeded PRNG (mulberry32) ────────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Direction helpers ───────────────────────────────────────────────────────

const DIRS = [
  { dx: 0, dy: -1 }, // north
  { dx: 1, dy: 0 }, // east
  { dx: 0, dy: 1 }, // south
  { dx: -1, dy: 0 }, // west
] as const;

function shuffle<T>(arr: T[], rand: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ── Maze Generation ─────────────────────────────────────────────────────────

function cellToTile(cx: number, cy: number): { tx: number; ty: number } {
  return {
    tx: WALL_WIDTH + cx * CELL_STEP_X,
    ty: WALL_HEIGHT + cy * CELL_STEP_Y,
  };
}

function carveCell(data: number[], cx: number, cy: number): void {
  const { tx, ty } = cellToTile(cx, cy);
  for (let dy = 0; dy < CELL_SIZE; dy++) {
    for (let dx = 0; dx < CELL_SIZE; dx++) {
      data[(ty + dy) * MAP_WIDTH + (tx + dx)] = TILE_FLOOR;
    }
  }
}

function carvePassage(
  data: number[],
  cx1: number,
  cy1: number,
  cx2: number,
  cy2: number,
): void {
  const { tx: tx1, ty: ty1 } = cellToTile(cx1, cy1);
  const { tx: tx2, ty: ty2 } = cellToTile(cx2, cy2);

  if (cy1 === cy2) {
    const wallX = Math.min(tx1, tx2) + CELL_SIZE;
    const topY = ty1;
    for (let wy = 0; wy < CELL_SIZE; wy++) {
      for (let wx = 0; wx < WALL_WIDTH; wx++) {
        data[(topY + wy) * MAP_WIDTH + (wallX + wx)] = TILE_FLOOR;
      }
    }
  } else {
    const wallY = Math.min(ty1, ty2) + CELL_SIZE;
    const leftX = tx1;
    for (let wy = 0; wy < WALL_HEIGHT; wy++) {
      for (let wx = 0; wx < CELL_SIZE; wx++) {
        data[(wallY + wy) * MAP_WIDTH + (leftX + wx)] = TILE_FLOOR;
      }
    }
  }
}

function getHubCells(hubTileX: number, hubTileY: number, hubSize: number): Set<string> {
  const cells = new Set<string>();
  for (let cy = 0; cy < GRID_CELLS; cy++) {
    for (let cx = 0; cx < GRID_CELLS; cx++) {
      const { tx, ty } = cellToTile(cx, cy);
      const cellRight = tx + CELL_SIZE - 1;
      const cellBottom = ty + CELL_SIZE - 1;
      const hubRight = hubTileX + hubSize - 1;
      const hubBottom = hubTileY + hubSize - 1;
      if (
        tx <= hubRight &&
        cellRight >= hubTileX &&
        ty <= hubBottom &&
        cellBottom >= hubTileY
      ) {
        cells.add(`${cx},${cy}`);
      }
    }
  }
  return cells;
}

function generateMazeData(seed: number): number[] {
  const rand = mulberry32(seed);

  // Start with all walls (temporarily 1)
  const data = new Array(MAP_WIDTH * MAP_HEIGHT).fill(1);

  // ── Central Hub ─────────────────────────────────────────────────────────
  const hubSize = HUB_SIZE;
  const hubTileX = Math.floor((MAP_WIDTH - hubSize) / 2);
  const hubTileY = Math.floor((MAP_HEIGHT - hubSize) / 2);

  for (let dy = 0; dy < hubSize; dy++) {
    for (let dx = 0; dx < hubSize; dx++) {
      data[(hubTileY + dy) * MAP_WIDTH + (hubTileX + dx)] = TILE_FLOOR;
    }
  }

  const hubCells = getHubCells(hubTileX, hubTileY, hubSize);
  const visited = new Array(GRID_CELLS * GRID_CELLS).fill(false);

  for (const key of hubCells) {
    const [cx, cy] = key.split(',').map(Number);
    visited[cy * GRID_CELLS + cx] = true;
  }

  // ── Carve all non-hub cells ─────────────────────────────────────────────
  for (let cy = 0; cy < GRID_CELLS; cy++) {
    for (let cx = 0; cx < GRID_CELLS; cx++) {
      if (!hubCells.has(`${cx},${cy}`)) {
        carveCell(data, cx, cy);
      }
    }
  }

  // ── Recursive backtracking ──────────────────────────────────────────────
  const startCx = 0;
  const startCy = 0;
  visited[startCy * GRID_CELLS + startCx] = true;

  const stack: Array<{ cx: number; cy: number }> = [{ cx: startCx, cy: startCy }];

  while (stack.length > 0) {
    const current = stack[stack.length - 1];
    const { cx, cy } = current;

    const neighbors: Array<{ cx: number; cy: number }> = [];
    for (const dir of DIRS) {
      const nx = cx + dir.dx;
      const ny = cy + dir.dy;
      if (
        nx >= 0 &&
        nx < GRID_CELLS &&
        ny >= 0 &&
        ny < GRID_CELLS &&
        !visited[ny * GRID_CELLS + nx]
      ) {
        neighbors.push({ cx: nx, cy: ny });
      }
    }

    if (neighbors.length === 0) {
      stack.pop();
    } else {
      shuffle(neighbors, rand);
      const next = neighbors[0];
      carvePassage(data, cx, cy, next.cx, next.cy);
      visited[next.cy * GRID_CELLS + next.cx] = true;
      stack.push(next);
    }
  }

  // ── Connect hub to maze ─────────────────────────────────────────────────
  const hubCenterCx = Math.floor(GRID_CELLS / 2);
  const hubCenterCy = Math.floor(GRID_CELLS / 2);

  let hubTopCy = GRID_CELLS;
  let hubBottomCy = -1;
  let hubLeftCx = GRID_CELLS;
  let hubRightCx = -1;
  for (const key of hubCells) {
    const [cx, cy] = key.split(',').map(Number);
    if (cy < hubTopCy) hubTopCy = cy;
    if (cy > hubBottomCy) hubBottomCy = cy;
    if (cx < hubLeftCx) hubLeftCx = cx;
    if (cx > hubRightCx) hubRightCx = cx;
  }

  // North entrance
  {
    const entranceCx = hubCenterCx;
    const aboveCy = hubTopCy - 1;
    if (aboveCy >= 0) {
      const { tx, ty } = cellToTile(entranceCx, aboveCy);
      const wallY = ty + CELL_SIZE;
      for (let wy = 0; wy < WALL_HEIGHT; wy++) {
        for (let dx = 0; dx < CELL_SIZE; dx++) {
          data[(wallY + wy) * MAP_WIDTH + (tx + dx)] = TILE_FLOOR;
        }
      }
      const hubEdge = hubTileY;
      for (let row = wallY + WALL_HEIGHT; row < hubEdge + CELL_SIZE; row++) {
        for (let dx = 0; dx < CELL_SIZE; dx++) {
          if (row >= 0 && row < MAP_HEIGHT) {
            data[row * MAP_WIDTH + (tx + dx)] = TILE_FLOOR;
          }
        }
      }
    }
  }

  // West entrance
  {
    const entranceCy = hubCenterCy;
    const leftCx = hubLeftCx - 1;
    if (leftCx >= 0) {
      const { tx, ty } = cellToTile(leftCx, entranceCy);
      const wallX = tx + CELL_SIZE;
      for (let wx = 0; wx < WALL_WIDTH; wx++) {
        for (let dy = 0; dy < CELL_SIZE; dy++) {
          data[(ty + dy) * MAP_WIDTH + (wallX + wx)] = TILE_FLOOR;
        }
      }
      const hubEdge = hubTileX;
      for (let col = wallX + WALL_WIDTH; col < hubEdge + CELL_SIZE; col++) {
        for (let dy = 0; dy < CELL_SIZE; dy++) {
          if (col >= 0 && col < MAP_WIDTH) {
            data[(ty + dy) * MAP_WIDTH + col] = TILE_FLOOR;
          }
        }
      }
    }
  }

  // East entrance
  {
    const entranceCy = hubCenterCy;
    const rightCx = hubRightCx + 1;
    if (rightCx < GRID_CELLS) {
      const { tx: cellTx, ty: cellTy } = cellToTile(rightCx, entranceCy);
      const wallX = cellTx - WALL_WIDTH;
      for (let wx = 0; wx < WALL_WIDTH; wx++) {
        for (let dy = 0; dy < CELL_SIZE; dy++) {
          data[(cellTy + dy) * MAP_WIDTH + (wallX + wx)] = TILE_FLOOR;
        }
      }
      const hubRight = hubTileX + hubSize;
      for (let col = hubRight - CELL_SIZE; col < wallX; col++) {
        for (let dy = 0; dy < CELL_SIZE; dy++) {
          if (col >= 0 && col < MAP_WIDTH) {
            data[(cellTy + dy) * MAP_WIDTH + col] = TILE_FLOOR;
          }
        }
      }
    }
  }

  // South entrance
  {
    const entranceCx = hubCenterCx;
    const belowCy = hubBottomCy + 1;
    if (belowCy < GRID_CELLS) {
      const { tx, ty } = cellToTile(entranceCx, belowCy);
      const wallY = ty - WALL_HEIGHT;
      for (let wy = 0; wy < WALL_HEIGHT; wy++) {
        for (let dx = 0; dx < CELL_SIZE; dx++) {
          data[(wallY + wy) * MAP_WIDTH + (tx + dx)] = TILE_FLOOR;
        }
      }
      const hubBottom = hubTileY + hubSize;
      for (let row = hubBottom - CELL_SIZE; row < wallY; row++) {
        for (let dx = 0; dx < CELL_SIZE; dx++) {
          if (row >= 0 && row < MAP_HEIGHT) {
            data[row * MAP_WIDTH + (tx + dx)] = TILE_FLOOR;
          }
        }
      }
    }
  }

  // ── Post-processing: convert to Stardew-style 2.5D tiles ────────────────

  // Step 1: Convert ALL old walls (1) → Wall Interior (4) initially
  for (let i = 0; i < data.length; i++) {
    if (data[i] === 1) {
      data[i] = TILE_WALL_INTERIOR;
    }
  }

  const snapshot = data.slice();

  // Step 2: Carve South-facing walls (2-tiles high vertical face + 1-tile top border)
  for (let y = MAP_HEIGHT - 2; y >= 2; y--) {
    for (let x = 0; x < MAP_WIDTH; x++) {
      const thisIdx = y * MAP_WIDTH + x;
      const belowIdx = (y + 1) * MAP_WIDTH + x;

      // If this tile is solid rock, but the tile directly south is walkable floor
      if (snapshot[thisIdx] === TILE_WALL_INTERIOR && snapshot[belowIdx] === TILE_FLOOR) {
        data[thisIdx] = TILE_WALL_FACE; // Base of the wall face

        // Extend the face upwards for a chunky 2-tile high appearance
        const midIdx = (y - 1) * MAP_WIDTH + x;
        if (snapshot[midIdx] === TILE_WALL_INTERIOR) {
          data[midIdx] = TILE_WALL_FACE;

          // Cap the wall face with a bright top border
          const topIdx = (y - 2) * MAP_WIDTH + x;
          if (snapshot[topIdx] === TILE_WALL_INTERIOR) {
            data[topIdx] = TILE_WALL_TOP;
          }
        } else {
          // Fallback if wall thickness is somehow only 1 block
          data[thisIdx] = TILE_WALL_TOP;
        }
      }
    }
  }

  // Step 3: Cap all other exposed interior edges with a directional border
  //         including bottom edges and outer corners.
  const snap2 = data.slice();

  // Helper: is a tile "open" (walkable, a visible edge, or the cap of a south-facing wall)?
  const isOpen = (id: number) =>
    id === TILE_FLOOR ||
    id === TILE_FLOOR_SHADOW ||
    id === TILE_WALL_FACE ||
    id === TILE_WALL_TOP;

  for (let y = 1; y < MAP_HEIGHT - 1; y++) {
    for (let x = 1; x < MAP_WIDTH - 1; x++) {
      const idx = y * MAP_WIDTH + x;
      if (snap2[idx] !== TILE_WALL_INTERIOR) continue;

      const left = snap2[idx - 1];
      const right = snap2[idx + 1];
      const top = snap2[idx - MAP_WIDTH];
      const bottom = snap2[idx + MAP_WIDTH];

      const eL = isOpen(left);
      const eR = isOpen(right);
      const eT = isOpen(top);
      const eB = isOpen(bottom);

      // ── Corners (two adjacent exposed sides) ──────────────────────
      if (eT && eL) {
        data[idx] = TILE_WALL_CORNER_TL;
      } else if (eT && eR) {
        data[idx] = TILE_WALL_CORNER_TR;
      } else if (eB && eL) {
        data[idx] = TILE_WALL_CORNER_BL;
      } else if (eB && eR) {
        data[idx] = TILE_WALL_CORNER_BR;
      }
      // ── Straight edges ────────────────────────────────────────────
      else if (eL) {
        data[idx] = TILE_WALL_SIDE_LEFT;
      } else if (eR) {
        data[idx] = TILE_WALL_SIDE_RIGHT;
      } else if (eB) {
        data[idx] = TILE_WALL_BOTTOM;
      } else if (eT) {
        data[idx] = TILE_WALL_TOP_EDGE;
      }
    }
  }

  // (Step 4 removed — shadows are now handled client-side via directional overlays)

  // ── Step 5: Central hub objective markers ─────────────────────────────────
  {
    const hubCx = hubTileX + Math.floor(hubSize / 2);
    const hubCy = hubTileY + Math.floor(hubSize / 2);

    // The redesigned hub renders and collides from exact pixel-authored data.
    // These three non-solid map markers retain objective identity for map scans.
    data[(hubCy + 3) * MAP_WIDTH + (hubCx - 6)] = TILE_RUNESTONE_1; // obelisk — left
    data[(hubCy + 4) * MAP_WIDTH + hubCx] = TILE_RUNESTONE_2; // shrine  — center
    data[(hubCy + 3) * MAP_WIDTH + (hubCx + 6)] = TILE_RUNESTONE_3; // jagged  — right
  }

  return data;
}

interface CellCoord {
  cx: number;
  cy: number;
}

const DEFAULT_LAYOUT_SPAWN_DISTANCE = 10;
const DEFAULT_LAYOUT_TEAM_COUNT = 3;
const GATE_MIDPOINT_OFFSET = Math.floor(CELL_SIZE / 2);
const BRIDGE_DENSITY = 0.16;
const MIN_BRIDGES = 4;
const MAX_BRIDGES = 12;
const BRIDGE_RANDOM_SALT = 0x5f3759df;
const SWAMP_DENSITY = 0.12;
const MIN_SWAMPS = 4;
const MAX_SWAMPS = 10;
const SWAMP_RANDOM_SALT = 0x2c1b3c6d;
// Keeps seed 44's editor fixture at the authored passage between cells (5,10) and (6,10).
const SWORD_FIELD_RANDOM_SALT = 0x11;
const SWORD_FIELD_DENSITY = 0.05;
const MIN_EXTRA_SWORD_FIELDS = 1;
const MAX_EXTRA_SWORD_FIELDS = 3;
const CHEST_RANDOM_SALT = 0x3c6ef017;
const CHEST_DEAD_END_SELECTION_SALT = 0x9e3779b9;
const TRAP_CELL_RANDOM_SALT = 0x6d2b79f5;
const T_INTERSECTION_DECORATION_RANDOM_SALT = 0x243f6a88;
const DECORATED_VERTICAL_PASSAGE_RANDOM_SALT = 0x13198a2e;
const T_INTERSECTION_DECORATION_CELL_OFFSETS = {
  north: [
    [0, 0],
    [-1, 0],
    [1, 0],
    [0, 1],
  ],
  south: [
    [0, 0],
    [-1, 0],
    [1, 0],
    [0, -1],
  ],
} as const;
export const TRAP_CELL_DENSITY = 0.06;
export const MIN_TRAP_CELLS = 6;
export const MAX_TRAP_CELLS = 10;
export const CHEST_DEAD_END_DENSITY = 0.6;
export const T_INTERSECTION_DECORATION_DENSITY = 0.85;
export const DECORATED_VERTICAL_PASSAGE_DENSITY = 0.16;
export const MIN_SWAMP_LENGTH_CELLS = 2;
export const MAX_SWAMP_LENGTH_CELLS = 5;
const SWAMP_LENGTH_WEIGHT_MULTIPLIER = 6;

function isWalkableTileId(tile: number): boolean {
  return tile === TILE_FLOOR || tile === TILE_FLOOR_SHADOW;
}

function spawnPointToCell(spawnPoint: SpawnPoint): CellCoord {
  return {
    cx: Math.round((spawnPoint.x - Math.floor(CELL_SIZE / 2) - WALL_WIDTH) / CELL_STEP_X),
    cy: Math.round(
      (spawnPoint.y - Math.floor(CELL_SIZE / 2) - WALL_HEIGHT) / CELL_STEP_Y,
    ),
  };
}

function occupySwordFieldCells(
  occupiedCells: Set<string>,
  swordField: Pick<SwordFieldPlacement, 'westCellX' | 'cellY'>,
): void {
  occupiedCells.add(`${swordField.westCellX},${swordField.cellY}`);
  occupiedCells.add(`${swordField.westCellX + 1},${swordField.cellY}`);
}

function findSafeSpawnPoint(data: number[], requested: SpawnPoint): SpawnPoint {
  const cell = spawnPointToCell(requested);
  const { tx, ty } = cellToTile(cell.cx, cell.cy);
  const center = Math.floor(CELL_SIZE / 2);
  const candidates: Array<{ x: number; y: number; distance: number }> = [];

  for (let dy = 0; dy < CELL_SIZE; dy++) {
    for (let dx = 0; dx < CELL_SIZE; dx++) {
      candidates.push({
        x: tx + dx,
        y: ty + dy,
        distance: Math.abs(dx - center) + Math.abs(dy - center),
      });
    }
  }
  candidates.sort((a, b) => a.distance - b.distance || a.y - b.y || a.x - b.x);

  for (const candidate of candidates) {
    const feetTile = data[candidate.y * MAP_WIDTH + candidate.x];
    const bodyTile =
      candidate.y > 0
        ? data[(candidate.y - 1) * MAP_WIDTH + candidate.x]
        : TILE_WALL_INTERIOR;
    if (isWalkableTileId(feetTile) && isWalkableTileId(bodyTile)) {
      return { x: candidate.x, y: candidate.y };
    }
  }

  // Defensive fallback for a malformed cell: choose the closest walkable map
  // tile rather than ever returning a solid-wall coordinate.
  let closest: SpawnPoint | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;
  for (let y = 0; y < MAP_HEIGHT; y++) {
    for (let x = 0; x < MAP_WIDTH; x++) {
      if (!isWalkableTileId(data[y * MAP_WIDTH + x])) continue;
      const distance = Math.abs(x - requested.x) + Math.abs(y - requested.y);
      if (distance >= closestDistance) continue;
      closest = { x, y };
      closestDistance = distance;
    }
  }
  return closest ?? requested;
}

function getGateOrientationForCell(
  data: number[],
  cx: number,
  cy: number,
): GateOrientation | null {
  const northOpen = cy > 0 && areCellsConnected(data, cx, cy, cx, cy - 1);
  const eastOpen = cx < GRID_CELLS - 1 && areCellsConnected(data, cx, cy, cx + 1, cy);
  const southOpen = cy < GRID_CELLS - 1 && areCellsConnected(data, cx, cy, cx, cy + 1);
  const westOpen = cx > 0 && areCellsConnected(data, cx, cy, cx - 1, cy);

  // Only place gates in vertical passages (north-south corridors)
  if (northOpen && southOpen && !eastOpen && !westOpen) {
    return 'horizontal';
  }

  return null;
}

function findPathToHub(
  data: number[],
  start: CellCoord,
  hubCells: Set<string>,
): CellCoord[] | null {
  const startKey = `${start.cx},${start.cy}`;
  const queue: CellCoord[] = [start];
  const visited = new Set<string>([startKey]);
  const parents = new Map<string, string | null>([[startKey, null]]);

  let head = 0;
  while (head < queue.length) {
    const current = queue[head++];
    const currentKey = `${current.cx},${current.cy}`;

    if (hubCells.has(currentKey)) {
      const path: CellCoord[] = [];
      let walkKey: string | null = currentKey;
      while (walkKey) {
        const [cx, cy] = walkKey.split(',').map(Number);
        path.push({ cx, cy });
        walkKey = parents.get(walkKey) ?? null;
      }
      path.reverse();
      return path;
    }

    for (const dir of DIRS) {
      const nextCx = current.cx + dir.dx;
      const nextCy = current.cy + dir.dy;
      if (nextCx < 0 || nextCx >= GRID_CELLS || nextCy < 0 || nextCy >= GRID_CELLS)
        continue;
      if (!areCellsConnected(data, current.cx, current.cy, nextCx, nextCy)) continue;

      const nextKey = `${nextCx},${nextCy}`;
      if (visited.has(nextKey)) continue;

      visited.add(nextKey);
      parents.set(nextKey, currentKey);
      queue.push({ cx: nextCx, cy: nextCy });
    }
  }

  return null;
}

function createGatePlacement(
  teamIndex: number,
  cellX: number,
  cellY: number,
  orientation: GateOrientation,
  spawnDirection: GateSpawnDirection,
): GatePlacement {
  const { tx, ty } = cellToTile(cellX, cellY);

  if (orientation === 'horizontal') {
    return {
      teamIndex,
      cellX,
      cellY,
      tileX: tx,
      tileY: ty + GATE_MIDPOINT_OFFSET,
      orientation,
      spawnDirection,
    };
  }

  return {
    teamIndex,
    cellX,
    cellY,
    tileX: tx + GATE_MIDPOINT_OFFSET,
    tileY: ty,
    orientation,
    spawnDirection,
  };
}

function stampGate(data: number[], gate: GatePlacement): void {
  if (gate.orientation === 'horizontal') {
    for (let dx = 0; dx < CELL_SIZE; dx++) {
      data[gate.tileY * MAP_WIDTH + (gate.tileX + dx)] = TILE_GATE_HORIZONTAL;
    }
    return;
  }

  for (let dy = 0; dy < CELL_SIZE; dy++) {
    data[(gate.tileY + dy) * MAP_WIDTH + gate.tileX] = TILE_GATE_VERTICAL;
  }
}

function stampDirtRect(
  dirtMask: Uint8Array,
  startX: number,
  startY: number,
  width: number,
  height: number,
): void {
  const clampedStartX = Math.max(0, startX);
  const clampedStartY = Math.max(0, startY);
  const clampedEndX = Math.min(MAP_WIDTH, startX + width);
  const clampedEndY = Math.min(MAP_HEIGHT, startY + height);

  for (let y = clampedStartY; y < clampedEndY; y++) {
    for (let x = clampedStartX; x < clampedEndX; x++) {
      dirtMask[y * MAP_WIDTH + x] = 1;
    }
  }
}

function stampGateDirtBand(dirtMask: Uint8Array, gate: GatePlacement): void {
  if (gate.orientation === 'horizontal') {
    // Expand dirt band further: cover (gateRow - 5 to gateRow + 4)
    stampDirtRect(dirtMask, gate.tileX, gate.tileY - 5, CELL_SIZE, 10);
    return;
  }

  stampDirtRect(dirtMask, gate.tileX - 1, gate.tileY, 3, CELL_SIZE);
}

function computeGatePlacements(
  data: number[],
  spawnPoints: SpawnPoint[],
): GatePlacement[] {
  const hubBounds = getHubTileBounds(MAP_WIDTH, MAP_HEIGHT);
  const hubCells = getHubCells(hubBounds.left, hubBounds.top, HUB_SIZE);
  const usedCells = new Set<string>();
  const gates: GatePlacement[] = [];

  for (let teamIndex = 0; teamIndex < spawnPoints.length; teamIndex++) {
    const spawnCell = spawnPointToCell(spawnPoints[teamIndex]);
    const pathToHub = findPathToHub(data, spawnCell, hubCells);
    if (!pathToHub) continue;

    for (let i = 1; i < pathToHub.length - 1; i++) {
      const cell = pathToHub[i];
      const cellKey = `${cell.cx},${cell.cy}`;
      if (usedCells.has(cellKey)) continue;

      const orientation = getGateOrientationForCell(data, cell.cx, cell.cy);
      if (!orientation) continue;

      // Determine spawn direction: the previous cell in the path (closer to spawn)
      // tells us which side of the gate the spawn is on.
      const prevCell = pathToHub[i - 1];
      const spawnDirection: GateSpawnDirection =
        prevCell.cy < cell.cy ? 'north' : 'south';

      gates.push(
        createGatePlacement(teamIndex, cell.cx, cell.cy, orientation, spawnDirection),
      );
      usedCells.add(cellKey);
      break;
    }
  }

  return gates;
}

function computePressurePlates(gates: GatePlacement[]): PressurePlateInfo[] {
  const plates: PressurePlateInfo[] = [];
  let nextId = 0;

  for (let gateIndex = 0; gateIndex < gates.length; gateIndex++) {
    const gate = gates[gateIndex];
    // Only horizontal gates (in vertical N-S corridors) get pressure plates
    if (gate.orientation !== 'horizontal') continue;

    const { tx } = cellToTile(gate.cellX, gate.cellY);
    const gateRow = gate.tileY; // The row where the gate barrier sits

    // Spawn side: 2 plates, 3 rows away from gate toward spawn
    // Hub side: 1 plate centered, 3 rows away from gate toward hub
    const spawnRow = gate.spawnDirection === 'north' ? gateRow - 4 : gateRow + 3;
    const hubRow = gate.spawnDirection === 'north' ? gateRow + 3 : gateRow - 4;

    // Spawn side — left plate (1 tile offset from corridor edge)
    plates.push({
      id: nextId++,
      gateIndex,
      tileX: tx + 1,
      tileY: spawnRow,
      side: 'spawn',
    });

    // Spawn side — right plate (1 tile offset from corridor edge)
    plates.push({
      id: nextId++,
      gateIndex,
      tileX: tx + CELL_SIZE - 2,
      tileY: spawnRow,
      side: 'spawn',
    });

    // Hub side — offset plate (one tile right from center)
    plates.push({
      id: nextId++,
      gateIndex,
      tileX: tx + Math.floor(CELL_SIZE / 2) + 1,
      tileY: hubRow,
      side: 'hub',
    });
  }

  return plates;
}

function isEmptyObstacleCell(data: number[], cx: number, cy: number): boolean {
  const { tx, ty } = cellToTile(cx, cy);
  for (let dy = 0; dy < CELL_SIZE; dy++) {
    for (let dx = 0; dx < CELL_SIZE; dx++) {
      if (!isWalkableTileId(data[(ty + dy) * MAP_WIDTH + (tx + dx)])) return false;
    }
  }
  return true;
}

function isForestWallTileId(tile: number): boolean {
  return tile >= TILE_WALL_FACE && tile <= TILE_WALL_TOP_EDGE;
}

function supportsBridge(data: number[], cx: number, northCy: number): boolean {
  const { tx, ty } = cellToTile(cx, northCy);
  const passageY = ty + CELL_SIZE;

  // The authored layout fills a complete 6×10 north-south opening.
  for (let dy = 0; dy < WALL_HEIGHT; dy++) {
    for (let dx = 0; dx < CELL_SIZE; dx++) {
      if (!isWalkableTileId(data[(passageY + dy) * MAP_WIDTH + (tx + dx)])) return false;
    }

    // Preserve the forest banks visible along both sides of the bridge.
    if (!isForestWallTileId(data[(passageY + dy) * MAP_WIDTH + tx - 1])) return false;
    if (!isForestWallTileId(data[(passageY + dy) * MAP_WIDTH + tx + CELL_SIZE]))
      return false;
  }

  return true;
}

function computeBridgePlacements(
  data: number[],
  spawnPoints: SpawnPoint[],
  seed: number,
  reservedSwordFields: readonly SwordFieldPlacement[] = [],
): BridgePlacement[] {
  type BridgeCandidate = Omit<BridgePlacement, 'safeTileMask'>;
  const hubBounds = getHubTileBounds(MAP_WIDTH, MAP_HEIGHT);
  const hubCells = getHubCells(hubBounds.left, hubBounds.top, HUB_SIZE);
  const spawnCells = new Set(
    spawnPoints.map((spawnPoint) => {
      const cell = spawnPointToCell(spawnPoint);
      return `${cell.cx},${cell.cy}`;
    }),
  );
  const reservedCells = new Set<string>();
  for (const swordField of reservedSwordFields) {
    occupySwordFieldCells(reservedCells, swordField);
  }
  const candidates: BridgeCandidate[] = [];

  for (let northCellY = 0; northCellY < GRID_CELLS - 1; northCellY++) {
    for (let cellX = 0; cellX < GRID_CELLS; cellX++) {
      const northKey = `${cellX},${northCellY}`;
      const southKey = `${cellX},${northCellY + 1}`;
      if (hubCells.has(northKey) || hubCells.has(southKey)) continue;
      if (spawnCells.has(northKey) || spawnCells.has(southKey)) continue;
      if (reservedCells.has(northKey) || reservedCells.has(southKey)) continue;
      if (!isEmptyObstacleCell(data, cellX, northCellY)) continue;
      if (!isEmptyObstacleCell(data, cellX, northCellY + 1)) continue;
      if (!areCellsConnected(data, cellX, northCellY, cellX, northCellY + 1)) continue;
      if (!supportsBridge(data, cellX, northCellY)) continue;

      const { tx, ty } = cellToTile(cellX, northCellY);
      candidates.push({
        cellX,
        northCellY,
        tileX: tx,
        tileY: ty + CELL_SIZE,
      });
    }
  }

  const rand = mulberry32(seed ^ BRIDGE_RANDOM_SALT);
  shuffle(candidates, rand);
  const minimum = Math.min(MIN_BRIDGES, candidates.length);
  const desiredCount = Math.min(
    MAX_BRIDGES,
    candidates.length,
    Math.max(minimum, Math.round(candidates.length * BRIDGE_DENSITY)),
  );
  const occupiedCells = new Set<string>();
  const bridges: BridgeCandidate[] = [];

  for (const candidate of candidates) {
    if (bridges.length >= desiredCount) break;
    const northKey = `${candidate.cellX},${candidate.northCellY}`;
    const southKey = `${candidate.cellX},${candidate.northCellY + 1}`;
    if (occupiedCells.has(northKey) || occupiedCells.has(southKey)) continue;

    occupiedCells.add(northKey);
    occupiedCells.add(southKey);
    bridges.push(candidate);
  }

  bridges.sort((a, b) => a.northCellY - b.northCellY || a.cellX - b.cellX);
  const safeTileMasks = generateBridgeSafeTileMasks(bridges.length, seed);
  return bridges.map((bridge, bridgeIndex) => ({
    ...bridge,
    safeTileMask: safeTileMasks[bridgeIndex],
  }));
}

function supportsSwampPassage(data: number[], westCellX: number, cellY: number): boolean {
  const { tx, ty } = cellToTile(westCellX, cellY);
  const passageX = tx + CELL_SIZE;

  // The authored layout fills the complete 11×6 opening between two cells.
  for (let dx = 0; dx < WALL_WIDTH; dx++) {
    for (let dy = 0; dy < CELL_SIZE; dy++) {
      if (!isWalkableTileId(data[(ty + dy) * MAP_WIDTH + passageX + dx])) return false;
    }

    // Keep the forest banks visible along the north and south shoreline.
    if (!isForestWallTileId(data[(ty - 1) * MAP_WIDTH + passageX + dx])) return false;
    if (!isForestWallTileId(data[(ty + CELL_SIZE) * MAP_WIDTH + passageX + dx]))
      return false;
  }

  return true;
}

function supportsSwampInteriorCell(
  data: number[],
  cellX: number,
  cellY: number,
): boolean {
  const { tx, ty } = cellToTile(cellX, cellY);

  for (let dx = 0; dx < CELL_SIZE; dx++) {
    if (!isForestWallTileId(data[(ty - 1) * MAP_WIDTH + tx + dx])) return false;
    if (!isForestWallTileId(data[(ty + CELL_SIZE) * MAP_WIDTH + tx + dx])) return false;
  }

  return true;
}

function mixSwampSeed(seed: number, westCellX: number, cellY: number): number {
  let value = seed ^ SWAMP_RANDOM_SALT;
  value = Math.imul(value ^ (westCellX + 1), 0x45d9f3b);
  value = Math.imul(value ^ (cellY + 1), 0x119de1f3);
  value ^= value >>> 16;
  return value >>> 0;
}

function chooseSwampLength(maxLengthCells: number, rand: () => number): number {
  let totalWeight = 0;
  for (let length = MIN_SWAMP_LENGTH_CELLS; length <= maxLengthCells; length++) {
    totalWeight += SWAMP_LENGTH_WEIGHT_MULTIPLIER ** (length - MIN_SWAMP_LENGTH_CELLS);
  }

  let roll = rand() * totalWeight;
  for (let length = MIN_SWAMP_LENGTH_CELLS; length <= maxLengthCells; length++) {
    roll -= SWAMP_LENGTH_WEIGHT_MULTIPLIER ** (length - MIN_SWAMP_LENGTH_CELLS);
    if (roll < 0) return length;
  }

  return maxLengthCells;
}

function computeSwampPlacements(
  data: number[],
  spawnPoints: SpawnPoint[],
  bridges: readonly BridgePlacement[],
  seed: number,
  reservedSwordFields: readonly SwordFieldPlacement[] = [],
): SwampPlacement[] {
  interface SwampCandidate {
    westCellX: number;
    cellY: number;
    tileX: number;
    tileY: number;
    maxLengthCells: number;
    priority: number;
  }

  const hubBounds = getHubTileBounds(MAP_WIDTH, MAP_HEIGHT);
  const hubCells = getHubCells(hubBounds.left, hubBounds.top, HUB_SIZE);
  const spawnCells = new Set(
    spawnPoints.map((spawnPoint) => {
      const cell = spawnPointToCell(spawnPoint);
      return `${cell.cx},${cell.cy}`;
    }),
  );
  const occupiedCells = new Set<string>();
  for (const bridge of bridges) {
    occupiedCells.add(`${bridge.cellX},${bridge.northCellY}`);
    occupiedCells.add(`${bridge.cellX},${bridge.northCellY + 1}`);
  }
  for (const swordField of reservedSwordFields) {
    occupySwordFieldCells(occupiedCells, swordField);
  }

  const candidateRand = mulberry32(seed ^ SWAMP_RANDOM_SALT);
  const candidates: SwampCandidate[] = [];
  for (let cellY = 0; cellY < GRID_CELLS; cellY++) {
    for (let westCellX = 0; westCellX < GRID_CELLS - 1; westCellX++) {
      let maxLengthCells = 1;

      for (
        let lengthCells = MIN_SWAMP_LENGTH_CELLS;
        lengthCells <= MAX_SWAMP_LENGTH_CELLS;
        lengthCells++
      ) {
        const eastCellX = westCellX + lengthCells - 1;
        if (eastCellX >= GRID_CELLS) break;

        const eastKey = `${eastCellX},${cellY}`;
        if (
          hubCells.has(eastKey) ||
          spawnCells.has(eastKey) ||
          occupiedCells.has(eastKey)
        )
          break;
        if (!isEmptyObstacleCell(data, eastCellX, cellY)) break;

        if (lengthCells === MIN_SWAMP_LENGTH_CELLS) {
          const westKey = `${westCellX},${cellY}`;
          if (
            hubCells.has(westKey) ||
            spawnCells.has(westKey) ||
            occupiedCells.has(westKey) ||
            !isEmptyObstacleCell(data, westCellX, cellY)
          ) {
            break;
          }
        } else if (!supportsSwampInteriorCell(data, eastCellX - 1, cellY)) {
          break;
        }

        if (
          !areCellsConnected(data, eastCellX - 1, cellY, eastCellX, cellY) ||
          !supportsSwampPassage(data, eastCellX - 1, cellY)
        ) {
          break;
        }

        maxLengthCells = lengthCells;
      }

      if (maxLengthCells < MIN_SWAMP_LENGTH_CELLS) continue;

      const { tx, ty } = cellToTile(westCellX, cellY);
      const lengthWeight =
        SWAMP_LENGTH_WEIGHT_MULTIPLIER ** (maxLengthCells - MIN_SWAMP_LENGTH_CELLS);
      candidates.push({
        westCellX,
        cellY,
        tileX: tx + CELL_SIZE,
        tileY: ty,
        maxLengthCells,
        priority: candidateRand() ** (1 / lengthWeight),
      });
    }
  }

  const rand = mulberry32(seed ^ SWAMP_RANDOM_SALT);
  candidates.sort((a, b) => b.priority - a.priority);
  const minimum = Math.min(MIN_SWAMPS, candidates.length);
  const desiredCount = Math.min(
    MAX_SWAMPS,
    candidates.length,
    Math.max(minimum, Math.round(candidates.length * SWAMP_DENSITY)),
  );
  const swamps: SwampPlacement[] = [];

  for (const candidate of candidates) {
    if (swamps.length >= desiredCount) break;
    let availableLengthCells = 0;
    for (let offset = 0; offset < candidate.maxLengthCells; offset++) {
      const cellKey = `${candidate.westCellX + offset},${candidate.cellY}`;
      if (occupiedCells.has(cellKey)) break;
      availableLengthCells = offset + 1;
    }
    if (availableLengthCells < MIN_SWAMP_LENGTH_CELLS) continue;

    const lengthCells = chooseSwampLength(availableLengthCells, rand);
    for (let offset = 0; offset < lengthCells; offset++) {
      occupiedCells.add(`${candidate.westCellX + offset},${candidate.cellY}`);
    }
    swamps.push({
      westCellX: candidate.westCellX,
      cellY: candidate.cellY,
      lengthCells,
      decorationSeed: mixSwampSeed(seed, candidate.westCellX, candidate.cellY),
      tileX: candidate.tileX,
      tileY: candidate.tileY,
    });
  }

  swamps.sort((a, b) => a.cellY - b.cellY || a.westCellX - b.westCellX);
  return swamps;
}

interface SwordFieldCandidate extends SwordFieldPlacement {
  rank: number;
}

function getSwordFieldRank(seed: number, westCellX: number, cellY: number): number {
  let mixedSeed = seed ^ SWORD_FIELD_RANDOM_SALT;
  mixedSeed = Math.imul(mixedSeed ^ (westCellX + 1), 0x45d9f3b);
  mixedSeed = Math.imul(mixedSeed ^ (cellY + 1), 0x119de1f3);
  mixedSeed ^= mixedSeed >>> 16;
  return mulberry32(mixedSeed)();
}

function collectSwordFieldCandidates(
  data: number[],
  occupiedCells: ReadonlySet<string>,
  seed: number,
): SwordFieldCandidate[] {
  const candidates: SwordFieldCandidate[] = [];
  for (let cellY = 0; cellY < GRID_CELLS; cellY++) {
    for (let westCellX = 0; westCellX < GRID_CELLS - 1; westCellX++) {
      const westKey = `${westCellX},${cellY}`;
      const eastKey = `${westCellX + 1},${cellY}`;
      if (occupiedCells.has(westKey) || occupiedCells.has(eastKey)) continue;
      if (!isEmptyObstacleCell(data, westCellX, cellY)) continue;
      if (!isEmptyObstacleCell(data, westCellX + 1, cellY)) continue;
      if (!areCellsConnected(data, westCellX, cellY, westCellX + 1, cellY)) continue;
      if (!supportsSwampPassage(data, westCellX, cellY)) continue;

      const { tx, ty } = cellToTile(westCellX, cellY);
      candidates.push({
        westCellX,
        cellY,
        tileX: tx + CELL_SIZE,
        tileY: ty,
        rank: getSwordFieldRank(seed, westCellX, cellY),
      });
    }
  }
  return candidates;
}

function swordFieldCandidateKey(
  placement: Pick<SwordFieldPlacement, 'westCellX' | 'cellY'>,
): string {
  return `${placement.westCellX},${placement.cellY}`;
}

/**
 * Reserve non-overlapping east-west barriers on the generated route from every
 * team spawn to the hub. These reservations are made before other authored
 * obstacles so later placement cannot steal the required passages.
 */
export function computeTeamRouteSwordFieldPlacements(
  data: number[],
  spawnPoints: readonly SpawnPoint[],
  seed: number,
): SwordFieldPlacement[] {
  const hubBounds = getHubTileBounds(MAP_WIDTH, MAP_HEIGHT);
  const hubCells = getHubCells(hubBounds.left, hubBounds.top, HUB_SIZE);
  const occupiedCells = new Set(hubCells);
  for (const spawnPoint of spawnPoints) {
    const { cx, cy } = spawnPointToCell(spawnPoint);
    occupiedCells.add(`${cx},${cy}`);
  }

  const candidates = collectSwordFieldCandidates(data, occupiedCells, seed);
  const candidateIndexByKey = new Map(
    candidates.map((candidate, index) => [swordFieldCandidateKey(candidate), index]),
  );
  const teamCandidatePositions = spawnPoints.map((spawnPoint) => {
    const path = findPathToHub(data, spawnPointToCell(spawnPoint), hubCells);
    const positions = new Map<number, number>();
    if (!path) return positions;

    for (let pathIndex = 0; pathIndex < path.length - 1; pathIndex++) {
      const from = path[pathIndex];
      const to = path[pathIndex + 1];
      if (from.cy !== to.cy) continue;
      const candidateIndex = candidateIndexByKey.get(
        `${Math.min(from.cx, to.cx)},${from.cy}`,
      );
      if (candidateIndex !== undefined) positions.set(candidateIndex, pathIndex);
    }
    return positions;
  });

  const selectedCandidateIndices: number[] = [];
  const usedCells = new Set<string>();
  const allTeamsMask = (1 << spawnPoints.length) - 1;

  const candidateCoverageMask = candidates.map((_, candidateIndex) => {
    let mask = 0;
    for (let teamIndex = 0; teamIndex < teamCandidatePositions.length; teamIndex++) {
      if (teamCandidatePositions[teamIndex].has(candidateIndex)) {
        mask |= 1 << teamIndex;
      }
    }
    return mask;
  });

  const overlapsSelected = (candidate: SwordFieldCandidate): boolean =>
    usedCells.has(`${candidate.westCellX},${candidate.cellY}`) ||
    usedCells.has(`${candidate.westCellX + 1},${candidate.cellY}`);

  const search = (coveredTeamsMask: number): boolean => {
    if (coveredTeamsMask === allTeamsMask) return true;

    let nextTeamIndex = -1;
    let nextTeamOptions: number[] = [];
    for (let teamIndex = 0; teamIndex < teamCandidatePositions.length; teamIndex++) {
      if ((coveredTeamsMask & (1 << teamIndex)) !== 0) continue;
      const options = [...teamCandidatePositions[teamIndex].keys()].filter(
        (candidateIndex) =>
          (candidateCoverageMask[candidateIndex] & coveredTeamsMask) === 0 &&
          !overlapsSelected(candidates[candidateIndex]),
      );
      if (nextTeamIndex === -1 || options.length < nextTeamOptions.length) {
        nextTeamIndex = teamIndex;
        nextTeamOptions = options;
      }
    }

    if (nextTeamIndex === -1 || nextTeamOptions.length === 0) return false;
    nextTeamOptions.sort((a, b) => {
      const aNewCoverage = candidateCoverageMask[a] & ~coveredTeamsMask;
      const bNewCoverage = candidateCoverageMask[b] & ~coveredTeamsMask;
      const aCoverageCount = aNewCoverage.toString(2).replaceAll('0', '').length;
      const bCoverageCount = bNewCoverage.toString(2).replaceAll('0', '').length;
      if (bCoverageCount !== aCoverageCount) return bCoverageCount - aCoverageCount;
      const aPosition = teamCandidatePositions[nextTeamIndex].get(a) ?? Infinity;
      const bPosition = teamCandidatePositions[nextTeamIndex].get(b) ?? Infinity;
      return aPosition - bPosition || candidates[a].rank - candidates[b].rank;
    });

    for (const candidateIndex of nextTeamOptions) {
      const candidate = candidates[candidateIndex];
      selectedCandidateIndices.push(candidateIndex);
      occupySwordFieldCells(usedCells, candidate);
      if (search(coveredTeamsMask | candidateCoverageMask[candidateIndex])) return true;
      selectedCandidateIndices.pop();
      usedCells.delete(`${candidate.westCellX},${candidate.cellY}`);
      usedCells.delete(`${candidate.westCellX + 1},${candidate.cellY}`);
    }
    return false;
  };

  if (!search(0)) return [];
  return selectedCandidateIndices.map((candidateIndex) => {
    const candidate = candidates[candidateIndex];
    return {
      westCellX: candidate.westCellX,
      cellY: candidate.cellY,
      tileX: candidate.tileX,
      tileY: candidate.tileY,
    };
  });
}

/** Add deterministic scattered barriers without overlapping authored obstacles. */
export function computeSwordFieldPlacements(
  data: number[],
  spawnPoints: readonly SpawnPoint[],
  bridges: readonly BridgePlacement[],
  swamps: readonly SwampPlacement[],
  chestDeadEnds: readonly ChestDeadEndPlacement[],
  portalPosition: SpawnPoint | null,
  seed: number,
  requiredPlacements: readonly SwordFieldPlacement[] = [],
): SwordFieldPlacement[] {
  const hubBounds = getHubTileBounds(MAP_WIDTH, MAP_HEIGHT);
  const hubCells = getHubCells(hubBounds.left, hubBounds.top, HUB_SIZE);
  const occupiedCells = new Set(hubCells);
  const directRoutePassages = new Set<string>();

  for (const spawnPoint of spawnPoints) {
    const { cx, cy } = spawnPointToCell(spawnPoint);
    occupiedCells.add(`${cx},${cy}`);
    const path = findPathToHub(data, { cx, cy }, hubCells);
    if (!path) continue;
    for (let pathIndex = 0; pathIndex < path.length - 1; pathIndex++) {
      const from = path[pathIndex];
      const to = path[pathIndex + 1];
      if (from.cy !== to.cy) continue;
      directRoutePassages.add(`${Math.min(from.cx, to.cx)},${from.cy}`);
    }
  }
  for (const bridge of bridges) {
    occupiedCells.add(`${bridge.cellX},${bridge.northCellY}`);
    occupiedCells.add(`${bridge.cellX},${bridge.northCellY + 1}`);
  }
  for (const swamp of swamps) {
    for (let offset = 0; offset < swamp.lengthCells; offset++) {
      occupiedCells.add(`${swamp.westCellX + offset},${swamp.cellY}`);
    }
  }
  for (const chest of chestDeadEnds) {
    occupiedCells.add(`${chest.cellX},${chest.cellY}`);
  }
  if (portalPosition) {
    const portalCellX = Math.round(
      (portalPosition.x - CELL_SIZE / 2 - WALL_WIDTH) / CELL_STEP_X,
    );
    const portalCellY = Math.round((portalPosition.y + 0.75 - WALL_HEIGHT) / CELL_STEP_Y);
    occupiedCells.add(`${portalCellX},${portalCellY}`);
    occupiedCells.add(`${portalCellX},${portalCellY - 1}`);
  }
  const placements = requiredPlacements.map((placement) => ({ ...placement }));
  for (const placement of placements) occupySwordFieldCells(occupiedCells, placement);

  const candidates = collectSwordFieldCandidates(data, occupiedCells, seed).filter(
    (candidate) => !directRoutePassages.has(swordFieldCandidateKey(candidate)),
  );
  candidates.sort(
    (a, b) => a.rank - b.rank || a.cellY - b.cellY || a.westCellX - b.westCellX,
  );
  const desiredExtraCount = Math.min(
    MAX_EXTRA_SWORD_FIELDS,
    candidates.length,
    Math.max(MIN_EXTRA_SWORD_FIELDS, Math.round(candidates.length * SWORD_FIELD_DENSITY)),
  );

  for (const candidate of candidates) {
    if (placements.length >= requiredPlacements.length + desiredExtraCount) break;
    const westKey = `${candidate.westCellX},${candidate.cellY}`;
    const eastKey = `${candidate.westCellX + 1},${candidate.cellY}`;
    if (occupiedCells.has(westKey) || occupiedCells.has(eastKey)) continue;
    placements.push({
      westCellX: candidate.westCellX,
      cellY: candidate.cellY,
      tileX: candidate.tileX,
      tileY: candidate.tileY,
    });
    occupySwordFieldCells(occupiedCells, candidate);
  }

  placements.sort((a, b) => a.cellY - b.cellY || a.westCellX - b.westCellX);
  return placements;
}

function getTrapCellRank(seed: number, cellX: number, cellY: number): number {
  let value = seed ^ TRAP_CELL_RANDOM_SALT;
  value = Math.imul(value ^ (cellX + 1), 0x45d9f3b);
  value = Math.imul(value ^ (cellY + 1), 0x119de1f3);
  value ^= value >>> 16;
  return value >>> 0;
}

/**
 * Select deterministic, well-spaced trap cells without overlapping any authored
 * objective, spawn, hub, or obstacle prefab.
 */
export function computeTrapCellPlacements(
  data: number[],
  spawnPoints: readonly SpawnPoint[],
  gates: readonly GatePlacement[],
  bridges: readonly BridgePlacement[],
  swamps: readonly SwampPlacement[],
  swordFields: readonly SwordFieldPlacement[],
  chestDeadEnds: readonly ChestDeadEndPlacement[],
  portalPosition: SpawnPoint | null,
  seed: number,
): TrapCellPlacement[] {
  const hubBounds = getHubTileBounds(MAP_WIDTH, MAP_HEIGHT);
  const occupiedCells = getHubCells(hubBounds.left, hubBounds.top, HUB_SIZE);

  for (const spawnPoint of spawnPoints) {
    const { cx, cy } = spawnPointToCell(spawnPoint);
    occupiedCells.add(`${cx},${cy}`);
  }
  for (const gate of gates) occupiedCells.add(`${gate.cellX},${gate.cellY}`);
  for (const bridge of bridges) {
    occupiedCells.add(`${bridge.cellX},${bridge.northCellY}`);
    occupiedCells.add(`${bridge.cellX},${bridge.northCellY + 1}`);
  }
  for (const swamp of swamps) {
    for (let offset = 0; offset < swamp.lengthCells; offset++) {
      occupiedCells.add(`${swamp.westCellX + offset},${swamp.cellY}`);
    }
  }
  for (const swordField of swordFields) occupySwordFieldCells(occupiedCells, swordField);
  for (const chest of chestDeadEnds) occupiedCells.add(`${chest.cellX},${chest.cellY}`);

  if (portalPosition) {
    const portalCellX = Math.round(
      (portalPosition.x - CELL_SIZE / 2 - WALL_WIDTH) / CELL_STEP_X,
    );
    const portalCellY = Math.round((portalPosition.y + 0.75 - WALL_HEIGHT) / CELL_STEP_Y);
    occupiedCells.add(`${portalCellX},${portalCellY}`);
    occupiedCells.add(`${portalCellX},${portalCellY - 1}`);
  }

  const candidates: Array<TrapCellPlacement & { rank: number }> = [];
  for (let cellY = 0; cellY < GRID_CELLS; cellY++) {
    for (let cellX = 0; cellX < GRID_CELLS; cellX++) {
      if (occupiedCells.has(`${cellX},${cellY}`)) continue;
      if (!isEmptyObstacleCell(data, cellX, cellY)) continue;
      const { tx, ty } = cellToTile(cellX, cellY);
      candidates.push({
        cellX,
        cellY,
        tileX: tx,
        tileY: ty,
        rank: getTrapCellRank(seed, cellX, cellY),
      });
    }
  }

  candidates.sort((a, b) => a.rank - b.rank || a.cellY - b.cellY || a.cellX - b.cellX);
  const minimum = Math.min(MIN_TRAP_CELLS, candidates.length);
  const desiredCount = Math.min(
    MAX_TRAP_CELLS,
    candidates.length,
    Math.max(minimum, Math.round(candidates.length * TRAP_CELL_DENSITY)),
  );
  const selected: typeof candidates = [];

  // Prefer one full cell of separation so each red region reads independently.
  for (const candidate of candidates) {
    if (selected.length >= desiredCount) break;
    if (
      selected.some(
        (existing) =>
          Math.abs(existing.cellX - candidate.cellX) <= 1 &&
          Math.abs(existing.cellY - candidate.cellY) <= 1,
      )
    ) {
      continue;
    }
    selected.push(candidate);
  }

  // Extremely constrained layouts may not satisfy spacing; preserve the count.
  for (const candidate of candidates) {
    if (selected.length >= desiredCount) break;
    if (!selected.includes(candidate)) selected.push(candidate);
  }

  return selected
    .map(({ rank: _rank, ...placement }) => placement)
    .sort((a, b) => a.cellY - b.cellY || a.cellX - b.cellX);
}

function getTIntersectionDecorationRank(
  seed: number,
  cellX: number,
  cellY: number,
  closedDirection: TIntersectionDecorationPlacement['closedDirection'],
): number {
  let value =
    seed ^
    T_INTERSECTION_DECORATION_RANDOM_SALT ^
    (closedDirection === 'north' ? 0 : 0x85ebca6b);
  value = Math.imul(value ^ (cellX + 1), 0x45d9f3b);
  value = Math.imul(value ^ (cellY + 1), 0x119de1f3);
  value ^= value >>> 16;
  return value >>> 0;
}

/**
 * Select compatible north- or south-closed T-junctions for their exact
 * style-editor prefabs. The center, lateral cells, and open vertical cell must
 * all be free of solid authored occupants.
 */
export function computeTIntersectionDecorationPlacements(
  data: number[],
  spawnPoints: readonly SpawnPoint[],
  gates: readonly GatePlacement[],
  bridges: readonly BridgePlacement[],
  swamps: readonly SwampPlacement[],
  swordFields: readonly SwordFieldPlacement[],
  chestDeadEnds: readonly ChestDeadEndPlacement[],
  portalPosition: SpawnPoint | null,
  seed: number,
  density: number = T_INTERSECTION_DECORATION_DENSITY,
): TIntersectionDecorationPlacement[] {
  const hubBounds = getHubTileBounds(MAP_WIDTH, MAP_HEIGHT);
  const occupiedCells = getHubCells(hubBounds.left, hubBounds.top, HUB_SIZE);

  for (const spawnPoint of spawnPoints) {
    const { cx, cy } = spawnPointToCell(spawnPoint);
    occupiedCells.add(`${cx},${cy}`);
  }
  for (const gate of gates) occupiedCells.add(`${gate.cellX},${gate.cellY}`);
  for (const bridge of bridges) {
    occupiedCells.add(`${bridge.cellX},${bridge.northCellY}`);
    occupiedCells.add(`${bridge.cellX},${bridge.northCellY + 1}`);
  }
  for (const swamp of swamps) {
    for (let offset = 0; offset < swamp.lengthCells; offset++) {
      occupiedCells.add(`${swamp.westCellX + offset},${swamp.cellY}`);
    }
  }
  for (const swordField of swordFields) occupySwordFieldCells(occupiedCells, swordField);
  for (const chest of chestDeadEnds) occupiedCells.add(`${chest.cellX},${chest.cellY}`);

  if (portalPosition) {
    const portalCellX = Math.round(
      (portalPosition.x - CELL_SIZE / 2 - WALL_WIDTH) / CELL_STEP_X,
    );
    const portalCellY = Math.round((portalPosition.y + 0.75 - WALL_HEIGHT) / CELL_STEP_Y);
    occupiedCells.add(`${portalCellX},${portalCellY}`);
    occupiedCells.add(`${portalCellX},${portalCellY - 1}`);
  }

  const candidates: Array<TIntersectionDecorationPlacement & { rank: number }> = [];
  for (let cellY = 0; cellY < GRID_CELLS; cellY++) {
    for (let cellX = 0; cellX < GRID_CELLS; cellX++) {
      const northOpen =
        cellY > 0 && areCellsConnected(data, cellX, cellY, cellX, cellY - 1);
      const eastOpen =
        cellX < GRID_CELLS - 1 && areCellsConnected(data, cellX, cellY, cellX + 1, cellY);
      const southOpen =
        cellY < GRID_CELLS - 1 && areCellsConnected(data, cellX, cellY, cellX, cellY + 1);
      const westOpen =
        cellX > 0 && areCellsConnected(data, cellX, cellY, cellX - 1, cellY);
      const closedDirection =
        !northOpen && eastOpen && southOpen && westOpen
          ? 'north'
          : northOpen && eastOpen && !southOpen && westOpen
            ? 'south'
            : null;
      if (!closedDirection) continue;
      const footprintOffsets = T_INTERSECTION_DECORATION_CELL_OFFSETS[closedDirection];
      if (
        footprintOffsets.some(([offsetX, offsetY]) => {
          const footprintCellX = cellX + offsetX;
          const footprintCellY = cellY + offsetY;
          return (
            occupiedCells.has(`${footprintCellX},${footprintCellY}`) ||
            !isEmptyObstacleCell(data, footprintCellX, footprintCellY)
          );
        })
      ) {
        continue;
      }

      const { tx, ty } = cellToTile(cellX, cellY);
      candidates.push({
        cellX,
        cellY,
        closedDirection,
        tileX: tx,
        tileY: ty,
        rank: getTIntersectionDecorationRank(seed, cellX, cellY, closedDirection),
      });
    }
  }

  candidates.sort((a, b) => a.rank - b.rank || a.cellY - b.cellY || a.cellX - b.cellX);
  const clampedDensity = Math.max(0, Math.min(1, density));
  const desiredCount = Math.min(
    candidates.length,
    Math.max(
      candidates.length > 0 && clampedDensity > 0 ? 1 : 0,
      Math.round(candidates.length * clampedDensity),
    ),
  );
  const selected: typeof candidates = [];
  const selectedFootprintCells = new Set(occupiedCells);

  for (const candidate of candidates) {
    if (selected.length >= desiredCount) break;
    const footprintOffsets =
      T_INTERSECTION_DECORATION_CELL_OFFSETS[candidate.closedDirection];
    if (
      footprintOffsets.some(([offsetX, offsetY]) =>
        selectedFootprintCells.has(
          `${candidate.cellX + offsetX},${candidate.cellY + offsetY}`,
        ),
      )
    ) {
      continue;
    }
    selected.push(candidate);
    for (const [offsetX, offsetY] of footprintOffsets) {
      selectedFootprintCells.add(
        `${candidate.cellX + offsetX},${candidate.cellY + offsetY}`,
      );
    }
  }

  return selected
    .map(({ rank: _rank, ...placement }) => placement)
    .sort((a, b) => a.cellY - b.cellY || a.cellX - b.cellX);
}

function getDecoratedVerticalPassageRank(
  seed: number,
  cellX: number,
  northCellY: number,
): number {
  let value = seed ^ DECORATED_VERTICAL_PASSAGE_RANDOM_SALT;
  value = Math.imul(value ^ (cellX + 1), 0x45d9f3b);
  value = Math.imul(value ^ (northCellY + 1), 0x119de1f3);
  value = Math.imul(value ^ (value >>> 16), 0x85ebca6b);
  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35);
  value ^= value >>> 16;
  return value >>> 0;
}

/**
 * Select non-overlapping open north-south passages for the exact two-cell
 * style-editor composition. Both logical cells must be free of every other
 * generated cell occupant, including traps and decorated T-junctions.
 */
export function computeDecoratedVerticalPassagePlacements(
  data: number[],
  spawnPoints: readonly SpawnPoint[],
  gates: readonly GatePlacement[],
  bridges: readonly BridgePlacement[],
  swamps: readonly SwampPlacement[],
  swordFields: readonly SwordFieldPlacement[],
  trapCells: readonly TrapCellPlacement[],
  chestDeadEnds: readonly ChestDeadEndPlacement[],
  tIntersectionDecorations: readonly TIntersectionDecorationPlacement[],
  portalPosition: SpawnPoint | null,
  seed: number,
  density: number = DECORATED_VERTICAL_PASSAGE_DENSITY,
): DecoratedVerticalPassagePlacement[] {
  const hubBounds = getHubTileBounds(MAP_WIDTH, MAP_HEIGHT);
  const occupiedCells = getHubCells(hubBounds.left, hubBounds.top, HUB_SIZE);

  for (const spawnPoint of spawnPoints) {
    const { cx, cy } = spawnPointToCell(spawnPoint);
    occupiedCells.add(`${cx},${cy}`);
  }
  for (const gate of gates) occupiedCells.add(`${gate.cellX},${gate.cellY}`);
  for (const bridge of bridges) {
    occupiedCells.add(`${bridge.cellX},${bridge.northCellY}`);
    occupiedCells.add(`${bridge.cellX},${bridge.northCellY + 1}`);
  }
  for (const swamp of swamps) {
    for (let offset = 0; offset < swamp.lengthCells; offset++) {
      occupiedCells.add(`${swamp.westCellX + offset},${swamp.cellY}`);
    }
  }
  for (const swordField of swordFields) occupySwordFieldCells(occupiedCells, swordField);
  for (const trapCell of trapCells)
    occupiedCells.add(`${trapCell.cellX},${trapCell.cellY}`);
  for (const chest of chestDeadEnds) occupiedCells.add(`${chest.cellX},${chest.cellY}`);
  for (const decoration of tIntersectionDecorations) {
    for (const [offsetX, offsetY] of T_INTERSECTION_DECORATION_CELL_OFFSETS[
      decoration.closedDirection
    ]) {
      occupiedCells.add(`${decoration.cellX + offsetX},${decoration.cellY + offsetY}`);
    }
  }

  if (portalPosition) {
    const portalCellX = Math.round(
      (portalPosition.x - CELL_SIZE / 2 - WALL_WIDTH) / CELL_STEP_X,
    );
    const portalCellY = Math.round((portalPosition.y + 0.75 - WALL_HEIGHT) / CELL_STEP_Y);
    occupiedCells.add(`${portalCellX},${portalCellY}`);
    occupiedCells.add(`${portalCellX},${portalCellY - 1}`);
  }

  const candidates: Array<DecoratedVerticalPassagePlacement & { rank: number }> = [];
  for (let northCellY = 0; northCellY < GRID_CELLS - 1; northCellY++) {
    for (let cellX = 0; cellX < GRID_CELLS; cellX++) {
      const northKey = `${cellX},${northCellY}`;
      const southKey = `${cellX},${northCellY + 1}`;
      if (occupiedCells.has(northKey) || occupiedCells.has(southKey)) continue;
      if (!isEmptyObstacleCell(data, cellX, northCellY)) continue;
      if (!isEmptyObstacleCell(data, cellX, northCellY + 1)) continue;
      if (!areCellsConnected(data, cellX, northCellY, cellX, northCellY + 1)) continue;

      const { tx, ty } = cellToTile(cellX, northCellY);
      candidates.push({
        cellX,
        northCellY,
        tileX: tx,
        tileY: ty + CELL_SIZE,
        rank: getDecoratedVerticalPassageRank(seed, cellX, northCellY),
      });
    }
  }

  candidates.sort(
    (a, b) => a.rank - b.rank || a.northCellY - b.northCellY || a.cellX - b.cellX,
  );
  const clampedDensity = Math.max(0, Math.min(1, density));
  const desiredCount = Math.min(
    candidates.length,
    Math.max(
      candidates.length > 0 && clampedDensity > 0 ? 1 : 0,
      Math.round(candidates.length * clampedDensity),
    ),
  );
  const selected: typeof candidates = [];
  const selectedCells = new Set(occupiedCells);

  for (const candidate of candidates) {
    if (selected.length >= desiredCount) break;
    const northKey = `${candidate.cellX},${candidate.northCellY}`;
    const southKey = `${candidate.cellX},${candidate.northCellY + 1}`;
    if (selectedCells.has(northKey) || selectedCells.has(southKey)) continue;
    selected.push(candidate);
    selectedCells.add(northKey);
    selectedCells.add(southKey);
  }

  return selected
    .map(({ rank: _rank, ...placement }) => placement)
    .sort((a, b) => a.northCellY - b.northCellY || a.cellX - b.cellX);
}

// ── Exports ─────────────────────────────────────────────────────────────────

export const MAZE_WIDTH = MAP_WIDTH;
export const MAZE_HEIGHT = MAP_HEIGHT;

export function generateMazeLayout(
  seed: number,
  spawnDistance: number,
  numTeams: number = DEFAULT_LAYOUT_TEAM_COUNT,
): GeneratedMazeLayout {
  const baseData = generateMazeData(seed);
  const spawnPoints = computeSpawnPoints(baseData, spawnDistance, numTeams);
  const gates = computeGatePlacements(baseData, spawnPoints);
  const gatedData = baseData.slice();
  const dirtMask = new Uint8Array(MAP_WIDTH * MAP_HEIGHT);

  for (const gate of gates) {
    stampGate(gatedData, gate);
    stampGateDirtBand(dirtMask, gate);
  }

  const pressurePlates = computePressurePlates(gates);

  // Stamp pressure plate tiles into map data
  for (const plate of pressurePlates) {
    if (
      plate.tileX >= 0 &&
      plate.tileX < MAP_WIDTH &&
      plate.tileY >= 0 &&
      plate.tileY < MAP_HEIGHT
    ) {
      gatedData[plate.tileY * MAP_WIDTH + plate.tileX] = TILE_PRESSURE_PLATE;
    }
  }

  const safeSpawnPoints = spawnPoints.map((spawnPoint) =>
    findSafeSpawnPoint(gatedData, spawnPoint),
  );
  const requiredSwordFields = computeTeamRouteSwordFieldPlacements(
    gatedData,
    safeSpawnPoints,
    seed,
  );
  const bridges = computeBridgePlacements(
    gatedData,
    spawnPoints,
    seed,
    requiredSwordFields,
  );
  const swamps = computeSwampPlacements(
    gatedData,
    spawnPoints,
    bridges,
    seed,
    requiredSwordFields,
  );
  let chestDeadEnds = computeChestDeadEndPlacements(
    gatedData,
    seed,
    safeSpawnPoints,
    CHEST_DEAD_END_DENSITY,
    requiredSwordFields,
  );
  if (
    !computePortalPosition(
      gatedData,
      spawnDistance,
      bridges,
      swamps,
      chestDeadEnds,
      requiredSwordFields,
    )
  ) {
    const fallbackPortal = computePortalPosition(
      gatedData,
      spawnDistance,
      bridges,
      swamps,
      [],
      requiredSwordFields,
    );
    if (fallbackPortal) {
      const portalCellX = Math.round(
        (fallbackPortal.x - CELL_SIZE / 2 - WALL_WIDTH) / CELL_STEP_X,
      );
      const portalCellY = Math.round(
        (fallbackPortal.y + 0.75 - WALL_HEIGHT) / CELL_STEP_Y,
      );
      chestDeadEnds = chestDeadEnds.filter(
        (placement) =>
          placement.cellX !== portalCellX ||
          (placement.cellY !== portalCellY && placement.cellY !== portalCellY - 1),
      );
    }
  }
  const portalPosition = computePortalPosition(
    gatedData,
    spawnDistance,
    bridges,
    swamps,
    chestDeadEnds,
    requiredSwordFields,
  );
  const swordFields = computeSwordFieldPlacements(
    gatedData,
    safeSpawnPoints,
    bridges,
    swamps,
    chestDeadEnds,
    portalPosition,
    seed,
    requiredSwordFields,
  );
  const trapCells = computeTrapCellPlacements(
    gatedData,
    safeSpawnPoints,
    gates,
    bridges,
    swamps,
    swordFields,
    chestDeadEnds,
    portalPosition,
    seed,
  );
  const tIntersectionDecorations = computeTIntersectionDecorationPlacements(
    gatedData,
    safeSpawnPoints,
    gates,
    bridges,
    swamps,
    swordFields,
    chestDeadEnds,
    portalPosition,
    seed,
  );
  const decoratedVerticalPassages = computeDecoratedVerticalPassagePlacements(
    gatedData,
    safeSpawnPoints,
    gates,
    bridges,
    swamps,
    swordFields,
    trapCells,
    chestDeadEnds,
    tIntersectionDecorations,
    portalPosition,
    seed,
  );

  return {
    map: {
      width: MAP_WIDTH,
      height: MAP_HEIGHT,
      tileSize: TILE_PX,
      data: gatedData,
    },
    spawnPoints: safeSpawnPoints,
    gates,
    pressurePlates,
    bridges,
    swamps,
    swordFields,
    tIntersectionDecorations,
    decoratedVerticalPassages,
    trapCells,
    chestDeadEnds,
    dirtMask,
  };
}

export function generateMaze(seed: number): TileMapData {
  return generateMazeLayout(
    seed,
    DEFAULT_LAYOUT_SPAWN_DISTANCE,
    DEFAULT_LAYOUT_TEAM_COUNT,
  ).map;
}

// ── BFS-Based Equidistant Spawn Point Computation ───────────────────────────

/**
 * Check whether two adjacent cells (cx1,cy1) ↔ (cx2,cy2) are connected
 * by inspecting the wall strip between them in the tile data.
 * Two cells are connected if ANY tile in the wall strip is walkable (floor).
 */
function areCellsConnected(
  data: number[],
  cx1: number,
  cy1: number,
  cx2: number,
  cy2: number,
): boolean {
  const { tx: tx1, ty: ty1 } = cellToTile(cx1, cy1);

  if (cy1 === cy2) {
    // Horizontal neighbors — check the vertical wall strip between them
    const wallX = Math.min(tx1, cellToTile(cx2, cy2).tx) + CELL_SIZE;
    const topY = ty1;
    for (let wy = 0; wy < CELL_SIZE; wy++) {
      for (let wx = 0; wx < WALL_WIDTH; wx++) {
        const tile = data[(topY + wy) * MAP_WIDTH + (wallX + wx)];
        if (isWalkableTileId(tile)) return true;
      }
    }
  } else {
    // Vertical neighbors — check the horizontal wall strip between them
    const wallY = Math.min(ty1, cellToTile(cx2, cy2).ty) + CELL_SIZE;
    const leftX = tx1;
    for (let wy = 0; wy < WALL_HEIGHT; wy++) {
      for (let wx = 0; wx < CELL_SIZE; wx++) {
        const tile = data[(wallY + wy) * MAP_WIDTH + (leftX + wx)];
        if (isWalkableTileId(tile)) return true;
      }
    }
  }
  return false;
}

/** Select a stable 70% / 24% / 6% one-, two-, or three-chest arrangement. */
export function chooseChestCount(seed: number, cellX: number, cellY: number): ChestCount {
  let mixedSeed = seed ^ CHEST_RANDOM_SALT;
  mixedSeed = Math.imul(mixedSeed ^ (cellX + 1), 0x45d9f3b);
  mixedSeed = Math.imul(mixedSeed ^ (cellY + 1), 0x119de1f3);
  mixedSeed ^= mixedSeed >>> 16;
  const roll = mulberry32(mixedSeed)();
  if (roll < 0.7) return 1;
  if (roll < 0.94) return 2;
  return 3;
}

function getChestDeadEndSelectionRank(
  seed: number,
  cellX: number,
  cellY: number,
): number {
  let mixedSeed = seed ^ CHEST_DEAD_END_SELECTION_SALT;
  mixedSeed = Math.imul(mixedSeed ^ (cellX + 1), 0x27d4eb2d);
  mixedSeed = Math.imul(mixedSeed ^ (cellY + 1), 0x165667b1);
  mixedSeed ^= mixedSeed >>> 15;
  return mulberry32(mixedSeed)();
}

/**
 * `openDirection` points back into the maze, so the dead end itself extends in
 * the opposite direction. North/west dead ends use the original prefab;
 * south/east dead ends use the new right-side prefab.
 */
export function getChestDeadEndVariant(
  openDirection: ChestDeadEndDirection,
): ChestDeadEndVariant {
  return openDirection === 'north' || openDirection === 'west'
    ? 'south-east'
    : 'north-west';
}

/**
 * Find every eligible non-hub maze cell with exactly one connection, select a
 * deterministic share of them, and expand each count-specific authored chest
 * arrangement into independently indexed chests.
 */
export function computeChestDeadEndPlacements(
  data: number[],
  seed: number,
  excludedSpawnPoints: readonly SpawnPoint[] = [],
  density: number = CHEST_DEAD_END_DENSITY,
  excludedSwordFields: readonly SwordFieldPlacement[] = [],
): ChestDeadEndPlacement[] {
  const hubBounds = getHubTileBounds(MAP_WIDTH, MAP_HEIGHT);
  const hubCells = getHubCells(hubBounds.left, hubBounds.top, HUB_SIZE);
  const spawnCells = new Set(
    excludedSpawnPoints.map((spawnPoint) => {
      const { cx, cy } = spawnPointToCell(spawnPoint);
      return `${cx},${cy}`;
    }),
  );
  for (const swordField of excludedSwordFields) {
    occupySwordFieldCells(spawnCells, swordField);
  }
  const candidates: Array<{
    cellX: number;
    cellY: number;
    tileX: number;
    tileY: number;
    openDirection: ChestDeadEndDirection;
    rank: number;
  }> = [];

  for (let cellY = 0; cellY < GRID_CELLS; cellY++) {
    for (let cellX = 0; cellX < GRID_CELLS; cellX++) {
      const cellKey = `${cellX},${cellY}`;
      if (hubCells.has(cellKey) || spawnCells.has(cellKey)) continue;

      const northOpen =
        cellY > 0 && areCellsConnected(data, cellX, cellY, cellX, cellY - 1);
      const eastOpen =
        cellX < GRID_CELLS - 1 && areCellsConnected(data, cellX, cellY, cellX + 1, cellY);
      const southOpen =
        cellY < GRID_CELLS - 1 && areCellsConnected(data, cellX, cellY, cellX, cellY + 1);
      const westOpen =
        cellX > 0 && areCellsConnected(data, cellX, cellY, cellX - 1, cellY);

      const openDirections: ChestDeadEndDirection[] = [];
      if (northOpen) openDirections.push('north');
      if (eastOpen) openDirections.push('east');
      if (southOpen) openDirections.push('south');
      if (westOpen) openDirections.push('west');
      if (openDirections.length !== 1) continue;

      const openDirection = openDirections[0];
      const { tx, ty } = cellToTile(cellX, cellY);
      candidates.push({
        cellX,
        cellY,
        tileX: tx,
        tileY: ty,
        openDirection,
        rank: getChestDeadEndSelectionRank(seed, cellX, cellY),
      });
    }
  }

  const clampedDensity = Math.max(0, Math.min(1, density));
  const selectedCellCount = Math.round(candidates.length * clampedDensity);
  const selectedCells = new Set(
    [...candidates]
      .sort((a, b) => a.rank - b.rank || a.cellY - b.cellY || a.cellX - b.cellX)
      .slice(0, selectedCellCount)
      .map(({ cellX, cellY }) => `${cellX},${cellY}`),
  );
  const placements: ChestDeadEndPlacement[] = [];

  for (const candidate of candidates) {
    const { cellX, cellY, tileX, tileY, openDirection } = candidate;
    if (!selectedCells.has(`${cellX},${cellY}`)) continue;

    const chestCount = chooseChestCount(seed, cellX, cellY);
    for (let slot = 0; slot < chestCount; slot++) {
      placements.push({
        cellX,
        cellY,
        tileX,
        tileY,
        openDirection,
        variant: getChestDeadEndVariant(openDirection),
        chestCount,
        chestSlot: slot as ChestSlot,
      });
    }
  }

  return placements;
}

/**
 * Compute equidistant spawn points for `numTeams` teams.
 *
 * Algorithm:
 *   1. Build a cell-level adjacency graph from the generated tile data.
 *   2. BFS from all hub cells (distance 0) to compute shortest cell-path
 *      distance to every reachable cell.
 *   3. Collect candidate cells at the target distance.
 *   4. Divide 360° into `numTeams` angular sectors around the map center
 *      and pick the best candidate per sector.
 *   5. Fallback: if exact distance yields too few candidates, widen ±1, ±2, …
 *
 * @param data       Flat tile array from generateMaze
 * @param distance   Target cell-step distance from hub
 * @param numTeams   Number of spawn points to generate (default 3)
 * @returns          Array of SpawnPoint in pixel coordinates
 */
export function computeSpawnPoints(
  data: number[],
  distance: number,
  numTeams: number = 3,
): SpawnPoint[] {
  // ── 1. Identify hub cells ───────────────────────────────────────────
  const hubTileX = Math.floor((MAP_WIDTH - HUB_SIZE) / 2);
  const hubTileY = Math.floor((MAP_HEIGHT - HUB_SIZE) / 2);
  const hubCells = getHubCells(hubTileX, hubTileY, HUB_SIZE);

  // ── 2. BFS on cell graph ────────────────────────────────────────────
  const cellDist = new Array(GRID_CELLS * GRID_CELLS).fill(-1);

  const queue: Array<{ cx: number; cy: number }> = [];
  for (const key of hubCells) {
    const [cx, cy] = key.split(',').map(Number);
    cellDist[cy * GRID_CELLS + cx] = 0;
    queue.push({ cx, cy });
  }

  let head = 0;
  while (head < queue.length) {
    const { cx, cy } = queue[head++];
    const d = cellDist[cy * GRID_CELLS + cx];

    for (const dir of DIRS) {
      const nx = cx + dir.dx;
      const ny = cy + dir.dy;
      if (nx < 0 || nx >= GRID_CELLS || ny < 0 || ny >= GRID_CELLS) continue;
      if (cellDist[ny * GRID_CELLS + nx] !== -1) continue; // already visited
      if (!areCellsConnected(data, cx, cy, nx, ny)) continue;

      cellDist[ny * GRID_CELLS + nx] = d + 1;
      queue.push({ cx: nx, cy: ny });
    }
  }

  // ── 3. Collect candidates at target distance (with fallback) ────────
  const hubCenterX = MAP_WIDTH / 2;
  const hubCenterY = MAP_HEIGHT / 2;

  let candidates: Array<{ cx: number; cy: number; angle: number }> = [];

  // Try exact distance first, then widen progressively
  for (let spread = 0; spread <= distance && candidates.length < numTeams; spread++) {
    candidates = [];
    for (let cy = 0; cy < GRID_CELLS; cy++) {
      for (let cx = 0; cx < GRID_CELLS; cx++) {
        const d = cellDist[cy * GRID_CELLS + cx];
        if (d === -1) continue; // unreachable
        if (d < distance - spread || d > distance + spread) continue;
        if (hubCells.has(`${cx},${cy}`)) continue; // skip hub cells

        const { tx, ty } = cellToTile(cx, cy);
        const pixX = tx + CELL_SIZE / 2;
        const pixY = ty + CELL_SIZE / 2;
        const angle = Math.atan2(pixY - hubCenterY, pixX - hubCenterX);
        candidates.push({ cx, cy, angle });
      }
    }
  }

  // ── 4. Select one candidate per angular sector ──────────────────────
  const sectorSize = (2 * Math.PI) / numTeams;
  const picked: SpawnPoint[] = [];

  for (let i = 0; i < numTeams; i++) {
    // Sector center angle: evenly spaced, starting from -PI (left)
    const sectorCenter = -Math.PI + sectorSize * (i + 0.5);
    // Normalize angle difference helper
    const angleDiff = (a: number, center: number) => {
      let diff = a - center;
      while (diff > Math.PI) diff -= 2 * Math.PI;
      while (diff < -Math.PI) diff += 2 * Math.PI;
      return Math.abs(diff);
    };

    // Filter candidates within this sector
    const inSector = candidates.filter((c) => {
      const diff = angleDiff(c.angle, sectorCenter);
      return diff <= sectorSize / 2;
    });

    // Pick the candidate closest to the exact target distance,
    // breaking ties by closest to sector center angle
    let best = inSector[0] ?? candidates[0]; // fallback to any candidate
    if (inSector.length > 1) {
      best = inSector.reduce((a, b) => {
        const aDist = Math.abs(cellDist[a.cy * GRID_CELLS + a.cx] - distance);
        const bDist = Math.abs(cellDist[b.cy * GRID_CELLS + b.cx] - distance);
        if (aDist !== bDist) return aDist < bDist ? a : b;
        return angleDiff(a.angle, sectorCenter) < angleDiff(b.angle, sectorCenter)
          ? a
          : b;
      });
    }

    if (best) {
      const { tx, ty } = cellToTile(best.cx, best.cy);
      picked.push({
        x: tx + Math.floor(CELL_SIZE / 2),
        y: ty + Math.floor(CELL_SIZE / 2),
      });
      // Remove this candidate so other sectors don't reuse it
      candidates = candidates.filter((c) => c.cx !== best.cx || c.cy !== best.cy);
    }
  }

  // ── 5. Fallback if we still don't have enough points ────────────────
  // Use corner cells as last resort
  const fallbackCorners = [
    { cx: 0, cy: 0 },
    { cx: GRID_CELLS - 1, cy: 0 },
    { cx: 0, cy: GRID_CELLS - 1 },
    { cx: GRID_CELLS - 1, cy: GRID_CELLS - 1 },
  ];
  let fi = 0;
  while (picked.length < numTeams && fi < fallbackCorners.length) {
    const fc = fallbackCorners[fi++];
    const { tx, ty } = cellToTile(fc.cx, fc.cy);
    picked.push({
      x: tx + Math.floor(CELL_SIZE / 2),
      y: ty + Math.floor(CELL_SIZE / 2),
    });
  }

  return picked.slice(0, numTeams);
}

// ── Portal Position Computation ─────────────────────────────────────────────

/**
 * Compute a portal position at the south face of a forest wall separating
 * two vertically adjacent 6×6 cells, farther from the hub than player spawns.
 *
 * Algorithm:
 *   1. Build a cell-level adjacency graph (same as computeSpawnPoints).
 *   2. BFS from all hub cells.
 *   3. Find reachable lower cells at distance > spawnDistance where both the
 *      lower cell and the cell above it have an intact north forest wall.
 *      Target distance = spawnDistance + 2, capped at GRID_CELLS - 1.
 *   4. Pick the cell with the highest BFS distance (deepest in the maze).
 *      Ties broken by closest to due-south direction from hub center.
 *
 * @param data           Flat tile array from generateMaze
 * @param spawnDistance   The spawn distance used for teams (to ensure portal is farther)
 * @param bridges         Bridge cells to exclude from portal platform placement
 * @param swamps          Swamp cells to exclude from portal platform placement
 * @returns              Tile-space coordinates of the portal center, or null if none found
 */
export function computePortalPosition(
  data: number[],
  spawnDistance: number,
  bridges: readonly BridgePlacement[] = [],
  swamps: readonly SwampPlacement[] = [],
  chestDeadEnds: readonly ChestDeadEndPlacement[] = [],
  swordFields: readonly SwordFieldPlacement[] = [],
): SpawnPoint | null {
  const obstacleCells = new Set<string>();
  for (const bridge of bridges) {
    obstacleCells.add(`${bridge.cellX},${bridge.northCellY}`);
    obstacleCells.add(`${bridge.cellX},${bridge.northCellY + 1}`);
  }
  for (const swamp of swamps) {
    for (let offset = 0; offset < swamp.lengthCells; offset++) {
      obstacleCells.add(`${swamp.westCellX + offset},${swamp.cellY}`);
    }
  }
  for (const chestDeadEnd of chestDeadEnds) {
    obstacleCells.add(`${chestDeadEnd.cellX},${chestDeadEnd.cellY}`);
  }
  for (const swordField of swordFields) {
    occupySwordFieldCells(obstacleCells, swordField);
  }

  const supportsPortalPlatform = (cx: number, cy: number): boolean => {
    if (cy < 2) return false;
    if (obstacleCells.has(`${cx},${cy}`) || obstacleCells.has(`${cx},${cy - 1}`))
      return false;
    const lowerNorthWall = !areCellsConnected(data, cx, cy, cx, cy - 1);
    const upperNorthWall = !areCellsConnected(data, cx, cy - 1, cx, cy - 2);
    return lowerNorthWall && upperNorthWall;
  };

  // ── 1. Identify hub cells ───────────────────────────────────────────
  const hubTileX = Math.floor((MAP_WIDTH - HUB_SIZE) / 2);
  const hubTileY = Math.floor((MAP_HEIGHT - HUB_SIZE) / 2);
  const hubCells = getHubCells(hubTileX, hubTileY, HUB_SIZE);

  // ── 2. BFS on cell graph ────────────────────────────────────────────
  const cellDist = new Array(GRID_CELLS * GRID_CELLS).fill(-1);

  const queue: Array<{ cx: number; cy: number }> = [];
  for (const key of hubCells) {
    const [cx, cy] = key.split(',').map(Number);
    cellDist[cy * GRID_CELLS + cx] = 0;
    queue.push({ cx, cy });
  }

  let head = 0;
  while (head < queue.length) {
    const { cx, cy } = queue[head++];
    const d = cellDist[cy * GRID_CELLS + cx];

    for (const dir of DIRS) {
      const nx = cx + dir.dx;
      const ny = cy + dir.dy;
      if (nx < 0 || nx >= GRID_CELLS || ny < 0 || ny >= GRID_CELLS) continue;
      if (cellDist[ny * GRID_CELLS + nx] !== -1) continue;
      if (!areCellsConnected(data, cx, cy, nx, ny)) continue;

      cellDist[ny * GRID_CELLS + nx] = d + 1;
      queue.push({ cx: nx, cy: ny });
    }
  }

  // ── 3. Find candidates at distance > spawnDistance ──────────────────
  const targetMinDist = spawnDistance + 1;
  const targetMaxDist = Math.min(spawnDistance + 3, GRID_CELLS - 1);

  const hubCenterX = MAP_WIDTH / 2;
  const hubCenterY = MAP_HEIGHT / 2;

  interface Candidate {
    cx: number;
    cy: number;
    dist: number;
    angle: number;
  }
  let candidates: Candidate[] = [];

  for (let cy = 0; cy < GRID_CELLS; cy++) {
    for (let cx = 0; cx < GRID_CELLS; cx++) {
      const d = cellDist[cy * GRID_CELLS + cx];
      if (d === -1) continue;
      if (d < targetMinDist || d > targetMaxDist) continue;
      if (hubCells.has(`${cx},${cy}`)) continue;
      if (!supportsPortalPlatform(cx, cy)) continue;

      const { tx, ty } = cellToTile(cx, cy);
      const pixX = tx + CELL_SIZE / 2;
      const pixY = ty + CELL_SIZE / 2;
      const angle = Math.atan2(pixY - hubCenterY, pixX - hubCenterX);
      candidates.push({ cx, cy, dist: d, angle });
    }
  }

  // Widen search if no candidates found at target range
  if (candidates.length === 0) {
    for (let cy = 0; cy < GRID_CELLS; cy++) {
      for (let cx = 0; cx < GRID_CELLS; cx++) {
        const d = cellDist[cy * GRID_CELLS + cx];
        if (d === -1 || d <= spawnDistance) continue;
        if (hubCells.has(`${cx},${cy}`)) continue;
        if (!supportsPortalPlatform(cx, cy)) continue;

        const { tx, ty } = cellToTile(cx, cy);
        const pixX = tx + CELL_SIZE / 2;
        const pixY = ty + CELL_SIZE / 2;
        const angle = Math.atan2(pixY - hubCenterY, pixX - hubCenterX);
        candidates.push({ cx, cy, dist: d, angle });
      }
    }
  }

  if (candidates.length === 0) return null;

  // ── 4. Pick the deepest cell, ties broken by angle closest to south ──
  const southAngle = Math.PI / 2; // pointing down

  candidates.sort((a, b) => {
    // Prefer higher distance (deeper in maze)
    if (b.dist !== a.dist) return b.dist - a.dist;
    // Tiebreak: closer to due-south from hub center
    const aDiff = Math.abs(a.angle - southAngle);
    const bDiff = Math.abs(b.angle - southAngle);
    return aDiff - bDiff;
  });

  const best = candidates[0];
  const { tx, ty } = cellToTile(best.cx, best.cy);

  // Center horizontally on the 6×6 lower cell. Vertically, the arch sits
  // 12px (0.75 tile) inside the south face of the separating forest wall,
  // matching the authored platform layout.
  return {
    x: tx + CELL_SIZE / 2,
    y: ty - 0.75,
  };
}
