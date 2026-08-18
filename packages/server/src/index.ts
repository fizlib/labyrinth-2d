// packages/server/src/index.ts
// ─────────────────────────────────────────────────────────────────────────────
// False Arrow — Authoritative Game Server
// ─────────────────────────────────────────────────────────────────────────────
//
// MULTIPLAYER ARCHITECTURE (Authoritative Server Model):
//
// 1. This server is the SINGLE SOURCE OF TRUTH for all game state.
//    Clients send inputs (PlayerInput), never direct state mutations.
//
// 2. ROOM/LOBBY SYSTEM: Each group of up to 9 players joins a "room".
//    Waiting rooms are event-driven; one isolated maze starts after the
//    full-room countdown or an approved underfilled vote.
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
import { randomInt } from 'node:crypto';

import {
  MessageType,
  MAX_PLAYERS_PER_ROOM,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  isValidRoomCode,
  isValidReconnectToken,
  normalizeRoomCode,
  SERVER_TICK_RATE,
  type ClientToServerMessage,
  type JoinRoomMessage,
} from '@labyrinth/shared';

import { Room, type SocketData } from './Room.js';
import {
  isSupabasePlayerVerificationConfigured,
  isSupabaseMatchPersistenceConfigured,
  recordMatchResult,
  verifyPlayerAccessToken,
} from './supabaseAdmin.js';

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 9001;

// ── Room Registry ───────────────────────────────────────────────────────────

const rooms: Map<string, Room> = new Map();
const roomsByReconnectToken: Map<string, Room> = new Map();
const roomsByUserId: Map<string, Room> = new Map();
const pendingMatchWritesByUserId: Map<string, Promise<void>> = new Map();

function generateRoomCode(): string {
  for (;;) {
    const code = Array.from(
      { length: ROOM_CODE_LENGTH },
      () => ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)],
    ).join('');
    if (!rooms.has(code)) return code;
  }
}

function createRoom(isPublic: boolean): Room {
  const roomId = generateRoomCode();
  let room: Room;
  room = new Room(roomId, isPublic, {
    matchRecordingEnabled: isSupabaseMatchPersistenceConfigured,
    onSeatReleased: (reconnectToken, userId) => {
      if (roomsByReconnectToken.get(reconnectToken) === room) {
        roomsByReconnectToken.delete(reconnectToken);
      }
      if (userId && roomsByUserId.get(userId) === room) {
        roomsByUserId.delete(userId);
      }
    },
    onEmpty: () => {
      if (rooms.get(roomId) !== room) return;
      for (const [userId, claimedRoom] of roomsByUserId) {
        if (claimedRoom === room) roomsByUserId.delete(userId);
      }
      room.destroy();
      rooms.delete(roomId);
      console.info(`[Server] Destroyed empty room: ${roomId}`);
    },
    onMatchEnded: (record) => {
      const write = recordMatchResult(record).catch((error) => {
        console.error(
          `[Match] Failed to persist match ${record.matchId}:`,
          error instanceof Error ? error.message : error,
        );
      });
      for (const participant of record.participants) {
        pendingMatchWritesByUserId.set(participant.profileId, write);
      }
      void write.finally(() => {
        for (const participant of record.participants) {
          if (pendingMatchWritesByUserId.get(participant.profileId) === write) {
            pendingMatchWritesByUserId.delete(participant.profileId);
          }
        }
      });
    },
    onMatchCompleted: (userIds) => {
      for (const userId of userIds) {
        if (roomsByUserId.get(userId) === room) roomsByUserId.delete(userId);
      }
    },
  });
  rooms.set(roomId, room);
  console.info(`[Server] Created ${isPublic ? 'public' : 'private'} room: ${roomId}`);
  return room;
}

function findQuickPlayRoom(): Room {
  return (
    Array.from(rooms.values()).find((room) => room.isPublic && room.isJoinable) ??
    createRoom(true)
  );
}

