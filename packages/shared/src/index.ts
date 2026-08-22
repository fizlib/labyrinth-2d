// packages/shared/src/index.ts
// ─────────────────────────────────────────────────────────────────────────────
// Shared types and constants for @labyrinth/shared
// Used by both @labyrinth/client and @labyrinth/server.
// This package has ZERO runtime dependencies — pure TypeScript types/constants.
// ─────────────────────────────────────────────────────────────────────────────

// ── Re-export physics module ────────────────────────────────────────────────
import type { HubDirection } from './navigation.js';
import type { BridgeEntrySide, BridgeState } from './bridge.js';
import type { SwordFieldState } from './sword-field.js';
import type { CageState } from './cage.js';
import type { SpikeGateState, SpikePlateState } from './spike-gate.js';
import type { LobbyJoinMode, LobbyState } from './lobby.js';
import type { TrapCellPlacement } from './maps/level1.js';

export {
  LOBBY_MAX_PLAYERS,
  LOBBY_MIN_PLAYERS,
  LOBBY_VOTE_DELAY_MS,
  LOBBY_COUNTDOWN_MS,
  MATCH_LOADING_TIMEOUT_MS,
  RECONNECT_GRACE_MS,
  RECONNECT_TOKEN_BYTES,
  RECONNECT_TOKEN_LENGTH,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  getLobbyVotesRequired,
  getWardenCountForPlayers,
  normalizeRoomCode,
  isValidRoomCode,
  isValidReconnectToken,
  type LobbyPhase,
  type LobbyStartReason,
  type LobbyJoinMode,
  type LobbyPlayerInfo,
  type LobbyState,
} from './lobby.js';

export {
  CHAT_MAX_LENGTH,
  CHAT_PROXIMITY_TILES,
  CHAT_PROXIMITY_RANGE,
  CHAT_SEND_COOLDOWN_MS,
  normalizeChatMessageText,
  isWithinChatProximity,
} from './chat.js';

export {
  PLAYER_SPEED,
  FEET_HITBOX_W,
  FEET_HITBOX_H,
  PORTAL_HITBOX_W,
  PORTAL_HITBOX_H,
  PORTAL_WALL_OPENING_WIDTH,
  PORTAL_WALL_OPENING_HEIGHT,
  PORTAL_WALL_OPENING_TOP_OFFSET,
  CHEST_INTERACTION_RANGE,
  getPortalBounds,
  getPortalWallOpeningBounds,
  isPortalWallOpeningTile,
  getPortalPlatformBounds,
  getBridgeBounds,
  getChestDeadEndBounds,
  getTIntersectionDecorationBounds,
  getDecoratedVerticalPassageBounds,
  getChestInteractionPoint,
  applyInput,
  isPositionValid,
  applyInputWithCollision,
  type PortalBounds,
  type PortalCollisionBounds,
  type PortalCollider,
  type ChestDeadEndCollisionBounds,
  type TIntersectionDecorationCollisionBounds,
  type DecoratedVerticalPassageCollisionBounds,
} from './physics.js';

export {
  BRIDGE_WALKWAY_ROWS,
  BRIDGE_WALKWAY_COLUMNS,
  BRIDGE_WALKWAY_TILE_COUNT,
  BRIDGE_WALKWAY_ROW_Y,
  BRIDGE_REPAIR_DURATION_MS,
  BRIDGE_TILE_RESTORE_DURATION_MS,
  BRIDGE_FAILURE_FEEDBACK_DURATION_MS,
  getBridgeTileBit,
  isBridgeTileSafe,
  getBridgeWalkwayTileBounds,
  getBridgeSafeRowFeetCenter,
  getBridgeWalkwayTileAtPoint,
  getBridgeWalkwayTileMaskAtFeetCenter,
  getBridgeRepairCircleBounds,
  getBridgeSafeTileOrder,
  findBridgeWisdomHintTarget,
  getBridgeCollapseMask,
  getBridgeRepairTileOrder,
  getBridgeRepairCollapsedMask,
  getBridgeBankReturnPosition,
  generateBridgeSafeTileMasks,
  type BridgeEntrySide,
  type BridgeTravelDirection,
  type BridgeTileCoordinate,
  type BridgeWisdomHintTarget,
  type BridgeState,
  type BridgeRepairCircleBounds,
} from './bridge.js';

