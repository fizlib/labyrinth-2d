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

export interface GeneratedMazeLayout {
  map: TileMapData;
  spawnPoints: SpawnPoint[];
  gates: GatePlacement[];
  /** Pressure plate positions for gate activation. */
  pressurePlates: PressurePlateInfo[];
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

/** Runestone 1 (Obelisk) — solid, 16×32 sprite, interactive. */
export const TILE_RUNESTONE_1 = 14;

/** Runestone 2 (Shrine) — solid, 16×32 sprite, interactive. */
export const TILE_RUNESTONE_2 = 15;

/** Runestone 3 (Jagged) — solid, 16×32 sprite, interactive. */
export const TILE_RUNESTONE_3 = 16;

/** Closed gate segment spanning left-to-right across a cell. */
export const TILE_GATE_HORIZONTAL = 17;

/** Closed gate segment spanning top-to-bottom across a cell. */
export const TILE_GATE_VERTICAL = 18;

/** Pressure plate — walkable, decorative tile checked for player overlap by the server. */
export const TILE_PRESSURE_PLATE = 19;

// ── Constants ───────────────────────────────────────────────────────────────

export const CELL_SIZE = 6;
const WALL_SIZE = 8;
export const CELL_STEP = CELL_SIZE + WALL_SIZE;
export const GRID_CELLS = 15;
export const MAP_SIZE = WALL_SIZE + GRID_CELLS * CELL_STEP; // = 218
const TILE_PX = 16;

/** Size of the central hub room in tiles. Matches CELL_SIZE to prevent cutting wall corners, resulting in a clean cross-shaped hub area. */
const HUB_SIZE = 30;

export interface HubTileBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function getHubTileBounds(width: number = MAP_SIZE, height: number = MAP_SIZE): HubTileBounds {
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
  return tile === TILE_WALL_FACE ||
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
    tile === TILE_RUNESTONE_1 ||
    tile === TILE_RUNESTONE_2 ||
    tile === TILE_RUNESTONE_3 ||
    isGateTileId(tile);
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

      const left = snap2[idx - 1];
      const right = snap2[idx + 1];
      const top = snap2[idx - MAP_SIZE];
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

  // (Step 4 removed — shadows are now handled client-side via directional overlays)