function normalizeDisplayName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const displayName = value.replace(/[\r\n\t]+/g, ' ').trim();
  return displayName.length >= 1 && displayName.length <= 32 ? displayName : null;
}

function sendError(ws: uWS.WebSocket<SocketData>, code: string, message: string): void {
  ws.send(JSON.stringify({ type: MessageType.Error, code, message }), false);
}

async function handleJoinRoom(
  ws: uWS.WebSocket<SocketData>,
  msg: JoinRoomMessage,
): Promise<void> {
  const data = ws.getUserData();
  data.supportsSnapshotFlowControl = msg.supportsSnapshotFlowControl === true;
  if (data.roomId || data.joinPending) {
    sendError(ws, 'ALREADY_IN_ROOM', 'You have already joined or are joining a lobby.');
    return;
  }

  if (!isValidReconnectToken(msg.reconnectToken)) {
    sendError(ws, 'INVALID_RECONNECT_TOKEN', 'A valid private seat token is required.');
    return;
  }

  const existingRoom = roomsByReconnectToken.get(msg.reconnectToken);
  if (existingRoom) {
    const result = existingRoom.reconnectPlayer(ws, msg.reconnectToken);
    if (result === 'in-use') {
      sendError(ws, 'RECONNECT_IN_USE', 'That seat is already connected.');
    } else if (result !== 'resumed') {
      sendError(ws, 'RECONNECT_FAILED', 'That reserved seat is no longer available.');
    }
    return;
  }

  const displayName = normalizeDisplayName(msg.displayName);
  if (!displayName) {
    sendError(ws, 'INVALID_DISPLAY_NAME', 'Display names must use 1–32 characters.');
    return;
  }

  data.joinPending = true;
  data.displayName = displayName;
  try {
    let identity = await verifyPlayerAccessToken(msg.accessToken);
    if (!data.connected) return;

    const pendingMatchWrite = identity
      ? pendingMatchWritesByUserId.get(identity.userId)
      : undefined;
    if (pendingMatchWrite) {
      await pendingMatchWrite;
      if (!data.connected) return;
      identity = await verifyPlayerAccessToken(msg.accessToken);
      if (!data.connected) return;
    }

    data.userId = identity?.userId ?? null;
    data.isAdmin = identity?.isAdmin ?? false;
    data.rating = identity?.rating ?? 1200;
    data.ratedMatches = identity?.ratedMatches ?? 0;
    if (identity) data.displayName = identity.displayName;

    const roomClaimedWhileVerifying = roomsByReconnectToken.get(msg.reconnectToken);
    if (roomClaimedWhileVerifying) {
      const result = roomClaimedWhileVerifying.reconnectPlayer(ws, msg.reconnectToken);
      if (result === 'in-use') {
        sendError(ws, 'RECONNECT_IN_USE', 'That seat is already connected.');
      } else if (result !== 'resumed') {
        sendError(ws, 'RECONNECT_FAILED', 'That reserved seat is no longer available.');
      }
      return;
    }

    if (data.userId && roomsByUserId.has(data.userId)) {
      sendError(
        ws,
        'ACCOUNT_ALREADY_IN_ROOM',
        'This account already has an occupied game seat.',
      );
      return;
    }

    let room: Room | undefined;
    if (msg.mode === 'quick') {
      room = findQuickPlayRoom();
    } else if (msg.mode === 'create') {
      room = createRoom(false);
    } else if (msg.mode === 'join') {
      const roomId = normalizeRoomCode(msg.roomId);
      if (!isValidRoomCode(roomId)) {
        sendError(ws, 'INVALID_ROOM_CODE', 'Enter a valid six-character room code.');
        return;
      }
      room = rooms.get(roomId);
      if (!room) {
        sendError(ws, 'ROOM_NOT_FOUND', `Room "${roomId}" was not found.`);
        return;
      }
    } else {
      sendError(ws, 'INVALID_JOIN_MODE', 'This lobby request is not supported.');
      return;
    }

    if (room.isFull) {
      sendError(
        ws,
        'ROOM_FULL',
        `Room "${room.id}" is full (${MAX_PLAYERS_PER_ROOM} players max).`,
      );
      return;
    }
    if (!room.isJoinable) {
      sendError(
        ws,
        'ROOM_UNAVAILABLE',
        `Room "${room.id}" is no longer accepting new players.`,
      );
      return;
    }

    if (!room.addPlayer(ws, msg.reconnectToken)) {
      sendError(
        ws,
        'JOIN_FAILED',
        'The lobby could not reserve a seat. Please try again.',
      );
      return;
    }
    roomsByReconnectToken.set(msg.reconnectToken, room);
    if (data.userId) roomsByUserId.set(data.userId, room);
  } catch (error) {
    console.error(
      `[WS] Failed to join lobby for ${data.id}:`,
      error instanceof Error ? error.message : error,
    );
    if (data.connected) {
      sendError(ws, 'JOIN_FAILED', 'The lobby could not be joined. Please try again.');
    }
  } finally {
    data.joinPending = false;
  }
}

