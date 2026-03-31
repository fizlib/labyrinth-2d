// packages/shared/src/index.ts
// ─────────────────────────────────────────────────────────────────────────────
// Shared types and constants for @labyrinth/shared
// Used by both @labyrinth/client and @labyrinth/server.
// This package has ZERO runtime dependencies — pure TypeScript types/constants.
// ─────────────────────────────────────────────────────────────────────────────

// ── Re-export physics module ────────────────────────────────────────────────
export {
  PLAYER_SPEED,
  FEET_HITBOX_W,
  FEET_HITBOX_H,
  applyInput,
  isPositionValid,
  applyInputWithCollision,
  type PortalCollider,
} from './physics.js';

// ── Re-export map data ──────────────────────────────────────────────────────
export {
  TILE_FLOOR,
  TILE_FLOOR_SHADOW,
  TILE_WALL_FACE,
  TILE_WALL_TOP,
  TILE_WALL_INTERIOR,
  TILE_WALL_SIDE_LEFT,
  TILE_WALL_SIDE_RIGHT,
  TILE_WALL_BOTTOM,
  TILE_WALL_CORNER_TL,
  TILE_WALL_CORNER_TR,
  TILE_WALL_CORNER_BL,
  TILE_WALL_CORNER_BR,
  TILE_WALL_TOP_EDGE,
  TILE_TREE,
  TILE_RUNESTONE_1,
  TILE_RUNESTONE_2,
  TILE_RUNESTONE_3,
  MAZE_SIZE,
  computeSpawnPoints,
  computePortalPosition,
  generateMaze,
  type TileMapData,
  type SpawnPoint,
} from './maps/level1.js';


// ── Game Constants ──────────────────────────────────────────────────────────

/** Internal rendering resolution width in pixels. */
export const INTERNAL_WIDTH = 480;

/** Internal rendering resolution height in pixels. */
export const INTERNAL_HEIGHT = 270;

/** Tile size in pixels (16×16 standard for Stardew-style). */
export const TILE_SIZE = 16;

/** Number of players per team. */
export const PLAYERS_PER_TEAM = 3;

/** Maximum number of teams per room. */
export const MAX_TEAMS = 3;

/**
 * Spawn distance from the center hub, measured in maze cell-steps.
 * All teams spawn at exactly this BFS distance through the maze.
 * Valid range: 1–12 (center of the 15×15 cell grid is ~7 cells from edges).
 */
export const SPAWN_DISTANCE = 10;

/** Maximum players allowed per room (MAX_TEAMS × PLAYERS_PER_TEAM). */
export const MAX_PLAYERS_PER_ROOM = MAX_TEAMS * PLAYERS_PER_TEAM;

/** Server simulation tick rate (ticks per second). */
export const SERVER_TICK_RATE = 20;

/** Duration of one server tick in milliseconds. */
export const SERVER_TICK_MS = 1000 / SERVER_TICK_RATE;

/** Duration of one server tick in seconds (for physics). */
export const SERVER_TICK_S = 1 / SERVER_TICK_RATE;

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
  ActivateRunestone = 'ACTIVATE_RUNESTONE',
  DebugTeleport = 'DEBUG_TELEPORT',

  // ── Server → Client ──
  RoomJoined = 'ROOM_JOINED',
  TickUpdate = 'TICK_UPDATE',
  PlayerLeft = 'PLAYER_LEFT',
  RunestoneActivated = 'RUNESTONE_ACTIVATED',
  AllRunestonesActivated = 'ALL_RUNESTONES_ACTIVATED',
  Error = 'ERROR',
}

// ── Client → Server Messages ────────────────────────────────────────────────

export interface JoinRoomMessage {
  type: MessageType.JoinRoom;
  roomId: string;
  displayName: string;
}

export interface PlayerInputMessage {
  type: MessageType.PlayerInput;
  sequenceNumber: number;
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

export interface ActivateRunestoneMessage {
  type: MessageType.ActivateRunestone;
  /** Runestone index: 0, 1, or 2. */
  runestoneIndex: number;
}

export interface DebugTeleportMessage {
  type: MessageType.DebugTeleport;
  x: number;
  y: number;
}

// ── Server → Client Messages ────────────────────────────────────────────────

/** Valid facing directions for player sprites. */
export type FacingDirection = 'up' | 'down' | 'left' | 'right';

export interface PlayerInfo {
  id: string;
  displayName: string;
  teamId: number;
  /** Index into the client's playerAnimationSets array (0-based). */
  spriteIndex: number;
  x: number;
  y: number;
  facing: FacingDirection;
  isMoving: boolean;
  lastProcessedInput: number;
}

export interface RoomJoinedMessage {
  type: MessageType.RoomJoined;
  roomId: string;
  playerId: string;
  mapSeed: number;
  gameState: GameState;
}

export interface TickUpdateMessage {
  type: MessageType.TickUpdate;
  gameState: GameState;
}

export interface PlayerLeftMessage {
  type: MessageType.PlayerLeft;
  playerId: string;
}

export interface RunestoneActivatedMessage {
  type: MessageType.RunestoneActivated;
  /** Index of the activated runestone (0, 1, or 2). */
  runestoneIndex: number;
}

export interface AllRunestonesActivatedMessage {
  type: MessageType.AllRunestonesActivated;
  /** Portal spawn X in pixel coordinates. */
  portalX: number;
  /** Portal spawn Y in pixel coordinates. */
  portalY: number;
}

export interface ErrorMessage {
  type: MessageType.Error;
  code: string;
  message: string;
}

// ── Runestone State ─────────────────────────────────────────────────────────

export interface RunestoneInfo {
  /** Runestone index (0, 1, or 2). */
  index: number;
  /** Tile X coordinate. */
  tileX: number;
  /** Tile Y coordinate. */
  tileY: number;
  /** Whether this runestone has been activated. */
  activated: boolean;
}

// ── Game State ──────────────────────────────────────────────────────────────

export interface GameState {
  tick: number;
  players: PlayerInfo[];
  runestones: RunestoneInfo[];
  /** Portal position in pixel coordinates. null until all runestones are activated. */
  portal: { x: number; y: number } | null;
}

// ── Union Types ─────────────────────────────────────────────────────────────

export type ClientToServerMessage = JoinRoomMessage | PlayerInputMessage | ActivateRunestoneMessage | DebugTeleportMessage;

export type ServerToClientMessage =
  | RoomJoinedMessage
  | TickUpdateMessage
  | PlayerLeftMessage
  | RunestoneActivatedMessage
  | AllRunestonesActivatedMessage
  | ErrorMessage;
