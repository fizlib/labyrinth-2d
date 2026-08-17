// packages/server/src/Room.ts
// ─────────────────────────────────────────────────────────────────────────────
// Room — Manages one maze instance and its occupied, reconnectable seats.
//
// Spawn system:
//   - Teams spawn at dynamically computed equidistant points (BFS from hub).
//   - Distance configurable via SPAWN_DISTANCE constant.
//   - Tile coordinates converted to pixel coordinates (tile.x * tileSize).
// ─────────────────────────────────────────────────────────────────────────────

import { randomUUID } from 'node:crypto';
import type uWS from 'uWebSockets.js';

import {
  MessageType,
  SERVER_TICK_MS,
  SERVER_TICKS_PER_SNAPSHOT,
  PLAYERS_PER_TEAM,
  MAX_TEAMS,
  SQUAD_COLORS,
  TILE_SIZE,
  TILE_FLOOR,
  TILE_GATE_HORIZONTAL,
  CELL_SIZE,
  SPAWN_DISTANCE,
  PRESSURE_PLATE_INTERACTION_RANGE,
  GATE_OPEN_DURATION_MS,
  INITIAL_WISDOM_ORBS,
  getChestWisdomOrbReward,
  PLAYER_CHARACTER_COUNT,
  TILE_RUNESTONE_1,
  TILE_RUNESTONE_2,
  TILE_RUNESTONE_3,
  FEET_HITBOX_W,
  FEET_HITBOX_H,
  computePortalPosition,
  computeHubDistanceField,
  computePortalDistanceField,
  getNavigationDirectionForPosition,
  CHEST_INTERACTION_RANGE,
  getChestInteractionPoint,
  getCentralHubRunestonePlacements,
  BRIDGE_WALKWAY_COLUMNS,
  BRIDGE_WALKWAY_ROWS,
  BRIDGE_REPAIR_DURATION_MS,
  BRIDGE_FAILURE_FEEDBACK_DURATION_MS,
  getBridgeTileBit,
  getBridgeWalkwayTileBounds,
  getBridgeSafeRowFeetCenter,
  getBridgeWalkwayTileAtPoint,
  getBridgeWalkwayTileMaskAtFeetCenter,
  getBridgeRepairCircleBounds,
  findBridgeWisdomHintTarget,
  findSwampWisdomHintTarget,
  findSwordFieldWisdomTarget,
  findTrapCellInteractionTarget,
  isPlayerInTrapCell,
  findActivePlayerCage,
  findOpenableCage,
  getCageSeparationPositions,
  hasPrisonerExitedCage,
  CHAT_SEND_COOLDOWN_MS,
  normalizeChatMessageText,
  isWithinChatProximity,
  LOBBY_COUNTDOWN_MS,
  LOBBY_MAX_PLAYERS,
  LOBBY_MIN_PLAYERS,
  LOBBY_VOTE_DELAY_MS,
  RECONNECT_GRACE_MS,
  getLobbyVotesRequired,
  getWardenCountForPlayers,
  MATCH_DURATION_MS,
  INITIAL_ELO_RATING,
  calculateTeamEloRatings,
  getSurvivorEscapeThreshold,
  getRemainingSurvivorsToEscape,
  isWithinPortalInteractionRange,
  SWORD_FIELD_LOWER_DURATION_MS,
  SPIKE_GATES_PER_OBSTACLE,
  SPIKE_PLATES_PER_OBSTACLE,
  getSpikeGateCollisionBounds,
  getSpikeGateStateIndex,
  getSpikeGatePlatePlacements,
  getBridgeCollapseMask,
  getBridgeRepairCollapsedMask,
  getBridgeBankReturnPosition,
  deriveFacingDirection,
  applyInputWithCollision,
  isPositionValid,
  generateMazeLayout,
  type NavigationDistanceField,
  type TileMapData,
  type SpawnPoint,
  type GatePlacement,
  type PressurePlateInfo,
  type PressurePlateState,
  type BridgePlacement,
  type ChestDeadEndPlacement,
  type SwampPlacement,
  type SwordFieldPlacement,
  type SpikeGateObstaclePlacement,
  type SpikeGateBounds,
  type SpikeGateState,
  type SpikePlatePlacement,
  type SpikePlateState,
  type TIntersectionDecorationPlacement,
  type DecoratedVerticalPassagePlacement,
  type TrapCellPlacement,
  type CageState,
  type SwordFieldState,
  type BridgeEntrySide,
  type BridgeState,
  type ChestState,
  type GameState,
  type PlayerInfo,
  type PlayerRole,
  type RunestoneInfo,
  type PlayerInputMessage,
  type SnapshotAppliedMessage,
  type ActivateRunestoneMessage,
  type OpenChestMessage,
  type PressPressurePlateMessage,
  type PressSpikePlateMessage,
  type ActivateTrapCellMessage,
  type OpenCageMessage,
  type SendChatMessage,
  type SendLobbyChatMessage,
  type VoteToStartMessage,
  type AdminKickPlayerMessage,
  type EscapePortalMessage,
  type DebugTeleportMessage,
  type DebugSetMatchTimeMessage,
  type DebugSetNetworkStatsMessage,
  type DebugPlayerActionMessage,
  type RoomJoinedMessage,
  type LobbyJoinedMessage,
  type LobbyUpdatedMessage,
  type LobbyChatMessage,
  type LobbyKickedMessage,
  type LobbyState,
  type LobbyStartReason,
  type TickUpdateMessage,
  type PlayerLeftMessage,
  type RunestoneActivatedMessage,
  type AllRunestonesActivatedMessage,
  type ChestOpenedMessage,
  type WisdomOrbGrantedMessage,
  type WisdomOrbUsedMessage,
  type PlayerRoleChangedMessage,
  type DebugPlayerRoleMessage,
  type GateStateChangedMessage,
  type TrapActivationResultMessage,
  type ChatMessage,
  type PlayerEscapedMessage,
  type MatchEndedMessage,
  type MatchWinner,
  type ServerToClientMessage,
} from '@labyrinth/shared';

/** Per-socket user data attached by uWebSockets (must match index.ts). */
export interface SocketData {
  id: string;
  displayName: string;
  roomId: string | null;
  connected: boolean;
  joinPending: boolean;
  supportsSnapshotFlowControl: boolean;
  isAdmin: boolean;
  /** Verified Supabase profile id, or null for a guest/unverified session. */
  userId: string | null;
  rating: number;
  ratedMatches: number;
}

type PlayerSocket = uWS.WebSocket<SocketData>;

interface QueuedInput {
  sequenceNumber: number;
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  dt: number;
}

const DEBUG_MAX_MATCH_TIME_MS = 24 * 60 * 60 * 1_000;
const MOVEMENT_INTENT_GRACE_MS = 120;
/** Keeps throughput across normal RTT while strictly bounding stale snapshots. */
const MAX_IN_FLIGHT_SNAPSHOTS = 2;

interface BridgeTraversalState {
  bridgeIndex: number;
  entrySide: BridgeEntrySide;
  lastTileMask: number;
  completed: boolean;
}

interface BridgeRepairProgress {
  startedTick: number;
  activeElapsedMs: number;
  lastUpdatedAtMs: number;
  initialCollapsedTileMask: number;
  orderSide: BridgeEntrySide;
  channelSide: BridgeEntrySide;
  repairingPlayerId: string | null;
  startedByPlayerId: string;
}

interface RoomPlayerInfo extends PlayerInfo {
  /** Stable seat within the assigned three-player team. */
  teamSlot: number;
  /** Hidden role that must never be included in public room snapshots. */
  role: PlayerRole;
  /** Private, server-authoritative inventory. */
  wisdomOrbs: number;
}

interface RoomSeat {
  id: string;
  displayName: string;
  isAdmin: boolean;
  userId: string | null;
  rating: number;
  ratedMatches: number;
  reconnectToken: string;
  reservationHandle: ReturnType<typeof setTimeout> | null;
}

export interface RoomOptions {
  reconnectGraceMs?: number;
  matchRecordingEnabled?: boolean;
  onSeatReleased?: (
    reconnectToken: string,
    userId: string | null,
  ) => void;
  onEmpty?: () => void;
  onMatchEnded?: (record: MatchRecord) => void;
  onMatchCompleted?: (userIds: string[]) => void;
}

interface MatchRosterEntry {
  playerId: string;
  displayName: string;
  userId: string | null;
  rating: number;
  ratedMatches: number;
  role: PlayerRole;
  escaped: boolean;
  abandoned: boolean;
}

export interface MatchParticipantRecord {
  profileId: string;
  displayName: string;
  role: PlayerRole;
  escaped: boolean;
  abandoned: boolean;
  ratingBefore: number;
  ratedMatchesBefore: number;
  ratingDelta: number;
  ratingAfter: number;
}

export interface MatchRecord {
  matchId: string;
  roomId: string;
  winner: MatchWinner;
  playerCount: number;
  rated: boolean;
  startedAt: string;
  endedAt: string;
  participants: MatchParticipantRecord[];
}

export type ReconnectResult = 'resumed' | 'in-use' | 'not-found';

type RoomState = Omit<GameState, 'players'> & { players: RoomPlayerInfo[] };

function createEmptyRoleSeats(): PlayerRole[][] {
  return Array.from({ length: MAX_TEAMS }, () =>
    Array<PlayerRole>(PLAYERS_PER_TEAM).fill('survivor'),
  );
}

function shuffle<T>(values: T[]): T[] {
  for (let index = values.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [values[index], values[swapIndex]] = [values[swapIndex], values[index]];
  }
  return values;
}

/** Convert private room state into the player data that every client may see. */
function toPublicPlayerInfo(player: RoomPlayerInfo): PlayerInfo {
  return {
    id: player.id,
    displayName: player.displayName,
    teamId: player.teamId,
    spriteIndex: player.spriteIndex,
    x: player.x,
    y: player.y,
    facing: player.facing,
    isMoving: player.isMoving,
    connected: player.connected,
    isDead: player.isDead,
    escaped: player.escaped,
    lastProcessedInput: player.lastProcessedInput,
  };
}

/** Pixel distance threshold for runestone activation (1.5 tiles). */
const RUNESTONE_ACTIVATION_RANGE = 28;

/** Resolve exact authored runestone anchors, with marker-tile fallback for other maps. */
function findRunestonePositions(map: TileMapData): RunestoneInfo[] {
  const authoredPlacements = getCentralHubRunestonePlacements(map);
  if (authoredPlacements.length > 0) {
    return authoredPlacements.map((placement) => ({
      index: placement.index,
      squadColor: SQUAD_COLORS[placement.index],
      tileX: placement.tileX,
      tileY: placement.tileY,
      activated: false,
    }));
  }

  const runestones: RunestoneInfo[] = [];
  const tileTypes = [TILE_RUNESTONE_1, TILE_RUNESTONE_2, TILE_RUNESTONE_3];
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const tile = map.data[y * map.width + x];
      const idx = tileTypes.indexOf(tile);
      if (idx !== -1) {
        runestones.push({
          index: idx,
          squadColor: SQUAD_COLORS[idx],
          tileX: x,
          tileY: y,
          activated: false,
        });
      }
    }
  }
  // Sort by index so slot 0/1/2 are in order
  runestones.sort((a, b) => a.index - b.index);
  return runestones;
}

/**
 * Check if a player's feet AABB overlaps a 16×16 pressure plate tile.
 * Player (x, y) is feet bottom-center. Feet hitbox = 8 wide × 12 tall.
 */
function isPlayerOnPlate(
  playerX: number,
  playerY: number,
  plateTileX: number,
  plateTileY: number,
  tileSize: number,
): boolean {
  // Player feet AABB
  const pLeft = playerX - FEET_HITBOX_W / 2;
  const pTop = playerY - FEET_HITBOX_H;
  const pRight = pLeft + FEET_HITBOX_W - 1;
  const pBottom = playerY - 1;

  // Plate tile AABB
  const tLeft = plateTileX * tileSize;
  const tTop = plateTileY * tileSize;
  const tRight = tLeft + tileSize - 1;
  const tBottom = tTop + tileSize - 1;

  return pLeft <= tRight && pRight >= tLeft && pTop <= tBottom && pBottom >= tTop;
}

function isPlayerOnWorldPlate(
  playerX: number,
  playerY: number,
  plate: { x: number; y: number; width: number; height: number },
): boolean {
  const playerLeft = playerX - FEET_HITBOX_W / 2;
  const playerTop = playerY - FEET_HITBOX_H;
  const playerRight = playerLeft + FEET_HITBOX_W - 1;
  const playerBottom = playerY - 1;
  return (
    playerLeft <= plate.x + plate.width - 1 &&
    playerRight >= plate.x &&
    playerTop <= plate.y + plate.height - 1 &&
    playerBottom >= plate.y
  );
}

function isPlayerOverlappingWorldBounds(
  playerX: number,
  playerY: number,
  bounds: SpikeGateBounds,
): boolean {
  const playerLeft = playerX - FEET_HITBOX_W / 2;
  const playerTop = playerY - FEET_HITBOX_H;
  const playerRight = playerLeft + FEET_HITBOX_W - 1;
  const playerBottom = playerY - 1;
  return (
    playerLeft <= bounds.right &&
    playerRight >= bounds.left &&
    playerTop <= bounds.bottom &&
    playerBottom >= bounds.top
  );
}

export class Room {
  readonly id: string;
  readonly isPublic: boolean;
  private state: RoomState;
  private readonly seats = new Map<string, RoomSeat>();
  private sockets: Map<string, PlayerSocket> = new Map();
  private inputQueues: Map<string, QueuedInput[]> = new Map();
  private readonly inFlightSnapshotIds = new Map<string, number[]>();
  private nextSnapshotId = 1;
  private readonly lastMovementInputAt = new Map<string, number>();
  private readonly lastChatSentAt = new Map<string, number>();
  private loopHandle: ReturnType<typeof setInterval> | null = null;
  private countdownHandle: ReturnType<typeof setTimeout> | null = null;
  private lobbyCountdownEndsAtMs: number | null = null;
  private lobbyStartReason: LobbyStartReason = null;
  private lobbyVoteAvailableAtMs = 0;
  private readonly lobbyVotes = new Set<string>();
  private readonly reconnectGraceMs: number;
  private readonly onSeatReleased: (
    reconnectToken: string,
    userId: string | null,
  ) => void;
  private readonly onEmpty: () => void;
  private readonly onMatchEnded: (record: MatchRecord) => void;
  private readonly onMatchCompleted: (userIds: string[]) => void;
  private readonly matchRecordingEnabled: boolean;

  /** Immutable identity/role roster captured at the beginning of a match. */
  private matchRoster: MatchRosterEntry[] = [];
  private matchId: string | null = null;
  private matchStartedAtMs: number | null = null;
  private matchIsRanked = false;
  private rankedDisabled = false;
  private matchResultEmitted = false;

  /** Server wall-clock deadline, initialized when the lobby countdown completes. */
  private matchEndsAtMs: number | null = null;

  /** Hidden role assigned to every seat in the room. */
  private readonly roleSeats: PlayerRole[][];

