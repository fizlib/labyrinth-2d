import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const clientDirectory = path.resolve(scriptDirectory, '..');
const sourceDirectory = path.join(
  clientDirectory,
  'public',
  'assets',
  'chained-echoes-assets-sorted',
  'Assets',
  'Maps',
  'Fiorwoods',
);
const targetDirectory = path.join(
  clientDirectory,
  'public',
  'assets',
  'fiorwoods-runtime',
);
const assetIds = JSON.parse(
  await fs.readFile(path.join(scriptDirectory, 'runtime-fiorwoods-assets.json'), 'utf8'),
);
const styleLibraryDirectory = path.join(
  clientDirectory,
  'public',
  'assets',
  'chained-echoes-assets-sorted',
);
const runtimeStyleDirectory = path.join(
  clientDirectory,
  'public',
  'assets',
  'runtime-style',
);
const runtimeStyleManifestPaths = [
  path.join(clientDirectory, 'central-hub-runtime-assets.json'),
  path.join(clientDirectory, 'spike-gate-runtime-assets.json'),
  path.join(clientDirectory, 'src', 'assets', 'swordFieldRuntimeAssets.json'),
];
const runtimeStyleAssets = (
  await Promise.all(
    runtimeStyleManifestPaths.map(async (manifestPath) => {
      const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
      return Array.isArray(manifest) ? manifest : Object.values(manifest);
    }),
  )
).flat();

await fs.mkdir(targetDirectory, { recursive: true });

const expectedFiles = new Set(assetIds.map((id) => `Sprite_Fiorwoods_${id}.png`));
for (const entry of await fs.readdir(targetDirectory, { withFileTypes: true })) {
  if (
    entry.isFile() &&
    /^Sprite_Fiorwoods_\d+\.png$/.test(entry.name) &&
    !expectedFiles.has(entry.name)
  ) {
    await fs.unlink(path.join(targetDirectory, entry.name));
  }
}

for (const fileName of expectedFiles) {
  await fs.copyFile(
    path.join(sourceDirectory, fileName),
    path.join(targetDirectory, fileName),
  );
}

const normalizeRelativePath = (filePath) => filePath.split(path.sep).join('/');
const expectedRuntimeStyleFiles = new Set(runtimeStyleAssets);
const pendingDirectories = [runtimeStyleDirectory];

while (pendingDirectories.length > 0) {
  const directory = pendingDirectories.pop();
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') continue;
    throw error;
  }

  for (const entry of entries) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      pendingDirectories.push(filePath);
      continue;
    }
    if (
      entry.isFile() &&
      entry.name.toLowerCase().endsWith('.png') &&
      !expectedRuntimeStyleFiles.has(
        normalizeRelativePath(path.relative(runtimeStyleDirectory, filePath)),
      )
    ) {
      await fs.unlink(filePath);
    }
  }
}

for (const relativePath of expectedRuntimeStyleFiles) {
  const targetPath = path.join(runtimeStyleDirectory, ...relativePath.split('/'));
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.copyFile(
    path.join(styleLibraryDirectory, ...relativePath.split('/')),
    targetPath,
  );
}

console.log(
  `Synced ${expectedFiles.size} Fiorwoods sprites and ${expectedRuntimeStyleFiles.size} style-library sprites.`,
);