export {
  SWAMP_DEEP_MUD_SUBMERGE_DEPTH,
  SWAMP_SPEED_MULTIPLIER,
  findSwampWisdomHintTarget,
  getPlayerSwampTerrain,
  getSwampAuthoringWidth,
  getSwampFirmGroundTiles,
  getSwampTerrainAtAuthoringPoint,
  isPlayerInSwamp,
  isSwampWaterAtAuthoringPoint,
  type SwampFirmGroundTile,
  type SwampTerrain,
  type SwampWisdomHintTarget,
} from './swamp.js';

export {
  SWORD_FIELD_AUTHORING_TILE_SIZE,
  SWORD_FIELD_WIDTH,
  SWORD_FIELD_HEIGHT,
  SWORD_FIELD_INTERACTION_RANGE,
  SWORD_FIELD_LOWER_DURATION_MS,
  getSwordFieldCollisionBounds,
  getSwordFieldEntrancePoints,
  findSwordFieldWisdomTarget,
  type SwordFieldState,
  type SwordFieldCollisionBounds,
  type SwordFieldWisdomTarget,
} from './sword-field.js';

export {
  SPIKE_GATE_AUTHORING_TILE_SIZE,
  SPIKE_GATE_TERRAIN_COLUMNS,
  SPIKE_GATE_TERRAIN_ROWS,
  SPIKE_GATE_COLUMN_STRIDE,
  SPIKE_GATE_HORIZONTAL_TERRAIN_COLUMNS,
  SPIKE_GATE_HORIZONTAL_TERRAIN_ROWS,
  SPIKE_GATE_VERTICAL_TERRAIN_COLUMNS,
  SPIKE_GATE_VERTICAL_TERRAIN_ROWS,
  SPIKE_GATE_HORIZONTAL_STRIDE,
  SPIKE_GATE_VERTICAL_STRIDE,
  SPIKE_GATES_PER_OBSTACLE,
  SPIKE_PLATES_PER_GATE,
  SPIKE_PLATES_PER_OBSTACLE,
  SPIKE_GATE_COLORS,
  getSpikeGateStateIndex,
  getSpikeGateBarrierOffset,
  getSpikePlateStateIndex,
  getSpikeGateCollisionBounds,
  getSpikeGatePlatePlacements,
  type SpikeGateColor,
  type SpikeGateBounds,
  type SpikeGateState,
  type SpikePlateState,
  type SpikePlatePlacement,
  type SpikePlateSide,
} from './spike-gate.js';

export {
  CAGE_INTERACTION_RANGE,
  CAGE_COLLIDER_WIDTH,
  CAGE_COLLIDER_TOP_OFFSET,
  CAGE_COLLIDER_BOTTOM_OFFSET,
  CAGE_SPAWN_CLEARANCE,
  CAGE_EXIT_DISTANCE,
  getCageCollisionBounds,
  getCageSeparationPositions,
  getCageInteractionPoint,
  isPlayerActivelyCaged,
  findActivePlayerCage,
  hasPrisonerExitedCage,
  findOpenableCage,
  type CageState,
  type CageCollisionBounds,
} from './cage.js';

export {
  CENTRAL_HUB_AUTHORING_TILE_SIZE,
  getCentralHubCollisionBounds,
  getCentralHubRunestonePlacements,
  isCentralHubSuppressedGroundTile,
  type CentralHubCollisionBounds,
  type CentralHubRunestonePlacement,
} from './central-hub.js';

export {
  TRAP_CELL_INTERACTION_RANGE,
  TRAP_CELL_RELEASE_COOLDOWN_MS,
  getTrapCellPlacementAtWorldPoint,
  getTrapCellWorldBounds,
  isPlayerInTrapCell,
  findTrapCellInteractionTarget,
  type TrapCellWorldBounds,
  type TrapCellInteractionTarget,
} from './trap-cell.js';