function handleReconnectRoom(
  ws: uWS.WebSocket<SocketData>,
  roomIdValue: unknown,
  reconnectToken: unknown,
  supportsSnapshotFlowControl: unknown,
): void {
  const data = ws.getUserData();
  data.supportsSnapshotFlowControl = supportsSnapshotFlowControl === true;
  if (data.roomId || data.joinPending) {
    sendError(ws, 'ALREADY_IN_ROOM', 'You have already joined or are joining a room.');
    return;
  }

  const roomId = normalizeRoomCode(roomIdValue);
  if (!isValidRoomCode(roomId) || !isValidReconnectToken(reconnectToken)) {
    sendError(ws, 'RECONNECT_FAILED', 'That reserved seat is no longer available.');
    return;
  }

  const room = rooms.get(roomId);
  if (!room || roomsByReconnectToken.get(reconnectToken) !== room) {
    sendError(ws, 'RECONNECT_FAILED', 'That reserved seat is no longer available.');
    return;
  }

  const result = room.reconnectPlayer(ws, reconnectToken);
  if (result === 'in-use') {
    sendError(ws, 'RECONNECT_IN_USE', 'That seat is already connected.');
  } else if (result !== 'resumed') {
    sendError(ws, 'RECONNECT_FAILED', 'That reserved seat is no longer available.');
  }
}

// ── Player ID Generator ─────────────────────────────────────────────────────

let nextId = 0;

function generatePlayerId(): string {
  return `player-${nextId++}`;
}

// ── uWebSockets.js Application ──────────────────────────────────────────────