  /** Runestone activation state (server-authoritative). */
  private runestones: RunestoneInfo[] = [];

  /** Portal position, chosen when the room is created. */
  private portalPosition: { x: number; y: number } | null = null;

  /** Whether all runestones have activated the portal. */
  private portalActivated = false;

  /** Random seed used to generate this room's maze. */
  readonly mapSeed: number;

  /** The generated maze tile map for this room. */
  private readonly map: TileMapData;

  /** Dynamically computed equidistant spawn points (one per team). */
  private readonly spawnPoints: SpawnPoint[];

  /** Gate placements from map generation. */
  private readonly gates: GatePlacement[];

  /** Pressure plates from map generation. */
  private readonly pressurePlates: PressurePlateInfo[];

  /** Authored bridge obstacles from deterministic map generation. */
  private readonly bridges: BridgePlacement[];

  /** Authored walkable swamps from deterministic map generation. */
  private readonly swamps: SwampPlacement[];

  /** Authored survivor-orb/warden-interaction barriers from map generation. */
  private readonly swordFields: SwordFieldPlacement[];

  /** Cooperative two- or three-gate obstacle chains spanning either passage axis. */
  private readonly spikeGateObstacles: SpikeGateObstaclePlacement[];

  /** Deterministic 6x6 cells visible to and activatable by wardens. */
  private readonly trapCells: TrapCellPlacement[];

  /** Decorative, collidable ruins/signpost prefabs in north-closed T-junctions. */
  private readonly tIntersectionDecorations: TIntersectionDecorationPlacement[];

  /** Decorative, collidable foliage compositions spanning vertical cell pairs. */
  private readonly decoratedVerticalPassages: DecoratedVerticalPassagePlacement[];

  /** Shared lowering/cleared state for every sword barrier. */
  private readonly swordFieldStates: SwordFieldState[];

  /** Shared open/closed state for each colored spike barrier. */
  private readonly spikeGateStates: SpikeGateState[];

  /** Shared physical/manual activation state for each spike-gate plate. */
  private readonly spikePlateStates: SpikePlateState[];

  /** Spike-gate plates latched by wardens until that colored gate resets. */
  private readonly manuallyPressedSpikePlateIndices = new Set<number>();

  /** Server time at which each manually opened spike gate must close. */
  private readonly spikeGateCloseDeadlines: Array<number | null>;

  /** Require held plates to be released after a timed spike-gate reset. */
  private readonly spikeGateNeedsRelease: boolean[];

  /** Authored collidable treasure prefabs in south-opening dead ends. */
  private readonly chestDeadEnds: ChestDeadEndPlacement[];

  /** Shared opened/unopened state in deterministic chest placement order. */
  private readonly chestStates: ChestState[];

  /** Spawned cages persist after escape as permanent solid obstacles. */
  private readonly cageStates: CageState[] = [];

  private nextCageId = 0;

  /** Shared, server-authoritative missing-stone masks. */
  private readonly bridgeStates: BridgeState[];

  /** Current bridge attempt for each player. */
  private readonly bridgeTraversals = new Map<string, BridgeTraversalState>();

  /** Bridge routes privately revealed to each player by wisdom orbs. */
  private readonly revealedWisdomBridges = new Map<string, Set<number>>();

  /** Swamp routes privately revealed to each player by wisdom orbs. */
  private readonly revealedWisdomSwamps = new Map<string, Set<number>>();

  /** Expiry time for each bridge's short wrong-stone visual marker. */
  private readonly bridgeFailureFeedbackExpirations = new Map<number, number>();

  /** Current treasure-circle occupancy, used to require a fresh step-on edge. */
  private readonly bridgeRepairOccupancy = new Map<string, string>();

  /** Fixed-duration repairs currently progressing across bridge stones. */
  private readonly bridgeRepairs = new Map<number, BridgeRepairProgress>();

  /** Per-gate open/closed state (true = open/passable). */
  private gateOpenStates: boolean[];

  /** Gate buttons latched by wardens until that gate completes an open cycle. */
  private readonly manuallyPressedPlateIds = new Set<number>();

  /** Shared visual/activation state for every generated gate button. */
  private readonly pressurePlateStates: PressurePlateState[];

  /** Server time at which each open gate must close, or null while closed. */
  private readonly gateCloseDeadlines: Array<number | null>;

  /** Require every physically occupied button to be released after a timed reset. */
  private readonly gateNeedsRelease: boolean[];

  /** Precomputed tile distances from every walkable tile to the hub. */
  private readonly hubDistanceField: NavigationDistanceField;

  /** Precomputed tile distances from every walkable tile to the portal approach zone. */
  private portalDistanceField: NavigationDistanceField | null = null;

  constructor(id: string, isPublic = false, options: RoomOptions = {}) {
    this.id = id;
    this.isPublic = isPublic;
    this.reconnectGraceMs = options.reconnectGraceMs ?? RECONNECT_GRACE_MS;
    this.onSeatReleased = options.onSeatReleased ?? (() => {});
    this.onEmpty = options.onEmpty ?? (() => {});
    this.onMatchEnded = options.onMatchEnded ?? (() => {});
    this.onMatchCompleted = options.onMatchCompleted ?? (() => {});
    this.matchRecordingEnabled =
      options.matchRecordingEnabled ?? options.onMatchEnded !== undefined;
    this.roleSeats = createEmptyRoleSeats();
    this.mapSeed = Math.floor(Math.random() * 2147483647);
    const layout = generateMazeLayout(this.mapSeed, SPAWN_DISTANCE, MAX_TEAMS);
    this.map = layout.map;
    this.spawnPoints = layout.spawnPoints;
    this.gates = layout.gates;
    this.pressurePlates = layout.pressurePlates;
    this.bridges = layout.bridges;
    this.swamps = layout.swamps;
    this.swordFields = layout.swordFields;
    this.spikeGateObstacles = layout.spikeGateObstacles;
    this.trapCells = layout.trapCells;
    this.tIntersectionDecorations = layout.tIntersectionDecorations;
    this.decoratedVerticalPassages = layout.decoratedVerticalPassages;
    this.swordFieldStates = this.swordFields.map((_, swordFieldIndex) => ({
      swordFieldIndex,
      loweringStartedTick: null,
      cleared: false,
    }));
    this.spikeGateStates = this.spikeGateObstacles.flatMap((_, obstacleIndex) =>
      Array.from({ length: SPIKE_GATES_PER_OBSTACLE }, (_unused, gateIndex) => ({
        spikeGateIndex: getSpikeGateStateIndex(obstacleIndex, gateIndex),
        open: false,
      })),
    );
    this.spikePlateStates = this.spikeGateObstacles.flatMap((_, obstacleIndex) =>
      Array.from({ length: SPIKE_PLATES_PER_OBSTACLE }, (_unused, localIndex) => ({
        spikePlateIndex:
          obstacleIndex * SPIKE_PLATES_PER_OBSTACLE + localIndex,
        pressed: false,
        latched: false,
      })),
    );
    this.spikeGateCloseDeadlines = new Array<number | null>(
      this.spikeGateStates.length,
    ).fill(null);
    this.spikeGateNeedsRelease = new Array(this.spikeGateStates.length).fill(false);
    this.chestDeadEnds = layout.chestDeadEnds;
    this.chestStates = this.chestDeadEnds.map((_, chestIndex) => ({
      chestIndex,
      opened: false,
    }));
    this.bridgeStates = this.bridges.map((_, bridgeIndex) => ({
      bridgeIndex,
      collapsedTileMask: 0,
      wrongTileIndex: null,
      repairingSide: null,
      repairActive: false,
      repairingPlayerId: null,
      repairStartedTick: null,
      repairInitialCollapsedTileMask: 0,
    }));
    this.gateOpenStates = new Array(this.gates.length).fill(false);
    this.pressurePlateStates = this.pressurePlates.map((plate) => ({
      plateId: plate.id,
      pressed: false,
      latched: false,
    }));
    this.gateCloseDeadlines = new Array<number | null>(this.gates.length).fill(null);
    this.gateNeedsRelease = new Array(this.gates.length).fill(false);
    this.hubDistanceField = computeHubDistanceField(this.map);
    this.runestones = findRunestonePositions(this.map);

    const portalTile = computePortalPosition(
      this.map.data,
      SPAWN_DISTANCE,
      this.bridges,
      this.swamps,
      this.chestDeadEnds,
    );
    if (portalTile) {
      this.portalPosition = {
        x: portalTile.x * TILE_SIZE,
        y: portalTile.y * TILE_SIZE,
      };
      this.portalDistanceField = computePortalDistanceField(
        this.map,
        this.portalPosition,
      );
    } else {
      console.warn(
        `[Room:${this.id}] No valid portal position found during room creation`,
      );
    }

    this.state = {
      tick: 0,
      match: {
        status: 'waiting',
        remainingMs: MATCH_DURATION_MS,
        escapedCount: 0,
        escapeThreshold: 1,
        winner: null,
        finalRoster: null,
      },
      networkStatsVisible: false,
      players: [],
      runestones: this.runestones,
      portal: this.portalPosition,
      gateStates: this.gates.map((_, i) => ({ gateIndex: i, open: false })),
      pressurePlateStates: this.pressurePlateStates,
      bridgeStates: this.bridgeStates,
      chestStates: this.chestStates,
      swordFieldStates: this.swordFieldStates,
      spikeGateStates: this.spikeGateStates,
      spikePlateStates: this.spikePlateStates,
      cageStates: this.cageStates,
    };
    console.info(
      `[Room:${this.id}] Created with maze seed ${this.mapSeed}, spawn distance ${SPAWN_DISTANCE}`,
    );
    for (let i = 0; i < this.spawnPoints.length; i++) {
      const sp = this.spawnPoints[i];
      console.info(
        `  ${SQUAD_COLORS[i]} squad spawn: tile (${sp.x}, ${sp.y}) → px (${(sp.x + 0.5) * TILE_SIZE}, ${(sp.y + 0.5) * TILE_SIZE})`,
      );
    }
    console.info(
      `  Gates: ${this.gates.length}, Pressure plates: ${this.pressurePlates.length}, Spike-gate obstacles: ${this.spikeGateObstacles.length}, Bridges: ${this.bridges.length}, Swamps: ${this.swamps.length}, Sword fields: ${this.swordFields.length}, Trap cells: ${this.trapCells.length}`,
    );
    if (this.portalPosition) {
      console.info(
        `  Portal: (${Math.round(this.portalPosition.x)}, ${Math.round(this.portalPosition.y)})`,
      );
    }
  }

  // ── Player Management ─────────────────────────────────────────────────

  /** Occupied seats include players inside their reconnect grace window. */
  get playerCount(): number {
    return this.seats.size;
  }

  get connectedPlayerCount(): number {
    return this.sockets.size;
  }

  get isFull(): boolean {
    return this.playerCount >= LOBBY_MAX_PLAYERS;
  }

  get isJoinable(): boolean {
    return (
      this.state.match.status === 'waiting' &&
      this.countdownHandle === null &&
      !this.isFull
    );
  }

  addPlayer(ws: PlayerSocket, reconnectToken: string): boolean {
    const data = ws.getUserData();
    const playerId = data.id;
    const displayName = data.displayName;

    if (!this.isJoinable || this.getSeatByReconnectToken(reconnectToken)) return false;

    this.seats.set(playerId, {
      id: playerId,
      displayName,
      isAdmin: data.isAdmin,
      userId: data.userId ?? null,
      rating: Number.isInteger(data.rating) ? data.rating : INITIAL_ELO_RATING,
      ratedMatches: Number.isInteger(data.ratedMatches) ? data.ratedMatches : 0,
      reconnectToken,
      reservationHandle: null,
    });
    this.sockets.set(playerId, ws);
    this.inputQueues.set(playerId, []);
    this.revealedWisdomBridges.set(playerId, new Set());
    this.revealedWisdomSwamps.set(playerId, new Set());

    if (this.playerCount === 1)
      this.lobbyVoteAvailableAtMs = Date.now() + LOBBY_VOTE_DELAY_MS;
    data.roomId = this.id;

    this.sendLobbyJoined(ws, playerId);
    this.broadcastLobbyState();

    console.info(
      `[Room:${this.id}] Lobby player joined: ${displayName} (${playerId}) — ${this.playerCount} player(s)`,
    );

    if (this.playerCount === LOBBY_MAX_PLAYERS) this.beginLobbyCountdown('full');
    return true;
  }

  reconnectPlayer(ws: PlayerSocket, reconnectToken: string): ReconnectResult {
    const seat = this.getSeatByReconnectToken(reconnectToken);
    if (!seat) return 'not-found';
    if (this.sockets.has(seat.id)) return 'in-use';

    if (seat.reservationHandle !== null) clearTimeout(seat.reservationHandle);
    seat.reservationHandle = null;
    this.sockets.set(seat.id, ws);
    this.inputQueues.set(seat.id, []);
    this.inFlightSnapshotIds.delete(seat.id);

    const data = ws.getUserData();
    data.id = seat.id;
    data.displayName = seat.displayName;
    data.isAdmin = seat.isAdmin;
    data.userId = seat.userId;
    data.rating = seat.rating;
    data.ratedMatches = seat.ratedMatches;
    data.roomId = this.id;

    const player = this.state.players.find((candidate) => candidate.id === seat.id);
    if (player) player.connected = true;

    if (this.state.match.status === 'waiting') {
      this.sendLobbyJoined(ws, seat.id);
      this.broadcastLobbyState();
      if (this.playerCount === LOBBY_MAX_PLAYERS && this.allSeatsConnected) {
        this.beginLobbyCountdown('full');
      }
    } else {
      this.sendRoomJoined(ws, seat.id);
      this.broadcastSnapshot();
    }

    console.info(`[Room:${this.id}] Player reconnected: ${seat.id}`);
    return 'resumed';
  }

  disconnectPlayer(playerId: string, ws: PlayerSocket): boolean {
    if (this.sockets.get(playerId) !== ws) return false;
    const seat = this.seats.get(playerId);
    if (!seat) return false;

    this.sockets.delete(playerId);
    this.inFlightSnapshotIds.delete(playerId);
    this.lobbyVotes.delete(playerId);
    this.clearPlayerTransientActivity(playerId);

    const player = this.state.players.find((candidate) => candidate.id === playerId);
    if (player) player.connected = false;

    if (this.state.match.status === 'waiting') {
      this.cancelLobbyCountdown();
      this.broadcastLobbyState();
    } else {
      this.broadcastSnapshot();
    }

    if (seat.reservationHandle !== null) clearTimeout(seat.reservationHandle);
    seat.reservationHandle = setTimeout(() => {
      seat.reservationHandle = null;
      this.removePlayer(playerId);
    }, this.reconnectGraceMs);

    console.info(
      `[Room:${this.id}] Player disconnected: ${playerId}; seat reserved for ${this.reconnectGraceMs}ms`,
    );
    return true;
  }

