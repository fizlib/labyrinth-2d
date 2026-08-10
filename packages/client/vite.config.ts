// packages/client/vite.config.ts
import { defineConfig, type Plugin } from 'vite';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';

interface CatalogAsset {
  id: string;
  path: string;
  relativePath: string;
  name: string;
  source: string;
  collection: string;
  category: string;
  width: number;
  height: number;
  filePath: string;
}

const naturalSort = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function classifyAsset(name: string, relativePath: string): string {
  const value = `${relativePath}/${name}`.toLowerCase();
  if (/shadow/.test(value)) return 'Shadows';
  if (/tree|stump|trunk|canopy/.test(value)) return 'Trees';
  if (/bush|grass|flower|plant|fern|moss|leaf|foliage/.test(value)) return 'Bushes & Plants';
  if (/water|river|pond|lake|ocean|waterfall/.test(value)) return 'Water';
  if (/wall|cliff|fence|hedge/.test(value)) return 'Walls & Cliffs';
  if (/gate|door|portcullis/.test(value)) return 'Gates & Doors';
  if (/rock|stone|boulder|pebble/.test(value)) return 'Rocks';
  if (/ground|floor|terrain|field|dirt|path|road|sand|snow|fiorwoods/.test(value)) return 'Terrain';
  if (/house|building|crate|barrel|table|chair|lamp|sign|bridge|prop/.test(value)) return 'Buildings & Props';
  if (/icon|button|panel|cursor|font|ui|effect|particle|spark|slash/.test(value)) return 'Effects & UI';
  if (/natural objects|natural decoration/.test(value)) return 'Bushes & Plants';
  if (/(^|[\\/])maps[\\/]/.test(value)) return 'Terrain';
  if (/characters|enemies|creatures|npcs|main characters/.test(value)) return 'Characters';
  if (/buildings|artificial objects|housing/.test(value)) return 'Buildings & Props';
  if (/effects|particles|systemgfx|textmesh|fonts|materials/.test(value)) return 'Effects & UI';
  return 'Other';
}

function catalogLocation(relativePath: string): { source: string; collection: string } {
  const segments = relativePath.split('/');
  if (segments.length === 1) {
    return { source: 'Loose', collection: 'Unsorted' };
  }
  if (segments[0]?.toLowerCase() === 'assets') {
    const source = segments[1] || 'Assets';
    if (source === 'Maps') return { source, collection: segments[2] || 'General' };
    const hierarchy = segments.slice(2, -1);
    return { source, collection: hierarchy.length > 0 ? hierarchy.join(' / ') : 'General' };
  }
  return {
    source: segments[0] || 'Other',
    collection: segments.slice(1, -1).join(' / ') || 'General',
  };
}

async function readPngSize(filePath: string): Promise<{ width: number; height: number }> {
  const buffer = Buffer.allocUnsafe(24);
  const handle = await fs.promises.open(filePath, 'r');
  try {
    const { bytesRead } = await handle.read(buffer, 0, 24, 0);
    if (bytesRead >= 24 && buffer.toString('ascii', 1, 4) === 'PNG') {
      return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    }
  } finally {
    await handle.close();
  }
  return { width: 0, height: 0 };
}

