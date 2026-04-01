import {
  CELL_SIZE,
  CELL_STEP,
  GRID_CELLS,
  getHubTileBounds,
  isGateTileId,
  isSolidTileId,
  type TileMapData,
} from './maps/level1.js';

/** Solid for navigation purposes — like isSolidTileId but treats gate tiles as passable. */
function isSolidForNavigation(tile: number): boolean {
  return isSolidTileId(tile) && !isGateTileId(tile);
}
import { getPortalBounds, type PortalCollider } from './physics.js';

export type HubDirection = 'north' | 'east' | 'south' | 'west';

export interface NavigationDistanceField {
  tileDistances: Int16Array;
  cellDistances: Int16Array;
  blockedTiles: Uint8Array | null;
}

export type HubDistanceField = NavigationDistanceField;

type Region =
  | { type: 'cell'; cx: number; cy: number }
  | { type: 'horizontal'; leftCx: number; cy: number }
  | { type: 'vertical'; cx: number; topCy: number };

type CellCoord = { cx: number; cy: number };

const TILE_DIRS: Array<{ direction: HubDirection; dx: number; dy: number }> = [
  { direction: 'north', dx: 0, dy: -1 },
  { direction: 'east', dx: 1, dy: 0 },
  { direction: 'south', dx: 0, dy: 1 },
  { direction: 'west', dx: -1, dy: 0 },
];

const CELL_DIRS: Array<{ direction: HubDirection; dx: number; dy: number }> = [
  { direction: 'north', dx: 0, dy: -1 },
  { direction: 'east', dx: 1, dy: 0 },
  { direction: 'south', dx: 0, dy: 1 },
  { direction: 'west', dx: -1, dy: 0 },
];

export function computeHubDistanceField(map: TileMapData): HubDistanceField {
  const hubBounds = getHubTileBounds(map.width, map.height);
  const seedIndices: number[] = [];

  for (let ty = hubBounds.top; ty <= hubBounds.bottom; ty++) {
    for (let tx = hubBounds.left; tx <= hubBounds.right; tx++) {
      const index = ty * map.width + tx;
      if (isSolidTileId(map.data[index])) continue;
      seedIndices.push(index);
    }
  }

  return computeDistanceField(map, seedIndices, collectHubSeedCells(map), undefined, true);
}

export function computePortalDistanceField(
  map: TileMapData,
  portal: PortalCollider,
): NavigationDistanceField | null {
  const blockedTiles = new Uint8Array(map.width * map.height);
  const seedIndexSet = new Set<number>();
  const seedCellSet = new Set<string>();
  const bounds = getPortalBounds(portal);

  const tileLeft = Math.floor(bounds.left / map.tileSize);
  const tileTop = Math.floor(bounds.top / map.tileSize);
  const tileRight = Math.floor(bounds.right / map.tileSize);
  const tileBottom = Math.floor(bounds.bottom / map.tileSize);

  for (let ty = tileTop; ty <= tileBottom; ty++) {
    for (let tx = tileLeft; tx <= tileRight; tx++) {
      if (tx < 0 || tx >= map.width || ty < 0 || ty >= map.height) continue;
      blockedTiles[ty * map.width + tx] = 1;
    }
  }

  for (let ty = tileTop; ty <= tileBottom; ty++) {
    for (let tx = tileLeft; tx <= tileRight; tx++) {
      if (tx < 0 || tx >= map.width || ty < 0 || ty >= map.height) continue;

      for (const dir of TILE_DIRS) {
        const nextX = tx + dir.dx;
        const nextY = ty + dir.dy;
        if (nextX < 0 || nextX >= map.width || nextY < 0 || nextY >= map.height) continue;

        const nextIndex = nextY * map.width + nextX;
        if (blockedTiles[nextIndex] === 1) continue;
        if (isSolidTileId(map.data[nextIndex])) continue;

        seedIndexSet.add(nextIndex);

        const cell = getContainingCell(nextX, nextY, map);
        if (cell) {
          seedCellSet.add(`${cell.cx},${cell.cy}`);
        }
      }
    }
  }

  if (seedIndexSet.size === 0) return null;

  return computeDistanceField(
    map,
    Array.from(seedIndexSet),
    cellsFromKeySet(seedCellSet),
    blockedTiles,
    true,
  );
}

