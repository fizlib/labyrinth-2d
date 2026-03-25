// packages/shared/src/index.ts
// ─────────────────────────────────────────────────────────────────────────────
// Shared types and constants for @labyrinth/shared
// Used by both @labyrinth/client and @labyrinth/server.
// This package has ZERO runtime dependencies — pure TypeScript types/constants.
// ─────────────────────────────────────────────────────────────────────────────

// ── Game Constants ──────────────────────────────────────────────────────────

/** Internal rendering resolution width in pixels. */
export const INTERNAL_WIDTH = 480;

/** Internal rendering resolution height in pixels. */
export const INTERNAL_HEIGHT = 270;

/** Tile size in pixels (16×16 standard for Stardew-style). */
export const TILE_SIZE = 16;

/** Maximum players allowed per room. */
export const MAX_PLAYERS_PER_ROOM = 10;

/** Server simulation tick rate (ticks per second). */
export const SERVER_TICK_RATE = 20;

/** Duration of one server tick in milliseconds. */
export const SERVER_TICK_MS = 1000 / SERVER_TICK_RATE;

/** Default room ID used when no lobby system is in place yet. */
export const DEFAULT_ROOM_ID = 'default';

// ── Network Message Types ───────────────────────────────────────────────────

/**
 * Discriminator enum for all messages exchanged between client and server.
 * Every message has a `type` field set to one of these values.
 */
export enum MessageType {
  // ── Client → Server ──
  JoinRoom = 'JOIN_ROOM',
  PlayerInput = 'PLAYER_INPUT',

  // ── Server → Client ──
  RoomJoined = 'ROOM_JOINED',
  TickUpdate = 'TICK_UPDATE',
  PlayerLeft = 'PLAYER_LEFT',
  Error = 'ERROR',
}

// ── Client → Server Messages ────────────────────────────────────────────────

/**
 * Sent when a player requests to join a room.
 * The server will assign a player ID and add them to the room.
 */
export interface JoinRoomMessage {
  type: MessageType.JoinRoom;
  roomId: string;
  displayName: string;
}

/**
 * Sent every frame the player has input.
 * The server processes these in order, keyed by `seq` for reconciliation.
 *
 * NOTE: Payload is intentionally empty for Step 2.
 * Movement fields (dx, dy) will be added in a later step.
 */
export interface PlayerInputMessage {
  type: MessageType.PlayerInput;
  /** Monotonically increasing sequence number for reconciliation. */
  seq: number;
}

// ── Server → Client Messages ────────────────────────────────────────────────

/** Minimal player info included in network messages. */
export interface PlayerInfo {
  id: string;
  displayName: string;
}

/**
 * Sent to a client upon successfully joining a room.
 * Contains the initial game state so the client can bootstrap.
 */
export interface RoomJoinedMessage {
  type: MessageType.RoomJoined;
  roomId: string;
  /** The server-assigned player ID for this client. */
  playerId: string;
  /** Current game state at the moment of joining. */
  gameState: GameState;
}

/**
 * Broadcast to all clients in a room every server tick (~20 tps).
 * Contains the current authoritative game state (delta in future steps).
 */
export interface TickUpdateMessage {
  type: MessageType.TickUpdate;
  /** Current game state snapshot. */
  gameState: GameState;
}

/** Sent to all clients when a player leaves the room. */
export interface PlayerLeftMessage {
  type: MessageType.PlayerLeft;
  playerId: string;
}

/** Sent when the server rejects a client action. */
export interface ErrorMessage {
  type: MessageType.Error;
  code: string;
  message: string;
}

// ── Game State ──────────────────────────────────────────────────────────────

/**
 * The authoritative game state held by the server and broadcast to clients.
 * For Step 2 this is minimal: a tick counter and a list of connected players.
 * It will grow as we add maze data, positions, items, etc.
 */
export interface GameState {
  /** Monotonically increasing tick counter (incremented each server tick). */
  tick: number;
  /** All players currently in the room. */
  players: PlayerInfo[];
}

// ── Union Types ─────────────────────────────────────────────────────────────

/** All messages a client can send to the server. */
export type ClientToServerMessage = JoinRoomMessage | PlayerInputMessage;

/** All messages the server can send to a client. */
export type ServerToClientMessage =
  | RoomJoinedMessage
  | TickUpdateMessage
  | PlayerLeftMessage
  | ErrorMessage;
