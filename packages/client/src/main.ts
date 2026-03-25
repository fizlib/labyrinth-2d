// packages/client/src/main.ts
// ─────────────────────────────────────────────────────────────────────────────
// Labyrinth 2D — Client Entry Point (Step 3: Engine + Dumb Movement)
// ─────────────────────────────────────────────────────────────────────────────
//
// MULTIPLAYER ARCHITECTURE (Client-Side):
//
// Step 3 uses "dumb" authoritative movement — the client renders the exact
// server positions with no prediction. You WILL see latency. This is
// intentional so we can observe raw server delay before adding prediction
// in Step 4.
//
// 1. PixiJS canvas mounted with pixel-art constraints (480×270, no AA).
// 2. WASD / Arrow keys send PlayerInput to server on state change.
// 3. Each TickUpdate (~20/sec) updates sprite positions to server coords.
// 4. Debug UI overlay shows tick, player list, connection status.
// ─────────────────────────────────────────────────────────────────────────────

import { Application, Graphics } from 'pixi.js';
import { INTERNAL_WIDTH, INTERNAL_HEIGHT, TILE_SIZE } from '@labyrinth/shared';
import type { GameState } from '@labyrinth/shared';
import { NetworkManager } from './net/NetworkManager';

// ── Player Colors ───────────────────────────────────────────────────────────

/** Vivid color for the local player square. */
const LOCAL_PLAYER_COLOR = 0x00e676; // Bright green
/** Vivid color for remote player squares. */
const REMOTE_PLAYER_COLOR = 0xff5252; // Bright red

// ── Input State ─────────────────────────────────────────────────────────────

const keys = {
  up: false,
  down: false,
  left: false,
  right: false,
};

/** Track which keys map to which direction. */
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
        <span class="stat-label">Your Player ID</span>
        <span class="stat-value" id="player-id">—</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Room</span>
        <span class="stat-value" id="room-id">—</span>
      </div>
    </div>
    <h2>Connected Players</h2>
    <ul id="player-list"></ul>
  `;
  document.body.appendChild(debugDiv);
}

function updateDebugUI(state: GameState, playerId: string | null): void {
  const tickEl = document.getElementById('tick-counter');
  const playerListEl = document.getElementById('player-list');

  if (tickEl) tickEl.textContent = state.tick.toString();

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
    width: INTERNAL_WIDTH,        // 480px internal
    height: INTERNAL_HEIGHT,      // 270px internal
    antialias: false,             // CRITICAL: No AA for pixel art
    roundPixels: true,            // Snap sprites to integer coords
    backgroundColor: 0x1a1a2e,    // Deep navy
    canvas: document.createElement('canvas'),
    resizeTo: undefined,          // Manual integer scaling
  });

  // Mount canvas into the game container
  const container = document.getElementById('game-container');
  if (!container) throw new Error('Missing #game-container');
  container.appendChild(app.canvas);

  // Apply integer scaling
  resizeCanvas(app);
  window.addEventListener('resize', () => resizeCanvas(app));

  // ── Debug UI (overlay on top of the canvas) ─────────────────────────────
  createDebugUI();

  const statusEl = document.getElementById('connection-status');
  const playerIdEl = document.getElementById('player-id');
  const roomIdEl = document.getElementById('room-id');

  // ── Player Sprite Registry ──────────────────────────────────────────────
  // Maps player ID → Graphics object on the PixiJS stage.
  const playerSprites: Map<string, Graphics> = new Map();

  /**
   * Create or update a player sprite on the stage.
   * Local player = bright green, remote = bright red.
   */
  function ensurePlayerSprite(
    playerId: string,
    isLocal: boolean,
  ): Graphics {
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

  /** Remove a player's sprite from the stage. */
  function removePlayerSprite(playerId: string): void {
    const sprite = playerSprites.get(playerId);
    if (sprite) {
      app.stage.removeChild(sprite);
      sprite.destroy();
      playerSprites.delete(playerId);
    }
  }

  /**
   * Render all players from the latest game state.
   * Positions come directly from the server — no prediction.
   */
  function renderPlayers(state: GameState, localPlayerId: string | null): void {
    // Track which player IDs are in this update
    const activeIds = new Set<string>();

    for (const player of state.players) {
      activeIds.add(player.id);
      const isLocal = player.id === localPlayerId;
      const sprite = ensurePlayerSprite(player.id, isLocal);
      // Snap to server-authoritative position (dumb rendering — expect latency)
      sprite.x = Math.round(player.x);
      sprite.y = Math.round(player.y);
    }

    // Remove sprites for players no longer in the state
    for (const [id] of playerSprites) {
      if (!activeIds.has(id)) {
        removePlayerSprite(id);
      }
    }
  }

  // ── Network Manager ───────────────────────────────────────────────────
  const net = new NetworkManager({
    onRoomJoined: (roomId, playerId, gameState) => {
      console.info(`[Main] Joined room "${roomId}" as ${playerId}`);

      if (statusEl) {
        statusEl.textContent = '🟢 Connected';
        statusEl.classList.add('connected');
      }
      if (playerIdEl) playerIdEl.textContent = playerId;
      if (roomIdEl) roomIdEl.textContent = roomId;

      renderPlayers(gameState, playerId);
      updateDebugUI(gameState, playerId);
    },

    onTickUpdate: (gameState) => {
      renderPlayers(gameState, net.playerId);
      updateDebugUI(gameState, net.playerId);
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

  // ── Keyboard Input ────────────────────────────────────────────────────
  // Send a PlayerInput to the server whenever key state changes.

  function sendCurrentInput(): void {
    if (!net.isConnected) return;
    net.sendInput(keys.up, keys.down, keys.left, keys.right);
  }

  window.addEventListener('keydown', (e: KeyboardEvent) => {
    const dir = KEY_MAP[e.code];
    if (dir && !keys[dir]) {
      keys[dir] = true;
      sendCurrentInput();
    }
  });

  window.addEventListener('keyup', (e: KeyboardEvent) => {
    const dir = KEY_MAP[e.code];
    if (dir && keys[dir]) {
      keys[dir] = false;
      sendCurrentInput();
    }
  });

  // Prevent keys from triggering when focus lost
  window.addEventListener('blur', () => {
    keys.up = false;
    keys.down = false;
    keys.left = false;
    keys.right = false;
    sendCurrentInput();
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
  console.info('  🏰 Labyrinth 2D Client (Step 3: Dumb Movement)');
  console.info(`  Internal: ${INTERNAL_WIDTH}×${INTERNAL_HEIGHT}`);
  console.info(`  Scale: ${getIntegerScale(window.innerWidth, window.innerHeight)}×`);
  console.info(`  Display name: ${displayName}`);
  console.info('─────────────────────────────────────────────────');
}

main().catch(console.error);
