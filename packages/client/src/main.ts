// packages/client/src/main.ts
// ─────────────────────────────────────────────────────────────────────────────
// Labyrinth 2D — Client Entry Point
// Step 9: 2.5D Perspective, Feet-Based Collision, Multi-Layer Tiles
// ─────────────────────────────────────────────────────────────────────────────

import { Application, AnimatedSprite, Container, Text, TextStyle, TextureStyle, Graphics } from 'pixi.js';

TextureStyle.defaultOptions.scaleMode = 'nearest';
import {
  INTERNAL_WIDTH,
  INTERNAL_HEIGHT,
  TILE_SIZE,
  TILE_FLOOR,
  TILE_GATE_HORIZONTAL,
  MAZE_HEIGHT,
  MAZE_WIDTH,
  MAX_TEAMS,
  CELL_SIZE,
  CELL_STEP_X,
  CELL_STEP_Y,
  GRID_CELLS,
  SPAWN_DISTANCE,
  PLAYER_CHARACTER_NAMES,
  FEET_HITBOX_W,
  FEET_HITBOX_H,
  generateMazeLayout,
  applyInputWithCollision,
  deriveFacingDirection,
} from '@labyrinth/shared';
import type { GameState, TileMapData, FacingDirection, GatePlacement, PressurePlateInfo, GeneratedMazeLayout, PlayerRole } from '@labyrinth/shared';
import { NetworkManager } from './net/NetworkManager';
import { SnapshotBuffer, INTERPOLATION_DELAY, type TimestampedSnapshot } from './net/SnapshotBuffer';
import { loadAssets, type GameAssets } from './assets/AssetLoader';
import { DebugSettings } from './config/DebugSettings';
import { Minimap } from './systems/Minimap';
import { TilemapRenderer, type RunestoneSpriteData, type PressurePlateSpriteData } from './systems/TilemapRenderer';
import { Portal } from './systems/Portal';
import { WisdomOrbHud } from './systems/WisdomOrbHud';
import { WisdomArrow } from './systems/WisdomArrow';
import { IntroDialogueHud } from './systems/IntroDialogueHud';
import { MobileControls, type MobileControlDirection } from './systems/MobileControls';

// ── Player sprite dimensions ────────────────────────────────────────────────
const SURVIVOR_SPAWN_DIALOGUE_PAGES = [
  'You have been cast into the Maze. Scattered and alone, find your way to the heart of the labyrinth — where other survivors await.',
  'Together, activate the three ancient runes to unlock the portal and escape… before the Maze claims you forever.',
];

const WARDEN_SPAWN_DIALOGUE_PAGES = [
  'You are a Warden. Keep your role hidden from the survivors.',
  'Your goal is to delay and misdirect the survivors until time runs out. Use your complete map to lead them astray.',
];

// ── Input State ─────────────────────────────────────────────────────────────

type MoveDirection = 'up' | 'down' | 'left' | 'right';
type MoveState = Record<MoveDirection, boolean>;

const MOVE_DIRECTIONS: readonly MoveDirection[] = ['up', 'down', 'left', 'right'];

const keyboardKeys: MoveState = {
  up: false,
  down: false,
  left: false,
  right: false,
};

const touchKeys: MoveState = {
  up: false,
  down: false,
  left: false,
  right: false,
};

const activeKeys: MoveState = {
  up: false,
  down: false,
  left: false,
  right: false,
};

const KEY_MAP: Record<string, MoveDirection> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  KeyW: 'up',
  KeyS: 'down',
  KeyA: 'left',
  KeyD: 'right',
};

function syncActiveKeys(): void {
  for (const direction of MOVE_DIRECTIONS) {
    activeKeys[direction] = keyboardKeys[direction] || touchKeys[direction];
  }
}

function clearMoveState(state: MoveState): void {
  for (const direction of MOVE_DIRECTIONS) {
    state[direction] = false;
  }
}

function setKeyboardDirection(direction: MoveDirection, pressed: boolean): void {
  keyboardKeys[direction] = pressed;
  syncActiveKeys();
}

function setTouchDirection(direction: MoveDirection, pressed: boolean): void {
  touchKeys[direction] = pressed;
  syncActiveKeys();
}

function resetKeyboardInput(): void {
  clearMoveState(keyboardKeys);
  syncActiveKeys();
}


// ── Prediction State ────────────────────────────────────────────────────────

interface PendingInput {
  sequenceNumber: number;
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  dt: number;
}

let pendingInputs: PendingInput[] = [];
let inputSequenceNumber = 0;
let localX = 0;
let localY = 0;
let localPlayerInitialized = false;
let localPlayerRole: PlayerRole | null = null;
let localFacing: FacingDirection = 'down';

/** Briefly suppress reconciliation while a click-teleport reaches the server. */
let debugTeleportActive = false;
let debugTeleportResetTimer: ReturnType<typeof setTimeout> | null = null;

let currentMap: TileMapData | null = null;
const snapshotBuffer = new SnapshotBuffer();

let minimap: Minimap | null = null;
let tilemapRenderer: TilemapRenderer | null = null;
let cellBoundaryOverlay: Graphics | null = null;

/** Current layout data for gate/pressure plate reference. */
let currentLayout: GeneratedMazeLayout | null = null;

/** Pressure plate animation speed (frames per second). */
const PLATE_ANIM_SPEED = 12;

/** Floating "Press E" interaction prompt */
let interactPrompt: Text | null = null;

/** Portal instance (created when all runestones are activated). */
let portal: Portal | null = null;

/** Top-left HUD showing remaining wisdom orbs. */
let wisdomOrbHud: WisdomOrbHud | null = null;

/** Local-only world-space hint arrow shown after using a wisdom orb. */
let wisdomArrow: WisdomArrow | null = null;

/** Bottom-of-screen intro dialogue shown when the local player joins the maze. */
let introDialogueHud: IntroDialogueHud | null = null;

// ── Screen Shake & Cinematic Camera State ───────────────────────────────────

let shakeTimeRemaining = 0;
const SHAKE_DURATION = 0.8;
const SHAKE_MAX_INTENSITY = 3; // max ±px displacement

/** Pending portal position to spawn after shake completes. */
let pendingPortalPos: { x: number; y: number } | null = null;

/**
 * Camera cinematic state machine for the portal reveal sequence.
 * Instant teleport to portal (no directional clues), watch appearance, then teleport back.
 */
type CinematicPhase = 'idle' | 'watch_portal';
let cinematicPhase: CinematicPhase = 'idle';
let cinematicElapsed = 0;

/** Duration (seconds) to watch the portal appearance before returning. */
const WATCH_DURATION = 1.6;

/** Camera override target during cinematic (world pixel coords). */
let cinematicTargetX = 0;
let cinematicTargetY = 0;

// ── Integer Scaling ─────────────────────────────────────────────────────────

function getViewportScale(viewportW: number, viewportH: number): number {
  const fitScale = Math.min(viewportW / INTERNAL_WIDTH, viewportH / INTERNAL_HEIGHT);
  if (fitScale >= 1) {
    return Math.max(1, Math.floor(fitScale));
  }
  return fitScale;
}

function resizeCanvas(app: Application): void {
  const scale = getViewportScale(window.innerWidth, window.innerHeight);
  app.canvas.style.width = `${INTERNAL_WIDTH * scale}px`;
  app.canvas.style.height = `${INTERNAL_HEIGHT * scale}px`;
  app.renderer.resize(INTERNAL_WIDTH, INTERNAL_HEIGHT);
}

// ── Camera ──────────────────────────────────────────────────────────────────

