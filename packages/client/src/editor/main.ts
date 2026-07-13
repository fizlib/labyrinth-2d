import {
  Application,
  Assets,
  Container,
  FederatedPointerEvent,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  Texture,
} from 'pixi.js';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { loadCatalogMeta, loadCatalogPage, type CatalogQuery } from './assetCatalog';
import { createSampleDocument } from './sampleScene';
import {
  SEMANTIC_ROLES,
  type AssetCatalogEntry,
  type EditorCollider,
  type EditorElement,
  type EditorTool,
  type SemanticRole,
  type StyleEditorDocumentV1,
} from './types';

const STORAGE_KEY = 'labyrinth-style-editor-v1-topology-atlas-r14';
const STORAGE_ARCHIVE_PREFIX = 'zip-base64:';
const PAGE_SIZE = 200;
const HISTORY_LIMIT = 20;
let fallbackIdSequence = 0;

function createEditorId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  fallbackIdSequence += 1;
  const randomValues = new Uint32Array(2);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(randomValues);
  } else {
    randomValues[0] = Math.floor(Math.random() * 0xffffffff);
    randomValues[1] = Math.floor(Math.random() * 0xffffffff);
  }
  return `editor-${Date.now().toString(36)}-${fallbackIdSequence.toString(36)}-${Array.from(randomValues, (value) => value.toString(36)).join('-')}`;
}

function required<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing editor element #${id}`);
  return element as T;
}

const host = required<HTMLDivElement>('canvas-host');
const saveStatus = required<HTMLSpanElement>('save-status');
const assetGrid = required<HTMLDivElement>('asset-grid');
const assetTotal = required<HTMLSpanElement>('asset-total');
const assetPageLabel = required<HTMLSpanElement>('asset-page');
const assetSearch = required<HTMLInputElement>('asset-search');
const assetSource = required<HTMLSelectElement>('asset-source');
const assetCategory = required<HTMLSelectElement>('asset-category');
const assetCollection = required<HTMLInputElement>('asset-collection');
const assetCollections = required<HTMLDataListElement>('asset-collections');
const selectedAssetView = required<HTMLDivElement>('selected-asset');
const replaceAssetButton = required<HTMLButtonElement>('replace-asset');
const addAssetButton = required<HTMLButtonElement>('add-asset');
const previousAssetsButton = required<HTMLButtonElement>('asset-prev');
const nextAssetsButton = required<HTMLButtonElement>('asset-next');
const elementInspector = required<HTMLDivElement>('element-inspector');
const colliderInspector = required<HTMLDivElement>('collider-inspector');
const selectionKind = required<HTMLSpanElement>('selection-kind');
const layerList = required<HTMLDivElement>('layer-list');
const layerSearch = required<HTMLInputElement>('layer-search');
const zoomReadout = required<HTMLSpanElement>('zoom-readout');
const snapSizeSelect = required<HTMLSelectElement>('snap-size');
const showCollidersCheckbox = required<HTMLInputElement>('show-colliders');
const notesField = required<HTMLTextAreaElement>('style-notes');
const undoButton = required<HTMLButtonElement>('undo');
const redoButton = required<HTMLButtonElement>('redo');

const app = new Application();
await app.init({
  resizeTo: host,
  antialias: false,
  roundPixels: true,
  resolution: 1,
  backgroundColor: 0x080b11,
});
host.appendChild(app.canvas);
app.stage.eventMode = 'static';
app.stage.hitArea = app.screen;

const world = new Container();
const sceneLayer = new Container();
const colliderLayer = new Container();
const overlayLayer = new Container();
sceneLayer.sortableChildren = true;
world.addChild(sceneLayer, colliderLayer, overlayLayer);
app.stage.addChild(world);

const selectionFrame = new Graphics();
const resizeHandle = new Graphics().rect(-3, -3, 6, 6).fill({ color: 0xffdf68, alpha: 0.5 }).stroke({ color: 0x18120a, width: 0.5, alpha: 0.5 });
const selectionLabel = new Text({ text: '', style: { fill: 0xfff1a8, fontSize: 12, fontFamily: 'Consolas' } });
resizeHandle.eventMode = 'static';
resizeHandle.cursor = 'nwse-resize';
overlayLayer.addChild(selectionFrame, selectionLabel, resizeHandle);

const restoredLocalDocument = loadLocalDocument();
let documentState = restoredLocalDocument ?? createSampleDocument();
const selectedElementIds = new Set<string>();
const selectedColliderIds = new Set<string>();
let selectedAsset: AssetCatalogEntry | null = null;
let currentTool: EditorTool = 'select';
let currentSnap = 1;
let renderGeneration = 0;
let saveTimer: number | null = null;
let shiftHeld = false;
const spriteById = new Map<string, Sprite>();
const colliderGraphicById = new Map<string, Graphics>();
let framedTextures: Texture[] = [];

const history: string[] = [JSON.stringify(documentState)];
let historyIndex = 0;

interface InteractionState {
  kind: 'element-move' | 'element-resize' | 'collider-move' | 'collider-resize' | 'pan';
  startGlobalX: number;
  startGlobalY: number;
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
  /** Start positions for all selected items during multi-move */
  startPositions: Map<string, { x: number; y: number }>;
}
let interaction: InteractionState | null = null;

interface ClipboardData {
  elements: EditorElement[];
  colliders: EditorCollider[];
}
let clipboard: ClipboardData | null = null;

const catalogQuery: CatalogQuery = { q: '', category: '', collection: '', source: '', offset: 0, limit: PAGE_SIZE };
let catalogResultTotal = 0;
let catalogRequest = 0;

function loadLocalDocument(): StyleEditorDocumentV1 | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    let json = raw;
    if (raw.startsWith(STORAGE_ARCHIVE_PREFIX)) {
      const binary = atob(raw.slice(STORAGE_ARCHIVE_PREFIX.length));
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      const files = unzipSync(bytes);
      const documentBytes = files['document.json'];
      if (!documentBytes) return null;
      json = strFromU8(documentBytes);
    }
    const parsed = JSON.parse(json) as StyleEditorDocumentV1;
    return parsed.version === 1 ? parsed : null;
  } catch {
    return null;
  }
}

