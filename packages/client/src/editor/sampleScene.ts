import {
  CELL_SIZE,
  CELL_STEP_X,
  CELL_STEP_Y,
  GRID_CELLS,
  SPAWN_DISTANCE,
  TILE_RUNESTONE_1,
  TILE_RUNESTONE_2,
  TILE_RUNESTONE_3,
  TILE_TREE,
  WALL_HEIGHT,
  WALL_WIDTH,
  generateMazeLayout,
  getBridgeBounds,
  getChestDeadEndBounds,
  getHubTileBounds,
  getTIntersectionDecorationBounds,
  getPortalBounds,
  getPortalPlatformBounds,
  getPortalWallOpeningBounds,
  isSolidTileId,
  type GeneratedMazeLayout,
  type GatePlacement,
  type BridgePlacement,
  type PortalBounds,
  type SwampPlacement,
  type TileMapData,
} from '@labyrinth/shared';
import {
  BRIDGE_OBSTACLE_SPRITES,
  BRIDGE_OBSTACLE_TERRAIN_SPRITES,
  BRIDGE_OBSTACLE_HIDDEN_FOREST_SPRITES,
  getBridgeObstacleAssetPath,
  type BridgeObstacleAsset,
} from '../systems/BridgeObstacleLayout';
import {
  buildForestStylePlacementRows,
  getForestGroundAssetId,
  getForestGroundUnderlayAssetId,
  getForestGroundZIndex,
  isForestWallTileId,
  type ForestStylePlacementSpec,
} from '../systems/ForestWallLayout';
import {
  PORTAL_PLATFORM_GROUND_DETAIL_SPRITES,
  PORTAL_PLATFORM_GROUND_SPRITES,
  PORTAL_PLATFORM_STRUCTURE_SPRITES,
  PORTAL_VISUAL_OFFSET_X,
  getPortalPlatformAssetPath,
} from '../systems/PortalPlatformLayout';
import {
  SWAMP_OBSTACLE_AUTHORED_DETAIL_SPRITES,
  getSwampObstacleAssetPath,
  getSwampObstacleTerrainSprites,
  type SwampObstacleAsset,
} from '../systems/SwampObstacleLayout';
import {
  getChestDeadEndChestSpritePair,
  getChestDeadEndAssetPath,
  getChestDeadEndScenerySprites,
} from '../systems/ChestDeadEndLayout';
import {
  T_INTERSECTION_DECORATION_SPRITES,
  getTIntersectionDecorationAssetPath,
} from '../systems/TIntersectionDecorationLayout';
import type { EditorCollider, EditorElement, SemanticRole, StyleEditorDocumentV1 } from './types';

const TILE = 16;
const MAZE_SEED = 44;
const CROP_CELL_X = 2;
const CROP_CELL_Y = 5;
const CROP_CELLS_WIDE = 7;
const CROP_CELLS_HIGH = 10;
const CROP_TILE_X = CROP_CELL_X * CELL_STEP_X;
const CROP_TILE_Y = CROP_CELL_Y * CELL_STEP_Y;
const SAMPLE_TILES_WIDE = WALL_WIDTH + CROP_CELLS_WIDE * CELL_STEP_X;
const SAMPLE_TILES_HIGH = WALL_HEIGHT + CROP_CELLS_HIGH * CELL_STEP_Y;
const SAMPLE_WIDTH = SAMPLE_TILES_WIDE * TILE;
const SAMPLE_HEIGHT = SAMPLE_TILES_HIGH * TILE;
const FIORWOODS_ROOT = '/assets/chained-echoes-assets-sorted/Assets/Maps/Fiorwoods';
const FOREST_ROOT = '/assets/forest';
const GATE_SHEET = '/assets/gates.png';
const PLATE_SHEET = '/assets/plate_spritesheet.png';
const RUNESTONE_SHEET = '/assets/runestones.png';
const PORTAL_SHEET = '/assets/portal_spritesheet.png';
const PORTAL_FRAME_SIZE = 48;
const BRIDGE_SAMPLE_CELL_X = 5;
const BRIDGE_SAMPLE_NORTH_CELL_Y = 11;
const SWAMP_SAMPLE_WEST_CELL_X = 2;
const SWAMP_SAMPLE_CELL_Y = 5;
const SWAMP_SAMPLE_LENGTH_CELLS = 2;
const CHEST_SAMPLE_CELL_X = 2;
const CHEST_SAMPLE_CELL_Y = 9;
const T_INTERSECTION_SAMPLE_CELL_X = 4;
const T_INTERSECTION_SAMPLE_CELL_Y = 6;
const PORTAL_SAMPLE_CELL_X = 8;
const PORTAL_SAMPLE_CELL_Y = 14;
const PORTAL_TERRAIN_Z = 1;
const PORTAL_GROUND_DETAIL_Z = 3;
const PORTAL_PLATFORM_STRUCTURE_Z = 240000;
const PORTAL_Z = 240002;
const HUB_TREE = `${FOREST_ROOT}/tree_primary_02.png`;
const HUB_TREE_SHADOW = `${FOREST_ROOT}/tree_shadow.png`;
const GRASS_IDS = [102, 105, 108, 154] as const;
const BRIDGE_NATIVE_SIZE_BY_ASSET: Partial<
  Record<BridgeObstacleAsset, readonly [number, number]>
> = {
  f1437: [32, 26],
  f1443: [32, 26],
  f1446: [32, 26],
  f1447: [32, 25],
  f1537: [18, 15],
  f1542: [18, 15],
  f1591: [32, 13],
  watergrass3: [31, 32],
  watergrass6: [25, 23],
};
const SWAMP_NATIVE_SIZE_BY_ASSET: Partial<
  Record<SwampObstacleAsset, readonly [number, number]>
> = {
  r48: [27, 32],
  r49: [30, 32],
  r98: [29, 24],
  r99: [30, 28],
  r100: [25, 17],
  watergrass0: [26, 32],
  watergrass3: [31, 32],
  watergrass6: [25, 23],
};
let sequence = 0;

