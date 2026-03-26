// packages/client/src/main.ts
// ─────────────────────────────────────────────────────────────────────────────
// Labyrinth 2D — Client Entry Point
// Step 9: 2.5D Perspective, Feet-Based Collision, Multi-Layer Tiles
// ─────────────────────────────────────────────────────────────────────────────

import { Application, Sprite, AnimatedSprite, Container, Texture } from 'pixi.js';
import {
  INTERNAL_WIDTH,
  INTERNAL_HEIGHT,
  TILE_SIZE,
  MAZE_SIZE,
  TILE_FLOOR,
  TILE_FLOOR_SHADOW,
  TILE_WALL_FACE,
  TILE_WALL_TOP,
  TILE_WALL_INTERIOR,
  TILE_WALL_SIDE_LEFT,
  TILE_WALL_SIDE_RIGHT,
  generateMaze,
  applyInputWithCollision,
} from '@labyrinth/shared';
import type { GameState, TileMapData, FacingDirection } from '@labyrinth/shared';
import { NetworkManager } from './net/NetworkManager';
import { SnapshotBuffer, INTERPOLATION_DELAY } from './net/SnapshotBuffer';
import { loadAssets, type GameAssets } from './assets/AssetLoader';

// ── Player sprite dimensions ────────────────────────────────────────────────

const PLAYER_SPRITE_W = 16;
const PLAYER_SPRITE_H = 32;

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
let localFacing: FacingDirection = 'down';

let currentMap: TileMapData | null = null;
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

function getInterpolatedPlayer(playerId: string, renderTime: number): InterpolatedPlayer | null {
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

    if (futurePlayer) return { x: futurePlayer.x, y: futurePlayer.y, facing: futurePlayer.facing, isMoving: futurePlayer.isMoving };
    if (pastPlayer) return { x: pastPlayer.x, y: pastPlayer.y, facing: pastPlayer.facing, isMoving: pastPlayer.isMoving };
  }

  const latest = snapshotBuffer.getLatest();
  if (latest) {
    const player = latest.state.players.find((p) => p.id === playerId);
    if (player) return { x: player.x, y: player.y, facing: player.facing, isMoving: player.isMoving };
  }

  return null;
}

// ── Animation Helpers ───────────────────────────────────────────────────────

function getAnimationKey(facing: FacingDirection, isMoving: boolean): string {
  return isMoving ? `walk-${facing}` : `idle-${facing}`;
}

