// packages/server/src/index.ts
// ─────────────────────────────────────────────────────────────────────────────
// Labyrinth 2D — Authoritative Game Server
// ─────────────────────────────────────────────────────────────────────────────
//
// MULTIPLAYER ARCHITECTURE (Authoritative Server Model):
//
// 1. This server is the SINGLE SOURCE OF TRUTH for all game state.
//    Clients send inputs (PlayerInput), never direct state mutations.
//
// 2. ROOM/LOBBY SYSTEM: Each group of up to 10 players joins a "room".
//    One maze instance is generated per room. Players create or join rooms
//    via the lobby screen. Room state is isolated — no cross-room interaction.
//
// 3. SERVER GAME LOOP (~20 ticks/sec): Every tick, the server:
//    a) Dequeues and validates all buffered player inputs.
//    b) Runs the game simulation (movement, collision, triggers).
//    c) Computes a DELTA STATE SNAPSHOT (only entities that changed).
//    d) Broadcasts the delta snapshot to all clients in the room.
//
// 4. CLIENT-SIDE PREDICTION: Clients apply their own inputs immediately
//    for smooth 60-fps rendering. They buffer inputs with sequence numbers.
//
// 5. SERVER RECONCILIATION: When a server snapshot arrives, the client:
//    a) Finds the last acknowledged input sequence.
//    b) Discards all inputs up to that sequence.
//    c) Re-applies unacknowledged inputs on top of the server-authoritative state.
//
// Step 1: This file only sets up uWebSockets.js with a basic WebSocket handler.
// No game logic, no rooms — just the transport layer skeleton.
// ─────────────────────────────────────────────────────────────────────────────

import uWS from 'uWebSockets.js';

import {
  MessageType,
  MAX_PLAYERS_PER_ROOM,
  SERVER_TICK_RATE,
  type ClientMessage,
} from '@labyrinth/shared';

const PORT = 9001;

/** Per-socket user data attached by uWebSockets. */
interface SocketData {
  /** Unique connection ID. */
  id: string;
  /** Room this socket belongs to (null until joined). */
  roomId: string | null;
}

let nextId = 0;

const app = uWS
  .App()
  .ws<SocketData>('/*', {
    /* ── Connection Settings ─────────────────────────────────── */
    compression: uWS.SHARED_COMPRESSOR,
    maxPayloadLength: 4 * 1024, // 4 KB max message size
    idleTimeout: 120, // seconds before auto-disconnect

    /* ── Lifecycle Hooks ─────────────────────────────────────── */

    upgrade: (res, req, context) => {
      // Upgrade HTTP → WebSocket. Attach initial socket data.
      res.upgrade<SocketData>(
        {
          id: `player-${nextId++}`,
          roomId: null,
        },
        req.getHeader('sec-websocket-key'),
        req.getHeader('sec-websocket-protocol'),
        req.getHeader('sec-websocket-extensions'),
        context,
      );
    },

    open: (ws) => {
      const data = ws.getUserData();
      console.info(`[WS] Connected: ${data.id}`);
    },

    message: (ws, message, _isBinary) => {
      const data = ws.getUserData();

      try {
        const text = Buffer.from(message).toString('utf-8');
        const msg: ClientMessage = JSON.parse(text);

        // Route message by type — placeholder for Step 2+
        switch (msg.type) {
          case MessageType.PlayerJoin:
            console.info(
              `[WS] ${data.id} requests to join room "${msg.roomId}" as "${msg.displayName}"`,
            );
            // TODO: Room management (Step 2)
            break;

          case MessageType.PlayerInput:
            // TODO: Queue input for server tick processing (Step 2)
            break;

          case MessageType.PlayerLeave:
            console.info(`[WS] ${data.id} is leaving`);
            // TODO: Room cleanup (Step 2)
            break;

          default:
            console.warn(`[WS] Unknown message type from ${data.id}`);
        }
      } catch (err) {
        console.error(`[WS] Failed to parse message from ${data.id}:`, err);
      }
    },

    close: (ws, code, _message) => {
      const data = ws.getUserData();
      console.info(`[WS] Disconnected: ${data.id} (code: ${code})`);
      // TODO: Remove from room, notify other players (Step 2)
    },
  })
  .listen(PORT, (listenSocket) => {
    if (listenSocket) {
      console.info(`─────────────────────────────────────────────────`);
      console.info(`  🏰 Labyrinth 2D Server`);
      console.info(`  Listening on ws://localhost:${PORT}`);
      console.info(`  Tick rate: ${SERVER_TICK_RATE} tps`);
      console.info(`  Max players/room: ${MAX_PLAYERS_PER_ROOM}`);
      console.info(`─────────────────────────────────────────────────`);
    } else {
      console.error(`❌ Failed to listen on port ${PORT}`);
      process.exit(1);
    }
  });
