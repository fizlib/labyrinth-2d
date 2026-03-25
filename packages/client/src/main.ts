// packages/client/src/main.ts
// ─────────────────────────────────────────────────────────────────────────────
// Labyrinth 2D — Client Entry Point
// Step 6: Entity Interpolation (Remote Player Smoothing)
// ─────────────────────────────────────────────────────────────────────────────
//
// MULTIPLAYER ARCHITECTURE (Client-Side):
//
// 1. CLIENT-SIDE PREDICTION (local player — unchanged from Step 5):
//    - 60fps: sample keys → predict via applyInputWithCollision() → buffer.
//    - On TickUpdate: snap to server, discard acknowledged, re-apply pending.
//
// 2. ENTITY INTERPOLATION (remote players — NEW in Step 6):
//    - Server snapshots are stored in a SnapshotBuffer with local timestamps.
//    - Remote players render at (performance.now() - INTERPOLATION_DELAY),
//      100ms behind real-time.
//    - We find the two snapshots bracketing renderTime and lerp x/y.
//    - This turns 20-tps updates into buttery 60-fps movement for remotes.
//
// 3. TILEMAP + COLLISION: same as Step 5.
// ─────────────────────────────────────────────────────────────────────────────

import { Application, Graphics, Container } from 'pixi.js';
import {
  INTERNAL_WIDTH,
  INTERNAL_HEIGHT,
  TILE_SIZE,
  LEVEL_1_MAP,
  applyInputWithCollision,
} from '@labyrinth/shared';
import type { GameState, TileMapData, PlayerInfo } from '@labyrinth/shared';
import { NetworkManager } from './net/NetworkManager';
import { SnapshotBuffer, INTERPOLATION_DELAY } from './net/SnapshotBuffer';

// ── Colors ──────────────────────────────────────────────────────────────────

const LOCAL_PLAYER_COLOR = 0x00e676;   // Bright green
const REMOTE_PLAYER_COLOR = 0xff5252;  // Bright red
const WALL_COLOR = 0x4a4a68;           // Muted purple-gray
const FLOOR_COLOR = 0x1e1e32;          // Very dark navy

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

// ── Snapshot Buffer (for remote player interpolation) ────────────────────────

const snapshotBuffer = new SnapshotBuffer();

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

