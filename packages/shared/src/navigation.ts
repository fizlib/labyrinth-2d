import {
  getHubTileBounds,
  isSolidTileId,
  type TileMapData,
} from './maps/level1.js';

export type HubDirection = 'north' | 'east' | 'south' | 'west';

export type HubDistanceField = Int16Array;

const HUB_NEIGHBORS: Array<{ direction: HubDirection; dx: number; dy: number }> = [
  { direction: 'north', dx: 0, dy: -1 },
  { direction: 'east', dx: 1, dy: 0 },
  { direction: 'south', dx: 0, dy: 1 },
  { direction: 'west', dx: -1, dy: 0 },
];

export function computeHubDistanceField(map: TileMapData): HubDistanceField {
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

    for (const neighbor of HUB_NEIGHBORS) {
      const nextX = tileX + neighbor.dx;
      const nextY = tileY + neighbor.dy;
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
  if (tileX < 0 || tileX >= map.width || tileY < 0 || tileY >= map.height) return null;

  const currentIndex = tileY * map.width + tileX;
  if (isSolidTileId(map.data[currentIndex])) return null;

  const currentDistance = distances[currentIndex];
  if (currentDistance <= 0) return null;

  let bestDirection: HubDirection | null = null;
  let bestDistance = currentDistance;

  for (const neighbor of HUB_NEIGHBORS) {
    const nextX = tileX + neighbor.dx;
    const nextY = tileY + neighbor.dy;
    if (nextX < 0 || nextX >= map.width || nextY < 0 || nextY >= map.height) continue;

    const nextIndex = nextY * map.width + nextX;
    if (isSolidTileId(map.data[nextIndex])) continue;

    const nextDistance = distances[nextIndex];
    if (nextDistance === -1 || nextDistance >= bestDistance) continue;

    bestDistance = nextDistance;
    bestDirection = neighbor.direction;
  }

  return bestDirection;
}
