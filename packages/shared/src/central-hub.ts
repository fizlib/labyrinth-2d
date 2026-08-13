import {
  MAP_HEIGHT,
  MAP_WIDTH,
  getHubTileBounds,
  type TileMapData,
} from './maps/level1.js';
import {
  CENTRAL_HUB_COLLIDER_SPECS,
  CENTRAL_HUB_RUNESTONE_SPECS,
} from './central-hub-layout.generated.js';

export const CENTRAL_HUB_AUTHORING_TILE_SIZE = 16;

export interface CentralHubCollisionBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
  shape: 'rectangle' | 'right-triangle';
  flipX: boolean;
  flipY: boolean;
}

export interface CentralHubRunestonePlacement {
  index: number;
  /** Exact world-space top-left used by the authored visual. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Fractional tile coordinates preserve exact activation/render centers. */
  tileX: number;
  tileY: number;
}

function isCentralHubMap(map: TileMapData): boolean {
  return map.width === MAP_WIDTH && map.height === MAP_HEIGHT;
}

function getCentralHubAnchor(map: TileMapData): { x: number; y: number; scale: number } {
  const bounds = getHubTileBounds(map.width, map.height);
  return {
    x: bounds.left * map.tileSize,
    y: bounds.top * map.tileSize,
    scale: map.tileSize / CENTRAL_HUB_AUTHORING_TILE_SIZE,
  };
}

/** Exact rectangle/right-triangle geometry exported for the redesigned hub. */
export function getCentralHubCollisionBounds(
  map: TileMapData,
): CentralHubCollisionBounds[] {
  if (!isCentralHubMap(map)) return [];
  const anchor = getCentralHubAnchor(map);
  return CENTRAL_HUB_COLLIDER_SPECS.map(
    ([x, y, width, height, rightTriangle, flipX, flipY]) => {
      const left = anchor.x + x * anchor.scale;
      const top = anchor.y + y * anchor.scale;
      return {
        left,
        top,
        right: left + width * anchor.scale - 1,
        bottom: top + height * anchor.scale - 1,
        shape: rightTriangle ? 'right-triangle' : 'rectangle',
        flipX: flipX === 1,
        flipY: flipY === 1,
      };
    },
  );
}

/** Exact visual and interaction anchors for the three moved runestones. */
export function getCentralHubRunestonePlacements(
  map: TileMapData,
): CentralHubRunestonePlacement[] {
  if (!isCentralHubMap(map)) return [];
  const anchor = getCentralHubAnchor(map);
  return CENTRAL_HUB_RUNESTONE_SPECS.map((spec) => {
    const x = anchor.x + spec.x * anchor.scale;
    const y = anchor.y + spec.y * anchor.scale;
    const width = spec.width * anchor.scale;
    const height = spec.height * anchor.scale;
    return {
      index: spec.index,
      x,
      y,
      width,
      height,
      tileX: (x + width / 2) / map.tileSize - 0.5,
      tileY: (y + height) / map.tileSize - 1,
    };
  });
}

/** The east seam tile was explicitly erased in the editor before its offset repaint. */
export function isCentralHubSuppressedGroundTile(
  tileX: number,
  tileY: number,
  map: TileMapData,
): boolean {
  if (!isCentralHubMap(map)) return false;
  const bounds = getHubTileBounds(map.width, map.height);
  return tileX === bounds.right && tileY === bounds.top + 16;
}
