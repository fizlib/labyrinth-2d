// packages/shared/src/maps/level1.ts
// ─────────────────────────────────────────────────────────────────────────────
// Level 1 — Procedurally-generated labyrinth with 3-tile-wide corridors.
//
// Tile IDs:
//   0 = floor (walkable)
//   1 = wall  (solid, blocks movement)
//
// Layout:
//   - 91×91 tile grid (1456×1456 px at 16px/tile)
//   - 9×9 central hub room
//   - Recursive-backtracking maze fills the entire space
//   - All corridors are 3 tiles wide
//   - Hub has 3 entrances: north, west, east
//   - 3 spawn points near corners
//
// Maze cell grid:
//   Each "cell" is a 3×3 floor area. Walls between cells are 1 tile thick.
//   Cell (cx,cy) maps to tile top-left at (1 + cx*4, 1 + cy*4).
//   Grid size: 22×22 cells (fits in 91 tiles: 1 + 22*4 + 2 = 91).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tiled-style map data structure.
 * Shared between client (rendering) and server (collision).
 */
export interface TileMapData {
  /** Width of the map in tiles. */
  width: number;
  /** Height of the map in tiles. */
  height: number;
  /** Size of each tile in pixels. */
  tileSize: number;
  /**
   * 1D array of tile IDs, row-major order (left-to-right, top-to-bottom).
   * Index formula: data[y * width + x]
   */
  data: number[];
}

/** A spawn point in tile coordinates. */
export interface SpawnPoint {
  /** Tile X coordinate. */
  x: number;
  /** Tile Y coordinate. */
  y: number;
}

// ── Constants ───────────────────────────────────────────────────────────────

const CELL_SIZE = 3;   // Each maze cell is 3×3 floor tiles
const WALL_SIZE = 1;   // 1-tile wall between cells
const CELL_STEP = CELL_SIZE + WALL_SIZE; // 4 tiles per cell step
const GRID_CELLS = 22; // 22×22 cell maze
const MAP_SIZE = 1 + GRID_CELLS * CELL_STEP + WALL_SIZE; // = 91
const TILE_PX = 16;

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
  { dx: 1, dy: 0 },  // east
  { dx: 0, dy: 1 },  // south
  { dx: -1, dy: 0 }, // west
] as const;

/** Shuffle an array in-place using Fisher-Yates with the given PRNG. */
function shuffle<T>(arr: T[], rand: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ── Maze Generation ─────────────────────────────────────────────────────────

/**
 * Convert a cell coordinate to the top-left tile coordinate of its 3×3 area.
 */
function cellToTile(cx: number, cy: number): { tx: number; ty: number } {
  return {
    tx: 1 + cx * CELL_STEP,
    ty: 1 + cy * CELL_STEP,
  };
}

/**
 * Carve a 3×3 floor block for the given cell.
 */
function carveCell(data: number[], cx: number, cy: number): void {
  const { tx, ty } = cellToTile(cx, cy);
  for (let dy = 0; dy < CELL_SIZE; dy++) {
    for (let dx = 0; dx < CELL_SIZE; dx++) {
      data[(ty + dy) * MAP_SIZE + (tx + dx)] = 0;
    }
  }
}

/**
 * Carve the wall between two adjacent cells, creating a 3-tile-wide passage.
 * For horizontal neighbors: carve a 1×3 column between them.
 * For vertical neighbors: carve a 3×1 row between them.
 */
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
    // Horizontal neighbors — carve the wall column between them
    const wallX = Math.min(tx1, tx2) + CELL_SIZE; // the wall tile column
    const topY = ty1; // same row
    for (let dy = 0; dy < CELL_SIZE; dy++) {
      data[(topY + dy) * MAP_SIZE + wallX] = 0;
    }
  } else {
    // Vertical neighbors — carve the wall row between them
    const wallY = Math.min(ty1, ty2) + CELL_SIZE; // the wall tile row
    const leftX = tx1; // same column
    for (let dx = 0; dx < CELL_SIZE; dx++) {
      data[wallY * MAP_SIZE + (leftX + dx)] = 0;
    }
  }
}

