// packages/client/src/main.ts
// ─────────────────────────────────────────────────────────────────────────────
// Labyrinth 2D — Client Entry Point
// Step 4: Client-Side Prediction & Server Reconciliation
// ─────────────────────────────────────────────────────────────────────────────
//
// MULTIPLAYER ARCHITECTURE (Client-Side):
//
// 1. CLIENT-SIDE PREDICTION:
//    - Every frame (60 fps), if the player is pressing movement keys, we:
//      a) Create a PlayerInput with an incrementing sequenceNumber.
//      b) Push it to the pendingInputs buffer.
//      c) Send it to the server.
//      d) IMMEDIATELY apply it to the local player's position using the
//         shared applyInput() function. This eliminates perceived latency.
//
// 2. SERVER RECONCILIATION:
//    - When a TickUpdate arrives from the server (~20 tps):
//      a) For remote players: snap their sprite to the server position.
//      b) For the LOCAL player:
//         i)   Force x/y to the server's authoritative position.
//         ii)  Remove all pendingInputs where sequenceNumber <= server's
//              lastProcessedInput (those are acknowledged).
//         iii) Re-apply all REMAINING pendingInputs on top of the server
//              position using applyInput(). This corrects any mispredictions
//              while keeping unacknowledged inputs visible.
//
// 3. ENTITY INTERPOLATION (future step):
//    - Remote players will be interpolated instead of snapped.
// ─────────────────────────────────────────────────────────────────────────────

import { Application, Graphics } from 'pixi.js';
import {
  INTERNAL_WIDTH,
  INTERNAL_HEIGHT,
  TILE_SIZE,
  applyInput,
} from '@labyrinth/shared';
import type { GameState } from '@labyrinth/shared';
import { NetworkManager } from './net/NetworkManager';

// ── Player Colors ───────────────────────────────────────────────────────────

const LOCAL_PLAYER_COLOR = 0x00e676;  // Bright green
const REMOTE_PLAYER_COLOR = 0xff5252; // Bright red

// ── Input State ─────────────────────────────────────────────────────────────

const keys = {
  up: false,
  down: false,
  left: false,
  right: false,
};

const KEY_MAP: Record<string, keyof typeof keys> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  KeyW: 'up',
  KeyS: 'down',
  KeyA: 'left',
  KeyD: 'right',
};

// ── Prediction State ────────────────────────────────────────────────────────

/**
 * A stored input for client-side prediction and server reconciliation.
 * We keep the direction flags + the sequence number + the dt used.
 */
interface PendingInput {
  sequenceNumber: number;
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  /** The dt (in seconds) that was used when this input was predicted. */
  dt: number;
}

/** Buffer of inputs that have been predicted locally but not yet acknowledged by the server. */
let pendingInputs: PendingInput[] = [];

/** Monotonically increasing input sequence counter. */
let inputSequenceNumber = 0;

/** The local player's predicted position (separate from the sprite, which renders this). */
let localX = 0;
let localY = 0;

/** Whether the local player has been initialized with a server position. */
let localPlayerInitialized = false;

// ── Integer Scaling ─────────────────────────────────────────────────────────

function getIntegerScale(viewportW: number, viewportH: number): number {
  const scaleX = Math.floor(viewportW / INTERNAL_WIDTH);
  const scaleY = Math.floor(viewportH / INTERNAL_HEIGHT);
  return Math.max(1, Math.min(scaleX, scaleY));
}

function resizeCanvas(app: Application): void {
  const scale = getIntegerScale(window.innerWidth, window.innerHeight);
  app.canvas.style.width = `${INTERNAL_WIDTH * scale}px`;
  app.canvas.style.height = `${INTERNAL_HEIGHT * scale}px`;
  app.renderer.resize(INTERNAL_WIDTH, INTERNAL_HEIGHT);
}

// ── Debug UI ────────────────────────────────────────────────────────────────

function createDebugUI(): void {
  const debugDiv = document.createElement('div');
  debugDiv.id = 'debug-ui';
  debugDiv.innerHTML = `
    <h1>🏰 Labyrinth 2D — Network Debug</h1>
    <div class="status" id="connection-status">⏳ Connecting...</div>
    <div class="stats">
      <div class="stat-card">
        <span class="stat-label">Server Tick</span>
        <span class="stat-value" id="tick-counter">—</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Pending Inputs</span>
        <span class="stat-value" id="pending-count">0</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Input Seq</span>
        <span class="stat-value" id="input-seq">0</span>
      </div>
    </div>
    <h2>Connected Players</h2>
    <ul id="player-list"></ul>
  `;
  document.body.appendChild(debugDiv);
}