export {
  MATCH_DURATION_MS,
  INITIAL_ELO_RATING,
  MIN_ELO_RATING,
  ELO_RATING_SCALE,
  ELO_PROVISIONAL_MATCHES,
  ELO_PROVISIONAL_K_FACTOR,
  ELO_ESTABLISHED_K_FACTOR,
  PORTAL_INTERACTION_RANGE,
  SURVIVOR_ESCAPE_RATIO_NUMERATOR,
  SURVIVOR_ESCAPE_RATIO_DENOMINATOR,
  getSurvivorEscapeThreshold,
  getRemainingSurvivorsToEscape,
  isWithinPortalInteractionRange,
  calculateTeamEloRatings,
  type EloRole,
  type EloWinner,
  type TeamEloParticipant,
  type TeamEloResult,
} from './match.js';

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
  MIN_SWAMP_LENGTH_CELLS,
  MAX_SWAMP_LENGTH_CELLS,
  GRID_CELLS,
  computePortalPosition,
  CHEST_DEAD_END_DENSITY,
  T_INTERSECTION_DECORATION_DENSITY,
  DECORATED_VERTICAL_PASSAGE_DENSITY,
  SPIKE_GATE_OBSTACLE_DENSITY,
  MIN_SPIKE_GATE_OBSTACLES,
  MAX_SPIKE_GATE_OBSTACLES,
  TRAP_CELL_DENSITY,
  MIN_TRAP_CELLS,
  MAX_TRAP_CELLS,
  chooseChestCount,
  getChestDeadEndVariant,
  computeChestDeadEndPlacements,
  computeSwordFieldPlacements,
  computeSpikeGateObstaclePlacements,
  computeTeamRouteSwordFieldPlacements,
  computeTrapCellPlacements,
  computeTIntersectionDecorationPlacements,
  computeDecoratedVerticalPassagePlacements,
  generateMazeLayout,
  generateMaze,
  type TileMapData,
  type SpawnPoint,
  type GateOrientation,
  type GateSpawnDirection,
  type GatePlacement,
  type PressurePlateInfo,
  type BridgePlacement,
  type SwampPlacement,
  type SwordFieldPlacement,
  type SpikeGateOrientation,
  type SpikeGateObstaclePlacement,
  type TIntersectionDecorationPlacement,
  type DecoratedVerticalPassagePlacement,
  type TrapCellPlacement,
  type ChestCount,
  type ChestSlot,
  type ChestDeadEndDirection,
  type ChestDeadEndVariant,
  type ChestDeadEndPlacement,
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

/** Squad colors in team/runestone index order. */
export const SQUAD_COLORS = ['blue', 'green', 'yellow'] as const;

export type SquadColor = (typeof SQUAD_COLORS)[number];

/** Maximum number of squads per room. */
export const MAX_TEAMS = SQUAD_COLORS.length;

/** Resolve a public team ID to its assigned squad color. */
export function getSquadColor(teamId: number): SquadColor | null {
  return SQUAD_COLORS[teamId] ?? null;
}

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

/** Authoritative state broadcasts are intentionally cheaper than simulation. */
export const SERVER_SNAPSHOT_RATE = 20;

/** Number of simulation ticks represented by one periodic state broadcast. */
export const SERVER_TICKS_PER_SNAPSHOT = SERVER_TICK_RATE / SERVER_SNAPSHOT_RATE;

/** Duration of one server tick in milliseconds. */
export const SERVER_TICK_MS = 1000 / SERVER_TICK_RATE;

/** Duration of one server tick in seconds (for physics). */
export const SERVER_TICK_S = 1 / SERVER_TICK_RATE;

/** Number of wisdom orbs each survivor starts with. Wardens always start with 0. */
export const INITIAL_WISDOM_ORBS = 1;

/** Maximum number of wisdom orbs a survivor can carry. */
export const MAX_WISDOM_ORBS = 3;

/** Maximum feet-to-button-center distance for a warden's manual gate-button press. */
export const PRESSURE_PLATE_INTERACTION_RANGE = 28;

/** How long an activated gate remains open before its buttons reset. */
export const GATE_OPEN_DURATION_MS = 5_000;

/** Return the post-chest inventory, or null when the survivor is already full. */
export function getChestWisdomOrbReward(wisdomOrbs: number): number | null {
  if (!Number.isInteger(wisdomOrbs) || wisdomOrbs < 0 || wisdomOrbs >= MAX_WISDOM_ORBS) {
    return null;
  }
  return wisdomOrbs + 1;
}

