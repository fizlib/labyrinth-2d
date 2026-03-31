import {
  CELL_SIZE,
  CELL_STEP,
  GRID_CELLS,
  getHubTileBounds,
  isSolidTileId,
  type TileMapData,
} from './maps/level1.js';

export type HubDirection = 'north' | 'east' | 'south' | 'west';

export interface HubDistanceField {
  tileDistances: Int16Array;
  cellDistances: Int16Array;
}

type Region =
  | { type: 'hub' }
  | { type: 'cell'; cx: number; cy: number }
  | { type: 'horizontal'; leftCx: number; cy: number }
  | { type: 'vertical'; cx: number; topCy: number };

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
  return {
    tileDistances: computeTileDistances(map),
    cellDistances: computeCellDistances(map),
  };
}

export function getHubDirectionForPosition(
  x: number,
  y: number,
  map: TileMapData,
  distances: HubDistanceField,
): HubDirection | null {
  const feetTileX = Math.floor(x / map.tileSize);
  const feetTileY = Math.floor((y - 1) / map.tileSize);
  return getHubDirectionForTile(feetTileX, feetTileY, map, distances);
}

export function getHubDirectionForTile(
  tileX: number,
  tileY: number,
  map: TileMapData,
  distances: HubDistanceField,
): HubDirection | null {
  const region = classifyRegion(tileX, tileY, map);
  if (!region || region.type === 'hub') return null;

  switch (region.type) {
    case 'cell': {
      const currentDist = distances.cellDistances[region.cy * GRID_CELLS + region.cx];
      let bestDirection: HubDirection | null = null;
      let bestDistance = currentDist;

      for (const dir of CELL_DIRS) {
        const nextCx = region.cx + dir.dx;
        const nextCy = region.cy + dir.dy;
        if (nextCx < 0 || nextCx >= GRID_CELLS || nextCy < 0 || nextCy >= GRID_CELLS) continue;
        if (!areCellsConnected(map, region.cx, region.cy, nextCx, nextCy)) continue;

        const nextDist = distances.cellDistances[nextCy * GRID_CELLS + nextCx];
        if (nextDist === -1 || nextDist >= bestDistance) continue;

        bestDistance = nextDist;
        bestDirection = dir.direction;
      }

      return bestDirection ?? getTileRayDirection(tileX, tileY, map, distances.tileDistances);
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
      ]);

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
      ]);
  }
}

function computeTileDistances(map: TileMapData): Int16Array {
  const distances = new Int16Array(map.width * map.height);
  distances.fill(-1);

  const hubBounds = getHubTileBounds(map.width, map.height);
  const queue: number[] = [];

  for (let ty = hubBounds.top; ty <= hubBounds.bottom; ty++) {
    for (let tx = hubBounds.left; tx <= hubBounds.right; tx++) {
      const index = ty * map.width + tx;
      if (isSolidTileId(map.data[index])) continue;
      distances[index] = 0;
      queue.push(index);
    }
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
      if (isSolidTileId(map.data[nextIndex])) continue;

      distances[nextIndex] = currentDistance + 1;
      queue.push(nextIndex);
    }
  }

  return distances;
}

function computeCellDistances(map: TileMapData): Int16Array {
  const distances = new Int16Array(GRID_CELLS * GRID_CELLS);
  distances.fill(-1);

  const hubBounds = getHubTileBounds(map.width, map.height);
  const wallSize = getOuterWallSize(map);
  const queue: Array<{ cx: number; cy: number }> = [];

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

      distances[cy * GRID_CELLS + cx] = 0;
      queue.push({ cx, cy });
    }
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

function classifyRegion(tileX: number, tileY: number, map: TileMapData): Region | null {
  if (tileX < 0 || tileX >= map.width || tileY < 0 || tileY >= map.height) return null;
  if (isSolidTileId(map.data[tileY * map.width + tileX])) return null;

  const hubBounds = getHubTileBounds(map.width, map.height);
  if (
    tileX >= hubBounds.left &&
    tileX <= hubBounds.right &&
    tileY >= hubBounds.top &&
    tileY <= hubBounds.bottom
  ) {
    return { type: 'hub' };
  }

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
  tileDistances: Int16Array,
): HubDirection | null {
  const currentDistance = tileDistances[tileY * map.width + tileX];
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
      if (isSolidTileId(map.data[nextIndex])) break;

      const nextDistance = tileDistances[nextIndex];
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
