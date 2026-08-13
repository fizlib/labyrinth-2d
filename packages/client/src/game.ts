// packages/client/src/game.ts
// ─────────────────────────────────────────────────────────────────────────────
// False Arrow — Client Entry Point
// Step 9: 2.5D Perspective, Feet-Based Collision, Multi-Layer Tiles
// ─────────────────────────────────────────────────────────────────────────────

import {
  Application,
  AnimatedSprite,
  Container,
  Text,
  TextStyle,
  TextureStyle,
  Graphics,
} from 'pixi.js';

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
  MAX_WISDOM_ORBS,
  CHEST_INTERACTION_RANGE,
  PRESSURE_PLATE_INTERACTION_RANGE,
  PLAYER_CHARACTER_NAMES,
  SQUAD_COLORS,
  generateMazeLayout,
  applyInputWithCollision,
  getPlayerSwampTerrain,
  findSwordFieldWisdomTarget,
  findTrapCellInteractionTarget,
  findActivePlayerCage,
  findOpenableCage,
  getCageInteractionPoint,
  deriveFacingDirection,
  isWithinPortalInteractionRange,
} from '@labyrinth/shared';
import type {
  GameState,
  TileMapData,
  FacingDirection,
  GatePlacement,
  GeneratedMazeLayout,
  PlayerRole,
  SwampTerrain,
  CageState,
} from '@labyrinth/shared';
import { NetworkManager } from './net/NetworkManager';
import {
  clearReconnectSession,
  RELEASE_ROOM_EVENT,
  type ReconnectSession,
} from './net/ReconnectSession';
import {
  SnapshotBuffer,
  INTERPOLATION_DELAY,
  type TimestampedSnapshot,
} from './net/SnapshotBuffer';
import { loadAssets, type GameAssets } from './assets/AssetLoader';
import { DebugSettings } from './config/DebugSettings';
import { Minimap } from './systems/Minimap';
import { TilemapRenderer } from './systems/TilemapRenderer';
import { Portal } from './systems/Portal';
import { PortalPlatform } from './systems/PortalPlatform';
import { getPortalPlatformPlayerZFloor } from './systems/PortalPlatformLayout';
import { WisdomOrbHud } from './systems/WisdomOrbHud';
import { WisdomArrow } from './systems/WisdomArrow';
import { IntroDialogueHud } from './systems/IntroDialogueHud';
import { MobileControls, type MobileControlDirection } from './systems/MobileControls';
import { CageVisual } from './systems/Cage';
import { ProximityChatHud } from './systems/ProximityChatHud';
import { MatchHud } from './systems/MatchHud';
import { GameMenuHud } from './systems/GameMenuHud';
import { LobbyOverlay } from './systems/LobbyOverlay';
import { ReconnectOverlay } from './systems/ReconnectOverlay';

// ── Player sprite dimensions ────────────────────────────────────────────────
const SURVIVOR_SPAWN_DIALOGUE_PAGES = [
  'You have been cast into the Maze. Scattered and alone, find your way to the heart of the labyrinth — where other survivors await.',
  'Together, activate the three ancient runes to unlock the portal and escape… before the Maze claims you forever.',
];

const WARDSTONES_ACTIVATED_CHAT_MESSAGE =
  'All wardstones have been activated. The escape portal is now open!';

const WARDEN_SPAWN_DIALOGUE_PAGES = [
  'You are a Warden. Keep your role hidden from the survivors.',
  'Your goal is to delay and misdirect the survivors until time runs out. Use your complete map to lead them astray.',
];