/** Playable character names in server sprite-index order. */
export const PLAYER_CHARACTER_NAMES = [
  'Female1',
  'Male1',
  'Female2',
  'Male2',
  'Female3',
] as const;

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
  OpenChest = 'OPEN_CHEST',
  PressPressurePlate = 'PRESS_PRESSURE_PLATE',
  PressSpikePlate = 'PRESS_SPIKE_PLATE',
  ActivateTrapCell = 'ACTIVATE_TRAP_CELL',
  OpenCage = 'OPEN_CAGE',
  UseWisdomOrb = 'USE_WISDOM_ORB',
  DebugTeleport = 'DEBUG_TELEPORT',
  DebugPlayerAction = 'DEBUG_PLAYER_ACTION',
  DebugSetMatchTime = 'DEBUG_SET_MATCH_TIME',
  DebugSetNetworkStats = 'DEBUG_SET_NETWORK_STATS',
  DebugSetToolsEnabled = 'DEBUG_SET_TOOLS_ENABLED',
  SendChatMessage = 'SEND_CHAT_MESSAGE',
  EscapePortal = 'ESCAPE_PORTAL',
  VoteToStart = 'VOTE_TO_START',
  SendLobbyChat = 'SEND_LOBBY_CHAT',
  AdminStartGame = 'ADMIN_START_GAME',
  AdminKickPlayer = 'ADMIN_KICK_PLAYER',
  GameReady = 'GAME_READY',
  ReconnectRoom = 'RECONNECT_ROOM',
  LeaveRoom = 'LEAVE_ROOM',
  SnapshotApplied = 'SNAPSHOT_APPLIED',

  // ── Server → Client ──
  RoomJoined = 'ROOM_JOINED',
  MatchStarted = 'MATCH_STARTED',
  TickUpdate = 'TICK_UPDATE',
  PlayerLeft = 'PLAYER_LEFT',
  RunestoneActivated = 'RUNESTONE_ACTIVATED',
  AllRunestonesActivated = 'ALL_RUNESTONES_ACTIVATED',
  ChestOpened = 'CHEST_OPENED',
  WisdomOrbGranted = 'WISDOM_ORB_GRANTED',
  WisdomOrbUsed = 'WISDOM_ORB_USED',
  PlayerRoleChanged = 'PLAYER_ROLE_CHANGED',
  DebugPlayerRole = 'DEBUG_PLAYER_ROLE',
  GateStateChanged = 'GATE_STATE_CHANGED',
  TrapActivationResult = 'TRAP_ACTIVATION_RESULT',
  PlayerTrapped = 'PLAYER_TRAPPED',
  ChatMessage = 'CHAT_MESSAGE',
  PlayerEscaped = 'PLAYER_ESCAPED',
  MatchEnded = 'MATCH_ENDED',
  LobbyJoined = 'LOBBY_JOINED',
  LobbyUpdated = 'LOBBY_UPDATED',
  LobbyChatMessage = 'LOBBY_CHAT_MESSAGE',
  LobbyKicked = 'LOBBY_KICKED',
  Error = 'ERROR',
}

// ── Client → Server Messages ────────────────────────────────────────────────

export interface JoinRoomMessage {
  type: MessageType.JoinRoom;
  roomId: string;
  displayName: string;
  mode: LobbyJoinMode;
  /** Private per-tab bearer token registered to this occupied seat. */
  reconnectToken: string;
  /** Supabase access token used by the game server to verify admin status. */
  accessToken?: string;
  /** Enables bounded server-to-client snapshot flow control for this connection. */
  supportsSnapshotFlowControl?: boolean;
}

export interface ReconnectRoomMessage {
  type: MessageType.ReconnectRoom;
  roomId: string;
  reconnectToken: string;
  /** Enables bounded server-to-client snapshot flow control for this connection. */
  supportsSnapshotFlowControl?: boolean;
}

export interface LeaveRoomMessage {
  type: MessageType.LeaveRoom;
}

/** Confirms that the client finished applying an authoritative world snapshot. */
export interface SnapshotAppliedMessage {
  type: MessageType.SnapshotApplied;
  snapshotId: number;
}

export interface VoteToStartMessage {
  type: MessageType.VoteToStart;
  vote: boolean;
}