const DIRECTIONS = [
  { key: 'N', dx: 0, dy: -1, name: 'north' },
  { key: 'E', dx: 1, dy: 0, name: 'east' },
  { key: 'S', dx: 0, dy: 1, name: 'south' },
  { key: 'W', dx: -1, dy: 0, name: 'west' },
] as const;

function id(prefix: string): string {
  sequence += 1;
  return `${prefix}-${sequence}`;
}

function fiorwoodsAsset(assetId: number): string {
  return `${FIORWOODS_ROOT}/Sprite_Fiorwoods_${assetId}.png`;
}

function bridgeAssetName(asset: BridgeObstacleAsset): string {
  if (asset.startsWith('f')) return `Sprite_Fiorwoods_${asset.slice(1)}`;
  if (asset.startsWith('a')) return `Sprite_Ancient Ruins_${asset.slice(1)}`;
  if (asset === 'buried') return 'burriedTreasureCircle';
  return asset === 'watergrass3' ? 'watergrass_3' : 'watergrass_6';
}

function bridgeAssetRole(asset: BridgeObstacleAsset, zIndex: number): SemanticRole {
  if (zIndex < 500) return 'ground.grass';
  return asset === 'watergrass3' || asset === 'watergrass6' ? 'bush' : 'decoration';
}

function bridgeNativeSize(asset: BridgeObstacleAsset): readonly [number, number] {
  return BRIDGE_NATIVE_SIZE_BY_ASSET[asset] ?? [32, 32];
}

function swampAssetName(asset: SwampObstacleAsset): string {
  if (asset.startsWith('r')) return `Sprite_Rohlan Fields_${asset.slice(1)}`;
  if (asset === 'watergrass0') return 'watergrass_0';
  return asset === 'watergrass3' ? 'watergrass_3' : 'watergrass_6';
}

function swampAssetRole(zIndex: number): SemanticRole {
  return zIndex >= 500 ? 'bush' : 'ground.grass';
}

function swampNativeSize(asset: SwampObstacleAsset): readonly [number, number] {
  return SWAMP_NATIVE_SIZE_BY_ASSET[asset] ?? [32, 32];
}

function bridgeHidesSampleForestPlacement(placement: ForestStylePlacementSpec): boolean {
  const tileX = WALL_WIDTH + BRIDGE_SAMPLE_CELL_X * CELL_STEP_X;
  const northCellTileY = WALL_HEIGHT + BRIDGE_SAMPLE_NORTH_CELL_Y * CELL_STEP_Y;
  const anchorX = tileX * TILE;
  const anchorY = (northCellTileY + CELL_SIZE) * TILE;
  return BRIDGE_OBSTACLE_HIDDEN_FOREST_SPRITES.some((hidden) =>
    placement.assetId === hidden.assetId &&
    placement.x === anchorX + hidden.x &&
    placement.y === anchorY + hidden.y &&
    placement.width === hidden.w &&
    placement.height === hidden.h &&
    placement.zIndex === hidden.z &&
    placement.direction === hidden.direction &&
    placement.flipX === hidden.flipX &&
    placement.flipY === hidden.flipY);
}

function assetElement(
  name: string,
  role: SemanticRole,
  assetPath: string,
  nativeWidth: number,
  nativeHeight: number,
  x: number,
  y: number,
  width: number,
  height: number,
  zIndex: number,
  flipX = false,
  flipY = false,
  sourceRect?: EditorElement['sourceRect'],
): EditorElement {
  return {
    id: id('element'),
    name,
    role,
    assetPath,
    sourceRect,
    nativeWidth,
    nativeHeight,
    x,
    y,
    width,
    height,
    zIndex,
    opacity: 1,
    flipX,
    flipY,
    visible: true,
  };
}

function element(
  name: string,
  role: SemanticRole,
  assetId: number,
  x: number,
  y: number,
  width: number,
  height: number,
  zIndex: number,
  flipX = false,
  flipY = false,
): EditorElement {
  return assetElement(
    name,
    role,
    fiorwoodsAsset(assetId),
    32,
    32,
    x,
    y,
    width,
    height,
    zIndex,
    flipX,
    flipY,
  );
}

function collider(
  name: string,
  x: number,
  y: number,
  width: number,
  height: number,
  ownerRole: EditorCollider['ownerRole'] = 'wall.solid',
  ownerId: string | null = null,
  shape: EditorCollider['shape'] = 'rectangle',
  flipX = false,
  flipY = false,
): EditorCollider {
  return {
    id: id('collider'),
    name,
    ownerId,
    ownerRole,
    x,
    y,
    width,
    height,
    shape,
    flipX,
    flipY,
    enabled: true,
  };
}

function isDirtAt(layout: GeneratedMazeLayout, x: number, y: number): boolean {
  return x >= 0 && x < layout.map.width && y >= 0 && y < layout.map.height &&
    layout.dirtMask[y * layout.map.width + x] === 1;
}

function gateApproachAsset(layout: GeneratedMazeLayout, x: number, y: number): string {
  const north = isDirtAt(layout, x, y - 1);
  const east = isDirtAt(layout, x + 1, y);
  const south = isDirtAt(layout, x, y + 1);
  const west = isDirtAt(layout, x - 1, y);

  if (!north && !east) return `${FOREST_ROOT}/path_ne.png`;
  if (!east && !south) return `${FOREST_ROOT}/path_se.png`;
  if (!south && !west) return `${FOREST_ROOT}/path_sw.png`;
  if (!north && !west) return `${FOREST_ROOT}/path_nw.png`;
  if (!north) return `${FOREST_ROOT}/path_n.png`;
  if (!east) return `${FOREST_ROOT}/path_e.png`;
  if (!south) return `${FOREST_ROOT}/path_s.png`;
  if (!west) return `${FOREST_ROOT}/path_w.png`;
  const hash = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) >>> 0;
  return `${FOREST_ROOT}/${(hash & 1) === 0 ? 'path_center.png' : 'path_plain_alt.png'}`;
}

