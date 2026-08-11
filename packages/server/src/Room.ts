// packages/server/src/Room.ts
// ─────────────────────────────────────────────────────────────────────────────
// Room — Manages one maze instance and its connected players.
//
// Spawn system:
//   - Teams spawn at dynamically computed equidistant points (BFS from hub).
//   - Distance configurable via SPAWN_DISTANCE constant.
//   - Tile coordinates converted to pixel coordinates (tile.x * tileSize).
// ─────────────────────────────────────────────────────────────────────────────

import type uWS from 'uWebSockets.js';

import {
  MessageType,
  SERVER_TICK_MS,
  MAX_PLAYERS_PER_ROOM,
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
  MATCH_DURATION_MS,
  getSurvivorEscapeThreshold,
  getRemainingSurvivorsToEscape,
  isWithinPortalInteractionRange,
  SWORD_FIELD_LOWER_DURATION_MS,
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
  type ActivateRunestoneMessage,
  type OpenChestMessage,
  type PressPressurePlateMessage,
  type ActivateTrapCellMessage,
  type OpenCageMessage,
  type SendChatMessage,
  type EscapePortalMessage,
  type DebugTeleportMessage,
  type DebugSetMatchTimeMessage,
  type DebugPlayerActionMessage,
  type RoomJoinedMessage,
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

type RoomState = Omit<GameState, 'players'> & { players: RoomPlayerInfo[] };

/** Build a legal 7-survivor / 2-warden seat layout for a new room. */
function createRoleSeats(): PlayerRole[][] {
  const seats: PlayerRole[][] = Array.from({ length: MAX_TEAMS }, () =>
    Array<PlayerRole>(PLAYERS_PER_TEAM).fill('survivor'),
  );
  const teams = Array.from({ length: MAX_TEAMS }, (_, index) => index);

  for (let i = teams.length - 1; i > 0; i--) {
    const swapIndex = Math.floor(Math.random() * (i + 1));
    [teams[i], teams[swapIndex]] = [teams[swapIndex], teams[i]];
  }

  for (const teamId of teams.slice(0, 2)) {
    const teamSlot = Math.floor(Math.random() * PLAYERS_PER_TEAM);
    seats[teamId][teamSlot] = 'warden';
  }

  return seats;
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
    isDead: player.isDead,
    escaped: player.escaped,
    lastProcessedInput: player.lastProcessedInput,
  };
}

/** Pixel distance threshold for runestone activation (1.5 tiles). */
const RUNESTONE_ACTIVATION_RANGE = 28;

