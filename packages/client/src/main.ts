// packages/client/src/main.ts
// ─────────────────────────────────────────────────────────────────────────────
// Labyrinth 2D — Client Entry Point (Step 2: Network Debug UI)
// ─────────────────────────────────────────────────────────────────────────────
//
// MULTIPLAYER ARCHITECTURE (Client-Side):
//
// 1. CLIENT-SIDE PREDICTION: The client applies local player inputs
//    immediately each frame for responsive 60-fps movement. Inputs are
//    buffered with monotonically increasing sequence numbers.
//
// 2. SERVER RECONCILIATION: When a GameStateSnapshot arrives from the
//    authoritative server:
//    a) Find the last acknowledged input sequence (lastProcessedInput).
//    b) Discard all locally buffered inputs up to that sequence.
//    c) Snap local player to the server-authoritative position.
//    d) Re-apply all unacknowledged inputs on top of the server state.
//    This corrects any prediction errors while keeping movement smooth.
//
// 3. ENTITY INTERPOLATION: Remote players (not the local player) are
//    interpolated between the two most recent server snapshots. This hides
//    the 20-tps update rate and produces smooth movement at 60 fps.
//
// Step 2: No game engine canvas. Instead, a debug HTML overlay shows the
// live tick counter and connected player list from the server.
// ─────────────────────────────────────────────────────────────────────────────

import { NetworkManager } from './net/NetworkManager';
import type { GameState } from '@labyrinth/shared';

// ── Debug UI Setup ──────────────────────────────────────────────────────────

/** Create and style the debug UI overlay. */
function createDebugUI(): HTMLDivElement {
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
  return debugDiv;
}

/** Update the debug UI with fresh game state. */
function updateDebugUI(state: GameState, playerId: string | null): void {
  const tickEl = document.getElementById('tick-counter');
  const playerListEl = document.getElementById('player-list');

  if (tickEl) {
    tickEl.textContent = state.tick.toString();
  }

  if (playerListEl) {
    playerListEl.innerHTML = state.players
      .map((p) => {
        const isYou = p.id === playerId ? ' <span class="you-badge">← you</span>' : '';
        return `<li><span class="player-name">${p.displayName}</span> <span class="player-id">${p.id}</span>${isYou}</li>`;
      })
      .join('');
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

function main(): void {
  createDebugUI();

  const statusEl = document.getElementById('connection-status');
  const playerIdEl = document.getElementById('player-id');
  const roomIdEl = document.getElementById('room-id');

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

      updateDebugUI(gameState, playerId);
    },

    onTickUpdate: (gameState) => {
      updateDebugUI(gameState, net.playerId);
    },

    onPlayerLeft: (playerId) => {
      console.info(`[Main] Player left: ${playerId}`);
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

  // ── Connect to Server ─────────────────────────────────────────────────
  // In dev: Vite proxies /ws → ws://localhost:9001.
  // Detect if we're in dev or prod and pick the right URL.
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = import.meta.env.DEV
    ? 'ws://localhost:9001'
    : `${wsProtocol}//${window.location.host}/ws`;

  const displayName = `Explorer-${Math.floor(Math.random() * 9999)
    .toString()
    .padStart(4, '0')}`;

  net.connect(wsUrl, 'default', displayName);

  console.info('─────────────────────────────────────────────────');
  console.info('  🏰 Labyrinth 2D Client (Step 2: Network Debug)');
  console.info(`  Display name: ${displayName}`);
  console.info('─────────────────────────────────────────────────');
}

main();