function saveLocalDocument(): boolean {
  try {
    const archive = zipSync({
      'document.json': strToU8(JSON.stringify(documentState)),
    }, { level: 1 });
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < archive.length; offset += chunkSize) {
      binary += String.fromCharCode(...archive.subarray(offset, offset + chunkSize));
    }
    localStorage.setItem(STORAGE_KEY, `${STORAGE_ARCHIVE_PREFIX}${btoa(binary)}`);
    return true;
  } catch (error) {
    console.error('[StyleEditor] Local autosave failed', error);
    return false;
  }
}

/** Returns the single selected element when exactly one is selected, or null otherwise. */
function selectedElement(): EditorElement | null {
  if (selectedElementIds.size !== 1) return null;
  const id = selectedElementIds.values().next().value as string;
  return documentState.elements.find((element) => element.id === id) ?? null;
}

/** Returns the single selected collider when exactly one is selected, or null otherwise. */
function selectedCollider(): EditorCollider | null {
  if (selectedColliderIds.size !== 1) return null;
  const id = selectedColliderIds.values().next().value as string;
  return documentState.colliders.find((collider) => collider.id === id) ?? null;
}

function selectedElements(): EditorElement[] {
  return documentState.elements.filter((element) => selectedElementIds.has(element.id));
}

function selectedColliders(): EditorCollider[] {
  return documentState.colliders.filter((collider) => selectedColliderIds.has(collider.id));
}

function snap(value: number, size = currentSnap): number {
  return Math.round(value / size) * size;
}

function scheduleAutosave(): void {
  saveStatus.textContent = 'Unsaved changes…';
  if (saveTimer !== null) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    documentState.updatedAt = new Date().toISOString();
    saveStatus.textContent = saveLocalDocument()
      ? 'Autosaved locally'
      : 'Autosave unavailable — use Save JSON + Preview';
    saveTimer = null;
  }, 350);
}

function commitHistory(): void {
  documentState.updatedAt = new Date().toISOString();
  const snapshot = JSON.stringify(documentState);
  if (history[historyIndex] === snapshot) return;
  history.splice(historyIndex + 1);
  history.push(snapshot);
  // The topology atlas is much larger than the former one-cell sample, so a
  // bounded history avoids retaining hundreds of megabytes after long edits.
  if (history.length > HISTORY_LIMIT) history.shift();
  historyIndex = history.length - 1;
  scheduleAutosave();
  updateHistoryButtons();
  renderInspector();
  renderLayers();
}

function restoreHistory(index: number): void {
  if (index < 0 || index >= history.length) return;
  historyIndex = index;
  documentState = JSON.parse(history[index]) as StyleEditorDocumentV1;
  selectedElementIds.clear();
  selectedColliderIds.clear();
  void rebuildScene();
  scheduleAutosave();
  updateHistoryButtons();
}

function updateHistoryButtons(): void {
  undoButton.disabled = historyIndex <= 0;
  redoButton.disabled = historyIndex >= history.length - 1;
}

function applyElementToSprite(element: EditorElement, sprite: Sprite): void {
  sprite.anchor.set(0.5);
  sprite.position.set(element.x + element.width / 2, element.y + element.height / 2);
  sprite.width = Math.max(1, Math.abs(element.width));
  sprite.height = Math.max(1, Math.abs(element.height));
  sprite.scale.x = Math.abs(sprite.scale.x) * (element.flipX ? -1 : 1);
  sprite.scale.y = Math.abs(sprite.scale.y) * (element.flipY ? -1 : 1);
  sprite.alpha = element.opacity;
  sprite.visible = element.visible;
  sprite.zIndex = element.zIndex;
}

async function textureFor(path: string): Promise<Texture> {
  try {
    const texture = await Assets.load<Texture>(path);
    texture.source.scaleMode = 'nearest';
    return texture;
  } catch {
    return Texture.WHITE;
  }
}

async function rebuildScene(): Promise<void> {
  const generation = ++renderGeneration;
  const uniquePaths = [...new Set(documentState.elements.map((element) => element.assetPath))];
  const textures = new Map<string, Texture>();
  await Promise.all(uniquePaths.map(async (path) => textures.set(path, await textureFor(path))));
  if (generation !== renderGeneration) return;

  for (const child of sceneLayer.removeChildren()) child.destroy();
  for (const texture of framedTextures) texture.destroy(false);
  framedTextures = [];
  spriteById.clear();
  const sorted = [...documentState.elements].sort((a, b) => a.zIndex - b.zIndex || a.id.localeCompare(b.id));
  for (const element of sorted) {
    const baseTexture = textures.get(element.assetPath) ?? Texture.WHITE;
    let spriteTexture = baseTexture;
    if (element.sourceRect && baseTexture !== Texture.WHITE) {
      const frame = element.sourceRect;
      spriteTexture = new Texture({
        source: baseTexture.source,
        frame: new Rectangle(frame.x, frame.y, frame.width, frame.height),
      });
      framedTextures.push(spriteTexture);
    }
    const sprite = new Sprite(spriteTexture);
    sprite.label = element.name;
    sprite.eventMode = 'static';
    sprite.cursor = 'pointer';
    applyElementToSprite(element, sprite);
    sprite.on('pointerdown', (event: FederatedPointerEvent) => onElementPointerDown(event, element.id));
    sceneLayer.addChild(sprite);
    spriteById.set(element.id, sprite);
  }
  rebuildColliders();
  updateSelectionOverlay();
  renderInspector();
  renderLayers();
}

function rebuildColliders(): void {
  for (const child of colliderLayer.removeChildren()) child.destroy();
  colliderGraphicById.clear();
  for (const collider of documentState.colliders) {
    if (!collider.enabled) continue;
    const selected = selectedColliderIds.has(collider.id);
    const graphic = new Graphics()
      .rect(collider.x, collider.y, collider.width, collider.height)
      .fill({ color: selected ? 0xff9f2f : 0xff2222, alpha: selected ? 0.12 : 0.035 })
      .stroke({ color: selected ? 0xffa73d : 0xff3333, width: selected ? 2 : 1 });
    graphic.eventMode = 'static';
    graphic.cursor = 'move';
    graphic.on('pointerdown', (event: FederatedPointerEvent) => onColliderPointerDown(event, collider.id));
    colliderLayer.addChild(graphic);
    colliderGraphicById.set(collider.id, graphic);
  }
  colliderLayer.visible = showCollidersCheckbox.checked;
}