function styleAssetCatalogPlugin(publicDir: string, includeFullStyleLibrary: boolean): Plugin {
  let cached: CatalogAsset[] | null = null;
  let pendingScan: Promise<CatalogAsset[]> | null = null;

  const styleLibraryRoot = path.join(publicDir, 'assets', 'chained-echoes-assets-sorted');
  const characterFrameSourceRoots = ['lenne', 'glenn', 'amalia', 'robb', 'sienna'].map(
    (name) => path.join(publicDir, 'assets', name),
  );

  const isWithin = (parent: string, candidate: string): boolean => {
    const relative = path.relative(parent, candidate);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  };

  const shouldIncludePublicPath = (candidate: string): boolean => {
    if (characterFrameSourceRoots.some((root) => isWithin(root, candidate))) return false;
    if (includeFullStyleLibrary) return true;
    return !isWithin(styleLibraryRoot, candidate);
  };

  const scan = async (): Promise<CatalogAsset[]> => {
    if (cached) return cached;
    if (pendingScan) return pendingScan;

    pendingScan = (async () => {
      const root = styleLibraryRoot;
      const candidates: Array<{ name: string; filePath: string; relativePath: string }> = [];
      const rootEntries = includeFullStyleLibrary
        ? await fs.promises.readdir(root, { withFileTypes: true })
        : [];
      const directories = rootEntries
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(root, entry.name));
      const rootFileNames = new Set(
        rootEntries
          .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.png'))
          .map((entry) => entry.name.toLowerCase()),
      );

      for (const entry of rootEntries) {
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.png')) continue;

        // Loose exports often contain both `sprite.png` and an equivalent
        // `sprite #12345.png` alias. Prefer the stable unsuffixed filename when
        // it exists, while retaining numbered files that have no canonical peer.
        const canonicalName = entry.name.replace(/ #\d+(?=\.png$)/i, '');
        if (canonicalName !== entry.name && rootFileNames.has(canonicalName.toLowerCase())) continue;

        candidates.push({
          name: entry.name,
          filePath: path.join(root, entry.name),
          relativePath: entry.name,
        });
      }

      while (directories.length > 0) {
        const directory = directories.pop()!;
        let entries: fs.Dirent[];
        try {
          entries = await fs.promises.readdir(directory, { withFileTypes: true });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
          throw error;
        }
        for (const entry of entries) {
          const filePath = path.join(directory, entry.name);
          if (entry.isDirectory()) directories.push(filePath);
          else if (entry.isFile() && entry.name.toLowerCase().endsWith('.png')) {
            candidates.push({
              name: entry.name,
              filePath,
              relativePath: path.relative(root, filePath).split(path.sep).join('/'),
            });
          }
        }
      }

      const result: CatalogAsset[] = [];
      const batchSize = 128;
      for (let index = 0; index < candidates.length; index += batchSize) {
        const batch = await Promise.all(candidates.slice(index, index + batchSize).map(async ({ name, filePath, relativePath }) => {
          const size = await readPngSize(filePath);
          const { source, collection } = catalogLocation(relativePath);
          const safeId = crypto.createHash('sha1').update(relativePath).digest('hex').slice(0, 20);
          return {
            id: relativePath,
            path: `/style-assets/${source}/${safeId}.png`,
            relativePath,
            name: name.replace(/\.png$/i, ''),
            source,
            collection,
            category: classifyAsset(name, relativePath),
            width: size.width,
            height: size.height,
            filePath,
          } satisfies CatalogAsset;
        }));
        result.push(...batch);
      }

      result.sort((a, b) => naturalSort.compare(a.name, b.name) || naturalSort.compare(a.source, b.source));
      cached = result;
      return result;
    })().finally(() => {
      pendingScan = null;
    });

    return pendingScan;
  };

  const metadata = (assets: CatalogAsset[]) => ({
    total: assets.length,
    categories: [...new Set(assets.map((asset) => asset.category))].sort(naturalSort.compare),
    collections: [...new Set(assets.map((asset) => asset.collection))].sort(naturalSort.compare),
    sources: [...new Set(assets.map((asset) => asset.source))].sort(naturalSort.compare),
  });

  const publicAssets = (assets: CatalogAsset[]) => assets.map(({ filePath: _filePath, ...asset }) => asset);

  const contentType = (filePath: string): string => {
    switch (path.extname(filePath).toLowerCase()) {
      case '.png': return 'image/png';
      case '.jpg':
      case '.jpeg': return 'image/jpeg';
      case '.webp': return 'image/webp';
      case '.json':
      case '.tmj': return 'application/json; charset=utf-8';
      default: return 'application/octet-stream';
    }
  };

  const installPublicMiddleware = (server: { middlewares: { use(handler: (req: IncomingMessage, res: ServerResponse, next: (error?: unknown) => void) => void): void } }) => {
    const publicRoot = path.resolve(publicDir);
    server.middlewares.use((req, res, next) => {
      void (async () => {
        const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
        if (!pathname.startsWith('/assets/') && !pathname.startsWith('/tilesets/')) {
          next();
          return;
        }

        let decodedPath: string;
        try {
          decodedPath = decodeURIComponent(pathname);
        } catch {
          res.statusCode = 400;
          res.end('Invalid asset path');
          return;
        }
        const filePath = path.resolve(publicRoot, `.${decodedPath}`);
        if (filePath !== publicRoot && !filePath.startsWith(`${publicRoot}${path.sep}`)) {
          res.statusCode = 403;
          res.end('Forbidden');
          return;
        }

        try {
          const stats = await fs.promises.stat(filePath);
          if (!stats.isFile()) {
            next();
            return;
          }
          res.setHeader('Content-Type', contentType(filePath));
          res.setHeader('Cache-Control', 'no-cache');
          fs.createReadStream(filePath).pipe(res);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            next();
            return;
          }
          throw error;
        }
      })().catch(next);
    });
  };

  const mirrorPublicDirectory = async (targetRoot: string): Promise<void> => {
    const directories = [publicDir];
    const files: Array<{ source: string; target: string }> = [];
    while (directories.length > 0) {
      const sourceDir = directories.pop()!;
      const relativeDir = path.relative(publicDir, sourceDir);
      const targetDir = path.join(targetRoot, relativeDir);
      await fs.promises.mkdir(targetDir, { recursive: true });
      for (const entry of await fs.promises.readdir(sourceDir, { withFileTypes: true })) {
        const source = path.join(sourceDir, entry.name);
        if (!shouldIncludePublicPath(source)) continue;
        if (entry.isDirectory()) directories.push(source);
        else if (entry.isFile()) files.push({ source, target: path.join(targetDir, entry.name) });
      }
    }

    for (let index = 0; index < files.length; index += 128) {
      await Promise.all(files.slice(index, index + 128).map(async ({ source, target }) => {
        try {
          await fs.promises.link(source, target);
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === 'EEXIST') return;
          await fs.promises.copyFile(source, target);
        }
      }));
    }
  };

  const serveAsset = async (req: IncomingMessage, res: ServerResponse): Promise<boolean> => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (!url.pathname.startsWith('/style-assets/')) return false;
    const asset = (await scan()).find((entry) => entry.path === url.pathname);
    if (!asset) {
      res.statusCode = 404;
      res.end('Asset not found');
      return true;
    }
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    fs.createReadStream(asset.filePath).pipe(res);
    return true;
  };

  const installAssetMiddleware = (server: { middlewares: { use(handler: (req: IncomingMessage, res: ServerResponse, next: (error?: unknown) => void) => void): void } }) => {
    server.middlewares.use((req, res, next) => {
      void serveAsset(req, res).then((served) => {
        if (!served) next();
      }).catch(next);
    });
  };

  return {
    name: 'labyrinth-style-asset-catalog',
    configureServer(server) {
      installPublicMiddleware(server);
      installAssetMiddleware(server);
      server.middlewares.use('/__style-assets', (req, res, next) => {
        void (async () => {
          const assets = await scan();
          const url = new URL(req.url ?? '/', 'http://localhost');
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');

          if (url.pathname === '/meta') {
            res.end(JSON.stringify(metadata(assets)));
            return;
          }

          const query = (url.searchParams.get('q') ?? '').trim().toLowerCase();
          const category = url.searchParams.get('category') ?? '';
          const collection = url.searchParams.get('collection') ?? '';
          const source = url.searchParams.get('source') ?? '';
          const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
          const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 200));
          const filtered = assets.filter((asset) =>
            (!query || asset.name.toLowerCase().includes(query)) &&
            (!category || asset.category === category) &&
            (!collection || asset.collection === collection) &&
            (!source || asset.source === source));

          res.end(JSON.stringify({ total: filtered.length, offset, limit, assets: publicAssets(filtered.slice(offset, offset + limit)) }));
        })().catch(next);
      });
    },
    async generateBundle() {
      const assets = await scan();
      this.emitFile({
        type: 'asset',
        fileName: 'asset-catalog.json',
        source: JSON.stringify({ ...metadata(assets), assets: publicAssets(assets) }),
      });
    },
    async writeBundle(options) {
      if (!options.dir) return;
      await mirrorPublicDirectory(options.dir);
      for (const asset of await scan()) {
        const target = path.join(options.dir, asset.path.replace(/^\//, ''));
        fs.mkdirSync(path.dirname(target), { recursive: true });
        if (fs.existsSync(target)) continue;
        try {
          fs.linkSync(asset.filePath, target);
        } catch {
          fs.copyFileSync(asset.filePath, target);
        }
      }
    },
  };
}

