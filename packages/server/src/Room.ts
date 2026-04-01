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
  SERVER_TICK_S,
  MAX_PLAYERS_PER_ROOM,
  PLAYERS_PER_TEAM,
  MAX_TEAMS,
  TILE_SIZE,
  SPAWN_DISTANCE,
  INITIAL_WISDOM_ORBS,
  TILE_RUNESTONE_1,
  TILE_RUNESTONE_2,
  TILE_RUNESTONE_3,
  computePortalPosition,
  computeHubDistanceField,
  computePortalDistanceField,
  getNavigationDirectionForPosition,
  applyInputWithCollision,
  generateMazeLayout,
  type NavigationDistanceField,
  type FacingDirection,
  type TileMapData,
  type SpawnPoint,
  type GameState,
  type PlayerInfo,
  type RunestoneInfo,
  type PlayerInputMessage,
  type ActivateRunestoneMessage,
  type DebugTeleportMessage,
  type RoomJoinedMessage,
  type TickUpdateMessage,
  type PlayerLeftMessage,
  type RunestoneActivatedMessage,
  type AllRunestonesActivatedMessage,
  type WisdomOrbUsedMessage,
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
        runestones.push({ index: idx, tileX: x, tileY: y, activated: false });
      }
    }
  }
  // Sort by index so slot 0/1/2 are in order
  runestones.sort((a, b) => a.index - b.index);
  return runestones;
}

export class Room {
  readonly id: string;
  private state: GameState;
  private sockets: Map<string, PlayerSocket> = new Map();
  private inputQueues: Map<string, QueuedInput[]> = new Map();
  private loopHandle: ReturnType<typeof setInterval> | null = null;

  /** Runestone activation state (server-authoritative). */
  private runestones: RunestoneInfo[] = [];

  /** Portal position (set when all runestones are activated). */
  private portalPosition: { x: number; y: number } | null = null;


  /** Random seed used to generate this room's maze. */
  readonly mapSeed: number;

  /** The generated maze tile map for this room. */
  private readonly map: TileMapData;

  /** Dynamically computed equidistant spawn points (one per team). */
  private readonly spawnPoints: SpawnPoint[];

  /** Precomputed tile distances from every walkable tile to the hub. */
  private readonly hubDistanceField: NavigationDistanceField;

  /** Precomputed tile distances from every walkable tile to the portal approach zone. */
  private portalDistanceField: NavigationDistanceField | null = null;

