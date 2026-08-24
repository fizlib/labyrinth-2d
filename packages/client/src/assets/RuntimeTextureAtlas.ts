import { Assets, Rectangle, Texture } from 'pixi.js';
import { RUNTIME_ATLAS_FRAMES, RUNTIME_ATLAS_PATH } from './runtimeAtlasManifest';
import { normalizeRuntimeAtlasAssetPath } from './runtimeAtlasPaths';

type RuntimeAtlasAssetPath = keyof typeof RUNTIME_ATLAS_FRAMES;

let atlasTexturePromise: Promise<Texture> | null = null;
let reportedAtlasFailure = false;
const textureCache = new Map<RuntimeAtlasAssetPath, Texture>();
const reportedMissingFrames = new Set<string>();

function loadAtlasTexture(): Promise<Texture> {
  atlasTexturePromise ??= Assets.load<Texture>(RUNTIME_ATLAS_PATH).then((texture) => {
    texture.source.scaleMode = 'nearest';
    return texture;
  });
  return atlasTexturePromise;
}

function isRuntimeAtlasAssetPath(assetPath: string): assetPath is RuntimeAtlasAssetPath {
  return Object.prototype.hasOwnProperty.call(RUNTIME_ATLAS_FRAMES, assetPath);
}

async function loadLegacyTexture(assetPath: string, reason: unknown): Promise<Texture> {
  if (!reportedAtlasFailure) {
    reportedAtlasFailure = true;
    console.warn(
      '[Assets] Runtime atlas unavailable; falling back to individual sprite requests',
      reason,
    );
  }
  const texture = await Assets.load<Texture>(assetPath);
  texture.source.scaleMode = 'nearest';
  return texture;
}

/** Load one original asset path as a view into the shared runtime atlas. */
export async function loadRuntimeAtlasTexture(assetPath: string): Promise<Texture> {
  const normalizedPath = normalizeRuntimeAtlasAssetPath(assetPath);
  if (!isRuntimeAtlasAssetPath(normalizedPath)) {
    if (!reportedMissingFrames.has(normalizedPath)) {
      reportedMissingFrames.add(normalizedPath);
      console.warn(`[Assets] Runtime atlas has no frame for ${normalizedPath}`);
    }
    return loadLegacyTexture(
      assetPath,
      new Error(`Missing atlas frame: ${normalizedPath}`),
    );
  }

  const cached = textureCache.get(normalizedPath);
  if (cached) return cached;

  let atlas: Texture;
  try {
    atlas = await loadAtlasTexture();
  } catch (error) {
    return loadLegacyTexture(assetPath, error);
  }

  const [x, y, width, height] = RUNTIME_ATLAS_FRAMES[normalizedPath];
  const texture = new Texture({
    source: atlas.source,
    frame: new Rectangle(atlas.frame.x + x, atlas.frame.y + y, width, height),
  });
  textureCache.set(normalizedPath, texture);
  return texture;
}

/** Slice a frame relative to a texture, including when that texture is atlased. */
export function createRelativeTexture(
  parent: Texture,
  x: number,
  y: number,
  width: number,
  height: number,
): Texture {
  if (x < 0 || y < 0 || x + width > parent.width || y + height > parent.height) {
    throw new RangeError(
      `Texture slice ${x},${y} ${width}x${height} exceeds ${parent.width}x${parent.height}`,
    );
  }
  return new Texture({
    source: parent.source,
    frame: new Rectangle(parent.frame.x + x, parent.frame.y + y, width, height),
  });
}
