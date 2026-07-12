import type { EditorCollider, EditorElement, SemanticRole, StyleEditorDocumentV1 } from './types';

const TILE = 16;
const CELL_TILES = 6;
const WALL_TILES = 8;
const WIDTH_TILES = WALL_TILES * 2 + CELL_TILES;
const HEIGHT_TILES = WIDTH_TILES;
let sequence = 0;

function id(prefix: string): string {
  sequence += 1;
  return `${prefix}-${sequence}`;
}

function element(
  name: string,
  role: SemanticRole,
  assetPath: string,
  x: number,
  y: number,
  width: number,
  height: number,
  zIndex: number,
  nativeWidth = width,
  nativeHeight = height,
): EditorElement {
  return {
    id: id('element'),
    name,
    role,
    assetPath,
    nativeWidth,
    nativeHeight,
    x,
    y,
    width,
    height,
    zIndex,
    opacity: 1,
    flipX: false,
    flipY: false,
    visible: true,
  };
}

function collider(
  name: string,
  ownerRole: EditorCollider['ownerRole'],
  x: number,
  y: number,
  width: number,
  height: number,
  ownerId: string | null = null,
): EditorCollider {
  return { id: id('collider'), name, ownerId, ownerRole, x, y, width, height, enabled: true };
}

export function createSampleDocument(): StyleEditorDocumentV1 {
  sequence = 0;
  const elements: EditorElement[] = [];
  const colliders: EditorCollider[] = [];
  const canopy = Array.from({ length: 8 }, (_, index) => `/assets/forest/fior_canopy_${index}.png`);
  const largeTrees = ['/assets/forest/tree_primary_02.png', '/assets/forest/tree_primary_03.png'];
  const smallTrees = ['/assets/forest/tree_small_04.png', '/assets/forest/tree_small_05.png'];
  const bushes = [1, 2, 3, 4].map((index) => `/assets/forest/bush_0${index}.png`);
  const wallSize = WALL_TILES * TILE;
  const cellSize = CELL_TILES * TILE;
  const sampleSize = WIDTH_TILES * TILE;
  const cellStart = wallSize;
  const cellEnd = cellStart + cellSize;

  // Five simple ground regions keep the sample readable and make replacing
  // the cell floor or any wall bed a single operation.
  elements.push(
    element('Cell grass', 'ground.grass', '/assets/forest/fior_grass_0.png', cellStart, cellStart, cellSize, cellSize, 0, TILE, TILE),
    element('North forest ground', 'ground.forest', '/assets/forest/fior_ground_0.png', 0, 0, sampleSize, wallSize, 1, TILE, TILE),
    element('South forest ground', 'ground.forest', '/assets/forest/fior_ground_1.png', 0, cellEnd, sampleSize, wallSize, 1, TILE, TILE),
    element('West forest ground', 'ground.forest', '/assets/forest/fior_ground_2.png', 0, cellStart, wallSize, cellSize, 1, TILE, TILE),
    element('East forest ground', 'ground.forest', '/assets/forest/fior_ground_3.png', cellEnd, cellStart, wallSize, cellSize, 1, TILE, TILE),
  );

  // These four rectangles are the exact 8-tile wall bands used around a real
  // 6x6 maze cell. Together they form one uninterrupted solid ring.
  colliders.push(
    collider('North wall collider', 'wall.solid', 0, 0, sampleSize, wallSize),
    collider('South wall collider', 'wall.solid', 0, cellEnd, sampleSize, wallSize),
    collider('West wall collider', 'wall.solid', 0, cellStart, wallSize, cellSize),
    collider('East wall collider', 'wall.solid', cellEnd, cellStart, wallSize, cellSize),
  );

  const addCanopy = (name: string, x: number, y: number, index: number, zIndex: number): void => {
    elements.push(element(name, 'wall.canopy', canopy[index % canopy.length], x, y, 34, 34, zIndex));
  };

  // Canopy modules stay inside their wall bands and sit behind the trunks.
  for (let x = 8, index = 0; x < sampleSize - 24; x += 32, index++) {
    addCanopy(`North canopy ${index + 1}`, x, wallSize - 58 - (index % 2) * 6, index, 20);
    addCanopy(`South canopy ${index + 1}`, x, cellEnd + 18 + (index % 2) * 5, index + 3, 20);
  }
  for (let y = cellStart + 4, index = 0; y < cellEnd - 24; y += 32, index++) {
    addCanopy(`West canopy ${index + 1}`, wallSize - 58 - (index % 2) * 5, y, index + 5, 21 + y);
    addCanopy(`East canopy ${index + 1}`, cellEnd + 18 + (index % 2) * 5, y, index + 1, 21 + y);
  }

  const addTree = (
    name: string,
    role: 'tree.large' | 'tree.small',
    assetPath: string,
    x: number,
    y: number,
    width: number,
    height: number,
    zIndex: number,
  ): void => {
    elements.push(element(`${name} shadow`, 'shadow', '/assets/forest/tree_shadow.png', x + width * 0.18, y + height - 16, width * 0.64, 18, zIndex - 1));
    elements.push(element(name, role, assetPath, x, y, width, height, zIndex));
  };

  // The north face ends at y=128. The south trees begin at y=224, keeping
  // their crowns out of the 96px walkable cell exactly as requested.
  for (let x = 10, index = 0; x < sampleSize - 55; x += 54, index++) {
    addTree(`North large tree ${index + 1}`, 'tree.large', largeTrees[index % 2], x, wallSize - 96, 70, 96, 120 + index);
    addTree(`South large tree ${index + 1}`, 'tree.large', largeTrees[(index + 1) % 2], x + 5, cellEnd + 8, 70, 96, 320 + index);
  }

  addTree('West small tree 1', 'tree.small', smallTrees[0], 54, cellStart + 6, 38, 58, 190);
  addTree('West small tree 2', 'tree.small', smallTrees[1], 72, cellStart + 43, 38, 58, 230);
  addTree('East small tree 1', 'tree.small', smallTrees[1], cellEnd + 34, cellStart + 5, 38, 58, 190);
  addTree('East small tree 2', 'tree.small', smallTrees[0], cellEnd + 54, cellStart + 42, 38, 58, 230);

  const bushPositions = [
    ['North bush 1', 104, wallSize - 25, 0],
    ['North bush 2', 218, wallSize - 24, 1],
    ['South bush 1', 94, cellEnd + 8, 2],
    ['South bush 2', 232, cellEnd + 10, 3],
    ['West bush', wallSize - 28, cellStart + 35, 1],
    ['East bush', cellEnd + 6, cellStart + 35, 2],
  ] as const;
  for (const [name, x, y, variant] of bushPositions) {
    elements.push(element(name, 'bush', bushes[variant], x, y, 28, 26, 400 + y));
  }

  const now = new Date().toISOString();
  return {
    version: 1,
    createdAt: now,
    updatedAt: now,
    sample: { name: 'Single Maze Cell — 6×6 Floor + 8-Tile Forest Walls', width: sampleSize, height: HEIGHT_TILES * TILE, tileSize: TILE },
    notes: 'This sample matches one live maze cell: a 6×6-tile walkable floor enclosed by 8-tile solid forest-wall bands.',
    elements,
    colliders,
  };
}