export function getNavigationDirectionForPosition(
  x: number,
  y: number,
  map: TileMapData,
  distances: NavigationDistanceField,
): HubDirection | null {
  const feetTileX = Math.floor(x / map.tileSize);
  const feetTileY = Math.floor((y - 1) / map.tileSize);
  return getNavigationDirectionForTile(feetTileX, feetTileY, map, distances);
}

export function getNavigationDirectionForTile(
  tileX: number,
  tileY: number,
  map: TileMapData,
  distances: NavigationDistanceField,
): HubDirection | null {
  if (tileX < 0 || tileX >= map.width || tileY < 0 || tileY >= map.height) return null;

  const currentIndex = tileY * map.width + tileX;
  if (isSolidTileId(map.data[currentIndex])) return null;

  const currentTileDistance = distances.tileDistances[currentIndex];
  if (currentTileDistance <= 0) return null;

  if (mapHasClosedGates(map)) {
    return getTileRayDirection(tileX, tileY, map, distances);
  }

  const region = classifyRegion(tileX, tileY, map);
  if (!region) {
    return getTileRayDirection(tileX, tileY, map, distances);
  }

  switch (region.type) {
    case 'cell': {
      const currentDistance = distances.cellDistances[region.cy * GRID_CELLS + region.cx];
      if (currentDistance > 0) {
        let bestDirection: HubDirection | null = null;
        let bestDistance = currentDistance;

        for (const dir of CELL_DIRS) {
          const nextCx = region.cx + dir.dx;
          const nextCy = region.cy + dir.dy;
          if (nextCx < 0 || nextCx >= GRID_CELLS || nextCy < 0 || nextCy >= GRID_CELLS) continue;
          if (!areCellsConnected(map, region.cx, region.cy, nextCx, nextCy)) continue;

          const nextDistance = distances.cellDistances[nextCy * GRID_CELLS + nextCx];
          if (nextDistance === -1 || nextDistance >= bestDistance) continue;

          bestDistance = nextDistance;
          bestDirection = dir.direction;
        }

        if (bestDirection) {
          return bestDirection;
        }
      }

      return getTileRayDirection(tileX, tileY, map, distances);
    }

    case 'horizontal':
      return pickBestDirection([
        {
          direction: 'east',
          distance: getCellDistance(region.leftCx + 1, region.cy, distances.cellDistances),
        },
        {
          direction: 'west',
          distance: getCellDistance(region.leftCx, region.cy, distances.cellDistances),
        },
      ]) ?? getTileRayDirection(tileX, tileY, map, distances);

    case 'vertical':
      return pickBestDirection([
        {
          direction: 'north',
          distance: getCellDistance(region.cx, region.topCy, distances.cellDistances),
        },
        {
          direction: 'south',
          distance: getCellDistance(region.cx, region.topCy + 1, distances.cellDistances),
        },
      ]) ?? getTileRayDirection(tileX, tileY, map, distances);
  }
}

export const getHubDirectionForPosition = getNavigationDirectionForPosition;
export const getHubDirectionForTile = getNavigationDirectionForTile;

function mapHasClosedGates(map: TileMapData): boolean {
  return map.data.some((tile) => isGateTileId(tile));
}

function computeDistanceField(
  map: TileMapData,
  seedIndices: number[],
  seedCells: CellCoord[],
  blockedTiles?: Uint8Array,
  ignoreGates?: boolean,
): NavigationDistanceField {
  return {
    tileDistances: computeTileDistances(map, seedIndices, blockedTiles, ignoreGates),
    cellDistances: computeCellDistances(map, seedCells),
    blockedTiles: blockedTiles ?? null,
  };
}