function setSelection(elementId: string | null, colliderId: string | null): void {
  selectedElementIds.clear();
  selectedColliderIds.clear();
  if (elementId) selectedElementIds.add(elementId);
  if (colliderId) selectedColliderIds.add(colliderId);
  rebuildColliders();
  updateSelectionOverlay();
  renderInspector();
  renderLayers();
}

function addToSelection(elementId: string | null, colliderId: string | null): void {
  if (elementId) {
    if (selectedElementIds.has(elementId)) selectedElementIds.delete(elementId);
    else selectedElementIds.add(elementId);
  }
  if (colliderId) {
    if (selectedColliderIds.has(colliderId)) selectedColliderIds.delete(colliderId);
    else selectedColliderIds.add(colliderId);
  }
  rebuildColliders();
  updateSelectionOverlay();
  renderInspector();
  renderLayers();
}

function updateSelectionOverlay(): void {
  selectionFrame.clear();

  if (shiftHeld) {
    resizeHandle.visible = selectionLabel.visible = selectionFrame.visible = false;
    return;
  }

  const elements = selectedElements();
  const colliders = selectedColliders();
  const totalCount = elements.length + colliders.length;

  if (totalCount === 0) {
    resizeHandle.visible = selectionLabel.visible = selectionFrame.visible = false;
    return;
  }

  // Compute bounding box across all selected items
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const el of elements) {
    minX = Math.min(minX, el.x);
    minY = Math.min(minY, el.y);
    maxX = Math.max(maxX, el.x + el.width);
    maxY = Math.max(maxY, el.y + el.height);
  }
  for (const col of colliders) {
    minX = Math.min(minX, col.x);
    minY = Math.min(minY, col.y);
    maxX = Math.max(maxX, col.x + col.width);
    maxY = Math.max(maxY, col.y + col.height);
  }

  const isMulti = totalCount > 1;
  const color = colliders.length > 0 && elements.length === 0 ? 0xffa73d : 0xffdf68;
  selectionFrame.rect(minX, minY, maxX - minX, maxY - minY).stroke({ color, width: 1, alpha: 0.6 });

  // Draw individual frames for each item in multi-select
  if (isMulti) {
    for (const el of elements) {
      selectionFrame.rect(el.x, el.y, el.width, el.height).stroke({ color: 0xffdf68, width: 0.5, alpha: 0.35 });
    }
    for (const col of colliders) {
      selectionFrame.rect(col.x, col.y, col.width, col.height).stroke({ color: 0xffa73d, width: 0.5, alpha: 0.35 });
    }
  }

  if (isMulti) {
    selectionLabel.text = `${totalCount} items selected`;
    selectionLabel.position.set(minX, Math.max(0, minY - 18));
    resizeHandle.visible = false;
    selectionLabel.visible = selectionFrame.visible = true;
  } else if (elements.length === 1) {
    const element = elements[0];
    resizeHandle.position.set(element.x + element.width, element.y + element.height);
    selectionLabel.text = `${Math.round(element.width)}×${Math.round(element.height)} px`;
    selectionLabel.position.set(element.x, Math.max(0, element.y - 18));
    resizeHandle.visible = selectionLabel.visible = selectionFrame.visible = true;
  } else {
    const collider = colliders[0];
    resizeHandle.position.set(collider.x + collider.width, collider.y + collider.height);
    selectionLabel.text = `Collider ${Math.round(collider.width)}×${Math.round(collider.height)} px`;
    selectionLabel.position.set(collider.x, Math.max(0, collider.y - 18));
    resizeHandle.visible = selectionLabel.visible = selectionFrame.visible = true;
  }
}

function worldPoint(event: FederatedPointerEvent): { x: number; y: number } {
  return world.toLocal(event.global);
}

function startPan(event: FederatedPointerEvent): void {
  event.stopPropagation();
  interaction = {
    kind: 'pan', startGlobalX: event.global.x, startGlobalY: event.global.y,
    startX: world.x, startY: world.y, startWidth: 0, startHeight: 0,
    startPositions: new Map(),
  };
}

function onElementPointerDown(event: FederatedPointerEvent, id: string): void {
  if (event.button === 2) {
    startPan(event);
    return;
  }
  if (currentTool === 'erase') {
    event.stopPropagation();
    removeElement(id);
    return;
  }
  if (currentTool === 'paint') {
    event.stopPropagation();
    paintAt(worldPoint(event));
    return;
  }
  if (currentTool === 'add') {
    event.stopPropagation();
    addSelectedAssetAt(worldPoint(event));
    return;
  }
  if (currentTool !== 'select') return;
  event.stopPropagation();

  // If the clicked element is not selected but a selected element exists under the cursor,
  // prefer the selected element so that dragging an already-selected item isn't hijacked
  // by an overlapping background element.
  let effectiveId = id;
  if (!selectedElementIds.has(id) && !(event.ctrlKey || event.metaKey) && selectedElementIds.size > 0) {
    const point = worldPoint(event);
    for (const selId of selectedElementIds) {
      const el = documentState.elements.find((e) => e.id === selId);
      if (el && point.x >= el.x && point.x <= el.x + el.width && point.y >= el.y && point.y <= el.y + el.height) {
        effectiveId = selId;
        break;
      }
    }
  }

  if (event.ctrlKey || event.metaKey) {
    addToSelection(effectiveId, null);
  } else if (!selectedElementIds.has(effectiveId)) {
    setSelection(effectiveId, null);
  }

  // Build start positions for all selected elements
  const startPositions = new Map<string, { x: number; y: number }>();
  for (const elId of selectedElementIds) {
    const el = documentState.elements.find((e) => e.id === elId);
    if (el) startPositions.set(elId, { x: el.x, y: el.y });
  }

  const clickedElement = documentState.elements.find((e) => e.id === effectiveId);
  if (!clickedElement) return;
  interaction = {
    kind: 'element-move', startGlobalX: event.global.x, startGlobalY: event.global.y,
    startX: clickedElement.x, startY: clickedElement.y, startWidth: clickedElement.width, startHeight: clickedElement.height,
    startPositions,
  };
}