function renderTilemap(map: TileMapData): Container {
  const tilemap = new Container();
  const ts = map.tileSize;

  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const tileId = map.data[y * map.width + x];
      const g = new Graphics();

      if (tileId === 1) {
        g.rect(0, 0, ts, ts);
        g.fill(WALL_COLOR);
        g.rect(0, 0, ts, 1);
        g.fill(0x5c5c80);
        g.rect(0, 0, 1, ts);
        g.fill(0x5c5c80);
        g.rect(0, ts - 1, ts, 1);
        g.fill(0x36364e);
        g.rect(ts - 1, 0, 1, ts);
        g.fill(0x36364e);
      } else {
        g.rect(0, 0, ts, ts);
        g.fill(FLOOR_COLOR);
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

// ── Interpolation Helper ────────────────────────────────────────────────────

/** Linear interpolation. */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Get the interpolated position for a remote player at the current renderTime.
 *
 * 1. Look for two bracketing snapshots in the buffer.
 * 2. Find the player in both snapshots.
 * 3. Lerp their x/y by the interpolation factor t.
 * 4. Fallback: if no pair, use the latest known position.
 */
function getInterpolatedPosition(
  playerId: string,
  renderTime: number,
): { x: number; y: number } | null {
  const pair = snapshotBuffer.getInterpolationPair(renderTime);

  if (pair) {
    const pastPlayer = pair.past.state.players.find((p) => p.id === playerId);
    const futurePlayer = pair.future.state.players.find((p) => p.id === playerId);

    if (pastPlayer && futurePlayer) {
      return {
        x: lerp(pastPlayer.x, futurePlayer.x, pair.t),
        y: lerp(pastPlayer.y, futurePlayer.y, pair.t),
      };
    }

    // Player exists in only one snapshot — use whichever has them
    if (futurePlayer) return { x: futurePlayer.x, y: futurePlayer.y };
    if (pastPlayer) return { x: pastPlayer.x, y: pastPlayer.y };
  }

  // Fallback: use latest snapshot
  const latest = snapshotBuffer.getLatest();
  if (latest) {
    const player = latest.state.players.find((p) => p.id === playerId);
    if (player) return { x: player.x, y: player.y };
  }

  return null;
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
        <span class="stat-label">Pending</span>
        <span class="stat-value" id="pending-count">0</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Snapshots</span>
        <span class="stat-value" id="snapshot-count">0</span>
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
  const snapshotEl = document.getElementById('snapshot-count');
  const playerListEl = document.getElementById('player-list');

  if (tickEl) tickEl.textContent = state.tick.toString();
  if (pendingEl) pendingEl.textContent = pendingInputs.length.toString();
  if (snapshotEl) snapshotEl.textContent = snapshotBuffer.length.toString();

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

  // ── Tilemap ─────────────────────────────────────────────────────────────
  const tilemapContainer = renderTilemap(LEVEL_1_MAP);
  app.stage.addChild(tilemapContainer);

  // ── Player layer ──────────────────────────────────────────────────────
  const playerLayer = new Container();
  app.stage.addChild(playerLayer);

  // ── Debug UI ──────────────────────────────────────────────────────────
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

  // ── Track which remote players exist ──────────────────────────────────
  // We use this set to ensure sprites exist for remote players even before
  // interpolation kicks in. Updated on every TickUpdate.
  const knownRemotePlayers: Set<string> = new Set();

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

      // Initialize all sprites
      for (const player of gameState.players) {
        const isLocal = player.id === playerId;
        const sprite = ensurePlayerSprite(player.id, isLocal);
        sprite.x = Math.round(player.x);
        sprite.y = Math.round(player.y);
        if (!isLocal) knownRemotePlayers.add(player.id);
      }

      // Seed the snapshot buffer
      snapshotBuffer.push(gameState);

      latestServerState = gameState;
      updateDebugUI(gameState, playerId);
    },

    onTickUpdate: (gameState) => {
      const localPlayerId = net.playerId;

      // ── Push snapshot for interpolation ──────────────────────────
      snapshotBuffer.push(gameState);

      // ── Local player: reconciliation (unchanged from Step 5) ────
      const localPlayerData = gameState.players.find((p) => p.id === localPlayerId);
      if (localPlayerData) {
        const sprite = ensurePlayerSprite(localPlayerData.id, true);

        // a) Force to server authoritative position
        localX = localPlayerData.x;
        localY = localPlayerData.y;

        // b) Discard acknowledged inputs
        pendingInputs = pendingInputs.filter(
          (input) => input.sequenceNumber > localPlayerData.lastProcessedInput,
        );

        // c) Re-apply unacknowledged inputs WITH collision
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
      }

      // ── Remote players: just ensure sprites exist ───────────────
      // Actual position updates happen in the 60fps ticker via interpolation.
      knownRemotePlayers.clear();
      for (const player of gameState.players) {
        if (player.id !== localPlayerId) {
          knownRemotePlayers.add(player.id);
          ensurePlayerSprite(player.id, false);
        }
      }

      // Remove sprites for disconnected players
      const activeIds = new Set(gameState.players.map((p) => p.id));
      for (const [id] of playerSprites) {
        if (!activeIds.has(id)) {
          removePlayerSprite(id);
          knownRemotePlayers.delete(id);
        }
      }

      latestServerState = gameState;
      updateDebugUI(gameState, localPlayerId);
    },

    onPlayerLeft: (playerId) => {
      console.info(`[Main] Player left: ${playerId}`);
      removePlayerSprite(playerId);
      knownRemotePlayers.delete(playerId);
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

  // ── 60 FPS Game Loop ──────────────────────────────────────────────────
  //
  // Every frame:
  //   1. LOCAL PLAYER: sample input → predict with collision → send to server.
  //   2. REMOTE PLAYERS: interpolate between two server snapshots.

  app.ticker.add((ticker) => {
    if (!net.isConnected || !localPlayerInitialized || !net.playerId) return;

    const dtSeconds = ticker.deltaMS / 1000;
    const now = performance.now();

    // ── 1. Local player prediction ────────────────────────────────────
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

    // Update local player sprite
    const localSprite = playerSprites.get(net.playerId);
    if (localSprite) {
      localSprite.x = Math.round(localX);
      localSprite.y = Math.round(localY);
    }

    // ── 2. Remote player interpolation ────────────────────────────────
    const renderTime = now - INTERPOLATION_DELAY;

    for (const remoteId of knownRemotePlayers) {
      const sprite = playerSprites.get(remoteId);
      if (!sprite) continue;

      const pos = getInterpolatedPosition(remoteId, renderTime);
      if (pos) {
        sprite.x = Math.round(pos.x);
        sprite.y = Math.round(pos.y);
      }
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
  console.info('  Step 6: Entity Interpolation');
  console.info(`  Interpolation delay: ${INTERPOLATION_DELAY}ms`);
  console.info(`  Map: ${LEVEL_1_MAP.width}×${LEVEL_1_MAP.height} tiles`);
  console.info(`  Internal: ${INTERNAL_WIDTH}×${INTERNAL_HEIGHT}`);
  console.info(`  Scale: ${getIntegerScale(window.innerWidth, window.innerHeight)}×`);
  console.info(`  Display name: ${displayName}`);
  console.info('─────────────────────────────────────────────────');
}

main().catch(console.error);