  // ── Step 5: Central hub decoration — tree + runestones ───────────────────
  {
    const hubCx = hubTileX + Math.floor(hubSize / 2);
    const hubCy = hubTileY + Math.floor(hubSize / 2);

    // Tree at the exact center
    data[hubCy * MAP_SIZE + hubCx] = TILE_TREE;

    // 3 runestones in a semi-circle in front of (below) the tree
    data[(hubCy + 3) * MAP_SIZE + (hubCx - 6)] = TILE_RUNESTONE_1; // obelisk — left
    data[(hubCy + 4) * MAP_SIZE + hubCx]       = TILE_RUNESTONE_2; // shrine  — center
    data[(hubCy + 3) * MAP_SIZE + (hubCx + 6)] = TILE_RUNESTONE_3; // jagged  — right
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

function isWalkableTileId(tile: number): boolean {
  return tile === TILE_FLOOR || tile === TILE_FLOOR_SHADOW;
}

function spawnPointToCell(spawnPoint: SpawnPoint): CellCoord {
  return {
    cx: Math.round((spawnPoint.x - (CELL_SIZE - 1) / 2 - WALL_SIZE) / CELL_STEP),
    cy: Math.round((spawnPoint.y - (CELL_SIZE - 1) / 2 - WALL_SIZE) / CELL_STEP),
  };
}

function getGateOrientationForCell(data: number[], cx: number, cy: number): GateOrientation | null {
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
      if (nextCx < 0 || nextCx >= GRID_CELLS || nextCy < 0 || nextCy >= GRID_CELLS) continue;
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

function createGatePlacement(teamIndex: number, cellX: number, cellY: number, orientation: GateOrientation, spawnDirection: GateSpawnDirection): GatePlacement {
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
      data[gate.tileY * MAP_SIZE + (gate.tileX + dx)] = TILE_GATE_HORIZONTAL;
    }
    return;
  }

  for (let dy = 0; dy < CELL_SIZE; dy++) {
    data[(gate.tileY + dy) * MAP_SIZE + gate.tileX] = TILE_GATE_VERTICAL;
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
  const clampedEndX = Math.min(MAP_SIZE, startX + width);
  const clampedEndY = Math.min(MAP_SIZE, startY + height);

  for (let y = clampedStartY; y < clampedEndY; y++) {
    for (let x = clampedStartX; x < clampedEndX; x++) {
      dirtMask[y * MAP_SIZE + x] = 1;
    }
  }
}

function stampGateDirtBand(dirtMask: Uint8Array, gate: GatePlacement): void {
  if (gate.orientation === 'horizontal') {
    stampDirtRect(dirtMask, gate.tileX, gate.tileY - 1, CELL_SIZE, 3);
    return;
  }

  stampDirtRect(dirtMask, gate.tileX - 1, gate.tileY, 3, CELL_SIZE);
}

function computeGatePlacements(data: number[], spawnPoints: SpawnPoint[]): GatePlacement[] {
  const hubBounds = getHubTileBounds(MAP_SIZE, MAP_SIZE);
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
      const spawnDirection: GateSpawnDirection = prevCell.cy < cell.cy ? 'north' : 'south';

      gates.push(createGatePlacement(teamIndex, cell.cx, cell.cy, orientation, spawnDirection));
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

    const { tx, ty } = cellToTile(gate.cellX, gate.cellY);
    const gateRow = gate.tileY; // The row where the gate barrier sits

    // Spawn side: 2 plates on left and right edges, 1 row away from gate toward spawn
    // Hub side: 1 plate centered, 1 row away from gate toward hub
    const spawnRow = gate.spawnDirection === 'north' ? gateRow - 2 : gateRow + 1;
    const hubRow = gate.spawnDirection === 'north' ? gateRow + 1 : gateRow - 2;

    // Spawn side — left plate (leftmost tile of cell)
    plates.push({
      id: nextId++,
      gateIndex,
      tileX: tx,
      tileY: spawnRow,
      side: 'spawn',
    });

    // Spawn side — right plate (rightmost tile of cell)
    plates.push({
      id: nextId++,
      gateIndex,
      tileX: tx + CELL_SIZE - 1,
      tileY: spawnRow,
      side: 'spawn',
    });

    // Hub side — center plate
    plates.push({
      id: nextId++,
      gateIndex,
      tileX: tx + Math.floor(CELL_SIZE / 2),
      tileY: hubRow,
      side: 'hub',
    });
  }

  return plates;
}

// ── Exports ─────────────────────────────────────────────────────────────────

export const MAZE_SIZE = MAP_SIZE;

export function generateMazeLayout(
  seed: number,
  spawnDistance: number,
  numTeams: number = DEFAULT_LAYOUT_TEAM_COUNT,
): GeneratedMazeLayout {
  const baseData = generateMazeData(seed);
  const spawnPoints = computeSpawnPoints(baseData, spawnDistance, numTeams);
  const gates = computeGatePlacements(baseData, spawnPoints);
  const gatedData = baseData.slice();
  const dirtMask = new Uint8Array(MAP_SIZE * MAP_SIZE);

  for (const gate of gates) {
    stampGate(gatedData, gate);
    stampGateDirtBand(dirtMask, gate);
  }

  const pressurePlates = computePressurePlates(gates);

  // Stamp pressure plate tiles into map data
  for (const plate of pressurePlates) {
    if (plate.tileX >= 0 && plate.tileX < MAP_SIZE && plate.tileY >= 0 && plate.tileY < MAP_SIZE) {
      gatedData[plate.tileY * MAP_SIZE + plate.tileX] = TILE_PRESSURE_PLATE;
    }
  }

  return {
    map: {
      width: MAP_SIZE,
      height: MAP_SIZE,
      tileSize: TILE_PX,
      data: gatedData,
    },
    spawnPoints,
    gates,
    pressurePlates,
    dirtMask,
  };
}

export function generateMaze(seed: number): TileMapData {
  return generateMazeLayout(seed, DEFAULT_LAYOUT_SPAWN_DISTANCE, DEFAULT_LAYOUT_TEAM_COUNT).map;
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
        if (isWalkableTileId(tile)) return true;
      }
    }
  } else {
    // Vertical neighbors — check the horizontal wall strip between them
    const wallY = Math.min(ty1, cellToTile(cx2, cy2).ty) + CELL_SIZE;
    const leftX = tx1;
    for (let wy = 0; wy < WALL_SIZE; wy++) {
      for (let wx = 0; wx < CELL_SIZE; wx++) {
        const tile = data[(wallY + wy) * MAP_SIZE + (leftX + wx)];
        if (isWalkableTileId(tile)) return true;
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
        x: tx + (CELL_SIZE - 1) / 2,
        y: ty + (CELL_SIZE - 1) / 2,
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
 * Compute a portal spawn position that is farther from the hub than the
 * player spawn points.
 *
 * Algorithm:
 *   1. Build a cell-level adjacency graph (same as computeSpawnPoints).
 *   2. BFS from all hub cells.
 *   3. Find reachable floor cells at distance > spawnDistance.
 *      Target distance = spawnDistance + 2, capped at GRID_CELLS - 1.
 *   4. Pick the cell with the highest BFS distance (deepest in the maze).
 *      Ties broken by closest to due-south direction from hub center.
 *
 * @param data           Flat tile array from generateMaze
 * @param spawnDistance   The spawn distance used for teams (to ensure portal is farther)
 * @returns              Pixel coordinates { x, y } of the portal center, or null if none found
 */
export function computePortalPosition(
  data: number[],
  spawnDistance: number,
): SpawnPoint | null {
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
      if (cellDist[ny * GRID_CELLS + nx] !== -1) continue;
      if (!areCellsConnected(data, cx, cy, nx, ny)) continue;

      cellDist[ny * GRID_CELLS + nx] = d + 1;
      queue.push({ cx: nx, cy: ny });
    }
  }

  // ── 3. Find candidates at distance > spawnDistance ──────────────────
  const targetMinDist = spawnDistance + 1;
  const targetMaxDist = Math.min(spawnDistance + 3, GRID_CELLS - 1);

  const hubCenterX = MAP_SIZE / 2;
  const hubCenterY = MAP_SIZE / 2;

  interface Candidate { cx: number; cy: number; dist: number; angle: number }
  let candidates: Candidate[] = [];

  for (let cy = 0; cy < GRID_CELLS; cy++) {
    for (let cx = 0; cx < GRID_CELLS; cx++) {
      const d = cellDist[cy * GRID_CELLS + cx];
      if (d === -1) continue;
      if (d < targetMinDist || d > targetMaxDist) continue;
      if (hubCells.has(`${cx},${cy}`)) continue;

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

  return {
    x: tx + (CELL_SIZE - 1) / 2,
    y: ty + (CELL_SIZE - 1) / 2,
  };
}