function grassAssetId(x: number, y: number): number {
  const hash = ((x * 374761393 + y * 668265263) >>> 0) % 100;
  if (hash < 47) return GRASS_IDS[0];
  if (hash < 94) return GRASS_IDS[1];
  if (hash < 97) return GRASS_IDS[2];
  return GRASS_IDS[3];
}

function areCellsConnected(
  map: TileMapData,
  cellX: number,
  cellY: number,
  nextCellX: number,
  nextCellY: number,
): boolean {
  const tileX = WALL_WIDTH + cellX * CELL_STEP_X;
  const tileY = WALL_HEIGHT + cellY * CELL_STEP_Y;

  if (cellY === nextCellY) {
    const nextTileX = WALL_WIDTH + nextCellX * CELL_STEP_X;
    const wallX = Math.min(tileX, nextTileX) + CELL_SIZE;
    for (let y = tileY; y < tileY + CELL_SIZE; y++) {
      for (let x = wallX; x < wallX + WALL_WIDTH; x++) {
        if (!isSolidTileId(map.data[y * map.width + x])) return true;
      }
    }
    return false;
  }

  const nextTileY = WALL_HEIGHT + nextCellY * CELL_STEP_Y;
  const wallY = Math.min(tileY, nextTileY) + CELL_SIZE;
  for (let y = wallY; y < wallY + WALL_HEIGHT; y++) {
    for (let x = tileX; x < tileX + CELL_SIZE; x++) {
      if (!isSolidTileId(map.data[y * map.width + x])) return true;
    }
  }
  return false;
}

function connectionsForCell(map: TileMapData, cellX: number, cellY: number): string {
  let connections = '';
  for (const direction of DIRECTIONS) {
    const nextCellX = cellX + direction.dx;
    const nextCellY = cellY + direction.dy;
    if (nextCellX < 0 || nextCellX >= GRID_CELLS || nextCellY < 0 || nextCellY >= GRID_CELLS) continue;
    if (areCellsConnected(map, cellX, cellY, nextCellX, nextCellY)) connections += direction.key;
  }
  return connections;
}

function topologyLabel(connections: string): string {
  if (connections.length === 0) return 'isolated cell';
  if (connections.length === 1) {
    const direction = DIRECTIONS.find((candidate) => candidate.key === connections)?.name ?? connections;
    return `dead end open ${direction}`;
  }
  if (connections === 'NS') return 'north-south straight';
  if (connections === 'EW') return 'east-west straight';
  if (connections.length === 2) {
    const names = [...connections].map((key) =>
      DIRECTIONS.find((candidate) => candidate.key === key)?.name ?? key);
    return `${names.join('-')} turn`;
  }
  if (connections.length === 3) {
    const closedDirection = DIRECTIONS.find((direction) => !connections.includes(direction.key));
    return `T-junction closed ${closedDirection?.name ?? 'unknown'}`;
  }
  return 'four-way cross';
}

function placementRole(placement: ForestStylePlacementSpec): SemanticRole {
  if (placement.name.startsWith('Inner north-west corner ground')) return 'ground.grass';
  if (placement.name.startsWith('South-west corner ground')) return 'ground.grass';
  if (placement.name.startsWith('South-west corner wall')) return 'wall.south.face';
  if (placement.name.startsWith('South-west corner vertical')) return 'wall.vertical.face';
  if (placement.name.startsWith('South-east corner ground')) return 'ground.grass';
  if (placement.name.startsWith('South-east corner wall')) return 'wall.south.face';
  if (placement.name.startsWith('South face')) return 'wall.south.face';
  if (placement.name.startsWith('West wall') ||
      placement.name.startsWith('East wall') ||
      placement.name.startsWith('Hub north-west corner west') ||
      placement.name.startsWith('Hub north-east corner east')) {
    return 'wall.vertical.face';
  }
  if (placement.name.startsWith('North wall')) return 'wall.north.face';
  return 'wall.canopy';
}

function placementCellReference(map: TileMapData, placement: ForestStylePlacementSpec): string {
  const centerTileX = (placement.x + placement.width / 2) / TILE;
  const centerTileY = (placement.y + placement.height / 2) / TILE;
  const cellX = Math.max(0, Math.min(GRID_CELLS - 1, Math.floor((centerTileX - WALL_WIDTH) / CELL_STEP_X)));
  const cellY = Math.max(0, Math.min(GRID_CELLS - 1, Math.floor((centerTileY - WALL_HEIGHT) / CELL_STEP_Y)));
  const connections = connectionsForCell(map, cellX, cellY);
  return `cell ${cellX},${cellY} ${connections || '-'} (${topologyLabel(connections)})`;
}

function addGroundElements(layout: GeneratedMazeLayout, elements: EditorElement[]): void {
  const map = layout.map;
  const hub = getHubTileBounds(map.width, map.height);
  for (let sampleY = 0; sampleY < SAMPLE_TILES_HIGH; sampleY++) {
    const mapY = CROP_TILE_Y + sampleY;
    for (let sampleX = 0; sampleX < SAMPLE_TILES_WIDE; sampleX++) {
      const mapX = CROP_TILE_X + sampleX;
      const tileId = map.data[mapY * map.width + mapX];
      const forest = isForestWallTileId(tileId);
      const gateApproach = layout.dirtMask[mapY * map.width + mapX] === 1;
      const centralHub = mapX >= hub.left && mapX <= hub.right && mapY >= hub.top && mapY <= hub.bottom;
      if (gateApproach) {
        elements.push(assetElement(
          `Gate obstacle approach path · sample tile ${sampleX},${sampleY} · map tile ${mapX},${mapY}`,
          'ground.path',
          gateApproachAsset(layout, mapX, mapY),
          TILE,
          TILE,
          sampleX * TILE,
          sampleY * TILE,
          TILE,
          TILE,
          0,
        ));
        continue;
      }
      const assetId = forest ? getForestGroundAssetId(mapX, mapY, map) : grassAssetId(mapX, mapY);
      const underlayAssetId = forest ? getForestGroundUnderlayAssetId(mapX, mapY, map) : null;
      if (underlayAssetId !== null) {
        elements.push(element(
          `South-west corner grass base underlay · sample tile ${sampleX},${sampleY} · map tile ${mapX},${mapY}`,
          'ground.grass',
          underlayAssetId,
          sampleX * TILE,
          sampleY * TILE,
          TILE,
          TILE,
          -1,
        ));
      }
      elements.push(element(
        `${centralHub ? 'Central hub · ' : ''}${forest ? 'Forest underlay' : 'Grass'} · sample tile ${sampleX},${sampleY} · map tile ${mapX},${mapY}`,
        forest ? 'ground.forest' : 'ground.grass',
        assetId,
        sampleX * TILE,
        sampleY * TILE,
        TILE,
        TILE,
        forest ? getForestGroundZIndex(mapX, mapY, map) : 0,
      ));
    }
  }
}