function updateCamera(
  world: Container,
  targetX: number,
  targetY: number,
  mapPixelW: number,
  mapPixelH: number,
  zoomScale: number,
): void {
  const playerCenterX = targetX;
  const playerCenterY = targetY - TILE_SIZE / 2;

  let camX = INTERNAL_WIDTH / 2 - playerCenterX * zoomScale;
  let camY = INTERNAL_HEIGHT / 2 - playerCenterY * zoomScale;

  const scaledMapW = mapPixelW * zoomScale;
  const scaledMapH = mapPixelH * zoomScale;

  if (scaledMapW > INTERNAL_WIDTH) {
    const minX = -(scaledMapW - INTERNAL_WIDTH);
    camX = Math.max(minX, Math.min(0, camX));
  } else {
    camX = (INTERNAL_WIDTH - scaledMapW) / 2;
  }

  if (scaledMapH > INTERNAL_HEIGHT) {
    const minY = -(scaledMapH - INTERNAL_HEIGHT);
    camY = Math.max(minY, Math.min(0, camY));
  } else {
    camY = (INTERNAL_HEIGHT - scaledMapH) / 2;
  }

  world.x = Math.round(camX);
  world.y = Math.round(camY);
}
/**
 * Draws the 15×15 logical maze cells used by spawn-distance BFS. The overlay
 * covers each 6×6 floor cell only; the intervening walls remain uncovered.
 */
function createCellBoundaryOverlay(): Graphics {
  const overlay = new Graphics();
  const cellStepXPx = CELL_STEP_X * TILE_SIZE;
  const cellStepYPx = CELL_STEP_Y * TILE_SIZE;
  const gridOffsetXPx = (MAZE_WIDTH - GRID_CELLS * CELL_STEP_X) * TILE_SIZE;
  const gridOffsetYPx = (MAZE_HEIGHT - GRID_CELLS * CELL_STEP_Y) * TILE_SIZE;
  const cellSizePx = CELL_SIZE * TILE_SIZE;

  for (let cy = 0; cy < GRID_CELLS; cy++) {
    for (let cx = 0; cx < GRID_CELLS; cx++) {
      const x = gridOffsetXPx + cx * cellStepXPx;
      const y = gridOffsetYPx + cy * cellStepYPx;
      const fillColor = (cx + cy) % 2 === 0 ? 0x38bdf8 : 0x818cf8;

      overlay
        .rect(x, y, cellSizePx, cellSizePx)
        .fill({ color: fillColor, alpha: 0.07 })
        .stroke({ color: 0xe0f2fe, alpha: 0.85, width: 1 });
    }
  }

  overlay.visible = false;
  overlay.eventMode = 'none';
  return overlay;
}


// ── Interpolation ───────────────────────────────────────────────────────────

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

interface InterpolatedPlayer {
  x: number;
  y: number;
  facing: FacingDirection;
  isMoving: boolean;
  isDead: boolean;
}

interface SnapshotPair {
  past: TimestampedSnapshot;
  future: TimestampedSnapshot;
  t: number;
}

function getInterpolatedPlayer(
  playerId: string,
  pair: SnapshotPair | null,
  latest: TimestampedSnapshot | null,
): InterpolatedPlayer | null {

  if (pair) {
    const pastPlayer = pair.past.state.players.find((p) => p.id === playerId);
    const futurePlayer = pair.future.state.players.find((p) => p.id === playerId);

    if (pastPlayer && futurePlayer) {
      return {
        x: lerp(pastPlayer.x, futurePlayer.x, pair.t),
        y: lerp(pastPlayer.y, futurePlayer.y, pair.t),
        facing: futurePlayer.facing,
        isMoving: futurePlayer.isMoving,
        isDead: futurePlayer.isDead,
      };
    }

    if (futurePlayer) return { x: futurePlayer.x, y: futurePlayer.y, facing: futurePlayer.facing, isMoving: futurePlayer.isMoving, isDead: futurePlayer.isDead };
    if (pastPlayer) return { x: pastPlayer.x, y: pastPlayer.y, facing: pastPlayer.facing, isMoving: pastPlayer.isMoving, isDead: pastPlayer.isDead };
  }

  if (latest) {
    const player = latest.state.players.find((p) => p.id === playerId);
    if (player) return { x: player.x, y: player.y, facing: player.facing, isMoving: player.isMoving, isDead: player.isDead };
  }

  return null;
}

// ── Animation Helpers ───────────────────────────────────────────────────────

function getAnimationKey(facing: FacingDirection, isMoving: boolean, isDead = false): string {
  if (isDead) return 'lying';
  return isMoving ? `walk-${facing}` : `idle-${facing}`;
}

function deriveFacingFromKeys(): FacingDirection {
  return deriveFacingDirection(activeKeys, localFacing);
}

interface ZIndexedDisplayObject {
  x: number;
  y: number;
  zIndex: number;
}

function setRoundedPosition(
  displayObject: ZIndexedDisplayObject,
  x: number,
  y: number,
  zOffset = 0,
): void {
  const roundedX = Math.round(x);
  const roundedY = Math.round(y);
  const nextZIndex = roundedY + zOffset;

  if (displayObject.x !== roundedX) displayObject.x = roundedX;
  if (displayObject.y !== roundedY) displayObject.y = roundedY;
  if (displayObject.zIndex !== nextZIndex) displayObject.zIndex = nextZIndex;
}

// ── Debug UI ────────────────────────────────────────────────────────────────

interface DebugUiDom {
  root: HTMLDivElement;
  status: HTMLDivElement;
  tick: HTMLSpanElement;
  pending: HTMLSpanElement;
  snapshot: HTMLSpanElement;
  playerList: HTMLUListElement;
  playerActions: HTMLDivElement;
  playerActionName: HTMLElement;
  playerActionMeta: HTMLSpanElement;
  playerSkinSelect: HTMLSelectElement;
  teleportToButton: HTMLButtonElement;
  teleportHereButton: HTMLButtonElement;
  toggleDeadButton: HTMLButtonElement;
}

const DEBUG_UI_UPDATE_INTERVAL_MS = 150;
let lastDebugUiUpdateAt = -Infinity;
let lastDebugPlayerListMarkup = '';
let selectedDebugPlayerId: string | null = null;

