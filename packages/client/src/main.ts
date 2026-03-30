// packages/client/src/main.ts
// ─────────────────────────────────────────────────────────────────────────────
// Labyrinth 2D — Client Entry Point
// Step 9: 2.5D Perspective, Feet-Based Collision, Multi-Layer Tiles
// ─────────────────────────────────────────────────────────────────────────────

import { Application, Sprite, AnimatedSprite, Container, Texture, Text, TextStyle, TextureStyle } from 'pixi.js';

TextureStyle.defaultOptions.scaleMode = 'nearest';
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
import { DebugSettings } from './config/DebugSettings';
import { Minimap } from './systems/Minimap';
import { TilemapRenderer, type RunestoneSpriteData } from './systems/TilemapRenderer';
import { Portal } from './systems/Portal';

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

/** When true, server reconciliation is skipped so debug teleport position sticks. */
let debugTeleportActive = false;

let currentMap: TileMapData | null = null;
const snapshotBuffer = new SnapshotBuffer();

let minimap: Minimap | null = null;
let tilemapRenderer: TilemapRenderer | null = null;

/** Floating "Press E" interaction prompt */
let interactPrompt: Text | null = null;

/** Portal instance (created when all runestones are activated). */
let portal: Portal | null = null;

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
  const flags = DebugSettings.getFlags();
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
    <h2>Debug Settings</h2>
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
    </div>
  `;
  document.body.appendChild(debugDiv);
}

function setupDebugToggles(): void {
  const debugUI = document.getElementById('debug-ui');
  if (!debugUI) return;

  // Allow pointer events on the toggles area
  debugUI.style.pointerEvents = 'auto';

  debugUI.addEventListener('change', (e: Event) => {
    const target = e.target as HTMLInputElement;
    const flag = target.dataset.flag as keyof ReturnType<typeof DebugSettings.getFlags>;
    if (!flag) return;
    DebugSettings.setFlag(flag, target.checked);
  });
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

  // Entity layer globally Y-sorts players alongside wall row chunks
  const entityLayer = new Container();
  entityLayer.sortableChildren = true;
  worldContainer.addChild(entityLayer);

  let mapPixelW = MAZE_SIZE * TILE_SIZE;
  let mapPixelH = MAZE_SIZE * TILE_SIZE;

  const MIN_ZOOM = 0.1;
  const MAX_ZOOM = 2.0;
  const ZOOM_STEP = 0.05;
  let zoomLevel = MAX_ZOOM;

  // Zoom-toggle state: cycles default → zoomed-out → zoomed-in
  type ZoomToggleState = 'default' | 'zoomed-out' | 'zoomed-in';
  let zoomToggleState: ZoomToggleState = 'default';
  const savedZoomBeforeToggle = zoomLevel;

  createDebugUI();
  setupDebugToggles();
  const statusEl = document.getElementById('connection-status');

  // ── Player Sprite Registry ──────────────────────────────────────────────

  interface PlayerSpriteData {
    sprite: AnimatedSprite;
    currentAnimKey: string;
    spriteIndex: number;
  }

  const playerSprites: Map<string, PlayerSpriteData> = new Map();

  /** Safely resolve animation set for a player sprite, falling back to set 0. */
  function getAnimSet(spriteIndex: number): Record<string, Texture[]> {
    return assets.playerAnimationSets[spriteIndex] ?? assets.playerAnimationSets[0];
  }

  function createPlayerSprite(playerId: string, spriteIndex: number): PlayerSpriteData {
    const animSet = getAnimSet(spriteIndex);
    const animKey = 'idle-down';
    const frames = animSet[animKey];
    const sprite = new AnimatedSprite(frames);
    sprite.animationSpeed = 0.15;
    sprite.loop = true;
    sprite.play();
    sprite.width = PLAYER_SPRITE_W;
    sprite.height = PLAYER_SPRITE_H;

    sprite.anchor.set(0.5, 1.0); // bottom-center anchor
    entityLayer.addChild(sprite); // Add directly to the sorted entity layer

    const data: PlayerSpriteData = { sprite, currentAnimKey: animKey, spriteIndex };
    playerSprites.set(playerId, data);
    return data;
  }

  function ensurePlayerSprite(playerId: string, spriteIndex: number): PlayerSpriteData {
    let data = playerSprites.get(playerId);
    if (!data) data = createPlayerSprite(playerId, spriteIndex);
    return data;
  }

  function setPlayerAnimation(data: PlayerSpriteData, animKey: string): void {
    if (data.currentAnimKey === animKey) return;
    const animSet = getAnimSet(data.spriteIndex);
    const frames = animSet[animKey];
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

      // ── Build chunk-based tilemap ──────────────────────────────────────
      tilemapRenderer?.destroy();
      tilemapRenderer = new TilemapRenderer(currentMap, assets, app.renderer);

      // Attach layers: background and shadow go before entityLayer,
      // entityLayer is already a child of worldContainer.
      // Remove entityLayer, insert layers in order, re-add entityLayer.
      worldContainer.removeChild(entityLayer);
      worldContainer.addChild(tilemapRenderer.backgroundLayer);
      worldContainer.addChild(tilemapRenderer.shadowLayer);
      worldContainer.addChild(entityLayer);

      // Add wall row chunks to entityLayer for Y-sorting with players
      for (const wallChunk of tilemapRenderer.wallRowChunks) {
        entityLayer.addChild(wallChunk);
      }

      // Add trees to entityLayer for Y-sorting
      for (const tree of tilemapRenderer.treeSprites) {
        entityLayer.addChild(tree);
      }

      // Add runestone sprites to entityLayer for Y-sorting
      for (const rs of tilemapRenderer.runestoneSprites) {
        entityLayer.addChild(rs.sprite);
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

      // ── Minimap ──────────────────────────────────────────────────────
      if (minimap) minimap.destroy();
      minimap = new Minimap(currentMap!, INTERNAL_WIDTH, INTERNAL_HEIGHT);
      minimap.addToStage(app.stage);

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
        console.info(`[Main] Late-join: portal already active at (${Math.round(gameState.portal.x)}, ${Math.round(gameState.portal.y)})`);
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
        const data = ensurePlayerSprite(localPlayerData.id, localPlayerData.spriteIndex);

        // Skip entire server reconciliation while a debug teleport is active —
        // the server doesn't know about the teleport so its position is stale.
        if (!debugTeleportActive) {
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
        }

        data.sprite.x = Math.round(localX);
        data.sprite.y = Math.round(localY);
        data.sprite.zIndex = Math.round(localY) + 1;
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
      updateDebugUI(gameState, localPlayerId);
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

    // ── 4. Minimap ────────────────────────────────────────────────────
    if (minimap) minimap.update(localX, localY);

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

    // ── 5. Runestone interaction prompt ──────────────────────────────
    if (interactPrompt && tilemapRenderer) {
      let nearestRS: RunestoneSpriteData | null = null;
      let nearestDist = Infinity;
      const INTERACT_RANGE = 28; // ~1.75 tiles in pixels

      for (const rs of tilemapRenderer.runestoneSprites) {
        if (rs.activated) continue;
        const rsCenterX = rs.tileX * TILE_SIZE + TILE_SIZE / 2;
        const rsCenterY = (rs.tileY + 1) * TILE_SIZE;
        const dx = localX - rsCenterX;
        const dy = localY - rsCenterY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < INTERACT_RANGE && dist < nearestDist) {
          nearestDist = dist;
          nearestRS = rs;
        }
      }

      if (nearestRS) {
        interactPrompt.visible = true;
        interactPrompt.x = nearestRS.sprite.x;
        interactPrompt.y = nearestRS.sprite.y - 34; // above the runestone
        interactPrompt.zIndex = 99999;
      } else {
        interactPrompt.visible = false;
      }
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
    debugTeleportActive = true; // prevent server reconciliation from snapping back

    // Notify server of the new position so proximity checks work
    net.sendDebugTeleport(clampedX, clampedY);

    // Immediately update sprite
    const localData = playerSprites.get(net.playerId!);
    if (localData) {
      localData.sprite.x = Math.round(localX);
      localData.sprite.y = Math.round(localY);
      localData.sprite.zIndex = Math.round(localY) + 1;
    }

    console.info(`[Debug] Teleported to (${Math.round(clampedX)}, ${Math.round(clampedY)})`);
  });

  // ── Keyboard Input ────────────────────────────────────────────────────
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    const dir = KEY_MAP[e.code];
    if (dir) keys[dir] = true;

    // ── E key: runestone activation ──────────────────────────────────
    if (e.code === 'KeyE' && localPlayerInitialized && tilemapRenderer) {
      const INTERACT_RANGE = 28;
      for (const rs of tilemapRenderer.runestoneSprites) {
        if (rs.activated) continue;
        const rsCenterX = rs.tileX * TILE_SIZE + TILE_SIZE / 2;
        const rsCenterY = (rs.tileY + 1) * TILE_SIZE;
        const dx = localX - rsCenterX;
        const dy = localY - rsCenterY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < INTERACT_RANGE) {
          net.sendActivateRunestone(rs.index);
          break; // only activate one at a time
        }
      }
    }
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