function onColliderPointerDown(event: FederatedPointerEvent, id: string): void {
  if (event.button === 2) {
    startPan(event);
    return;
  }
  if (currentTool === 'erase') {
    event.stopPropagation();
    documentState.colliders = documentState.colliders.filter((collider) => collider.id !== id);
    setSelection(null, null);
    commitHistory();
    return;
  }
  if (currentTool !== 'select' && currentTool !== 'collider') return;
  event.stopPropagation();

  if (event.ctrlKey || event.metaKey) {
    addToSelection(null, id);
  } else if (!selectedColliderIds.has(id)) {
    setSelection(null, id);
  }

  // Build start positions for all selected colliders
  const startPositions = new Map<string, { x: number; y: number }>();
  for (const colId of selectedColliderIds) {
    const col = documentState.colliders.find((c) => c.id === colId);
    if (col) startPositions.set(colId, { x: col.x, y: col.y });
  }

  const clickedCollider = documentState.colliders.find((c) => c.id === id);
  if (!clickedCollider) return;
  interaction = {
    kind: 'collider-move', startGlobalX: event.global.x, startGlobalY: event.global.y,
    startX: clickedCollider.x, startY: clickedCollider.y, startWidth: clickedCollider.width, startHeight: clickedCollider.height,
    startPositions,
  };
}

resizeHandle.on('pointerdown', (event: FederatedPointerEvent) => {
  if (event.button === 2) {
    startPan(event);
    return;
  }
  event.stopPropagation();
  const element = selectedElement();
  const collider = selectedCollider();
  if (element) {
    interaction = {
      kind: 'element-resize', startGlobalX: event.global.x, startGlobalY: event.global.y,
      startX: element.x, startY: element.y, startWidth: element.width, startHeight: element.height,
      startPositions: new Map(),
    };
  } else if (collider) {
    interaction = {
      kind: 'collider-resize', startGlobalX: event.global.x, startGlobalY: event.global.y,
      startX: collider.x, startY: collider.y, startWidth: collider.width, startHeight: collider.height,
      startPositions: new Map(),
    };
  }
});

app.stage.on('pointerdown', (event: FederatedPointerEvent) => {
  host.focus();
  if (event.button === 1 || event.button === 2 || currentTool === 'pan') {
    startPan(event);
    return;
  }
  const point = worldPoint(event);
  if (currentTool === 'add') addSelectedAssetAt(point);
  else if (currentTool === 'paint') paintAt(point);
  else if (currentTool === 'collider') addColliderAt(point);
  else if (currentTool === 'select') setSelection(null, null);
});

app.stage.on('pointermove', (event: FederatedPointerEvent) => {
  if (!interaction) return;
  const dx = (event.global.x - interaction.startGlobalX) / world.scale.x;
  const dy = (event.global.y - interaction.startGlobalY) / world.scale.y;
  if (interaction.kind === 'pan') {
    world.position.set(interaction.startX + event.global.x - interaction.startGlobalX, interaction.startY + event.global.y - interaction.startGlobalY);
    return;
  }
  if (interaction.kind === 'element-move') {
    // Move all selected elements
    for (const [elId, startPos] of interaction.startPositions) {
      const el = documentState.elements.find((e) => e.id === elId);
      if (!el) continue;
      el.x = snap(startPos.x + dx);
      el.y = snap(startPos.y + dy);
      const sprite = spriteById.get(el.id);
      if (sprite) applyElementToSprite(el, sprite);
    }
  } else if (interaction.kind === 'element-resize') {
    const element = selectedElement();
    if (element) {
      element.width = Math.max(1, snap(interaction.startWidth + dx));
      element.height = Math.max(1, snap(interaction.startHeight + dy));
      const sprite = spriteById.get(element.id);
      if (sprite) applyElementToSprite(element, sprite);
    }
  } else if (interaction.kind === 'collider-move') {
    // Move all selected colliders
    for (const [colId, startPos] of interaction.startPositions) {
      const col = documentState.colliders.find((c) => c.id === colId);
      if (!col) continue;
      col.x = snap(startPos.x + dx);
      col.y = snap(startPos.y + dy);
    }
    rebuildColliders();
  } else if (interaction.kind === 'collider-resize') {
    const collider = selectedCollider();
    if (collider) {
      collider.width = Math.max(1, snap(interaction.startWidth + dx));
      collider.height = Math.max(1, snap(interaction.startHeight + dy));
      rebuildColliders();
    }
  }
  updateSelectionOverlay();
  renderInspector();
});

const finishInteraction = (): void => {
  if (!interaction) return;
  const shouldCommit = interaction.kind !== 'pan';
  interaction = null;
  if (shouldCommit) commitHistory();
  updateSelectionOverlay();
};
app.stage.on('pointerup', finishInteraction);
app.stage.on('pointerupoutside', finishInteraction);
host.addEventListener('contextmenu', (event) => event.preventDefault());

function inferredRole(asset: AssetCatalogEntry): SemanticRole {
  if (asset.category === 'Trees') return 'tree.small';
  if (asset.category === 'Bushes & Plants') return 'bush';
  if (asset.category === 'Shadows') return 'shadow';
  if (asset.category === 'Gates & Doors') return 'gate';
  if (asset.category === 'Terrain') return 'ground.grass';
  return 'decoration';
}

function addSelectedAssetAt(point: { x: number; y: number }): void {
  if (!selectedAsset) return;
  const width = Math.max(1, selectedAsset.width || 32);
  const height = Math.max(1, selectedAsset.height || 32);
  const role = inferredRole(selectedAsset);
  const x = currentTool === 'paint' ? snap(point.x, 16) : snap(point.x - width / 2);
  const y = currentTool === 'paint' ? snap(point.y, 16) : snap(point.y - height / 2);
  const element: EditorElement = {
    id: createEditorId(), name: selectedAsset.name, role, assetPath: selectedAsset.path,
    nativeWidth: selectedAsset.width, nativeHeight: selectedAsset.height,
    x, y, width: currentTool === 'paint' ? 16 : width, height: currentTool === 'paint' ? 16 : height,
    zIndex: role.startsWith('ground.') ? 0 : 500, opacity: 1, flipX: false, flipY: false, visible: true,
  };
  documentState.elements.push(element);
  setSelection(element.id, null);
  commitHistory();
  void rebuildScene();
}

