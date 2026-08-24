import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

import {
  RUNTIME_ATLAS_FRAMES,
  RUNTIME_ATLAS_HEIGHT,
  RUNTIME_ATLAS_WIDTH,
} from '../dist/assets/runtimeAtlasManifest.js';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const runtimePathsBundle = await build({
  entryPoints: [path.resolve(testDirectory, '../src/assets/runtimeAtlasPaths.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
});
const runtimePathsModule = await import(
  `data:text/javascript;base64,${Buffer.from(runtimePathsBundle.outputFiles[0].contents).toString('base64')}`
);
const { normalizeRuntimeAtlasAssetPath, RUNTIME_ATLAS_SOURCE_PATHS } = runtimePathsModule;

test('runtime atlas contains every eagerly used source PNG exactly once by path', () => {
  const expected = [
    ...new Set(RUNTIME_ATLAS_SOURCE_PATHS.map(normalizeRuntimeAtlasAssetPath)),
  ].sort();
  const actual = Object.keys(RUNTIME_ATLAS_FRAMES).sort();

  assert.equal(expected.length, 455);
  assert.deepEqual(actual, expected);
});

test('runtime atlas frames are positive and remain within the generated texture', () => {
  assert.ok(RUNTIME_ATLAS_WIDTH <= 2048);
  assert.ok(RUNTIME_ATLAS_HEIGHT <= 2048);

  for (const [assetPath, [x, y, width, height]] of Object.entries(RUNTIME_ATLAS_FRAMES)) {
    assert.ok(width > 0, `${assetPath} has a positive width`);
    assert.ok(height > 0, `${assetPath} has a positive height`);
    assert.ok(
      x >= 0 && x + width <= RUNTIME_ATLAS_WIDTH,
      `${assetPath} fits horizontally`,
    );
    assert.ok(
      y >= 0 && y + height <= RUNTIME_ATLAS_HEIGHT,
      `${assetPath} fits vertically`,
    );
  }
});

test('unique runtime frames do not overlap', () => {
  const uniqueFrames = [
    ...new Map(
      Object.entries(RUNTIME_ATLAS_FRAMES).map(([assetPath, frame]) => [
        frame.join(','),
        [assetPath, frame],
      ]),
    ).values(),
  ];

  for (let leftIndex = 0; leftIndex < uniqueFrames.length; leftIndex += 1) {
    const [leftPath, [leftX, leftY, leftWidth, leftHeight]] = uniqueFrames[leftIndex];
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < uniqueFrames.length;
      rightIndex += 1
    ) {
      const [rightPath, [rightX, rightY, rightWidth, rightHeight]] =
        uniqueFrames[rightIndex];
      const overlaps =
        leftX < rightX + rightWidth &&
        leftX + leftWidth > rightX &&
        leftY < rightY + rightHeight &&
        leftY + leftHeight > rightY;
      assert.equal(overlaps, false, `${leftPath} overlaps ${rightPath}`);
    }
  }
});
