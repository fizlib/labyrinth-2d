// packages/client/src/main.ts
// ─────────────────────────────────────────────────────────────────────────────
// Labyrinth 2D — Client Entry Point
// Step 5: Tilemap Integration & Collision
// ─────────────────────────────────────────────────────────────────────────────
//
// MULTIPLAYER ARCHITECTURE (Client-Side):
//
// 1. CLIENT-SIDE PREDICTION with COLLISION:
//    - Every frame (60 fps), if moving, we predict movement locally using
//      applyInputWithCollision() — the SAME function the server uses.
//    - This prevents rubber-banding: the client never predicts through walls.
//
// 2. SERVER RECONCILIATION with COLLISION:
//    - On TickUpdate, snap local pos to server, discard acknowledged inputs,
//      and re-apply pending inputs WITH collision so reconciled pos matches.
//
// 3. TILEMAP RENDERING:
//    - Wall tiles (ID: 1) drawn as gray rectangles using PixiJS Graphics.
//    - No external textures loaded yet — pure primitives.
// ─────────────────────────────────────────────────────────────────────────────

import { Application, Graphics, Container } from 'pixi.js';
import {
  INTERNAL_WIDTH,
  INTERNAL_HEIGHT,
  TILE_SIZE,
  LEVEL_1_MAP,
  applyInputWithCollision,
} from '@labyrinth/shared';
import type { GameState, TileMapData } from '@labyrinth/shared';
import { NetworkManager } from './net/NetworkManager';

// ── Colors ──────────────────────────────────────────────────────────────────

const LOCAL_PLAYER_COLOR = 0x00e676;   // Bright green
const REMOTE_PLAYER_COLOR = 0xff5252;  // Bright red
const WALL_COLOR = 0x4a4a68;           // Muted purple-gray
const FLOOR_COLOR = 0x1e1e32;          // Very dark navy (slightly lighter than bg)

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

// ── Tilemap Rendering ───────────────────────────────────────────────────────

/**
 * Render the tilemap as PixiJS Graphics primitives.
 * Wall tiles (ID: 1) = gray rectangles, floor tiles (ID: 0) = dark rectangles.
 * Returns a Container that can be added to the stage.
 */
