// packages/client/src/main.ts
// ─────────────────────────────────────────────────────────────────────────────
// Labyrinth 2D — Client Entry Point
// Step 8: Pixel-Art Sprites & Textured Tiles
// ─────────────────────────────────────────────────────────────────────────────

import { Application, Sprite, AnimatedSprite, Container, Texture } from 'pixi.js';
import {
  INTERNAL_WIDTH,
  INTERNAL_HEIGHT,
  TILE_SIZE,
  MAZE_SIZE,
  generateMaze,
  applyInputWithCollision,
} from '@labyrinth/shared';
import type { GameState, TileMapData, FacingDirection } from '@labyrinth/shared';
import { NetworkManager } from './net/NetworkManager';
import { SnapshotBuffer, INTERPOLATION_DELAY } from './net/SnapshotBuffer';
import { loadAssets, type GameAssets } from './assets/AssetLoader';

// ── Player sprite dimensions ────────────────────────────────────────────────

/** Player sprites are 16 wide × 32 tall (standard RPG proportions). */
const PLAYER_SPRITE_W = 16;
const PLAYER_SPRITE_H = 32;

/** Y offset: the sprite is taller than a tile, so we shift it up visually. */
const PLAYER_Y_OFFSET = PLAYER_SPRITE_H - TILE_SIZE; // 16px

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

// ── Local facing (for immediate animation, used by prediction) ──────────────

let localFacing: FacingDirection = 'down';

// ── Current Map (set on room join from server seed) ───────────────────────

let currentMap: TileMapData | null = null;

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

// ── Tilemap Rendering (sprite-based) ────────────────────────────────────────

function renderTilemap(
  map: TileMapData,
  wallTex: Texture,
  floorTex: Texture,
): Container {
  const tilemap = new Container();
  const ts = map.tileSize;

  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const tileId = map.data[y * map.width + x];
      const tex = tileId === 1 ? wallTex : floorTex;
      const sprite = new Sprite(tex);
      sprite.x = x * ts;
      sprite.y = y * ts;
      sprite.width = ts;
      sprite.height = ts;
      tilemap.addChild(sprite);
    }
  }

  return tilemap;
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
  const playerCenterX = targetX + TILE_SIZE / 2;
  const playerCenterY = targetY + TILE_SIZE / 2;

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

// ── Interpolation ───────────────────────────────────────────────────────────

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

interface InterpolatedPlayer {
  x: number;
  y: number;
  facing: FacingDirection;
  isMoving: boolean;
}

function getInterpolatedPlayer(
  playerId: string,
  renderTime: number,
): InterpolatedPlayer | null {
  const pair = snapshotBuffer.getInterpolationPair(renderTime);

  if (pair) {
    const pastPlayer = pair.past.state.players.find((p) => p.id === playerId);
    const futurePlayer = pair.future.state.players.find((p) => p.id === playerId);

    if (pastPlayer && futurePlayer) {
      return {
        x: lerp(pastPlayer.x, futurePlayer.x, pair.t),
        y: lerp(pastPlayer.y, futurePlayer.y, pair.t),
        facing: futurePlayer.facing,
        isMoving: futurePlayer.isMoving,
      };
    }

    if (futurePlayer) return {
      x: futurePlayer.x, y: futurePlayer.y,
      facing: futurePlayer.facing, isMoving: futurePlayer.isMoving,
    };
    if (pastPlayer) return {
      x: pastPlayer.x, y: pastPlayer.y,
      facing: pastPlayer.facing, isMoving: pastPlayer.isMoving,
    };
  }

  const latest = snapshotBuffer.getLatest();
  if (latest) {
    const player = latest.state.players.find((p) => p.id === playerId);
    if (player) return {
      x: player.x, y: player.y,
      facing: player.facing, isMoving: player.isMoving,
    };
  }

  return null;
}

// ── Animation Helpers ───────────────────────────────────────────────────────

function getAnimationKey(facing: FacingDirection, isMoving: boolean): string {
  return isMoving ? `walk-${facing}` : `idle-${facing}`;
}

