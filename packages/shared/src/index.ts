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

// ── Network Message Types ───────────────────────────────────────────────────

/**
 * Enum of all message types exchanged between client and server.
 * Used as the `type` field in every network message for routing.
 */
export enum MessageType {
  // Client → Server
  PlayerJoin = 'PLAYER_JOIN',
  PlayerInput = 'PLAYER_INPUT',
  PlayerLeave = 'PLAYER_LEAVE',

  // Server → Client
  RoomJoined = 'ROOM_JOINED',
  GameStateSnapshot = 'GAME_STATE_SNAPSHOT',
  PlayerLeft = 'PLAYER_LEFT',
  Error = 'ERROR',
}

// ── Client → Server Messages ────────────────────────────────────────────────

/** Sent when a player requests to join a room. */
export interface PlayerJoinMessage {
  type: MessageType.PlayerJoin;
  roomId: string;
  displayName: string;
}

/**
 * Sent every frame the player has input.
 * The server processes these in order, keyed by `seq` for reconciliation.
 */
export interface PlayerInputMessage {
  type: MessageType.PlayerInput;
  /** Monotonically increasing sequence number for reconciliation. */
  seq: number;
  /** Server tick this input targets. */
  tick: number;
  /** Normalized directional input (-1, 0, or 1). */
  dx: -1 | 0 | 1;
  dy: -1 | 0 | 1;
  /** Optional action (e.g., interact, use item). */
  action?: string;
}

/** Sent when a player intentionally disconnects. */
export interface PlayerLeaveMessage {
  type: MessageType.PlayerLeave;
}

// ── Server → Client Messages ────────────────────────────────────────────────

/** Sent to a client upon successfully joining a room. */
export interface RoomJoinedMessage {
  type: MessageType.RoomJoined;
  roomId: string;
  /** Maze generation seed for deterministic client-side rendering. */
  seed: number;
  /** Your assigned player ID for this session. */
  playerId: string;
  /** Current list of player IDs already in the room. */
  playerIds: string[];
}

/** Per-player state within a snapshot. */
export interface PlayerState {
  id: string;
  x: number;
  y: number;
  /** Last acknowledged input sequence number (for reconciliation). */
  lastProcessedInput: number;
  /** Current animation direction (for rendering). */
  direction: 'up' | 'down' | 'left' | 'right';
}

/**
 * Delta state snapshot broadcast by the server each tick.
 * Contains only players whose state changed since the last snapshot.
 */
export interface GameStateSnapshotMessage {
  type: MessageType.GameStateSnapshot;
  /** Server tick number this snapshot represents. */
  tick: number;
  /** Map of playerId → current PlayerState (only changed players). */
  players: Record<string, PlayerState>;
  /** Optional game events (door opened, puzzle solved, etc.). */
  events?: GameEvent[];
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

// ── Game Events ─────────────────────────────────────────────────────────────

/** Generic game event included in state snapshots. */
export interface GameEvent {
  kind: string;
  payload: Record<string, unknown>;
}

// ── Union Types ─────────────────────────────────────────────────────────────

/** All messages a client can send. */
export type ClientMessage =
  | PlayerJoinMessage
  | PlayerInputMessage
  | PlayerLeaveMessage;

/** All messages a server can send. */
export type ServerMessage =
  | RoomJoinedMessage
  | GameStateSnapshotMessage
  | PlayerLeftMessage
  | ErrorMessage;
