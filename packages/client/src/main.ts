// packages/client/src/main.ts
// ─────────────────────────────────────────────────────────────────────────────
// Labyrinth 2D — Client Entry Point
// Step 7: Labyrinth Structure & Spawn Logic + Camera Follow
// ─────────────────────────────────────────────────────────────────────────────
//
// CHANGES IN STEP 7:
//   - Map is now 41×41 tiles (656×656 px) — larger than the viewport.
//   - Camera follows the local player, keeping them centered.
//   - Camera is clamped to map bounds so we never see outside the map.
//   - All previous systems (prediction, reconciliation, interpolation) intact.
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

// ── Snapshot Buffer ─────────────────────────────────────────────────────────

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

// ── Camera ──────────────────────────────────────────────────────────────────

/**
 * Update the world container position so the camera follows the local player.
 * Centers the player on screen and clamps to map boundaries.
 */
function updateCamera(
  world: Container,
  targetX: number,
  targetY: number,
  mapPixelW: number,
  mapPixelH: number,
): void {
  // Center offset: we want the player's center (targetX + TILE_SIZE/2)
  // to be at the center of the viewport
  const playerCenterX = targetX + TILE_SIZE / 2;
  const playerCenterY = targetY + TILE_SIZE / 2;

  let camX = INTERNAL_WIDTH / 2 - playerCenterX;
  let camY = INTERNAL_HEIGHT / 2 - playerCenterY;

  // Clamp so we never show area outside the map
  // When world.x = 0, we see the left edge of the map.
  // When world.x = -(mapPixelW - INTERNAL_WIDTH), we see the right edge.
  const minX = -(mapPixelW - INTERNAL_WIDTH);
  const minY = -(mapPixelH - INTERNAL_HEIGHT);
  const maxX = 0;
  const maxY = 0;

  camX = Math.max(minX, Math.min(maxX, camX));
  camY = Math.max(minY, Math.min(maxY, camY));

  world.x = Math.round(camX);
  world.y = Math.round(camY);
}

// ── Interpolation ───────────────────────────────────────────────────────────

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

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

    if (futurePlayer) return { x: futurePlayer.x, y: futurePlayer.y };
    if (pastPlayer) return { x: pastPlayer.x, y: pastPlayer.y };
  }

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
        return `<li><span class="player-name">${p.displayName}</span> <span class="player-pos">(${Math.round(p.x)}, ${Math.round(p.y)})</span>${isYou}</li>`;
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

  // ── World Container (everything that moves with the camera) ──────────
  const worldContainer = new Container();
  app.stage.addChild(worldContainer);

  // ── Tilemap (child of world) ──────────────────────────────────────────
  const tilemapContainer = renderTilemap(LEVEL_1_MAP);
  worldContainer.addChild(tilemapContainer);

  // ── Player layer (child of world, on top of tilemap) ──────────────────
  const playerLayer = new Container();
  worldContainer.addChild(playerLayer);

  // ── Map dimensions in pixels ──────────────────────────────────────────
  const mapPixelW = LEVEL_1_MAP.width * LEVEL_1_MAP.tileSize;
  const mapPixelH = LEVEL_1_MAP.height * LEVEL_1_MAP.tileSize;

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

  // ── Remote player tracking ────────────────────────────────────────────
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

      for (const player of gameState.players) {
        const isLocal = player.id === playerId;
        const sprite = ensurePlayerSprite(player.id, isLocal);
        sprite.x = Math.round(player.x);
        sprite.y = Math.round(player.y);
        if (!isLocal) knownRemotePlayers.add(player.id);
      }

      snapshotBuffer.push(gameState);

      // Initial camera position
      updateCamera(worldContainer, localX, localY, mapPixelW, mapPixelH);

      latestServerState = gameState;
      updateDebugUI(gameState, playerId);
    },

    onTickUpdate: (gameState) => {
      const localPlayerId = net.playerId;

      snapshotBuffer.push(gameState);

      // ── Local player reconciliation ─────────────────────────────
      const localPlayerData = gameState.players.find((p) => p.id === localPlayerId);
      if (localPlayerData) {
        const sprite = ensurePlayerSprite(localPlayerData.id, true);

        localX = localPlayerData.x;
        localY = localPlayerData.y;

        pendingInputs = pendingInputs.filter(
          (input) => input.sequenceNumber > localPlayerData.lastProcessedInput,
        );

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

      // ── Remote players: ensure sprites exist ────────────────────
      knownRemotePlayers.clear();
      for (const player of gameState.players) {
        if (player.id !== localPlayerId) {
          knownRemotePlayers.add(player.id);
          ensurePlayerSprite(player.id, false);
        }
      }

      // Remove disconnected
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

  app.ticker.add((ticker) => {
    if (!net.isConnected || !localPlayerInitialized || !net.playerId) return;

    const dtSeconds = ticker.deltaMS / 1000;
    const now = performance.now();

    // ── 1. Local player prediction ────────────────────────────────
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

    // ── 2. Remote player interpolation ────────────────────────────
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

    // ── 3. Camera follow ──────────────────────────────────────────
    updateCamera(worldContainer, localX, localY, mapPixelW, mapPixelH);
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
  console.info('  Step 7: Labyrinth + Camera Follow');
  console.info(`  Map: ${LEVEL_1_MAP.width}×${LEVEL_1_MAP.height} tiles (${mapPixelW}×${mapPixelH} px)`);
  console.info(`  Internal: ${INTERNAL_WIDTH}×${INTERNAL_HEIGHT}`);
  console.info(`  Scale: ${getIntegerScale(window.innerWidth, window.innerHeight)}×`);
  console.info(`  Display name: ${displayName}`);
  console.info('─────────────────────────────────────────────────');
}

main().catch(console.error);