function deriveFacingFromKeys(): FacingDirection {
  // Priority: down > up > right > left (same as server)
  if (keys.down) return 'down';
  if (keys.up) return 'up';
  if (keys.right) return 'right';
  if (keys.left) return 'left';
  return localFacing; // no keys pressed — keep current
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
        return `<li><span class="player-name">${p.displayName}</span> <span class="player-pos">(${Math.round(p.x)}, ${Math.round(p.y)}) ${p.facing}</span>${isYou}</li>`;
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

  // ── Load Assets (with fallback) ─────────────────────────────────────────
  const assets: GameAssets = await loadAssets();

  // ── World Container (everything that moves with the camera) ──────────
  const worldContainer = new Container();
  app.stage.addChild(worldContainer);

  // ── Tilemap (child of world) ──────────────────────────────────────────
  let tilemapContainer = new Container();
  worldContainer.addChild(tilemapContainer);

  // ── Player layer (child of world, on top of tilemap) ──────────────────
  const playerLayer = new Container();
  playerLayer.sortableChildren = true; // enable Y-sorting via zIndex
  worldContainer.addChild(playerLayer);

  // ── Map dimensions in pixels (updated on room join) ───────────────────
  let mapPixelW = MAZE_SIZE * TILE_SIZE;
  let mapPixelH = MAZE_SIZE * TILE_SIZE;

  // ── Debug Zoom ────────────────────────────────────────────────────────
  const MIN_ZOOM = 0.1;
  const MAX_ZOOM = 2.0;
  const ZOOM_STEP = 0.05;
  let zoomLevel = MAX_ZOOM;

  // ── Debug UI ──────────────────────────────────────────────────────────
  createDebugUI();
  const statusEl = document.getElementById('connection-status');

  // ── Player Sprite Registry ──────────────────────────────────────────────

  interface PlayerSpriteData {
    sprite: AnimatedSprite;
    currentAnimKey: string;
  }

  const playerSprites: Map<string, PlayerSpriteData> = new Map();

  function createPlayerSprite(playerId: string): PlayerSpriteData {
    // Start with idle-down animation
    const animKey = 'idle-down';
    const frames = assets.playerAnimations[animKey];
    const sprite = new AnimatedSprite(frames);
    sprite.animationSpeed = 0.1; // ~6 fps at 60fps ticker
    sprite.loop = true;
    sprite.play();
    sprite.width = PLAYER_SPRITE_W;
    sprite.height = PLAYER_SPRITE_H;

    playerLayer.addChild(sprite);

    const data: PlayerSpriteData = { sprite, currentAnimKey: animKey };
    playerSprites.set(playerId, data);
    return data;
  }

  function ensurePlayerSprite(playerId: string): PlayerSpriteData {
    let data = playerSprites.get(playerId);
    if (!data) {
      data = createPlayerSprite(playerId);
    }
    return data;
  }

  function setPlayerAnimation(data: PlayerSpriteData, animKey: string): void {
    if (data.currentAnimKey === animKey) return;
    const frames = assets.playerAnimations[animKey];
    if (!frames) return;
    data.sprite.textures = frames;
    data.sprite.play();
    data.currentAnimKey = animKey;
  }

  function removePlayerSprite(playerId: string): void {
    const data = playerSprites.get(playerId);
    if (data) {
      playerLayer.removeChild(data.sprite);
      data.sprite.destroy();
      playerSprites.delete(playerId);
    }
  }

  // ── Remote player tracking ────────────────────────────────────────────
  const knownRemotePlayers: Set<string> = new Set();

  // ── Network Manager ───────────────────────────────────────────────────

  let latestServerState: GameState | null = null;

  const net = new NetworkManager({
    onRoomJoined: (roomId, playerId, mapSeed, gameState) => {
      console.info(`[Main] Joined room "${roomId}" as ${playerId} (maze seed: ${mapSeed})`);

      // Generate the maze from the server's seed
      currentMap = generateMaze(mapSeed);
      mapPixelW = currentMap.width * currentMap.tileSize;
      mapPixelH = currentMap.height * currentMap.tileSize;

      // Rebuild tilemap with sprite-based rendering
      worldContainer.removeChild(tilemapContainer);
      tilemapContainer.destroy({ children: true });
      tilemapContainer = renderTilemap(currentMap, assets.wallTexture, assets.floorTexture);
      worldContainer.addChildAt(tilemapContainer, 0);

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

      for (const player of gameState.players) {
        const isLocal = player.id === playerId;
        const data = ensurePlayerSprite(player.id);
        data.sprite.x = Math.round(player.x);
        data.sprite.y = Math.round(player.y) - PLAYER_Y_OFFSET;
        data.sprite.zIndex = player.y;
        if (!isLocal) knownRemotePlayers.add(player.id);
      }

      snapshotBuffer.push(gameState);

      updateCamera(worldContainer, localX, localY, mapPixelW, mapPixelH, zoomLevel);

      latestServerState = gameState;
      updateDebugUI(gameState, playerId);
    },

    onTickUpdate: (gameState) => {
      const localPlayerId = net.playerId;

      snapshotBuffer.push(gameState);

      // ── Local player reconciliation ─────────────────────────────
      const localPlayerData = gameState.players.find((p) => p.id === localPlayerId);
      if (localPlayerData) {
        const data = ensurePlayerSprite(localPlayerData.id);

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
            currentMap!,
          );
          localX = result.x;
          localY = result.y;
        }

        data.sprite.x = Math.round(localX);
        data.sprite.y = Math.round(localY) - PLAYER_Y_OFFSET;
        data.sprite.zIndex = localY;
      }

      // ── Remote players: ensure sprites exist ────────────────────
      knownRemotePlayers.clear();
      for (const player of gameState.players) {
        if (player.id !== localPlayerId) {
          knownRemotePlayers.add(player.id);
          ensurePlayerSprite(player.id);
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
      localFacing = deriveFacingFromKeys();
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
        currentMap!,
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

    // Update local player sprite position & animation
    const localData = playerSprites.get(net.playerId);
    if (localData) {
      localData.sprite.x = Math.round(localX);
      localData.sprite.y = Math.round(localY) - PLAYER_Y_OFFSET;
      localData.sprite.zIndex = localY;

      const localAnimKey = getAnimationKey(localFacing, isMoving);
      setPlayerAnimation(localData, localAnimKey);
    }

    // ── 2. Remote player interpolation ────────────────────────────
    const renderTime = now - INTERPOLATION_DELAY;

    for (const remoteId of knownRemotePlayers) {
      const data = playerSprites.get(remoteId);
      if (!data) continue;

      const interp = getInterpolatedPlayer(remoteId, renderTime);
      if (interp) {
        data.sprite.x = Math.round(interp.x);
        data.sprite.y = Math.round(interp.y) - PLAYER_Y_OFFSET;
        data.sprite.zIndex = interp.y;

        const remoteAnimKey = getAnimationKey(interp.facing, interp.isMoving);
        setPlayerAnimation(data, remoteAnimKey);
      }
    }

    // ── 3. Camera follow + zoom ─────────────────────────────────────
    worldContainer.scale.set(zoomLevel);
    updateCamera(worldContainer, localX, localY, mapPixelW, mapPixelH, zoomLevel);
  });

  // ── Mousewheel Zoom (debug) ───────────────────────────────────────────

  app.canvas.addEventListener('wheel', (e: WheelEvent) => {
    e.preventDefault();
    if (e.deltaY < 0) {
      zoomLevel = Math.min(MAX_ZOOM, zoomLevel + ZOOM_STEP);
    } else {
      zoomLevel = Math.max(MIN_ZOOM, zoomLevel - ZOOM_STEP);
    }
  }, { passive: false });

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
  const wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;

  const displayName = `Explorer-${Math.floor(Math.random() * 9999)
    .toString()
    .padStart(4, '0')}`;

  net.connect(wsUrl, 'default', displayName);

  console.info('─────────────────────────────────────────────────');
  console.info('  🏰 Labyrinth 2D Client');
  console.info('  Step 8: Pixel-Art Sprites & Textured Tiles');
  console.info(`  Map: ${MAZE_SIZE}×${MAZE_SIZE} tiles (${mapPixelW}×${mapPixelH} px)`);
  console.info(`  Internal: ${INTERNAL_WIDTH}×${INTERNAL_HEIGHT}`);
  console.info(`  Scale: ${getIntegerScale(window.innerWidth, window.innerHeight)}×`);
  console.info(`  Display name: ${displayName}`);
  console.info('─────────────────────────────────────────────────');
}

main().catch(console.error);