/**
 * Compute which cells are occupied by the central hub.
 * Returns a Set of "cx,cy" strings for cells that overlap the hub area.
 */
function getHubCells(hubTileX: number, hubTileY: number, hubSize: number): Set<string> {
  const cells = new Set<string>();
  for (let cy = 0; cy < GRID_CELLS; cy++) {
    for (let cx = 0; cx < GRID_CELLS; cx++) {
      const { tx, ty } = cellToTile(cx, cy);
      // Check if this cell's 3×3 area overlaps the hub area
      const cellRight = tx + CELL_SIZE - 1;
      const cellBottom = ty + CELL_SIZE - 1;
      const hubRight = hubTileX + hubSize - 1;
      const hubBottom = hubTileY + hubSize - 1;
      if (tx <= hubRight && cellRight >= hubTileX && ty <= hubBottom && cellBottom >= hubTileY) {
        cells.add(`${cx},${cy}`);
      }
    }
  }
  return cells;
}

/**
 * Generate the maze using iterative backtracking (stack-based DFS).
 * Uses a seeded PRNG for deterministic results.
 */
function generateLevel1(): number[] {
  const rand = mulberry32(42); // Fixed seed for reproducibility

  // Start with all walls
  const data = new Array(MAP_SIZE * MAP_SIZE).fill(1);

  // ── Central Hub ─────────────────────────────────────────────────────────
  // 9×9 room centered in the map
  const hubSize = 9;
  const hubTileX = Math.floor((MAP_SIZE - hubSize) / 2); // = 41
  const hubTileY = Math.floor((MAP_SIZE - hubSize) / 2); // = 41

  // Carve hub floor
  for (let dy = 0; dy < hubSize; dy++) {
    for (let dx = 0; dx < hubSize; dx++) {
      data[(hubTileY + dy) * MAP_SIZE + (hubTileX + dx)] = 0;
    }
  }

  // ── Mark hub cells as visited ───────────────────────────────────────────
  const hubCells = getHubCells(hubTileX, hubTileY, hubSize);
  const visited = new Array(GRID_CELLS * GRID_CELLS).fill(false);

  for (const key of hubCells) {
    const [cx, cy] = key.split(',').map(Number);
    visited[cy * GRID_CELLS + cx] = true;
  }

  // ── Carve all non-hub cells ─────────────────────────────────────────────
  // First, carve floor for every non-hub cell
  for (let cy = 0; cy < GRID_CELLS; cy++) {
    for (let cx = 0; cx < GRID_CELLS; cx++) {
      if (!hubCells.has(`${cx},${cy}`)) {
        carveCell(data, cx, cy);
      }
    }
  }

  // ── Recursive backtracking (iterative with stack) ───────────────────────
  // Start from cell (0, 0)
  const startCx = 0;
  const startCy = 0;
  visited[startCy * GRID_CELLS + startCx] = true;

  const stack: Array<{ cx: number; cy: number }> = [{ cx: startCx, cy: startCy }];

  while (stack.length > 0) {
    const current = stack[stack.length - 1];
    const { cx, cy } = current;

    // Find unvisited neighbors
    const neighbors: Array<{ cx: number; cy: number }> = [];
    for (const dir of DIRS) {
      const nx = cx + dir.dx;
      const ny = cy + dir.dy;
      if (nx >= 0 && nx < GRID_CELLS && ny >= 0 && ny < GRID_CELLS && !visited[ny * GRID_CELLS + nx]) {
        neighbors.push({ cx: nx, cy: ny });
      }
    }

    if (neighbors.length === 0) {
      // Backtrack
      stack.pop();
    } else {
      // Pick a random unvisited neighbor
      shuffle(neighbors, rand);
      const next = neighbors[0];

      // Carve passage between current and next
      carvePassage(data, cx, cy, next.cx, next.cy);

      visited[next.cy * GRID_CELLS + next.cx] = true;
      stack.push(next);
    }
  }

  // ── Connect hub to maze ─────────────────────────────────────────────────
  // Find maze cells adjacent to the hub and carve entrances.
  // We create 3 entrances: north, west, east.

  const hubCenterCx = Math.floor(GRID_CELLS / 2); // ~11
  const hubCenterCy = Math.floor(GRID_CELLS / 2);

  // Find the topmost row of hub cells and the cell just above it
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

  // North entrance: carve from the hub's top edge up to the cell above
  // Connect at the horizontal center of the hub
  {
    const entranceCx = hubCenterCx;
    const aboveCy = hubTopCy - 1;
    if (aboveCy >= 0) {
      // Carve a 3-wide passage from the cell above into the hub
      const { tx, ty } = cellToTile(entranceCx, aboveCy);
      const wallY = ty + CELL_SIZE; // wall row just below the cell
      for (let dx = 0; dx < CELL_SIZE; dx++) {
        data[wallY * MAP_SIZE + (tx + dx)] = 0;
      }
      // Also ensure floor continuity into the hub
      for (let dy = 1; dy <= 2; dy++) {
        for (let dx = 0; dx < CELL_SIZE; dx++) {
          data[(wallY + dy) * MAP_SIZE + (tx + dx)] = 0;
        }
      }
    }
  }

  // West entrance: carve from the hub's left edge to the cell to its left
  {
    const entranceCy = hubCenterCy;
    const leftCx = hubLeftCx - 1;
    if (leftCx >= 0) {
      const { tx, ty } = cellToTile(leftCx, entranceCy);
      const wallX = tx + CELL_SIZE; // wall column just right of the cell
      for (let dy = 0; dy < CELL_SIZE; dy++) {
        data[(ty + dy) * MAP_SIZE + wallX] = 0;
      }
      for (let ddx = 1; ddx <= 2; ddx++) {
        for (let dy = 0; dy < CELL_SIZE; dy++) {
          data[(ty + dy) * MAP_SIZE + (wallX + ddx)] = 0;
        }
      }
    }
  }

  // East entrance: carve from the hub's right edge to the cell to its right
  {
    const entranceCy = hubCenterCy;
    const rightCx = hubRightCx + 1;
    if (rightCx < GRID_CELLS) {
      const { tx: cellTx, ty: cellTy } = cellToTile(rightCx, entranceCy);
      // Carve wall between hub and the cell
      const wallX = cellTx - 1; // wall column just left of the cell
      for (let dy = 0; dy < CELL_SIZE; dy++) {
        data[(cellTy + dy) * MAP_SIZE + wallX] = 0;
      }
      // Ensure floor continuity into the hub
      for (let ddx = 1; ddx <= 2; ddx++) {
        for (let dy = 0; dy < CELL_SIZE; dy++) {
          data[(cellTy + dy) * MAP_SIZE + (wallX - ddx)] = 0;
        }
      }
    }
  }

  return data;
}

// ── Exports ─────────────────────────────────────────────────────────────────

/**
 * The 3 spawn points in TILE coordinates.
 * Placed at corners of the maze on valid cell centers.
 * The server assigns players to these using round-robin.
 */
export const SPAWN_POINTS: SpawnPoint[] = (() => {
  // Place spawns at cells near the 3 corners (avoiding the hub corner)
  // Cell (0,0) → top-left, Cell (21,0) → top-right, Cell (0,21) → bottom-left
  const points: SpawnPoint[] = [];
  const cornerCells: Array<{ cx: number; cy: number }> = [
    { cx: 0, cy: 0 },                         // top-left
    { cx: GRID_CELLS - 1, cy: 0 },            // top-right
    { cx: 0, cy: GRID_CELLS - 1 },            // bottom-left
  ];

  for (const cell of cornerCells) {
    const { tx, ty } = cellToTile(cell.cx, cell.cy);
    // Center of the 3×3 cell
    points.push({ x: tx + 1, y: ty + 1 });
  }

  return points;
})();

export const LEVEL_1_MAP: TileMapData = {
  width: MAP_SIZE,
  height: MAP_SIZE,
  tileSize: TILE_PX,
  data: generateLevel1(),
};