function deriveFacingFromKeys(): FacingDirection {
  if (keys.down) return 'down';
  if (keys.up) return 'up';
  if (keys.right) return 'right';
  if (keys.left) return 'left';
  return localFacing;
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

  const assets: GameAssets = await loadAssets();

  // ── World Container ───────────────────────────────────────────────────
  const worldContainer = new Container();
  app.stage.addChild(worldContainer);

  // Background holds all flat tiles (floor & shadows) — never sorted
  const backgroundLayer = new Container();
  worldContainer.addChild(backgroundLayer);

  // Entity layer globally Y-sorts players alongside 3D solid walls
  const entityLayer = new Container();
  entityLayer.sortableChildren = true;
  worldContainer.addChild(entityLayer);

  let tilemapSprites: Sprite[] = [];

  let mapPixelW = MAZE_SIZE * TILE_SIZE;
  let mapPixelH = MAZE_SIZE * TILE_SIZE;

  const MIN_ZOOM = 0.1;
  const MAX_ZOOM = 2.0;
  const ZOOM_STEP = 0.05;
  let zoomLevel = MAX_ZOOM;

  createDebugUI();
  const statusEl = document.getElementById('connection-status');

  // ── Player Sprite Registry ──────────────────────────────────────────────

  interface PlayerSpriteData {
    sprite: AnimatedSprite;
    currentAnimKey: string;
  }

  const playerSprites: Map<string, PlayerSpriteData> = new Map();

  function createPlayerSprite(playerId: string): PlayerSpriteData {
    const animKey = 'idle-down';
    const frames = assets.playerAnimations[animKey];
    const sprite = new AnimatedSprite(frames);
    sprite.animationSpeed = 0.1;
    sprite.loop = true;
    sprite.play();
    sprite.width = PLAYER_SPRITE_W;
    sprite.height = PLAYER_SPRITE_H;

    sprite.anchor.set(0.5, 1.0); // bottom-center anchor
    entityLayer.addChild(sprite); // Add directly to the sorted entity layer

    const data: PlayerSpriteData = { sprite, currentAnimKey: animKey };
    playerSprites.set(playerId, data);
    return data;
  }

  function ensurePlayerSprite(playerId: string): PlayerSpriteData {
    let data = playerSprites.get(playerId);
    if (!data) data = createPlayerSprite(playerId);
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
      entityLayer.removeChild(data.sprite);
      data.sprite.destroy();
      playerSprites.delete(playerId);
    }
  }

  const knownRemotePlayers: Set<string> = new Set();

  // ── Network Manager ───────────────────────────────────────────────────

  let latestServerState: GameState | null = null;

  const net = new NetworkManager({
    onRoomJoined: (roomId, playerId, mapSeed, gameState) => {
      console.info(`[Main] Joined room "${roomId}" as ${playerId} (maze seed: ${mapSeed})`);

      currentMap = generateMaze(mapSeed);
      mapPixelW = currentMap.width * currentMap.tileSize;
      mapPixelH = currentMap.height * currentMap.tileSize;

      // Clean old tile sprites
      tilemapSprites.forEach((s) => s.destroy());
      tilemapSprites = [];

      // Rebuild the two rendering layers from the map
      const ts = currentMap.tileSize;
      for (let y = 0; y < currentMap.height; y++) {
        for (let x = 0; x < currentMap.width; x++) {
          const tileId = currentMap.data[y * currentMap.width + x];
          let tex: Texture;
          let isSolid = false;

          switch (tileId) {
            case TILE_FLOOR: tex = assets.floorTexture; break;
            case TILE_FLOOR_SHADOW: tex = assets.floorShadowTexture; break;
            case TILE_WALL_FACE: tex = assets.wallFaceTexture; isSolid = true; break;
            case TILE_WALL_TOP: tex = assets.wallTopTexture; isSolid = true; break;
            case TILE_WALL_INTERIOR: tex = assets.wallInteriorTexture; isSolid = true; break;
            case TILE_WALL_SIDE_LEFT: tex = assets.wallSideLeftTexture; isSolid = true; break;
            case TILE_WALL_SIDE_RIGHT: tex = assets.wallSideRightTexture; isSolid = true; break;
            default: tex = assets.floorTexture; break;
          }

          const sprite = new Sprite(tex);
          sprite.x = x * ts;
          sprite.y = y * ts;
          sprite.width = ts;
          sprite.height = ts;

          // Push to proper layer & configure global Z-indexing
          if (isSolid) {
            sprite.zIndex = (y + 1) * ts;
            entityLayer.addChild(sprite);
          } else {
            backgroundLayer.addChild(sprite);
          }
          tilemapSprites.push(sprite);
        }
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

      for (const player of gameState.players) {
        const isLocal = player.id === playerId;
        const data = ensurePlayerSprite(player.id);
        data.sprite.x = Math.round(player.x);
        data.sprite.y = Math.round(player.y);
        data.sprite.zIndex = Math.round(player.y) + 1;
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

      const localPlayerData = gameState.players.find((p) => p.id === localPlayerId);
      if (localPlayerData) {
        const data = ensurePlayerSprite(localPlayerData.id);
        localX = localPlayerData.x;
        localY = localPlayerData.y;

        pendingInputs = pendingInputs.filter(
          (input) => input.sequenceNumber > localPlayerData.lastProcessedInput,
        );

        for (const input of pendingInputs) {
          const result = applyInputWithCollision(localX, localY, input, input.dt, currentMap!);
          localX = result.x;
          localY = result.y;
        }

        data.sprite.x = Math.round(localX);
        data.sprite.y = Math.round(localY);
        data.sprite.zIndex = Math.round(localY) + 1;
      }

      knownRemotePlayers.clear();
      for (const player of gameState.players) {
        if (player.id !== localPlayerId) {
          knownRemotePlayers.add(player.id);
          ensurePlayerSprite(player.id);
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

      const result = applyInputWithCollision(localX, localY, input, dtSeconds, currentMap!);
      localX = result.x;
      localY = result.y;

      pendingInputs.push(input);

      net.sendInput(input.sequenceNumber, input.up, input.down, input.left, input.right);
    }

    const localData = playerSprites.get(net.playerId);
    if (localData) {
      localData.sprite.x = Math.round(localX);
      localData.sprite.y = Math.round(localY);
      localData.sprite.zIndex = Math.round(localY) + 1; // +1 to ensure visibility over tile floor

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
        data.sprite.y = Math.round(interp.y);
        data.sprite.zIndex = Math.round(interp.y) + 1;

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
    if (e.deltaY < 0) zoomLevel = Math.min(MAX_ZOOM, zoomLevel + ZOOM_STEP);
    else zoomLevel = Math.max(MIN_ZOOM, zoomLevel - ZOOM_STEP);
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
  const displayName = `Explorer-${Math.floor(Math.random() * 9999).toString().padStart(4, '0')}`;

  net.connect(wsUrl, 'default', displayName);

  console.info('─────────────────────────────────────────────────');
  console.info('  🏰 Labyrinth 2D Client');
  console.info('  Step 9: 2.5D Perspective (Stardew style walls)');
  console.info(`  Map: ${MAZE_SIZE}×${MAZE_SIZE} tiles (${mapPixelW}×${mapPixelH} px)`);
  console.info(`  Display name: ${displayName}`);
  console.info('─────────────────────────────────────────────────');
}

main().catch(console.error);