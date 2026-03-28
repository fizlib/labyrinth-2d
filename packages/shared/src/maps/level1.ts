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
//   - 186×186 tile grid at 16px/tile
//   - 9×9 central hub room
//   - Recursive-backtracking maze fills the entire space
//   - All corridors are 6 tiles wide
//   - Hub has 3 entrances: north, west, east
//   - 3 spawn points near corners
//
// Post-processing:
//   - 2-tile high South-facing wall profiles
//   - Dirt shadows hugging the bases of the walls
// ─────────────────────────────────────────────────────────────────────────────

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

// ── Constants ───────────────────────────────────────────────────────────────

export const CELL_SIZE = 6;
const WALL_SIZE = 6;
export const CELL_STEP = CELL_SIZE + WALL_SIZE;
export const GRID_CELLS = 15;
export const MAP_SIZE = WALL_SIZE + GRID_CELLS * CELL_STEP; // = 186
const TILE_PX = 16;

/** Size of the central hub room in tiles (square). 1.5× the original 9. */
const HUB_SIZE = 13;

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
    tx: WALL_SIZE + cx * CELL_STEP,
    ty: WALL_SIZE + cy * CELL_STEP,
  };
}

function carveCell(data: number[], cx: number, cy: number): void {
  const { tx, ty } = cellToTile(cx, cy);
  for (let dy = 0; dy < CELL_SIZE; dy++) {
    for (let dx = 0; dx < CELL_SIZE; dx++) {
      data[(ty + dy) * MAP_SIZE + (tx + dx)] = TILE_FLOOR;
    }
  }
}