function escapeHtml(value: string): string {
  const replacements: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return value.replace(/[&<>"']/g, (character) => replacements[character]);
}

function createDebugUI(): DebugUiDom {
  const debugDiv = document.createElement('div');
  debugDiv.id = 'debug-ui';

  const flags = DebugSettings.getFlags();
  if (flags.minimized) {
    debugDiv.classList.add('minimized');
  }

  debugDiv.innerHTML = `
    <div class="debug-header">
      <h1>🏰 Labyrinth 2D — Network Debug</h1>
      <button id="debug-minimize-btn" title="Toggle Minimize">${flags.minimized ? '+' : '−'}</button>
    </div>
    <div class="debug-content">
      <div class="status" id="connection-status">⏳ Connecting...</div>
      <div class="stats">
        <div class="stat-card">
          <span class="stat-label">Tick</span>
          <span class="stat-value" id="tick-counter">—</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">Pending</span>
          <span class="stat-value" id="pending-count">0</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">Snaps</span>
          <span class="stat-value" id="snapshot-count">0</span>
        </div>
      </div>
      <h2>Players</h2>
      <ul id="player-list"></ul>
      <div class="debug-player-actions" id="debug-player-actions" hidden>
        <div class="debug-player-actions-header">
          <div>
            <strong id="debug-player-action-name">Player</strong>
            <span id="debug-player-action-meta"></span>
          </div>
          <button type="button" id="debug-player-actions-close" title="Close player menu" aria-label="Close player menu">×</button>
        </div>
        <div class="debug-player-action-grid">
          <button type="button" id="debug-teleport-to" data-player-action="teleport-to">Teleport to them</button>
          <button type="button" id="debug-teleport-here" data-player-action="teleport-here">Teleport them to me</button>
          <label class="debug-player-skin-control">
            <span>Character skin</span>
            <select id="debug-player-skin-select">
              ${PLAYER_CHARACTER_NAMES.map((name, index) => `<option value="${index}">${name}</option>`).join('')}
            </select>
          </label>
          <button type="button" data-player-action="set-survivor">Set survivor</button>
          <button type="button" data-player-action="set-warden">Set warden</button>
          <button type="button" id="debug-toggle-dead" class="danger" data-player-action="toggle-dead">Make dead</button>
        </div>
      </div>
      <h2>Debug Settings</h2>
      <a class="debug-editor-link" href="/style-editor.html" target="_blank" rel="noopener">
        <span>🎨</span> Open Style Editor
      </a>
      <div class="debug-toggles">
        <label class="debug-toggle" id="toggle-master">
          <input type="checkbox" ${flags.masterEnabled ? 'checked' : ''} data-flag="masterEnabled">
          <span>Master Enable</span>
        </label>
        <label class="debug-toggle" id="toggle-scroll-zoom">
          <input type="checkbox" ${flags.scrollZoom ? 'checked' : ''} data-flag="scrollZoom">
          <span>Scroll Zoom</span>
        </label>
        <label class="debug-toggle" id="toggle-zoom-toggle">
          <input type="checkbox" ${flags.zoomToggle ? 'checked' : ''} data-flag="zoomToggle">
          <span>Zoom Toggle (−)</span>
        </label>
        <label class="debug-toggle" id="toggle-click-teleport">
          <input type="checkbox" ${flags.clickTeleport ? 'checked' : ''} data-flag="clickTeleport">
          <span>Click Teleport</span>
        </label>
        <label class="debug-toggle" id="toggle-cell-boundaries">
          <input type="checkbox" ${flags.cellBoundaries ? 'checked' : ''} data-flag="cellBoundaries">
          <span>Cell Boundaries</span>
        </label>
      </div>
    </div>
  `;
  document.body.appendChild(debugDiv);

  const status = debugDiv.querySelector<HTMLDivElement>('#connection-status');
  const tick = debugDiv.querySelector<HTMLSpanElement>('#tick-counter');
  const pending = debugDiv.querySelector<HTMLSpanElement>('#pending-count');
  const snapshot = debugDiv.querySelector<HTMLSpanElement>('#snapshot-count');
  const playerList = debugDiv.querySelector<HTMLUListElement>('#player-list');
  const playerActions = debugDiv.querySelector<HTMLDivElement>('#debug-player-actions');
  const playerActionName = debugDiv.querySelector<HTMLElement>('#debug-player-action-name');
  const playerActionMeta = debugDiv.querySelector<HTMLSpanElement>('#debug-player-action-meta');
  const playerSkinSelect = debugDiv.querySelector<HTMLSelectElement>('#debug-player-skin-select');
  const teleportToButton = debugDiv.querySelector<HTMLButtonElement>('#debug-teleport-to');
  const teleportHereButton = debugDiv.querySelector<HTMLButtonElement>('#debug-teleport-here');
  const toggleDeadButton = debugDiv.querySelector<HTMLButtonElement>('#debug-toggle-dead');

  if (
    !status ||
    !tick ||
    !pending ||
    !snapshot ||
    !playerList ||
    !playerActions ||
    !playerActionName ||
    !playerActionMeta ||
    !playerSkinSelect ||
    !teleportToButton ||
    !teleportHereButton ||
    !toggleDeadButton
  ) {
    throw new Error('Failed to initialize debug UI');
  }

  lastDebugUiUpdateAt = -Infinity;
  lastDebugPlayerListMarkup = '';
  selectedDebugPlayerId = null;

  return {
    root: debugDiv,
    status,
    tick,
    pending,
    snapshot,
    playerList,
    playerActions,
    playerActionName,
    playerActionMeta,
    playerSkinSelect,
    teleportToButton,
    teleportHereButton,
    toggleDeadButton,
  };
}

function setupDebugToggles(debugUi: DebugUiDom): void {
  const debugUI = debugUi.root;
  // Allow pointer events on the toggles area
  debugUI.style.pointerEvents = 'auto';

  // Toggle flags
  debugUI.addEventListener('change', (e: Event) => {
    const target = e.target as HTMLInputElement;
    const flag = target.dataset.flag as keyof ReturnType<typeof DebugSettings.getFlags>;
    if (!flag) return;
    DebugSettings.setFlag(flag, target.checked);
  });

  // Minimize button
  const minimizeBtn = debugUI.querySelector<HTMLButtonElement>('#debug-minimize-btn');
  if (minimizeBtn) {
    minimizeBtn.addEventListener('click', () => {
      const isMinimized = debugUI.classList.toggle('minimized');
      DebugSettings.setFlag('minimized', isMinimized);
      minimizeBtn.textContent = isMinimized ? '+' : '−';
    });
  }
}

function renderDebugPlayerActions(
  debugUi: DebugUiDom,
  state: GameState,
  localPlayerId: string | null,
): void {
  const player = state.players.find((candidate) => candidate.id === selectedDebugPlayerId);
  if (!player) {
    selectedDebugPlayerId = null;
    debugUi.playerActions.hidden = true;
    return;
  }

  const skinName = PLAYER_CHARACTER_NAMES[player.spriteIndex] ?? `Skin ${player.spriteIndex}`;
  const isLocalPlayer = player.id === localPlayerId;
  debugUi.playerActions.hidden = false;
  debugUi.playerActionName.textContent = player.displayName;
  debugUi.playerActionMeta.textContent = `${skinName} · ${player.isDead ? 'dead' : 'alive'}`;
  debugUi.playerSkinSelect.value = String(player.spriteIndex);
  debugUi.teleportToButton.disabled = isLocalPlayer;
  debugUi.teleportHereButton.disabled = isLocalPlayer;
  debugUi.toggleDeadButton.textContent = player.isDead ? 'Revive player' : 'Make dead';
  debugUi.toggleDeadButton.classList.toggle('revive', player.isDead);
}

function setupDebugPlayerActions(
  debugUi: DebugUiDom,
  net: NetworkManager,
  getState: () => GameState | null,
  getLocalPlayerId: () => string | null,
): void {
  const refresh = (): void => {
    const state = getState();
    if (state) updateDebugUI(debugUi, state, getLocalPlayerId(), true);
  };

  debugUi.playerList.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    const playerButton = event.target.closest<HTMLButtonElement>('[data-debug-player-id]');
    if (!playerButton) return;
    selectedDebugPlayerId = playerButton.dataset.debugPlayerId ?? null;
    refresh();
  });

  debugUi.root.querySelector<HTMLButtonElement>('#debug-player-actions-close')?.addEventListener('click', () => {
    selectedDebugPlayerId = null;
    refresh();
  });

  debugUi.playerActions.addEventListener('click', (event) => {
    if (!(event.target instanceof Element) || !selectedDebugPlayerId) return;
    const actionButton = event.target.closest<HTMLButtonElement>('[data-player-action]');
    if (!actionButton || actionButton.disabled) return;

    switch (actionButton.dataset.playerAction) {
      case 'teleport-to':
        net.sendDebugPlayerAction(selectedDebugPlayerId, 'teleport-to');
        break;
      case 'teleport-here':
        net.sendDebugPlayerAction(selectedDebugPlayerId, 'teleport-here');
        break;
      case 'toggle-dead': {
        const player = getState()?.players.find((candidate) => candidate.id === selectedDebugPlayerId);
        if (player) {
          net.sendDebugPlayerAction(selectedDebugPlayerId, 'set-dead', { dead: !player.isDead });
        }
        break;
      }
      case 'set-survivor':
        net.sendDebugPlayerAction(selectedDebugPlayerId, 'set-role', { role: 'survivor' });
        break;
      case 'set-warden':
        net.sendDebugPlayerAction(selectedDebugPlayerId, 'set-role', { role: 'warden' });
        break;
    }
  });

  debugUi.playerSkinSelect.addEventListener('change', () => {
    if (!selectedDebugPlayerId) return;
    const spriteIndex = Number.parseInt(debugUi.playerSkinSelect.value, 10);
    if (Number.isInteger(spriteIndex)) {
      net.sendDebugPlayerAction(selectedDebugPlayerId, 'set-skin', { spriteIndex });
    }
  });
}