function updateDebugUI(state: GameState, playerId: string | null): void {
  const tickEl = document.getElementById('tick-counter');
  const pendingEl = document.getElementById('pending-count');
  const seqEl = document.getElementById('input-seq');
  const playerListEl = document.getElementById('player-list');

  if (tickEl) tickEl.textContent = state.tick.toString();
  if (pendingEl) pendingEl.textContent = pendingInputs.length.toString();
  if (seqEl) seqEl.textContent = inputSequenceNumber.toString();

  if (playerListEl) {
    playerListEl.innerHTML = state.players
      .map((p) => {
        const isYou = p.id === playerId ? ' <span class="you-badge">← you</span>' : '';
        return `<li><span class="player-name">${p.displayName}</span> <span class="player-id">${p.id}</span> <span class="player-pos">(${Math.round(p.x)}, ${Math.round(p.y)})</span>${isYou}</li>`;
      })
      .join('');
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // ── PixiJS Application ──────────────────────────────────────────────────
  const app = new Application();

  await app.init({
    width: INTERNAL_WIDTH,
    height: INTERNAL_HEIGHT,
    antialias: false,
    roundPixels: true,
    backgroundColor: 0x1a1a2e,
    canvas: document.createElement('canvas'),
    resizeTo: undefined,
  });

  const container = document.getElementById('game-container');
  if (!container) throw new Error('Missing #game-container');
  container.appendChild(app.canvas);

  resizeCanvas(app);
  window.addEventListener('resize', () => resizeCanvas(app));

  createDebugUI();

  const statusEl = document.getElementById('connection-status');
  const playerIdEl = document.getElementById('player-id');
  const roomIdEl = document.getElementById('room-id');

  // ── Player Sprite Registry ──────────────────────────────────────────────

  const playerSprites: Map<string, Graphics> = new Map();

  function ensurePlayerSprite(playerId: string, isLocal: boolean): Graphics {
    let sprite = playerSprites.get(playerId);
    if (!sprite) {
      sprite = new Graphics();
      const color = isLocal ? LOCAL_PLAYER_COLOR : REMOTE_PLAYER_COLOR;
      sprite.rect(0, 0, TILE_SIZE, TILE_SIZE);
      sprite.fill(color);
      app.stage.addChild(sprite);
      playerSprites.set(playerId, sprite);
    }
    return sprite;
  }

  function removePlayerSprite(playerId: string): void {
    const sprite = playerSprites.get(playerId);
    if (sprite) {
      app.stage.removeChild(sprite);
      sprite.destroy();
      playerSprites.delete(playerId);
    }
  }

  // ── Network Manager ───────────────────────────────────────────────────

  /** Reference to the latest server game state for the debug UI. */
  let latestServerState: GameState | null = null;

  const net = new NetworkManager({
    onRoomJoined: (roomId, playerId, gameState) => {
      console.info(`[Main] Joined room "${roomId}" as ${playerId}`);

      if (statusEl) {
        statusEl.textContent = '🟢 Connected';
        statusEl.classList.add('connected');
      }

      // Initialize local player position from server
      const me = gameState.players.find((p) => p.id === playerId);
      if (me) {
        localX = me.x;
        localY = me.y;
        localPlayerInitialized = true;
      }

      // Render all players at their server positions
      for (const player of gameState.players) {
        const isLocal = player.id === playerId;
        const sprite = ensurePlayerSprite(player.id, isLocal);
        sprite.x = Math.round(player.x);
        sprite.y = Math.round(player.y);
      }

      latestServerState = gameState;
      updateDebugUI(gameState, playerId);
    },

    onTickUpdate: (gameState) => {
      const localPlayerId = net.playerId;

      for (const player of gameState.players) {
        const isLocal = player.id === localPlayerId;
        const sprite = ensurePlayerSprite(player.id, isLocal);

        if (isLocal) {
          // ── SERVER RECONCILIATION ───────────────────────────────
          // a) Force position to the server's authoritative state
          localX = player.x;
          localY = player.y;

          // b) Discard all acknowledged inputs
          pendingInputs = pendingInputs.filter(
            (input) => input.sequenceNumber > player.lastProcessedInput,
          );

          // c) Re-apply all unacknowledged inputs on top of the server state
          for (const input of pendingInputs) {
            const result = applyInput(localX, localY, input, input.dt);
            localX = result.x;
            localY = result.y;
          }

          // Update sprite to the reconciled position
          sprite.x = Math.round(localX);
          sprite.y = Math.round(localY);
        } else {
          // Remote players: snap to server position (interpolation in future step)
          sprite.x = Math.round(player.x);
          sprite.y = Math.round(player.y);
        }
      }

      // Remove sprites for players no longer in the state
      const activeIds = new Set(gameState.players.map((p) => p.id));
      for (const [id] of playerSprites) {
        if (!activeIds.has(id)) {
          removePlayerSprite(id);
        }
      }

      latestServerState = gameState;
      updateDebugUI(gameState, localPlayerId);
    },

    onPlayerLeft: (playerId) => {
      console.info(`[Main] Player left: ${playerId}`);
      removePlayerSprite(playerId);
    },

    onError: (code, message) => {
      console.error(`[Main] Server error [${code}]: ${message}`);
      if (statusEl) {
        statusEl.textContent = `🔴 Error: ${message}`;
        statusEl.classList.add('error');
      }
    },

    onDisconnect: () => {
      console.info('[Main] Disconnected from server');
      if (statusEl) {
        statusEl.textContent = '🔴 Disconnected';
        statusEl.classList.remove('connected');
        statusEl.classList.add('error');
      }
    },
  });

  // ── 60 FPS Game Loop — Input Sampling & Prediction ────────────────────
  //
  // Every frame:
  //   1. Check if any movement key is pressed.
  //   2. If yes, create a PendingInput, apply it locally (prediction),
  //      send it to the server, and push it to the pendingInputs buffer.
  //   3. Update the local player sprite to the predicted position.

  app.ticker.add((ticker) => {
    if (!net.isConnected || !localPlayerInitialized || !net.playerId) return;

    const dtSeconds = ticker.deltaMS / 1000;
    const isMoving = keys.up || keys.down || keys.left || keys.right;

    if (isMoving) {
      // 1. Create the input
      inputSequenceNumber++;

      const input: PendingInput = {
        sequenceNumber: inputSequenceNumber,
        up: keys.up,
        down: keys.down,
        left: keys.left,
        right: keys.right,
        dt: dtSeconds,
      };

      // 2. Push to pending buffer (for reconciliation later)
      pendingInputs.push(input);

      // 3. Send to server
      net.sendInput(
        input.sequenceNumber,
        input.up,
        input.down,
        input.left,
        input.right,
      );

      // 4. CLIENT-SIDE PREDICTION: apply immediately to local position
      const result = applyInput(localX, localY, input, dtSeconds);
      localX = result.x;
      localY = result.y;
    }

    // 5. Update the local player's sprite to the predicted position
    const localSprite = playerSprites.get(net.playerId);
    if (localSprite) {
      localSprite.x = Math.round(localX);
      localSprite.y = Math.round(localY);
    }
  });

  // ── Keyboard Input ────────────────────────────────────────────────────

  window.addEventListener('keydown', (e: KeyboardEvent) => {
    const dir = KEY_MAP[e.code];
    if (dir) keys[dir] = true;
  });

  window.addEventListener('keyup', (e: KeyboardEvent) => {
    const dir = KEY_MAP[e.code];
    if (dir) keys[dir] = false;
  });

  window.addEventListener('blur', () => {
    keys.up = false;
    keys.down = false;
    keys.left = false;
    keys.right = false;
  });

  // ── Connect to Server ─────────────────────────────────────────────────
  const wsUrl = import.meta.env.DEV
    ? 'ws://localhost:9001'
    : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;

  const displayName = `Explorer-${Math.floor(Math.random() * 9999)
    .toString()
    .padStart(4, '0')}`;

  net.connect(wsUrl, 'default', displayName);

  console.info('─────────────────────────────────────────────────');
  console.info('  🏰 Labyrinth 2D Client');
  console.info('  Step 4: Client-Side Prediction + Reconciliation');
  console.info(`  Internal: ${INTERNAL_WIDTH}×${INTERNAL_HEIGHT}`);
  console.info(`  Scale: ${getIntegerScale(window.innerWidth, window.innerHeight)}×`);
  console.info(`  Display name: ${displayName}`);
  console.info('─────────────────────────────────────────────────');
}

main().catch(console.error);