function addBridgeObstacleElements(
  elements: EditorElement[],
  colliders: EditorCollider[],
): void {
  const tileX = WALL_WIDTH + BRIDGE_SAMPLE_CELL_X * CELL_STEP_X;
  const northCellTileY = WALL_HEIGHT + BRIDGE_SAMPLE_NORTH_CELL_Y * CELL_STEP_Y;
  const bridge: BridgePlacement = {
    cellX: BRIDGE_SAMPLE_CELL_X,
    northCellY: BRIDGE_SAMPLE_NORTH_CELL_Y,
    tileX,
    tileY: northCellTileY + CELL_SIZE,
    safeTileMask: 0x0fff,
  };
  const localX = (bridge.tileX - CROP_TILE_X) * TILE;
  const localY = (bridge.tileY - CROP_TILE_Y) * TILE;

  // These are repaints of the atlas's existing ground elements, not added
  // overlays. Keeping their element IDs preserves the editor export's z=0
  // ordering after the two authored UUID-style background sprites.
  for (const spec of BRIDGE_OBSTACLE_TERRAIN_SPRITES) {
    const x = localX + spec.x;
    const y = localY + spec.y;
    const terrain = elements.find((candidate) =>
      candidate.x === x && candidate.y === y &&
      candidate.width === spec.w && candidate.height === spec.h &&
      candidate.zIndex === spec.z && candidate.role.startsWith('ground.'));
    if (!terrain) {
      throw new Error(`Bridge obstacle terrain is missing at sample pixel ${x},${y}`);
    }

    terrain.name = spec.x < 0 || spec.x >= CELL_SIZE * TILE
      ? bridgeAssetName(spec.asset)
      : `Bridge obstacle · terrain · ${bridgeAssetName(spec.asset)}`;
    terrain.assetPath = getBridgeObstacleAssetPath(spec.asset);
    [terrain.nativeWidth, terrain.nativeHeight] = bridgeNativeSize(spec.asset);
  }

  for (const [index, spec] of BRIDGE_OBSTACLE_SPRITES.entries()) {
    const [nativeWidth, nativeHeight] = bridgeNativeSize(spec.asset);
    const bridgeElement = assetElement(
      `Bridge obstacle · ${bridgeAssetName(spec.asset)}`,
      bridgeAssetRole(spec.asset, spec.z),
      getBridgeObstacleAssetPath(spec.asset),
      nativeWidth,
      nativeHeight,
      localX + spec.x,
      localY + spec.y,
      spec.w,
      spec.h,
      spec.z,
    );
    // The source export's added elements sort before the atlas's element-* IDs
    // at equal z, which is significant for the two z=0 background sprites.
    bridgeElement.id = `bridge-added-${String(index + 1).padStart(2, '0')}`;
    elements.push(bridgeElement);
  }

  const colliderNames = [
    'west water bank',
    'east water bank',
    'north-west bank slope',
    'north-east bank slope',
    'south-west bank slope',
    'south-east bank slope',
  ] as const;
  for (const [index, bounds] of getBridgeBounds(bridge, TILE).entries()) {
    colliders.push(collider(
      `Bridge obstacle · ${colliderNames[index]}`,
      bounds.left - CROP_TILE_X * TILE,
      bounds.top - CROP_TILE_Y * TILE,
      bounds.right - bounds.left + 1,
      bounds.bottom - bounds.top + 1,
      'freeform',
      null,
      bounds.shape,
      bounds.flipX,
      bounds.flipY,
    ));
  }
}

function addSwampObstacleElements(elements: EditorElement[]): void {
  const swamp: SwampPlacement = {
    westCellX: SWAMP_SAMPLE_WEST_CELL_X,
    cellY: SWAMP_SAMPLE_CELL_Y,
    lengthCells: SWAMP_SAMPLE_LENGTH_CELLS,
    decorationSeed: 0,
    tileX: WALL_WIDTH + SWAMP_SAMPLE_WEST_CELL_X * CELL_STEP_X + CELL_SIZE,
    tileY: WALL_HEIGHT + SWAMP_SAMPLE_CELL_Y * CELL_STEP_Y,
  };
  const localX = (swamp.tileX - CROP_TILE_X) * TILE;
  const localY = (swamp.tileY - CROP_TILE_Y) * TILE;

  // The authored swamp replaces the existing z=0 ground tiles so reset keeps
  // stable atlas element IDs and the same ordering as the supplied export.
  for (const spec of getSwampObstacleTerrainSprites(swamp)) {
    const x = localX + spec.x;
    const y = localY + spec.y;
    const terrain = elements.find((candidate) =>
      candidate.x === x && candidate.y === y &&
      candidate.width === spec.w && candidate.height === spec.h &&
      candidate.zIndex === spec.z && candidate.role.startsWith('ground.'));
    if (!terrain) {
      throw new Error(`Swamp obstacle terrain is missing at sample pixel ${x},${y}`);
    }

    terrain.name = swampAssetName(spec.asset);
    terrain.role = swampAssetRole(spec.z);
    terrain.assetPath = getSwampObstacleAssetPath(spec.asset);
    [terrain.nativeWidth, terrain.nativeHeight] = swampNativeSize(spec.asset);
  }

  for (const spec of SWAMP_OBSTACLE_AUTHORED_DETAIL_SPRITES) {
    const [nativeWidth, nativeHeight] = swampNativeSize(spec.asset);
    elements.push(assetElement(
      swampAssetName(spec.asset),
      swampAssetRole(spec.z),
      getSwampObstacleAssetPath(spec.asset),
      nativeWidth,
      nativeHeight,
      localX + spec.x,
      localY + spec.y,
      spec.w,
      spec.h,
      spec.z,
    ));
  }
}

