import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';
import { getHubTileBounds } from '@labyrinth/shared';
import { createSampleDocument } from '../src/editor/sampleScene';
import type {
  EditorCollider,
  EditorElement,
  StyleEditorDocumentV1,
} from '../src/editor/types';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const clientDirectory = path.resolve(scriptDirectory, '..');
const repositoryDirectory = path.resolve(clientDirectory, '..', '..');
const styleLibraryDirectory = path.join(
  clientDirectory,
  'public',
  'assets',
  'chained-echoes-assets-sorted',
);
const generatedVisualPath = path.join(
  clientDirectory,
  'src',
  'systems',
  'CentralHubLayout.generated.ts',
);
const generatedColliderPath = path.join(
  repositoryDirectory,
  'packages',
  'shared',
  'src',
  'central-hub-layout.generated.ts',
);
const runtimeAssetManifestPath = path.join(
  clientDirectory,
  'central-hub-runtime-assets.json',
);

const sourceDocumentPath = path.resolve(
  process.argv[2] ?? 'C:/Users/deals/Downloads/labyrinth-style-v1 (61).json',
);
const edited = JSON.parse(
  await fs.readFile(sourceDocumentPath, 'utf8'),
) as StyleEditorDocumentV1;
const base = createSampleDocument();

if (edited.version !== 1 || edited.reference?.kind !== 'generated-maze-crop') {
  throw new Error('Expected a version-1 generated-maze-crop style-editor export.');
}

// Post-export correction requested for the south broken pillar. Accept either
// the original or corrected coordinates so a future editor export can absorb it.
const southBrokenPillar = edited.elements.find(
  (element) =>
    element.name === 'ancientPillarBroken' &&
    element.x === 1542 &&
    (element.y === 891 || element.y === 907),
);
const southBrokenPillarCollider = edited.colliders.find(
  (collider) =>
    collider.shape === 'rectangle' &&
    collider.x === 1542 &&
    collider.width === 16 &&
    collider.height === 16 &&
    (collider.y === 940 || collider.y === 956),
);
if (!southBrokenPillar || !southBrokenPillarCollider) {
  throw new Error('Cannot find the south broken pillar and its 16x16 collider.');
}
southBrokenPillar.y = 907;
southBrokenPillarCollider.y = 956;

const tileSize = edited.sample.tileSize;
const hub = getHubTileBounds();
const hubSampleX = (hub.left - edited.reference.cropTileX) * tileSize;
const hubSampleY = (hub.top - edited.reference.cropTileY) * tileSize;
const importMargin = 7 * tileSize;
const hubPixelSize = (hub.right - hub.left + 1) * tileSize;

const elementInsideImportArea = (element: EditorElement): boolean =>
  element.x + element.width > hubSampleX - importMargin &&
  element.x < hubSampleX + hubPixelSize + importMargin &&
  element.y + element.height > hubSampleY - importMargin &&
  element.y < hubSampleY + hubPixelSize + importMargin;

const baseElementsById = new Map(base.elements.map((element) => [element.id, element]));
const editorCreatedId = /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i;
const addedElements = edited.elements.filter(
  (element) =>
    !baseElementsById.has(element.id) &&
    editorCreatedId.test(element.id) &&
    elementInsideImportArea(element) &&
    element.role !== 'runestone',
);
if (addedElements.length === 0) {
  throw new Error('The export contains no new central-hub visual elements.');
}

const baseCollidersById = new Map(
  base.colliders.map((collider) => [collider.id, collider]),
);
const changedColliderIds = new Set(
  edited.colliders
    .filter((collider) => {
      const original = baseCollidersById.get(collider.id);
      return !original || JSON.stringify(original) !== JSON.stringify(collider);
    })
    .map((collider) => collider.id),
);
const colliderInsideImportArea = (collider: EditorCollider): boolean =>
  collider.x + collider.width > hubSampleX - importMargin &&
  collider.x < hubSampleX + hubPixelSize + importMargin &&
  collider.y + collider.height > hubSampleY - importMargin &&
  collider.y < hubSampleY + hubPixelSize + importMargin;
const centralHubColliders = edited.colliders.filter(
  (collider) =>
    changedColliderIds.has(collider.id) &&
    colliderInsideImportArea(collider) &&
    collider.ownerRole === 'runestone',
);
const runestones = edited.elements
  .filter(
    (element) => element.role === 'runestone' && element.name.startsWith('Central hub'),
  )
  .map((element) => {
    const match = /runestone (\d+)/i.exec(element.name);
    if (!match) throw new Error(`Cannot read runestone index from ${element.name}.`);
    return {
      index: Number(match[1]) - 1,
      x: element.x - hubSampleX,
      y: element.y - hubSampleY,
      width: element.width,
      height: element.height,
    };
  })
  .sort((a, b) => a.index - b.index);