  /** Permanently release one occupied seat after leave or grace expiry. */
  removePlayer(playerId: string): boolean {
    const seat = this.seats.get(playerId);
    if (!seat) return false;
    if (seat.reservationHandle !== null) clearTimeout(seat.reservationHandle);

    const socket = this.sockets.get(playerId);
    if (socket) socket.getUserData().roomId = null;
    this.sockets.delete(playerId);
    this.seats.delete(playerId);
    this.inputQueues.delete(playerId);
    this.inFlightSnapshotIds.delete(playerId);
    this.lastMovementInputAt.delete(playerId);
    this.lastChatSentAt.delete(playerId);
    this.bridgeTraversals.delete(playerId);
    this.bridgeRepairOccupancy.delete(playerId);
    this.revealedWisdomBridges.delete(playerId);
    this.revealedWisdomSwamps.delete(playerId);
    this.lobbyVotes.delete(playerId);
    this.onSeatReleased(seat.reconnectToken, seat.userId);
    for (const cage of this.cageStates) {
      if (cage.prisonerPlayerId !== playerId || cage.vacated) continue;
      cage.opened = true;
      cage.vacated = true;
    }
    const wasWaiting = this.state.match.status === 'waiting';
    if (this.state.match.status === 'running') {
      const participant = this.matchRoster.find(
        (candidate) => candidate.playerId === playerId,
      );
      if (participant) participant.abandoned = true;
    }
    this.state.players = this.state.players.filter((p) => p.id !== playerId);

    if (wasWaiting) {
      this.cancelLobbyCountdown();
      this.broadcastLobbyState();
    }

    if (this.state.match.status === 'running') {
      this.syncMatchCounts();
    }

    if (!wasWaiting) {
      const leftMsg: PlayerLeftMessage = {
        type: MessageType.PlayerLeft,
        playerId,
      };
      this.broadcast(leftMsg);
    }

    if (this.state.match.status === 'running') {
      this.checkSurvivorVictory();
    }

    console.info(
      `[Room:${this.id}] Player left: ${playerId} — ${this.playerCount} player(s) remaining`,
    );

    if (this.playerCount === 0) {
      this.stopLoop();
      this.lobbyVoteAvailableAtMs = 0;
      this.onEmpty();
    }
    return true;
  }

  private get allSeatsConnected(): boolean {
    return this.playerCount > 0 && this.connectedPlayerCount === this.playerCount;
  }

  private getSeatByReconnectToken(reconnectToken: string): RoomSeat | undefined {
    for (const seat of this.seats.values()) {
      if (seat.reconnectToken === reconnectToken) return seat;
    }
    return undefined;
  }

  private clearPlayerTransientActivity(playerId: string): void {
    const player = this.state.players.find((candidate) => candidate.id === playerId);
    if (player) this.clearQueuedInputs(player);
    else this.inputQueues.get(playerId)?.splice(0);
    this.bridgeTraversals.delete(playerId);
    this.bridgeRepairOccupancy.delete(playerId);
    for (const [bridgeIndex, repair] of this.bridgeRepairs) {
      if (repair.repairingPlayerId !== playerId) continue;
      repair.repairingPlayerId = null;
      const bridgeState = this.bridgeStates[bridgeIndex];
      if (bridgeState) {
        bridgeState.repairActive = false;
        bridgeState.repairingPlayerId = null;
      }
    }
  }

  handleVoteToStart(playerId: string, msg: VoteToStartMessage): void {
    if (
      this.state.match.status !== 'waiting' ||
      this.countdownHandle !== null ||
      this.connectedPlayerCount < LOBBY_MIN_PLAYERS ||
      !this.allSeatsConnected ||
      Date.now() < this.lobbyVoteAvailableAtMs ||
      !this.sockets.has(playerId)
    ) {
      return;
    }

    if (msg.vote) this.lobbyVotes.add(playerId);
    else this.lobbyVotes.delete(playerId);
    this.broadcastLobbyState();

    if (this.lobbyVotes.size >= getLobbyVotesRequired(this.connectedPlayerCount)) {
      this.beginLobbyCountdown('vote');
    }
  }

  /** Allow a verified administrator to bypass all lobby start conditions. */
  handleAdminStartGame(playerId: string): void {
    if (
      this.state.match.status !== 'waiting' ||
      this.playerCount === 0 ||
      !this.allSeatsConnected ||
      !this.isAdmin(playerId)
    ) {
      return;
    }
    this.disableRanking('administrator bypassed normal lobby start');
    console.info(`[Room:${this.id}] Admin ${playerId} started the match immediately`);
    this.startMatch();
  }

  /** Allow a verified administrator to permanently remove another lobby seat. */
  handleAdminKickPlayer(requesterId: string, msg: AdminKickPlayerMessage): void {
    if (
      this.state.match.status !== 'waiting' ||
      !this.isAdmin(requesterId) ||
      msg.playerId === requesterId ||
      !this.seats.has(msg.playerId)
    ) {
      return;
    }

    this.disableRanking('administrator changed the lobby roster');

    const targetSeat = this.seats.get(msg.playerId)!;
    const targetSocket = this.sockets.get(msg.playerId);
    if (targetSocket) {
      const kickedMessage: LobbyKickedMessage = {
        type: MessageType.LobbyKicked,
        message: 'An administrator removed you from the lobby.',
      };
      this.send(targetSocket, kickedMessage);
    }

    this.removePlayer(msg.playerId);
    console.info(
      `[Room:${this.id}] Admin ${requesterId} removed ${targetSeat.displayName} (${msg.playerId}) from the lobby`,
    );
  }

  handleSendLobbyChatMessage(playerId: string, msg: SendLobbyChatMessage): void {
    if (this.state.match.status !== 'waiting') return;
    const senderSocket = this.sockets.get(playerId);
    const sender = senderSocket?.getUserData();
    const text = normalizeChatMessageText(msg.text);
    if (!sender || text === null) return;

    const now = Date.now();
    const lastSentAt = this.lastChatSentAt.get(playerId) ?? -Infinity;
    if (now - lastSentAt < CHAT_SEND_COOLDOWN_MS) return;
    this.lastChatSentAt.set(playerId, now);

    const chatMessage: LobbyChatMessage = {
      type: MessageType.LobbyChatMessage,
      playerId,
      displayName: sender.displayName,
      text,
      sentAt: now,
    };
    this.broadcast(chatMessage);
  }

  // ── Input Handling ────────────────────────────────────────────────────

  handleInput(playerId: string, msg: PlayerInputMessage): void {
    if (!this.canPlayerAct(playerId)) return;
    const queue = this.inputQueues.get(playerId);
    if (queue) {
      const hasMovement = msg.up || msg.down || msg.left || msg.right;
      if (hasMovement) this.lastMovementInputAt.set(playerId, Date.now());
      else this.lastMovementInputAt.delete(playerId);
      queue.push({
        sequenceNumber: msg.sequenceNumber,
        up: msg.up,
        down: msg.down,
        left: msg.left,
        right: msg.right,
        dt: msg.dt,
      });
    }
  }

  /** Release snapshots cumulatively once the client has actually applied one. */
  handleSnapshotApplied(playerId: string, msg: SnapshotAppliedMessage): void {
    if (!Number.isSafeInteger(msg.snapshotId) || msg.snapshotId < 1) return;
    const inFlight = this.inFlightSnapshotIds.get(playerId);
    if (!inFlight) return;

    const acknowledgedIndex = inFlight.indexOf(msg.snapshotId);
    if (acknowledgedIndex === -1) return;
    inFlight.splice(0, acknowledgedIndex + 1);
    if (inFlight.length === 0) this.inFlightSnapshotIds.delete(playerId);
  }

  /** Validate and deliver one transient message to players near the sender. */
  handleSendChatMessage(playerId: string, msg: SendChatMessage): void {
    if (!this.canPlayerAct(playerId)) return;
    const sender = this.state.players.find((player) => player.id === playerId);
    const text = normalizeChatMessageText(msg.text);
    if (!sender || text === null) return;

    const now = Date.now();
    const lastSentAt = this.lastChatSentAt.get(playerId) ?? -Infinity;
    if (now - lastSentAt < CHAT_SEND_COOLDOWN_MS) return;
    this.lastChatSentAt.set(playerId, now);

    const chatMessage: ChatMessage = {
      type: MessageType.ChatMessage,
      playerId: sender.id,
      displayName: sender.displayName,
      teamId: sender.teamId,
      text,
    };

    for (const recipient of this.state.players) {
      if (recipient.escaped) continue;
      if (!isWithinChatProximity(sender, recipient)) continue;
      const socket = this.sockets.get(recipient.id);
      if (socket) this.send(socket, chatMessage);
    }
  }

  /** Debug: teleport a player to an arbitrary position (updates authoritative state). */
  handleDebugTeleport(playerId: string, msg: DebugTeleportMessage): void {
    if (!this.isAdmin(playerId) || !this.canPlayerAct(playerId)) return;
    const player = this.state.players.find((p) => p.id === playerId);
    if (!player) return;
    this.disableRanking('debug teleport used');
    this.clearQueuedInputs(player);
    this.bridgeTraversals.delete(playerId);
    this.bridgeRepairOccupancy.delete(playerId);
    player.x = msg.x;
    player.y = msg.y;
    console.info(
      `[Room:${this.id}] Debug teleport ${playerId} → (${Math.round(msg.x)}, ${Math.round(msg.y)})`,
    );
  }

  /** Debug: replace the authoritative time remaining for the running match. */
  handleDebugSetMatchTime(requesterId: string, msg: DebugSetMatchTimeMessage): void {
    if (!this.isAdmin(requesterId) || !this.isMatchRunning()) return;
    if (
      typeof msg.remainingMs !== 'number' ||
      !Number.isInteger(msg.remainingMs) ||
      msg.remainingMs < 0 ||
      msg.remainingMs > DEBUG_MAX_MATCH_TIME_MS
    ) {
      return;
    }

    this.disableRanking('debug match timer used');

    const now = Date.now();
    this.matchEndsAtMs = now + msg.remainingMs;
    this.state.match.remainingMs = msg.remainingMs;

    if (msg.remainingMs === 0) {
      this.endMatch('wardens', now);
      return;
    }

    this.broadcastSnapshot();
    console.info(
      `[Room:${this.id}] Debug set match timer to ${Math.ceil(msg.remainingMs / 1_000)} seconds`,
    );
  }

  /** Admin: show or hide the network statistics HUD for every participant. */
  handleDebugSetNetworkStats(
    requesterId: string,
    msg: DebugSetNetworkStatsMessage,
  ): void {
    if (!this.isAdmin(requesterId) || !this.isMatchRunning()) return;
    if (typeof msg.enabled !== 'boolean') return;
    if (this.state.networkStatsVisible === msg.enabled) return;

    this.state.networkStatsVisible = msg.enabled;
    this.broadcastSnapshot();
    console.info(
      `[Room:${this.id}] Admin ${requesterId} ${msg.enabled ? 'enabled' : 'disabled'} network stats for all players`,
    );
  }

  /** Debug: apply a player-menu action using authoritative room state. */
  handleDebugPlayerAction(requesterId: string, msg: DebugPlayerActionMessage): void {
    if (!this.isAdmin(requesterId) || !this.canPlayerAct(requesterId)) return;
    const requester = this.state.players.find((player) => player.id === requesterId);
    const target = this.state.players.find((player) => player.id === msg.targetPlayerId);
    if (!requester || !target) return;

    this.disableRanking('debug player action used');

    switch (msg.action) {
      case 'teleport-to':
        this.teleportPlayer(requester, target.x, target.y);
        console.info(`[Room:${this.id}] Debug teleported ${requesterId} to ${target.id}`);
        break;

      case 'teleport-here':
        this.teleportPlayer(target, requester.x, requester.y);
        console.info(`[Room:${this.id}] Debug teleported ${target.id} to ${requesterId}`);
        break;

      case 'get-role':
        this.sendDebugPlayerRole(requester, target);
        break;

      case 'set-skin':
        if (
          typeof msg.spriteIndex !== 'number' ||
          !Number.isInteger(msg.spriteIndex) ||
          msg.spriteIndex < 0 ||
          msg.spriteIndex >= PLAYER_CHARACTER_COUNT
        ) {
          return;
        }
        target.spriteIndex = msg.spriteIndex;
        console.info(
          `[Room:${this.id}] Debug changed ${target.id} skin to ${msg.spriteIndex}`,
        );
        break;

      case 'set-squad': {
        if (
          typeof msg.teamId !== 'number' ||
          !Number.isInteger(msg.teamId) ||
          msg.teamId < 0 ||
          msg.teamId >= MAX_TEAMS
        ) {
          return;
        }

        const previousTeamId = target.teamId;
        const swappedPlayer = this.changePlayerSquad(target, msg.teamId);
        const swapDetail = swappedPlayer
          ? `; swapped ${swappedPlayer.id} to ${SQUAD_COLORS[previousTeamId]}`
          : '';
        console.info(
          `[Room:${this.id}] Debug changed ${target.id} squad from ${SQUAD_COLORS[previousTeamId]} to ${SQUAD_COLORS[target.teamId]}${swapDetail}`,
        );
        break;
      }

      case 'set-dead':
        if (typeof msg.dead !== 'boolean') return;
        target.isDead = msg.dead;
        console.info(
          `[Room:${this.id}] Debug marked ${target.id} ${msg.dead ? 'dead' : 'alive'}`,
        );
        break;

      case 'set-role': {
        if (msg.role !== 'survivor' && msg.role !== 'warden') return;

        target.role = msg.role;
        target.wisdomOrbs = msg.role === 'survivor' ? INITIAL_WISDOM_ORBS : 0;
        this.roleSeats[target.teamId][target.teamSlot] = msg.role;

        this.syncMatchCounts();
        this.checkSurvivorVictory();

        const targetSocket = this.sockets.get(target.id);
        if (targetSocket) {
          const roleChangedMessage: PlayerRoleChangedMessage = {
            type: MessageType.PlayerRoleChanged,
            role: target.role,
            wisdomOrbs: target.wisdomOrbs,
          };
          this.send(targetSocket, roleChangedMessage);
        }

        this.sendDebugPlayerRole(requester, target);

        console.info(
          `[Room:${this.id}] Debug changed ${target.id} role to ${target.role}`,
        );
        break;
      }
    }
  }

  private teleportPlayer(player: PlayerInfo, x: number, y: number): void {
    this.clearQueuedInputs(player);
    this.bridgeTraversals.delete(player.id);
    this.bridgeRepairOccupancy.delete(player.id);
    player.x = x;
    player.y = y;
  }