const SWORD_FIELD_WISDOM_REQUIRED_DIALOGUE_PAGES = [
  'You need to find a Wisdom Orb to pass this sword field. Search the Maze, then return and press Q.',
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
  // Preserve the existing additive input policy: keyboard and mobile movement may
  // coexist, and releasing either source does not cancel the direction held by the other.
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

function resetAllInput(): void {
  clearMoveState(keyboardKeys);
  clearMoveState(touchKeys);
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
let localWisdomOrbs = 0;
let localFacing: FacingDirection = 'down';

/** Briefly suppress reconciliation while a click-teleport reaches the server. */
let debugTeleportActive = false;
let debugTeleportResetTimer: ReturnType<typeof setTimeout> | null = null;

let currentMap: TileMapData | null = null;
let currentMapSeed: number | null = null;
const snapshotBuffer = new SnapshotBuffer();

let minimap: Minimap | null = null;
let tilemapRenderer: TilemapRenderer | null = null;
let cellBoundaryOverlay: Graphics | null = null;

/** Current layout data for gate/pressure plate reference. */
let currentLayout: GeneratedMazeLayout | null = null;

/** Pressure plate animation speed (frames per second). */
const PLATE_ANIM_SPEED = 12;

const SURVIVOR_INTERACT_PROMPT_COLOR = '#ffffff';
const WARDEN_INTERACT_PROMPT_COLOR = '#ef3434';

/** Floating "Press E" interaction prompt */
let interactPrompt: Text | null = null;

const EMPTY_TRAP_PROMPT_SHAKE_DURATION = 0.45;
let emptyTrapPromptShakeRemaining = 0;
let emptyTrapPromptShakeElapsed = 0;

function getInteractPromptColor(role: PlayerRole | null): string {
  return role === 'warden'
    ? WARDEN_INTERACT_PROMPT_COLOR
    : SURVIVOR_INTERACT_PROMPT_COLOR;
}

/** Portal instance, present from the beginning and lit after rune activation. */
let portal: Portal | null = null;

/** Raised portal clearing and stair platform, present with the inactive portal. */
let portalPlatform: PortalPlatform | null = null;

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

/** Pending portal position to activate after the shake completes. */
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

function isLandscapeTouchViewport(viewportW: number, viewportH: number): boolean {
  return (
    viewportW > viewportH &&
    window.matchMedia('(hover: none) and (pointer: coarse)').matches
  );
}

function getViewportScale(viewportW: number, viewportH: number): number {
  const fitScale = Math.min(viewportW / INTERNAL_WIDTH, viewportH / INTERNAL_HEIGHT);
  // Landscape phones often fit between two integer scale steps. Let the fixed
  // game surface grow fluidly to the viewport height instead of leaving large
  // letterbox bands above and below it. The internal resolution (and therefore
  // the visible field) remains unchanged.
  if (isLandscapeTouchViewport(viewportW, viewportH)) {
    return fitScale;
  }
  if (fitScale >= 1) {
    return Math.max(1, Math.floor(fitScale));
  }
  return fitScale;
}

const IOS_FULLSCREEN_SCALE_STORAGE_KEY = 'labyrinth-ios-fullscreen-scale';
let fullscreenCanvasScale: number | null = null;

interface AppleNavigator extends Navigator {
  standalone?: boolean;
}

interface WebkitFullscreenDocument extends Document {
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitFullscreenElement?: Element | null;
}

interface WebkitFullscreenElement extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void> | void;
}

function isAppleMobileDevice(): boolean {
  return (
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

function isAppleStandaloneMode(): boolean {
  return (
    Boolean((navigator as AppleNavigator).standalone) ||
    window.matchMedia('(display-mode: standalone)').matches
  );
}

function getFullscreenElement(): Element | null {
  const webkitDocument = document as WebkitFullscreenDocument;
  return document.fullscreenElement ?? webkitDocument.webkitFullscreenElement ?? null;
}

function saveIosFullscreenScale(app: Application): void {
  const canvasRect = app.canvas.getBoundingClientRect();
  const scale = Math.min(
    canvasRect.width / INTERNAL_WIDTH,
    canvasRect.height / INTERNAL_HEIGHT,
  );

  try {
    window.localStorage.setItem(IOS_FULLSCREEN_SCALE_STORAGE_KEY, String(scale));
  } catch {
    // Standalone mode still works when private browsing blocks local storage.
  }
}

function getSavedIosFullscreenScale(): number | null {
  if (!isAppleMobileDevice() || !isAppleStandaloneMode()) return null;

  try {
    const scale = Number(window.localStorage.getItem(IOS_FULLSCREEN_SCALE_STORAGE_KEY));
    return Number.isFinite(scale) && scale > 0 ? scale : null;
  } catch {
    return null;
  }
}

function resizeCanvas(app: Application): void {
  const viewportScale = getViewportScale(window.innerWidth, window.innerHeight);
  // A scale remembered while opening iOS standalone mode must not pin a phone
  // to its smaller portrait/browser size after it rotates to landscape.
  const isLandscapeTouch = isLandscapeTouchViewport(
    window.innerWidth,
    window.innerHeight,
  );
  const scale =
    fullscreenCanvasScale === null || isLandscapeTouch
      ? viewportScale
      : Math.min(viewportScale, fullscreenCanvasScale);

  app.canvas.style.width = `${INTERNAL_WIDTH * scale}px`;
  app.canvas.style.height = `${INTERNAL_HEIGHT * scale}px`;
  app.renderer.resize(INTERNAL_WIDTH, INTERNAL_HEIGHT);
}

function setupFullscreenToggle(app: Application): void {
  const button = document.querySelector<HTMLButtonElement>('#fullscreen-toggle');
  if (!button) return;

  const webkitDocument = document as WebkitFullscreenDocument;
  const fullscreenRoot = document.documentElement as WebkitFullscreenElement;
  const supportsStandardFullscreen =
    document.fullscreenEnabled && typeof fullscreenRoot.requestFullscreen === 'function';
  const supportsWebkitFullscreen =
    typeof fullscreenRoot.webkitRequestFullscreen === 'function';
  const isAppleMobile = isAppleMobileDevice();

  const helpDialog = document.querySelector<HTMLDivElement>('#ios-fullscreen-help');
  const helpTitle = document.querySelector<HTMLHeadingElement>(
    '#ios-fullscreen-help-title',
  );
  const helpMessage = document.querySelector<HTMLParagraphElement>(
    '#ios-fullscreen-help-message',
  );
  const helpSteps = document.querySelector<HTMLOListElement>(
    '#ios-fullscreen-help-steps',
  );
  const helpClose = document.querySelector<HTMLButtonElement>(
    '#ios-fullscreen-help-close',
  );
  const helpOk = document.querySelector<HTMLButtonElement>('#ios-fullscreen-help-ok');
  let helpPreviouslyFocused: HTMLElement | null = null;

  const closeIosFullscreenHelp = (): void => {
    if (!helpDialog || helpDialog.hidden) return;
    helpDialog.hidden = true;
    helpPreviouslyFocused?.focus();
  };

  const openIosFullscreenHelp = (standalone: boolean): void => {
    if (!helpDialog || !helpTitle || !helpMessage || !helpSteps || !helpOk) return;

    helpPreviouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : button;
    helpTitle.textContent = standalone
      ? 'Exit fullscreen on iPhone'
      : 'Fullscreen on iPhone';
    helpMessage.textContent = standalone
      ? 'Swipe up from the bottom edge to close the fullscreen game or switch apps.'
      : 'Safari can open this game fullscreen from your Home Screen.';
    helpSteps.hidden = standalone;
    helpDialog.hidden = false;
    helpOk.focus();
  };

  helpClose?.addEventListener('click', closeIosFullscreenHelp);
  helpOk?.addEventListener('click', closeIosFullscreenHelp);
  helpDialog?.addEventListener('click', (event) => {
    if (event.target === helpDialog) closeIosFullscreenHelp();
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeIosFullscreenHelp();
  });

  if (!supportsStandardFullscreen && !supportsWebkitFullscreen && isAppleMobile) {
    const isStandalone = isAppleStandaloneMode();
    button.classList.toggle('is-fullscreen', isStandalone);
    button.setAttribute('aria-pressed', String(isStandalone));
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute(
      'aria-label',
      isStandalone ? 'Exit fullscreen' : 'Enter fullscreen',
    );
    button.title = isStandalone ? 'Exit fullscreen' : 'Enter fullscreen';
    button.addEventListener('click', () => {
      if (!isStandalone) saveIosFullscreenScale(app);
      openIosFullscreenHelp(isStandalone);
    });
    return;
  }

  if (!supportsStandardFullscreen && !supportsWebkitFullscreen) {
    button.hidden = true;
    return;
  }

  const syncFullscreenState = (): void => {
    const isFullscreen = getFullscreenElement() !== null;

    button.classList.toggle('is-fullscreen', isFullscreen);
    button.setAttribute('aria-pressed', String(isFullscreen));
    button.setAttribute(
      'aria-label',
      isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen',
    );
    button.title = isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen';

    if (!isFullscreen) {
      fullscreenCanvasScale = null;
      resizeCanvas(app);
    }
  };

  button.addEventListener('click', async () => {
    button.disabled = true;

    try {
      if (getFullscreenElement()) {
        if (document.fullscreenElement && typeof document.exitFullscreen === 'function') {
          await document.exitFullscreen();
        } else {
          await webkitDocument.webkitExitFullscreen?.();
        }
      } else {
        const canvasRect = app.canvas.getBoundingClientRect();
        fullscreenCanvasScale = Math.min(
          canvasRect.width / INTERNAL_WIDTH,
          canvasRect.height / INTERNAL_HEIGHT,
        );

        if (supportsStandardFullscreen) {
          await fullscreenRoot.requestFullscreen();
        } else {
          await fullscreenRoot.webkitRequestFullscreen?.();
        }

        if (!getFullscreenElement() && isAppleMobile) {
          fullscreenCanvasScale = null;
          resizeCanvas(app);
          saveIosFullscreenScale(app);
          openIosFullscreenHelp(false);
        }
      }
    } catch (error) {
      fullscreenCanvasScale = null;
      resizeCanvas(app);
      if (isAppleMobile) {
        saveIosFullscreenScale(app);
        openIosFullscreenHelp(false);
      } else {
        console.warn('Unable to change fullscreen mode.', error);
      }
    } finally {
      button.disabled = false;
      syncFullscreenState();
    }
  });

  document.addEventListener('fullscreenchange', syncFullscreenState);
  document.addEventListener('webkitfullscreenchange', syncFullscreenState);
  syncFullscreenState();
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

interface BridgeRepairCameraFocus {
  x: number;
  y: number;
}

const BRIDGE_CAMERA_EASE_DURATION = 0.45;
const BRIDGE_CAMERA_WIDTH_TILES = 8;
const BRIDGE_CAMERA_HEIGHT_TILES = 10;

/** Center the authored bridge while the local player channels its repair. */
function getBridgeRepairCameraFocus(
  layout: GeneratedMazeLayout | null,
  state: GameState | null,
  playerId: string,
): BridgeRepairCameraFocus | null {
  if (!layout || !state) return null;

  const repairState = state.bridgeStates.find(
    (bridgeState) =>
      bridgeState.repairActive && bridgeState.repairingPlayerId === playerId,
  );
  if (!repairState) return null;

  const bridge = layout.bridges[repairState.bridgeIndex];
  if (!bridge) return null;

  // Include the water-edge tiles that sit outside the six-tile-wide bank.
  const left = (bridge.tileX - 1) * TILE_SIZE;
  const top = bridge.tileY * TILE_SIZE;
  const width = BRIDGE_CAMERA_WIDTH_TILES * TILE_SIZE;
  const height = BRIDGE_CAMERA_HEIGHT_TILES * TILE_SIZE;

  // updateCamera treats targetY as a player's feet and offsets it upward by half a tile.
  return {
    x: left + width / 2,
    y: top + height / 2 + TILE_SIZE / 2,
  };
}

function smoothstep(value: number): number {
  return value * value * (3 - 2 * value);
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

    if (futurePlayer)
      return {
        x: futurePlayer.x,
        y: futurePlayer.y,
        facing: futurePlayer.facing,
        isMoving: futurePlayer.isMoving,
        isDead: futurePlayer.isDead,
      };
    if (pastPlayer)
      return {
        x: pastPlayer.x,
        y: pastPlayer.y,
        facing: pastPlayer.facing,
        isMoving: pastPlayer.isMoving,
        isDead: pastPlayer.isDead,
      };
  }

  if (latest) {
    const player = latest.state.players.find((p) => p.id === playerId);
    if (player)
      return {
        x: player.x,
        y: player.y,
        facing: player.facing,
        isMoving: player.isMoving,
        isDead: player.isDead,
      };
  }

  return null;
}

// ── Animation Helpers ───────────────────────────────────────────────────────

function getAnimationKey(
  facing: FacingDirection,
  isMoving: boolean,
  isDead = false,
): string {
  if (isDead) return 'lying';
  return isMoving ? `walk-${facing}` : `idle-${facing}`;
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
  matchTimerForm: HTMLFormElement;
  matchTimerMinutes: HTMLInputElement;
  matchTimerSeconds: HTMLInputElement;
  setMatchTimerButton: HTMLButtonElement;
  playerList: HTMLUListElement;
  playerActions: HTMLDivElement;
  playerActionName: HTMLElement;
  playerActionMeta: HTMLSpanElement;
  playerSkinSelect: HTMLSelectElement;
  playerSquadSelect: HTMLSelectElement;
  playerRoleSelect: HTMLSelectElement;
  teleportToButton: HTMLButtonElement;
  teleportHereButton: HTMLButtonElement;
  toggleDeadButton: HTMLButtonElement;
}

const DEBUG_UI_UPDATE_INTERVAL_MS = 150;
let lastDebugUiUpdateAt = -Infinity;
let lastDebugPlayerListMarkup = '';
let selectedDebugPlayerId: string | null = null;
const debugPlayerRoles = new Map<string, PlayerRole>();

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

function getSquadDisplayName(teamId: number): string {
  const color = SQUAD_COLORS[teamId];
  return color ? `${color[0].toUpperCase()}${color.slice(1)}` : `Squad ${teamId + 1}`;
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
      <h1>🏹 False Arrow — Network Debug</h1>
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
      <h2>Match Timer</h2>
      <form class="debug-match-timer" id="debug-match-timer">
        <label>
          <span>Min</span>
          <input id="debug-match-minutes" type="number" min="0" max="1439" step="1" value="10" inputmode="numeric" aria-label="Match timer minutes">
        </label>
        <span class="debug-time-separator">:</span>
        <label>
          <span>Sec</span>
          <input id="debug-match-seconds" type="number" min="0" max="59" step="1" value="0" inputmode="numeric" aria-label="Match timer seconds">
        </label>
        <button id="debug-set-match-timer" type="submit">Set</button>
      </form>
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
          <label class="debug-player-select-control">
            <span>Character skin</span>
            <select id="debug-player-skin-select">
              ${PLAYER_CHARACTER_NAMES.map((name, index) => `<option value="${index}">${name}</option>`).join('')}
            </select>
          </label>
          <label class="debug-player-select-control">
            <span>Squad</span>
            <select id="debug-player-squad-select">
              ${SQUAD_COLORS.map((_, index) => `<option value="${index}">${getSquadDisplayName(index)}</option>`).join('')}
            </select>
          </label>
          <label class="debug-player-select-control">
            <span>Role</span>
            <select id="debug-player-role-select">
              <option value="" disabled>Loading…</option>
              <option value="survivor">Survivor</option>
              <option value="warden">Warden</option>
            </select>
          </label>
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
  const matchTimerForm = debugDiv.querySelector<HTMLFormElement>(
    '#debug-match-timer',
  );
  const matchTimerMinutes = debugDiv.querySelector<HTMLInputElement>(
    '#debug-match-minutes',
  );
  const matchTimerSeconds = debugDiv.querySelector<HTMLInputElement>(
    '#debug-match-seconds',
  );
  const setMatchTimerButton = debugDiv.querySelector<HTMLButtonElement>(
    '#debug-set-match-timer',
  );
  const playerList = debugDiv.querySelector<HTMLUListElement>('#player-list');
  const playerActions = debugDiv.querySelector<HTMLDivElement>('#debug-player-actions');
  const playerActionName = debugDiv.querySelector<HTMLElement>(
    '#debug-player-action-name',
  );
  const playerActionMeta = debugDiv.querySelector<HTMLSpanElement>(
    '#debug-player-action-meta',
  );
  const playerSkinSelect = debugDiv.querySelector<HTMLSelectElement>(
    '#debug-player-skin-select',
  );
  const playerSquadSelect = debugDiv.querySelector<HTMLSelectElement>(
    '#debug-player-squad-select',
  );
  const playerRoleSelect = debugDiv.querySelector<HTMLSelectElement>(
    '#debug-player-role-select',
  );
  const teleportToButton =
    debugDiv.querySelector<HTMLButtonElement>('#debug-teleport-to');
  const teleportHereButton =
    debugDiv.querySelector<HTMLButtonElement>('#debug-teleport-here');
  const toggleDeadButton =
    debugDiv.querySelector<HTMLButtonElement>('#debug-toggle-dead');

  if (
    !status ||
    !tick ||
    !pending ||
    !snapshot ||
    !matchTimerForm ||
    !matchTimerMinutes ||
    !matchTimerSeconds ||
    !setMatchTimerButton ||
    !playerList ||
    !playerActions ||
    !playerActionName ||
    !playerActionMeta ||
    !playerSkinSelect ||
    !playerSquadSelect ||
    !playerRoleSelect ||
    !teleportToButton ||
    !teleportHereButton ||
    !toggleDeadButton
  ) {
    throw new Error('Failed to initialize debug UI');
  }

  lastDebugUiUpdateAt = -Infinity;
  lastDebugPlayerListMarkup = '';
  selectedDebugPlayerId = null;
  debugPlayerRoles.clear();

  return {
    root: debugDiv,
    status,
    tick,
    pending,
    snapshot,
    matchTimerForm,
    matchTimerMinutes,
    matchTimerSeconds,
    setMatchTimerButton,
    playerList,
    playerActions,
    playerActionName,
    playerActionMeta,
    playerSkinSelect,
    playerSquadSelect,
    playerRoleSelect,
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
  const player = state.players.find(
    (candidate) => candidate.id === selectedDebugPlayerId,
  );
  if (!player) {
    selectedDebugPlayerId = null;
    debugUi.playerActions.hidden = true;
    return;
  }

  const skinName =
    PLAYER_CHARACTER_NAMES[player.spriteIndex] ?? `Skin ${player.spriteIndex}`;
  const squadName = getSquadDisplayName(player.teamId);
  const isLocalPlayer = player.id === localPlayerId;
  debugUi.playerActions.hidden = false;
  debugUi.playerActionName.textContent = player.displayName;
  debugUi.playerActionMeta.textContent = `${skinName} · ${squadName} squad · ${player.isDead ? 'dead' : 'alive'}`;
  debugUi.playerSkinSelect.value = String(player.spriteIndex);
  debugUi.playerSquadSelect.value = String(player.teamId);
  const role = debugPlayerRoles.get(player.id);
  debugUi.playerRoleSelect.value = role ?? '';
  debugUi.playerRoleSelect.disabled = role === undefined;
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

  debugUi.matchTimerForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const minutes = Number.parseInt(debugUi.matchTimerMinutes.value, 10);
    const seconds = Number.parseInt(debugUi.matchTimerSeconds.value, 10);
    if (
      !Number.isInteger(minutes) ||
      !Number.isInteger(seconds) ||
      minutes < 0 ||
      minutes > 1439 ||
      seconds < 0 ||
      seconds > 59
    ) {
      return;
    }
    net.sendDebugSetMatchTime((minutes * 60 + seconds) * 1_000);
  });

  debugUi.playerList.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    const playerButton = event.target.closest<HTMLButtonElement>(
      '[data-debug-player-id]',
    );
    if (!playerButton) return;
    selectedDebugPlayerId = playerButton.dataset.debugPlayerId ?? null;
    if (selectedDebugPlayerId) {
      net.sendDebugPlayerAction(selectedDebugPlayerId, 'get-role');
    }
    refresh();
  });

  debugUi.root
    .querySelector<HTMLButtonElement>('#debug-player-actions-close')
    ?.addEventListener('click', () => {
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
        const player = getState()?.players.find(
          (candidate) => candidate.id === selectedDebugPlayerId,
        );
        if (player) {
          net.sendDebugPlayerAction(selectedDebugPlayerId, 'set-dead', {
            dead: !player.isDead,
          });
        }
        break;
      }
    }
  });

  debugUi.playerSkinSelect.addEventListener('change', () => {
    if (!selectedDebugPlayerId) return;
    const spriteIndex = Number.parseInt(debugUi.playerSkinSelect.value, 10);
    if (Number.isInteger(spriteIndex)) {
      net.sendDebugPlayerAction(selectedDebugPlayerId, 'set-skin', { spriteIndex });
    }
  });

  debugUi.playerSquadSelect.addEventListener('change', () => {
    if (!selectedDebugPlayerId) return;
    const teamId = Number.parseInt(debugUi.playerSquadSelect.value, 10);
    if (Number.isInteger(teamId) && teamId >= 0 && teamId < SQUAD_COLORS.length) {
      net.sendDebugPlayerAction(selectedDebugPlayerId, 'set-squad', { teamId });
    }
  });

  debugUi.playerRoleSelect.addEventListener('change', () => {
    if (!selectedDebugPlayerId) return;
    const role = debugUi.playerRoleSelect.value;
    if (role === 'survivor' || role === 'warden') {
      debugPlayerRoles.set(selectedDebugPlayerId, role);
      net.sendDebugPlayerAction(selectedDebugPlayerId, 'set-role', { role });
    }
  });
}