/** Find all runestone tiles in the map data and return their positions. */
function findRunestonePositions(map: TileMapData): RunestoneInfo[] {
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

export class Room {
  readonly id: string;
  private state: RoomState;
  private sockets: Map<string, PlayerSocket> = new Map();
  private inputQueues: Map<string, QueuedInput[]> = new Map();
  private readonly lastChatSentAt = new Map<string, number>();
  private loopHandle: ReturnType<typeof setInterval> | null = null;

  /** Server wall-clock deadline, initialized when the first player joins. */
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

  /** Deterministic 6x6 cells visible to and activatable by wardens. */
  private readonly trapCells: TrapCellPlacement[];

  /** Decorative, collidable ruins/signpost prefabs in north-closed T-junctions. */
  private readonly tIntersectionDecorations: TIntersectionDecorationPlacement[];

  /** Decorative, collidable foliage compositions spanning vertical cell pairs. */
  private readonly decoratedVerticalPassages: DecoratedVerticalPassagePlacement[];

  /** Shared lowering/cleared state for every sword barrier. */
  private readonly swordFieldStates: SwordFieldState[];

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

  constructor(id: string) {
    this.id = id;
    this.roleSeats = createRoleSeats();
    this.mapSeed = Math.floor(Math.random() * 2147483647);
    const layout = generateMazeLayout(this.mapSeed, SPAWN_DISTANCE, MAX_TEAMS);
    this.map = layout.map;
    this.spawnPoints = layout.spawnPoints;
    this.gates = layout.gates;
    this.pressurePlates = layout.pressurePlates;
    this.bridges = layout.bridges;
    this.swamps = layout.swamps;
    this.swordFields = layout.swordFields;
    this.trapCells = layout.trapCells;
    this.tIntersectionDecorations = layout.tIntersectionDecorations;
    this.decoratedVerticalPassages = layout.decoratedVerticalPassages;
    this.swordFieldStates = this.swordFields.map((_, swordFieldIndex) => ({
      swordFieldIndex,
      loweringStartedTick: null,
      cleared: false,
    }));
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
      },
      players: [],
      runestones: this.runestones,
      portal: this.portalPosition,
      gateStates: this.gates.map((_, i) => ({ gateIndex: i, open: false })),
      pressurePlateStates: this.pressurePlateStates,
      bridgeStates: this.bridgeStates,
      chestStates: this.chestStates,
      swordFieldStates: this.swordFieldStates,
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
      `  Gates: ${this.gates.length}, Pressure plates: ${this.pressurePlates.length}, Bridges: ${this.bridges.length}, Swamps: ${this.swamps.length}, Sword fields: ${this.swordFields.length}, Trap cells: ${this.trapCells.length}`,
    );
    if (this.portalPosition) {
      console.info(
        `  Portal: (${Math.round(this.portalPosition.x)}, ${Math.round(this.portalPosition.y)})`,
      );
    }
  }

  // ── Player Management ─────────────────────────────────────────────────

  get playerCount(): number {
    return this.sockets.size;
  }

  get isFull(): boolean {
    return this.sockets.size >= MAX_PLAYERS_PER_ROOM;
  }

  addPlayer(ws: PlayerSocket): void {
    const data = ws.getUserData();
    const playerId = data.id;
    const displayName = data.displayName;

    // ── Squad Assignment ────────────────────────────────────────────
    // Fill the first available stable seat so a reconnecting replacement receives
    // the same role as the player who vacated it.
    let assignedTeam = -1;
    let assignedTeamSlot = -1;
    for (let t = 0; t < MAX_TEAMS; t++) {
      const occupiedSlots = new Set(
        this.state.players.filter((p) => p.teamId === t).map((p) => p.teamSlot),
      );
      for (let slot = 0; slot < PLAYERS_PER_TEAM; slot++) {
        if (!occupiedSlots.has(slot)) {
          assignedTeam = t;
          assignedTeamSlot = slot;
          break;
        }
      }
      if (assignedTeam !== -1) break;
    }

    // Safety: isFull guards this path before addPlayer is called.
    if (assignedTeam === -1 || assignedTeamSlot === -1) {
      console.error(
        `[Room:${this.id}] Could not find an available team seat for ${playerId}`,
      );
      return;
    }

    this.sockets.set(playerId, ws);
    this.inputQueues.set(playerId, []);
    this.revealedWisdomBridges.set(playerId, new Set());
    this.revealedWisdomSwamps.set(playerId, new Set());

    // Each team spawns at its corresponding dynamic spawn point
    const spawnTile = this.spawnPoints[assignedTeam] ?? this.spawnPoints[0];
    // Player x,y = bottom-center of sprite (feet position)
    const spawnX = (spawnTile.x + 0.5) * TILE_SIZE;
    const spawnY = (spawnTile.y + 0.5) * TILE_SIZE;

    // ── Per-player sprite assignment ─────────────────────────────────
    // Available sprite count (must match the client's player animation sets).
    // Index 0 is Female1, making it the default assignment for the first player.
    const usedSprites = new Set(this.state.players.map((p) => p.spriteIndex));
    let spriteIndex = -1;
    // Try to assign a unique sprite first
    for (let s = 0; s < PLAYER_CHARACTER_COUNT; s++) {
      if (!usedSprites.has(s)) {
        spriteIndex = s;
        break;
      }
    }
    // If all sprites are taken, assign randomly
    if (spriteIndex === -1) {
      spriteIndex = Math.floor(Math.random() * PLAYER_CHARACTER_COUNT);
    }

    const role = this.roleSeats[assignedTeam][assignedTeamSlot];
    const wisdomOrbs = role === 'survivor' ? INITIAL_WISDOM_ORBS : 0;
    const playerInfo: RoomPlayerInfo = {
      id: playerId,
      displayName,
      teamId: assignedTeam,
      teamSlot: assignedTeamSlot,
      role,
      spriteIndex,
      x: spawnX,
      y: spawnY,
      facing: 'down',
      isMoving: false,
      isDead: false,
      escaped: false,
      lastProcessedInput: 0,
      wisdomOrbs,
    };
    this.state.players.push(playerInfo);

    if (this.state.match.status === 'waiting') {
      this.startMatch();
    } else if (this.state.match.status === 'running') {
      this.syncMatchCounts();
    }

    data.roomId = this.id;

    const joinMsg: RoomJoinedMessage = {
      type: MessageType.RoomJoined,
      roomId: this.id,
      playerId,
      mapSeed: this.mapSeed,
      role,
      wisdomOrbs,
      gameState: this.cloneState(),
    };
    this.send(ws, joinMsg);

    console.info(
      `[Room:${this.id}] Player joined: ${displayName} (${playerId}) ${SQUAD_COLORS[assignedTeam]} squad seat ${assignedTeamSlot} role ${role} sprite ${spriteIndex} → (${spawnX}, ${spawnY}) — ${this.playerCount} player(s)`,
    );

    if (this.playerCount === 1) {
      this.startLoop();
    }
  }

  removePlayer(playerId: string): void {
    this.sockets.delete(playerId);
    this.inputQueues.delete(playerId);
    this.lastChatSentAt.delete(playerId);
    this.bridgeTraversals.delete(playerId);
    this.bridgeRepairOccupancy.delete(playerId);
    this.revealedWisdomBridges.delete(playerId);
    this.revealedWisdomSwamps.delete(playerId);
    for (const cage of this.cageStates) {
      if (cage.prisonerPlayerId !== playerId || cage.vacated) continue;
      cage.opened = true;
      cage.vacated = true;
    }
    this.state.players = this.state.players.filter((p) => p.id !== playerId);

    if (this.state.match.status === 'running') {
      this.syncMatchCounts();
    }

    const leftMsg: PlayerLeftMessage = {
      type: MessageType.PlayerLeft,
      playerId,
    };
    this.broadcast(leftMsg);

    if (this.state.match.status === 'running') {
      this.checkSurvivorVictory();
    }

    console.info(
      `[Room:${this.id}] Player left: ${playerId} — ${this.playerCount} player(s) remaining`,
    );

    if (this.playerCount === 0) {
      this.stopLoop();
    }
  }

  // ── Input Handling ────────────────────────────────────────────────────

  handleInput(playerId: string, msg: PlayerInputMessage): void {
    if (!this.canPlayerAct(playerId)) return;
    const queue = this.inputQueues.get(playerId);
    if (queue) {
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
    if (!this.canPlayerAct(playerId)) return;
    const player = this.state.players.find((p) => p.id === playerId);
    if (!player) return;
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
  handleDebugSetMatchTime(
    requesterId: string,
    msg: DebugSetMatchTimeMessage,
  ): void {
    if (!this.isMatchRunning() || !this.sockets.has(requesterId)) return;
    if (
      typeof msg.remainingMs !== 'number' ||
      !Number.isInteger(msg.remainingMs) ||
      msg.remainingMs < 0 ||
      msg.remainingMs > DEBUG_MAX_MATCH_TIME_MS
    ) {
      return;
    }

    const now = Date.now();
    this.matchEndsAtMs = now + msg.remainingMs;
    this.state.match.remainingMs = msg.remainingMs;

    if (msg.remainingMs === 0) {
      this.endMatch('wardens', now);
      return;
    }

    const update: TickUpdateMessage = {
      type: MessageType.TickUpdate,
      gameState: this.cloneState(),
    };
    this.broadcast(update);
    console.info(
      `[Room:${this.id}] Debug set match timer to ${Math.ceil(msg.remainingMs / 1_000)} seconds`,
    );
  }

  /** Debug: apply a player-menu action using authoritative room state. */
  handleDebugPlayerAction(requesterId: string, msg: DebugPlayerActionMessage): void {
    if (!this.canPlayerAct(requesterId)) return;
    const requester = this.state.players.find((player) => player.id === requesterId);
    const target = this.state.players.find((player) => player.id === msg.targetPlayerId);
    if (!requester || !target) return;

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
    player.isMoving = false;
  }

  private startMatch(): void {
    if (this.state.match.status !== 'waiting') return;
    const now = Date.now();
    this.matchEndsAtMs = now + MATCH_DURATION_MS;
    this.state.match.status = 'running';
    this.state.match.winner = null;
    this.state.match.remainingMs = MATCH_DURATION_MS;
    this.syncMatchCounts();
    console.info(`[Room:${this.id}] Match started; deadline in 10 minutes`);
  }

  /** Keep public progress derived from the currently connected private roles. */
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
    return Boolean(player && !player.escaped);
  }

  private checkSurvivorVictory(): void {
    if (this.state.match.status !== 'running') return;
    const connectedSurvivorPlayers = this.state.players.filter(
      (player) => player.role === 'survivor',
    );
    const connectedSurvivors = connectedSurvivorPlayers.length;
    this.syncMatchCounts();
    const allConnectedSurvivorsEscaped =
      connectedSurvivors > 0 &&
      connectedSurvivorPlayers.every((player) => player.escaped);
    if (
      allConnectedSurvivorsEscaped ||
      (connectedSurvivors > 0 &&
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
    for (const player of this.state.players) this.clearQueuedInputs(player);

    const finalUpdate: TickUpdateMessage = {
      type: MessageType.TickUpdate,
      gameState: this.cloneState(),
    };
    this.broadcast(finalUpdate);

    const endedMessage: MatchEndedMessage = {
      type: MessageType.MatchEnded,
      winner,
      escapedCount: this.state.match.escapedCount,
      escapeThreshold: this.state.match.escapeThreshold,
      remainingMs: this.state.match.remainingMs,
    };
    this.broadcast(endedMessage);
    this.stopLoop();
    console.info(
      `[Room:${this.id}] Match ended: ${winner} win (${this.state.match.escapedCount}/${this.state.match.escapeThreshold} escapes)`,
    );
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
      if (survivor.role !== 'survivor') continue;
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

    for (const player of this.state.players) {
      const queue = this.inputQueues.get(player.id);
      if (player.escaped) {
        this.clearQueuedInputs(player);
        continue;
      }
      const activeCage = findActivePlayerCage(this.cageStates, player.id);
      if (activeCage && !activeCage.opened) {
        if (!queue || queue.length === 0) {
          player.isMoving = false;
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
        player.isMoving = false;
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

    const update: TickUpdateMessage = {
      type: MessageType.TickUpdate,
      gameState: this.cloneState(),
    };
    this.broadcast(update);
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

  private cloneState(): GameState {
    this.refreshMatchTime();
    return {
      tick: this.state.tick,
      match: { ...this.state.match },
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
      cageStates: this.cageStates.map((state) => ({ ...state })),
    };
  }

  destroy(): void {
    this.stopLoop();
    this.sockets.clear();
    this.inputQueues.clear();
    this.lastChatSentAt.clear();
    this.bridgeTraversals.clear();
    this.revealedWisdomBridges.clear();
    this.revealedWisdomSwamps.clear();
    this.bridgeFailureFeedbackExpirations.clear();
    this.bridgeRepairOccupancy.clear();
    this.state.players = [];
  }
}
