import type { AssetCatalogEntry, AssetCatalogMeta, AssetCatalogPage } from './types';

export interface CatalogQuery {
  q: string;
  category: string;
  collection: string;
  source: string;
  offset: number;
  limit: number;
}

interface StaticCatalog extends AssetCatalogMeta {
  assets: AssetCatalogEntry[];
}

let staticCatalogPromise: Promise<StaticCatalog> | null = null;

function loadStaticCatalog(): Promise<StaticCatalog> {
  staticCatalogPromise ??= fetch('/asset-catalog.json').then((response) => {
    if (!response.ok) throw new Error(`Asset catalog failed: ${response.status}`);
    return response.json() as Promise<StaticCatalog>;
  });
  return staticCatalogPromise;
}

export async function loadCatalogMeta(): Promise<AssetCatalogMeta> {
  if (!import.meta.env.DEV) {
    const { total, categories, collections, sources } = await loadStaticCatalog();
    return { total, categories, collections, sources };
  }
  const response = await fetch('/__style-assets/meta');
  if (!response.ok) throw new Error(`Asset metadata failed: ${response.status}`);
  return response.json() as Promise<AssetCatalogMeta>;
}

export async function loadCatalogPage(query: CatalogQuery): Promise<AssetCatalogPage> {
  if (import.meta.env.DEV) {
    const params = new URLSearchParams({
      q: query.q,
      category: query.category,
      collection: query.collection,
      source: query.source,
      offset: String(query.offset),
      limit: String(query.limit),
    });
    const response = await fetch(`/__style-assets?${params}`);
    if (!response.ok) throw new Error(`Asset search failed: ${response.status}`);
    return response.json() as Promise<AssetCatalogPage>;
  }

  const catalog = await loadStaticCatalog();
  const needle = query.q.trim().toLowerCase();
  const filtered = catalog.assets.filter((asset) =>
    (!needle || asset.name.toLowerCase().includes(needle)) &&
    (!query.category || asset.category === query.category) &&
    (!query.collection || asset.collection === query.collection) &&
    (!query.source || asset.source === query.source));
  return {
    total: filtered.length,
    offset: query.offset,
    limit: query.limit,
    assets: filtered.slice(query.offset, query.offset + query.limit),
  };
}