function updateDebugUI(debugUi: DebugUiDom, state: GameState, playerId: string | null, force = false): void {
  const now = performance.now();
  if (!force && now - lastDebugUiUpdateAt < DEBUG_UI_UPDATE_INTERVAL_MS) return;
  lastDebugUiUpdateAt = now;

  const tickText = state.tick.toString();
  const pendingText = pendingInputs.length.toString();
  const snapshotText = snapshotBuffer.length.toString();

  if (debugUi.tick.textContent !== tickText) debugUi.tick.textContent = tickText;
  if (debugUi.pending.textContent !== pendingText) debugUi.pending.textContent = pendingText;
  if (debugUi.snapshot.textContent !== snapshotText) debugUi.snapshot.textContent = snapshotText;

  const playerListMarkup = state.players
      .map((p) => {
        const isYou = p.id === playerId ? ' <span class="you-badge">← you</span>' : '';
        const isSelected = p.id === selectedDebugPlayerId ? ' selected' : '';
        const deadBadge = p.isDead ? '<span class="dead-badge">dead</span>' : '';
        const skinName = PLAYER_CHARACTER_NAMES[p.spriteIndex] ?? `Skin ${p.spriteIndex}`;
        return `<li><button type="button" class="debug-player-row${isSelected}" data-debug-player-id="${escapeHtml(p.id)}"><span class="player-name">${escapeHtml(p.displayName)}</span><span class="player-pos">${escapeHtml(skinName)} · (${Math.round(p.x)}, ${Math.round(p.y)}) ${p.facing}</span>${deadBadge}${isYou}</button></li>`;
      })
      .join('');

  if (playerListMarkup !== lastDebugPlayerListMarkup) {
    debugUi.playerList.innerHTML = playerListMarkup;
    lastDebugPlayerListMarkup = playerListMarkup;
  }
  renderDebugPlayerActions(debugUi, state, playerId);
}

// ── Gate State Helpers ──────────────────────────────────────────────────────

/** Per-gate sliding animation state. */
interface GateSlideState {
  /** Current slide progress: 0 = fully closed (visible), 1 = fully open (hidden). */
  progress: number;
  /** Target: 0 = closing, 1 = opening. */
  target: number;
  /** The gate front sprite being animated. */
  sprite: import('pixi.js').Sprite | null;
  /** The mask graphics used for clipping the bottom. */
  mask: import('pixi.js').Graphics | null;
  /** Original Y position (bottom of the gate). */
  originalY: number;
}

const gateSlideStates: Map<number, GateSlideState> = new Map();
const GATE_SLIDE_SPEED = 3; // units per second (0→1 takes ~0.33s)
const GATE_STICK_OUT_PX = 4; // Pixels of the gate top that remain sticking out

/**
 * Apply a gate open/close state change:
 * - Mutate the tile data for collision sync
 * - Start sliding animation on the front gate sprite
 */
function applyGateState(
  gateIndex: number,
  open: boolean,
  gates: GatePlacement[],
  map: TileMapData,
  renderer: TilemapRenderer,
  _assets: GameAssets,
): void {
  const gate = gates[gateIndex];
  if (!gate) return;

  // Update tile data for collision (client prediction sync)
  if (gate.orientation === 'horizontal') {
    for (let dx = 0; dx < CELL_SIZE; dx++) {
      const idx = gate.tileY * map.width + (gate.tileX + dx);
      map.data[idx] = open ? TILE_FLOOR : TILE_GATE_HORIZONTAL;
    }
  }

  // Find the corresponding front gate sprite
  const gateSprite = renderer.gateSprites[gateIndex] ?? null;

  // Calculate original bottom Y position from tile coordinates
  const originalY = (gate.tileY + 1) * TILE_SIZE;

  // Initialize or update slide state
  let slide = gateSlideStates.get(gateIndex);
  if (!slide) {
    slide = {
      progress: open ? 0 : 1,
      target: open ? 1 : 0,
      sprite: gateSprite,
      mask: null,
      originalY: originalY,
    };
    gateSlideStates.set(gateIndex, slide);
  } else {
    slide.target = open ? 1 : 0;
    slide.sprite = gateSprite;
    slide.originalY = originalY;
  }
}

/**
 * Update gate sliding animations each frame.
 * As the gate slides down, a mask clips the bottom progressively.
 */
function updateGateSlideAnimations(dt: number): void {
  for (const [, slide] of gateSlideStates) {
    if (!slide.sprite) continue;

    // 1. Advance progress toward target
    if (slide.progress !== slide.target) {
      if (slide.target > slide.progress) {
        slide.progress = Math.min(slide.target, slide.progress + GATE_SLIDE_SPEED * dt);
      } else {
        slide.progress = Math.max(slide.target, slide.progress - GATE_SLIDE_SPEED * dt);
      }
    }

    // 2. Apply visual state based on current progress
    const spriteHeight = slide.sprite.height;
    const maxSlideOffset = spriteHeight - GATE_STICK_OUT_PX;
    const slideOffset = maxSlideOffset * slide.progress;

    // Physically move the sprite down
    slide.sprite.y = slide.originalY + slideOffset;

    if (slide.progress > 0) {
      // Opening, closing, or fully open (progress=1)
      if (!slide.mask) {
        slide.mask = new Graphics();
        if (slide.sprite.parent) {
          slide.sprite.parent.addChild(slide.mask);
        }
      }
      // Static mask at original gate position (originalY is bottom)
      slide.mask.clear();
      slide.mask.rect(
        slide.sprite.x,
        slide.originalY - spriteHeight,
        slide.sprite.width,
        spriteHeight,
      );
      slide.mask.fill({ color: 0xffffff });
      slide.sprite.mask = slide.mask;
      slide.sprite.visible = true;
    } else {
      // Fully closed (progress=0) — hide mask, show at original Y
      slide.sprite.visible = true;
      slide.sprite.y = slide.originalY;
      if (slide.mask) {
        slide.sprite.mask = null;
        slide.mask.parent?.removeChild(slide.mask);
        slide.mask.destroy();
        slide.mask = null;
      }
    }
  }
}

// ── Pressure Plate Animation ────────────────────────────────────────────────

/**
 * Check if a player's feet AABB overlaps a pressure plate tile (client-side mirror of server logic).
 */
function isPlayerOnPlateTile(
  playerX: number,
  playerY: number,
  plateTileX: number,
  plateTileY: number,
): boolean {
  const pLeft = playerX - FEET_HITBOX_W / 2;
  const pTop = playerY - FEET_HITBOX_H;
  const pRight = pLeft + FEET_HITBOX_W - 1;
  const pBottom = playerY - 1;

  const tLeft = plateTileX * TILE_SIZE;
  const tTop = plateTileY * TILE_SIZE;
  const tRight = tLeft + TILE_SIZE - 1;
  const tBottom = tTop + TILE_SIZE - 1;

  return pLeft <= tRight && pRight >= tLeft && pTop <= tBottom && pBottom >= tTop;
}

/** Per-plate animation timer tracking. */
const plateAnimTimers: Map<number, number> = new Map();

/**
 * Update pressure plate animations based on whether any player is standing on each plate.
 * Step on: frame 0 → 1 → 2, stop at 2.
 * Step off: frame 2 → 1 → 0, stop at 0.
 */
