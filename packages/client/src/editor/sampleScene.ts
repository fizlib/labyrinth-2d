import {
  CELL_SIZE,
  CELL_STEP_X,
  CELL_STEP_Y,
  GRID_CELLS,
  WALL_HEIGHT,
  WALL_WIDTH,
  generateMaze,
  isSolidTileId,
  type TileMapData,
} from '@labyrinth/shared';
import {
  buildForestStylePlacementRows,
  getForestGroundAssetId,
  getForestGroundUnderlayAssetId,
  isForestWallTileId,
  type ForestStylePlacementSpec,
} from '../systems/ForestWallLayout';
import type { EditorCollider, EditorElement, SemanticRole, StyleEditorDocumentV1 } from './types';

const TILE = 16;
const MAZE_SEED = 44;
const CROP_CELL_X = 2;
const CROP_CELL_Y = 5;
const CROP_CELLS_WIDE = 7;
const CROP_CELLS_HIGH = 5;
const CROP_TILE_X = CROP_CELL_X * CELL_STEP_X;
const CROP_TILE_Y = CROP_CELL_Y * CELL_STEP_Y;
const SAMPLE_TILES_WIDE = WALL_WIDTH + CROP_CELLS_WIDE * CELL_STEP_X;
const SAMPLE_TILES_HIGH = WALL_HEIGHT + CROP_CELLS_HIGH * CELL_STEP_Y;
const SAMPLE_WIDTH = SAMPLE_TILES_WIDE * TILE;
const SAMPLE_HEIGHT = SAMPLE_TILES_HIGH * TILE;
const FIORWOODS_ROOT = '/assets/chained-echoes-assets-sorted/Assets/Maps/Fiorwoods';
const GRASS_IDS = [102, 105, 108, 154] as const;
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
  return {
    id: id('element'),
    name,
    role,
    assetPath: fiorwoodsAsset(assetId),
    nativeWidth: 32,
    nativeHeight: 32,
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

function collider(name: string, x: number, y: number, width: number, height: number): EditorCollider {
  return {
    id: id('collider'),
    name,
    ownerId: null,
    ownerRole: 'wall.solid',
    x,
    y,
    width,
    height,
    enabled: true,
  };
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

function addGroundElements(map: TileMapData, elements: EditorElement[]): void {
  for (let sampleY = 0; sampleY < SAMPLE_TILES_HIGH; sampleY++) {
    const mapY = CROP_TILE_Y + sampleY;
    for (let sampleX = 0; sampleX < SAMPLE_TILES_WIDE; sampleX++) {
      const mapX = CROP_TILE_X + sampleX;
      const tileId = map.data[mapY * map.width + mapX];
      const forest = isForestWallTileId(tileId);
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
        `${forest ? 'Forest underlay' : 'Grass'} · sample tile ${sampleX},${sampleY} · map tile ${mapX},${mapY}`,
        forest ? 'ground.forest' : 'ground.grass',
        assetId,
        sampleX * TILE,
        sampleY * TILE,
        TILE,
        TILE,
        0,
      ));
    }
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
      elements.push(element(
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
      ));
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
  const map = generateMaze(MAZE_SEED);
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

  addGroundElements(map, elements);
  addWallElements(map, elements);
  addWallColliders(map, colliders);

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
      name: 'Generated Fiorwoods Topology Atlas · seed 44 · cells 2,5–8,9',
      width: SAMPLE_WIDTH,
      height: SAMPLE_HEIGHT,
      tileSize: TILE,
    },
    notes: [
      'Exact crop of generated maze seed 44: map cells (2,5) through (8,9), using the same wall-placement builder as the game.',
      'Connection letters are N/E/S/W openings. This fixture includes both straights, all four turns, every T-junction orientation, a four-way cross, and every dead-end orientation.',
      'The central hub section includes both thick side walls and their corrected north-west and north-east corner transitions.',
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