export default defineConfig(({ command, mode }) => {
  // Development keeps the complete searchable library. Normal production
  // builds include only the Fiorwoods assets used at runtime; opt into the
  // complete editor library with `npm run build:full-assets`.
  const includeFullStyleLibrary = command === 'serve' || mode === 'full-assets';

  return {
    // Vite eagerly indexes every file under public/ on the first request. The
    // editor library contains over 135k PNGs, so assets are served/mirrored on
    // demand by the catalog plugin instead.
    publicDir: false,
    plugins: [styleAssetCatalogPlugin(path.resolve(__dirname, 'public'), includeFullStyleLibrary)],
    // ── Resolve ───────────────────────────────────────────────────────────────
    resolve: {
      alias: {
        // Allow clean imports like `@/systems/input`
        '@': path.resolve(__dirname, 'src'),
        // Resolve shared package to TypeScript source so Vite can bundle it
        // directly without needing a pre-build step for the shared package.
        '@labyrinth/shared': path.resolve(__dirname, '../shared/src/index.ts'),
      },
    },

    // ── JSON & Asset Handling ─────────────────────────────────────────────────
    // Treat Tiled tilemap files (.tmj) as importable JSON assets.
    // Usage: `import mapData from '../tilemaps/level1.tmj'`
    // Vite will inline them into the JS bundle (sync, no fetch required).
    assetsInclude: ['**/*.tmj'],

    // ── Dev Server ────────────────────────────────────────────────────────────
    server: {
      port: 5173,
      host: true, // Listen on all interfaces (including LAN/IPv4)
      watch: {
        // These files are an immutable source library, not authored modules.
        // Watching the full PNG library stalls Vite's request loop on Windows.
        ignored: ['**/public/assets/**', '**/public/tilesets/**'],
      },
    },

    // ── Build ─────────────────────────────────────────────────────────────────
    build: {
      target: 'es2022',
      outDir: 'dist',
      sourcemap: true,
      rollupOptions: {
        input: {
          game: path.resolve(__dirname, 'index.html'),
          ...(includeFullStyleLibrary
            ? { styleEditor: path.resolve(__dirname, 'style-editor.html') }
            : {}),
        },
      },
    },
  };
});
