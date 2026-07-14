// packages/shared/src/index.ts
// ─────────────────────────────────────────────────────────────────────────────
// Shared types and constants for @labyrinth/shared
// Used by both @labyrinth/client and @labyrinth/server.
// This package has ZERO runtime dependencies — pure TypeScript types/constants.
// ─────────────────────────────────────────────────────────────────────────────

// ── Re-export physics module ────────────────────────────────────────────────
import type { HubDirection } from './navigation.js';

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
  TILE_GATE_HORIZONTAL,
  TILE_GATE_VERTICAL,
  TILE_PRESSURE_PLATE,
  MAZE_WIDTH,
  MAZE_HEIGHT,
  CELL_SIZE,
  WALL_WIDTH,
  WALL_HEIGHT,
  computeSpawnPoints,
  CELL_STEP_X,
  CELL_STEP_Y,
  GRID_CELLS,
  computePortalPosition,
  generateMazeLayout,
  generateMaze,
  type TileMapData,
  type SpawnPoint,
  type GateOrientation,
  type GateSpawnDirection,
  type GatePlacement,
  type PressurePlateInfo,
  type GeneratedMazeLayout,
  type HubTileBounds,
  getHubTileBounds,
  isGateTileId,
  isSolidTileId,
} from './maps/level1.js';

export {
  computeHubDistanceField,
  computePortalDistanceField,
  getNavigationDirectionForPosition,
  getNavigationDirectionForTile,
  getHubDirectionForPosition,
  getHubDirectionForTile,
  type HubDirection,
  type NavigationDistanceField,
  type HubDistanceField,
} from './navigation.js';


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

/** Number of wisdom orbs each survivor starts with. Wardens always start with 0. */
export const INITIAL_WISDOM_ORBS = 1;

/** Playable character names in server sprite-index order. */
export const PLAYER_CHARACTER_NAMES = ['Lenne', 'Glenn', 'Amalia', 'Robb', 'Sienna'] as const;

/** Number of playable character animation sets. */
export const PLAYER_CHARACTER_COUNT = PLAYER_CHARACTER_NAMES.length;

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
  UseWisdomOrb = 'USE_WISDOM_ORB',
  DebugTeleport = 'DEBUG_TELEPORT',
  DebugPlayerAction = 'DEBUG_PLAYER_ACTION',

  // ── Server → Client ──
  RoomJoined = 'ROOM_JOINED',
  TickUpdate = 'TICK_UPDATE',
  PlayerLeft = 'PLAYER_LEFT',
  RunestoneActivated = 'RUNESTONE_ACTIVATED',
  AllRunestonesActivated = 'ALL_RUNESTONES_ACTIVATED',
  WisdomOrbUsed = 'WISDOM_ORB_USED',
  PlayerRoleChanged = 'PLAYER_ROLE_CHANGED',
  GateStateChanged = 'GATE_STATE_CHANGED',
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
  /** Client-side frame delta (seconds) used for this input's prediction. */
  dt: number;
}

export interface ActivateRunestoneMessage {
  type: MessageType.ActivateRunestone;
  /** Runestone index: 0, 1, or 2. */
  runestoneIndex: number;
}

export interface UseWisdomOrbMessage {
  type: MessageType.UseWisdomOrb;
}

export interface DebugTeleportMessage {
  type: MessageType.DebugTeleport;
  x: number;
  y: number;
}

export type DebugPlayerAction =
  | 'teleport-to'
  | 'teleport-here'
  | 'set-skin'
  | 'set-dead'
  | 'set-role';

export interface DebugPlayerActionMessage {
  type: MessageType.DebugPlayerAction;
  action: DebugPlayerAction;
  targetPlayerId: string;
  /** Required for set-skin; ignored by other actions. */
  spriteIndex?: number;
  /** Required for set-dead; false revives the player. */
  dead?: boolean;
  /** Required for set-role; ignored by other actions. */
  role?: PlayerRole;
}

// ── Server → Client Messages ────────────────────────────────────────────────

/** Valid cardinal and diagonal facing directions for player sprites. */
export type FacingDirection =
  | 'up'
  | 'up-left'
  | 'up-right'
  | 'down'
  | 'down-left'
  | 'down-right'
  | 'left'
  | 'right';

/** Resolve simultaneous movement buttons to an eight-way facing direction. */
export function deriveFacingDirection(
  input: Pick<PlayerInputMessage, 'up' | 'down' | 'left' | 'right'>,
  fallback: FacingDirection,
): FacingDirection {
  const vertical = input.up === input.down ? null : input.up ? 'up' : 'down';
  const horizontal = input.left === input.right ? null : input.left ? 'left' : 'right';

  if (vertical && horizontal) return `${vertical}-${horizontal}` as FacingDirection;
  return vertical ?? horizontal ?? fallback;
}

/** Hidden role assigned to a player for the lifetime of their occupied room seat. */
export type PlayerRole = 'survivor' | 'warden';

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
  /** Debug death state; currently rendered as the character's lying pose. */
  isDead: boolean;
  lastProcessedInput: number;
}

export interface RoomJoinedMessage {
  type: MessageType.RoomJoined;
  roomId: string;
  playerId: string;
  mapSeed: number;
  /** Private role for the recipient of this message. */
  role: PlayerRole;
  /** Private starting orb count for the recipient of this message. */
  wisdomOrbs: number;
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

export interface WisdomOrbUsedMessage {
  type: MessageType.WisdomOrbUsed;
  direction: HubDirection;
  remainingWisdomOrbs: number;
}

/** Private notification sent only to a player whose role changed through debug tools. */
export interface PlayerRoleChangedMessage {
  type: MessageType.PlayerRoleChanged;
  role: PlayerRole;
  wisdomOrbs: number;
}

export interface ErrorMessage {
  type: MessageType.Error;
  code: string;
  message: string;
}

export interface GateStateChangedMessage {
  type: MessageType.GateStateChanged;
  /** Index into the gates array. */
  gateIndex: number;
  /** Whether the gate is now open (passable). */
  open: boolean;
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

/** Per-gate open/closed state. */
export interface GateState {
  gateIndex: number;
  open: boolean;
}

// ── Game State ──────────────────────────────────────────────────────────────

export interface GameState {
  tick: number;
  players: PlayerInfo[];
  runestones: RunestoneInfo[];
  /** Portal position in pixel coordinates. null until all runestones are activated. */
  portal: { x: number; y: number } | null;
  /** Per-gate open/closed state. */
  gateStates: GateState[];
}

// ── Union Types ─────────────────────────────────────────────────────────────

export type ClientToServerMessage =
  | JoinRoomMessage
  | PlayerInputMessage
  | ActivateRunestoneMessage
  | UseWisdomOrbMessage
  | DebugTeleportMessage
  | DebugPlayerActionMessage;

export type ServerToClientMessage =
  | RoomJoinedMessage
  | TickUpdateMessage
  | PlayerLeftMessage
  | RunestoneActivatedMessage
  | AllRunestonesActivatedMessage
  | WisdomOrbUsedMessage
  | PlayerRoleChangedMessage
  | GateStateChangedMessage
  | ErrorMessage;
