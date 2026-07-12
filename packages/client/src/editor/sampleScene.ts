import type { EditorCollider, EditorElement, SemanticRole, StyleEditorDocumentV1 } from './types';

const TILE = 16;
const CELL_TILES = 6;
const WALL_TILES = 8;
const SIZE_TILES = WALL_TILES * 2 + CELL_TILES;
const SAMPLE_SIZE = SIZE_TILES * TILE;
const FIORWOODS_ROOT = '/assets/chained-echoes-assets-sorted/Assets/Maps/Fiorwoods';
const SOUTH_FACE_ROW_STARTS = [38, 88, 138, 188, 238, 288, 338, 388];
let sequence = 0;

function id(prefix: string): string {
  sequence += 1;
  return `${prefix}-${sequence}`;
}

function fiorwoodsAsset(assetId: number): string {
  return `${FIORWOODS_ROOT}/Sprite_Fiorwoods_${assetId}.png`;
}

function element(name: string, role: SemanticRole, assetId: number, tileX: number, tileY: number, zIndex: number, flipX = false): EditorElement {
  return {
    id: id('element'), name, role, assetPath: fiorwoodsAsset(assetId),
    nativeWidth: 32, nativeHeight: 32, x: tileX * TILE, y: tileY * TILE,
    width: TILE, height: TILE, zIndex, opacity: 1, flipX, flipY: false, visible: true,
  };
}

function collider(name: string, x: number, y: number, width: number, height: number): EditorCollider {
  return { id: id('collider'), name, ownerId: null, ownerRole: 'wall.solid', x, y, width, height, enabled: true };
}

function isWall(x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= SIZE_TILES || y >= SIZE_TILES) return false;
  const cellStart = WALL_TILES;
  const cellEnd = cellStart + CELL_TILES;
  return x < cellStart || x >= cellEnd || y < cellStart || y >= cellEnd;
}

function southFaceRow(x: number, y: number): number | null {
  for (let distanceToBase = 0; distanceToBase < WALL_TILES; distanceToBase++) {
    if (!isWall(x, y + distanceToBase)) return null;
    if (!isWall(x, y + distanceToBase + 1)) return WALL_TILES - distanceToBase - 1;
  }
  return null;
}

function northHedgeRow(x: number, y: number): number | null {
  for (let distanceFromTop = 0; distanceFromTop < 3; distanceFromTop++) {
    if (!isWall(x, y - distanceFromTop)) return null;
    if (!isWall(x, y - distanceFromTop - 1)) return distanceFromTop;
  }
  return null;
}

export function createSampleDocument(): StyleEditorDocumentV1 {
  sequence = 0;
  const elements: EditorElement[] = [];
  const colliders: EditorCollider[] = [];
  const grassIds = [102, 105, 108, 154];

  for (let y = 0; y < SIZE_TILES; y++) {
    for (let x = 0; x < SIZE_TILES; x++) {
      if (isWall(x, y)) {
        elements.push(element(`Forest interior ${x},${y}`, 'ground.forest', 301, x, y, 0));
      } else {
        elements.push(element(`Grass ${x},${y}`, 'ground.grass', grassIds[(x * 17 + y * 31) % grassIds.length], x, y, 0));
      }
    }
  }

  for (let y = 0; y < SIZE_TILES; y++) {
    for (let x = 0; x < SIZE_TILES; x++) {
      if (!isWall(x, y)) continue;
      const eastOpen = !isWall(x + 1, y);
      const westOpen = !isWall(x - 1, y);
      const faceRow = southFaceRow(x, y);

      if (faceRow !== null) {
        const sideCorner = eastOpen || westOpen;
        if (!sideCorner || faceRow >= 2) {
          elements.push(element(`South face ${x},${y}`, 'wall.canopy', SOUTH_FACE_ROW_STARTS[faceRow] + (x % 6), x, y, 100 + y));
        }
        if (sideCorner && faceRow === 1) {
          elements.push(element(`Side cap ${x},${y}`, 'wall.canopy', 80, x, y, 110 + y, westOpen));
        }
        if (sideCorner && faceRow === 2) {
          elements.push(element(`Rounded face corner ${x},${y}`, 'wall.canopy', 379, westOpen ? x - 1 : x + 1, y, 110 + y, eastOpen));
        }
        continue;
      }

      const hedgeRow = northHedgeRow(x, y);
      if (hedgeRow !== null) {
        elements.push(element(`North hedge ${x},${y}`, 'wall.canopy', [381, 382, 380][hedgeRow], x, y, 100 + y));
      } else if (eastOpen || westOpen) {
        const verticalEnd = !isWall(x, y - 1) || !isWall(x, y + 1);
        const assetId = verticalEnd ? 80 : [31, 32][(x * 17 + y * 29) % 2];
        elements.push(element(`Side hedge ${x},${y}`, 'wall.canopy', assetId, x, y, 100 + y, westOpen));
      }
    }
  }

  const wallSize = WALL_TILES * TILE;
  const cellSize = CELL_TILES * TILE;
  const cellEnd = wallSize + cellSize;
  colliders.push(
    collider('North wall collider', 0, 0, SAMPLE_SIZE, wallSize),
    collider('South wall collider', 0, cellEnd, SAMPLE_SIZE, wallSize),
    collider('West wall collider', 0, wallSize, wallSize, cellSize),
    collider('East wall collider', cellEnd, wallSize, wallSize, cellSize),
  );

  const now = new Date().toISOString();
  return {
    version: 1, createdAt: now, updatedAt: now,
    sample: { name: 'Current Fiorwoods Maze Cell', width: SAMPLE_SIZE, height: SAMPLE_SIZE, tileSize: TILE },
    notes: 'Matches the current in-game maze cell: Fiorwoods grass, dark forest interiors, an 8-row south tree face, a 3-row north hedge, and directional side hedges.',
    elements, colliders,
  };
}