function computeTileDistances(
  map: TileMapData,
  seedIndices: number[],
  blockedTiles?: Uint8Array,
  ignoreGates?: boolean,
): Int16Array {
  const isTileSolid = ignoreGates ? isSolidForNavigation : isSolidTileId;
  const distances = new Int16Array(map.width * map.height);
  distances.fill(-1);

  const queue: number[] = [];

  for (const index of seedIndices) {
    if (index < 0 || index >= map.width * map.height) continue;
    if (distances[index] !== -1) continue;
    if (blockedTiles && blockedTiles[index] === 1) continue;
    if (isTileSolid(map.data[index])) continue;

    distances[index] = 0;
    queue.push(index);
  }

  let head = 0;
  while (head < queue.length) {
    const currentIndex = queue[head++];
    const currentDistance = distances[currentIndex];
    const tileX = currentIndex % map.width;
    const tileY = Math.floor(currentIndex / map.width);

    for (const dir of TILE_DIRS) {
      const nextX = tileX + dir.dx;
      const nextY = tileY + dir.dy;
      if (nextX < 0 || nextX >= map.width || nextY < 0 || nextY >= map.height) continue;

      const nextIndex = nextY * map.width + nextX;
      if (distances[nextIndex] !== -1) continue;
      if (blockedTiles && blockedTiles[nextIndex] === 1) continue;
      if (isTileSolid(map.data[nextIndex])) continue;

      distances[nextIndex] = currentDistance + 1;
      queue.push(nextIndex);
    }
  }

  return distances;
}

function computeCellDistances(map: TileMapData, seedCells: CellCoord[]): Int16Array {
  const distances = new Int16Array(GRID_CELLS * GRID_CELLS);
  distances.fill(-1);

  const queue: Array<{ cx: number; cy: number }> = [];
  for (const cell of seedCells) {
    const index = cell.cy * GRID_CELLS + cell.cx;
    if (distances[index] !== -1) continue;
    distances[index] = 0;
    queue.push({ cx: cell.cx, cy: cell.cy });
  }

  let head = 0;
  while (head < queue.length) {
    const { cx, cy } = queue[head++];
    const currentDistance = distances[cy * GRID_CELLS + cx];

    for (const dir of CELL_DIRS) {
      const nextCx = cx + dir.dx;
      const nextCy = cy + dir.dy;
      if (nextCx < 0 || nextCx >= GRID_CELLS || nextCy < 0 || nextCy >= GRID_CELLS) continue;

      const nextIndex = nextCy * GRID_CELLS + nextCx;
      if (distances[nextIndex] !== -1) continue;
      if (!areCellsConnected(map, cx, cy, nextCx, nextCy)) continue;

      distances[nextIndex] = currentDistance + 1;
      queue.push({ cx: nextCx, cy: nextCy });
    }
  }

  return distances;
}

function collectHubSeedCells(map: TileMapData): CellCoord[] {
  const hubBounds = getHubTileBounds(map.width, map.height);
  const wallSize = getOuterWallSize(map);
  const seedCells: CellCoord[] = [];

  for (let cy = 0; cy < GRID_CELLS; cy++) {
    for (let cx = 0; cx < GRID_CELLS; cx++) {
      const tx = wallSize + cx * CELL_STEP;
      const ty = wallSize + cy * CELL_STEP;
      const cellRight = tx + CELL_SIZE - 1;
      const cellBottom = ty + CELL_SIZE - 1;
      const overlapsHub = tx <= hubBounds.right &&
        cellRight >= hubBounds.left &&
        ty <= hubBounds.bottom &&
        cellBottom >= hubBounds.top;
      if (!overlapsHub) continue;

      seedCells.push({ cx, cy });
    }
  }

  return seedCells;
}

function cellsFromKeySet(keys: Set<string>): CellCoord[] {
  const cells: CellCoord[] = [];

  for (const key of keys) {
    const [cx, cy] = key.split(',').map(Number);
    cells.push({ cx, cy });
  }

  return cells;
}

function classifyRegion(tileX: number, tileY: number, map: TileMapData): Region | null {
  const wallSize = getOuterWallSize(map);
  const localX = tileX - wallSize;
  const localY = tileY - wallSize;
  if (localX < 0 || localY < 0) return null;

  const cx = Math.floor(localX / CELL_STEP);
  const cy = Math.floor(localY / CELL_STEP);
  if (cx < 0 || cx >= GRID_CELLS || cy < 0 || cy >= GRID_CELLS) return null;

  const offsetX = localX % CELL_STEP;
  const offsetY = localY % CELL_STEP;

  if (offsetX < CELL_SIZE && offsetY < CELL_SIZE) {
    return { type: 'cell', cx, cy };
  }

  if (offsetX >= CELL_SIZE && offsetY < CELL_SIZE && cx < GRID_CELLS - 1) {
    return { type: 'horizontal', leftCx: cx, cy };
  }

  if (offsetX < CELL_SIZE && offsetY >= CELL_SIZE && cy < GRID_CELLS - 1) {
    return { type: 'vertical', cx, topCy: cy };
  }

  return null;
}