function renderTilemap(map: TileMapData): Container {
  const tilemap = new Container();
  const ts = map.tileSize;

  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const tileId = map.data[y * map.width + x];
      const g = new Graphics();

      if (tileId === 1) {
        // Wall tile — raised look with subtle border
        g.rect(0, 0, ts, ts);
        g.fill(WALL_COLOR);
        // Inner highlight (top-left edge)
        g.rect(0, 0, ts, 1);
        g.fill(0x5c5c80);
        g.rect(0, 0, 1, ts);
        g.fill(0x5c5c80);
        // Inner shadow (bottom-right edge)
        g.rect(0, ts - 1, ts, 1);
        g.fill(0x36364e);
        g.rect(ts - 1, 0, 1, ts);
        g.fill(0x36364e);
      } else {
        // Floor tile — subtle grid
        g.rect(0, 0, ts, ts);
        g.fill(FLOOR_COLOR);
        // Very subtle grid line
        g.rect(ts - 1, 0, 1, ts);
        g.fill(0x24243a);
        g.rect(0, ts - 1, ts, 1);
        g.fill(0x24243a);
      }

      g.x = x * ts;
      g.y = y * ts;
      tilemap.addChild(g);
    }
  }

  return tilemap;
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
    backgroundColor: 0x0e0e1a,
    canvas: document.createElement('canvas'),
    resizeTo: undefined,
  });

  const container = document.getElementById('game-container');
  if (!container) throw new Error('Missing #game-container');
  container.appendChild(app.canvas);

  resizeCanvas(app);
  window.addEventListener('resize', () => resizeCanvas(app));

  // ── Render Tilemap ──────────────────────────────────────────────────────
  const tilemapContainer = renderTilemap(LEVEL_1_MAP);
  app.stage.addChild(tilemapContainer);

  // ── Player layer (on top of tilemap) ───────────────────────────────────
  const playerLayer = new Container();
  app.stage.addChild(playerLayer);

  // ── Debug UI (overlay) ────────────────────────────────────────────────
  createDebugUI();

  const statusEl = document.getElementById('connection-status');

  // ── Player Sprite Registry ──────────────────────────────────────────────

  const playerSprites: Map<string, Graphics> = new Map();

  function ensurePlayerSprite(playerId: string, isLocal: boolean): Graphics {
    let sprite = playerSprites.get(playerId);
    if (!sprite) {
      sprite = new Graphics();
      const color = isLocal ? LOCAL_PLAYER_COLOR : REMOTE_PLAYER_COLOR;
      sprite.rect(0, 0, TILE_SIZE, TILE_SIZE);
      sprite.fill(color);
      playerLayer.addChild(sprite);
      playerSprites.set(playerId, sprite);
    }
    return sprite;
  }

  function removePlayerSprite(playerId: string): void {
    const sprite = playerSprites.get(playerId);
    if (sprite) {
      playerLayer.removeChild(sprite);
      sprite.destroy();
      playerSprites.delete(playerId);
    }
  }

  // ── Network Manager ───────────────────────────────────────────────────

  let latestServerState: GameState | null = null;

  const net = new NetworkManager({
    onRoomJoined: (roomId, playerId, gameState) => {
      console.info(`[Main] Joined room "${roomId}" as ${playerId}`);

      if (statusEl) {
        statusEl.textContent = '🟢 Connected';
        statusEl.classList.add('connected');
      }

      const me = gameState.players.find((p) => p.id === playerId);
      if (me) {
        localX = me.x;
        localY = me.y;
        localPlayerInitialized = true;
      }

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
          // ── SERVER RECONCILIATION (with collision) ──────────────
          // a) Force position to the server's authoritative state
          localX = player.x;
          localY = player.y;

          // b) Discard all acknowledged inputs
          pendingInputs = pendingInputs.filter(
            (input) => input.sequenceNumber > player.lastProcessedInput,
          );

          // c) Re-apply all unacknowledged inputs WITH collision
          for (const input of pendingInputs) {
            const result = applyInputWithCollision(
              localX,
              localY,
              input,
              input.dt,
              LEVEL_1_MAP,
            );
            localX = result.x;
            localY = result.y;
          }

          sprite.x = Math.round(localX);
          sprite.y = Math.round(localY);
        } else {
          // Remote players: snap to server position
          sprite.x = Math.round(player.x);
          sprite.y = Math.round(player.y);
        }
      }

      // Remove sprites for disconnected players
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

  // ── 60 FPS Game Loop — Prediction with Collision ──────────────────────

  app.ticker.add((ticker) => {
    if (!net.isConnected || !localPlayerInitialized || !net.playerId) return;

    const dtSeconds = ticker.deltaMS / 1000;
    const isMoving = keys.up || keys.down || keys.left || keys.right;

    if (isMoving) {
      inputSequenceNumber++;

      const input: PendingInput = {
        sequenceNumber: inputSequenceNumber,
        up: keys.up,
        down: keys.down,
        left: keys.left,
        right: keys.right,
        dt: dtSeconds,
      };

      // CLIENT-SIDE PREDICTION with collision — prevents rubber-banding
      const result = applyInputWithCollision(
        localX,
        localY,
        input,
        dtSeconds,
        LEVEL_1_MAP,
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
      );
    }

    // Update local player sprite to predicted position
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
  console.info('  Step 5: Tilemap + Collision');
  console.info(`  Map: ${LEVEL_1_MAP.width}×${LEVEL_1_MAP.height} tiles`);
  console.info(`  Internal: ${INTERNAL_WIDTH}×${INTERNAL_HEIGHT}`);
  console.info(`  Scale: ${getIntegerScale(window.innerWidth, window.innerHeight)}×`);
  console.info(`  Display name: ${displayName}`);
  console.info('─────────────────────────────────────────────────');
}

main().catch(console.error);
