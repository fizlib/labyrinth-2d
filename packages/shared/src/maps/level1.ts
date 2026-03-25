// packages/shared/src/maps/level1.ts
// ─────────────────────────────────────────────────────────────────────────────
// Level 1 — A basic labyrinth room with wall borders and interior obstacles.
//
// Tile IDs:
//   0 = floor (walkable)
//   1 = wall  (solid, blocks movement)
//
// The map is 30 tiles wide × 17 tiles tall (480×272 px at 16px tiles).
// This fills the 480×270 internal resolution almost exactly.
//
// Layout:
//   - Solid wall border around the entire room.
//   - Several interior wall blocks forming corridors and obstacles.
//   - Open spawn area in the top-left quadrant around tile (2,2).
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

// prettier-ignore
export const LEVEL_1_MAP: TileMapData = {
  width: 30,
  height: 17,
  tileSize: 16,
  data: [
    // Row 0  — top border
    1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,
    // Row 1
    1,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,
    // Row 2
    1,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,
    // Row 3
    1,0,0,0,0,0,1,1,1,0,0,0,0,0,1,0,0,0,0,1,1,1,1,0,0,0,0,0,0,1,
    // Row 4
    1,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,1,
    // Row 5
    1,0,0,0,0,0,1,0,0,0,0,1,1,0,0,0,0,0,0,1,0,0,0,0,0,1,1,0,0,1,
    // Row 6
    1,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,1,
    // Row 7
    1,0,0,0,0,0,0,0,0,0,0,1,0,0,0,1,0,0,0,0,0,0,0,0,0,1,0,0,0,1,
    // Row 8  — middle row
    1,0,0,0,1,1,1,1,0,0,0,0,0,0,0,1,0,0,0,0,0,1,1,1,1,0,0,0,0,1,
    // Row 9
    1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,1,
    // Row 10
    1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,
    // Row 11
    1,0,0,0,0,1,1,0,0,0,1,1,1,1,0,0,0,0,1,1,1,0,0,0,0,0,0,0,0,1,
    // Row 12
    1,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,1,1,0,0,0,1,
    // Row 13
    1,0,0,0,0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0,1,0,0,0,0,1,
    // Row 14
    1,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,1,
    // Row 15
    1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,
    // Row 16 — bottom border
    1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,
  ],
};