function paintAt(point: { x: number; y: number }): void {
  if (!selectedAsset) return;
  const x = snap(point.x, 16);
  const y = snap(point.y, 16);
  const existing = documentState.elements.find((element) =>
    element.role.startsWith('ground.') && element.x === x && element.y === y && element.width === 16 && element.height === 16);
  if (existing) {
    existing.assetPath = selectedAsset.path;
    delete existing.sourceRect;
    existing.name = selectedAsset.name;
    existing.nativeWidth = selectedAsset.width;
    existing.nativeHeight = selectedAsset.height;
    setSelection(existing.id, null);
    commitHistory();
    void rebuildScene();
  } else {
    addSelectedAssetAt({ x, y });
  }
}

function addColliderAt(point: { x: number; y: number }): void {
  const owner = selectedElement();
  const collider: EditorCollider = {
    id: createEditorId(), name: 'New collider', ownerId: owner?.id ?? null,
    ownerRole: owner?.role ?? 'freeform', x: snap(point.x, 16), y: snap(point.y, 16), width: 16, height: 16, enabled: true,
  };
  documentState.colliders.push(collider);
  setSelection(null, collider.id);
  commitHistory();
}

function removeElement(id: string): void {
  documentState.elements = documentState.elements.filter((element) => element.id !== id);
  documentState.colliders = documentState.colliders.filter((collider) => collider.ownerId !== id);
  selectedElementIds.delete(id);
  commitHistory();
  void rebuildScene();
}

function deleteSelection(): void {
  const elements = selectedElements();
  const colliders = selectedColliders();
  if (elements.length === 0 && colliders.length === 0) return;

  const elementIdsToRemove = new Set(elements.map((el) => el.id));
  documentState.elements = documentState.elements.filter((el) => !elementIdsToRemove.has(el.id));
  // Also remove colliders owned by the deleted elements
  documentState.colliders = documentState.colliders.filter((col) => !elementIdsToRemove.has(col.ownerId ?? ''));

  const colliderIdsToRemove = new Set(colliders.map((col) => col.id));
  documentState.colliders = documentState.colliders.filter((col) => !colliderIdsToRemove.has(col.id));

  setSelection(null, null);
  commitHistory();
  void rebuildScene();
}

function duplicateSelection(): void {
  const elements = selectedElements();
  const colliders = selectedColliders();
  if (elements.length === 0 && colliders.length === 0) return;

  const offset = currentSnap * 4;
  const newElementIds = new Set<string>();
  const newColliderIds = new Set<string>();

  for (const element of elements) {
    const copy = { ...element, id: createEditorId(), name: `${element.name} copy`, x: element.x + offset, y: element.y + offset };
    documentState.elements.push(copy);
    newElementIds.add(copy.id);
  }
  for (const collider of colliders) {
    const copy = { ...collider, id: createEditorId(), name: `${collider.name} copy`, x: collider.x + offset, y: collider.y + offset };
    documentState.colliders.push(copy);
    newColliderIds.add(copy.id);
  }

  selectedElementIds.clear();
  selectedColliderIds.clear();
  for (const id of newElementIds) selectedElementIds.add(id);
  for (const id of newColliderIds) selectedColliderIds.add(id);

  rebuildColliders();
  updateSelectionOverlay();
  renderInspector();
  renderLayers();
  commitHistory();
  void rebuildScene();
}

function copySelection(): void {
  const elements = selectedElements();
  const colliders = selectedColliders();
  if (elements.length === 0 && colliders.length === 0) return;
  clipboard = {
    elements: elements.map((el) => ({ ...el })),
    colliders: colliders.map((col) => ({ ...col })),
  };
}

function pasteClipboard(): void {
  if (!clipboard || (clipboard.elements.length === 0 && clipboard.colliders.length === 0)) return;

  const offset = currentSnap * 4;
  const newElementIds = new Set<string>();
  const newColliderIds = new Set<string>();
  const oldToNewId = new Map<string, string>();

  for (const element of clipboard.elements) {
    const newId = createEditorId();
    oldToNewId.set(element.id, newId);
    const copy = { ...element, id: newId, x: element.x + offset, y: element.y + offset };
    documentState.elements.push(copy);
    newElementIds.add(newId);
  }
  for (const collider of clipboard.colliders) {
    const newId = createEditorId();
    // Remap ownerId if it was part of the pasted set
    const newOwnerId = collider.ownerId ? (oldToNewId.get(collider.ownerId) ?? collider.ownerId) : null;
    const copy = { ...collider, id: newId, ownerId: newOwnerId, x: collider.x + offset, y: collider.y + offset };
    documentState.colliders.push(copy);
    newColliderIds.add(newId);
  }

  selectedElementIds.clear();
  selectedColliderIds.clear();
  for (const id of newElementIds) selectedElementIds.add(id);
  for (const id of newColliderIds) selectedColliderIds.add(id);

  rebuildColliders();
  updateSelectionOverlay();
  renderInspector();
  renderLayers();
  commitHistory();
  void rebuildScene();
}

function replaceSelectedAsset(): void {
  const element = selectedElement();
  if (!element || !selectedAsset) return;
  element.assetPath = selectedAsset.path;
  delete element.sourceRect;
  element.nativeWidth = selectedAsset.width;
  element.nativeHeight = selectedAsset.height;
  element.name = selectedAsset.name;
  commitHistory();
  void rebuildScene();
}

function fitWorld(): void {
  const scale = Math.min(host.clientWidth / documentState.sample.width, host.clientHeight / documentState.sample.height) * 0.92;
  world.scale.set(Math.max(0.1, Math.min(3, scale)));
  world.position.set(
    (host.clientWidth - documentState.sample.width * world.scale.x) / 2,
    (host.clientHeight - documentState.sample.height * world.scale.y) / 2,
  );
  updateZoomReadout();
}

function updateZoomReadout(): void {
  zoomReadout.textContent = `${Math.round(world.scale.x * 100)}%`;
}

host.addEventListener('wheel', (event) => {
  event.preventDefault();
  const rect = host.getBoundingClientRect();
  const global = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  const localBefore = world.toLocal(global);
  const next = Math.max(0.1, Math.min(4, world.scale.x * (event.deltaY < 0 ? 1.12 : 0.89)));
  world.scale.set(next);
  const globalAfter = world.toGlobal(localBefore);
  world.x += global.x - globalAfter.x;
  world.y += global.y - globalAfter.y;
  updateZoomReadout();
}, { passive: false });