if (
  runestones.length !== 3 ||
  runestones.some((runestone, index) => runestone.index !== index)
) {
  throw new Error('Expected exactly three indexed central-hub runestones.');
}

const stylePaths = new Set(
  addedElements
    .map((element) => element.assetPath)
    .filter((assetPath) => assetPath.startsWith('/style-assets/')),
);
const resolvedStylePaths = new Map<string, string>();

const catalogSource = (relativePath: string): string => {
  const segments = relativePath.split('/');
  if (segments.length === 1) return 'Loose';
  if (segments[0]?.toLowerCase() === 'assets') return segments[1] || 'Assets';
  return segments[0] || 'Other';
};

const pendingDirectories = [styleLibraryDirectory];
while (pendingDirectories.length > 0 && resolvedStylePaths.size < stylePaths.size) {
  const directory = pendingDirectories.pop()!;
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      pendingDirectories.push(filePath);
      continue;
    }
    if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.png') continue;

    const relativePath = path
      .relative(styleLibraryDirectory, filePath)
      .split(path.sep)
      .join('/');
    const hash = crypto
      .createHash('sha1')
      .update(relativePath)
      .digest('hex')
      .slice(0, 20);
    const catalogPath = `/style-assets/${catalogSource(relativePath)}/${hash}.png`;
    if (stylePaths.has(catalogPath)) resolvedStylePaths.set(catalogPath, relativePath);
  }
}

const unresolvedStylePaths = [...stylePaths].filter(
  (assetPath) => !resolvedStylePaths.has(assetPath),
);
if (unresolvedStylePaths.length > 0) {
  throw new Error(`Cannot resolve style assets:\n${unresolvedStylePaths.join('\n')}`);
}

const runtimeAssetRelativePaths = new Set<string>();
const runtimePathForElement = (element: EditorElement): string => {
  const styleRelativePath = resolvedStylePaths.get(element.assetPath);
  if (styleRelativePath) {
    runtimeAssetRelativePaths.add(styleRelativePath);
    return `/assets/chained-echoes-assets-sorted/${styleRelativePath
      .split('/')
      .map(encodeURIComponent)
      .join('/')}`;
  }

  const sourcePrefix = '/assets/chained-echoes-assets-sorted/';
  if (element.assetPath.startsWith(sourcePrefix)) {
    runtimeAssetRelativePaths.add(
      decodeURIComponent(element.assetPath.slice(sourcePrefix.length)),
    );
  }
  return element.assetPath;
};

const assetPaths: string[] = [];
const assetMetadata: Array<{
  path: string;
  name: string;
  nativeWidth: number;
  nativeHeight: number;
}> = [];
const assetPathIndices = new Map<string, number>();
const ySortedVisualNames = new Set(['ancientPillar', 'ancientPillarBroken']);
const visualEntries = addedElements.map((element) => {
  const assetPath = runtimePathForElement(element);
  let assetIndex = assetPathIndices.get(assetPath);
  if (assetIndex === undefined) {
    assetIndex = assetPaths.length;
    assetPaths.push(assetPath);
    assetMetadata.push({
      path: assetPath,
      name: element.name,
      nativeWidth: element.nativeWidth,
      nativeHeight: element.nativeHeight,
    });
    assetPathIndices.set(assetPath, assetIndex);
  }
  return {
    element,
    row: [
      assetIndex,
      element.x - hubSampleX,
      element.y - hubSampleY,
      element.width,
      element.height,
      element.zIndex,
      element.flipX ? 1 : 0,
    ] as const,
  };
});

const visualRows = visualEntries
  .filter(({ element }) => !ySortedVisualNames.has(element.name))
  .map(({ row }) => row);
const ySortedVisualRows = visualEntries
  .filter(({ element }) => ySortedVisualNames.has(element.name))
  .map(({ element, row }) => {
    const matchingColliders = centralHubColliders.filter(
      (collider) =>
        collider.shape === 'rectangle' &&
        collider.x === element.x &&
        collider.width === element.width &&
        collider.y >= element.y &&
        collider.y < element.y + element.height &&
        Math.abs(
          collider.y + collider.height - (element.y + element.height),
        ) <= 2,
    );
    if (matchingColliders.length !== 1) {
      throw new Error(
        `Expected one base collider for Y-sorted ${element.name} at (${element.x}, ${element.y}); found ${matchingColliders.length}.`,
      );
    }
    const collider = matchingColliders[0]!;
    return [...row, collider.y + collider.height - hubSampleY] as const;
  });