function addChestDeadEndElements(
  layout: GeneratedMazeLayout,
  elements: EditorElement[],
  colliders: EditorCollider[],
): void {
  const chestPlacements = layout.chestDeadEnds.filter(
    (candidate) =>
      candidate.cellX === CHEST_SAMPLE_CELL_X &&
      candidate.cellY === CHEST_SAMPLE_CELL_Y,
  );
  const placement = chestPlacements[0];
  if (!placement) {
    throw new Error('Seed-44 chest dead-end fixture is missing at cell 2,9');
  }

  const localX = (placement.tileX - CROP_TILE_X) * TILE;
  const localY = (placement.tileY - CROP_TILE_Y) * TILE;
  for (const spec of getChestDeadEndScenerySprites(placement.variant)) {
    if (spec.layer === 'terrain') {
      const x = localX + spec.x;
      const y = localY + spec.y;
      const terrain = elements.find((candidate) =>
        candidate.x === x && candidate.y === y &&
        candidate.width === spec.w && candidate.height === spec.h &&
        candidate.zIndex === spec.z && candidate.role.startsWith('ground.'));
      if (!terrain) {
        throw new Error(`Chest dead-end terrain is missing at sample pixel ${x},${y}`);
      }

      terrain.name = spec.name;
      terrain.role = 'ground.grass';
      terrain.assetPath = getChestDeadEndAssetPath(spec.asset);
      terrain.nativeWidth = spec.nativeWidth;
      terrain.nativeHeight = spec.nativeHeight;
      continue;
    }

    elements.push(assetElement(
      spec.name,
      spec.asset === 'goldflowers9' ? 'bush' : 'ground.grass',
      getChestDeadEndAssetPath(spec.asset),
      spec.nativeWidth,
      spec.nativeHeight,
      localX + spec.x,
      localY + spec.y,
      spec.w,
      spec.h,
      spec.z,
    ));
  }

  for (const chestPlacement of chestPlacements) {
    const chestSprites = getChestDeadEndChestSpritePair(
      chestPlacement.variant,
      chestPlacement.chestCount,
      chestPlacement.chestSlot,
    );
    for (const chest of [chestSprites.closed, chestSprites.open]) {
      elements.push(assetElement(
        chest.name,
        'decoration',
        getChestDeadEndAssetPath(chest.asset),
        chest.nativeWidth,
        chest.nativeHeight,
        localX + chest.x,
        localY + chest.y,
        chest.w,
        chest.h,
        chest.z,
      ));
    }
  }

  const cropPixelX = CROP_TILE_X * TILE;
  const cropPixelY = CROP_TILE_Y * TILE;
  for (const chestPlacement of chestPlacements) {
    for (const bounds of getChestDeadEndBounds(chestPlacement, TILE)) {
      colliders.push(collider(
        `Chest dead end · ${bounds.kind}`,
        bounds.left - cropPixelX,
        bounds.top - cropPixelY,
        bounds.right - bounds.left + 1,
        bounds.bottom - bounds.top + 1,
        'freeform',
      ));
    }
  }
}

function addTIntersectionDecorationElements(
  elements: EditorElement[],
  colliders: EditorCollider[],
): void {
  const cropPixelX = CROP_TILE_X * TILE;
  const cropPixelY = CROP_TILE_Y * TILE;
  // Keep the full authored prefab pinned in the editor reference even when the
  // generated seed correctly omits it because one of its four cells is occupied.
  const placement = {
    cellX: T_INTERSECTION_SAMPLE_CELL_X,
    cellY: T_INTERSECTION_SAMPLE_CELL_Y,
    tileX: WALL_WIDTH + T_INTERSECTION_SAMPLE_CELL_X * CELL_STEP_X,
    tileY: WALL_HEIGHT + T_INTERSECTION_SAMPLE_CELL_Y * CELL_STEP_Y,
  };
  const anchorX = placement.tileX * TILE - cropPixelX;
  const anchorY = placement.tileY * TILE - cropPixelY;

  for (const spec of T_INTERSECTION_DECORATION_SPRITES) {
    elements.push(
      assetElement(
        spec.name,
        spec.role,
        getTIntersectionDecorationAssetPath(spec.asset),
        spec.nativeWidth,
        spec.nativeHeight,
        anchorX + spec.x,
        anchorY + spec.y,
        spec.w,
        spec.h,
        spec.z,
      ),
    );
  }

  for (const bounds of getTIntersectionDecorationBounds(placement, TILE)) {
    colliders.push(
      collider(
        `T-intersection decoration · ${bounds.kind}`,
        bounds.left - cropPixelX,
        bounds.top - cropPixelY,
        bounds.right - bounds.left + 1,
        bounds.bottom - bounds.top + 1,
        'freeform',
      ),
    );
  }
}

function gateIsInSample(gate: GatePlacement): boolean {
  return gate.orientation === 'horizontal' &&
    gate.tileX + CELL_SIZE > CROP_TILE_X && gate.tileX < CROP_TILE_X + SAMPLE_TILES_WIDE &&
    gate.tileY >= CROP_TILE_Y && gate.tileY < CROP_TILE_Y + SAMPLE_TILES_HIGH;
}