function updatePressurePlateAnimations(
  renderer: TilemapRenderer,
  serverState: GameState,
  dt: number,
  assets: GameAssets,
): void {
  const frameInterval = 1 / PLATE_ANIM_SPEED;

  for (const plate of renderer.pressurePlateSprites) {
    // Check if any player is standing on this plate
    let occupied = false;
    for (const player of serverState.players) {
      if (isPlayerOnPlateTile(player.x, player.y, plate.tileX, plate.tileY)) {
        occupied = true;
        break;
      }
    }

    // Also check local predicted position for immediate feedback
    if (!occupied && localPlayerInitialized) {
      if (isPlayerOnPlateTile(localX, localY, plate.tileX, plate.tileY)) {
        occupied = true;
      }
    }

    const targetFrame = occupied ? 2 : 0;
    if (plate.currentFrame === targetFrame) {
      plateAnimTimers.delete(plate.plateId);
      continue;
    }

    // Accumulate animation time
    const currentTimer = (plateAnimTimers.get(plate.plateId) ?? 0) + dt;
    if (currentTimer >= frameInterval) {
      plateAnimTimers.set(plate.plateId, currentTimer - frameInterval);

      // Step toward target frame
      if (plate.currentFrame < targetFrame) {
        plate.currentFrame++;
      } else {
        plate.currentFrame--;
      }

      // Update sprite texture
      const frameTex = plate.frameSet[plate.currentFrame];
      if (frameTex) {
        plate.sprite.texture = frameTex;
      }
    } else {
      plateAnimTimers.set(plate.plateId, currentTimer);
    }
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const app = new Application();

  await app.init({
    width: INTERNAL_WIDTH,
    height: INTERNAL_HEIGHT,
    antialias: false,
    roundPixels: true,
    resolution: 1,
    backgroundColor: 0x0e0e1a,
    canvas: document.createElement('canvas'),
    resizeTo: undefined,
  });

  const container = document.getElementById('game-container');
  if (!container) throw new Error('Missing #game-container');
  container.appendChild(app.canvas);

  resizeCanvas(app);
  window.addEventListener('resize', () => resizeCanvas(app));

  const assets: GameAssets = await loadAssets();

  // ── World Container ───────────────────────────────────────────────────
  const worldContainer = new Container();
  app.stage.addChild(worldContainer);

  // Dynamic entities retain normal feet-based Y sorting.
  const entityLayer = new Container();
  entityLayer.sortableChildren = true;
  worldContainer.addChild(entityLayer);

  // Forest walls are an unconditional foreground: their canopy and trunks
  // must always cover player characters, regardless of player Y position.
  const forestWallLayer = new Container();
  worldContainer.addChild(forestWallLayer);

  let mapPixelW = MAZE_WIDTH * TILE_SIZE;
  let mapPixelH = MAZE_HEIGHT * TILE_SIZE;

  const MIN_ZOOM = 0.1;
  const MAX_ZOOM = 2.0;
  const ZOOM_STEP = 0.05;
  let zoomLevel = MAX_ZOOM;

  // Zoom-toggle state: cycles default → zoomed-out → zoomed-in
  type ZoomToggleState = 'default' | 'zoomed-out' | 'zoomed-in';
  let zoomToggleState: ZoomToggleState = 'default';
  const savedZoomBeforeToggle = zoomLevel;

  const debugUiEnabled = DebugSettings.sessionEnabled;
  const debugUi = debugUiEnabled ? createDebugUI() : null;
  if (debugUi) {
    setupDebugToggles(debugUi);
  }
  const statusEl = debugUi?.status ?? null;

  // ── Player Sprite Registry ──────────────────────────────────────────────

  interface PlayerSpriteData {
    container: Container;
    shadow: Graphics;
    sprite: AnimatedSprite;
    currentAnimKey: string;
    spriteIndex: number;
  }

  const playerSprites: Map<string, PlayerSpriteData> = new Map();

  /** Safely resolve animation set for a player sprite, falling back to set 0. */
  function getAnimSet(spriteIndex: number) {
    return assets.playerAnimationSets[spriteIndex] ?? assets.playerAnimationSets[0];
  }

  function createPlayerSprite(playerId: string, spriteIndex: number): PlayerSpriteData {
    const animSet = getAnimSet(spriteIndex);
    const animKey = 'idle-down';
    const frames = animSet.animations[animKey];
    const sprite = new AnimatedSprite(frames);
    sprite.animationSpeed = 0.15;
    sprite.loop = true;
    sprite.play();
    sprite.scale.set(animSet.scale);
    sprite.anchor.set(0.5, 1.0); // bottom-center anchor

    // Keep the shadow outside the character's scale/mirroring transform so it
    // has a consistent footprint for every character and always stays beneath.
    const shadow = new Graphics()
      .ellipse(0, -2, 7, 3)
      .fill({ color: 0x16220d, alpha: 0.55 });
    const container = new Container();
    container.addChild(shadow, sprite);
    entityLayer.addChild(container);

    const data: PlayerSpriteData = { container, shadow, sprite, currentAnimKey: animKey, spriteIndex };
    playerSprites.set(playerId, data);
    return data;
  }

  function ensurePlayerSprite(playerId: string, spriteIndex: number): PlayerSpriteData {
    let data = playerSprites.get(playerId);
    if (!data) data = createPlayerSprite(playerId, spriteIndex);
    else if (data.spriteIndex !== spriteIndex) {
      data.spriteIndex = spriteIndex;
      data.currentAnimKey = '';
      setPlayerAnimation(data, 'idle-down');
    }
    return data;
  }

  function setPlayerAnimation(data: PlayerSpriteData, animKey: string): void {
    data.shadow.visible = animKey !== 'lying';
    if (data.currentAnimKey === animKey) return;
    const animSet = getAnimSet(data.spriteIndex);
    const frames = animSet.animations[animKey];
    if (!frames) return;
    data.sprite.textures = frames;
    data.sprite.scale.x = animSet.mirroredKeys.has(animKey) ? -animSet.scale : animSet.scale;
    data.sprite.scale.y = animSet.scale;
    data.sprite.play();
    data.currentAnimKey = animKey;
  }

  function removePlayerSprite(playerId: string): void {
    const data = playerSprites.get(playerId);
    if (data) {
      entityLayer.removeChild(data.container);
      data.container.destroy({ children: true });
      playerSprites.delete(playerId);
    }
  }

  const knownRemotePlayers: Set<string> = new Set();

  // ── Network Manager ───────────────────────────────────────────────────

  let latestServerState: GameState | null = null;
  let applyLocalRoleUi: (
    role: PlayerRole,
    wisdomOrbs: number,
    showIntroDialogue: boolean,
  ) => void = () => {};

  const net = new NetworkManager({
    onRoomJoined: (roomId, playerId, mapSeed, role, wisdomOrbs, gameState) => {
      console.info(`[Main] Joined room "${roomId}" as ${playerId} (${role}, maze seed: ${mapSeed})`);

      // Clear previous slide states on new room join
      gateSlideStates.clear();

      const layout = generateMazeLayout(mapSeed, SPAWN_DISTANCE, MAX_TEAMS);
      currentMap = layout.map;
      currentLayout = layout;
      mapPixelW = currentMap.width * currentMap.tileSize;
      mapPixelH = currentMap.height * currentMap.tileSize;

      // ── Build chunk-based tilemap ──────────────────────────────────────
      tilemapRenderer?.destroy();
      tilemapRenderer = new TilemapRenderer(currentMap, layout.gates, layout.pressurePlates, layout.dirtMask, assets, app.renderer);
      if (cellBoundaryOverlay?.parent === worldContainer) {
        worldContainer.removeChild(cellBoundaryOverlay);
      }
      cellBoundaryOverlay?.destroy();
      cellBoundaryOverlay = createCellBoundaryOverlay();


      // Rebuild the fixed layer order. Forest walls remain above every entity.
      worldContainer.removeChild(entityLayer);
      worldContainer.removeChild(forestWallLayer);
      worldContainer.addChild(tilemapRenderer.backgroundLayer);
      worldContainer.addChild(tilemapRenderer.shadowLayer);
      worldContainer.addChild(tilemapRenderer.groundDetailLayer);
      worldContainer.addChild(entityLayer);
      worldContainer.addChild(forestWallLayer);
      worldContainer.addChild(cellBoundaryOverlay);

      // Wall chunks intentionally do not participate in player Y-sorting.
      for (const wallChunk of tilemapRenderer.wallRowChunks) {
        forestWallLayer.addChild(wallChunk);
      }

      // Northern walls sort naturally with players; only west/east/south
      // walls belong to the unconditional foreground layer.
      for (const wallChunk of tilemapRenderer.northWallRowChunks) {
        entityLayer.addChild(wallChunk);
      }

      for (const gate of tilemapRenderer.gateSprites) {
        entityLayer.addChild(gate);
      }

      // Add trees to entityLayer for Y-sorting
      for (const tree of tilemapRenderer.treeSprites) {
        entityLayer.addChild(tree);
      }

      // Add runestone sprites to entityLayer for Y-sorting
      for (const rs of tilemapRenderer.runestoneSprites) {
        entityLayer.addChild(rs.sprite);
      }

      // Add pressure plate sprites to entityLayer
      for (const plate of tilemapRenderer.pressurePlateSprites) {
        entityLayer.addChild(plate.sprite);
      }

      if (statusEl) {
        statusEl.textContent = '🟢 Connected';
        statusEl.classList.add('connected');
      }

      const me = gameState.players.find((p) => p.id === playerId);
      if (me) {
        localX = me.x;
        localY = me.y;
        localFacing = me.facing;
        localPlayerInitialized = true;
      }

      applyLocalRoleUi(role, wisdomOrbs, true);

      // ── Sync runestone activation state from initial GameState ─────
      for (const rsInfo of gameState.runestones) {
        const rsData = tilemapRenderer?.runestoneSprites.find((r) => r.index === rsInfo.index);
        if (rsData && rsInfo.activated && !rsData.activated) {
          rsData.activated = true;
          rsData.sprite.texture = assets.runestoneTextures[rsInfo.index][1];
        }
      }

      // ── Late-join portal sync ──────────────────────────────────────
      if (gameState.portal && !portal) {
        portal = new Portal(
          gameState.portal.x,
          gameState.portal.y,
          assets.portalFrames,
          assets.portalEmergenceCount,
          entityLayer,
          true, // skip emergence for late joiners
        );
        minimap?.setPortalPosition(gameState.portal.x, gameState.portal.y);
        console.info(`[Main] Late-join: portal already active at (${Math.round(gameState.portal.x)}, ${Math.round(gameState.portal.y)})`);
      }

      // ── Late-join gate state sync ────────────────────────────────────
      if (gameState.gateStates && currentLayout) {
        for (const gs of gameState.gateStates) {
          if (gs.open) {
            applyGateState(gs.gateIndex, true, currentLayout.gates, currentMap!, tilemapRenderer!, assets);
          }
        }
      }

      // ── Interaction prompt ─────────────────────────────────────────
      if (interactPrompt) {
        worldContainer.removeChild(interactPrompt);
        interactPrompt.destroy();
      }
      interactPrompt = new Text({
        text: '[ E ]',
        style: new TextStyle({
          fontFamily: 'PixelOperator8',
          fontSize: 64, // Render huge so the canvas draws it perfectly sharp
          fill: '#ffffff',
          // A sharp, blocky drop shadow instead of a bubbly round stroke
          dropShadow: {
            alpha: 1,
            blur: 0, // 0 blur keeps the shadow blocky
            color: '#000000',
            distance: 8, // 8px shadow becomes 1px thick when scaled down
            angle: Math.PI / 4
          },
          align: 'center',
        }),
        roundPixels: true,
        resolution: 2, // High resolution prevents any WebGL blur
      });

      // Scale it back down to a native 8px height (64 * 0.125 = 8)
      interactPrompt.scale.set(0.125);
      interactPrompt.anchor.set(0.5, 1.0);
      interactPrompt.visible = false;
      interactPrompt.zIndex = 99999;
      entityLayer.addChild(interactPrompt);

      for (const player of gameState.players) {
        const isLocal = player.id === playerId;
        const data = ensurePlayerSprite(player.id, player.spriteIndex);
        setPlayerAnimation(data, getAnimationKey(player.facing, player.isMoving, player.isDead));
        setRoundedPosition(data.container, player.x, player.y, 1);
        if (!isLocal) knownRemotePlayers.add(player.id);
      }

      snapshotBuffer.push(gameState);
      if (worldContainer.scale.x !== zoomLevel || worldContainer.scale.y !== zoomLevel) {
        worldContainer.scale.set(zoomLevel);
      }
      updateCamera(worldContainer, localX, localY, mapPixelW, mapPixelH, zoomLevel);
      latestServerState = gameState;
      if (debugUi) updateDebugUI(debugUi, gameState, playerId, true);
    },

    onTickUpdate: (gameState) => {
      const localPlayerId = net.playerId;
      snapshotBuffer.push(gameState);

      const localPlayerData = gameState.players.find((p) => p.id === localPlayerId);
      if (localPlayerData) {
        const data = ensurePlayerSprite(localPlayerData.id, localPlayerData.spriteIndex);

        if (!debugTeleportActive) {
          // Compute reconciled position from server state + pending input replay
          let reconciledX = localPlayerData.x;
          let reconciledY = localPlayerData.y;

          pendingInputs = pendingInputs.filter(
            (input) => input.sequenceNumber > localPlayerData.lastProcessedInput,
          );

          for (const input of pendingInputs) {
            const result = applyInputWithCollision(reconciledX, reconciledY, input, input.dt, currentMap!, latestServerState?.portal);
            reconciledX = result.x;
            reconciledY = result.y;
          }

          // Smooth the correction to hide jitter
          const cdx = reconciledX - localX;
          const cdy = reconciledY - localY;
          const correctionDistSq = cdx * cdx + cdy * cdy;

          // Hard snap if correction is large (teleport/respawn), smooth otherwise
          if (correctionDistSq > 25) { // > 5 pixels
            localX = reconciledX;
            localY = reconciledY;
          } else {
            localX = localX + cdx * 0.3;
            localY = localY + cdy * 0.3;
          }
        }

        setRoundedPosition(data.container, localX, localY, 1);
      }

      knownRemotePlayers.clear();
      for (const player of gameState.players) {
        if (player.id !== localPlayerId) {
          knownRemotePlayers.add(player.id);
          ensurePlayerSprite(player.id, player.spriteIndex);
        }
      }

      const activeIds = new Set(gameState.players.map((p) => p.id));
      for (const [id] of playerSprites) {
        if (!activeIds.has(id)) {
          removePlayerSprite(id);
          knownRemotePlayers.delete(id);
        }
      }

      latestServerState = gameState;
      if (debugUi) updateDebugUI(debugUi, gameState, localPlayerId);
    },

    onPlayerLeft: (playerId) => {
      console.info(`[Main] Player left: ${playerId}`);
      removePlayerSprite(playerId);
      knownRemotePlayers.delete(playerId);
    },

    onRunestoneActivated: (runestoneIndex) => {
      console.info(`[Main] Runestone ${runestoneIndex} activated!`);
      const rsData = tilemapRenderer?.runestoneSprites.find((r) => r.index === runestoneIndex);
      if (rsData && !rsData.activated) {
        rsData.activated = true;
        rsData.sprite.texture = assets.runestoneTextures[runestoneIndex][1];
      }
    },

    onAllRunestonesActivated: (portalX, portalY) => {
      console.info(`[Main] All runestones activated! Portal at (${Math.round(portalX)}, ${Math.round(portalY)})`);
      // Start screen shake — portal will spawn after shake completes
      shakeTimeRemaining = SHAKE_DURATION;
      pendingPortalPos = { x: portalX, y: portalY };
    },

    onWisdomOrbUsed: (direction, remainingWisdomOrbs) => {
      console.info(`[WisdomOrb][Response] Server accepted! direction=${direction}, remaining=${remainingWisdomOrbs}`);
      wisdomOrbHud?.setRemaining(remainingWisdomOrbs);
      wisdomArrow?.show(direction);
    },

    onPlayerRoleChanged: (role, wisdomOrbs) => {
      console.info(`[Main] Debug role changed to ${role}`);
      applyLocalRoleUi(role, wisdomOrbs, false);
    },

    onError: (code, message) => {
      console.error(`[Main] Server error [${code}]: ${message}`);
      if (statusEl) {
        statusEl.textContent = `🔴 Error: ${message}`;
        statusEl.classList.add('error');
      }
    },

    onGateStateChanged: (gateIndex, open) => {
      console.info(`[Main] Gate ${gateIndex} ${open ? 'OPENED' : 'CLOSED'}`);
      if (currentLayout && currentMap && tilemapRenderer) {
        applyGateState(gateIndex, open, currentLayout.gates, currentMap, tilemapRenderer, assets);
      }
    },

    onDisconnect: () => {
      console.info('[Main] Disconnected from server');
      minimap?.closeExpanded();
      localPlayerRole = null;
      mobileControls.setWisdomAvailable(false);
      if (statusEl) {
        statusEl.textContent = '🔴 Disconnected';
        statusEl.classList.remove('connected');
        statusEl.classList.add('error');
      }
    },
  });

  if (debugUi) {
    setupDebugPlayerActions(debugUi, net, () => latestServerState, () => net.playerId);
  }

  // ── Interaction Helpers + Mobile Controls ────────────────────────────

  const triggerUseWisdomOrb = (source: 'Click' | 'KeyQ' | 'MobileQ'): void => {
    console.info(`[WisdomOrb][${source}] Triggered. localPlayerInitialized=${localPlayerInitialized}, isConnected=${net.isConnected}`);
    if (!localPlayerInitialized) {
      console.warn(`[WisdomOrb][${source}] BLOCKED: local player not initialized`);
      return;
    }
    if (!net.isConnected) {
      console.warn(`[WisdomOrb][${source}] BLOCKED: not connected`);
      return;
    }
    if (localPlayerRole !== 'survivor') {
      console.warn(`[WisdomOrb][${source}] BLOCKED: local role has no wisdom orbs`);
      return;
    }
    if (minimap?.isExpanded()) {
      console.warn(`[WisdomOrb][${source}] BLOCKED: warden map is open`);
      return;
    }
    console.info(`[WisdomOrb][${source}] Sending USE_WISDOM_ORB, player at (${localX.toFixed(1)}, ${localY.toFixed(1)})`);
    net.sendUseWisdomOrb();
  };

  const triggerInteract = (): void => {
    if (minimap?.isExpanded()) return;

    if (introDialogueHud?.isVisible()) {
      introDialogueHud.advance();
      return;
    }

    if (!localPlayerInitialized || !tilemapRenderer) return;

    const INTERACT_RANGE = 28;
    const INTERACT_RANGE_SQ = INTERACT_RANGE * INTERACT_RANGE;
    for (const rs of tilemapRenderer.runestoneSprites) {
      if (rs.activated) continue;
      const rsCenterX = rs.tileX * TILE_SIZE + TILE_SIZE / 2;
      const rsCenterY = (rs.tileY + 1) * TILE_SIZE;
      const dx = localX - rsCenterX;
      const dy = localY - rsCenterY;
      const distSq = dx * dx + dy * dy;
      if (distSq < INTERACT_RANGE_SQ) {
        net.sendActivateRunestone(rs.index);
        break;
      }
    }
  };

  const mobileControls = new MobileControls({
    parent: container,
    onDirectionChange: (direction: MobileControlDirection, pressed: boolean) => {
      setTouchDirection(direction, pressed);
    },
    onInteract: () => {
      triggerInteract();
    },
    onUseWisdom: () => {
      triggerUseWisdomOrb('MobileQ');
    },
  });
  mobileControls.setWisdomAvailable(false);

  applyLocalRoleUi = (role, wisdomOrbs, showIntroDialogue) => {
    localPlayerRole = role;
    if (!currentMap || !currentLayout) return;

    minimap?.destroy();
    minimap = new Minimap(
      currentMap,
      currentLayout.dirtMask,
      INTERNAL_WIDTH,
      INTERNAL_HEIGHT,
      {
        isWarden: role === 'warden',
      },
    );
    minimap.addToStage(app.stage);
    if (latestServerState?.portal) {
      minimap.setPortalPosition(latestServerState.portal.x, latestServerState.portal.y);
    }

    wisdomOrbHud?.destroy();
    wisdomOrbHud = null;
    wisdomArrow?.destroy();
    wisdomArrow = null;
    mobileControls.setWisdomAvailable(role === 'survivor');

    if (role === 'survivor') {
      wisdomOrbHud = new WisdomOrbHud(assets.wisdomOrbTexture, () => {
        triggerUseWisdomOrb('Click');
      });
      wisdomOrbHud.addToStage(app.stage);
      wisdomOrbHud.setRemaining(wisdomOrbs);
      wisdomArrow = new WisdomArrow(entityLayer);
    }

    introDialogueHud?.destroy();
    introDialogueHud = null;
    if (showIntroDialogue) {
      introDialogueHud = new IntroDialogueHud(
        INTERNAL_WIDTH,
        INTERNAL_HEIGHT,
        role === 'warden' ? WARDEN_SPAWN_DIALOGUE_PAGES : SURVIVOR_SPAWN_DIALOGUE_PAGES,
      );
      introDialogueHud.addToStage(app.stage);
    }
  };

  window.addEventListener('beforeunload', () => mobileControls.destroy(), { once: true });

  // ── 60 FPS Game Loop ──────────────────────────────────────────────────
  app.ticker.add((ticker) => {
    if (!net.isConnected || !localPlayerInitialized || !net.playerId) return;

    // Cap dt to prevent massive physics jumps when mobile browsers drop frames
    const dtSeconds = Math.min(ticker.deltaMS / 1000, 0.1);
    const now = performance.now();

    // ── 1. Local player prediction ────────────────────────────────
    const localPlayerState = latestServerState?.players.find((player) => player.id === net.playerId);
    const isLocalDead = localPlayerState?.isDead ?? false;
    const isMoving = activeKeys.up || activeKeys.down || activeKeys.left || activeKeys.right;
    if (isMoving) {
      localFacing = deriveFacingFromKeys();
      inputSequenceNumber++;

      const input: PendingInput = {
        sequenceNumber: inputSequenceNumber,
        up: activeKeys.up,
        down: activeKeys.down,
        left: activeKeys.left,
        right: activeKeys.right,
        dt: dtSeconds,
      };

      const result = applyInputWithCollision(localX, localY, input, dtSeconds, currentMap!, latestServerState?.portal);
      localX = result.x;
      localY = result.y;

      pendingInputs.push(input);

      net.sendInput(input.sequenceNumber, input.up, input.down, input.left, input.right, dtSeconds);
    }

    const localData = playerSprites.get(net.playerId);
    if (localData) {
      setRoundedPosition(localData.container, localX, localY, 1);

      const localAnimKey = getAnimationKey(localFacing, isMoving, isLocalDead);
      setPlayerAnimation(localData, localAnimKey);
    }

    // ── 2. Remote player interpolation ────────────────────────────
    const renderTime = now - INTERPOLATION_DELAY;
    const interpolationPair = snapshotBuffer.getInterpolationPair(renderTime);
    const latestSnapshot = snapshotBuffer.getLatest();

    for (const remoteId of knownRemotePlayers) {
      const data = playerSprites.get(remoteId);
      if (!data) continue;

      const interp = getInterpolatedPlayer(remoteId, interpolationPair, latestSnapshot);
      if (interp) {
        setRoundedPosition(data.container, interp.x, interp.y, 1);

        const remoteAnimKey = getAnimationKey(interp.facing, interp.isMoving, interp.isDead);
        setPlayerAnimation(data, remoteAnimKey);
      }
    }

    // ── 3. Camera follow + zoom ─────────────────────────────────────
    if (worldContainer.scale.x !== zoomLevel || worldContainer.scale.y !== zoomLevel) {
      worldContainer.scale.set(zoomLevel);
    }

    // Determine camera target: player normally, or cinematic override
    let camTargetX = localX;
    let camTargetY = localY;
    if (cinematicPhase !== 'idle') {
      camTargetX = cinematicTargetX;
      camTargetY = cinematicTargetY;
    }
    updateCamera(worldContainer, camTargetX, camTargetY, mapPixelW, mapPixelH, zoomLevel);

    // ── 3b. Viewport culling — hide off-screen tilemap chunks ────────
    if (tilemapRenderer) {
      tilemapRenderer.updateVisibility(worldContainer.x, worldContainer.y, zoomLevel);
    }
    if (cellBoundaryOverlay) {
      cellBoundaryOverlay.visible = DebugSettings.isEnabled('cellBoundaries');
    }

    // ── 4. Minimap ────────────────────────────────────────────────────
    if (minimap) minimap.update(localX, localY);
    introDialogueHud?.update(dtSeconds);
    wisdomArrow?.update(dtSeconds, localX, localY);

    // ── 4b. Screen shake ────────────────────────────────────────────
    if (shakeTimeRemaining > 0) {
      shakeTimeRemaining -= dtSeconds;
      // Exponentially decaying shake intensity
      const progress = Math.max(0, shakeTimeRemaining / SHAKE_DURATION);
      const intensity = SHAKE_MAX_INTENSITY * progress;
      const shakeX = Math.round((Math.random() * 2 - 1) * intensity);
      const shakeY = Math.round((Math.random() * 2 - 1) * intensity);
      worldContainer.x += shakeX;
      worldContainer.y += shakeY;

      // When shake ends, instantly teleport camera to portal and spawn it
      if (shakeTimeRemaining <= 0 && pendingPortalPos) {
        // Spawn portal
        portal?.destroy();
        portal = new Portal(
          pendingPortalPos.x,
          pendingPortalPos.y,
          assets.portalFrames,
          assets.portalEmergenceCount,
          entityLayer,
          false, // play emergence animation
        );
        minimap?.setPortalPosition(pendingPortalPos.x, pendingPortalPos.y);
        // Instant camera jump to portal (no directional clues)
        cinematicPhase = 'watch_portal';
        cinematicElapsed = 0;
        cinematicTargetX = pendingPortalPos.x;
        cinematicTargetY = pendingPortalPos.y;
        pendingPortalPos = null;
      }
    }

    // ── 4c. Cinematic camera: watch portal then snap back ───────────
    if (cinematicPhase === 'watch_portal') {
      cinematicElapsed += dtSeconds;
      if (cinematicElapsed >= WATCH_DURATION) {
        // Instant snap back to player
        cinematicPhase = 'idle';
        cinematicElapsed = 0;
      }
    }

    // ── 4d. Portal animation ────────────────────────────────────────
    if (portal) {
      portal.update(dtSeconds);
    }

    // ── 4e. Gate slide animations ────────────────────────────────────
    updateGateSlideAnimations(dtSeconds);

    // ── 5. Runestone interaction prompt ──────────────────────────────
    if (interactPrompt && tilemapRenderer) {
      let nearestRS: RunestoneSpriteData | null = null;
      let nearestDistSq = Infinity;
      const INTERACT_RANGE = 28; // ~1.75 tiles in pixels
      const INTERACT_RANGE_SQ = INTERACT_RANGE * INTERACT_RANGE;

      for (const rs of tilemapRenderer.runestoneSprites) {
        if (rs.activated) continue;
        const rsCenterX = rs.tileX * TILE_SIZE + TILE_SIZE / 2;
        const rsCenterY = (rs.tileY + 1) * TILE_SIZE;
        const dx = localX - rsCenterX;
        const dy = localY - rsCenterY;
        const distSq = dx * dx + dy * dy;
        if (distSq < INTERACT_RANGE_SQ && distSq < nearestDistSq) {
          nearestDistSq = distSq;
          nearestRS = rs;
        }
      }

      if (nearestRS) {
        if (!interactPrompt.visible) interactPrompt.visible = true;
        if (interactPrompt.x !== nearestRS.sprite.x) interactPrompt.x = nearestRS.sprite.x;
        const promptY = nearestRS.sprite.y - 34;
        if (interactPrompt.y !== promptY) interactPrompt.y = promptY; // above the runestone
        if (interactPrompt.zIndex !== 99999) interactPrompt.zIndex = 99999;
      } else {
        if (interactPrompt.visible) interactPrompt.visible = false;
      }
    }

    // ── 6. Pressure plate animations ───────────────────────────────────
    if (tilemapRenderer && latestServerState) {
      updatePressurePlateAnimations(tilemapRenderer, latestServerState, dtSeconds, assets);
    }
  });

  // ── Mousewheel Zoom (debug) ───────────────────────────────────────────
  app.canvas.addEventListener('wheel', (e: WheelEvent) => {
    e.preventDefault();
    if (!DebugSettings.isEnabled('scrollZoom')) return;
    if (e.deltaY < 0) zoomLevel = Math.min(MAX_ZOOM, zoomLevel + ZOOM_STEP);
    else zoomLevel = Math.max(MIN_ZOOM, zoomLevel - ZOOM_STEP);
    zoomToggleState = 'default'; // manual scroll resets the toggle cycle
  }, { passive: false });

  // ── Minus-key Zoom Toggle (debug) ─────────────────────────────────────
  // Cycles:  default → fully zoomed-out → fully zoomed-in → default
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.code !== 'Minus' && e.code !== 'NumpadSubtract') return;
    if (!DebugSettings.isEnabled('zoomToggle')) return;

    switch (zoomToggleState) {
      case 'default':
        zoomLevel = MIN_ZOOM;
        zoomToggleState = 'zoomed-out';
        break;
      case 'zoomed-out':
        zoomLevel = MAX_ZOOM;
        zoomToggleState = 'zoomed-in';
        break;
      case 'zoomed-in':
        zoomLevel = savedZoomBeforeToggle;
        zoomToggleState = 'default';
        break;
    }
  });

  // ── Click-to-Teleport (debug) ─────────────────────────────────────────
  app.canvas.addEventListener('click', (e: MouseEvent) => {
    if (minimap?.shouldBlockCanvasClick()) return;
    if (!DebugSettings.isEnabled('clickTeleport')) return;
    if (!localPlayerInitialized || !currentMap) return;

    // Convert screen click → internal resolution → world coordinates
    const rect = app.canvas.getBoundingClientRect();
    const scaleX = INTERNAL_WIDTH / rect.width;
    const scaleY = INTERNAL_HEIGHT / rect.height;

    const screenX = (e.clientX - rect.left) * scaleX;
    const screenY = (e.clientY - rect.top) * scaleY;

    // Invert camera transform: worldPos = (screenPos - container.position) / zoom
    const worldX = (screenX - worldContainer.x) / zoomLevel;
    const worldY = (screenY - worldContainer.y) / zoomLevel;

    // Clamp to map bounds
    const clampedX = Math.max(0, Math.min(mapPixelW, worldX));
    const clampedY = Math.max(0, Math.min(mapPixelH, worldY));

    localX = clampedX;
    localY = clampedY;
    debugTeleportActive = true;
    if (debugTeleportResetTimer !== null) clearTimeout(debugTeleportResetTimer);
    debugTeleportResetTimer = setTimeout(() => {
      debugTeleportActive = false;
      debugTeleportResetTimer = null;
    }, 250);

    // Notify server of the new position so proximity checks work
    net.sendDebugTeleport(clampedX, clampedY);

    // Immediately update sprite
    const localData = playerSprites.get(net.playerId!);
    if (localData) {
      setRoundedPosition(localData.container, localX, localY, 1);
    }

    console.info(`[Debug] Teleported to (${Math.round(clampedX)}, ${Math.round(clampedY)})`);
  });

  // ── Keyboard Input ────────────────────────────────────────────────────
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.code === 'Escape' && minimap?.isExpanded()) {
      e.preventDefault();
      minimap.closeExpanded();
      return;
    }

    const dir = KEY_MAP[e.code];
    if (dir) setKeyboardDirection(dir, true);

    // The expanded warden map remains modal for actions, but movement stays active.
    if (minimap?.isExpanded()) return;

    if (e.code === 'KeyQ' && !e.repeat) {
      triggerUseWisdomOrb('KeyQ');
    }

    if (e.code === 'KeyE') {
      const introVisible = introDialogueHud?.isVisible() ?? false;
      if (!e.repeat || !introVisible) {
        triggerInteract();
      }
      return;
    }

  });

  window.addEventListener('keyup', (e: KeyboardEvent) => {
    const dir = KEY_MAP[e.code];
    if (dir) setKeyboardDirection(dir, false);
  });

  window.addEventListener('blur', () => {
    resetKeyboardInput();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) resetKeyboardInput();
  });

  // ── Connect to Server ─────────────────────────────────────────────────
  const envUrl = import.meta.env.VITE_SERVER_URL;
  // In development, connect straight to the game server. This avoids routing
  // the long-lived game socket through Vite's HMR server/proxy. uWebSockets is
  // bound to IPv4, so normalise localhost to IPv4 instead of relying on a
  // browser's IPv4/IPv6 resolution preference (which differs in Chrome).
  const devServerHost = window.location.hostname === 'localhost'
    ? '127.0.0.1'
    : window.location.hostname;
  const defaultWsUrl = import.meta.env.DEV
    ? `ws://${devServerHost}:9001/ws`
    : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;
  const wsUrl = envUrl || defaultWsUrl;
  const displayName = `Explorer-${Math.floor(Math.random() * 9999).toString().padStart(4, '0')}`;

  net.connect(wsUrl, 'default', displayName);

  console.info('─────────────────────────────────────────────────');
  console.info('  🏰 Labyrinth 2D Client');
  console.info('  Step 9: 2.5D Perspective (Stardew style walls)');
  console.info(`  Map: ${MAZE_WIDTH}×${MAZE_HEIGHT} tiles (${mapPixelW}×${mapPixelH} px)`);
  console.info(`  Display name: ${displayName}`);
  console.info('─────────────────────────────────────────────────');
}

main().catch(console.error);