function carvePassage(data: number[], cx1: number, cy1: number, cx2: number, cy2: number): void {
  const { tx: tx1, ty: ty1 } = cellToTile(cx1, cy1);
  const { tx: tx2, ty: ty2 } = cellToTile(cx2, cy2);

  if (cy1 === cy2) {
    const wallX = Math.min(tx1, tx2) + CELL_SIZE;
    const topY = ty1;
    for (let wy = 0; wy < CELL_SIZE; wy++) {
      for (let wx = 0; wx < WALL_SIZE; wx++) {
        data[(topY + wy) * MAP_SIZE + (wallX + wx)] = TILE_FLOOR;
      }
    }
  } else {
    const wallY = Math.min(ty1, ty2) + CELL_SIZE;
    const leftX = tx1;
    for (let wy = 0; wy < WALL_SIZE; wy++) {
      for (let wx = 0; wx < CELL_SIZE; wx++) {
        data[(wallY + wy) * MAP_SIZE + (leftX + wx)] = TILE_FLOOR;
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
      if (tx <= hubRight && cellRight >= hubTileX && ty <= hubBottom && cellBottom >= hubTileY) {
        cells.add(`${cx},${cy}`);
      }
    }
  }
  return cells;
}

function generateMazeData(seed: number): number[] {
  const rand = mulberry32(seed);

  // Start with all walls (temporarily 1)
  const data = new Array(MAP_SIZE * MAP_SIZE).fill(1);

  // ── Central Hub ─────────────────────────────────────────────────────────
  const hubSize = HUB_SIZE;
  const hubTileX = Math.floor((MAP_SIZE - hubSize) / 2);
  const hubTileY = Math.floor((MAP_SIZE - hubSize) / 2);

  for (let dy = 0; dy < hubSize; dy++) {
    for (let dx = 0; dx < hubSize; dx++) {
      data[(hubTileY + dy) * MAP_SIZE + (hubTileX + dx)] = TILE_FLOOR;
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
      if (nx >= 0 && nx < GRID_CELLS && ny >= 0 && ny < GRID_CELLS && !visited[ny * GRID_CELLS + nx]) {
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
      for (let wy = 0; wy < WALL_SIZE; wy++) {
        for (let dx = 0; dx < CELL_SIZE; dx++) {
          data[(wallY + wy) * MAP_SIZE + (tx + dx)] = TILE_FLOOR;
        }
      }
      const hubEdge = hubTileY;
      for (let row = wallY + WALL_SIZE; row < hubEdge + CELL_SIZE; row++) {
        for (let dx = 0; dx < CELL_SIZE; dx++) {
          if (row >= 0 && row < MAP_SIZE) {
            data[row * MAP_SIZE + (tx + dx)] = TILE_FLOOR;
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
      for (let wx = 0; wx < WALL_SIZE; wx++) {
        for (let dy = 0; dy < CELL_SIZE; dy++) {
          data[(ty + dy) * MAP_SIZE + (wallX + wx)] = TILE_FLOOR;
        }
      }
      const hubEdge = hubTileX;
      for (let col = wallX + WALL_SIZE; col < hubEdge + CELL_SIZE; col++) {
        for (let dy = 0; dy < CELL_SIZE; dy++) {
          if (col >= 0 && col < MAP_SIZE) {
            data[(ty + dy) * MAP_SIZE + col] = TILE_FLOOR;
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
      const wallX = cellTx - WALL_SIZE;
      for (let wx = 0; wx < WALL_SIZE; wx++) {
        for (let dy = 0; dy < CELL_SIZE; dy++) {
          data[(cellTy + dy) * MAP_SIZE + (wallX + wx)] = TILE_FLOOR;
        }
      }
      const hubRight = hubTileX + hubSize;
      for (let col = hubRight - CELL_SIZE; col < wallX; col++) {
        for (let dy = 0; dy < CELL_SIZE; dy++) {
          if (col >= 0 && col < MAP_SIZE) {
            data[(cellTy + dy) * MAP_SIZE + col] = TILE_FLOOR;
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
      const wallY = ty - WALL_SIZE;
      for (let wy = 0; wy < WALL_SIZE; wy++) {
        for (let dx = 0; dx < CELL_SIZE; dx++) {
          data[(wallY + wy) * MAP_SIZE + (tx + dx)] = TILE_FLOOR;
        }
      }
      const hubBottom = hubTileY + hubSize;
      for (let row = hubBottom - CELL_SIZE; row < wallY; row++) {
        for (let dx = 0; dx < CELL_SIZE; dx++) {
          if (row >= 0 && row < MAP_SIZE) {
            data[row * MAP_SIZE + (tx + dx)] = TILE_FLOOR;
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
  for (let y = MAP_SIZE - 2; y >= 2; y--) {
    for (let x = 0; x < MAP_SIZE; x++) {
      const thisIdx = y * MAP_SIZE + x;
      const belowIdx = (y + 1) * MAP_SIZE + x;

      // If this tile is solid rock, but the tile directly south is walkable floor
      if (snapshot[thisIdx] === TILE_WALL_INTERIOR && snapshot[belowIdx] === TILE_FLOOR) {

        data[thisIdx] = TILE_WALL_FACE; // Base of the wall face

        // Extend the face upwards for a chunky 2-tile high appearance
        const midIdx = (y - 1) * MAP_SIZE + x;
        if (snapshot[midIdx] === TILE_WALL_INTERIOR) {
          data[midIdx] = TILE_WALL_FACE;

          // Cap the wall face with a bright top border
          const topIdx = (y - 2) * MAP_SIZE + x;
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

  for (let y = 1; y < MAP_SIZE - 1; y++) {
    for (let x = 1; x < MAP_SIZE - 1; x++) {
      const idx = y * MAP_SIZE + x;
      if (snap2[idx] !== TILE_WALL_INTERIOR) continue;

      const left   = snap2[idx - 1];
      const right  = snap2[idx + 1];
      const top    = snap2[idx - MAP_SIZE];
      const bottom = snap2[idx + MAP_SIZE];

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

  // Step 4: Add dark dirt shadows around the base edges of the walkable areas
  const snap3 = data.slice();
  for (let y = 0; y < MAP_SIZE; y++) {
    for (let x = 0; x < MAP_SIZE; x++) {
      const idx = y * MAP_SIZE + x;
      if (snap3[idx] === TILE_FLOOR) {
        const isNearWall =
          (x > 0 && snap3[idx - 1] !== TILE_FLOOR) ||
          (x < MAP_SIZE - 1 && snap3[idx + 1] !== TILE_FLOOR) ||
          (y > 0 && snap3[idx - MAP_SIZE] !== TILE_FLOOR) ||
          (y < MAP_SIZE - 1 && snap3[idx + MAP_SIZE] !== TILE_FLOOR);

        if (isNearWall) {
          data[idx] = TILE_FLOOR_SHADOW;
        }
      }
    }
  }

  // ── Step 5: Central hub decoration — dirt patch + tree ──────────────────
  {
    const hubCx = hubTileX + Math.floor(hubSize / 2);
    const hubCy = hubTileY + Math.floor(hubSize / 2);

    // Diamond-shaped dirt patch (Manhattan distance <= 3 from center)
    const DIRT_RADIUS = 3;
    for (let dy = -DIRT_RADIUS; dy <= DIRT_RADIUS; dy++) {
      for (let dx = -DIRT_RADIUS; dx <= DIRT_RADIUS; dx++) {
        if (Math.abs(dx) + Math.abs(dy) <= DIRT_RADIUS) {
          const tx = hubCx + dx;
          const ty = hubCy + dy;
          if (tx >= 0 && tx < MAP_SIZE && ty >= 0 && ty < MAP_SIZE) {
            data[ty * MAP_SIZE + tx] = TILE_FLOOR_SHADOW;
          }
        }
      }
    }

    // Tree at the exact center
    data[hubCy * MAP_SIZE + hubCx] = TILE_TREE;
  }

  return data;
}

// ── Exports ─────────────────────────────────────────────────────────────────

export const MAZE_SIZE = MAP_SIZE;

export function generateMaze(seed: number): TileMapData {
  return {
    width: MAP_SIZE,
    height: MAP_SIZE,
    tileSize: TILE_PX,
    data: generateMazeData(seed),
  };
}

// ── BFS-Based Equidistant Spawn Point Computation ───────────────────────────

/**
 * Check whether two adjacent cells (cx1,cy1) ↔ (cx2,cy2) are connected
 * by inspecting the wall strip between them in the tile data.
 * Two cells are connected if ANY tile in the wall strip is walkable (floor).
 */
function areCellsConnected(
  data: number[],
  cx1: number, cy1: number,
  cx2: number, cy2: number,
): boolean {
  const { tx: tx1, ty: ty1 } = cellToTile(cx1, cy1);

  if (cy1 === cy2) {
    // Horizontal neighbors — check the vertical wall strip between them
    const wallX = Math.min(tx1, cellToTile(cx2, cy2).tx) + CELL_SIZE;
    const topY = ty1;
    for (let wy = 0; wy < CELL_SIZE; wy++) {
      for (let wx = 0; wx < WALL_SIZE; wx++) {
        const tile = data[(topY + wy) * MAP_SIZE + (wallX + wx)];
        if (tile === TILE_FLOOR || tile === TILE_FLOOR_SHADOW) return true;
      }
    }
  } else {
    // Vertical neighbors — check the horizontal wall strip between them
    const wallY = Math.min(ty1, cellToTile(cx2, cy2).ty) + CELL_SIZE;
    const leftX = tx1;
    for (let wy = 0; wy < WALL_SIZE; wy++) {
      for (let wx = 0; wx < CELL_SIZE; wx++) {
        const tile = data[(wallY + wy) * MAP_SIZE + (leftX + wx)];
        if (tile === TILE_FLOOR || tile === TILE_FLOOR_SHADOW) return true;
      }
    }
  }
  return false;
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
  const hubTileX = Math.floor((MAP_SIZE - HUB_SIZE) / 2);
  const hubTileY = Math.floor((MAP_SIZE - HUB_SIZE) / 2);
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
  const hubCenterX = MAP_SIZE / 2;
  const hubCenterY = MAP_SIZE / 2;

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
    const sectorMin = sectorCenter - sectorSize / 2;
    const sectorMax = sectorCenter + sectorSize / 2;

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
        return angleDiff(a.angle, sectorCenter) < angleDiff(b.angle, sectorCenter) ? a : b;
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