  constructor(id: string) {
    this.id = id;
    this.mapSeed = Math.floor(Math.random() * 2147483647);
    const layout = generateMazeLayout(this.mapSeed, SPAWN_DISTANCE, MAX_TEAMS);
    this.map = layout.map;
    this.spawnPoints = layout.spawnPoints;
    this.hubDistanceField = computeHubDistanceField(this.map);
    this.runestones = findRunestonePositions(this.map);
    this.state = {
      tick: 0,
      players: [],
      runestones: this.runestones,
      portal: null,
    };
    console.info(
      `[Room:${this.id}] Created with maze seed ${this.mapSeed}, spawn distance ${SPAWN_DISTANCE}`,
    );
    for (let i = 0; i < this.spawnPoints.length; i++) {
      const sp = this.spawnPoints[i];
      console.info(`  Team ${i} spawn: tile (${sp.x}, ${sp.y}) → px (${(sp.x + 0.5) * TILE_SIZE}, ${(sp.y + 0.5) * TILE_SIZE})`);
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

    this.sockets.set(playerId, ws);
    this.inputQueues.set(playerId, []);

    // ── Team Assignment ─────────────────────────────────────────────
    // Find the first team (0…MAX_TEAMS-1) that has fewer than PLAYERS_PER_TEAM members.
    let assignedTeam = -1;
    for (let t = 0; t < MAX_TEAMS; t++) {
      const count = this.state.players.filter((p) => p.teamId === t).length;
      if (count < PLAYERS_PER_TEAM) {
        assignedTeam = t;
        break;
      }
    }

    // Safety: should never happen because isFull guards beforehand,
    // but fall back to team 0 just in case.
    if (assignedTeam === -1) assignedTeam = 0;

    // Each team spawns at its corresponding dynamic spawn point
    const spawnTile = this.spawnPoints[assignedTeam] ?? this.spawnPoints[0];
    // Player x,y = bottom-center of sprite (feet position)
    const spawnX = (spawnTile.x + 0.5) * TILE_SIZE;
    const spawnY = (spawnTile.y + 0.5) * TILE_SIZE;

    // ── Per-player sprite assignment ─────────────────────────────────
    // Available sprite count (must match client's PLAYER_FILES array length)
    const SPRITE_COUNT = 3;
    const usedSprites = new Set(this.state.players.map((p) => p.spriteIndex));
    let spriteIndex = -1;
    // Try to assign a unique sprite first
    for (let s = 0; s < SPRITE_COUNT; s++) {
      if (!usedSprites.has(s)) {
        spriteIndex = s;
        break;
      }
    }
    // If all sprites are taken, assign randomly
    if (spriteIndex === -1) {
      spriteIndex = Math.floor(Math.random() * SPRITE_COUNT);
    }

    const playerInfo: PlayerInfo = {
      id: playerId,
      displayName,
      teamId: assignedTeam,
      spriteIndex,
      x: spawnX,
      y: spawnY,
      facing: 'down',
      isMoving: false,
      lastProcessedInput: 0,
      wisdomOrbs: INITIAL_WISDOM_ORBS,
    };
    this.state.players.push(playerInfo);

    data.roomId = this.id;

    const joinMsg: RoomJoinedMessage = {
      type: MessageType.RoomJoined,
      roomId: this.id,
      playerId,
      mapSeed: this.mapSeed,
      gameState: this.cloneState(),
    };
    this.send(ws, joinMsg);

    console.info(
      `[Room:${this.id}] Player joined: ${displayName} (${playerId}) team ${assignedTeam} sprite ${spriteIndex} → (${spawnX}, ${spawnY}) — ${this.playerCount} player(s)`,
    );

    if (this.playerCount === 1) {
      this.startLoop();
    }
  }

  removePlayer(playerId: string): void {
    this.sockets.delete(playerId);
    this.inputQueues.delete(playerId);
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
      });
    }
  }

  /** Debug: teleport a player to an arbitrary position (updates authoritative state). */
  handleDebugTeleport(playerId: string, msg: DebugTeleportMessage): void {
    const player = this.state.players.find((p) => p.id === playerId);
    if (!player) return;
    player.x = msg.x;
    player.y = msg.y;
    console.info(`[Room:${this.id}] Debug teleport ${playerId} → (${Math.round(msg.x)}, ${Math.round(msg.y)})`);
  }

  /** Handle a runestone activation request. Validates proximity server-side. */
  handleActivateRunestone(playerId: string, msg: ActivateRunestoneMessage): void {
    const idx = msg.runestoneIndex;
    const rs = this.runestones.find((r) => r.index === idx);
    if (!rs || rs.activated) return; // invalid or already active

    const player = this.state.players.find((p) => p.id === playerId);
    if (!player) return;

    // Server-side proximity check (anti-cheat)
    const rsPxX = (rs.tileX + 0.5) * TILE_SIZE;
    const rsPxY = (rs.tileY + 1) * TILE_SIZE;
    const dx = player.x - rsPxX;
    const dy = player.y - rsPxY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > RUNESTONE_ACTIVATION_RANGE) return; // too far

    // Activate!
    rs.activated = true;
    console.info(`[Room:${this.id}] Runestone ${idx} activated by ${playerId}`);

    // Broadcast to all clients immediately
    const activatedMsg: RunestoneActivatedMessage = {
      type: MessageType.RunestoneActivated,
      runestoneIndex: idx,
    };
    this.broadcast(activatedMsg);

    // Check if ALL runestones are now activated → spawn portal
    const allActivated = this.runestones.every((r) => r.activated);
    if (allActivated && !this.portalPosition) {
      const portalTile = computePortalPosition(this.map.data, SPAWN_DISTANCE);
      if (portalTile) {
        // Convert tile coordinates to pixel coordinates (center of cell)
        const portalPxX = (portalTile.x + 0.5) * TILE_SIZE;
        const portalPxY = (portalTile.y + 0.5) * TILE_SIZE;
        this.portalPosition = { x: portalPxX, y: portalPxY };
        this.portalDistanceField = computePortalDistanceField(this.map, this.portalPosition);
        this.state.portal = this.portalPosition;

        console.info(`[Room:${this.id}] All runestones activated! Portal spawned at (${Math.round(portalPxX)}, ${Math.round(portalPxY)})`);

        const portalMsg: AllRunestonesActivatedMessage = {
          type: MessageType.AllRunestonesActivated,
          portalX: portalPxX,
          portalY: portalPxY,
        };
        this.broadcast(portalMsg);
      } else {
        console.warn(`[Room:${this.id}] All runestones activated but no valid portal position found!`);
      }
    }
  }

  // ── Game Loop ─────────────────────────────────────────────────────────

  handleUseWisdomOrb(playerId: string): void {
    console.info(`[Room:${this.id}][WisdomOrb] USE request from ${playerId}`);

    const player = this.state.players.find((p) => p.id === playerId);
    if (!player) {
      console.warn(`[Room:${this.id}][WisdomOrb] REJECTED: player ${playerId} not found in state (${this.state.players.length} players)`);
      return;
    }
    if (player.wisdomOrbs <= 0) {
      console.warn(`[Room:${this.id}][WisdomOrb] REJECTED: player ${playerId} has 0 orbs remaining`);
      return;
    }

    const activeTarget = this.portalPosition ? 'portal' : 'hub';
    const activeDistanceField = this.portalPosition ? this.portalDistanceField : this.hubDistanceField;
    if (!activeDistanceField) {
      console.warn(`[Room:${this.id}][WisdomOrb] REJECTED: no distance field available (target=${activeTarget}, portalPos=${JSON.stringify(this.portalPosition)}, portalField=${!!this.portalDistanceField}, hubField=${!!this.hubDistanceField})`);
      return;
    }

    console.info(`[Room:${this.id}][WisdomOrb] Computing direction for player at (${player.x.toFixed(1)}, ${player.y.toFixed(1)}), target=${activeTarget}`);
    const feetTileX = Math.floor(player.x / this.map.tileSize);
    const feetTileY = Math.floor((player.y - 1) / this.map.tileSize);
    const tileIndex = feetTileY * this.map.width + feetTileX;
    const tileId = this.map.data[tileIndex];
    const tileDist = activeDistanceField.tileDistances[tileIndex];
    console.info(`[Room:${this.id}][WisdomOrb] Feet tile: (${feetTileX}, ${feetTileY}), tileId=${tileId}, tileDistance=${tileDist}`);

    const direction = getNavigationDirectionForPosition(
      player.x,
      player.y,
      this.map,
      activeDistanceField,
    );
    if (!direction) {
      console.warn(`[Room:${this.id}][WisdomOrb] REJECTED: getNavigationDirectionForPosition returned null for player at (${player.x.toFixed(1)}, ${player.y.toFixed(1)}), tile (${feetTileX}, ${feetTileY}), tileId=${tileId}, tileDistance=${tileDist}`);
      return;
    }

    const ws = this.sockets.get(playerId);
    if (!ws) {
      console.warn(`[Room:${this.id}][WisdomOrb] REJECTED: socket not found for player ${playerId}`);
      return;
    }

    player.wisdomOrbs--;

    const orbUsedMsg: WisdomOrbUsedMessage = {
      type: MessageType.WisdomOrbUsed,
      direction,
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

      const dtPerInput = SERVER_TICK_S / queue.length;

      for (const input of queue) {
        const result = applyInputWithCollision(
          player.x,
          player.y,
          input,
          dtPerInput,
          this.map,
          this.portalPosition,
        );
        player.x = result.x;
        player.y = result.y;

        if (input.sequenceNumber > player.lastProcessedInput) {
          player.lastProcessedInput = input.sequenceNumber;
        }
      }

      // Derive facing & isMoving from the LAST input in the queue
      const lastInput = queue[queue.length - 1];
      const hasMovement = lastInput.up || lastInput.down || lastInput.left || lastInput.right;
      player.isMoving = hasMovement;

      if (hasMovement) {
        // Priority: down > up > right > left (arbitrary but consistent)
        let newFacing: FacingDirection = player.facing;
        if (lastInput.left) newFacing = 'left';
        if (lastInput.right) newFacing = 'right';
        if (lastInput.up) newFacing = 'up';
        if (lastInput.down) newFacing = 'down';
        player.facing = newFacing;
      }

      queue.length = 0;
    }

    const update: TickUpdateMessage = {
      type: MessageType.TickUpdate,
      gameState: this.cloneState(),
    };
    this.broadcast(update);
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
      players: this.state.players.map((p) => ({ ...p })),
      runestones: this.runestones.map((r) => ({ ...r })),
      portal: this.portalPosition ? { ...this.portalPosition } : null,
    };
  }

  destroy(): void {
    this.stopLoop();
    this.sockets.clear();
    this.inputQueues.clear();
    this.state.players = [];
  }
}
