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
//    One maze instance is generated per room. Room state is isolated.
//
// 3. SERVER GAME LOOP (~20 ticks/sec): Every tick, the server:
//    a) Applies each player's latest input to move them (constant speed).
//    b) Broadcasts a TickUpdate with the authoritative positions.
//
// 4. CLIENT-SIDE PREDICTION (Step 4): Not yet implemented.
//    Currently the client renders raw server positions — expect latency.
//
// Step 3: Room management, movement processing, message routing.
// ─────────────────────────────────────────────────────────────────────────────

import uWS from 'uWebSockets.js';

import {
  MessageType,
  DEFAULT_ROOM_ID,
  MAX_PLAYERS_PER_ROOM,
  SERVER_TICK_RATE,
  type ClientToServerMessage,
} from '@labyrinth/shared';

import { Room, type SocketData } from './Room.js';

const PORT = 9001;

// ── Room Registry ───────────────────────────────────────────────────────────

const rooms: Map<string, Room> = new Map();

/** Get or create a room by ID. */
function getOrCreateRoom(roomId: string): Room {
  let room = rooms.get(roomId);
  if (!room) {
    room = new Room(roomId);
    rooms.set(roomId, room);
    console.info(`[Server] Created room: ${roomId}`);
  }
  return room;
}

// ── Player ID Generator ─────────────────────────────────────────────────────

let nextId = 0;

function generatePlayerId(): string {
  return `player-${nextId++}`;
}

// ── uWebSockets.js Application ──────────────────────────────────────────────

const app = uWS
  .App()
  .ws<SocketData>('/*', {
    /* ── Connection Settings ─────────────────────────────────── */
    compression: uWS.SHARED_COMPRESSOR,
    maxPayloadLength: 4 * 1024, // 4 KB max message size
    idleTimeout: 120, // seconds before auto-disconnect

    /* ── Lifecycle Hooks ─────────────────────────────────────── */

    upgrade: (res, req, context) => {
      res.upgrade<SocketData>(
        {
          id: generatePlayerId(),
          displayName: '',
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
        const msg: ClientToServerMessage = JSON.parse(text);

        switch (msg.type) {
          case MessageType.JoinRoom: {
            data.displayName = msg.displayName;

            const roomId = msg.roomId || DEFAULT_ROOM_ID;
            const room = getOrCreateRoom(roomId);

            if (room.isFull) {
              ws.send(
                JSON.stringify({
                  type: MessageType.Error,
                  code: 'ROOM_FULL',
                  message: `Room "${roomId}" is full (${MAX_PLAYERS_PER_ROOM} players max).`,
                }),
                false,
              );
              return;
            }

            room.addPlayer(ws);
            break;
          }

          case MessageType.PlayerInput: {
            // Forward the input to the player's room for processing on next tick
            if (data.roomId) {
              const room = rooms.get(data.roomId);
              if (room) {
                room.handleInput(data.id, msg);
              }
            }
            break;
          }

          case MessageType.ActivateRunestone: {
            if (data.roomId) {
              const room = rooms.get(data.roomId);
              if (room) {
                room.handleActivateRunestone(data.id, msg);
              }
            }
            break;
          }

          case MessageType.DebugTeleport: {
            if (data.roomId) {
              const room = rooms.get(data.roomId);
              if (room) {
                room.handleDebugTeleport(data.id, msg);
              }
            }
            break;
          }

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

      if (data.roomId) {
        const room = rooms.get(data.roomId);
        if (room) {
          room.removePlayer(data.id);

          if (room.playerCount === 0) {
            room.destroy();
            rooms.delete(data.roomId);
            console.info(`[Server] Destroyed empty room: ${data.roomId}`);
          }
        }
      }
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
