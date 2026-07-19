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
const targetDirectory = path.join(clientDirectory, 'public', 'assets', 'fiorwoods-runtime');
const assetIds = JSON.parse(
  await fs.readFile(path.join(scriptDirectory, 'runtime-fiorwoods-assets.json'), 'utf8'),
);

await fs.mkdir(targetDirectory, { recursive: true });

const expectedFiles = new Set(assetIds.map((id) => `Sprite_Fiorwoods_${id}.png`));
for (const entry of await fs.readdir(targetDirectory, { withFileTypes: true })) {
  if (entry.isFile() && /^Sprite_Fiorwoods_\d+\.png$/.test(entry.name) && !expectedFiles.has(entry.name)) {
    await fs.unlink(path.join(targetDirectory, entry.name));
  }
}

for (const fileName of expectedFiles) {
  await fs.copyFile(path.join(sourceDirectory, fileName), path.join(targetDirectory, fileName));
}

console.log(`Synced ${expectedFiles.size} Fiorwoods runtime sprites to ${targetDirectory}`);