function setTool(tool: EditorTool): void {
  currentTool = tool;
  document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((button) => button.classList.toggle('active', button.dataset.tool === tool));
  host.style.cursor = tool === 'pan' ? 'grab' : tool === 'select' ? 'default' : 'crosshair';
}

function renderInspector(): void {
  const element = selectedElement();
  const collider = selectedCollider();
  const totalSelected = selectedElementIds.size + selectedColliderIds.size;
  const isMulti = totalSelected > 1;

  elementInspector.classList.toggle('disabled', !element || isMulti);
  colliderInspector.classList.toggle('disabled', !collider || isMulti);

  if (isMulti) {
    selectionKind.textContent = `${totalSelected} items selected`;
  } else {
    selectionKind.textContent = element ? element.role : collider ? 'Collider' : 'Nothing selected';
  }

  if (element && !isMulti) {
    required<HTMLInputElement>('prop-name').value = element.name;
    required<HTMLSelectElement>('prop-role').value = element.role;
    required<HTMLInputElement>('prop-x').value = String(Math.round(element.x));
    required<HTMLInputElement>('prop-y').value = String(Math.round(element.y));
    required<HTMLInputElement>('prop-width').value = String(Math.round(element.width));
    required<HTMLInputElement>('prop-height').value = String(Math.round(element.height));
    required<HTMLInputElement>('prop-z').value = String(element.zIndex);
    required<HTMLInputElement>('prop-opacity').value = String(element.opacity);
    required<HTMLInputElement>('prop-flip-x').checked = element.flipX;
    required<HTMLInputElement>('prop-flip-y').checked = element.flipY;
    required<HTMLInputElement>('prop-visible').checked = element.visible;
    required<HTMLDivElement>('dimension-readout').textContent = `Native ${element.nativeWidth}×${element.nativeHeight}px · Rendered ${Math.round(element.width)}×${Math.round(element.height)}px · Position ${Math.round(element.x)}, ${Math.round(element.y)}`;
    required<HTMLDivElement>('asset-path-readout').textContent = element.assetPath;
  }
  if (collider && !isMulti) {
    required<HTMLInputElement>('collider-name').value = collider.name;
    required<HTMLInputElement>('collider-role').value = collider.ownerRole;
    required<HTMLInputElement>('collider-x').value = String(Math.round(collider.x));
    required<HTMLInputElement>('collider-y').value = String(Math.round(collider.y));
    required<HTMLInputElement>('collider-width').value = String(Math.round(collider.width));
    required<HTMLInputElement>('collider-height').value = String(Math.round(collider.height));
    required<HTMLInputElement>('collider-enabled').checked = collider.enabled;
  }
}

function renderLayers(): void {
  layerList.replaceChildren();
  const roleCounts = new Map<string, number>();
  for (const element of documentState.elements) {
    const group = element.role.startsWith('ground.') ? 'Ground tiles' : element.role;
    roleCounts.set(group, (roleCounts.get(group) ?? 0) + 1);
  }
  for (const [role, count] of roleCounts) {
    const summary = document.createElement('div');
    summary.className = 'layer-item';
    summary.innerHTML = `<span>${escapeHtml(role)}</span><small>${count}</small>`;
    layerList.appendChild(summary);
  }

  const query = layerSearch.value.trim().toLowerCase();
  const candidates = documentState.elements;
  const matching = query
    ? candidates.filter((element) =>
        `${element.name} ${element.role} ${element.assetPath}`.toLowerCase().includes(query))
    : candidates.filter((element) => selectedElementIds.has(element.id));
  const limit = 250;
  const items = matching
    .sort((a, b) => b.zIndex - a.zIndex || a.name.localeCompare(b.name))
    .slice(0, limit);

  const resultSummary = document.createElement('div');
  resultSummary.className = 'readout';
  if (query) {
    resultSummary.textContent = matching.length > limit
      ? `${matching.length} matches · showing first ${limit}`
      : `${matching.length} matching atlas elements`;
  } else {
    resultSummary.textContent = items.length > 0
      ? 'Selected atlas elements'
      : 'Click an element or filter by hub, gate, button, cell, topology, role, or asset ID.';
  }
  layerList.appendChild(resultSummary);

  for (const element of items) {
    const button = document.createElement('button');
    button.className = `layer-item${selectedElementIds.has(element.id) ? ' selected' : ''}`;
    button.innerHTML = `<span>${escapeHtml(element.name)}</span><small>${element.role} · ${element.zIndex}</small>`;
    button.addEventListener('click', (event) => {
      if (event.ctrlKey || event.metaKey) {
        addToSelection(element.id, null);
      } else {
        setSelection(element.id, null);
      }
    });
    layerList.appendChild(button);
  }
}

function escapeHtml(value: string): string {
  const node = document.createElement('span');
  node.textContent = value;
  return node.innerHTML;
}