const minX = Math.min(...visualRows.map((row) => row[1]));
const minY = Math.min(...visualRows.map((row) => row[2]));
const maxX = Math.max(...visualRows.map((row) => row[1] + row[3]));
const maxY = Math.max(...visualRows.map((row) => row[2] + row[4]));

const visualSource =
  `// Generated by scripts/import-central-hub.ts from ${path.basename(sourceDocumentPath)}.\n` +
  `// Do not edit this file by hand; re-run the importer with a style-editor export.\n\n` +
  `export type CentralHubSpriteSpec = readonly [\n` +
  `  assetIndex: number,\n  x: number,\n  y: number,\n  width: number,\n` +
  `  height: number,\n  zIndex: number,\n  flipX: 0 | 1,\n];\n\n` +
  `export type CentralHubYSortedSpriteSpec = readonly [\n` +
  `  ...sprite: CentralHubSpriteSpec,\n  sortY: number,\n];\n\n` +
  `export const CENTRAL_HUB_VISUAL_BOUNDS = ${JSON.stringify({ minX, minY, maxX, maxY })} as const;\n\n` +
  `export const CENTRAL_HUB_ASSETS = ${JSON.stringify(assetMetadata, null, 2)} as const;\n\n` +
  `export const CENTRAL_HUB_ASSET_PATHS = CENTRAL_HUB_ASSETS.map((asset) => asset.path);\n\n` +
  `export const CENTRAL_HUB_SPRITE_SPECS: readonly CentralHubSpriteSpec[] = ${JSON.stringify(visualRows)};\n\n` +
  `export const CENTRAL_HUB_Y_SORTED_SPRITE_SPECS: readonly CentralHubYSortedSpriteSpec[] = ${JSON.stringify(ySortedVisualRows)};\n`;

const colliderRows = centralHubColliders.map((collider: EditorCollider) => [
  collider.x - hubSampleX,
  collider.y - hubSampleY,
  collider.width,
  collider.height,
  collider.shape === 'right-triangle' ? 1 : 0,
  collider.flipX ? 1 : 0,
  collider.flipY ? 1 : 0,
]);

const colliderSource =
  `// Generated by the central-hub style importer.\n` +
  `// Coordinates are authoring pixels relative to the 30x30 hub's north-west tile.\n\n` +
  `export type CentralHubColliderSpec = readonly [\n` +
  `  x: number,\n  y: number,\n  width: number,\n  height: number,\n` +
  `  rightTriangle: 0 | 1,\n  flipX: 0 | 1,\n  flipY: 0 | 1,\n];\n\n` +
  `export interface CentralHubRunestoneSpec {\n` +
  `  readonly index: number;\n  readonly x: number;\n  readonly y: number;\n` +
  `  readonly width: number;\n  readonly height: number;\n}\n\n` +
  `export const CENTRAL_HUB_COLLIDER_SPECS: readonly CentralHubColliderSpec[] = ${JSON.stringify(colliderRows)};\n\n` +
  `export const CENTRAL_HUB_RUNESTONE_SPECS: readonly CentralHubRunestoneSpec[] = ${JSON.stringify(runestones, null, 2)};\n`;

const prettierConfig = (await prettier.resolveConfig(repositoryDirectory)) ?? {};
await Promise.all([
  fs.writeFile(
    generatedVisualPath,
    await prettier.format(visualSource, {
      ...prettierConfig,
      filepath: generatedVisualPath,
    }),
  ),
  fs.writeFile(
    generatedColliderPath,
    await prettier.format(colliderSource, {
      ...prettierConfig,
      filepath: generatedColliderPath,
    }),
  ),
  fs.writeFile(
    runtimeAssetManifestPath,
    `${JSON.stringify([...runtimeAssetRelativePaths].sort(), null, 2)}\n`,
  ),
]);

console.log(
  [
    `Imported ${visualRows.length} hub sprites using ${assetPaths.length} textures.`,
    `Imported ${ySortedVisualRows.length} Y-sorted hub sprites.`,
    `Imported ${colliderRows.length} active colliders.`,
    `Imported ${runestones.length} runestone positions.`,
    `Whitelisted ${runtimeAssetRelativePaths.size} source-library assets for production builds.`,
  ].join('\n'),
);