function getContainingCell(tileX: number, tileY: number, map: TileMapData): CellCoord | null {
  const wallSize = getOuterWallSize(map);
  const localX = tileX - wallSize;
  const localY = tileY - wallSize;
  if (localX < 0 || localY < 0) return null;

  const cx = Math.floor(localX / CELL_STEP);
  const cy = Math.floor(localY / CELL_STEP);
  if (cx < 0 || cx >= GRID_CELLS || cy < 0 || cy >= GRID_CELLS) return null;

  return { cx, cy };
}

function areCellsConnected(
  map: TileMapData,
  cx1: number,
  cy1: number,
  cx2: number,
  cy2: number,
): boolean {
  const wallSize = getOuterWallSize(map);
  const tx1 = wallSize + cx1 * CELL_STEP;
  const ty1 = wallSize + cy1 * CELL_STEP;
  const tx2 = wallSize + cx2 * CELL_STEP;
  const ty2 = wallSize + cy2 * CELL_STEP;

  if (cy1 === cy2) {
    const wallX = Math.min(tx1, tx2) + CELL_SIZE;
    for (let wy = 0; wy < CELL_SIZE; wy++) {
      for (let wx = 0; wx < CELL_STEP - CELL_SIZE; wx++) {
        const tile = map.data[(ty1 + wy) * map.width + (wallX + wx)];
        if (!isSolidTileId(tile)) return true;
      }
    }
  } else {
    const wallY = Math.min(ty1, ty2) + CELL_SIZE;
    for (let wy = 0; wy < CELL_STEP - CELL_SIZE; wy++) {
      for (let wx = 0; wx < CELL_SIZE; wx++) {
        const tile = map.data[(wallY + wy) * map.width + (tx1 + wx)];
        if (!isSolidTileId(tile)) return true;
      }
    }
  }

  return false;
}

function getTileRayDirection(
  tileX: number,
  tileY: number,
  map: TileMapData,
  distances: NavigationDistanceField,
): HubDirection | null {
  const currentDistance = distances.tileDistances[tileY * map.width + tileX];
  if (currentDistance <= 0) return null;

  let bestDirection: HubDirection | null = null;
  let bestDistance = currentDistance;

  for (const dir of TILE_DIRS) {
    let step = 1;
    let rayBest = Number.POSITIVE_INFINITY;

    while (true) {
      const nextX = tileX + dir.dx * step;
      const nextY = tileY + dir.dy * step;
      if (nextX < 0 || nextX >= map.width || nextY < 0 || nextY >= map.height) break;

      const nextIndex = nextY * map.width + nextX;
      if (distances.blockedTiles && distances.blockedTiles[nextIndex] === 1) break;
      if (isSolidForNavigation(map.data[nextIndex])) break;

      const nextDistance = distances.tileDistances[nextIndex];
      if (nextDistance !== -1) {
        rayBest = Math.min(rayBest, nextDistance);
      }

      step++;
    }

    if (rayBest >= bestDistance) continue;
    bestDistance = rayBest;
    bestDirection = dir.direction;
  }

  return bestDirection;
}

function getCellDistance(cx: number, cy: number, distances: Int16Array): number {
  if (cx < 0 || cx >= GRID_CELLS || cy < 0 || cy >= GRID_CELLS) return -1;
  return distances[cy * GRID_CELLS + cx];
}

function pickBestDirection(
  candidates: Array<{ direction: HubDirection; distance: number }>,
): HubDirection | null {
  let bestDirection: HubDirection | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    if (candidate.distance === -1 || candidate.distance >= bestDistance) continue;
    bestDistance = candidate.distance;
    bestDirection = candidate.direction;
  }

  return bestDirection;
}

function getOuterWallSize(map: TileMapData): number {
  return map.width - GRID_CELLS * CELL_STEP;
}