export interface SendLobbyChatMessage {
  type: MessageType.SendLobbyChat;
  text: string;
}

export interface AdminStartGameMessage {
  type: MessageType.AdminStartGame;
}

export interface AdminKickPlayerMessage {
  type: MessageType.AdminKickPlayer;
  playerId: string;
}

/** Confirms that the client has loaded assets and built its initial maze scene. */
export interface GameReadyMessage {
  type: MessageType.GameReady;
}

export interface PlayerInputMessage {
  type: MessageType.PlayerInput;
  sequenceNumber: number;
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  /** Total client prediction time (seconds) represented by this input command. */
  dt: number;
}

export interface ActivateRunestoneMessage {
  type: MessageType.ActivateRunestone;
  /** Runestone index: 0, 1, or 2. */
  runestoneIndex: number;
}

export interface OpenChestMessage {
  type: MessageType.OpenChest;
  /** Index into the deterministic chest-dead-end placement array. */
  chestIndex: number;
}

export interface PressPressurePlateMessage {
  type: MessageType.PressPressurePlate;
  /** Unique deterministic pressure-plate ID from the generated layout. */
  plateId: number;
}

export interface PressSpikePlateMessage {
  type: MessageType.PressSpikePlate;
  /** Flattened deterministic plate index from the generated spike-gate layout. */
  spikePlateIndex: number;
}

export interface ActivateTrapCellMessage {
  type: MessageType.ActivateTrapCell;
  /** Index into the deterministic trap-cell placement array. */
  trapCellIndex: number;
}

export interface OpenCageMessage {
  type: MessageType.OpenCage;
  /** Stable room-local ID of the nearby closed cage. */
  cageId: number;
}

export interface UseWisdomOrbMessage {
  type: MessageType.UseWisdomOrb;
}

export interface SendChatMessage {
  type: MessageType.SendChatMessage;
  text: string;
}

export interface EscapePortalMessage {
  type: MessageType.EscapePortal;
}

export interface DebugTeleportMessage {
  type: MessageType.DebugTeleport;
  x: number;
  y: number;
}

export interface DebugSetMatchTimeMessage {
  type: MessageType.DebugSetMatchTime;
  /** New authoritative time remaining. Zero resolves the match as a timeout. */
  remainingMs: number;
}

export interface DebugSetNetworkStatsMessage {
  type: MessageType.DebugSetNetworkStats;
  /** Whether every participant should see the in-match network statistics HUD. */
  enabled: boolean;
}

export interface DebugSetToolsEnabledMessage {
  type: MessageType.DebugSetToolsEnabled;
  /** Whether this verified admin may use debug-only global chat routing. */
  enabled: boolean;
}

export type DebugPlayerAction =
  | 'teleport-to'
  | 'teleport-here'
  | 'get-role'
  | 'set-skin'
  | 'set-squad'
  | 'set-dead'
  | 'set-role';

export interface DebugPlayerActionMessage {
  type: MessageType.DebugPlayerAction;
  action: DebugPlayerAction;
  targetPlayerId: string;
  /** Required for set-skin; ignored by other actions. */
  spriteIndex?: number;
  /** Required for set-squad; squad/runestone index from 0 through MAX_TEAMS - 1. */
  teamId?: number;
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
  /** Squad index; maps to SQUAD_COLORS and the same-index runestone. */
  teamId: number;
  /** Index into the client's playerAnimationSets array (0-based). */
  spriteIndex: number;
  x: number;
  y: number;
  facing: FacingDirection;
  isMoving: boolean;
  /** False while this occupied seat is inside its reconnect grace window. */
  connected: boolean;
  /** Debug death state; currently rendered as the character's lying pose. */
  isDead: boolean;
  /** Whether this survivor has escaped and become an inactive spectator. */
  escaped: boolean;
  lastProcessedInput: number;
}

export interface RoomJoinedMessage {
  type: MessageType.RoomJoined;
  roomId: string;
  playerId: string;
  /** Private, server-verified permission for the recipient. */
  isAdmin: boolean;
  mapSeed: number;
  /** Private role for the recipient of this message. */
  role: PlayerRole;
  /** Private starting orb count for the recipient of this message. */
  wisdomOrbs: number;
  gameState: GameState;
}

