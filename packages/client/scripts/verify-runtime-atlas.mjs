import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const clientDirectory = path.resolve(scriptDirectory, '..');
const publicDirectory = path.join(clientDirectory, 'public');
const atlasPath = path.join(publicDirectory, 'assets', 'runtime', 'runtime-atlas.png');
const manifestPath = path.join(
  clientDirectory,
  'src',
  'assets',
  'runtimeAtlasManifest.ts',
);

const manifestSource = await fs.readFile(manifestPath, 'utf8');

function generatedString(name) {
  const match = manifestSource.match(new RegExp(`export const ${name} = '([a-f0-9]{64})';`));
  if (!match) throw new Error(`Missing generated ${name} in ${manifestPath}`);
  return match[1];
}

function generatedNumber(name) {
  const match = manifestSource.match(new RegExp(`export const ${name} = (\\d+);`));
  if (!match) throw new Error(`Missing generated ${name} in ${manifestPath}`);
  return Number(match[1]);
}

const framesStartMarker = 'export const RUNTIME_ATLAS_FRAMES = ';
const framesEndMarker = ' as const satisfies';
const framesStart = manifestSource.indexOf(framesStartMarker);
const framesEnd = manifestSource.indexOf(framesEndMarker, framesStart);
if (framesStart < 0 || framesEnd < 0) {
  throw new Error(`Missing generated runtime atlas frames in ${manifestPath}`);
}

const frames = JSON.parse(
  manifestSource.slice(framesStart + framesStartMarker.length, framesEnd),
);
const expectedSourceDigest = generatedString('RUNTIME_ATLAS_SOURCE_DIGEST');
const expectedAtlasDigest = generatedString('RUNTIME_ATLAS_PNG_DIGEST');
const expectedAtlasWidth = generatedNumber('RUNTIME_ATLAS_WIDTH');
const expectedAtlasHeight = generatedNumber('RUNTIME_ATLAS_HEIGHT');

const sourceHasher = createHash('sha256');
for (const assetPath of Object.keys(frames).sort()) {
  const sourcePath = path.resolve(publicDirectory, ...assetPath.split('/'));
  const relativePath = path.relative(publicDirectory, sourcePath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error(`Runtime atlas source escapes the public directory: ${assetPath}`);
  }

  let sourceBytes;
  try {
    sourceBytes = await fs.readFile(sourcePath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    throw new Error(`Missing runtime atlas source: ${assetPath}`);
  }

  sourceHasher.update(assetPath, 'utf8');
  sourceHasher.update(Buffer.from([0]));
  sourceHasher.update(createHash('sha256').update(sourceBytes).digest());
}

const actualSourceDigest = sourceHasher.digest('hex');
if (actualSourceDigest !== expectedSourceDigest) {
  throw new Error(
    'Runtime atlas sources changed after the generated outputs were committed.\n' +
      'Run npm run sync:runtime-atlas --workspace @labyrinth/client and commit the results.',
  );
}

let atlasBytes;
try {
  atlasBytes = await fs.readFile(atlasPath);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  throw new Error(`Missing generated runtime atlas: ${atlasPath}`);
}

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
if (
  atlasBytes.length < 24 ||
  !atlasBytes.subarray(0, pngSignature.length).equals(pngSignature)
) {
  throw new Error(`Generated runtime atlas is not a valid PNG: ${atlasPath}`);
}

const actualAtlasWidth = atlasBytes.readUInt32BE(16);
const actualAtlasHeight = atlasBytes.readUInt32BE(20);
if (actualAtlasWidth !== expectedAtlasWidth || actualAtlasHeight !== expectedAtlasHeight) {
  throw new Error(
    `Generated runtime atlas dimensions are ${actualAtlasWidth}x${actualAtlasHeight}; ` +
      `the manifest expects ${expectedAtlasWidth}x${expectedAtlasHeight}.`,
  );
}

const actualAtlasDigest = createHash('sha256').update(atlasBytes).digest('hex');
if (actualAtlasDigest !== expectedAtlasDigest) {
  throw new Error(
    'Generated runtime atlas does not match its manifest.\n' +
      'Run npm run sync:runtime-atlas --workspace @labyrinth/client and commit the results.',
  );
}

console.log(
  `Verified ${path.relative(clientDirectory, atlasPath)} ` +
    `(${actualAtlasWidth}x${actualAtlasHeight}, ${Object.keys(frames).length} source paths).`,
);