function updateDebugUI(
  debugUi: DebugUiDom,
  state: GameState,
  playerId: string | null,
  force = false,
): void {
  const now = performance.now();
  if (!force && now - lastDebugUiUpdateAt < DEBUG_UI_UPDATE_INTERVAL_MS) return;
  lastDebugUiUpdateAt = now;

  const tickText = state.tick.toString();
  const pendingText = pendingInputs.length.toString();
  const snapshotText = snapshotBuffer.length.toString();

  if (debugUi.tick.textContent !== tickText) debugUi.tick.textContent = tickText;
  if (debugUi.pending.textContent !== pendingText)
    debugUi.pending.textContent = pendingText;
  if (debugUi.snapshot.textContent !== snapshotText)
    debugUi.snapshot.textContent = snapshotText;

  const timerControls = [
    debugUi.matchTimerMinutes,
    debugUi.matchTimerSeconds,
    debugUi.setMatchTimerButton,
  ];
  const matchEnded = state.match.status === 'ended';
  for (const control of timerControls) control.disabled = matchEnded;
  const timerFormFocused = debugUi.matchTimerForm.contains(document.activeElement);
  if (!timerFormFocused) {
    const totalSeconds = Math.ceil(state.match.remainingMs / 1_000);
    debugUi.matchTimerMinutes.value = String(Math.floor(totalSeconds / 60));
    debugUi.matchTimerSeconds.value = String(totalSeconds % 60);
  }

  const playerListMarkup = state.players
    .map((p) => {
      const isYou = p.id === playerId ? ' <span class="you-badge">← you</span>' : '';
      const isSelected = p.id === selectedDebugPlayerId ? ' selected' : '';
      const deadBadge = p.isDead ? '<span class="dead-badge">dead</span>' : '';
      const skinName = PLAYER_CHARACTER_NAMES[p.spriteIndex] ?? `Skin ${p.spriteIndex}`;
      const squadName = getSquadDisplayName(p.teamId);
      return `<li><button type="button" class="debug-player-row${isSelected}" data-debug-player-id="${escapeHtml(p.id)}"><span class="player-name">${escapeHtml(p.displayName)}</span><span class="player-pos">${escapeHtml(skinName)} · ${escapeHtml(squadName)} squad · (${Math.round(p.x)}, ${Math.round(p.y)}) ${p.facing}</span>${deadBadge}${isYou}</button></li>`;
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

/** Per-plate animation timer tracking. */
const plateAnimTimers: Map<number, number> = new Map();

/**
 * Update pressure plate animations from the server-authoritative pressed state.
 * Step on: frame 0 → 1 → 2, stop at 2.
 * Step off: frame 2 → 1 → 0, stop at 0.
 */
function updatePressurePlateAnimations(
  renderer: TilemapRenderer,
  serverState: GameState,
  dt: number,
): void {
  const frameInterval = 1 / PLATE_ANIM_SPEED;
  const pressedPlateIds = new Set(
    serverState.pressurePlateStates
      .filter((plateState) => plateState.pressed)
      .map((plateState) => plateState.plateId),
  );

  for (const plate of renderer.pressurePlateSprites) {
    const targetFrame = pressedPlateIds.has(plate.plateId) ? 2 : 0;
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

const LOADING_THEME_VOLUME = 0.42;
const LOADING_THEME_START_SECONDS = 4;
const LOADING_THEME_FADE_MS = 480;
let loadingThemeUnlockCleanup: (() => void) | null = null;
let loadingThemeFadeFrame: number | null = null;
let loadingScreenDismissTimer: number | null = null;

function getLoadingTheme(): HTMLAudioElement | null {
  return document.getElementById('loading-theme') as HTMLAudioElement | null;
}

function startLoadingTheme(): void {
  const theme = getLoadingTheme();
  if (!theme) return;

  theme.volume = LOADING_THEME_VOLUME;
  const cuePastQuietIntro = (): void => {
    if (theme.currentTime < LOADING_THEME_START_SECONDS) {
      theme.currentTime = LOADING_THEME_START_SECONDS;
    }
  };
  if (theme.readyState >= 1) cuePastQuietIntro();
  else theme.addEventListener('loadedmetadata', cuePastQuietIntro, { once: true });

  const resumeAfterInteraction = (): void => {
    if (!document.getElementById('loading-screen')) {
      loadingThemeUnlockCleanup?.();
      return;
    }

    void theme
      .play()
      .then(() => loadingThemeUnlockCleanup?.())
      .catch(() => undefined);
  };
  const cleanup = (): void => {
    window.removeEventListener('pointerdown', resumeAfterInteraction);
    window.removeEventListener('keydown', resumeAfterInteraction);
    if (loadingThemeUnlockCleanup === cleanup) loadingThemeUnlockCleanup = null;
  };

  loadingThemeUnlockCleanup?.();
  loadingThemeUnlockCleanup = cleanup;
  window.addEventListener('pointerdown', resumeAfterInteraction, { passive: true });
  window.addEventListener('keydown', resumeAfterInteraction);

  // Unmuted autoplay is browser-policy dependent. Keep the interaction
  // listeners above as a fallback for browsers that reject this first attempt.
  void theme
    .play()
    .then(cleanup)
    .catch(() => undefined);
}

function fadeOutLoadingTheme(): void {
  const theme = getLoadingTheme();
  loadingThemeUnlockCleanup?.();
  if (!theme) return;

  if (loadingThemeFadeFrame !== null) {
    window.cancelAnimationFrame(loadingThemeFadeFrame);
    loadingThemeFadeFrame = null;
  }

  if (theme.paused) {
    theme.currentTime = 0;
    theme.volume = LOADING_THEME_VOLUME;
    return;
  }

  const initialVolume = theme.volume;
  const fadeStartedAt = performance.now();
  const fade = (now: number): void => {
    const progress = Math.min(1, (now - fadeStartedAt) / LOADING_THEME_FADE_MS);
    theme.volume = initialVolume * (1 - progress);

    if (progress < 1) {
      loadingThemeFadeFrame = window.requestAnimationFrame(fade);
      return;
    }

    loadingThemeFadeFrame = null;
    theme.pause();
    theme.currentTime = 0;
    theme.volume = LOADING_THEME_VOLUME;
  };

  loadingThemeFadeFrame = window.requestAnimationFrame(fade);
}

function updateLoadingProgress(progress: number, status: string): void {
  const screen = document.getElementById('loading-screen');
  if (!screen || screen.classList.contains('loading-screen--complete')) return;

  const normalizedProgress = Math.max(0, Math.min(1, progress));
  const percentage = Math.round(normalizedProgress * 100);
  const progressBar = document.getElementById('loading-progress');
  const statusText = document.getElementById('loading-status');
  const percentText = document.getElementById('loading-percent');

  screen.style.setProperty('--loading-progress', normalizedProgress.toString());
  progressBar?.setAttribute('aria-valuenow', percentage.toString());
  if (statusText) statusText.textContent = status;
  if (percentText) percentText.textContent = `${percentage.toString().padStart(2, '0')}%`;
}

function showLoadingScreen(progress: number, status: string): void {
  const screen = document.getElementById('loading-screen');
  if (!screen) return;

  if (loadingScreenDismissTimer !== null) {
    window.clearTimeout(loadingScreenDismissTimer);
    loadingScreenDismissTimer = null;
  }

  screen.classList.remove('loading-screen--complete', 'loading-screen--error');
  screen.setAttribute('aria-busy', 'true');
  updateLoadingProgress(progress, status);
}

function runAfterLoadingScreenPaint(task: () => void): void {
  let started = false;
  const runOnce = (): void => {
    if (started) return;
    started = true;
    try {
      task();
    } catch (error) {
      console.error('[Main] Failed to build the maze:', error);
      showLoadingError('The maze could not be opened. Refresh to try again.');
    }
  };
  const fallbackTimer = window.setTimeout(runOnce, 50);

  window.requestAnimationFrame(() => {
    window.setTimeout(() => {
      window.clearTimeout(fallbackTimer);
      runOnce();
    }, 0);
  });
}

function dismissLoadingScreen(): void {
  const screen = document.getElementById('loading-screen');
  if (!screen) return;

  if (loadingScreenDismissTimer !== null) {
    window.clearTimeout(loadingScreenDismissTimer);
  }

  updateLoadingProgress(1, 'The way is open.');
  screen.setAttribute('aria-busy', 'false');

  loadingScreenDismissTimer = window.setTimeout(() => {
    loadingScreenDismissTimer = null;
    screen.classList.add('loading-screen--complete');
    fadeOutLoadingTheme();
  }, 240);
}

function showLoadingError(message: string): void {
  const screen = document.getElementById('loading-screen');
  if (!screen) return;

  screen.classList.add('loading-screen--error');
  screen.setAttribute('aria-busy', 'false');
  updateLoadingProgress(1, message);

  const percentText = document.getElementById('loading-percent');
  if (percentText) percentText.textContent = 'ERROR';

  const content = screen.querySelector<HTMLElement>('.loading-screen__content');
  if (content && !content.querySelector('.loading-screen__error-action')) {
    const returnButton = document.createElement('button');
    returnButton.className =
      'pixel-button pixel-button--quiet loading-screen__error-action';
    returnButton.type = 'button';
    returnButton.textContent = 'Return to Menu';
    returnButton.addEventListener('click', () => {
      clearReconnectSession();
      const url = new URL(window.location.href);
      url.searchParams.delete('room');
      window.location.href = url.toString();
    });
    content.appendChild(returnButton);
  }
}

export interface GameLaunchOptions {
  displayName: string;
  reconnectSession: ReconnectSession;
  accessToken?: string;
}

const PLAY_AGAIN_STORAGE_KEY = 'labyrinth-play-again';

async function initializeGame(options: GameLaunchOptions): Promise<void> {
  startLoadingTheme();
  updateLoadingProgress(0.06, 'Lighting the first torch…');
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

  fullscreenCanvasScale = getSavedIosFullscreenScale();
  resizeCanvas(app);
  setupFullscreenToggle(app);
  window.addEventListener('resize', () => resizeCanvas(app));

  const assets: GameAssets = await loadAssets(updateLoadingProgress);
  updateLoadingProgress(0.98, 'Finding your place in the maze…');

  // ── World Container ───────────────────────────────────────────────────
  const worldContainer = new Container();
  app.stage.sortableChildren = true;
  app.stage.addChild(worldContainer);

  // Dynamic cage grass belongs above static ground details but below every entity.
  const cageGroundLayer = new Container();
  worldContainer.addChild(cageGroundLayer);

  // Dynamic entities retain normal feet-based Y sorting.
  const entityLayer = new Container();
  entityLayer.sortableChildren = true;
  worldContainer.addChild(entityLayer);

  // Forest walls are an unconditional foreground: their canopy and trunks
  // must always cover player characters, regardless of player Y position.
  const forestWallLayer = new Container();
  worldContainer.addChild(forestWallLayer);

  // Remote-player labels render in screen space above every world object.
  const playerNameTagLayer = new Container();
  playerNameTagLayer.sortableChildren = true;
  app.stage.addChild(playerNameTagLayer);

  const matchHud = new MatchHud(INTERNAL_WIDTH, INTERNAL_HEIGHT, {
    onPlayAgain: () => {
      net.leaveRoom();
      window.sessionStorage.setItem(PLAY_AGAIN_STORAGE_KEY, '1');
      window.location.reload();
    },
    onExit: () => {
      net.leaveRoom();
      window.location.reload();
    },
  });
  matchHud.addToStage(app.stage);

  let mapPixelW = MAZE_WIDTH * TILE_SIZE;
  let mapPixelH = MAZE_HEIGHT * TILE_SIZE;

  const MIN_ZOOM = 0.1;
  const MAX_ZOOM = 2.0;
  const ZOOM_STEP = 0.05;
  let zoomLevel = MAX_ZOOM;
  let bridgeCameraBlend = 0;
  let bridgeCameraFocus: BridgeRepairCameraFocus | null = null;

  // Zoom-toggle state: cycles default → zoomed-out → zoomed-in
  type ZoomToggleState = 'default' | 'zoomed-out' | 'zoomed-in';
  let zoomToggleState: ZoomToggleState = 'default';
  const savedZoomBeforeToggle = zoomLevel;

  DebugSettings.setAdminAccess(false);
  let debugUi: DebugUiDom | null = null;
  let statusEl: HTMLDivElement | null = null;

  // ── Player Sprite Registry ──────────────────────────────────────────────

  const PLAYER_DEEP_MUD_SUBMERGE_DEPTH = 6;
  const PLAYER_FIRM_GROUND_SUBMERGE_DEPTH = 3;
  const PLAYER_NAME_TAG_OFFSET_Y = 1;
  const PLAYER_NAME_TAG_SCALE = 0.125;

  interface PlayerSpriteData {
    container: Container;
    shadow: Graphics;
    sprite: AnimatedSprite;
    nameTag: Text | null;
    swampMask: Graphics;
    swampTerrain: SwampTerrain;
    currentAnimKey: string;
    spriteIndex: number;
    teamId: number;
  }

  const playerSprites: Map<string, PlayerSpriteData> = new Map();
  const cageVisuals = new Map<number, CageVisual>();

  function clearCageVisuals(): void {
    for (const visual of cageVisuals.values()) visual.destroy();
    cageVisuals.clear();
  }

  function syncCageVisuals(states: readonly CageState[], animateNew: boolean): void {
    const activeIds = new Set(states.map((state) => state.cageId));
    for (const state of states) {
      let visual = cageVisuals.get(state.cageId);
      if (!visual) {
        visual = new CageVisual(
          state.cageId,
          state,
          assets.cageTextures,
          cageGroundLayer,
          entityLayer,
          animateNew,
        );
        cageVisuals.set(state.cageId, visual);
      }
      visual.syncState(state);
    }

    for (const [cageId, visual] of cageVisuals) {
      if (activeIds.has(cageId)) continue;
      visual.destroy();
      cageVisuals.delete(cageId);
    }
  }

  /** Safely resolve animation set for a player sprite, falling back to set 0. */
  function getAnimSet(spriteIndex: number, teamId: number) {
    const variants =
      assets.playerAnimationSets[spriteIndex] ?? assets.playerAnimationSets[0];
    const squadColor = SQUAD_COLORS[teamId];
    return (squadColor ? variants.squads[squadColor] : undefined) ?? variants.default;
  }

  function createPlayerSprite(
    playerId: string,
    spriteIndex: number,
    teamId: number,
  ): PlayerSpriteData {
    const animSet = getAnimSet(spriteIndex, teamId);
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
    const swampMask = new Graphics()
      .rect(-40, -64, 80, 64 - PLAYER_DEEP_MUD_SUBMERGE_DEPTH)
      .fill({ color: 0xffffff });
    const container = new Container();
    container.addChild(shadow, sprite);
    entityLayer.addChild(container);

    const data: PlayerSpriteData = {
      container,
      shadow,
      sprite,
      nameTag: null,
      swampMask,
      swampTerrain: 'dry',
      currentAnimKey: animKey,
      spriteIndex,
      teamId,
    };
    playerSprites.set(playerId, data);
    return data;
  }

  function syncPlayerNameTag(
    data: PlayerSpriteData,
    displayName: string,
    shouldShow: boolean,
  ): void {
    if (!shouldShow) {
      if (data.nameTag) {
        data.nameTag.parent?.removeChild(data.nameTag);
        data.nameTag.destroy();
        data.nameTag = null;
      }
      return;
    }

    if (!data.nameTag) {
      data.nameTag = new Text({
        text: displayName,
        style: new TextStyle({
          fontFamily: 'PixelOperator8',
          fontSize: 64,
          fill: '#fff0b5',
          stroke: {
            color: '#211407',
            width: 8,
            join: 'miter',
          },
          align: 'center',
        }),
        roundPixels: true,
        resolution: 2,
      });
      data.nameTag.anchor.set(0.5, 0);
      data.nameTag.scale.set(PLAYER_NAME_TAG_SCALE);
      data.nameTag.eventMode = 'none';
      playerNameTagLayer.addChild(data.nameTag);
    } else if (data.nameTag.text !== displayName) {
      data.nameTag.text = displayName;
    }
  }

  function ensurePlayerSprite(
    playerId: string,
    spriteIndex: number,
    teamId: number,
    displayName: string,
    shouldShowNameTag: boolean,
  ): PlayerSpriteData {
    let data = playerSprites.get(playerId);
    if (!data) data = createPlayerSprite(playerId, spriteIndex, teamId);
    else if (data.spriteIndex !== spriteIndex || data.teamId !== teamId) {
      data.spriteIndex = spriteIndex;
      data.teamId = teamId;
      data.currentAnimKey = '';
      setPlayerAnimation(data, 'idle-down');
    }
    syncPlayerNameTag(data, displayName, shouldShowNameTag);
    return data;
  }

  function setPlayerSwampTerrain(data: PlayerSpriteData, terrain: SwampTerrain): void {
    if (data.swampTerrain === terrain) return;
    data.swampTerrain = terrain;
    const inSwamp = terrain !== 'dry';

    if (inSwamp) {
      const submergeDepth =
        terrain === 'firm-ground'
          ? PLAYER_FIRM_GROUND_SUBMERGE_DEPTH
          : PLAYER_DEEP_MUD_SUBMERGE_DEPTH;
      data.swampMask
        .clear()
        .rect(-40, -64, 80, 64 - submergeDepth)
        .fill({ color: 0xffffff });
      if (!data.swampMask.parent) data.container.addChild(data.swampMask);
      data.sprite.mask = data.swampMask;
    } else {
      data.sprite.mask = null;
      data.swampMask.parent?.removeChild(data.swampMask);
    }
    data.shadow.visible = data.currentAnimKey !== 'lying' && !inSwamp;
  }

  function setPlayerAnimation(data: PlayerSpriteData, animKey: string): void {
    data.shadow.visible = animKey !== 'lying' && data.swampTerrain === 'dry';
    if (data.currentAnimKey === animKey) return;
    const animSet = getAnimSet(data.spriteIndex, data.teamId);
    const frames = animSet.animations[animKey];
    if (!frames) return;
    data.sprite.textures = frames;
    data.sprite.scale.x = animSet.mirroredKeys.has(animKey)
      ? -animSet.scale
      : animSet.scale;
    data.sprite.scale.y = animSet.scale;
    data.sprite.play();
    data.currentAnimKey = animKey;
  }

  function removePlayerSprite(playerId: string): void {
    portalEscapeAnimations.delete(playerId);
    const data = playerSprites.get(playerId);
    if (data) {
      data.sprite.mask = null;
      if (data.nameTag) {
        data.nameTag.parent?.removeChild(data.nameTag);
        data.nameTag.destroy();
        data.nameTag = null;
      }
      data.swampMask.parent?.removeChild(data.swampMask);
      data.swampMask.destroy();
      entityLayer.removeChild(data.container);
      data.container.destroy({ children: true });
      playerSprites.delete(playerId);
    }
  }

  const PORTAL_ESCAPE_ANIMATION_DURATION = 0.6;
  interface PortalEscapeAnimation {
    playerId: string;
    startX: number;
    startY: number;
    portalX: number;
    portalY: number;
    elapsed: number;
  }
  const portalEscapeAnimations = new Map<string, PortalEscapeAnimation>();

  function startPortalEscapeAnimation(
    playerId: string,
    portalX: number,
    portalY: number,
  ): void {
    const data = playerSprites.get(playerId);
    if (!data || portalEscapeAnimations.has(playerId)) return;
    syncPlayerNameTag(data, '', false);
    data.container.visible = true;
    data.container.alpha = 1;
    data.container.scale.set(1);
    portalEscapeAnimations.set(playerId, {
      playerId,
      startX: data.container.x,
      startY: data.container.y,
      portalX,
      portalY,
      elapsed: 0,
    });
  }

  function updatePortalEscapeAnimations(dtSeconds: number): void {
    for (const animation of portalEscapeAnimations.values()) {
      const data = playerSprites.get(animation.playerId);
      if (!data) {
        portalEscapeAnimations.delete(animation.playerId);
        continue;
      }

      animation.elapsed += dtSeconds;
      const progress = Math.min(
        1,
        animation.elapsed / PORTAL_ESCAPE_ANIMATION_DURATION,
      );
      const eased = 1 - (1 - progress) ** 3;
      data.container.x = Math.round(
        animation.startX + (animation.portalX - animation.startX) * eased,
      );
      data.container.y = Math.round(
        animation.startY + (animation.portalY - animation.startY) * eased,
      );
      data.container.zIndex = Math.round(data.container.y);
      data.container.alpha = 1 - progress;
      data.container.scale.set(Math.max(0.08, 1 - progress * 0.92));

      if (progress < 1) continue;
      data.container.visible = false;
      data.container.alpha = 1;
      data.container.scale.set(1);
      portalEscapeAnimations.delete(animation.playerId);
    }
  }

  const knownRemotePlayers: Set<string> = new Set();

  // ── Network Manager ───────────────────────────────────────────────────

  let latestServerState: GameState | null = null;

  function updatePlayerNameTagScreenPositions(): void {
    const scaleX = worldContainer.scale.x;
    const scaleY = worldContainer.scale.y;

    for (const data of playerSprites.values()) {
      if (!data.nameTag) continue;
      const screenX = Math.round(worldContainer.x + data.container.x * scaleX);
      const screenY = Math.round(
        worldContainer.y + (data.container.y + PLAYER_NAME_TAG_OFFSET_Y) * scaleY,
      );
      if (data.nameTag.x !== screenX) data.nameTag.x = screenX;
      if (data.nameTag.y !== screenY) data.nameTag.y = screenY;
      if (data.nameTag.zIndex !== screenY) data.nameTag.zIndex = screenY;
    }
  }

  function attachTilemapLayers(renderer: TilemapRenderer): void {
    cageGroundLayer.parent?.removeChild(cageGroundLayer);
    entityLayer.parent?.removeChild(entityLayer);
    forestWallLayer.parent?.removeChild(forestWallLayer);
    cellBoundaryOverlay?.parent?.removeChild(cellBoundaryOverlay);

    worldContainer.addChild(renderer.backgroundLayer);
    worldContainer.addChild(renderer.shadowLayer);
    worldContainer.addChild(renderer.portalTerrainLayer);
    worldContainer.addChild(renderer.forestUnderlayLayer);
    worldContainer.addChild(renderer.groundDetailLayer);
    worldContainer.addChild(cageGroundLayer);
    worldContainer.addChild(renderer.trapCellHighlightLayer);
    worldContainer.addChild(entityLayer);
    worldContainer.addChild(forestWallLayer);
    if (cellBoundaryOverlay) worldContainer.addChild(cellBoundaryOverlay);

    for (const wallChunk of renderer.wallRowChunks) {
      forestWallLayer.addChild(wallChunk);
    }

    for (const wallChunk of renderer.northWallRowChunks) {
      entityLayer.addChild(wallChunk);
    }

    for (const gate of renderer.gateSprites) {
      entityLayer.addChild(gate);
    }

    for (const swampDecoration of renderer.swampForegroundSprites) {
      entityLayer.addChild(swampDecoration);
    }

    for (const swordFieldSprite of renderer.swordFieldSprites) {
      entityLayer.addChild(swordFieldSprite);
    }

    for (const chestDeadEndSprite of renderer.chestDeadEndSprites) {
      entityLayer.addChild(chestDeadEndSprite);
    }

    for (const decoration of renderer.tIntersectionDecorationSprites) {
      entityLayer.addChild(decoration);
    }

    for (const sprite of renderer.centralHubYSortedSprites) {
      entityLayer.addChild(sprite);
    }

    for (const tree of renderer.treeSprites) {
      entityLayer.addChild(tree);
    }

    for (const runestone of renderer.runestoneSprites) {
      entityLayer.addChild(runestone.sprite);
    }

    for (const plate of renderer.pressurePlateSprites) {
      entityLayer.addChild(plate.sprite);
    }
  }

  /**
   * Pixi can restore image-backed textures after a mobile WebGL/WebGPU context
   * loss, but generated render textures have no CPU-side source to upload.
   * Recreate the baked map chunks while preserving all authoritative game state.
   */
  function rebuildTilemapAfterContextChange(): void {
    if (!currentMap || !currentLayout || !tilemapRenderer) return;

    const previousRenderer = tilemapRenderer;
    const previousPlateFrames = new Map(
      previousRenderer.pressurePlateSprites.map((plate) => [
        plate.plateId,
        plate.currentFrame,
      ]),
    );

    let replacementRenderer: TilemapRenderer;
    try {
      replacementRenderer = new TilemapRenderer(
        currentMap,
        currentLayout.gates,
        currentLayout.pressurePlates,
        currentLayout.bridges,
        currentLayout.swamps,
        currentLayout.swordFields,
        currentLayout.trapCells,
        currentLayout.chestDeadEnds,
        currentLayout.tIntersectionDecorations,
        currentLayout.decoratedVerticalPassages,
        currentLayout.dirtMask,
        assets,
        app.renderer,
      );
    } catch (error) {
      console.error(
        '[Main] Failed to rebuild the map after graphics context restoration',
        error,
      );
      return;
    }

    if (latestServerState) {
      replacementRenderer.syncBridgeStates(latestServerState.bridgeStates, false);
      replacementRenderer.syncSwordFieldStates(
        latestServerState.swordFieldStates,
        latestServerState.tick,
        false,
      );
      replacementRenderer.syncChestStates(latestServerState.chestStates, false);

      for (const runestoneState of latestServerState.runestones) {
        const runestone = replacementRenderer.runestoneSprites.find(
          (candidate) => candidate.index === runestoneState.index,
        );
        if (!runestone || !runestoneState.activated) continue;
        runestone.activated = true;
        runestone.sprite.texture = assets.runestoneTextures[runestoneState.index][1];
      }
    }

    for (const plate of replacementRenderer.pressurePlateSprites) {
      const frame = previousPlateFrames.get(plate.plateId) ?? 0;
      plate.currentFrame = frame;
      plate.sprite.texture = plate.frameSet[frame] ?? plate.frameSet[0];
    }

    const portalPosition = latestServerState?.portal ?? null;
    const restorePortalPlatform = portalPlatform !== null && portalPosition !== null;
    portalPlatform?.destroy();
    portalPlatform = null;

    for (const [gateIndex, slide] of gateSlideStates) {
      if (slide.mask) {
        if (slide.sprite) slide.sprite.mask = null;
        slide.mask.parent?.removeChild(slide.mask);
        slide.mask.destroy();
        slide.mask = null;
      }
      slide.sprite = replacementRenderer.gateSprites[gateIndex] ?? null;
    }

    previousRenderer.destroy();
    tilemapRenderer = replacementRenderer;
    attachTilemapLayers(replacementRenderer);

    if (restorePortalPlatform && portalPosition) {
      portalPlatform = new PortalPlatform(
        portalPosition.x,
        portalPosition.y,
        assets.portalPlatformTextures,
        replacementRenderer.portalTerrainLayer,
        replacementRenderer.groundDetailLayer,
        entityLayer,
      );
    }

    replacementRenderer.setWardenBridgeWisdomHints(
      currentLayout.bridges,
      localPlayerRole === 'warden',
    );
    replacementRenderer.setWardenSwampWisdomHints(localPlayerRole === 'warden');
    replacementRenderer.setWardenTrapHighlights(localPlayerRole === 'warden');
    updateGateSlideAnimations(0);
    replacementRenderer.updateVisibility(worldContainer.x, worldContainer.y, zoomLevel);
    console.info(
      '[Main] Rebuilt generated map textures after graphics context restoration',
    );
  }

  let tilemapRecoveryFrame: number | null = null;
  const renderContextRecovery = {
    contextChange(): void {
      if (!tilemapRenderer || tilemapRecoveryFrame !== null) return;
      tilemapRecoveryFrame = window.requestAnimationFrame(() => {
        tilemapRecoveryFrame = null;
        rebuildTilemapAfterContextChange();
      });
    },
  };
  app.renderer.runners.contextChange.add(renderContextRecovery);

  function setPlayerPosition(
    data: PlayerSpriteData,
    x: number,
    y: number,
    portalPosition = latestServerState?.portal ?? null,
  ): void {
    setRoundedPosition(data.container, x, y, 1);
    setPlayerSwampTerrain(
      data,
      getPlayerSwampTerrain(
        currentLayout?.swamps ?? [],
        x,
        y,
        currentMap?.tileSize ?? TILE_SIZE,
      ),
    );
    if (!portalPosition) return;

    const zFloor = getPortalPlatformPlayerZFloor(
      x,
      y,
      portalPosition.x,
      portalPosition.y,
    );
    if (zFloor !== null && data.container.zIndex < zFloor) {
      data.container.zIndex = zFloor;
    }
  }

  let applyLocalRoleUi: (
    role: PlayerRole,
    wisdomOrbs: number,
    showIntroDialogue: boolean,
  ) => void = () => {};
  let triggerInteract: () => void = () => {};
  let chatHud: ProximityChatHud | null = null;
  let lobbyOverlay: LobbyOverlay | null = null;
  let reconnectOverlay: ReconnectOverlay | null = null;
  let gameMenuHud: GameMenuHud | null = null;
  let chatInputActive = false;
  let gameMenuOpen = false;
  let setMobileInputEnabled: (enabled: boolean) => void = () => {};
  let setGameMenuAvailable: (available: boolean) => void = () => {};
  let syncLocalInputAvailability: () => void = () => {};

  const net = new NetworkManager({
    onLobbyJoined: (playerId, lobby, isAdmin, resumed) => {
      DebugSettings.setAdminAccess(isAdmin);
      if (isAdmin && !debugUi) {
        debugUi = createDebugUI();
        statusEl = debugUi.status;
        setupDebugToggles(debugUi);
        setupDebugPlayerActions(
          debugUi,
          net,
          () => latestServerState,
          () => net.playerId,
        );
      } else if (!isAdmin && debugUi) {
        debugUi.root.remove();
        debugUi = null;
        statusEl = null;
      }
      const fullscreenToggle = document.querySelector<HTMLButtonElement>('#fullscreen-toggle');
      if (fullscreenToggle) fullscreenToggle.hidden = true;
      setGameMenuAvailable(false);
      if (resumed && lobbyOverlay) {
        lobbyOverlay.update(lobby);
      } else {
        lobbyOverlay?.destroy();
        lobbyOverlay = new LobbyOverlay({
          parent: container,
          localPlayerId: playerId,
          initialState: lobby,
          isAdmin,
          onVote: (vote) => net.sendLobbyVote(vote),
          onStartNow: () => {
            showLoadingScreen(0.9, 'Opening the gates to the maze…');
            net.sendAdminStartGame();
          },
          onKick: (playerId) => net.sendAdminKickPlayer(playerId),
          onSendChat: (text) => net.sendLobbyChatMessage(text),
          onLeave: () => {
            net.leaveRoom();
            window.location.reload();
          },
        });
      }
      window.requestAnimationFrame(dismissLoadingScreen);
      console.info(`[Main] Joined lobby "${lobby.roomId}" as ${playerId}`);
    },

    onLobbyUpdated: (lobby) => {
      lobbyOverlay?.update(lobby);
    },

    onLobbyChatMessage: (playerId, displayName, text, sentAt) => {
      lobbyOverlay?.addMessage({ playerId, displayName, text, sentAt });
    },

    onLobbyKicked: (message) => {
      lobbyOverlay?.destroy();
      lobbyOverlay = null;
      clearReconnectSession();
      window.alert(message);
      window.location.reload();
    },

    onRoomJoined: (
      roomId,
      playerId,
      mapSeed,
      role,
      wisdomOrbs,
      gameState,
      isAdmin,
      resumed,
    ) => {
      showLoadingScreen(0.92, 'Carving your path through the maze…');
      runAfterLoadingScreenPaint(() => {
      DebugSettings.setAdminAccess(isAdmin);
      if (isAdmin && !debugUi) {
        debugUi = createDebugUI();
        statusEl = debugUi.status;
        setupDebugToggles(debugUi);
        setupDebugPlayerActions(
          debugUi,
          net,
          () => latestServerState,
          () => net.playerId,
        );
      }
      const fullscreenToggle = document.querySelector<HTMLButtonElement>('#fullscreen-toggle');
      if (fullscreenToggle) fullscreenToggle.hidden = false;
      lobbyOverlay?.destroy();
      lobbyOverlay = null;
      updateLoadingProgress(0.99, 'Carving your path through the maze…');
      console.info(
        `[Main] ${resumed ? 'Resumed' : 'Joined'} room "${roomId}" as ${playerId} (${role}, maze seed: ${mapSeed})`,
      );
      debugPlayerRoles.clear();
      debugPlayerRoles.set(playerId, role);
      if (!resumed) chatHud?.clear();
      chatHud?.setEnabled(true);
      matchHud.sync(gameState.match);
      setGameMenuAvailable(gameState.match.status === 'running');
      snapshotBuffer.clear();
      pendingInputs = [];

      const reuseExistingWorld = Boolean(
        resumed &&
        currentMapSeed === mapSeed &&
        currentMap &&
        currentLayout &&
        tilemapRenderer,
      );

      pendingPortalPos = null;
      shakeTimeRemaining = 0;
      cinematicPhase = 'idle';
      bridgeCameraBlend = 0;
      bridgeCameraFocus = null;
      emptyTrapPromptShakeRemaining = 0;
      emptyTrapPromptShakeElapsed = 0;
      portalEscapeAnimations.clear();

      if (!reuseExistingWorld) {
        gateSlideStates.clear();
        portal?.destroy();
        portal = null;
        portalPlatform?.destroy();
        portalPlatform = null;
        clearCageVisuals();

        const layout = generateMazeLayout(mapSeed, SPAWN_DISTANCE, MAX_TEAMS);
        currentMapSeed = mapSeed;
        currentMap = layout.map;
        currentLayout = layout;
        mapPixelW = currentMap.width * currentMap.tileSize;
        mapPixelH = currentMap.height * currentMap.tileSize;

        // ── Build chunk-based tilemap ────────────────────────────────────
        tilemapRenderer?.destroy();
        tilemapRenderer = new TilemapRenderer(
          currentMap,
          layout.gates,
          layout.pressurePlates,
          layout.bridges,
          layout.swamps,
          layout.swordFields,
          layout.trapCells,
          layout.chestDeadEnds,
          layout.tIntersectionDecorations,
          layout.decoratedVerticalPassages,
          layout.dirtMask,
          assets,
          app.renderer,
        );
        if (cellBoundaryOverlay?.parent === worldContainer) {
          worldContainer.removeChild(cellBoundaryOverlay);
        }
        cellBoundaryOverlay?.destroy();
        cellBoundaryOverlay = createCellBoundaryOverlay();
        attachTilemapLayers(tilemapRenderer);
      }

      const activeTilemapRenderer = tilemapRenderer;
      if (!activeTilemapRenderer) throw new Error('Missing tilemap after room admission');
      activeTilemapRenderer.syncBridgeStates(gameState.bridgeStates, false);
      activeTilemapRenderer.syncSwordFieldStates(
        gameState.swordFieldStates,
        gameState.tick,
        false,
      );
      activeTilemapRenderer.syncChestStates(gameState.chestStates, false);
      syncCageVisuals(gameState.cageStates, false);

      if (statusEl) {
        statusEl.textContent = '🟢 Connected';
        statusEl.classList.add('connected');
      }

      const me = gameState.players.find((p) => p.id === playerId);
      if (me) {
        localX = me.x;
        localY = me.y;
        localFacing = me.facing;
        inputSequenceNumber = me.lastProcessedInput;
        localPlayerInitialized = true;
      }

      const canLocalPlayerAct =
        gameState.match.status === 'running' && !(me?.escaped ?? false);
      chatHud?.setCanSend(canLocalPlayerAct);
      syncLocalInputAvailability();
      applyLocalRoleUi(
        role,
        wisdomOrbs,
        gameState.match.status === 'running' && !resumed,
      );

      // ── Sync runestone activation state from initial GameState ─────
      for (const rsInfo of gameState.runestones) {
        const rsData = tilemapRenderer?.runestoneSprites.find(
          (r) => r.index === rsInfo.index,
        );
        if (rsData && rsInfo.activated && !rsData.activated) {
          rsData.activated = true;
          rsData.sprite.texture = assets.runestoneTextures[rsInfo.index][1];
        }
      }

      // ── Initial portal sync ────────────────────────────────────────
      if (gameState.portal) {
        const portalAlreadyActive = gameState.runestones.every((rs) => rs.activated);
        if (!portalPlatform || !portal) {
          portalPlatform = new PortalPlatform(
            gameState.portal.x,
            gameState.portal.y,
            assets.portalPlatformTextures,
            activeTilemapRenderer.portalTerrainLayer,
            activeTilemapRenderer.groundDetailLayer,
            entityLayer,
          );
          portal = new Portal(
            gameState.portal.x,
            gameState.portal.y,
            assets.portalFrames,
            assets.portalActivationCount,
            entityLayer,
            portalAlreadyActive,
          );
        } else if (portalAlreadyActive) {
          portal.activate();
        }
        minimap?.setPortalPosition(gameState.portal.x, gameState.portal.y);
        console.info(
          `[Main] Portal ${portalAlreadyActive ? 'active' : 'inactive'} at (${Math.round(gameState.portal.x)}, ${Math.round(gameState.portal.y)})`,
        );
      }

      // ── Late-join gate state sync ────────────────────────────────────
      if (gameState.gateStates && currentLayout) {
        for (const gs of gameState.gateStates) {
          applyGateState(
            gs.gateIndex,
            gs.open,
            currentLayout.gates,
            currentMap!,
            tilemapRenderer!,
            assets,
          );
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
          fill: getInteractPromptColor(role),
          // A sharp, blocky drop shadow instead of a bubbly round stroke
          dropShadow: {
            alpha: 1,
            blur: 0, // 0 blur keeps the shadow blocky
            color: '#000000',
            distance: 8, // 8px shadow becomes 1px thick when scaled down
            angle: Math.PI / 4,
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
      interactPrompt.eventMode = 'static';
      interactPrompt.cursor = 'pointer';
      interactPrompt.on('pointertap', (event) => {
        event.stopPropagation();
        if (interactPrompt?.text === '[ Q ]') {
          triggerUseWisdomOrb('Click');
        } else {
          triggerInteract();
        }
      });
      entityLayer.addChild(interactPrompt);

      for (const player of gameState.players) {
        const isLocal = player.id === playerId;
        const data = ensurePlayerSprite(
          player.id,
          player.spriteIndex,
          player.teamId,
          player.connected ? player.displayName : `${player.displayName} · reconnecting`,
          !isLocal && !player.escaped,
        );
        setPlayerAnimation(
          data,
          getAnimationKey(player.facing, player.isMoving, player.isDead),
        );
        setPlayerPosition(data, player.x, player.y, gameState.portal);
        data.container.alpha = player.connected ? 1 : 0.45;
        data.container.visible = !player.escaped;
        if (!isLocal && !player.escaped) knownRemotePlayers.add(player.id);
      }

      snapshotBuffer.push(gameState);
      if (worldContainer.scale.x !== zoomLevel || worldContainer.scale.y !== zoomLevel) {
        worldContainer.scale.set(zoomLevel);
      }
      updateCamera(worldContainer, localX, localY, mapPixelW, mapPixelH, zoomLevel);
      latestServerState = gameState;
      updatePlayerNameTagScreenPositions();
      if (debugUi) updateDebugUI(debugUi, gameState, playerId, true);
      window.requestAnimationFrame(dismissLoadingScreen);
      });
    },

    onTickUpdate: (gameState) => {
      const localPlayerId = net.playerId;
      matchHud.sync(gameState.match);
      snapshotBuffer.push(gameState);
      tilemapRenderer?.syncBridgeStates(gameState.bridgeStates, true);
      tilemapRenderer?.syncSwordFieldStates(
        gameState.swordFieldStates,
        gameState.tick,
        true,
      );
      tilemapRenderer?.syncChestStates(gameState.chestStates, true);
      syncCageVisuals(gameState.cageStates, true);

      const localPlayerData = gameState.players.find((p) => p.id === localPlayerId);
      if (localPlayerData) {
        const data = ensurePlayerSprite(
          localPlayerData.id,
          localPlayerData.spriteIndex,
          localPlayerData.teamId,
          localPlayerData.displayName,
          false,
        );

        const localEscapeAnimating = portalEscapeAnimations.has(localPlayerData.id);
        if (localPlayerData.escaped && !localEscapeAnimating) {
          data.container.visible = false;
        } else if (!localEscapeAnimating && !debugTeleportActive) {
          // Compute reconciled position from server state + pending input replay
          let reconciledX = localPlayerData.x;
          let reconciledY = localPlayerData.y;

          pendingInputs = pendingInputs.filter(
            (input) => input.sequenceNumber > localPlayerData.lastProcessedInput,
          );

          for (const input of pendingInputs) {
            const result = applyInputWithCollision(
              reconciledX,
              reconciledY,
              input,
              input.dt,
              currentMap!,
              latestServerState?.portal,
              currentLayout?.bridges,
              gameState.bridgeStates,
              currentLayout?.swamps,
              currentLayout?.chestDeadEnds,
              currentLayout?.swordFields,
              gameState.swordFieldStates,
              gameState.cageStates,
              localPlayerId ?? undefined,
              currentLayout?.tIntersectionDecorations,
              currentLayout?.decoratedVerticalPassages,
            );
            reconciledX = result.x;
            reconciledY = result.y;
          }

          // Smooth the correction to hide jitter
          const cdx = reconciledX - localX;
          const cdy = reconciledY - localY;
          const correctionDistSq = cdx * cdx + cdy * cdy;

          // Hard snap if correction is large (teleport/respawn), smooth otherwise
          if (correctionDistSq > 25) {
            // > 5 pixels
            localX = reconciledX;
            localY = reconciledY;
          } else {
            localX = localX + cdx * 0.3;
            localY = localY + cdy * 0.3;
          }
        }

        if (!localEscapeAnimating && !localPlayerData.escaped) {
          data.container.visible = true;
          setPlayerPosition(data, localX, localY, gameState.portal);
        }
      }

      knownRemotePlayers.clear();
      for (const player of gameState.players) {
        if (player.id !== localPlayerId) {
          const data = ensurePlayerSprite(
            player.id,
            player.spriteIndex,
            player.teamId,
            player.connected ? player.displayName : `${player.displayName} · reconnecting`,
            !player.escaped,
          );
          data.container.alpha = player.connected ? 1 : 0.45;
          if (player.escaped) {
            if (!portalEscapeAnimations.has(player.id)) data.container.visible = false;
          } else {
            data.container.visible = true;
            knownRemotePlayers.add(player.id);
          }
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
      const canLocalPlayerAct =
        gameState.match.status === 'running' && !(localPlayerData?.escaped ?? false);
      setGameMenuAvailable(gameState.match.status === 'running');
      if (!canLocalPlayerAct) {
        resetAllInput();
        pendingInputs = [];
      }
      chatHud?.setCanSend(canLocalPlayerAct);
      syncLocalInputAvailability();
      if (debugUi) updateDebugUI(debugUi, gameState, localPlayerId);
    },

    onPlayerLeft: (playerId) => {
      console.info(`[Main] Player left: ${playerId}`);
      removePlayerSprite(playerId);
      knownRemotePlayers.delete(playerId);
      debugPlayerRoles.delete(playerId);
    },

    onRunestoneActivated: (runestoneIndex) => {
      console.info(`[Main] Runestone ${runestoneIndex} activated!`);
      const rsData = tilemapRenderer?.runestoneSprites.find(
        (r) => r.index === runestoneIndex,
      );
      if (rsData && !rsData.activated) {
        rsData.activated = true;
        rsData.sprite.texture = assets.runestoneTextures[runestoneIndex][1];
      }
    },

    onChestOpened: (chestIndex, playerId) => {
      console.info(`[Main] Chest ${chestIndex} opened by ${playerId}`);
      tilemapRenderer?.chestDeadEndVisuals
        .find((visual) => visual.index === chestIndex)
        ?.syncOpened(true, true);
    },

    onWisdomOrbGranted: (chestIndex, wisdomOrbs) => {
      localWisdomOrbs = wisdomOrbs;
      wisdomOrbHud?.setRemaining(wisdomOrbs);
      console.info(
        `[WisdomOrb] Chest ${chestIndex} reward received; inventory=${wisdomOrbs}`,
      );
    },

    onAllRunestonesActivated: (portalX, portalY) => {
      console.info(
        `[Main] All runestones activated! Portal at (${Math.round(portalX)}, ${Math.round(portalY)})`,
      );
      chatHud?.addSystemMessage(WARDSTONES_ACTIVATED_CHAT_MESSAGE);
      // Start screen shake — portal will light up after it completes
      shakeTimeRemaining = SHAKE_DURATION;
      pendingPortalPos = { x: portalX, y: portalY };
    },

    onWisdomOrbUsed: (hint, remainingWisdomOrbs) => {
      localWisdomOrbs = remainingWisdomOrbs;
      wisdomOrbHud?.setRemaining(remainingWisdomOrbs);
      if (hint.kind === 'bridge') {
        wisdomArrow?.hide();
        console.info(
          `[WisdomOrb][Response] Server accepted private bridge ${hint.bridgeIndex} route from ${hint.entrySide}; remaining=${remainingWisdomOrbs}`,
        );
        tilemapRenderer?.showBridgeWisdomHint(
          hint.bridgeIndex,
          hint.safeTileMask,
          hint.entrySide,
        );
      } else if (hint.kind === 'swamp') {
        wisdomArrow?.hide();
        console.info(
          `[WisdomOrb][Response] Server accepted private swamp ${hint.swampIndex} firm-ground route; remaining=${remainingWisdomOrbs}`,
        );
        tilemapRenderer?.showSwampWisdomHint(hint.swampIndex);
      } else if (hint.kind === 'sword-field') {
        wisdomArrow?.hide();
        tilemapRenderer?.beginSwordFieldLowering(hint.swordFieldIndex);
        console.info(
          `[WisdomOrb][Response] Server accepted sword field ${hint.swordFieldIndex}; remaining=${remainingWisdomOrbs}`,
        );
      } else {
        console.info(
          `[WisdomOrb][Response] Server accepted direction=${hint.direction}; remaining=${remainingWisdomOrbs}`,
        );
        wisdomArrow?.show(hint.direction);
      }
    },

    onPlayerRoleChanged: (role, wisdomOrbs) => {
      console.info(`[Main] Debug role changed to ${role}`);
      if (net.playerId) debugPlayerRoles.set(net.playerId, role);
      applyLocalRoleUi(role, wisdomOrbs, false);
    },

    onDebugPlayerRole: (playerId, role) => {
      debugPlayerRoles.set(playerId, role);
      if (debugUi && latestServerState) {
        updateDebugUI(debugUi, latestServerState, net.playerId, true);
      }
    },

    onError: (code, message) => {
      console.error(`[Main] Server error [${code}]: ${message}`);
      if (!code.startsWith('RECONNECT_')) showLoadingError(message);
      if (statusEl) {
        statusEl.textContent = `🔴 Error: ${message}`;
        statusEl.classList.add('error');
      }
    },

    onGateStateChanged: (gateIndex, open) => {
      console.info(`[Main] Gate ${gateIndex} ${open ? 'OPENED' : 'CLOSED'}`);
      if (currentLayout && currentMap && tilemapRenderer) {
        applyGateState(
          gateIndex,
          open,
          currentLayout.gates,
          currentMap,
          tilemapRenderer,
          assets,
        );
      }
    },

    onTrapActivationResult: (trapCellIndex, capturedCount) => {
      if (capturedCount > 0) return;
      console.info(`[Main] Trap cell ${trapCellIndex} found no free survivors`);
      emptyTrapPromptShakeRemaining = EMPTY_TRAP_PROMPT_SHAKE_DURATION;
      emptyTrapPromptShakeElapsed = 0;
    },

    onChatMessage: (playerId, displayName, teamId, text) => {
      chatHud?.addMessage({ playerId, displayName, teamId, text });
    },

    onPlayerEscaped: (
      playerId,
      displayName,
      portalX,
      portalY,
      escapedCount,
      escapeThreshold,
      remainingToEscape,
    ) => {
      const noun = remainingToEscape === 1 ? 'survivor' : 'survivors';
      chatHud?.addSystemMessage(
        `${displayName} has escaped the maze via portal. ${remainingToEscape} more ${noun} need to escape.`,
      );
      startPortalEscapeAnimation(playerId, portalX, portalY);
      if (playerId === net.playerId) {
        resetAllInput();
        pendingInputs = [];
        chatHud?.setCanSend(false);
        syncLocalInputAvailability();
      }
      console.info(
        `[Main] ${displayName} escaped via portal (${escapedCount}/${escapeThreshold})`,
      );
    },

    onMatchEnded: (
      winner,
      escapedCount,
      escapeThreshold,
      remainingMs,
      finalRoster,
    ) => {
      resetAllInput();
      pendingInputs = [];
      minimap?.closeExpanded();
      introDialogueHud?.destroy();
      introDialogueHud = null;
      chatHud?.setSuppressed(false);
      chatHud?.setCanSend(false);
      setGameMenuAvailable(false);
      syncLocalInputAvailability();
      if (interactPrompt) interactPrompt.visible = false;
      matchHud.sync({
        status: 'ended',
        remainingMs,
        escapedCount,
        escapeThreshold,
        winner,
        finalRoster,
      });
      console.info(
        `[Main] Match ended: ${winner} win (${escapedCount}/${escapeThreshold})`,
      );
    },

    onConnectionState: (state) => {
      reconnectOverlay?.update(state);
      if (state.status === 'connected') {
        if (statusEl) {
          statusEl.textContent = '🟢 Connected';
          statusEl.classList.add('connected');
        }
        return;
      }

      resetAllInput();
      pendingInputs = [];
      snapshotBuffer.clear();
      minimap?.closeExpanded();
      chatHud?.setCanSend(false);
      setGameMenuAvailable(false);
      syncLocalInputAvailability();
      if (interactPrompt) interactPrompt.visible = false;
      if (statusEl) {
        statusEl.textContent = state.status === 'failed' ? '🔴 Disconnected' : '🟠 Reconnecting';
        statusEl.classList.remove('connected');
      }
    },
  });

  reconnectOverlay = new ReconnectOverlay({
    parent: container,
    onLeave: () => {
      net.leaveRoom();
      const url = new URL(window.location.href);
      url.searchParams.delete('room');
      window.location.href = url.toString();
    },
  });
  window.addEventListener(RELEASE_ROOM_EVENT, () => net.leaveRoom());

  chatHud = new ProximityChatHud({
    parent: container,
    canvas: app.canvas,
    onSend: (text) => net.sendChatMessage(text),
    onActiveChange: (active) => {
      chatInputActive = active;
      if (active) {
        resetAllInput();
        minimap?.closeExpanded();
      }
      syncLocalInputAvailability();
    },
  });

  // ── Interaction Helpers + Mobile Controls ────────────────────────────

  const isLocalPlayerActionable = (): boolean => {
    const playerId = net.playerId;
    if (!playerId || latestServerState?.match.status !== 'running') return false;
    const player = latestServerState.players.find((candidate) => candidate.id === playerId);
    return Boolean(player && !player.escaped && !portalEscapeAnimations.has(playerId));
  };

  const triggerUseWisdomOrb = (source: 'Click' | 'KeyQ' | 'MobileQ'): void => {
    console.info(
      `[WisdomOrb][${source}] Triggered. localPlayerInitialized=${localPlayerInitialized}, isConnected=${net.isConnected}`,
    );
    if (chatInputActive || gameMenuOpen) return;
    if (!localPlayerInitialized) {
      console.warn(`[WisdomOrb][${source}] BLOCKED: local player not initialized`);
      return;
    }
    if (!net.isConnected) {
      console.warn(`[WisdomOrb][${source}] BLOCKED: not connected`);
      return;
    }
    if (!isLocalPlayerActionable()) return;
    if (localPlayerRole !== 'survivor') {
      console.warn(`[WisdomOrb][${source}] BLOCKED: local role has no wisdom orbs`);
      return;
    }
    if (introDialogueHud?.isVisible()) return;
    if (minimap?.isExpanded()) {
      console.warn(`[WisdomOrb][${source}] BLOCKED: warden map is open`);
      return;
    }
    if (localWisdomOrbs <= 0) {
      const swordFieldTarget =
        currentLayout && latestServerState
          ? findSwordFieldWisdomTarget(
              currentLayout.swordFields,
              latestServerState.swordFieldStates,
              localX,
              localY,
              TILE_SIZE,
            )
          : null;
      if (swordFieldTarget) {
        showDialoguePages(SWORD_FIELD_WISDOM_REQUIRED_DIALOGUE_PAGES);
      }
      return;
    }
    console.info(
      `[WisdomOrb][${source}] Sending USE_WISDOM_ORB, player at (${localX.toFixed(1)}, ${localY.toFixed(1)})`,
    );
    net.sendUseWisdomOrb();
  };

  const canLocalPlayerOpenChest = (): boolean =>
    isLocalPlayerActionable() &&
    (localPlayerRole === 'warden' ||
      (localPlayerRole === 'survivor' && localWisdomOrbs < MAX_WISDOM_ORBS));

  triggerInteract = (): void => {
    if (chatInputActive || gameMenuOpen) return;
    if (minimap?.isExpanded()) {
      minimap.closeExpanded();
      return;
    }

    if (introDialogueHud?.isVisible()) {
      introDialogueHud.advance();
      return;
    }

    if (!localPlayerInitialized || !tilemapRenderer || !isLocalPlayerActionable()) return;

    if (
      localPlayerRole === 'survivor' &&
      latestServerState?.portal &&
      latestServerState.runestones.every((runestone) => runestone.activated) &&
      isWithinPortalInteractionRange(
        { x: localX, y: localY },
        latestServerState.portal,
      )
    ) {
      net.sendEscapePortal();
      return;
    }

    const localTeamId = latestServerState?.players.find(
      (player) => player.id === net.playerId,
    )?.teamId;
    const INTERACT_RANGE = 28;
    const INTERACT_RANGE_SQ = INTERACT_RANGE * INTERACT_RANGE;
    let nearestRunestoneIndex: number | null = null;
    let nearestRunestoneDistSq = Infinity;
    for (const rs of tilemapRenderer.runestoneSprites) {
      if (rs.activated || rs.index !== localTeamId) continue;
      const rsCenterX = rs.tileX * TILE_SIZE + TILE_SIZE / 2;
      const rsCenterY = (rs.tileY + 1) * TILE_SIZE;
      const dx = localX - rsCenterX;
      const dy = localY - rsCenterY;
      const distSq = dx * dx + dy * dy;
      if (distSq < INTERACT_RANGE_SQ && distSq < nearestRunestoneDistSq) {
        nearestRunestoneIndex = rs.index;
        nearestRunestoneDistSq = distSq;
      }
    }
    if (nearestRunestoneIndex !== null) {
      net.sendActivateRunestone(nearestRunestoneIndex);
      return;
    }

    if (latestServerState && net.playerId) {
      const activeLocalCage = findActivePlayerCage(
        latestServerState.cageStates,
        net.playerId,
      );
      if (!activeLocalCage) {
        const cageTarget = findOpenableCage(
          latestServerState.cageStates,
          net.playerId,
          localX,
          localY,
        );
        if (cageTarget) {
          net.sendOpenCage(cageTarget.cage.cageId);
          return;
        }
      }
    }

    if (localPlayerRole === 'warden' && currentLayout) {
      const trapTarget = findTrapCellInteractionTarget(
        currentLayout.trapCells,
        localX,
        localY,
        TILE_SIZE,
      );
      if (trapTarget) {
        net.sendActivateTrapCell(trapTarget.trapCellIndex);
        return;
      }
    }

    if (localPlayerRole === 'warden' && currentLayout && latestServerState) {
      const swordFieldTarget = findSwordFieldWisdomTarget(
        currentLayout.swordFields,
        latestServerState.swordFieldStates,
        localX,
        localY,
        TILE_SIZE,
      );
      if (swordFieldTarget) {
        net.sendUseWisdomOrb();
        return;
      }
    }

    if (localPlayerRole === 'warden' && latestServerState) {
      const latchedPlateIds = new Set(
        latestServerState.pressurePlateStates
          .filter((plateState) => plateState.latched)
          .map((plateState) => plateState.plateId),
      );
      const plateRangeSq =
        PRESSURE_PLATE_INTERACTION_RANGE * PRESSURE_PLATE_INTERACTION_RANGE;
      let nearestPlateId: number | null = null;
      let nearestPlateDistSq = Infinity;

      for (const plate of tilemapRenderer.pressurePlateSprites) {
        if (latchedPlateIds.has(plate.plateId)) continue;
        const plateCenterX = (plate.tileX + 0.5) * TILE_SIZE;
        const plateCenterY = (plate.tileY + 0.5) * TILE_SIZE;
        const dx = localX - plateCenterX;
        const dy = localY - plateCenterY;
        const distSq = dx * dx + dy * dy;
        if (distSq <= plateRangeSq && distSq < nearestPlateDistSq) {
          nearestPlateId = plate.plateId;
          nearestPlateDistSq = distSq;
        }
      }

      if (nearestPlateId !== null) {
        net.sendPressPressurePlate(nearestPlateId);
        return;
      }
    }

    if (!canLocalPlayerOpenChest()) return;
    const chestRangeSq = CHEST_INTERACTION_RANGE * CHEST_INTERACTION_RANGE;
    let nearestChestIndex: number | null = null;
    let nearestChestDistSq = Infinity;
    for (const chest of tilemapRenderer.chestDeadEndVisuals) {
      if (chest.isOpened()) continue;
      const dx = localX - chest.interactionX;
      const dy = localY - chest.interactionY;
      const distSq = dx * dx + dy * dy;
      if (distSq <= chestRangeSq && distSq < nearestChestDistSq) {
        nearestChestIndex = chest.index;
        nearestChestDistSq = distSq;
      }
    }
    if (nearestChestIndex !== null) net.sendOpenChest(nearestChestIndex);
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
  setMobileInputEnabled = (enabled) => mobileControls.setInputEnabled(enabled);
  mobileControls.setWisdomAvailable(false);

  const gameMenuToggle = document.querySelector<HTMLButtonElement>('#game-menu-toggle');
  const returnToMainMenu = (): void => {
    net.leaveRoom();
    const url = new URL(window.location.href);
    url.searchParams.delete('room');
    window.location.href = url.toString();
  };
  const handleGameMenuToggle = (): void => gameMenuHud?.toggle();
  gameMenuToggle?.addEventListener('click', handleGameMenuToggle);

  gameMenuHud = new GameMenuHud(INTERNAL_WIDTH, INTERNAL_HEIGHT, {
    onVisibilityChange: (visible) => {
      gameMenuOpen = visible;
      gameMenuToggle?.setAttribute('aria-expanded', String(visible));
      resetAllInput();
      if (visible) {
        chatHud?.close();
        minimap?.closeExpanded();
      }
      syncLocalInputAvailability();
    },
    onExitMatch: returnToMainMenu,
  });
  gameMenuHud.addToStage(app.stage);

  setGameMenuAvailable = (available) => {
    gameMenuHud?.setAvailable(available);
    if (gameMenuToggle) {
      gameMenuToggle.hidden = !available;
      gameMenuToggle.disabled = !available;
      gameMenuToggle.setAttribute('aria-expanded', String(gameMenuHud?.isOpen() ?? false));
    }
  };
  syncLocalInputAvailability = () => {
    const canAct = net.isConnected && isLocalPlayerActionable();
    setMobileInputEnabled(canAct && !chatInputActive && !gameMenuOpen);
    chatHud?.setSuppressed(
      gameMenuOpen ||
        (introDialogueHud?.isVisible() ?? false) ||
        (minimap?.isExpanded() ?? false),
    );
  };

  const showDialoguePages = (pages: readonly string[]): void => {
    introDialogueHud?.destroy();
    introDialogueHud = new IntroDialogueHud(
      INTERNAL_WIDTH,
      INTERNAL_HEIGHT,
      pages,
      (bounds) => mobileControls.setDialogueExclusion(bounds),
    );
    introDialogueHud.addToStage(app.stage);
    chatHud?.setSuppressed(true);
  };

  applyLocalRoleUi = (role, wisdomOrbs, showIntroDialogue) => {
    localPlayerRole = role;
    localWisdomOrbs = wisdomOrbs;
    if (interactPrompt) interactPrompt.style.fill = getInteractPromptColor(role);
    if (!currentMap || !currentLayout) return;

    tilemapRenderer?.setWardenBridgeWisdomHints(currentLayout.bridges, role === 'warden');
    tilemapRenderer?.setWardenSwampWisdomHints(role === 'warden');
    tilemapRenderer?.setWardenTrapHighlights(role === 'warden');

    minimap?.destroy();
    minimap = new Minimap(
      currentMap,
      currentLayout.dirtMask,
      INTERNAL_WIDTH,
      INTERNAL_HEIGHT,
      {
        isWarden: role === 'warden',
        bridges: currentLayout.bridges,
        swamps: currentLayout.swamps,
        swordFields: currentLayout.swordFields,
        chestDeadEnds: currentLayout.chestDeadEnds,
        trapCells: currentLayout.trapCells,
        expandButtonTexture: assets.expandMapButtonTexture,
        contractButtonTexture: assets.contractMapButtonTexture,
        onExpandedChange: (expanded) => {
          mobileControls.setExpandedMinimapVisible(expanded);
          chatHud?.setSuppressed(expanded || (introDialogueHud?.isVisible() ?? false));
        },
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
      showDialoguePages(
        role === 'warden' ? WARDEN_SPAWN_DIALOGUE_PAGES : SURVIVOR_SPAWN_DIALOGUE_PAGES,
      );
    }
    chatHud?.setSuppressed(showIntroDialogue);
  };

  window.addEventListener(
    'beforeunload',
    () => {
      chatHud?.destroy();
      matchHud.destroy();
      gameMenuHud?.destroy();
      gameMenuToggle?.removeEventListener('click', handleGameMenuToggle);
      mobileControls.destroy();
    },
    { once: true },
  );

  // ── 60 FPS Game Loop ──────────────────────────────────────────────────
  app.ticker.add((ticker) => {
    matchHud.update();
    if (!net.isConnected || !localPlayerInitialized || !net.playerId) return;

    // Cap dt to prevent massive physics jumps when mobile browsers drop frames
    const dtSeconds = Math.min(ticker.deltaMS / 1000, 0.1);
    const now = performance.now();

    // ── 1. Local player prediction ────────────────────────────────
    const localPlayerState = latestServerState?.players.find(
      (player) => player.id === net.playerId,
    );
    const isLocalDead = localPlayerState?.isDead ?? false;
    const isLocalEscaped =
      (localPlayerState?.escaped ?? false) || portalEscapeAnimations.has(net.playerId);
    const localCanAct = isLocalPlayerActionable();
    const activeLocalCage = latestServerState
      ? findActivePlayerCage(latestServerState.cageStates, net.playerId)
      : null;
    const movementInput = {
      up: chatInputActive || gameMenuOpen || !localCanAct ? false : activeKeys.up,
      down: chatInputActive || gameMenuOpen || !localCanAct ? false : activeKeys.down,
      // Once opened, the cage permits only its north/south escape route. A
      // closed prisoner still animates against all four sides without moving.
      left:
        chatInputActive || gameMenuOpen || !localCanAct || activeLocalCage?.opened
          ? false
          : activeKeys.left,
      right:
        chatInputActive || gameMenuOpen || !localCanAct || activeLocalCage?.opened
          ? false
          : activeKeys.right,
    };
    const isMoving =
      movementInput.up || movementInput.down || movementInput.left || movementInput.right;
    if (isMoving) {
      localFacing = deriveFacingDirection(movementInput, localFacing);
      inputSequenceNumber++;

      const input: PendingInput = {
        sequenceNumber: inputSequenceNumber,
        up: movementInput.up,
        down: movementInput.down,
        left: movementInput.left,
        right: movementInput.right,
        dt: dtSeconds,
      };

      const result = applyInputWithCollision(
        localX,
        localY,
        input,
        dtSeconds,
        currentMap!,
        latestServerState?.portal,
        currentLayout?.bridges,
        latestServerState?.bridgeStates,
        currentLayout?.swamps,
        currentLayout?.chestDeadEnds,
        currentLayout?.swordFields,
        latestServerState?.swordFieldStates,
        latestServerState?.cageStates,
        net.playerId,
        currentLayout?.tIntersectionDecorations,
        currentLayout?.decoratedVerticalPassages,
      );
      localX = result.x;
      localY = result.y;

      pendingInputs.push(input);

      net.sendInput(
        input.sequenceNumber,
        input.up,
        input.down,
        input.left,
        input.right,
        dtSeconds,
      );
    }

    const localData = playerSprites.get(net.playerId);
    if (localData && !isLocalEscaped) {
      setPlayerPosition(localData, localX, localY);

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
      if (portalEscapeAnimations.has(remoteId)) continue;

      const interp = getInterpolatedPlayer(remoteId, interpolationPair, latestSnapshot);
      if (interp) {
        setPlayerPosition(data, interp.x, interp.y);

        const remoteAnimKey = getAnimationKey(
          interp.facing,
          interp.isMoving,
          interp.isDead,
        );
        setPlayerAnimation(data, remoteAnimKey);
      }
    }
    updatePortalEscapeAnimations(dtSeconds);

    // ── 3. Camera follow + zoom ─────────────────────────────────────
    let camTargetX = localX;
    let camTargetY = localY;

    if (cinematicPhase !== 'idle') {
      // The portal reveal remains an instant, higher-priority camera override.
      camTargetX = cinematicTargetX;
      camTargetY = cinematicTargetY;
      bridgeCameraBlend = 0;
      bridgeCameraFocus = null;
    } else {
      const activeBridgeFocus = getBridgeRepairCameraFocus(
        currentLayout,
        latestServerState,
        net.playerId,
      );
      const blendStep = dtSeconds / BRIDGE_CAMERA_EASE_DURATION;

      if (activeBridgeFocus) {
        bridgeCameraFocus = activeBridgeFocus;
        bridgeCameraBlend = Math.min(1, bridgeCameraBlend + blendStep);
      } else {
        bridgeCameraBlend = Math.max(0, bridgeCameraBlend - blendStep);
      }

      if (bridgeCameraFocus && bridgeCameraBlend > 0) {
        const blend = smoothstep(bridgeCameraBlend);
        camTargetX = localX + (bridgeCameraFocus.x - localX) * blend;
        camTargetY = localY + (bridgeCameraFocus.y - localY) * blend;
      } else if (!activeBridgeFocus) {
        bridgeCameraFocus = null;
      }
    }

    if (worldContainer.scale.x !== zoomLevel || worldContainer.scale.y !== zoomLevel) {
      worldContainer.scale.set(zoomLevel);
    }
    updateCamera(worldContainer, camTargetX, camTargetY, mapPixelW, mapPixelH, zoomLevel);

    // ── 3b. Viewport culling — hide off-screen tilemap chunks ────────
    if (tilemapRenderer) {
      tilemapRenderer.updateVisibility(worldContainer.x, worldContainer.y, zoomLevel);
      tilemapRenderer.updateBridgeAnimations(dtSeconds);
    }
    for (const visual of cageVisuals.values()) visual.update(dtSeconds);
    if (cellBoundaryOverlay) {
      cellBoundaryOverlay.visible = DebugSettings.isEnabled('cellBoundaries');
    }

    // ── 4. Minimap ────────────────────────────────────────────────────
    if (minimap) {
      const otherPlayerPositions: Array<{ x: number; y: number }> = [];
      for (const [playerId, data] of playerSprites) {
        if (playerId === net.playerId) continue;
        otherPlayerPositions.push({ x: data.container.x, y: data.container.y });
      }
      minimap.update(localX, localY, otherPlayerPositions);
    }
    introDialogueHud?.update(dtSeconds);
    chatHud?.setSuppressed(
      gameMenuOpen ||
        (introDialogueHud?.isVisible() ?? false) ||
        (minimap?.isExpanded() ?? false),
    );
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

      // When shake ends, light the portal and move the camera to it.
      if (shakeTimeRemaining <= 0 && pendingPortalPos) {
        if (!portalPlatform && tilemapRenderer) {
          portalPlatform = new PortalPlatform(
            pendingPortalPos.x,
            pendingPortalPos.y,
            assets.portalPlatformTextures,
            tilemapRenderer.portalTerrainLayer,
            tilemapRenderer.groundDetailLayer,
            entityLayer,
          );
        }
        if (!portal) {
          portal = new Portal(
            pendingPortalPos.x,
            pendingPortalPos.y,
            assets.portalFrames,
            assets.portalActivationCount,
            entityLayer,
          );
        }
        portal.activate();
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

    // ── 5. Runestone/chest/gate-button interaction prompt ───────────
    const emptyTrapPromptShakeActive = emptyTrapPromptShakeRemaining > 0;
    if (emptyTrapPromptShakeActive) {
      emptyTrapPromptShakeElapsed += dtSeconds;
      emptyTrapPromptShakeRemaining = Math.max(
        0,
        emptyTrapPromptShakeRemaining - dtSeconds,
      );
    }

    if (interactPrompt && tilemapRenderer) {
      let nearestDistSq = Infinity;
      let promptPriority = Infinity;
      let promptX = 0;
      let promptY = 0;
      let promptText = '[ E ]';
      const considerPrompt = (
        priority: number,
        distanceSquared: number,
        x: number,
        y: number,
        text = '[ E ]',
      ): void => {
        if (
          priority > promptPriority ||
          (priority === promptPriority && distanceSquared >= nearestDistSq)
        ) {
          return;
        }
        promptPriority = priority;
        nearestDistSq = distanceSquared;
        promptX = x;
        promptY = y;
        promptText = text;
      };
      const INTERACT_RANGE = 28; // ~1.75 tiles in pixels
      const INTERACT_RANGE_SQ = INTERACT_RANGE * INTERACT_RANGE;
      const localTeamId = latestServerState?.players.find(
        (player) => player.id === net.playerId,
      )?.teamId;

      if (
        localPlayerRole === 'survivor' &&
        latestServerState?.match.status === 'running' &&
        latestServerState.portal &&
        portal &&
        latestServerState.runestones.every((runestone) => runestone.activated) &&
        isWithinPortalInteractionRange(
          { x: localX, y: localY },
          latestServerState.portal,
        )
      ) {
        const dx = localX - latestServerState.portal.x;
        const dy = localY - latestServerState.portal.y;
        considerPrompt(-1, dx * dx + dy * dy, portal.sprite.x, portal.sprite.y - 25);
      }

      for (const rs of tilemapRenderer.runestoneSprites) {
        if (rs.activated || rs.index !== localTeamId) continue;
        const rsCenterX = rs.tileX * TILE_SIZE + TILE_SIZE / 2;
        const rsCenterY = (rs.tileY + 1) * TILE_SIZE;
        const dx = localX - rsCenterX;
        const dy = localY - rsCenterY;
        const distSq = dx * dx + dy * dy;
        if (distSq < INTERACT_RANGE_SQ) {
          considerPrompt(
            0,
            distSq,
            rs.sprite.x,
            rs.sprite.y - rs.sprite.height - 2,
          );
        }
      }

      if (latestServerState && net.playerId) {
        const activeLocalCage = findActivePlayerCage(
          latestServerState.cageStates,
          net.playerId,
        );
        if (!activeLocalCage) {
          const cageTarget = findOpenableCage(
            latestServerState.cageStates,
            net.playerId,
            localX,
            localY,
          );
          if (cageTarget) {
            const point = getCageInteractionPoint(cageTarget.cage);
            considerPrompt(
              1,
              cageTarget.distanceSquared,
              point.x,
              cageTarget.cage.y - 34,
            );
          }
        }
      }

      if (localPlayerRole === 'warden' && currentLayout) {
        const trapTarget = findTrapCellInteractionTarget(
          currentLayout.trapCells,
          localX,
          localY,
          TILE_SIZE,
        );
        if (trapTarget) {
          // The trap prompt belongs to the warden, not the floor target.
          const shakeProgress = Math.max(
            0,
            1 - emptyTrapPromptShakeElapsed / EMPTY_TRAP_PROMPT_SHAKE_DURATION,
          );
          const shakeX = emptyTrapPromptShakeActive
            ? Math.round(Math.sin(emptyTrapPromptShakeElapsed * 85) * 2 * shakeProgress)
            : 0;
          const shakeY = emptyTrapPromptShakeActive
            ? Math.round(Math.sin(emptyTrapPromptShakeElapsed * 63) * shakeProgress)
            : 0;
          considerPrompt(
            2,
            trapTarget.distanceSquared,
            localX + shakeX,
            localY - 30 + shakeY,
          );
        }
      }

      if (canLocalPlayerOpenChest()) {
        const chestRangeSq = CHEST_INTERACTION_RANGE * CHEST_INTERACTION_RANGE;
        for (const chest of tilemapRenderer.chestDeadEndVisuals) {
          if (chest.isOpened()) continue;
          const dx = localX - chest.interactionX;
          const dy = localY - chest.interactionY;
          const distSq = dx * dx + dy * dy;
          if (distSq <= chestRangeSq) {
            considerPrompt(5, distSq, chest.promptX, chest.promptY);
          }
        }
      }

      if (localPlayerRole === 'warden' && latestServerState) {
        const latchedPlateIds = new Set(
          latestServerState.pressurePlateStates
            .filter((plateState) => plateState.latched)
            .map((plateState) => plateState.plateId),
        );
        const plateRangeSq =
          PRESSURE_PLATE_INTERACTION_RANGE * PRESSURE_PLATE_INTERACTION_RANGE;

        for (const plate of tilemapRenderer.pressurePlateSprites) {
          if (latchedPlateIds.has(plate.plateId)) continue;
          const plateCenterX = (plate.tileX + 0.5) * TILE_SIZE;
          const plateCenterY = (plate.tileY + 0.5) * TILE_SIZE;
          const dx = localX - plateCenterX;
          const dy = localY - plateCenterY;
          const distSq = dx * dx + dy * dy;
          if (distSq <= plateRangeSq) {
            considerPrompt(
              4,
              distSq,
              plate.sprite.x + plate.sprite.width / 2,
              plate.sprite.y - 3,
            );
          }
        }
      }

      if (
        (localPlayerRole === 'warden' || localPlayerRole === 'survivor') &&
        currentLayout &&
        latestServerState
      ) {
        const swordFieldTarget = findSwordFieldWisdomTarget(
          currentLayout.swordFields,
          latestServerState.swordFieldStates,
          localX,
          localY,
          TILE_SIZE,
        );
        if (swordFieldTarget) {
          considerPrompt(
            3,
            0,
            swordFieldTarget.x,
            swordFieldTarget.y - 12,
            localPlayerRole === 'warden' ? '[ E ]' : '[ Q ]',
          );
        }
      }

      if (nearestDistSq < Infinity && isLocalPlayerActionable()) {
        if (interactPrompt.text !== promptText) interactPrompt.text = promptText;
        if (!interactPrompt.visible) interactPrompt.visible = true;
        if (interactPrompt.x !== promptX) interactPrompt.x = promptX;
        if (interactPrompt.y !== promptY) interactPrompt.y = promptY;
        if (interactPrompt.zIndex !== 99999) interactPrompt.zIndex = 99999;
      } else {
        if (interactPrompt.visible) interactPrompt.visible = false;
      }
    }

    // ── 6. Pressure plate animations ───────────────────────────────────
    if (tilemapRenderer && latestServerState) {
      updatePressurePlateAnimations(tilemapRenderer, latestServerState, dtSeconds);
    }
    updatePlayerNameTagScreenPositions();
  });

  // ── Mousewheel Zoom (debug) ───────────────────────────────────────────
  app.canvas.addEventListener(
    'wheel',
    (e: WheelEvent) => {
      e.preventDefault();
      if (gameMenuOpen) return;
      if (!DebugSettings.isEnabled('scrollZoom')) return;
      if (e.deltaY < 0) zoomLevel = Math.min(MAX_ZOOM, zoomLevel + ZOOM_STEP);
      else zoomLevel = Math.max(MIN_ZOOM, zoomLevel - ZOOM_STEP);
      zoomToggleState = 'default'; // manual scroll resets the toggle cycle
    },
    { passive: false },
  );

  // ── Minus-key Zoom Toggle (debug) ─────────────────────────────────────
  // Cycles:  default → fully zoomed-out → fully zoomed-in → default
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.code !== 'Minus' && e.code !== 'NumpadSubtract') return;
    if (gameMenuOpen) return;
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
    if (gameMenuOpen) return;
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
      setPlayerPosition(localData, localX, localY);
    }

    console.info(
      `[Debug] Teleported to (${Math.round(clampedX)}, ${Math.round(clampedY)})`,
    );
  });

  // ── Keyboard Input ────────────────────────────────────────────────────
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (chatInputActive) return;

    if (e.code === 'Escape' && minimap?.isExpanded()) {
      e.preventDefault();
      minimap.closeExpanded();
      return;
    }

    if (
      e.code === 'Escape' &&
      net.isConnected &&
      latestServerState?.match.status === 'running'
    ) {
      e.preventDefault();
      if (!e.repeat) gameMenuHud?.handleEscape();
      return;
    }

    if (gameMenuOpen) return;

    if (
      !e.repeat &&
      (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'KeyT')
    ) {
      e.preventDefault();
      chatHud?.open();
      return;
    }

    const dir = KEY_MAP[e.code];
    if (dir) setKeyboardDirection(dir, true);

    if (e.code === 'KeyE' && minimap?.isExpanded()) {
      if (!e.repeat) triggerInteract();
      return;
    }

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
    if (chatInputActive || gameMenuOpen) return;
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
  // Use the page origin for the game socket in every environment. Vite proxies
  // /ws to the local game server during development, so LAN clients need access
  // only to the same port that already serves the page.
  const defaultWsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;
  let wsUrl = envUrl?.trim() || defaultWsUrl;

  if (envUrl && !['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)) {
    try {
      const configuredHostname = new URL(envUrl).hostname;
      if (['localhost', '127.0.0.1', '[::1]'].includes(configuredHostname)) {
        console.warn(
          `[Main] Ignoring loopback-only VITE_SERVER_URL on LAN; using ${defaultWsUrl}`,
        );
        wsUrl = defaultWsUrl;
      }
    } catch {
      // Let WebSocket report malformed explicit overrides with its normal error.
    }
  }
  const displayName = options.displayName;

  net.connect(
    wsUrl,
    options.reconnectSession,
    displayName,
    options.accessToken,
  );

  console.info('─────────────────────────────────────────────────');
  console.info('  🏹 False Arrow Client');
  console.info('  Step 9: 2.5D Perspective (Stardew style walls)');
  console.info(
    `  Map: ${MAZE_WIDTH}×${MAZE_HEIGHT} tiles (${mapPixelW}×${mapPixelH} px)`,
  );
  console.info(`  Display name: ${displayName}`);
  console.info('─────────────────────────────────────────────────');
}

export async function startGame(options: GameLaunchOptions): Promise<void> {
  try {
    await initializeGame(options);
  } catch (error: unknown) {
    console.error(error);
    showLoadingError('The maze could not be opened. Refresh to try again.');
    throw error;
  }
}