function addGateObstacleElements(
  layout: GeneratedMazeLayout,
  elements: EditorElement[],
  colliders: EditorCollider[],
): void {
  const gateSourceRows = [0, 1, 1, 2] as const;

  for (let gateIndex = 0; gateIndex < layout.gates.length; gateIndex++) {
    const gate = layout.gates[gateIndex];
    if (!gateIsInSample(gate)) continue;

    const localGateX = (gate.tileX - CROP_TILE_X) * TILE;
    const localGateY = (gate.tileY - 3 - CROP_TILE_Y) * TILE;
    const zIndex = 1000 + (gate.tileY + 1) * 1000 + 500;
    for (let row = 0; row < 4; row++) {
      for (let column = 0; column < CELL_SIZE; column++) {
        const sourceColumn = column === 0 ? 0 : column === CELL_SIZE - 1 ? 2 : 1;
        const section = row === 0 ? 'top' : row === 3 ? 'bottom' : `middle row ${row}`;
        elements.push(assetElement(
          `Gate obstacle · gate ${gateIndex} team ${gate.teamIndex + 1} · ${section} tile ${column + 1} of ${CELL_SIZE}`,
          'gate',
          GATE_SHEET,
          TILE,
          TILE,
          localGateX + column * TILE,
          localGateY + row * TILE,
          TILE,
          TILE,
          zIndex,
          false,
          false,
          { x: sourceColumn * TILE, y: gateSourceRows[row] * TILE, width: TILE, height: TILE },
        ));
      }
    }

    colliders.push(collider(
      `Gate obstacle · gate ${gateIndex} closed barrier`,
      localGateX,
      (gate.tileY - CROP_TILE_Y) * TILE,
      CELL_SIZE * TILE,
      TILE,
      'gate',
    ));
  }

  for (const plate of layout.pressurePlates) {
    const gate = layout.gates[plate.gateIndex];
    if (!gate || !gateIsInSample(gate)) continue;
    if (plate.tileX < CROP_TILE_X || plate.tileX >= CROP_TILE_X + SAMPLE_TILES_WIDE ||
        plate.tileY < CROP_TILE_Y || plate.tileY >= CROP_TILE_Y + SAMPLE_TILES_HIGH) continue;

    const hubSide = plate.side === 'hub';
    const matchingSide = layout.pressurePlates.filter((candidate) =>
      candidate.gateIndex === plate.gateIndex && candidate.side === plate.side);
    const sideIndex = matchingSide.findIndex((candidate) => candidate.id === plate.id);
    const width = hubSide ? 24 : TILE;
    elements.push(assetElement(
      `Gate obstacle · gate ${plate.gateIndex} · ${plate.side}-side button ${sideIndex + 1}`,
      'pressure-plate',
      PLATE_SHEET,
      width,
      TILE,
      (plate.tileX - CROP_TILE_X) * TILE - (hubSide ? 4 : 0),
      (plate.tileY - CROP_TILE_Y) * TILE,
      width,
      TILE,
      1000 + plate.tileY * 1000 + 200,
      false,
      false,
      { x: 0, y: hubSide ? TILE : 0, width, height: TILE },
    ));
  }
}

function addCentralHubElements(
  map: TileMapData,
  elements: EditorElement[],
  colliders: EditorCollider[],
): void {
  for (let mapY = CROP_TILE_Y; mapY < CROP_TILE_Y + SAMPLE_TILES_HIGH; mapY++) {
    for (let mapX = CROP_TILE_X; mapX < CROP_TILE_X + SAMPLE_TILES_WIDE; mapX++) {
      const tileId = map.data[mapY * map.width + mapX];
      const localTileX = (mapX - CROP_TILE_X) * TILE;
      const localTileY = (mapY - CROP_TILE_Y) * TILE;

      if (tileId === TILE_TREE) {
        elements.push(assetElement(
          `Central hub · tree contact shadow · map tile ${mapX},${mapY}`,
          'shadow',
          HUB_TREE_SHADOW,
          50,
          50,
          localTileX + TILE / 2 - 27,
          localTileY + TILE - 4 - 12,
          54,
          24,
          100,
        ));
        const tree = assetElement(
          `Central hub · sacred tree · map tile ${mapX},${mapY}`,
          'tree.large',
          HUB_TREE,
          164,
          214,
          localTileX + TILE / 2 - 43,
          localTileY + TILE - 112,
          86,
          112,
          1000 + (mapY + 1) * 1000 + 800,
        );
        elements.push(tree);
        colliders.push(collider(
          `Central hub · sacred tree solid tile ${mapX},${mapY}`,
          localTileX,
          localTileY,
          TILE,
          TILE,
          'tree.large',
          tree.id,
        ));
        continue;
      }

      if (tileId !== TILE_RUNESTONE_1 && tileId !== TILE_RUNESTONE_2 && tileId !== TILE_RUNESTONE_3) continue;
      const runestoneIndex = tileId - TILE_RUNESTONE_1;
      const runestone = assetElement(
        `Central hub · runestone ${runestoneIndex + 1} · map tile ${mapX},${mapY}`,
        'runestone',
        RUNESTONE_SHEET,
        TILE,
        TILE * 2,
        localTileX,
        localTileY - TILE,
        TILE,
        TILE * 2,
        1000 + (mapY + 1) * 1000 + 700,
        false,
        false,
        { x: runestoneIndex * TILE * 2, y: 0, width: TILE, height: TILE * 2 },
      );
      elements.push(runestone);
      colliders.push(collider(
        `Central hub · runestone ${runestoneIndex + 1} solid tile ${mapX},${mapY}`,
        localTileX,
        localTileY,
        TILE,
        TILE,
        'runestone',
        runestone.id,
      ));
    }
  }
}