  /** Move a player between squads, swapping seats if the destination is full. */
  private changePlayerSquad(
    target: RoomPlayerInfo,
    teamId: number,
  ): RoomPlayerInfo | null {
    const previousTeamId = target.teamId;
    if (previousTeamId === teamId) return null;

    const destinationPlayers = this.state.players.filter(
      (player) => player.id !== target.id && player.teamId === teamId,
    );
    const occupiedSlots = new Set(destinationPlayers.map((player) => player.teamSlot));
    const availableSlot = Array.from(
      { length: PLAYERS_PER_TEAM },
      (_, teamSlot) => teamSlot,
    ).find((teamSlot) => !occupiedSlots.has(teamSlot));

    if (availableSlot !== undefined) {
      target.teamId = teamId;
      target.teamSlot = availableSlot;
      this.roleSeats[teamId][availableSlot] = target.role;
      return null;
    }

    const swappedPlayer =
      destinationPlayers.find((player) => player.teamSlot === target.teamSlot) ??
      destinationPlayers[0];
    if (!swappedPlayer) return null;

    const previousTeamSlot = target.teamSlot;
    const destinationTeamSlot = swappedPlayer.teamSlot;
    target.teamId = teamId;
    target.teamSlot = destinationTeamSlot;
    swappedPlayer.teamId = previousTeamId;
    swappedPlayer.teamSlot = previousTeamSlot;
    this.roleSeats[teamId][destinationTeamSlot] = target.role;
    this.roleSeats[previousTeamId][previousTeamSlot] = swappedPlayer.role;
    return swappedPlayer;
  }

  private clearQueuedInputs(player: PlayerInfo): void {
    const queue = this.inputQueues.get(player.id);
    if (queue) {
      for (const input of queue) {
        player.lastProcessedInput = Math.max(
          player.lastProcessedInput,
          input.sequenceNumber,
        );
      }
      queue.length = 0;
    }
    this.lastMovementInputAt.delete(player.id);
    player.isMoving = false;
  }

  /** Hide brief packet-arrival gaps from remote walk animations. */
  private hasRecentMovementIntent(playerId: string, now = Date.now()): boolean {
    const lastInputAt = this.lastMovementInputAt.get(playerId);
    return lastInputAt !== undefined && now - lastInputAt <= MOVEMENT_INTENT_GRACE_MS;
  }

  private isAdmin(playerId: string): boolean {
    return this.seats.get(playerId)?.isAdmin === true && this.sockets.has(playerId);
  }

  private disableRanking(reason: string): void {
    if (this.rankedDisabled) return;
    this.rankedDisabled = true;
    this.matchIsRanked = false;
    console.info(`[Room:${this.id}] Elo disabled: ${reason}`);
  }

  private getLobbyState(): LobbyState {
    return {
      roomId: this.id,
      phase: this.countdownHandle === null ? 'waiting' : 'countdown',
      players: Array.from(this.seats.values()).map((seat) => ({
        id: seat.id,
        displayName: seat.displayName,
        votedToStart: this.lobbyVotes.has(seat.id),
        connected: this.sockets.has(seat.id),
      })),
      minPlayers: LOBBY_MIN_PLAYERS,
      maxPlayers: LOBBY_MAX_PLAYERS,
      votesRequired: getLobbyVotesRequired(this.connectedPlayerCount),
      voteAvailableAt: this.lobbyVoteAvailableAtMs,
      countdownEndsAt: this.lobbyCountdownEndsAtMs,
      startReason: this.lobbyStartReason,
    };
  }

  private sendLobbyJoined(ws: PlayerSocket, playerId: string): void {
    const seat = this.seats.get(playerId);
    if (!seat) return;
    const joinedMessage: LobbyJoinedMessage = {
      type: MessageType.LobbyJoined,
      playerId,
      isAdmin: seat.isAdmin,
      lobby: this.getLobbyState(),
    };
    this.send(ws, joinedMessage);
  }

  private sendRoomJoined(ws: PlayerSocket, playerId: string): void {
    const player = this.state.players.find((candidate) => candidate.id === playerId);
    const seat = this.seats.get(playerId);
    if (!player || !seat) return;
    const joinMessage: RoomJoinedMessage = {
      type: MessageType.RoomJoined,
      roomId: this.id,
      playerId,
      isAdmin: seat.isAdmin,
      mapSeed: this.mapSeed,
      role: player.role,
      wisdomOrbs: player.wisdomOrbs,
      gameState: this.cloneState(),
    };
    this.send(ws, joinMessage);
  }

  private broadcastLobbyState(): void {
    if (this.state.match.status !== 'waiting') return;
    const message: LobbyUpdatedMessage = {
      type: MessageType.LobbyUpdated,
      lobby: this.getLobbyState(),
    };
    this.broadcast(message);
  }

  private beginLobbyCountdown(reason: Exclude<LobbyStartReason, null>): void {
    if (this.state.match.status !== 'waiting' || this.countdownHandle !== null) return;
    if (!this.allSeatsConnected) return;
    if (reason === 'full' && this.playerCount !== LOBBY_MAX_PLAYERS) return;
    if (
      reason === 'vote' &&
      (this.connectedPlayerCount < LOBBY_MIN_PLAYERS ||
        this.lobbyVotes.size < getLobbyVotesRequired(this.connectedPlayerCount))
    ) {
      return;
    }

    this.lobbyStartReason = reason;
    this.lobbyCountdownEndsAtMs = Date.now() + LOBBY_COUNTDOWN_MS;
    this.countdownHandle = setTimeout(() => {
      this.countdownHandle = null;
      this.startMatch();
    }, LOBBY_COUNTDOWN_MS);
    this.broadcastLobbyState();
    console.info(`[Room:${this.id}] Lobby countdown started (${reason})`);
  }

  private cancelLobbyCountdown(): void {
    if (this.countdownHandle !== null) clearTimeout(this.countdownHandle);
    this.countdownHandle = null;
    this.lobbyCountdownEndsAtMs = null;
    this.lobbyStartReason = null;
    this.lobbyVotes.clear();
  }

  private createMatchPlayers(): void {
    const participants = shuffle(
      Array.from(this.seats.values()).map((seat) => ({
        id: seat.id,
        displayName: seat.displayName,
      })),
    );

    const seats = participants.map((participant, index) => ({
      ...participant,
      teamId: index % MAX_TEAMS,
      teamSlot: Math.floor(index / MAX_TEAMS),
    }));
    const occupiedTeams = Array.from(new Set(seats.map((seat) => seat.teamId)));
    const wardenTeams = shuffle(occupiedTeams).slice(
      0,
      getWardenCountForPlayers(seats.length),
    );
    const wardenIds = new Set(
      wardenTeams.map((teamId) => {
        const teamSeats = seats.filter((seat) => seat.teamId === teamId);
        return teamSeats[Math.floor(Math.random() * teamSeats.length)].id;
      }),
    );

    for (const teamRoles of this.roleSeats) teamRoles.fill('survivor');
    this.state.players = seats.map((seat, spriteIndex): RoomPlayerInfo => {
      const role: PlayerRole = wardenIds.has(seat.id) ? 'warden' : 'survivor';
      this.roleSeats[seat.teamId][seat.teamSlot] = role;
      const spawnTile = this.spawnPoints[seat.teamId] ?? this.spawnPoints[0];
      return {
        id: seat.id,
        displayName: seat.displayName,
        teamId: seat.teamId,
        teamSlot: seat.teamSlot,
        role,
        spriteIndex: spriteIndex % PLAYER_CHARACTER_COUNT,
        x: (spawnTile.x + 0.5) * TILE_SIZE,
        y: (spawnTile.y + 0.5) * TILE_SIZE,
        facing: 'down',
        isMoving: false,
        connected: true,
        isDead: false,
        escaped: false,
        lastProcessedInput: 0,
        wisdomOrbs: role === 'survivor' ? INITIAL_WISDOM_ORBS : 0,
      };
    });
  }

  private captureStartingRoster(now: number): void {
    this.matchId = randomUUID();
    this.matchStartedAtMs = now;
    this.matchResultEmitted = false;
    this.matchRoster = this.state.players.map((player) => {
      const seat = this.seats.get(player.id)!;
      return {
        playerId: player.id,
        displayName: player.displayName,
        userId: seat.userId,
        rating: seat.rating,
        ratedMatches: seat.ratedMatches,
        role: player.role,
        escaped: false,
        abandoned: false,
      };
    });

    const authenticatedIds = this.matchRoster
      .map((participant) => participant.userId)
      .filter((userId): userId is string => userId !== null);
    this.matchIsRanked =
      this.matchRecordingEnabled &&
      this.isPublic &&
      !this.rankedDisabled &&
      this.matchRoster.length === LOBBY_MAX_PLAYERS &&
      authenticatedIds.length === this.matchRoster.length &&
      new Set(authenticatedIds).size === authenticatedIds.length;
  }

  private startMatch(): void {
    if (
      this.state.match.status !== 'waiting' ||
      this.playerCount === 0 ||
      !this.allSeatsConnected
    ) {
      return;
    }
    this.cancelLobbyCountdown();
    this.createMatchPlayers();
    const now = Date.now();
    this.captureStartingRoster(now);
    this.matchEndsAtMs = now + MATCH_DURATION_MS;
    this.state.match.status = 'running';
    this.state.match.winner = null;
    this.state.match.finalRoster = null;
    this.state.match.remainingMs = MATCH_DURATION_MS;
    this.syncMatchCounts();
    this.inFlightSnapshotIds.clear();

    for (const player of this.state.players) {
      const socket = this.sockets.get(player.id);
      if (!socket) continue;
      this.sendRoomJoined(socket, player.id);
    }

    this.startLoop();
    console.info(
      `[Room:${this.id}] Match started with ${this.playerCount} players; deadline in 10 minutes; ${this.matchIsRanked ? 'ranked' : 'unranked'}`,
    );
  }

  /** Keep public progress derived from every occupied private role. */
  private syncMatchCounts(): void {
    if (this.state.match.status === 'ended') return;
    const survivors = this.state.players.filter((player) => player.role === 'survivor');
    this.state.match.escapedCount = survivors.filter((player) => player.escaped).length;
    this.state.match.escapeThreshold = getSurvivorEscapeThreshold(survivors.length);
  }

  private refreshMatchTime(now = Date.now()): void {
    if (this.state.match.status !== 'running' || this.matchEndsAtMs === null) return;
    this.state.match.remainingMs = Math.max(0, this.matchEndsAtMs - now);
  }

  /** End at the deadline before accepting an action that raced the game loop. */
  private isMatchRunning(now = Date.now()): boolean {
    if (this.state.match.status !== 'running') return false;
    if (this.matchEndsAtMs !== null && now >= this.matchEndsAtMs) {
      this.endMatch('wardens', now);
      return false;
    }
    this.refreshMatchTime(now);
    return true;
  }

  private canPlayerAct(playerId: string): boolean {
    if (!this.isMatchRunning()) return false;
    const player = this.state.players.find((candidate) => candidate.id === playerId);
    return Boolean(
      player && player.connected && !player.escaped && this.sockets.has(playerId),
    );
  }

  private checkSurvivorVictory(): void {
    if (this.state.match.status !== 'running') return;
    const occupiedSurvivorPlayers = this.state.players.filter(
      (player) => player.role === 'survivor',
    );
    const occupiedSurvivors = occupiedSurvivorPlayers.length;
    this.syncMatchCounts();
    const allOccupiedSurvivorsEscaped =
      occupiedSurvivors > 0 && occupiedSurvivorPlayers.every((player) => player.escaped);
    if (
      allOccupiedSurvivorsEscaped ||
      (occupiedSurvivors > 0 &&
        this.state.match.escapedCount >= this.state.match.escapeThreshold)
    ) {
      this.endMatch('survivors');
    }
  }

  private endMatch(winner: MatchWinner, now = Date.now()): void {
    if (this.state.match.status === 'ended') return;

    this.syncMatchCounts();
    this.refreshMatchTime(now);
    this.state.match.status = 'ended';
    this.state.match.winner = winner;
    for (const participant of this.matchRoster) {
      const player = this.state.players.find(
        (candidate) => candidate.id === participant.playerId,
      );
      if (!player) continue;
      participant.role = player.role;
      participant.escaped = player.escaped;
    }
    this.state.match.finalRoster = this.matchRoster.map((participant) => ({
      playerId: participant.playerId,
      displayName: participant.displayName,
      role: participant.role,
      escaped: participant.escaped,
    }));
    for (const player of this.state.players) this.clearQueuedInputs(player);

    const finalUpdate: TickUpdateMessage = {
      type: MessageType.TickUpdate,
      snapshotId: this.nextSnapshotId++,
      gameState: this.cloneState(),
    };
    this.broadcast(finalUpdate);

    const endedMessage: MatchEndedMessage = {
      type: MessageType.MatchEnded,
      winner,
      escapedCount: this.state.match.escapedCount,
      escapeThreshold: this.state.match.escapeThreshold,
      remainingMs: this.state.match.remainingMs,
      finalRoster: this.state.match.finalRoster.map((player) => ({ ...player })),
    };
    this.broadcast(endedMessage);
    this.stopLoop();
    this.emitMatchResult(winner, now);
    this.onMatchCompleted(
      this.matchRoster
        .map((participant) => participant.userId)
        .filter((userId): userId is string => userId !== null),
    );
    console.info(
      `[Room:${this.id}] Match ended: ${winner} win (${this.state.match.escapedCount}/${this.state.match.escapeThreshold} escapes)`,
    );
  }

