export type EditorTool = 'select' | 'add' | 'paint' | 'erase' | 'collider' | 'pan';

export type SemanticRole =
  | 'ground.grass'
  | 'ground.path'
  | 'ground.forest'
  | 'wall.north.face'
  | 'wall.south.face'
  | 'wall.vertical.face'
  | 'wall.canopy'
  | 'tree.large'
  | 'tree.small'
  | 'bush'
  | 'shadow'
  | 'gate'
  | 'pressure-plate'
  | 'runestone'
  | 'portal'
  | 'player-marker'
  | 'landmark'
  | 'decoration';

export interface AssetCatalogEntry {
  id: string;
  path: string;
  relativePath: string;
  name: string;
  source: string;
  collection: string;
  category: string;
  width: number;
  height: number;
}

export interface AssetCatalogMeta {
  total: number;
  categories: string[];
  collections: string[];
  sources: string[];
}

export interface AssetCatalogPage {
  total: number;
  offset: number;
  limit: number;
  assets: AssetCatalogEntry[];
}

export interface EditorElement {
  id: string;
  name: string;
  role: SemanticRole;
  assetPath: string;
  /** Optional frame within a spritesheet. Omit to use the complete asset. */
  sourceRect?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  nativeWidth: number;
  nativeHeight: number;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  opacity: number;
  flipX: boolean;
  flipY: boolean;
  visible: boolean;
}

export interface EditorCollider {
  id: string;
  name: string;
  ownerId: string | null;
  ownerRole: SemanticRole | 'wall.solid' | 'freeform';
  x: number;
  y: number;
  width: number;
  height: number;
  enabled: boolean;
}

export interface StyleEditorDocumentV1 {
  version: 1;
  createdAt: string;
  updatedAt: string;
  sample: {
    name: string;
    width: number;
    height: number;
    tileSize: number;
  };
  notes: string;
  reference?: {
    kind: 'generated-maze-crop';
    mazeSeed: number;
    cropCellX: number;
    cropCellY: number;
    cropCellsWide: number;
    cropCellsHigh: number;
    cropTileX: number;
    cropTileY: number;
    topology: Array<{
      cellX: number;
      cellY: number;
      sampleColumn: number;
      sampleRow: number;
      connections: string;
      label: string;
    }>;
  };
  elements: EditorElement[];
  colliders: EditorCollider[];
}

export const SEMANTIC_ROLES: SemanticRole[] = [
  'ground.grass',
  'ground.path',
  'ground.forest',
  'wall.north.face',
  'wall.south.face',
  'wall.vertical.face',
  'wall.canopy',
  'tree.large',
  'tree.small',
  'bush',
  'shadow',
  'gate',
  'pressure-plate',
  'runestone',
  'portal',
  'player-marker',
  'landmark',
  'decoration',
];
