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
  INITIAL_WISDOM_ORBS,
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
  getBridgeCollapseMask,
  getBridgeRepairCollapsedMask,
  getBridgeBankReturnPosition,
  deriveFacingDirection,
  applyInputWithCollision,
  generateMazeLayout,
  type NavigationDistanceField,
  type TileMapData,
  type SpawnPoint,
  type GatePlacement,
  type PressurePlateInfo,
  type BridgePlacement,
  type BridgeEntrySide,
  type BridgeState,
  type GameState,
  type PlayerInfo,
  type PlayerRole,
  type RunestoneInfo,
  type PlayerInputMessage,
  type ActivateRunestoneMessage,
  type DebugTeleportMessage,
  type DebugPlayerActionMessage,
  type RoomJoinedMessage,
  type TickUpdateMessage,
  type PlayerLeftMessage,
  type RunestoneActivatedMessage,
  type AllRunestonesActivatedMessage,
  type WisdomOrbUsedMessage,
  type PlayerRoleChangedMessage,
  type DebugPlayerRoleMessage,
  type GateStateChangedMessage,
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
  private loopHandle: ReturnType<typeof setInterval> | null = null;

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

  /** Shared, server-authoritative missing-stone masks. */
  private readonly bridgeStates: BridgeState[];

  /** Current bridge attempt for each player. */
  private readonly bridgeTraversals = new Map<string, BridgeTraversalState>();

  /** Expiry time for each bridge's short wrong-stone visual marker. */
  private readonly bridgeFailureFeedbackExpirations = new Map<number, number>();

  /** Current treasure-circle occupancy, used to require a fresh step-on edge. */
  private readonly bridgeRepairOccupancy = new Map<string, string>();

  /** Fixed-duration repairs currently progressing across bridge stones. */
  private readonly bridgeRepairs = new Map<number, BridgeRepairProgress>();

  /** Per-gate open/closed state (true = open/passable). */
  private gateOpenStates: boolean[];

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
    this.hubDistanceField = computeHubDistanceField(this.map);
    this.runestones = findRunestonePositions(this.map);

    const portalTile = computePortalPosition(this.map.data, SPAWN_DISTANCE, this.bridges);
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
      players: [],
      runestones: this.runestones,
      portal: this.portalPosition,
      gateStates: this.gates.map((_, i) => ({ gateIndex: i, open: false })),
      bridgeStates: this.bridgeStates,
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
      `  Gates: ${this.gates.length}, Pressure plates: ${this.pressurePlates.length}, Bridges: ${this.bridges.length}`,
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
      lastProcessedInput: 0,
      wisdomOrbs,
    };
    this.state.players.push(playerInfo);

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
    this.bridgeTraversals.delete(playerId);
    this.bridgeRepairOccupancy.delete(playerId);
    this.state.players = this.state.players.filter((p) => p.id !== playerId);

    const leftMsg: PlayerLeftMessage = {
      type: MessageType.PlayerLeft,
      playerId,
    };
    this.broadcast(leftMsg);

    console.info(
      `[Room:${this.id}] Player left: ${playerId} — ${this.playerCount} player(s) remaining`,
    );

    if (this.playerCount === 0) {
      this.stopLoop();
    }
  }

  // ── Input Handling ────────────────────────────────────────────────────

  handleInput(playerId: string, msg: PlayerInputMessage): void {
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

  /** Debug: teleport a player to an arbitrary position (updates authoritative state). */
  handleDebugTeleport(playerId: string, msg: DebugTeleportMessage): void {
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

  /** Debug: apply a player-menu action using authoritative room state. */
  handleDebugPlayerAction(requesterId: string, msg: DebugPlayerActionMessage): void {
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

  // ── Game Loop ─────────────────────────────────────────────────────────

  handleUseWisdomOrb(playerId: string): void {
    console.info(`[Room:${this.id}][WisdomOrb] USE request from ${playerId}`);

    const player = this.state.players.find((p) => p.id === playerId);
    if (!player) {
      console.warn(
        `[Room:${this.id}][WisdomOrb] REJECTED: player ${playerId} not found in state (${this.state.players.length} players)`,
      );
      return;
    }
    if (player.role === 'warden') {
      console.warn(`[Room:${this.id}][WisdomOrb] REJECTED: ${playerId} is a warden`);
      return;
    }
    if (player.wisdomOrbs <= 0) {
      console.warn(
        `[Room:${this.id}][WisdomOrb] REJECTED: player ${playerId} has 0 orbs remaining`,
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

    const bridgeHintTarget = findBridgeWisdomHintTarget(
      this.bridges,
      player.x,
      player.y,
      this.map.tileSize,
    );
    if (bridgeHintTarget) {
      const bridge = this.bridges[bridgeHintTarget.bridgeIndex];
      player.wisdomOrbs--;
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
    this.state.tick++;

    for (const player of this.state.players) {
      const queue = this.inputQueues.get(player.id);
      if (!queue || queue.length === 0) {
        player.isMoving = false;
        continue;
      }

      for (const input of queue) {
        const previousX = player.x;
        const previousY = player.y;
        // Use client-provided dt, clamped for anti-cheat safety
        const dt = Math.min(Math.max(input.dt, 0), 0.1);
        const result = applyInputWithCollision(
          player.x,
          player.y,
          input,
          dt,
          this.map,
          this.portalPosition,
          this.bridges,
          this.bridgeStates,
        );
        player.x = result.x;
        player.y = result.y;
        this.updateBridgeInteractions(player, previousX, previousY);

        if (input.sequenceNumber > player.lastProcessedInput) {
          player.lastProcessedInput = input.sequenceNumber;
        }
      }

      // Derive facing & isMoving from the LAST input in the queue
      const lastInput = queue[queue.length - 1];
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
   * Check pressure plate activation for each gate and open/close gates accordingly.
   * - Spawn side: at least 2 distinct players standing on spawn-side plates.
   * - Hub side: at least 1 player standing on the hub-side plate.
   */
  private updateGateStates(): void {
    for (let gateIndex = 0; gateIndex < this.gates.length; gateIndex++) {
      const gate = this.gates[gateIndex];
      const gatePlates = this.pressurePlates.filter((p) => p.gateIndex === gateIndex);

      const spawnPlates = gatePlates.filter((p) => p.side === 'spawn');
      const hubPlates = gatePlates.filter((p) => p.side === 'hub');

      // Check spawn side: count distinct players on ANY spawn-side plate
      const playersOnSpawnPlates = new Set<string>();
      for (const plate of spawnPlates) {
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
            playersOnSpawnPlates.add(player.id);
          }
        }
      }
      const spawnSideActivated = playersOnSpawnPlates.size >= 2;

      // Check hub side: at least 1 player on any hub-side plate
      let hubSideActivated = false;
      for (const plate of hubPlates) {
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
            hubSideActivated = true;
            break;
          }
        }
        if (hubSideActivated) break;
      }

      const shouldBeOpen = spawnSideActivated || hubSideActivated;
      const wasOpen = this.gateOpenStates[gateIndex];

      if (shouldBeOpen !== wasOpen) {
        this.gateOpenStates[gateIndex] = shouldBeOpen;
        this.state.gateStates[gateIndex] = { gateIndex, open: shouldBeOpen };

        // Update the tile data: swap gate tiles ↔ floor tiles
        if (gate.orientation === 'horizontal') {
          for (let dx = 0; dx < CELL_SIZE; dx++) {
            const idx = gate.tileY * this.map.width + (gate.tileX + dx);
            this.map.data[idx] = shouldBeOpen ? TILE_FLOOR : TILE_GATE_HORIZONTAL;
          }
        }

        const gateStateMsg: GateStateChangedMessage = {
          type: MessageType.GateStateChanged,
          gateIndex,
          open: shouldBeOpen,
        };
        this.broadcast(gateStateMsg);

        console.info(
          `[Room:${this.id}] Gate ${gateIndex} ${shouldBeOpen ? 'OPENED' : 'CLOSED'} (spawn: ${playersOnSpawnPlates.size} players, hub: ${hubSideActivated})`,
        );
      }
    }
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
    return {
      tick: this.state.tick,
      players: this.state.players.map(toPublicPlayerInfo),
      runestones: this.runestones.map((r) => ({ ...r })),
      portal: this.portalPosition ? { ...this.portalPosition } : null,
      gateStates: this.state.gateStates.map((g) => ({ ...g })),
      bridgeStates: this.bridgeStates.map((bridgeState) => ({ ...bridgeState })),
    };
  }

  destroy(): void {
    this.stopLoop();
    this.sockets.clear();
    this.inputQueues.clear();
    this.bridgeTraversals.clear();
    this.bridgeFailureFeedbackExpirations.clear();
    this.bridgeRepairOccupancy.clear();
    this.state.players = [];
  }
}