function bindElementInspector(): void {
  const roleSelect = required<HTMLSelectElement>('prop-role');
  for (const role of SEMANTIC_ROLES) roleSelect.add(new Option(role, role));

  const numeric = [
    ['prop-x', 'x'], ['prop-y', 'y'], ['prop-width', 'width'], ['prop-height', 'height'],
    ['prop-z', 'zIndex'], ['prop-opacity', 'opacity'],
  ] as const;
  for (const [inputId, key] of numeric) {
    required<HTMLInputElement>(inputId).addEventListener('change', (event) => {
      const element = selectedElement();
      if (!element) return;
      const value = (event.currentTarget as HTMLInputElement).valueAsNumber;
      if (!Number.isFinite(value)) return;
      if (key === 'width' || key === 'height') element[key] = Math.max(1, value);
      else if (key === 'opacity') element.opacity = Math.max(0, Math.min(1, value));
      else element[key] = value;
      const sprite = spriteById.get(element.id);
      if (sprite) applyElementToSprite(element, sprite);
      updateSelectionOverlay();
      commitHistory();
    });
  }
  required<HTMLInputElement>('prop-name').addEventListener('change', (event) => {
    const element = selectedElement(); if (!element) return;
    element.name = (event.currentTarget as HTMLInputElement).value; commitHistory();
  });
  roleSelect.addEventListener('change', () => {
    const element = selectedElement(); if (!element) return;
    element.role = roleSelect.value as SemanticRole; commitHistory();
  });
  for (const [inputId, key] of [['prop-flip-x', 'flipX'], ['prop-flip-y', 'flipY'], ['prop-visible', 'visible']] as const) {
    required<HTMLInputElement>(inputId).addEventListener('change', (event) => {
      const element = selectedElement(); if (!element) return;
      element[key] = (event.currentTarget as HTMLInputElement).checked;
      const sprite = spriteById.get(element.id); if (sprite) applyElementToSprite(element, sprite);
      commitHistory();
    });
  }

  const colliderNumeric = [['collider-x', 'x'], ['collider-y', 'y'], ['collider-width', 'width'], ['collider-height', 'height']] as const;
  for (const [inputId, key] of colliderNumeric) {
    required<HTMLInputElement>(inputId).addEventListener('change', (event) => {
      const collider = selectedCollider(); if (!collider) return;
      const value = (event.currentTarget as HTMLInputElement).valueAsNumber;
      if (!Number.isFinite(value)) return;
      collider[key] = key === 'width' || key === 'height' ? Math.max(1, value) : value;
      rebuildColliders(); updateSelectionOverlay(); commitHistory();
    });
  }
  required<HTMLInputElement>('collider-name').addEventListener('change', (event) => {
    const collider = selectedCollider(); if (!collider) return;
    collider.name = (event.currentTarget as HTMLInputElement).value; commitHistory();
  });
  required<HTMLInputElement>('collider-role').addEventListener('change', (event) => {
    const collider = selectedCollider(); if (!collider) return;
    collider.ownerRole = (event.currentTarget as HTMLInputElement).value as EditorCollider['ownerRole']; commitHistory();
  });
  required<HTMLInputElement>('collider-enabled').addEventListener('change', (event) => {
    const collider = selectedCollider(); if (!collider) return;
    collider.enabled = (event.currentTarget as HTMLInputElement).checked; rebuildColliders(); commitHistory();
  });
}

async function refreshCatalog(): Promise<void> {
  const request = ++catalogRequest;
  assetGrid.innerHTML = '<div class="readout">Loading assets…</div>';
  try {
    const page = await loadCatalogPage(catalogQuery);
    if (request !== catalogRequest) return;
    catalogResultTotal = page.total;
    assetTotal.textContent = `${page.total.toLocaleString()} assets`;
    assetPageLabel.textContent = `Page ${Math.floor(page.offset / PAGE_SIZE) + 1} of ${Math.max(1, Math.ceil(page.total / PAGE_SIZE))}`;
    previousAssetsButton.disabled = page.offset === 0;
    nextAssetsButton.disabled = page.offset + page.limit >= page.total;
    assetGrid.replaceChildren();
    for (const asset of page.assets) {
      const card = document.createElement('button');
      card.className = `asset-card${selectedAsset?.id === asset.id ? ' selected' : ''}`;
      card.title = `${asset.name}\n${asset.collection}\n${asset.width}×${asset.height}px`;
      const image = document.createElement('img');
      image.loading = 'lazy';
      image.src = asset.path;
      image.alt = asset.name;
      const label = document.createElement('span');
      label.textContent = asset.name;
      const meta = document.createElement('small');
      meta.textContent = `${asset.width}×${asset.height} · ${asset.source}`;
      card.append(image, label, meta);
      card.addEventListener('click', () => selectAsset(asset));
      card.addEventListener('dblclick', () => selectedElement() ? replaceSelectedAsset() : addAssetAtViewportCenter());
      assetGrid.appendChild(card);
    }
  } catch (error) {
    assetGrid.innerHTML = `<div class="readout">${escapeHtml(error instanceof Error ? error.message : 'Asset catalog failed')}</div>`;
  }
}

function selectAsset(asset: AssetCatalogEntry): void {
  selectedAsset = asset;
  selectedAssetView.classList.remove('empty');
  selectedAssetView.innerHTML = `<img src="${asset.path}" alt=""><div><strong>${escapeHtml(asset.name)}</strong><small>${escapeHtml(asset.collection)} · ${escapeHtml(asset.category)}</small><small>${asset.width}×${asset.height}px · ${asset.source}</small></div>`;
  replaceAssetButton.disabled = !selectedElement();
  addAssetButton.disabled = false;
  void refreshCatalog();
}

function addAssetAtViewportCenter(): void {
  const center = world.toLocal({ x: host.clientWidth / 2, y: host.clientHeight / 2 });
  addSelectedAssetAt(center);
}

async function initializeCatalog(): Promise<void> {
  const meta = await loadCatalogMeta();
  for (const source of meta.sources) assetSource.add(new Option(source, source));
  for (const category of meta.categories) assetCategory.add(new Option(category, category));
  const collectionFragment = document.createDocumentFragment();
  for (const collection of meta.collections) {
    const option = document.createElement('option');
    option.value = collection;
    collectionFragment.appendChild(option);
  }
  assetCollections.appendChild(collectionFragment);
  await refreshCatalog();
}

function debounceCatalogInput(): void {
  window.clearTimeout(Number(assetSearch.dataset.timer || 0));
  const timer = window.setTimeout(() => {
    catalogQuery.q = assetSearch.value;
    catalogQuery.collection = assetCollection.value;
    catalogQuery.offset = 0;
    void refreshCatalog();
  }, 250);
  assetSearch.dataset.timer = String(timer);
}