function addPortalCellElements(
  elements: EditorElement[],
  colliders: EditorCollider[],
): void {
  // Seed 44 cells (8,13) and (8,14) both have intact north walls, so this
  // showcase obeys the same vertical wall-pair rule as runtime generation.
  const lowerCellTileX = WALL_WIDTH + PORTAL_SAMPLE_CELL_X * CELL_STEP_X;
  const lowerCellTileY = WALL_HEIGHT + PORTAL_SAMPLE_CELL_Y * CELL_STEP_Y;
  const centerMapX = (lowerCellTileX + CELL_SIZE / 2) * TILE;
  const centerMapY = lowerCellTileY * TILE - 12;
  const centerX = centerMapX - CROP_TILE_X * TILE;
  const centerY = centerMapY - CROP_TILE_Y * TILE;

  for (const spec of PORTAL_PLATFORM_GROUND_SPRITES) {
    elements.push(assetElement(
      `Portal cell · clearing ground · ${spec.asset}`,
      'ground.path',
      getPortalPlatformAssetPath(spec.asset),
      spec.w,
      spec.h,
      centerX + spec.x,
      centerY + spec.y,
      spec.w,
      spec.h,
      PORTAL_TERRAIN_Z,
    ));
  }

  for (const spec of PORTAL_PLATFORM_GROUND_DETAIL_SPRITES) {
    elements.push(assetElement(
      `Portal cell · clearing ground detail · ${spec.asset}`,
      'ground.grass',
      getPortalPlatformAssetPath(spec.asset),
      spec.w,
      spec.h,
      centerX + spec.x,
      centerY + spec.y,
      spec.w,
      spec.h,
      PORTAL_GROUND_DETAIL_Z,
    ));
  }

  for (const spec of PORTAL_PLATFORM_STRUCTURE_SPRITES) {
    elements.push(assetElement(
      `Portal cell · raised platform · ${spec.asset}`,
      'landmark',
      getPortalPlatformAssetPath(spec.asset),
      spec.w,
      spec.h,
      centerX + spec.x,
      centerY + spec.y,
      spec.w,
      spec.h,
      PORTAL_PLATFORM_STRUCTURE_Z + (spec.z ?? 0),
    ));
  }

  const portal = assetElement(
    `Portal cell · inactive escape portal · lower cell ${PORTAL_SAMPLE_CELL_X},${PORTAL_SAMPLE_CELL_Y}`,
    'portal',
    PORTAL_SHEET,
    PORTAL_FRAME_SIZE,
    PORTAL_FRAME_SIZE,
    centerX - PORTAL_FRAME_SIZE / 2 + PORTAL_VISUAL_OFFSET_X,
    centerY - PORTAL_FRAME_SIZE / 2,
    PORTAL_FRAME_SIZE,
    PORTAL_FRAME_SIZE,
    PORTAL_Z,
    false,
    false,
    { x: 0, y: 0, width: PORTAL_FRAME_SIZE, height: PORTAL_FRAME_SIZE },
  );
  elements.push(portal);

  const wallOpening = getPortalWallOpeningBounds({ x: centerX, y: centerY });
  splitWallColliderAroundOpening(colliders, wallOpening);
  const portalBounds = getPortalBounds({ x: centerX, y: centerY });
  colliders.push(collider(
    `Portal cell · escape portal collider · lower cell ${PORTAL_SAMPLE_CELL_X},${PORTAL_SAMPLE_CELL_Y}`,
    portalBounds.left,
    portalBounds.top,
    portalBounds.right - portalBounds.left + 1,
    portalBounds.bottom - portalBounds.top + 1,
    'portal',
    portal.id,
  ));

  const platformColliderNames = [
    'left upper edge',
    'left inner slope',
    'left stair base',
    'right upper edge',
    'right inner slope',
    'right stair base',
  ] as const;
  for (const [index, bounds] of getPortalPlatformBounds({ x: centerX, y: centerY }).entries()) {
    colliders.push(collider(
      `Portal cell · ${platformColliderNames[index]} · stairs remain open`,
      bounds.left,
      bounds.top,
      bounds.right - bounds.left + 1,
      bounds.bottom - bounds.top + 1,
      'portal',
      portal.id,
      bounds.shape,
      bounds.flipX,
      bounds.flipY,
    ));
  }
}

function splitWallColliderAroundOpening(
  colliders: EditorCollider[],
  opening: PortalBounds,
): void {
  for (const existing of colliders) {
    const right = existing.x + existing.width;
    const bottom = existing.y + existing.height;
    const openingRight = opening.right + 1;
    const openingBottom = opening.bottom + 1;
    const coversOpening = existing.ownerRole === 'wall.solid' &&
      existing.shape === 'rectangle' &&
      existing.x < opening.left && right > openingRight &&
      existing.y >= opening.top && bottom <= openingBottom;
    if (!coversOpening) continue;

    existing.width = opening.left - existing.x;
    colliders.push(collider(
      existing.name,
      openingRight,
      existing.y,
      right - openingRight,
      existing.height,
      existing.ownerRole,
      existing.ownerId,
    ));
    return;
  }
}

function addWallElements(map: TileMapData, elements: EditorElement[]): void {
  const cropLeft = CROP_TILE_X * TILE;
  const cropTop = CROP_TILE_Y * TILE;
  const cropRight = cropLeft + SAMPLE_WIDTH;
  const cropBottom = cropTop + SAMPLE_HEIGHT;
  const rows = buildForestStylePlacementRows(map);

  for (const [renderRow, placements] of rows) {
    for (const placement of placements) {
      if (placement.x + placement.width <= cropLeft || placement.x >= cropRight ||
          placement.y + placement.height <= cropTop || placement.y >= cropBottom) continue;

      const centerTileX = Math.floor((placement.x + placement.width / 2) / TILE);
      const centerTileY = Math.floor((placement.y + placement.height / 2) / TILE);
      const role = placementRole(placement);
      const usesRenderRowLayer = placement.direction === 'ground' || !role.startsWith('ground.');
      const wallElement = element(
        `${placement.name} · ${placementCellReference(map, placement)} · map tile ${centerTileX},${centerTileY}`,
        role,
        placement.assetId,
        placement.x - cropLeft,
        placement.y - cropTop,
        placement.width,
        placement.height,
        usesRenderRowLayer ? 1000 + renderRow * 1000 + placement.zIndex : placement.zIndex,
        placement.flipX,
        placement.flipY,
      );
      if (!bridgeHidesSampleForestPlacement(placement)) elements.push(wallElement);
    }
  }
}

