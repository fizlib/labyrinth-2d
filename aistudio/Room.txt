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
  generateMaze,
  computeSpawnPoints,
  applyInputWithCollision,
  type FacingDirection,
  type TileMapData,
  type SpawnPoint,
  type GameState,
  type PlayerInfo,
  type PlayerInputMessage,
  type RoomJoinedMessage,
  type TickUpdateMessage,
  type PlayerLeftMessage,
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

export class Room {
  readonly id: string;
  private state: GameState;
  private sockets: Map<string, PlayerSocket> = new Map();
  private inputQueues: Map<string, QueuedInput[]> = new Map();
  private loopHandle: ReturnType<typeof setInterval> | null = null;


  /** Random seed used to generate this room's maze. */
  readonly mapSeed: number;

  /** The generated maze tile map for this room. */
  private readonly map: TileMapData;

  /** Dynamically computed equidistant spawn points (one per team). */
  private readonly spawnPoints: SpawnPoint[];

  constructor(id: string) {
    this.id = id;
    this.mapSeed = Math.floor(Math.random() * 2147483647);
    this.map = generateMaze(this.mapSeed);
    this.spawnPoints = computeSpawnPoints(this.map.data, SPAWN_DISTANCE, MAX_TEAMS);
    this.state = {
      tick: 0,
      players: [],
    };
    console.info(
      `[Room:${this.id}] Created with maze seed ${this.mapSeed}, spawn distance ${SPAWN_DISTANCE}`,
    );
    for (let i = 0; i < this.spawnPoints.length; i++) {
      const sp = this.spawnPoints[i];
      console.info(`  Team ${i} spawn: tile (${sp.x}, ${sp.y}) → px (${(sp.x + 0.5) * TILE_SIZE}, ${(sp.y + 1) * TILE_SIZE})`);
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
    const spawnY = (spawnTile.y + 1) * TILE_SIZE;

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

  // ── Game Loop ─────────────────────────────────────────────────────────

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
    };
  }

  destroy(): void {
    this.stopLoop();
    this.sockets.clear();
    this.inputQueues.clear();
    this.state.players = [];
  }
}