async function exportDocument(): Promise<void> {
  saveStatus.textContent = 'Building export…';
  overlayLayer.visible = false;
  const colliderVisible = colliderLayer.visible;
  colliderLayer.visible = false;
  const extracted = app.renderer.extract.canvas({
    target: world,
    frame: new Rectangle(0, 0, documentState.sample.width, documentState.sample.height),
    resolution: 1,
    clearColor: '#080b11',
  }) as HTMLCanvasElement;
  overlayLayer.visible = true;
  colliderLayer.visible = colliderVisible;
  const pngBlob = await new Promise<Blob>((resolve, reject) => extracted.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Preview PNG failed')), 'image/png'));
  documentState.updatedAt = new Date().toISOString();
  const archive = zipSync({
    'labyrinth-style-v1.json': strToU8(JSON.stringify(documentState, null, 2)),
    'labyrinth-style-preview.png': new Uint8Array(await pngBlob.arrayBuffer()),
  }, { level: 6 });
  const url = URL.createObjectURL(new Blob([archive], { type: 'application/zip' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'labyrinth-style-export.zip';
  link.click();
  URL.revokeObjectURL(url);
  saveStatus.textContent = saveLocalDocument()
    ? 'Exported ZIP and autosaved locally'
    : 'Exported ZIP; local autosave unavailable';
}

function validateDocument(value: unknown): StyleEditorDocumentV1 {
  const document = value as Partial<StyleEditorDocumentV1>;
  if (document.version !== 1 || !document.sample || !Array.isArray(document.elements) || !Array.isArray(document.colliders)) {
    throw new Error('This is not a Labyrinth Style Editor v1 document.');
  }
  return document as StyleEditorDocumentV1;
}

async function importDocument(file: File): Promise<void> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let raw: string;
  if (file.name.toLowerCase().endsWith('.zip')) {
    const files = unzipSync(bytes);
    const json = files['labyrinth-style-v1.json'] ?? Object.entries(files).find(([name]) => name.endsWith('.json'))?.[1];
    if (!json) throw new Error('ZIP does not contain a style JSON file.');
    raw = strFromU8(json);
  } else {
    raw = new TextDecoder().decode(bytes);
  }
  documentState = validateDocument(JSON.parse(raw));
  selectedElementIds.clear();
  selectedColliderIds.clear();
  history.splice(0, history.length, JSON.stringify(documentState));
  historyIndex = 0;
  const savedLocally = saveLocalDocument();
  notesField.value = documentState.notes;
  await rebuildScene();
  fitWorld();
  updateHistoryButtons();
  saveStatus.textContent = savedLocally
    ? `Imported ${file.name}`
    : `Imported ${file.name}; local autosave unavailable`;
}

document.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((button) => button.addEventListener('click', () => setTool(button.dataset.tool as EditorTool)));
undoButton.addEventListener('click', () => restoreHistory(historyIndex - 1));
redoButton.addEventListener('click', () => restoreHistory(historyIndex + 1));
required<HTMLButtonElement>('duplicate').addEventListener('click', duplicateSelection);
required<HTMLButtonElement>('delete-selection').addEventListener('click', deleteSelection);
required<HTMLButtonElement>('reset-document').addEventListener('click', () => {
  if (!window.confirm('Reset the editor sample and discard the current local layout?')) return;
  documentState = createSampleDocument();
  selectedElementIds.clear(); selectedColliderIds.clear();
  history.splice(0, history.length, JSON.stringify(documentState)); historyIndex = 0;
  notesField.value = documentState.notes;
  void rebuildScene().then(fitWorld);
  scheduleAutosave(); updateHistoryButtons();
});
required<HTMLButtonElement>('save-document').addEventListener('click', () => void exportDocument().catch((error) => { saveStatus.textContent = error instanceof Error ? error.message : 'Export failed'; }));
required<HTMLInputElement>('import-document').addEventListener('change', (event) => {
  const file = (event.currentTarget as HTMLInputElement).files?.[0];
  if (file) void importDocument(file).catch((error) => { saveStatus.textContent = error instanceof Error ? error.message : 'Import failed'; });
});
replaceAssetButton.addEventListener('click', replaceSelectedAsset);
addAssetButton.addEventListener('click', addAssetAtViewportCenter);
previousAssetsButton.addEventListener('click', () => { catalogQuery.offset = Math.max(0, catalogQuery.offset - PAGE_SIZE); void refreshCatalog(); });
nextAssetsButton.addEventListener('click', () => { if (catalogQuery.offset + PAGE_SIZE < catalogResultTotal) catalogQuery.offset += PAGE_SIZE; void refreshCatalog(); });
assetSearch.addEventListener('input', debounceCatalogInput);
assetCollection.addEventListener('input', debounceCatalogInput);
assetSource.addEventListener('change', () => { catalogQuery.source = assetSource.value; catalogQuery.offset = 0; void refreshCatalog(); });
assetCategory.addEventListener('change', () => { catalogQuery.category = assetCategory.value; catalogQuery.offset = 0; void refreshCatalog(); });
snapSizeSelect.addEventListener('change', () => { currentSnap = Number(snapSizeSelect.value) || 1; });
showCollidersCheckbox.addEventListener('change', () => { colliderLayer.visible = showCollidersCheckbox.checked; });
notesField.addEventListener('input', () => { documentState.notes = notesField.value; scheduleAutosave(); });
layerSearch.addEventListener('input', renderLayers);

window.addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); restoreHistory(historyIndex - 1); return; }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); restoreHistory(historyIndex + 1); return; }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') { event.preventDefault(); duplicateSelection(); return; }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') { event.preventDefault(); copySelection(); return; }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') { event.preventDefault(); pasteClipboard(); return; }
  if (event.key === 'Escape') { event.preventDefault(); setSelection(null, null); return; }
  if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); deleteSelection(); return; }
  const directions: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  const direction = directions[event.key];
  if (!direction) return;
  const amount = event.shiftKey ? 8 : currentSnap;
  const elements = selectedElements();
  const colliders = selectedColliders();
  if (elements.length === 0 && colliders.length === 0) return;
  for (const element of elements) {
    element.x += direction[0] * amount;
    element.y += direction[1] * amount;
    const sprite = spriteById.get(element.id);
    if (sprite) applyElementToSprite(element, sprite);
  }
  for (const collider of colliders) {
    collider.x += direction[0] * amount;
    collider.y += direction[1] * amount;
  }
  if (colliders.length > 0) rebuildColliders();
  event.preventDefault(); updateSelectionOverlay(); renderInspector(); commitHistory();
});

window.addEventListener('resize', () => { app.stage.hitArea = app.screen; });

// Hide selection overlay while Shift is held
window.addEventListener('keydown', (event) => {
  if (event.key === 'Shift' && !shiftHeld) {
    shiftHeld = true;
    updateSelectionOverlay();
  }
});
window.addEventListener('keyup', (event) => {
  if (event.key === 'Shift') {
    shiftHeld = false;
    updateSelectionOverlay();
  }
});
bindElementInspector();
notesField.value = documentState.notes;
setTool('select');
updateHistoryButtons();
await rebuildScene();
fitWorld();
saveStatus.textContent = restoredLocalDocument ? 'Restored local autosave' : 'New sample ready';
void initializeCatalog().catch((error) => { assetGrid.innerHTML = `<div class="readout">${escapeHtml(error instanceof Error ? error.message : 'Catalog failed')}</div>`; });