function addWallColliders(map: TileMapData, colliders: EditorCollider[]): void {
  for (let sampleY = 0; sampleY < SAMPLE_TILES_HIGH; sampleY++) {
    const mapY = CROP_TILE_Y + sampleY;
    let sampleX = 0;
    while (sampleX < SAMPLE_TILES_WIDE) {
      const mapX = CROP_TILE_X + sampleX;
      if (!isForestWallTileId(map.data[mapY * map.width + mapX])) {
        sampleX++;
        continue;
      }

      const runStart = sampleX;
      while (sampleX < SAMPLE_TILES_WIDE) {
        const runMapX = CROP_TILE_X + sampleX;
        if (!isForestWallTileId(map.data[mapY * map.width + runMapX])) break;
        sampleX++;
      }
      colliders.push(collider(
        `Solid forest · sample row ${sampleY} · map row ${mapY} · columns ${runStart}-${sampleX - 1}`,
        runStart * TILE,
        sampleY * TILE,
        (sampleX - runStart) * TILE,
        TILE,
      ));
    }
  }
}

export function createSampleDocument(): StyleEditorDocumentV1 {
  sequence = 0;
  const layout = generateMazeLayout(MAZE_SEED, SPAWN_DISTANCE);
  const map = layout.map;
  const elements: EditorElement[] = [];
  const colliders: EditorCollider[] = [];
  const topology: NonNullable<StyleEditorDocumentV1['reference']>['topology'] = [];

  for (let sampleRow = 0; sampleRow < CROP_CELLS_HIGH; sampleRow++) {
    for (let sampleColumn = 0; sampleColumn < CROP_CELLS_WIDE; sampleColumn++) {
      const cellX = CROP_CELL_X + sampleColumn;
      const cellY = CROP_CELL_Y + sampleRow;
      const connections = connectionsForCell(map, cellX, cellY);
      topology.push({
        cellX,
        cellY,
        sampleColumn,
        sampleRow,
        connections,
        label: topologyLabel(connections),
      });
    }
  }

  addGroundElements(layout, elements);
  addSwampObstacleElements(elements);
  addBridgeObstacleElements(elements, colliders);
  addWallElements(map, elements);
  addWallColliders(map, colliders);
  addGateObstacleElements(layout, elements, colliders);
  addCentralHubElements(map, elements, colliders);
  addPortalCellElements(elements, colliders);
  addChestDeadEndElements(layout, elements, colliders);
  addTIntersectionDecorationElements(elements, colliders);

  const topologyGrid = Array.from({ length: CROP_CELLS_HIGH }, (_, row) =>
    topology
      .filter((cell) => cell.sampleRow === row)
      .map((cell) => cell.connections.padEnd(4, '-'))
      .join('  '))
    .join('\n');
  const now = new Date().toISOString();

  return {
    version: 1,
    createdAt: now,
    updatedAt: now,
    sample: {
      name: 'Map',
      width: SAMPLE_WIDTH,
      height: SAMPLE_HEIGHT,
      tileSize: TILE,
    },
    notes: [
      'Exact crop of generated maze seed 44: map cells (2,5) through (8,14), using the same wall-placement builder and generated obstacle layout as the game.',
      'Connection letters are N/E/S/W openings. This fixture includes both straights, all four turns, every T-junction orientation, a four-way cross, and every dead-end orientation.',
      'The central hub section includes its editable ground tiles, thick side walls, corrected north-west and north-east corner transitions, sacred tree, tree shadow, and three runestones.',
      'The portal section is anchored between seed-44 cells (8,13) and (8,14), which both have intact north forest walls. It includes the exact editable clearing, raised stone platform, inactive portal frame, split wall opening, portal hitbox, and six authored platform-edge colliders; the central stairway remains walkable.',
      'The bridge obstacle is anchored between seed-44 cells (5,11) and (5,12), with forest banks on both sides and open north/south cells. It includes the exact water repaint, stone walkway, bank decorations, and six authored colliders.',
      'The swamp obstacle spans seed-44 cells (2,5) and (3,5), with its exact authored water, banks, lilies, reeds, and cattails preserved as the editor reference.',
      'The chest cell at seed-44 cell (2,9) is the reusable three-chest south/east dead-end prefab, including its right-side tree and flowers, closed and opened chest states, terrain stamp, rock, and count-specific authored colliders.',
      'The authoring reference pins the expanded north-closed T-junction composition at cell (4,6) across its center, west, east, and south cells, including all seven authored prop colliders from style export (16). Runtime generation omits the whole prefab when a footprint cell has a solid authored occupant; floor-only trap cells may overlap it.',
      'The southern gate obstacle includes its editable 6×4 front-gate tile assembly, dirt approach tiles, two spawn-side buttons, one hub-side button, and closed-gate collider.',
      'South-east forest corners use the authored ground-detail assembly; its lower edge is positioned at the right seam and layers above adjacent corner faces while remaining below game entities.',
      'South-west forest corners use the authored wider root assembly, with its extra left column included in the solid 11-tile vertical wall band while every walkable cell remains 6×6 tiles.',
      'Each wall sprite name records its authored role, source cell topology, and original map tile. Preserve those names when editing so a later export identifies the rendering rule and location unambiguously.',
      '',
      'Topology grid (sample rows top-to-bottom):',
      topologyGrid,
    ].join('\n'),
    reference: {
      kind: 'generated-maze-crop',
      mazeSeed: MAZE_SEED,
      cropCellX: CROP_CELL_X,
      cropCellY: CROP_CELL_Y,
      cropCellsWide: CROP_CELLS_WIDE,
      cropCellsHigh: CROP_CELLS_HIGH,
      cropTileX: CROP_TILE_X,
      cropTileY: CROP_TILE_Y,
      topology,
    },
    elements,
    colliders,
  };
}