  private emitMatchResult(winner: MatchWinner, endedAtMs: number): void {
    if (
      !this.matchRecordingEnabled ||
      this.matchResultEmitted ||
      !this.matchId ||
      this.matchStartedAtMs === null
    ) {
      return;
    }
    this.matchResultEmitted = true;

    try {
      const authenticatedRoster = this.matchRoster.filter(
        (participant): participant is MatchRosterEntry & { userId: string } =>
          participant.userId !== null,
      );

      const eloResults = this.matchIsRanked
        ? calculateTeamEloRatings(
            authenticatedRoster.map((participant) => ({
              playerId: participant.playerId,
              role: participant.role,
              rating: participant.rating,
              matchesPlayed: participant.ratedMatches,
            })),
            winner,
          )
        : authenticatedRoster.map((participant) => ({
            playerId: participant.playerId,
            role: participant.role,
            rating: participant.rating,
            matchesPlayed: participant.ratedMatches,
            expectedScore: 0,
            actualScore: 0 as const,
            kFactor: 0,
            ratingDelta: 0,
            ratingAfter: participant.rating,
          }));
      const eloByPlayerId = new Map(
        eloResults.map((result) => [result.playerId, result]),
      );
      const participants: MatchParticipantRecord[] = authenticatedRoster.map(
        (participant) => {
          const elo = eloByPlayerId.get(participant.playerId)!;
          return {
            profileId: participant.userId,
            displayName: participant.displayName,
            role: participant.role,
            escaped: participant.escaped,
            abandoned: participant.abandoned,
            ratingBefore: elo.rating,
            ratedMatchesBefore: elo.matchesPlayed,
            ratingDelta: elo.ratingDelta,
            ratingAfter: elo.ratingAfter,
          };
        },
      );

      this.onMatchEnded({
        matchId: this.matchId,
        roomId: this.id,
        winner,
        playerCount: this.matchRoster.length,
        rated: this.matchIsRanked,
        startedAt: new Date(this.matchStartedAtMs).toISOString(),
        endedAt: new Date(endedAtMs).toISOString(),
        participants,
      });
    } catch (error) {
      console.error(
        `[Room:${this.id}] Failed to prepare match result:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  /** Reply privately with a selected player's authoritative role for debug UI. */
  private sendDebugPlayerRole(requester: RoomPlayerInfo, target: RoomPlayerInfo): void {
    const requesterSocket = this.sockets.get(requester.id);
    if (!requesterSocket) return;

    const message: DebugPlayerRoleMessage = {
      type: MessageType.DebugPlayerRole,
      playerId: target.id,
      role: target.role,
    };
    this.send(requesterSocket, message);
  }

  /** Handle a runestone activation request. Validates proximity server-side. */
  handleActivateRunestone(playerId: string, msg: ActivateRunestoneMessage): void {
    if (!this.canPlayerAct(playerId)) return;
    const idx = msg.runestoneIndex;
    const rs = this.runestones.find((r) => r.index === idx);
    if (!rs || rs.activated) return; // invalid or already active

    const player = this.state.players.find((p) => p.id === playerId);
    if (!player) return;

    // A runestone belongs to the squad with the matching index/color.
    if (player.teamId !== rs.index) return;

    // Server-side proximity check (anti-cheat)
    const rsPxX = (rs.tileX + 0.5) * TILE_SIZE;
    const rsPxY = (rs.tileY + 1) * TILE_SIZE;
    const dx = player.x - rsPxX;
    const dy = player.y - rsPxY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > RUNESTONE_ACTIVATION_RANGE) return; // too far

    // Activate!
    rs.activated = true;
    console.info(`[Room:${this.id}] ${rs.squadColor} runestone activated by ${playerId}`);

    // Broadcast to all clients immediately
    const activatedMsg: RunestoneActivatedMessage = {
      type: MessageType.RunestoneActivated,
      runestoneIndex: idx,
    };
    this.broadcast(activatedMsg);

    // Check if ALL runestones are now activated → light up the existing portal
    const allActivated = this.runestones.every((r) => r.activated);
    if (allActivated && !this.portalActivated) {
      this.portalActivated = true;

      if (this.portalPosition) {
        console.info(
          `[Room:${this.id}] All runestones activated! Portal lit up at (${Math.round(this.portalPosition.x)}, ${Math.round(this.portalPosition.y)})`,
        );

        const portalMsg: AllRunestonesActivatedMessage = {
          type: MessageType.AllRunestonesActivated,
          portalX: this.portalPosition.x,
          portalY: this.portalPosition.y,
        };
        this.broadcast(portalMsg);
      } else {
        console.warn(
          `[Room:${this.id}] All runestones activated but the room has no portal position`,
        );
      }
    }
  }

  /** Escape through the active portal after authoritative role/proximity checks. */
  handleEscapePortal(playerId: string, _msg: EscapePortalMessage): void {
    if (!this.isMatchRunning()) return;
    const player = this.state.players.find((candidate) => candidate.id === playerId);
    if (
      !player ||
      player.role !== 'survivor' ||
      player.escaped ||
      !this.portalActivated ||
      !this.portalPosition ||
      !isWithinPortalInteractionRange(player, this.portalPosition)
    ) {
      return;
    }

    player.escaped = true;
    this.clearQueuedInputs(player);
    this.bridgeTraversals.delete(playerId);
    this.bridgeRepairOccupancy.delete(playerId);
    this.syncMatchCounts();

    const remainingToEscape = getRemainingSurvivorsToEscape(
      this.state.match.escapedCount,
      this.state.players.filter((candidate) => candidate.role === 'survivor').length,
    );
    const escapedMessage: PlayerEscapedMessage = {
      type: MessageType.PlayerEscaped,
      playerId,
      displayName: player.displayName,
      portalX: this.portalPosition.x,
      portalY: this.portalPosition.y,
      escapedCount: this.state.match.escapedCount,
      escapeThreshold: this.state.match.escapeThreshold,
      remainingToEscape,
    };
    this.broadcast(escapedMessage);
    console.info(
      `[Room:${this.id}] ${player.displayName} escaped via portal; ${remainingToEscape} more needed`,
    );

    this.checkSurvivorVictory();
  }

  /** Open one nearby shared chest, rewarding survivors while wardens destroy it. */
  handleOpenChest(playerId: string, msg: OpenChestMessage): void {
    if (!this.canPlayerAct(playerId)) return;
    if (!Number.isInteger(msg.chestIndex)) return;
    const placement = this.chestDeadEnds[msg.chestIndex];
    const state = this.chestStates[msg.chestIndex];
    if (!placement || !state || state.opened) return;

    const player = this.state.players.find((candidate) => candidate.id === playerId);
    const ws = this.sockets.get(playerId);
    if (!player || !ws) return;

    const rewardedWisdomOrbs =
      player.role === 'survivor' ? getChestWisdomOrbReward(player.wisdomOrbs) : null;
    if (player.role === 'survivor' && rewardedWisdomOrbs === null) return;

    const interaction = getChestInteractionPoint(placement, this.map.tileSize);
    const dx = player.x - interaction.x;
    const dy = player.y - interaction.y;
    if (dx * dx + dy * dy > CHEST_INTERACTION_RANGE * CHEST_INTERACTION_RANGE) return;

    state.opened = true;
    if (rewardedWisdomOrbs !== null) player.wisdomOrbs = rewardedWisdomOrbs;

    const openedMessage: ChestOpenedMessage = {
      type: MessageType.ChestOpened,
      chestIndex: msg.chestIndex,
      playerId,
    };
    this.broadcast(openedMessage);

    if (rewardedWisdomOrbs !== null) {
      const rewardMessage: WisdomOrbGrantedMessage = {
        type: MessageType.WisdomOrbGranted,
        chestIndex: msg.chestIndex,
        wisdomOrbs: player.wisdomOrbs,
      };
      this.send(ws, rewardMessage);
    }

    console.info(
      rewardedWisdomOrbs === null
        ? `[Room:${this.id}] Chest ${msg.chestIndex} destroyed by warden ${playerId}`
        : `[Room:${this.id}] Chest ${msg.chestIndex} opened by ${playerId}; ${player.wisdomOrbs} wisdom orb(s)`,
    );
  }

  /** Latch one nearby gate button when requested by a warden. */
  handlePressPressurePlate(playerId: string, msg: PressPressurePlateMessage): void {
    if (!this.canPlayerAct(playerId)) return;
    if (!Number.isInteger(msg.plateId)) return;

    const player = this.state.players.find((candidate) => candidate.id === playerId);
    const plate = this.pressurePlates.find((candidate) => candidate.id === msg.plateId);
    if (!player || player.role !== 'warden' || !plate) return;
    if (
      this.gateNeedsRelease[plate.gateIndex] ||
      this.manuallyPressedPlateIds.has(plate.id)
    ) {
      return;
    }

    const plateCenterX = (plate.tileX + 0.5) * this.map.tileSize;
    const plateCenterY = (plate.tileY + 0.5) * this.map.tileSize;
    const dx = player.x - plateCenterX;
    const dy = player.y - plateCenterY;
    const interactionRangeSq =
      PRESSURE_PLATE_INTERACTION_RANGE * PRESSURE_PLATE_INTERACTION_RANGE;
    if (dx * dx + dy * dy > interactionRangeSq) return;

    this.manuallyPressedPlateIds.add(plate.id);
    const plateState = this.pressurePlateStates.find(
      (candidate) => candidate.plateId === plate.id,
    );
    if (plateState) {
      plateState.pressed = true;
      plateState.latched = true;
    }

    console.info(
      `[Room:${this.id}] Warden ${playerId} latched pressure plate ${plate.id} for gate ${plate.gateIndex}`,
    );
  }

  /** Latch one nearby spike-gate plate when requested by a warden. */
  handlePressSpikePlate(playerId: string, msg: PressSpikePlateMessage): void {
    if (!this.canPlayerAct(playerId)) return;
    if (!Number.isInteger(msg.spikePlateIndex)) return;

    const player = this.state.players.find((candidate) => candidate.id === playerId);
    const obstacleIndex = Math.floor(msg.spikePlateIndex / SPIKE_PLATES_PER_OBSTACLE);
    const placement = this.spikeGateObstacles[obstacleIndex];
    const plate: SpikePlatePlacement | undefined = placement
      ? getSpikeGatePlatePlacements(placement, obstacleIndex, this.map.tileSize).find(
          (candidate) => candidate.spikePlateIndex === msg.spikePlateIndex,
        )
      : undefined;
    if (!player || player.role !== 'warden' || !plate) return;

    const spikeGateIndex = getSpikeGateStateIndex(obstacleIndex, plate.gateIndex);
    if (
      this.spikeGateCloseDeadlines[spikeGateIndex] !== null ||
      this.spikeGateNeedsRelease[spikeGateIndex] ||
      this.manuallyPressedSpikePlateIndices.has(plate.spikePlateIndex)
    ) {
      return;
    }

    const plateCenterX = plate.x + plate.width / 2;
    const plateCenterY = plate.y + plate.height / 2;
    const dx = player.x - plateCenterX;
    const dy = player.y - plateCenterY;
    const interactionRangeSq =
      PRESSURE_PLATE_INTERACTION_RANGE * PRESSURE_PLATE_INTERACTION_RANGE;
    if (dx * dx + dy * dy > interactionRangeSq) return;

    this.manuallyPressedSpikePlateIndices.add(plate.spikePlateIndex);
    const plateState = this.spikePlateStates[plate.spikePlateIndex];
    if (plateState) {
      plateState.pressed = true;
      plateState.latched = true;
    }

    console.info(
      `[Room:${this.id}] Warden ${playerId} latched spike plate ${plate.spikePlateIndex} for spike gate ${spikeGateIndex}`,
    );
  }

  /** Fire the shared trap network from one nearby trap cell as a warden. */
  handleActivateTrapCell(playerId: string, msg: ActivateTrapCellMessage): void {
    if (!this.canPlayerAct(playerId)) return;
    if (!Number.isInteger(msg.trapCellIndex)) return;
    const player = this.state.players.find((candidate) => candidate.id === playerId);
    const placement = this.trapCells[msg.trapCellIndex];
    if (!player || player.role !== 'warden' || !placement) return;

    const nearby = findTrapCellInteractionTarget(
      [placement],
      player.x,
      player.y,
      this.map.tileSize,
    );
    if (!nearby) return;

    let capturedCount = 0;
    const spawnedCages: CageState[] = [];
    for (const survivor of this.state.players) {
      if (survivor.role !== 'survivor' || !survivor.connected) continue;
      if (findActivePlayerCage(this.cageStates, survivor.id)) continue;
      const occupiedTrapCell = this.trapCells.find((trapCell) =>
        isPlayerInTrapCell(trapCell, survivor.x, survivor.y, this.map.tileSize),
      );
      if (!occupiedTrapCell) continue;

      // Re-capturing the same survivor in the same trap cell replaces their
      // vacated cage instead of accumulating permanent duplicate colliders.
      for (let cageIndex = this.cageStates.length - 1; cageIndex >= 0; cageIndex--) {
        const previousCage = this.cageStates[cageIndex];
        if (
          previousCage.prisonerPlayerId === survivor.id &&
          isPlayerInTrapCell(
            occupiedTrapCell,
            previousCage.x,
            previousCage.y,
            this.map.tileSize,
          )
        ) {
          this.cageStates.splice(cageIndex, 1);
        }
      }

      this.clearQueuedInputs(survivor);
      this.bridgeTraversals.delete(survivor.id);
      this.bridgeRepairOccupancy.delete(survivor.id);
      const cage: CageState = {
        cageId: this.nextCageId++,
        prisonerPlayerId: survivor.id,
        x: survivor.x,
        y: survivor.y,
        opened: false,
        vacated: false,
      };
      this.cageStates.push(cage);
      spawnedCages.push(cage);
      capturedCount++;
    }

    if (spawnedCages.length > 0) {
      this.moveWardenClearOfSpawnedCages(player, spawnedCages);
    }

    const requesterSocket = this.sockets.get(playerId);
    if (requesterSocket) {
      const result: TrapActivationResultMessage = {
        type: MessageType.TrapActivationResult,
        trapCellIndex: msg.trapCellIndex,
        capturedCount,
      };
      this.send(requesterSocket, result);
    }

    console.info(
      `[Room:${this.id}] Warden ${playerId} fired trap cell ${msg.trapCellIndex}; captured ${capturedCount} survivor(s)`,
    );
  }

  /** Push the activating warden to the nearest legal side of every new cage. */
  private moveWardenClearOfSpawnedCages(
    warden: RoomPlayerInfo,
    spawnedCages: readonly CageState[],
  ): void {
    let moved = false;

    for (let pass = 0; pass <= spawnedCages.length; pass++) {
      let resolvedOverlap = false;
      for (const cage of spawnedCages) {
        const candidates = getCageSeparationPositions(
          cage,
          warden.x,
          warden.y,
          FEET_HITBOX_W,
          FEET_HITBOX_H,
        );
        if (candidates.length === 0) continue;

        const destination = candidates.find((candidate) =>
          isPositionValid(
            candidate.x,
            candidate.y,
            this.map,
            this.portalPosition,
            this.bridges,
            this.bridgeStates,
            this.chestDeadEnds,
            this.swordFields,
            this.swordFieldStates,
            this.cageStates,
            warden.id,
            this.tIntersectionDecorations,
            this.decoratedVerticalPassages,
            this.spikeGateObstacles,
            this.spikeGateStates,
          ),
        );
        if (!destination) continue;

        warden.x = destination.x;
        warden.y = destination.y;
        moved = true;
        resolvedOverlap = true;
        break;
      }
      if (!resolvedOverlap) break;
    }

    if (!moved) return;
    this.clearQueuedInputs(warden);
    this.bridgeTraversals.delete(warden.id);
    this.bridgeRepairOccupancy.delete(warden.id);
  }

  /** Open a nearby prisoner's cage; the prisoner cannot open their own gate. */
  handleOpenCage(playerId: string, msg: OpenCageMessage): void {
    if (!this.canPlayerAct(playerId)) return;
    if (!Number.isInteger(msg.cageId)) return;
    const player = this.state.players.find((candidate) => candidate.id === playerId);
    const cage = this.cageStates.find((candidate) => candidate.cageId === msg.cageId);
    if (!player || !cage || findActivePlayerCage(this.cageStates, playerId)) return;
    if (!findOpenableCage([cage], playerId, player.x, player.y)) return;

    cage.opened = true;
    console.info(
      `[Room:${this.id}] Player ${playerId} opened cage ${cage.cageId} for ${cage.prisonerPlayerId}`,
    );
  }

  // ── Game Loop ─────────────────────────────────────────────────────────

  /** Handle survivor wisdom use or a warden's orb-free nearby sword clear. */
  handleUseWisdomOrb(playerId: string): void {
    if (!this.canPlayerAct(playerId)) return;
    console.info(`[Room:${this.id}][WisdomOrb] USE request from ${playerId}`);

    const player = this.state.players.find((p) => p.id === playerId);
    if (!player) {
      console.warn(
        `[Room:${this.id}][WisdomOrb] REJECTED: player ${playerId} not found in state (${this.state.players.length} players)`,
      );
      return;
    }
    const ws = this.sockets.get(playerId);
    if (!ws) {
      console.warn(
        `[Room:${this.id}][WisdomOrb] REJECTED: socket not found for player ${playerId}`,
      );
      return;
    }

    const swordFieldTarget = findSwordFieldWisdomTarget(
      this.swordFields,
      this.swordFieldStates,
      player.x,
      player.y,
      this.map.tileSize,
    );
    if (swordFieldTarget) {
      const swordFieldState = this.swordFieldStates[swordFieldTarget.swordFieldIndex];
      if (!swordFieldState) return;
      if (player.role === 'survivor' && player.wisdomOrbs <= 0) {
        console.warn(
          `[Room:${this.id}][SwordField] REJECTED: survivor ${playerId} has 0 orbs remaining`,
        );
        return;
      }

      if (player.role === 'survivor') player.wisdomOrbs--;
      swordFieldState.loweringStartedTick = this.state.tick;
      const orbUsedMsg: WisdomOrbUsedMessage = {
        type: MessageType.WisdomOrbUsed,
        hint: {
          kind: 'sword-field',
          swordFieldIndex: swordFieldTarget.swordFieldIndex,
        },
        remainingWisdomOrbs: player.wisdomOrbs,
      };
      this.send(ws, orbUsedMsg);
      console.info(
        player.role === 'warden'
          ? `[Room:${this.id}][SwordField] SUCCESS: warden ${playerId} lowered sword field ${swordFieldTarget.swordFieldIndex} without consuming an orb`
          : `[Room:${this.id}][WisdomOrb] SUCCESS: ${playerId} began lowering sword field ${swordFieldTarget.swordFieldIndex} (${player.wisdomOrbs} remaining)`,
      );
      return;
    }

    if (player.role === 'warden') {
      console.warn(
        `[Room:${this.id}][WisdomOrb] REJECTED: ${playerId} is a warden with no nearby sword field`,
      );
      return;
    }
    if (player.wisdomOrbs <= 0) {
      console.warn(
        `[Room:${this.id}][WisdomOrb] REJECTED: player ${playerId} has 0 orbs remaining`,
      );
      return;
    }

    const bridgeHintTarget = findBridgeWisdomHintTarget(
      this.bridges,
      player.x,
      player.y,
      this.map.tileSize,
    );
    if (bridgeHintTarget) {
      const bridge = this.bridges[bridgeHintTarget.bridgeIndex];
      const revealedBridges = this.revealedWisdomBridges.get(playerId);
      if (!revealedBridges?.has(bridgeHintTarget.bridgeIndex)) {
        player.wisdomOrbs--;
        revealedBridges?.add(bridgeHintTarget.bridgeIndex);
        const orbUsedMsg: WisdomOrbUsedMessage = {
          type: MessageType.WisdomOrbUsed,
          hint: {
            kind: 'bridge',
            bridgeIndex: bridgeHintTarget.bridgeIndex,
            entrySide: bridgeHintTarget.entrySide,
            safeTileMask: bridge.safeTileMask,
          },
          remainingWisdomOrbs: player.wisdomOrbs,
        };
        this.send(ws, orbUsedMsg);
        console.info(
          `[Room:${this.id}][WisdomOrb] SUCCESS: ${playerId} -> private bridge ${bridgeHintTarget.bridgeIndex} route from ${bridgeHintTarget.entrySide} (${player.wisdomOrbs} remaining)`,
        );
        return;
      }

      console.info(
        `[Room:${this.id}][WisdomOrb] Bridge ${bridgeHintTarget.bridgeIndex} is already revealed to ${playerId}; using directional guidance instead`,
      );
    }

    if (!bridgeHintTarget) {
      const swampHintTarget = findSwampWisdomHintTarget(
        this.swamps,
        player.x,
        player.y,
        this.map.tileSize,
      );
      if (swampHintTarget) {
        const revealedSwamps = this.revealedWisdomSwamps.get(playerId);
        if (!revealedSwamps?.has(swampHintTarget.swampIndex)) {
          player.wisdomOrbs--;
          revealedSwamps?.add(swampHintTarget.swampIndex);
          const orbUsedMsg: WisdomOrbUsedMessage = {
            type: MessageType.WisdomOrbUsed,
            hint: {
              kind: 'swamp',
              swampIndex: swampHintTarget.swampIndex,
            },
            remainingWisdomOrbs: player.wisdomOrbs,
          };
          this.send(ws, orbUsedMsg);
          console.info(
            `[Room:${this.id}][WisdomOrb] SUCCESS: ${playerId} -> private swamp ${swampHintTarget.swampIndex} firm-ground route (${player.wisdomOrbs} remaining)`,
          );
          return;
        }

        console.info(
          `[Room:${this.id}][WisdomOrb] Swamp ${swampHintTarget.swampIndex} is already revealed to ${playerId}; using directional guidance instead`,
        );
      }
    }

    const activeTarget = this.portalActivated ? 'portal' : 'hub';
    const activeDistanceField = this.portalActivated
      ? this.portalDistanceField
      : this.hubDistanceField;
    if (!activeDistanceField) {
      console.warn(
        `[Room:${this.id}][WisdomOrb] REJECTED: no distance field available (target=${activeTarget}, portalPos=${JSON.stringify(this.portalPosition)}, portalField=${!!this.portalDistanceField}, hubField=${!!this.hubDistanceField})`,
      );
      return;
    }

    console.info(
      `[Room:${this.id}][WisdomOrb] Computing direction for player at (${player.x.toFixed(1)}, ${player.y.toFixed(1)}), target=${activeTarget}`,
    );
    const feetTileX = Math.floor(player.x / this.map.tileSize);
    const feetTileY = Math.floor((player.y - 1) / this.map.tileSize);
    const tileIndex = feetTileY * this.map.width + feetTileX;
    const tileId = this.map.data[tileIndex];
    const tileDist = activeDistanceField.tileDistances[tileIndex];
    console.info(
      `[Room:${this.id}][WisdomOrb] Feet tile: (${feetTileX}, ${feetTileY}), tileId=${tileId}, tileDistance=${tileDist}`,
    );

    const direction = getNavigationDirectionForPosition(
      player.x,
      player.y,
      this.map,
      activeDistanceField,
    );
    if (!direction) {
      console.warn(
        `[Room:${this.id}][WisdomOrb] REJECTED: getNavigationDirectionForPosition returned null for player at (${player.x.toFixed(1)}, ${player.y.toFixed(1)}), tile (${feetTileX}, ${feetTileY}), tileId=${tileId}, tileDistance=${tileDist}`,
      );
      return;
    }

    player.wisdomOrbs--;

    const orbUsedMsg: WisdomOrbUsedMessage = {
      type: MessageType.WisdomOrbUsed,
      hint: { kind: 'direction', direction },
      remainingWisdomOrbs: player.wisdomOrbs,
    };
    this.send(ws, orbUsedMsg);

    console.info(
      `[Room:${this.id}][WisdomOrb] SUCCESS: ${playerId} -> ${direction} toward ${activeTarget} (${player.wisdomOrbs} remaining)`,
    );
  }

  private startLoop(): void {
    if (this.loopHandle !== null) return;

    console.info(`[Room:${this.id}] Game loop started (${1000 / SERVER_TICK_MS} tps)`);

    this.loopHandle = setInterval(() => {
      this.tick();
    }, SERVER_TICK_MS);
  }

  private stopLoop(): void {
    if (this.loopHandle === null) return;

    clearInterval(this.loopHandle);
    this.loopHandle = null;
    console.info(`[Room:${this.id}] Game loop stopped`);
  }

  private tick(): void {
    if (!this.isMatchRunning()) return;
    this.state.tick++;
    this.advanceSwordFields();
    const spikeGatePreviousPositions = new Map(
      this.state.players.map((player) => [
        player.id,
        { x: player.x, y: player.y },
      ] as const),
    );

    for (const player of this.state.players) {
      const queue = this.inputQueues.get(player.id);
      if (!player.connected) {
        this.clearQueuedInputs(player);
        continue;
      }
      if (player.escaped) {
        this.clearQueuedInputs(player);
        continue;
      }
      const activeCage = findActivePlayerCage(this.cageStates, player.id);
      if (activeCage && !activeCage.opened) {
        if (!queue || queue.length === 0) {
          player.isMoving = this.hasRecentMovementIntent(player.id);
          continue;
        }

        // A closed cage blocks position changes, but movement intent still
        // drives the prisoner's facing and walk animation for every client.
        for (const input of queue) {
          player.lastProcessedInput = Math.max(
            player.lastProcessedInput,
            input.sequenceNumber,
          );
        }
        const lastInput = queue[queue.length - 1];
        const hasMovement =
          lastInput.up || lastInput.down || lastInput.left || lastInput.right;
        player.isMoving = hasMovement;
        if (hasMovement) player.facing = deriveFacingDirection(lastInput, player.facing);
        queue.length = 0;
        continue;
      }
      if (!queue || queue.length === 0) {
        player.isMoving = this.hasRecentMovementIntent(player.id);
        continue;
      }

      for (const input of queue) {
        const constrainedInput = activeCage
          ? { ...input, left: false, right: false }
          : input;
        const previousX = player.x;
        const previousY = player.y;
        // Use client-provided dt, clamped for anti-cheat safety
        const dt = Math.min(Math.max(input.dt, 0), 0.1);
        const result = applyInputWithCollision(
          player.x,
          player.y,
          constrainedInput,
          dt,
          this.map,
          this.portalPosition,
          this.bridges,
          this.bridgeStates,
          this.swamps,
          this.chestDeadEnds,
          this.swordFields,
          this.swordFieldStates,
          this.cageStates,
          player.id,
          this.tIntersectionDecorations,
          this.decoratedVerticalPassages,
          this.spikeGateObstacles,
          this.spikeGateStates,
        );
        player.x = result.x;
        player.y = result.y;
        this.updateBridgeInteractions(player, previousX, previousY);

        if (
          activeCage &&
          !activeCage.vacated &&
          hasPrisonerExitedCage(activeCage, player.y)
        ) {
          activeCage.vacated = true;
          console.info(
            `[Room:${this.id}] ${player.id} escaped cage ${activeCage.cageId}; cage is now solid`,
          );
        }

        if (input.sequenceNumber > player.lastProcessedInput) {
          player.lastProcessedInput = input.sequenceNumber;
        }
      }

      // Derive facing & isMoving from the LAST input in the queue
      const queuedLastInput = queue[queue.length - 1];
      const lastInput =
        activeCage && queuedLastInput
          ? { ...queuedLastInput, left: false, right: false }
          : queuedLastInput;
      if (!lastInput) {
        player.isMoving = false;
        continue;
      }
      const hasMovement =
        lastInput.up || lastInput.down || lastInput.left || lastInput.right;
      player.isMoving = hasMovement;

      if (hasMovement) {
        player.facing = deriveFacingDirection(lastInput, player.facing);
      }

      queue.length = 0;
    }

    this.advanceBridgeFailureFeedbacks();
    this.advanceBridgeRepairs();

    // ── Pressure plate / gate logic ──────────────────────────────────────
    this.updateGateStates();
    this.updateSpikeGateStates(spikeGatePreviousPositions);

    // Fast clients receive the full 20 Hz stream. Slow clients pause at a tiny
    // bounded in-flight window and later resume from the newest full state.
    if (this.state.tick % SERVER_TICKS_PER_SNAPSHOT === 0) {
      this.broadcastSnapshot();
    }
  }

  private advanceSwordFields(): void {
    for (const state of this.swordFieldStates) {
      if (state.cleared || state.loweringStartedTick === null) continue;
      const elapsedMs = (this.state.tick - state.loweringStartedTick) * SERVER_TICK_MS;
      if (elapsedMs < SWORD_FIELD_LOWER_DURATION_MS) continue;
      state.cleared = true;
      console.info(
        `[Room:${this.id}] Sword field ${state.swordFieldIndex} lowered; central collider removed`,
      );
    }
  }

  private getPlayerFeetCenter(player: Pick<PlayerInfo, 'x' | 'y'>): {
    x: number;
    y: number;
  } {
    return { x: player.x, y: player.y - FEET_HITBOX_H / 2 };
  }

  private updateBridgeInteractions(
    player: RoomPlayerInfo,
    previousX: number,
    previousY: number,
  ): void {
    const feet = this.getPlayerFeetCenter(player);
    let repairKey: string | null = null;

    for (let bridgeIndex = 0; bridgeIndex < this.bridges.length; bridgeIndex++) {
      const bridge = this.bridges[bridgeIndex];
      const circle = getBridgeRepairCircleBounds(bridge, this.map.tileSize).find(
        (bounds) =>
          feet.x >= bounds.left &&
          feet.x <= bounds.right &&
          feet.y >= bounds.top &&
          feet.y <= bounds.bottom,
      );
      if (!circle) continue;

      repairKey = `${bridgeIndex}:${circle.side}`;
      if (this.bridgeRepairOccupancy.get(player.id) !== repairKey) {
        const bridgeState = this.bridgeStates[bridgeIndex];
        if (bridgeState.repairingSide === null && bridgeState.collapsedTileMask !== 0) {
          this.startBridgeRepair(bridgeIndex, circle.side, player.id);
        } else if (bridgeState.repairingSide !== null && !bridgeState.repairActive) {
          this.resumeBridgeRepair(bridgeIndex, circle.side, player.id);
        }
      }
      break;
    }

    if (repairKey === null) {
      this.bridgeRepairOccupancy.delete(player.id);
    } else {
      this.bridgeRepairOccupancy.set(player.id, repairKey);
    }

    let currentBridgeIndex = -1;
    let currentTile: ReturnType<typeof getBridgeWalkwayTileAtPoint> = null;
    for (let bridgeIndex = 0; bridgeIndex < this.bridges.length; bridgeIndex++) {
      const tile = getBridgeWalkwayTileAtPoint(
        this.bridges[bridgeIndex],
        feet.x,
        feet.y,
        this.map.tileSize,
      );
      if (!tile) continue;
      currentBridgeIndex = bridgeIndex;
      currentTile = tile;
      break;
    }

    if (currentBridgeIndex < 0 || !currentTile) {
      this.bridgeTraversals.delete(player.id);
      return;
    }

    if (this.bridgeStates[currentBridgeIndex].repairingSide !== null) {
      this.bridgeTraversals.delete(player.id);
      return;
    }

    const bridge = this.bridges[currentBridgeIndex];
    let traversal = this.bridgeTraversals.get(player.id);
    if (!traversal || traversal.bridgeIndex !== currentBridgeIndex) {
      const firstRow = getBridgeWalkwayTileBounds(bridge, 0, 0, this.map.tileSize);
      const lastRow = getBridgeWalkwayTileBounds(
        bridge,
        BRIDGE_WALKWAY_ROWS - 1,
        0,
        this.map.tileSize,
      );
      const previousFeetY = previousY - FEET_HITBOX_H / 2;
      let entrySide: BridgeEntrySide;
      if (previousFeetY < firstRow.top) {
        entrySide = 'north';
      } else if (previousFeetY > lastRow.bottom) {
        entrySide = 'south';
      } else if (player.y < previousY) {
        entrySide = 'south';
      } else if (player.y > previousY) {
        entrySide = 'north';
      } else {
        entrySide = currentTile.row < BRIDGE_WALKWAY_ROWS / 2 ? 'north' : 'south';
      }
      traversal = {
        bridgeIndex: currentBridgeIndex,
        entrySide,
        lastTileMask: 0,
        completed: false,
      };
      this.bridgeTraversals.set(player.id, traversal);
    }

    const tileMask = getBridgeWalkwayTileMaskAtFeetCenter(
      bridge,
      feet.x,
      feet.y,
      FEET_HITBOX_W,
      this.map.tileSize,
    );
    if (tileMask === 0 || tileMask === traversal.lastTileMask) return;

    const safe = (tileMask & ~bridge.safeTileMask) === 0;
    const destinationRow = traversal.entrySide === 'north' ? BRIDGE_WALKWAY_ROWS - 1 : 0;
    if (safe && currentTile.row === destinationRow) {
      traversal.completed = true;
    } else if (
      !safe &&
      !traversal.completed &&
      this.bridgeStates[currentBridgeIndex].collapsedTileMask === 0
    ) {
      const direction = traversal.entrySide === 'north' ? 'south' : 'north';
      const wrongTileMask = tileMask & ~bridge.safeTileMask;
      let wrongColumn = currentTile.column;
      if ((wrongTileMask & getBridgeTileBit(currentTile.row, wrongColumn)) === 0) {
        wrongColumn =
          Array.from({ length: BRIDGE_WALKWAY_COLUMNS }, (_, column) => column).find(
            (column) => (wrongTileMask & getBridgeTileBit(currentTile.row, column)) !== 0,
          ) ?? wrongColumn;
      }
      this.triggerBridgeFailure(
        currentBridgeIndex,
        currentTile.row,
        wrongColumn,
        direction,
        player.id,
      );
    }
    traversal.lastTileMask = tileMask;
  }

  private triggerBridgeFailure(
    bridgeIndex: number,
    failedRow: number,
    failedColumn: number,
    direction: 'north' | 'south',
    triggeringPlayerId: string,
  ): void {
    const bridgeState = this.bridgeStates[bridgeIndex];
    if (!bridgeState || bridgeState.collapsedTileMask !== 0) return;

    bridgeState.wrongTileIndex = failedRow * BRIDGE_WALKWAY_COLUMNS + failedColumn;
    this.bridgeFailureFeedbackExpirations.set(
      bridgeIndex,
      Date.now() + BRIDGE_FAILURE_FEEDBACK_DURATION_MS,
    );
    this.collapseBridge(bridgeIndex, failedRow, direction, triggeringPlayerId);
  }

  private advanceBridgeFailureFeedbacks(): void {
    const now = Date.now();
    for (const [bridgeIndex, expiresAtMs] of this.bridgeFailureFeedbackExpirations) {
      if (now < expiresAtMs) continue;
      this.bridgeFailureFeedbackExpirations.delete(bridgeIndex);
      const bridgeState = this.bridgeStates[bridgeIndex];
      if (bridgeState) bridgeState.wrongTileIndex = null;
    }
  }

  private collapseBridge(
    bridgeIndex: number,
    failedRow: number,
    direction: 'north' | 'south',
    triggeringPlayerId: string,
  ): void {
    const collapsedTileMask = getBridgeCollapseMask(failedRow, direction);
    if (collapsedTileMask === 0) return;
    const terminalFailure =
      (direction === 'north' && failedRow === 0) ||
      (direction === 'south' && failedRow === BRIDGE_WALKWAY_ROWS - 1);

    const bridgeState = this.bridgeStates[bridgeIndex];
    if (!bridgeState || bridgeState.collapsedTileMask !== 0) return;
    bridgeState.collapsedTileMask = collapsedTileMask;
    bridgeState.repairingSide = null;
    bridgeState.repairActive = false;
    bridgeState.repairingPlayerId = null;
    bridgeState.repairStartedTick = null;
    bridgeState.repairInitialCollapsedTileMask = 0;
    this.bridgeRepairs.delete(bridgeIndex);

    const bridge = this.bridges[bridgeIndex];
    let triggeringPlayerReturned = false;
    for (const player of this.state.players) {
      if (!this.playerOverlapsBridgeMask(player, bridge, collapsedTileMask)) continue;
      if (terminalFailure && player.id === triggeringPlayerId) {
        this.returnPlayerToPreviousBridgeRow(player, bridgeIndex, failedRow, direction);
      } else {
        this.returnPlayerToBridgeEntry(player, bridgeIndex);
      }
      if (player.id === triggeringPlayerId) triggeringPlayerReturned = true;
    }

    if (terminalFailure && !triggeringPlayerReturned) {
      const triggeringPlayer = this.state.players.find(
        (player) => player.id === triggeringPlayerId,
      );
      if (triggeringPlayer) {
        this.returnPlayerToPreviousBridgeRow(
          triggeringPlayer,
          bridgeIndex,
          failedRow,
          direction,
        );
      }
    }

    console.info(
      `[Room:${this.id}] Bridge ${bridgeIndex} collapsed ${direction} of row ${failedRow} after ${triggeringPlayerId} stepped off-path`,
    );
  }

  private startBridgeRepair(
    bridgeIndex: number,
    side: BridgeEntrySide,
    repairingPlayerId: string,
  ): void {
    const bridgeState = this.bridgeStates[bridgeIndex];
    if (
      !bridgeState ||
      bridgeState.collapsedTileMask === 0 ||
      bridgeState.repairingSide !== null
    ) {
      return;
    }

    const repair: BridgeRepairProgress = {
      startedTick: this.state.tick,
      activeElapsedMs: 0,
      lastUpdatedAtMs: Date.now(),
      initialCollapsedTileMask: bridgeState.collapsedTileMask,
      orderSide: side,
      channelSide: side,
      repairingPlayerId,
      startedByPlayerId: repairingPlayerId,
    };
    this.bridgeRepairs.set(bridgeIndex, repair);
    bridgeState.repairingSide = side;
    bridgeState.repairActive = true;
    bridgeState.repairingPlayerId = repairingPlayerId;
    bridgeState.repairStartedTick = repair.startedTick;
    bridgeState.repairInitialCollapsedTileMask = repair.initialCollapsedTileMask;
    bridgeState.collapsedTileMask = getBridgeRepairCollapsedMask(
      repair.initialCollapsedTileMask,
      repair.orderSide,
      0,
    );

    const bridge = this.bridges[bridgeIndex];
    for (const player of this.state.players) {
      const feet = this.getPlayerFeetCenter(player);
      if (getBridgeWalkwayTileAtPoint(bridge, feet.x, feet.y, this.map.tileSize)) {
        this.returnPlayerToBridgeEntry(player, bridgeIndex);
      }
    }

    for (const [playerId, traversal] of this.bridgeTraversals) {
      if (traversal.bridgeIndex === bridgeIndex) this.bridgeTraversals.delete(playerId);
    }

    console.info(
      `[Room:${this.id}] Bridge ${bridgeIndex} repair started from ${side} by ${repairingPlayerId}`,
    );
  }

  private resumeBridgeRepair(
    bridgeIndex: number,
    side: BridgeEntrySide,
    repairingPlayerId: string,
  ): void {
    const bridgeState = this.bridgeStates[bridgeIndex];
    const repair = this.bridgeRepairs.get(bridgeIndex);
    if (!bridgeState || !repair || bridgeState.repairActive) return;

    repair.repairingPlayerId = repairingPlayerId;
    repair.channelSide = side;
    repair.lastUpdatedAtMs = Date.now();
    bridgeState.repairingSide = side;
    bridgeState.repairActive = true;
    bridgeState.repairingPlayerId = repairingPlayerId;
    console.info(
      `[Room:${this.id}] Bridge ${bridgeIndex} repair resumed from ${side} by ${repairingPlayerId}`,
    );
  }

  private advanceBridgeRepairs(): void {
    for (const [bridgeIndex, repair] of this.bridgeRepairs) {
      const bridgeState = this.bridgeStates[bridgeIndex];
      if (!bridgeState) {
        this.bridgeRepairs.delete(bridgeIndex);
        continue;
      }

      const now = Date.now();
      const repairingPlayer = repair.repairingPlayerId
        ? this.state.players.find((player) => player.id === repair.repairingPlayerId)
        : null;
      if (
        bridgeState.repairActive &&
        (!repairingPlayer ||
          !repairingPlayer.connected ||
          !this.isPlayerOnBridgeRepairCircle(
            repairingPlayer,
            bridgeIndex,
            repair.channelSide,
          ))
      ) {
        bridgeState.repairActive = false;
        bridgeState.repairingPlayerId = null;
        repair.repairingPlayerId = null;
        console.info(`[Room:${this.id}] Bridge ${bridgeIndex} repair paused`);
      } else if (bridgeState.repairActive) {
        repair.activeElapsedMs += Math.max(0, now - repair.lastUpdatedAtMs);
      }
      repair.lastUpdatedAtMs = now;

      bridgeState.collapsedTileMask = getBridgeRepairCollapsedMask(
        repair.initialCollapsedTileMask,
        repair.orderSide,
        repair.activeElapsedMs,
      );
      if (repair.activeElapsedMs < BRIDGE_REPAIR_DURATION_MS) continue;

      bridgeState.collapsedTileMask = 0;
      bridgeState.repairingSide = null;
      bridgeState.repairActive = false;
      bridgeState.repairingPlayerId = null;
      bridgeState.repairStartedTick = null;
      bridgeState.repairInitialCollapsedTileMask = 0;
      this.bridgeRepairs.delete(bridgeIndex);

      const bridge = this.bridges[bridgeIndex];
      for (const player of this.state.players) {
        const feet = this.getPlayerFeetCenter(player);
        if (getBridgeWalkwayTileAtPoint(bridge, feet.x, feet.y, this.map.tileSize)) {
          this.returnPlayerToBridgeEntry(player, bridgeIndex);
        }
      }
      for (const [playerId, traversal] of this.bridgeTraversals) {
        if (traversal.bridgeIndex === bridgeIndex) this.bridgeTraversals.delete(playerId);
      }

      console.info(
        `[Room:${this.id}] Bridge ${bridgeIndex} repair completed after ${BRIDGE_REPAIR_DURATION_MS}ms of channeling (started by ${repair.startedByPlayerId})`,
      );
    }
  }

  private isPlayerOnBridgeRepairCircle(
    player: PlayerInfo,
    bridgeIndex: number,
    side: BridgeEntrySide,
  ): boolean {
    const bridge = this.bridges[bridgeIndex];
    if (!bridge) return false;
    const bounds = getBridgeRepairCircleBounds(bridge, this.map.tileSize).find(
      (circle) => circle.side === side,
    );
    if (!bounds) return false;

    const feet = this.getPlayerFeetCenter(player);
    return (
      feet.x >= bounds.left &&
      feet.x <= bounds.right &&
      feet.y >= bounds.top &&
      feet.y <= bounds.bottom
    );
  }

  private returnPlayerToPreviousBridgeRow(
    player: RoomPlayerInfo,
    bridgeIndex: number,
    failedRow: number,
    direction: 'north' | 'south',
  ): void {
    const bridge = this.bridges[bridgeIndex];
    const returnRow = direction === 'south' ? failedRow - 1 : failedRow + 1;
    const returnPosition = bridge
      ? getBridgeSafeRowFeetCenter(bridge, returnRow, player.x, this.map.tileSize)
      : null;
    if (!returnPosition) {
      this.returnPlayerToBridgeEntry(player, bridgeIndex);
      return;
    }

    this.clearQueuedInputs(player);
    player.x = returnPosition.x;
    player.y = returnPosition.y + FEET_HITBOX_H / 2;
    this.bridgeTraversals.delete(player.id);
    this.bridgeRepairOccupancy.delete(player.id);
  }

  private playerOverlapsBridgeMask(
    player: PlayerInfo,
    bridge: BridgePlacement,
    mask: number,
  ): boolean {
    const left = player.x - FEET_HITBOX_W / 2;
    const top = player.y - FEET_HITBOX_H;
    const right = left + FEET_HITBOX_W - 1;
    const bottom = player.y - 1;

    for (let row = 0; row < BRIDGE_WALKWAY_ROWS; row++) {
      for (let column = 0; column < BRIDGE_WALKWAY_COLUMNS; column++) {
        if ((mask & getBridgeTileBit(row, column)) === 0) continue;
        const tile = getBridgeWalkwayTileBounds(bridge, row, column, this.map.tileSize);
        if (
          left <= tile.right &&
          right >= tile.left &&
          top <= tile.bottom &&
          bottom >= tile.top
        ) {
          return true;
        }
      }
    }
    return false;
  }

  private returnPlayerToBridgeEntry(player: RoomPlayerInfo, bridgeIndex: number): void {
    const bridge = this.bridges[bridgeIndex];
    const traversal = this.bridgeTraversals.get(player.id);
    let entrySide = traversal?.bridgeIndex === bridgeIndex ? traversal.entrySide : null;
    if (!entrySide) {
      const first = getBridgeWalkwayTileBounds(bridge, 0, 0, this.map.tileSize);
      const last = getBridgeWalkwayTileBounds(
        bridge,
        BRIDGE_WALKWAY_ROWS - 1,
        0,
        this.map.tileSize,
      );
      const midpoint = (first.top + last.bottom) / 2;
      entrySide = this.getPlayerFeetCenter(player).y <= midpoint ? 'north' : 'south';
    }

    const returnPosition = getBridgeBankReturnPosition(
      bridge,
      entrySide,
      this.map.tileSize,
    );
    this.clearQueuedInputs(player);
    player.x = returnPosition.x;
    player.y = returnPosition.y;
    this.bridgeTraversals.delete(player.id);
    this.bridgeRepairOccupancy.delete(player.id);
  }

  /**
   * Update physical and manually latched gate-button activation.
   * - Physical occupancy is role-agnostic and retains the original hold-to-open rules.
   * - A manual warden latch opens the gate for five seconds when its side is complete.
   */
  private updateGateStates(): void {
    const now = Date.now();

    for (let gateIndex = 0; gateIndex < this.gates.length; gateIndex++) {
      const gatePlates = this.pressurePlates.filter((p) => p.gateIndex === gateIndex);
      const spawnPlates = gatePlates.filter((p) => p.side === 'spawn');
      const hubPlates = gatePlates.filter((p) => p.side === 'hub');

      const occupiedPlateIds = new Set<number>();
      const playersOnSpawnPlates = new Set<string>();
      let playerOnHubPlate = false;
      for (const plate of gatePlates) {
        for (const player of this.state.players) {
          if (!player.connected) continue;
          if (
            isPlayerOnPlate(
              player.x,
              player.y,
              plate.tileX,
              plate.tileY,
              this.map.tileSize,
            )
          ) {
            occupiedPlateIds.add(plate.id);
            if (plate.side === 'spawn') {
              playersOnSpawnPlates.add(player.id);
            } else {
              playerOnHubPlate = true;
            }
          }
        }
      }

      const closeDeadline = this.gateCloseDeadlines[gateIndex];
      if (closeDeadline !== null) {
        if (now >= closeDeadline) {
          for (const plate of gatePlates) {
            this.manuallyPressedPlateIds.delete(plate.id);
            const plateState = this.pressurePlateStates.find(
              (candidate) => candidate.plateId === plate.id,
            );
            if (plateState) {
              plateState.pressed = false;
              plateState.latched = false;
            }
          }
          this.gateCloseDeadlines[gateIndex] = null;
          this.gateNeedsRelease[gateIndex] = occupiedPlateIds.size > 0;
          this.setGateOpen(gateIndex, false);
          console.info(
            `[Room:${this.id}] Gate ${gateIndex} CLOSED after ${GATE_OPEN_DURATION_MS}ms; buttons reset`,
          );
        } else {
          for (const plate of gatePlates) {
            const latched = this.manuallyPressedPlateIds.has(plate.id);
            const plateState = this.pressurePlateStates.find(
              (candidate) => candidate.plateId === plate.id,
            );
            if (plateState) {
              plateState.pressed = latched || occupiedPlateIds.has(plate.id);
              plateState.latched = latched;
            }
          }
        }
        continue;
      }

      if (this.gateNeedsRelease[gateIndex]) {
        if (occupiedPlateIds.size === 0) {
          this.gateNeedsRelease[gateIndex] = false;
        }
        continue;
      }

      const activePlateIds = new Set(occupiedPlateIds);
      for (const plate of gatePlates) {
        if (this.manuallyPressedPlateIds.has(plate.id)) activePlateIds.add(plate.id);
        const plateState = this.pressurePlateStates.find(
          (candidate) => candidate.plateId === plate.id,
        );
        if (plateState) {
          plateState.pressed = activePlateIds.has(plate.id);
          plateState.latched = this.manuallyPressedPlateIds.has(plate.id);
        }
      }

      const spawnButtonsComplete =
        spawnPlates.length > 0 &&
        spawnPlates.every((plate) => activePlateIds.has(plate.id));
      const hubButtonActive = hubPlates.some((plate) => activePlateIds.has(plate.id));
      const manualSpawnActivation =
        spawnButtonsComplete &&
        spawnPlates.some((plate) => this.manuallyPressedPlateIds.has(plate.id));
      const manualHubActivation =
        hubButtonActive &&
        hubPlates.some((plate) => this.manuallyPressedPlateIds.has(plate.id));

      if (manualSpawnActivation || manualHubActivation) {
        this.gateCloseDeadlines[gateIndex] = now + GATE_OPEN_DURATION_MS;
        this.setGateOpen(gateIndex, true);
        console.info(
          `[Room:${this.id}] Gate ${gateIndex} OPENED for ${GATE_OPEN_DURATION_MS}ms by a warden latch`,
        );
        continue;
      }

      const physicallyActivated = playersOnSpawnPlates.size >= 2 || playerOnHubPlate;
      if (physicallyActivated !== this.gateOpenStates[gateIndex]) {
        this.setGateOpen(gateIndex, physicallyActivated);
        console.info(
          `[Room:${this.id}] Gate ${gateIndex} ${physicallyActivated ? 'OPENED' : 'CLOSED'} by physical occupancy (spawn players: ${playersOnSpawnPlates.size}, hub: ${playerOnHubPlate})`,
        );
      }
    }
  }

  /** Open each colored spike barrier from physical occupancy or a timed warden latch. */
  private updateSpikeGateStates(
    previousPositions: ReadonlyMap<string, { x: number; y: number }> = new Map(),
  ): void {
    const now = Date.now();

    for (
      let obstacleIndex = 0;
      obstacleIndex < this.spikeGateObstacles.length;
      obstacleIndex++
    ) {
      const placement = this.spikeGateObstacles[obstacleIndex];
      const plates = getSpikeGatePlatePlacements(
        placement,
        obstacleIndex,
        this.map.tileSize,
      );
      const physicallyPressedPlateIndices = new Set<number>();

      for (const plate of plates) {
        const physicallyPressed = this.state.players.some(
          (player) => player.connected && isPlayerOnWorldPlate(player.x, player.y, plate),
        );
        if (physicallyPressed) {
          physicallyPressedPlateIndices.add(plate.spikePlateIndex);
        }
      }

      for (let gateIndex = 0; gateIndex < placement.gateCount; gateIndex++) {
        const spikeGateIndex = getSpikeGateStateIndex(obstacleIndex, gateIndex);
        const gatePlates = plates.filter((plate) => plate.gateIndex === gateIndex);
        const hasPhysicalPress = gatePlates.some((plate) =>
          physicallyPressedPlateIndices.has(plate.spikePlateIndex),
        );

        const closeDeadline = this.spikeGateCloseDeadlines[spikeGateIndex];
        if (closeDeadline !== null) {
          if (now >= closeDeadline) {
            for (const plate of gatePlates) {
              this.manuallyPressedSpikePlateIndices.delete(plate.spikePlateIndex);
              const state = this.spikePlateStates[plate.spikePlateIndex];
              if (state) {
                state.pressed = false;
                state.latched = false;
              }
            }
            this.spikeGateCloseDeadlines[spikeGateIndex] = null;
            this.spikeGateNeedsRelease[spikeGateIndex] = hasPhysicalPress;
            this.setSpikeGateOpen(
              placement,
              gateIndex,
              spikeGateIndex,
              false,
              previousPositions,
            );
            console.info(
              `[Room:${this.id}] Spike gate ${spikeGateIndex} CLOSED after ${GATE_OPEN_DURATION_MS}ms; plates reset`,
            );
          } else {
            for (const plate of gatePlates) {
              const latched = this.manuallyPressedSpikePlateIndices.has(
                plate.spikePlateIndex,
              );
              const state = this.spikePlateStates[plate.spikePlateIndex];
              if (state) {
                state.pressed =
                  latched || physicallyPressedPlateIndices.has(plate.spikePlateIndex);
                state.latched = latched;
              }
            }
          }
          continue;
        }

        if (this.spikeGateNeedsRelease[spikeGateIndex]) {
          if (!hasPhysicalPress) this.spikeGateNeedsRelease[spikeGateIndex] = false;
          continue;
        }

        let manuallyActivated = false;
        let open = false;
        for (const plate of gatePlates) {
          const latched = this.manuallyPressedSpikePlateIndices.has(
            plate.spikePlateIndex,
          );
          const pressed =
            latched || physicallyPressedPlateIndices.has(plate.spikePlateIndex);
          const state = this.spikePlateStates[plate.spikePlateIndex];
          if (state) {
            state.pressed = pressed;
            state.latched = latched;
          }
          manuallyActivated ||= latched;
          open ||= pressed;
        }

        if (manuallyActivated) {
          this.spikeGateCloseDeadlines[spikeGateIndex] = now + GATE_OPEN_DURATION_MS;
        }
        this.setSpikeGateOpen(
          placement,
          gateIndex,
          spikeGateIndex,
          open,
          previousPositions,
        );
      }
    }
  }

  /** Apply one spike-gate transition and eject overlaps when it becomes solid. */
  private setSpikeGateOpen(
    placement: SpikeGateObstaclePlacement,
    gateIndex: number,
    spikeGateIndex: number,
    open: boolean,
    previousPositions: ReadonlyMap<string, { x: number; y: number }>,
  ): void {
    const state = this.spikeGateStates[spikeGateIndex];
    if (!state || state.open === open) return;
    state.open = open;
    if (!open) {
      this.ejectPlayersFromClosingSpikeGate(
        placement,
        gateIndex,
        spikeGateIndex,
        previousPositions,
      );
    }
    console.info(
      `[Room:${this.id}] Spike gate ${spikeGateIndex} ${open ? 'OPENED' : 'CLOSED'} by its nearest plate`,
    );
  }

  /** Move any overlapping player back to the side they approached from. */
  private ejectPlayersFromClosingSpikeGate(
    placement: SpikeGateObstaclePlacement,
    gateIndex: number,
    spikeGateIndex: number,
    previousPositions: ReadonlyMap<string, { x: number; y: number }>,
  ): void {
    const bounds = getSpikeGateCollisionBounds(placement, gateIndex, this.map.tileSize);
    const leftEjectionX = bounds.left - FEET_HITBOX_W / 2;
    const rightEjectionX = bounds.right + 1 + FEET_HITBOX_W / 2;
    const northEjectionY = bounds.top;
    const southEjectionY = bounds.bottom + 1 + FEET_HITBOX_H;

    for (const player of this.state.players) {
      if (!player.connected || player.escaped) continue;
      if (!isPlayerOverlappingWorldBounds(player.x, player.y, bounds)) continue;

      const previous = previousPositions.get(player.id);
      const previousLeft = previous ? previous.x - FEET_HITBOX_W / 2 : null;
      const previousRight =
        previousLeft === null ? null : previousLeft + FEET_HITBOX_W - 1;
      const previousTop = previous ? previous.y - FEET_HITBOX_H : null;
      const previousBottom = previous ? previous.y - 1 : null;
      const approachedFromLeft =
        previousRight !== null && previousRight < bounds.left;
      const approachedFromRight =
        previousLeft !== null && previousLeft > bounds.right;
      const approachedFromNorth =
        previousBottom !== null && previousBottom < bounds.top;
      const approachedFromSouth =
        previousTop !== null && previousTop > bounds.bottom;

      if (placement.orientation === 'horizontal') {
        if (approachedFromLeft || (!approachedFromRight && player.facing === 'right')) {
          player.x = leftEjectionX;
        } else if (
          approachedFromRight ||
          (!approachedFromLeft && player.facing === 'left')
        ) {
          player.x = rightEjectionX;
        } else {
          player.x =
            Math.abs(player.x - leftEjectionX) <=
            Math.abs(player.x - rightEjectionX)
              ? leftEjectionX
              : rightEjectionX;
        }
      } else if (
        approachedFromNorth ||
        (!approachedFromSouth && player.facing === 'down')
      ) {
        player.y = northEjectionY;
      } else if (
        approachedFromSouth ||
        (!approachedFromNorth && player.facing === 'up')
      ) {
        player.y = southEjectionY;
      } else {
        player.y =
          Math.abs(player.y - northEjectionY) <=
          Math.abs(player.y - southEjectionY)
            ? northEjectionY
            : southEjectionY;
      }

      player.isMoving = false;
      this.clearQueuedInputs(player);
      console.info(
        `[Room:${this.id}] Ejected ${player.id} from closing spike gate ${spikeGateIndex}`,
      );
    }
  }

  /** Apply one authoritative gate transition to collision, room state, and clients. */
  private setGateOpen(gateIndex: number, open: boolean): void {
    const gate = this.gates[gateIndex];
    if (!gate || this.gateOpenStates[gateIndex] === open) return;

    this.gateOpenStates[gateIndex] = open;
    this.state.gateStates[gateIndex] = { gateIndex, open };

    if (gate.orientation === 'horizontal') {
      for (let dx = 0; dx < CELL_SIZE; dx++) {
        const idx = gate.tileY * this.map.width + (gate.tileX + dx);
        this.map.data[idx] = open ? TILE_FLOOR : TILE_GATE_HORIZONTAL;
      }
    }

    const gateStateMsg: GateStateChangedMessage = {
      type: MessageType.GateStateChanged,
      gateIndex,
      open,
    };
    this.broadcast(gateStateMsg);
  }

  // ── Networking Helpers ────────────────────────────────────────────────

  private send(ws: PlayerSocket, msg: ServerToClientMessage): void {
    ws.send(JSON.stringify(msg), false);
  }

  private broadcast(msg: ServerToClientMessage): void {
    const payload = JSON.stringify(msg);
    for (const ws of this.sockets.values()) {
      ws.send(payload, false);
    }
  }

  private broadcastSnapshot(): void {
    if (this.state.match.status === 'waiting') return;
    const message: TickUpdateMessage = {
      type: MessageType.TickUpdate,
      snapshotId: this.nextSnapshotId++,
      gameState: this.cloneState(),
    };
    const payload = JSON.stringify(message);
    for (const [playerId, ws] of this.sockets) {
      const usesFlowControl = ws.getUserData().supportsSnapshotFlowControl;
      const inFlight = this.inFlightSnapshotIds.get(playerId) ?? [];
      if (usesFlowControl && inFlight.length >= MAX_IN_FLIGHT_SNAPSHOTS) continue;

      // Tick updates are disposable. If this connection has not flushed its
      // previous data yet, queueing another full snapshot would make every
      // later acknowledgement and chat message wait behind stale game states.
      // The next periodic snapshot contains the complete authoritative state.
      if (ws.getBufferedAmount() > 0) continue;
      const sendStatus = ws.send(payload, false);
      if (usesFlowControl && sendStatus !== 2) {
        inFlight.push(message.snapshotId);
        this.inFlightSnapshotIds.set(playerId, inFlight);
      }
    }
  }

  private cloneState(): GameState {
    this.refreshMatchTime();
    return {
      tick: this.state.tick,
      match: {
        ...this.state.match,
        finalRoster:
          this.state.match.finalRoster?.map((player) => ({ ...player })) ?? null,
      },
      networkStatsVisible: this.state.networkStatsVisible,
      players: this.state.players.map(toPublicPlayerInfo),
      runestones: this.runestones.map((r) => ({ ...r })),
      portal: this.portalPosition ? { ...this.portalPosition } : null,
      gateStates: this.state.gateStates.map((g) => ({ ...g })),
      pressurePlateStates: this.pressurePlateStates.map((plateState) => ({
        ...plateState,
      })),
      bridgeStates: this.bridgeStates.map((bridgeState) => ({ ...bridgeState })),
      chestStates: this.chestStates.map((chestState) => ({ ...chestState })),
      swordFieldStates: this.swordFieldStates.map((state) => ({ ...state })),
      spikeGateStates: this.spikeGateStates.map((state) => ({ ...state })),
      spikePlateStates: this.spikePlateStates.map((state) => ({ ...state })),
      cageStates: this.cageStates.map((state) => ({ ...state })),
    };
  }

  destroy(): void {
    this.cancelLobbyCountdown();
    this.stopLoop();
    for (const seat of this.seats.values()) {
      if (seat.reservationHandle !== null) clearTimeout(seat.reservationHandle);
    }
    this.seats.clear();
    this.sockets.clear();
    this.inputQueues.clear();
    this.inFlightSnapshotIds.clear();
    this.lastMovementInputAt.clear();
    this.lastChatSentAt.clear();
    this.bridgeTraversals.clear();
    this.revealedWisdomBridges.clear();
    this.revealedWisdomSwamps.clear();
    this.bridgeFailureFeedbackExpirations.clear();
    this.bridgeRepairOccupancy.clear();
    this.bridgeRepairs.clear();
    this.matchRoster = [];
    this.state.players = [];
  }
}