uWS
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
          connected: true,
          joinPending: false,
          supportsSnapshotFlowControl: false,
          isAdmin: false,
          userId: null,
          rating: 1200,
          ratedMatches: 0,
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
            void handleJoinRoom(ws, msg);
            break;
          }

          case MessageType.ReconnectRoom: {
            handleReconnectRoom(
              ws,
              msg.roomId,
              msg.reconnectToken,
              msg.supportsSnapshotFlowControl,
            );
            break;
          }

          case MessageType.LeaveRoom: {
            if (data.roomId) rooms.get(data.roomId)?.removePlayer(data.id);
            break;
          }

          case MessageType.AdminStartGame: {
            if (data.roomId) rooms.get(data.roomId)?.handleAdminStartGame(data.id);
            break;
          }

          case MessageType.AdminKickPlayer: {
            if (data.roomId) rooms.get(data.roomId)?.handleAdminKickPlayer(data.id, msg);
            break;
          }

          case MessageType.GameReady: {
            if (data.roomId) rooms.get(data.roomId)?.handleGameReady(data.id, msg);
            break;
          }

          case MessageType.VoteToStart: {
            if (data.roomId) rooms.get(data.roomId)?.handleVoteToStart(data.id, msg);
            break;
          }

          case MessageType.SendLobbyChat: {
            if (data.roomId)
              rooms.get(data.roomId)?.handleSendLobbyChatMessage(data.id, msg);
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

          case MessageType.SnapshotApplied: {
            if (data.roomId) {
              rooms.get(data.roomId)?.handleSnapshotApplied(data.id, msg);
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

          case MessageType.OpenChest: {
            if (data.roomId) {
              const room = rooms.get(data.roomId);
              if (room) {
                room.handleOpenChest(data.id, msg);
              }
            }
            break;
          }

          case MessageType.PressPressurePlate: {
            if (data.roomId) {
              const room = rooms.get(data.roomId);
              if (room) {
                room.handlePressPressurePlate(data.id, msg);
              }
            }
            break;
          }

          case MessageType.PressSpikePlate: {
            if (data.roomId) {
              const room = rooms.get(data.roomId);
              if (room) {
                room.handlePressSpikePlate(data.id, msg);
              }
            }
            break;
          }

          case MessageType.ActivateTrapCell: {
            if (data.roomId) {
              const room = rooms.get(data.roomId);
              if (room) room.handleActivateTrapCell(data.id, msg);
            }
            break;
          }

          case MessageType.OpenCage: {
            if (data.roomId) {
              const room = rooms.get(data.roomId);
              if (room) room.handleOpenCage(data.id, msg);
            }
            break;
          }

          case MessageType.UseWisdomOrb: {
            if (data.roomId) {
              const room = rooms.get(data.roomId);
              if (room) {
                room.handleUseWisdomOrb(data.id);
              }
            }
            break;
          }

          case MessageType.SendChatMessage: {
            if (data.roomId) {
              const room = rooms.get(data.roomId);
              if (room) room.handleSendChatMessage(data.id, msg);
            }
            break;
          }

          case MessageType.EscapePortal: {
            if (data.roomId) {
              const room = rooms.get(data.roomId);
              if (room) room.handleEscapePortal(data.id, msg);
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

          case MessageType.DebugPlayerAction: {
            if (data.roomId) {
              const room = rooms.get(data.roomId);
              if (room) {
                room.handleDebugPlayerAction(data.id, msg);
              }
            }
            break;
          }

          case MessageType.DebugSetMatchTime: {
            if (data.roomId) {
              const room = rooms.get(data.roomId);
              if (room) room.handleDebugSetMatchTime(data.id, msg);
            }
            break;
          }

          case MessageType.DebugSetNetworkStats: {
            if (data.roomId) {
              const room = rooms.get(data.roomId);
              if (room) room.handleDebugSetNetworkStats(data.id, msg);
            }
            break;
          }

          case MessageType.DebugSetToolsEnabled: {
            if (data.roomId) {
              const room = rooms.get(data.roomId);
              if (room) room.handleDebugSetToolsEnabled(data.id, msg);
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
      data.connected = false;
      console.info(`[WS] Disconnected: ${data.id} (code: ${code})`);

      if (data.roomId) {
        const room = rooms.get(data.roomId);
        room?.disconnectPlayer(data.id, ws);
      }
    },
  })
  .listen('0.0.0.0', PORT, (listenSocket) => {
    if (listenSocket) {
      console.info(`─────────────────────────────────────────────────`);
      console.info(`  🏹 False Arrow Server`);
      console.info(`  Listening on all interfaces (port ${PORT})`);
      console.info(`  Tick rate: ${SERVER_TICK_RATE} tps`);
      console.info(`  Max players/room: ${MAX_PLAYERS_PER_ROOM}`);
      console.info(
        `  Supabase player verification: ${isSupabasePlayerVerificationConfigured ? 'enabled' : 'disabled'}`,
      );
      console.info(
        `  Match result persistence: ${isSupabaseMatchPersistenceConfigured ? 'enabled' : 'disabled'}`,
      );
      console.info(`─────────────────────────────────────────────────`);
    } else {
      console.error(`❌ Failed to listen on port ${PORT}`);
      process.exit(1);
    }
  });