/** Releases a fully loaded roster into the running match at one server deadline. */
export interface MatchStartedMessage {
  type: MessageType.MatchStarted;
  gameState: GameState;
}

export interface LobbyJoinedMessage {
  type: MessageType.LobbyJoined;
  playerId: string;
  /** Private, server-verified permission for the recipient. */
  isAdmin: boolean;
  lobby: LobbyState;
}

export interface LobbyUpdatedMessage {
  type: MessageType.LobbyUpdated;
  lobby: LobbyState;
}

export type LobbyChatMessageKind = 'chat' | 'join' | 'leave';

export interface LobbyChatMessage {
  type: MessageType.LobbyChatMessage;
  playerId: string;
  displayName: string;
  text: string;
  kind: LobbyChatMessageKind;
  sentAt: number;
}

export interface LobbyKickedMessage {
  type: MessageType.LobbyKicked;
  message: string;
}

export interface TickUpdateMessage {
  type: MessageType.TickUpdate;
  /** Monotonic room-local ID used for application-level flow control. */
  snapshotId: number;
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
  /** Activated portal X in pixel coordinates. */
  portalX: number;
  /** Activated portal Y in pixel coordinates. */
  portalY: number;
}

export interface WisdomOrbUsedMessage {
  type: MessageType.WisdomOrbUsed;
  hint: WisdomOrbHint;
  remainingWisdomOrbs: number;
}

/** Public notification that one shared treasure chest has been opened. */
export interface ChestOpenedMessage {
  type: MessageType.ChestOpened;
  chestIndex: number;
  playerId: string;
}

/** Private inventory update sent only to the survivor who opened a chest. */
export interface WisdomOrbGrantedMessage {
  type: MessageType.WisdomOrbGranted;
  chestIndex: number;
  wisdomOrbs: number;
}

/** Private result of accepted wisdom use or an orb-free warden sword clear. */
export type WisdomOrbHint =
  | {
      kind: 'direction';
      direction: HubDirection;
    }
  | {
      kind: 'bridge';
      bridgeIndex: number;
      entrySide: BridgeEntrySide;
      safeTileMask: number;
    }
  | {
      kind: 'swamp';
      swampIndex: number;
    }
  | {
      kind: 'sword-field';
      swordFieldIndex: number;
    };

/** Private notification sent only to a player whose role changed through debug tools. */
export interface PlayerRoleChangedMessage {
  type: MessageType.PlayerRoleChanged;
  role: PlayerRole;
  wisdomOrbs: number;
}

