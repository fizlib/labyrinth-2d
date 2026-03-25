// packages/shared/src/maps/level1.ts
// ─────────────────────────────────────────────────────────────────────────────
// Level 1 — A 41×41 labyrinth with a central hub and 3 equal-length corridors.
//
// Tile IDs:
//   0 = floor (walkable)
//   1 = wall  (solid, blocks movement)
//
// Layout:
//   - 41×41 tile grid (656×656 px at 16px/tile)
//   - 7×7 central hub room at tiles (17,17)–(23,23)
//   - 3 winding corridors connecting spawn points to the hub
//   - Each corridor is EXACTLY 45 walkable tiles long
//   - Hub has 3 entrances: north (20,16), west (16,20), east (24,20)
//
// Spawn points (tile coordinates):
//   A: (11, 3)  — top-left area, enters hub from north
//   B: (3, 11)  — left area, enters hub from west
//   C: (37, 11) — right area, enters hub from east
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

// ── Map Generation ──────────────────────────────────────────────────────────

const MAP_W = 41;
const MAP_H = 41;
const TILE_PX = 16;

/** Carve a horizontal line of floor tiles from (x1,y) to (x2,y). */
function carveH(data: number[], x1: number, x2: number, y: number): void {
  const lo = Math.min(x1, x2);
  const hi = Math.max(x1, x2);
  for (let x = lo; x <= hi; x++) {
    data[y * MAP_W + x] = 0;
  }
}

/** Carve a vertical line of floor tiles from (x,y1) to (x,y2). */
function carveV(data: number[], x: number, y1: number, y2: number): void {
  const lo = Math.min(y1, y2);
  const hi = Math.max(y1, y2);
  for (let y = lo; y <= hi; y++) {
    data[y * MAP_W + x] = 0;
  }
}

function generateLevel1(): number[] {
  // Start with all walls
  const data = new Array(MAP_W * MAP_H).fill(1);

  // ── Central Hub: 7×7 room at (17,17)–(23,23) ───────────────────────────
  for (let y = 17; y <= 23; y++) {
    for (let x = 17; x <= 23; x++) {
      data[y * MAP_W + x] = 0;
    }
  }

  // ── Corridor A: North entrance (20,16) → Spawn A (11,3) ────────────────
  // Total: 45 tiles, 7 segments
  // Segment 1: Up from (20,16) to (20,9) — 8 tiles
  carveV(data, 20, 9, 16);
  // Segment 2: Right from (21,9) to (26,9) — 6 tiles
  carveH(data, 21, 26, 9);
  // Segment 3: Up from (26,8) to (26,4) — 5 tiles
  carveV(data, 26, 4, 8);
  // Segment 4: Left from (25,4) to (16,4) — 10 tiles
  carveH(data, 16, 25, 4);
  // Segment 5: Down from (16,5) to (16,9) — 5 tiles
  carveV(data, 16, 5, 9);
  // Segment 6: Left from (15,9) to (11,9) — 5 tiles
  carveH(data, 11, 15, 9);
  // Segment 7: Up from (11,8) to (11,3) — 6 tiles
  carveV(data, 11, 3, 8);

  // ── Corridor B: West entrance (16,20) → Spawn B (3,11) ─────────────────
  // Total: 45 tiles, 7 segments (same shape as A, rotated 90° CW)
  // Segment 1: Left from (16,20) to (9,20) — 8 tiles
  carveH(data, 9, 16, 20);
  // Segment 2: Down from (9,21) to (9,26) — 6 tiles
  carveV(data, 9, 21, 26);
  // Segment 3: Left from (8,26) to (4,26) — 5 tiles
  carveH(data, 4, 8, 26);
  // Segment 4: Up from (4,25) to (4,16) — 10 tiles
  carveV(data, 4, 16, 25);
  // Segment 5: Right from (5,16) to (9,16) — 5 tiles
  carveH(data, 5, 9, 16);
  // Segment 6: Up from (9,15) to (9,11) — 5 tiles
  carveV(data, 9, 11, 15);
  // Segment 7: Left from (8,11) to (3,11) — 6 tiles
  carveH(data, 3, 8, 11);

  // ── Corridor C: East entrance (24,20) → Spawn C (37,11) ────────────────
  // Total: 45 tiles, 7 segments (mirror of B)
  // Segment 1: Right from (24,20) to (31,20) — 8 tiles
  carveH(data, 24, 31, 20);
  // Segment 2: Down from (31,21) to (31,26) — 6 tiles
  carveV(data, 31, 21, 26);
  // Segment 3: Right from (32,26) to (36,26) — 5 tiles
  carveH(data, 32, 36, 26);
  // Segment 4: Up from (36,25) to (36,16) — 10 tiles
  carveV(data, 36, 16, 25);
  // Segment 5: Left from (35,16) to (31,16) — 5 tiles
  carveH(data, 31, 35, 16);
  // Segment 6: Up from (31,15) to (31,11) — 5 tiles
  carveV(data, 31, 11, 15);
  // Segment 7: Right from (32,11) to (37,11) — 6 tiles
  carveH(data, 32, 37, 11);

  return data;
}

// ── Exports ─────────────────────────────────────────────────────────────────

/**
 * The 3 spawn points in TILE coordinates.
 * Each corridor from a spawn point to the central hub is exactly 45 tiles long.
 * The server assigns players to these using round-robin.
 */
export const SPAWN_POINTS: SpawnPoint[] = [
  { x: 11, y: 3 },   // Spawn A — top area, corridor enters hub from north
  { x: 3, y: 11 },   // Spawn B — left area, corridor enters hub from west
  { x: 37, y: 11 },  // Spawn C — right area, corridor enters hub from east
];

export const LEVEL_1_MAP: TileMapData = {
  width: MAP_W,
  height: MAP_H,
  tileSize: TILE_PX,
  data: generateLevel1(),
};
