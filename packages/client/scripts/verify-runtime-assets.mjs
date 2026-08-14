import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const clientDirectory = path.resolve(scriptDirectory, '..');
const publicAssetsDirectory = path.join(clientDirectory, 'public', 'assets');

const manifests = [
  {
    name: 'Fiorwoods',
    file: path.join(scriptDirectory, 'runtime-fiorwoods-assets.json'),
    target: path.join(publicAssetsDirectory, 'fiorwoods-runtime'),
    toRelativePaths: (ids) => ids.map((id) => `Sprite_Fiorwoods_${id}.png`),
  },
  {
    name: 'central hub',
    file: path.join(clientDirectory, 'central-hub-runtime-assets.json'),
    target: path.join(publicAssetsDirectory, 'runtime-style'),
    toRelativePaths: (relativePaths) => relativePaths,
  },
  {
    name: 'spike gates',
    file: path.join(clientDirectory, 'spike-gate-runtime-assets.json'),
    target: path.join(publicAssetsDirectory, 'runtime-style'),
    toRelativePaths: (relativePaths) => relativePaths,
  },
];

const missing = [];
for (const manifest of manifests) {
  const entries = JSON.parse(await fs.readFile(manifest.file, 'utf8'));
  for (const relativePath of manifest.toRelativePaths(entries)) {
    const filePath = path.join(manifest.target, ...relativePath.split('/'));
    try {
      const stats = await fs.stat(filePath);
      if (!stats.isFile()) missing.push(`${manifest.name}: ${relativePath}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      missing.push(`${manifest.name}: ${relativePath}`);
    }
  }
}

if (missing.length > 0) {
  throw new Error(
    `Missing tracked runtime sprites:\n${missing.map((entry) => `- ${entry}`).join('\n')}\n` +
      'Run npm run sync:runtime-assets --workspace @labyrinth/client and commit the generated files.',
  );
}

console.log('Verified all tracked runtime sprites.');