/** Private debug response containing the authoritative role of one player. */
export interface DebugPlayerRoleMessage {
  type: MessageType.DebugPlayerRole;
  playerId: string;
  role: PlayerRole;
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

export type TrapActivationFailureReason = 'no-survivors' | 'release-cooldown';

/** Private acknowledgement of one valid warden trap activation. */
export interface TrapActivationResultMessage {
  type: MessageType.TrapActivationResult;
  trapCellIndex: number;
  capturedCount: number;
  /** Present only when the activation did not capture anyone. */
  failureReason: TrapActivationFailureReason | null;
}

/** Private notification sent to a survivor when a Warden cages them. */
export interface PlayerTrappedMessage {
  type: MessageType.PlayerTrapped;
  cageId: number;
}

/** Transient server-authored chat event delivered by authoritative chat routing. */
export interface ChatMessage {
  type: MessageType.ChatMessage;
  playerId: string;
  displayName: string;
  /** Public squad index used to color the sender's name. */
  teamId: number;
  text: string;
}

/** Global authoritative notification that one survivor entered the portal. */
export interface PlayerEscapedMessage {
  type: MessageType.PlayerEscaped;
  playerId: string;
  displayName: string;
  portalX: number;
  portalY: number;
  escapedCount: number;
  escapeThreshold: number;
  remainingToEscape: number;
}

/** Global immutable match result. */
export interface MatchEndedMessage {
  type: MessageType.MatchEnded;
  winner: MatchWinner;
  escapedCount: number;
  escapeThreshold: number;
  remainingMs: number;
  finalRoster: MatchResultPlayer[];
}

// ── Runestone State ─────────────────────────────────────────────────────────

export interface RunestoneInfo {
  /** Runestone index (0, 1, or 2). */
  index: number;
  /** Squad color allowed to activate this runestone. */
  squadColor: SquadColor;
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

/** Shared pressed/neutral state for one deterministic gate pressure plate. */
export interface PressurePlateState {
  plateId: number;
  pressed: boolean;
  /** Whether a warden explicitly latched this plate with the interaction key. */
  latched: boolean;
}

/** Shared opened/unopened state for one deterministic treasure placement. */
export interface ChestState {
  chestIndex: number;
  opened: boolean;
}

// ── Game State ──────────────────────────────────────────────────────────────

export type MatchStatus = 'waiting' | 'loading' | 'running' | 'ended';
export type MatchWinner = 'survivors' | 'wardens';

/** Public role reveal captured once, when the match becomes immutable. */
export interface MatchResultPlayer {
  playerId: string;
  displayName: string;
  role: PlayerRole;
  escaped: boolean;
}

export interface MatchState {
  status: MatchStatus;
  /** Authoritative time remaining when this snapshot was produced. */
  remainingMs: number;
  escapedCount: number;
  escapeThreshold: number;
  winner: MatchWinner | null;
  /** Null during play so hidden roles are revealed only after match completion. */
  finalRoster: MatchResultPlayer[] | null;
}

export interface GameState {
  tick: number;
  match: MatchState;
  /** Admin-controlled room-wide visibility for the in-match network statistics HUD. */
  networkStatsVisible: boolean;
  players: PlayerInfo[];
  runestones: RunestoneInfo[];
  /** Portal position in pixel coordinates, selected when the room is created. */
  portal: { x: number; y: number } | null;
  /** Per-gate open/closed state. */
  gateStates: GateState[];
  /** Per-pressure-plate pressed/neutral state. */
  pressurePlateStates: PressurePlateState[];
  /** Per-bridge collapsed walkway state shared by the whole room. */
  bridgeStates: BridgeState[];
  /** Per-chest opened state shared by the whole room. */
  chestStates: ChestState[];
  /** Shared lowering/cleared state for each deterministic sword barrier. */
  swordFieldStates: SwordFieldState[];
  /** Per-barrier open/closed state for every generated spike-gate chain. */
  spikeGateStates: SpikeGateState[];
  /** Physical/manual activation state for each of the spike gates' paired plates. */
  spikePlateStates: SpikePlateState[];
  /** Spawned survivor cages, including vacated cages that remain solid forever. */
  cageStates: CageState[];
  /** Server-authoritative trap network, including cells added by administrators. */
  trapCells: TrapCellPlacement[];
}

// ── Union Types ─────────────────────────────────────────────────────────────

export type ClientToServerMessage =
  | JoinRoomMessage
  | ReconnectRoomMessage
  | LeaveRoomMessage
  | SnapshotAppliedMessage
  | VoteToStartMessage
  | SendLobbyChatMessage
  | AdminStartGameMessage
  | AdminKickPlayerMessage
  | GameReadyMessage
  | PlayerInputMessage
  | ActivateRunestoneMessage
  | OpenChestMessage
  | PressPressurePlateMessage
  | PressSpikePlateMessage
  | ActivateTrapCellMessage
  | OpenCageMessage
  | UseWisdomOrbMessage
  | SendChatMessage
  | EscapePortalMessage
  | DebugTeleportMessage
  | DebugSetMatchTimeMessage
  | DebugSetNetworkStatsMessage
  | DebugSetToolsEnabledMessage
  | DebugPlayerActionMessage;

export type ServerToClientMessage =
  | LobbyJoinedMessage
  | LobbyUpdatedMessage
  | LobbyChatMessage
  | LobbyKickedMessage
  | RoomJoinedMessage
  | MatchStartedMessage
  | TickUpdateMessage
  | PlayerLeftMessage
  | RunestoneActivatedMessage
  | AllRunestonesActivatedMessage
  | ChestOpenedMessage
  | WisdomOrbGrantedMessage
  | WisdomOrbUsedMessage
  | PlayerRoleChangedMessage
  | DebugPlayerRoleMessage
  | GateStateChangedMessage
  | TrapActivationResultMessage
  | PlayerTrappedMessage
  | ChatMessage
  | PlayerEscapedMessage
  | MatchEndedMessage
  | ErrorMessage;
