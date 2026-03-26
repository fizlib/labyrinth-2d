// packages/server/src/Room.ts
// ─────────────────────────────────────────────────────────────────────────────
// Room — Manages one maze instance and its connected players.
//
// Step 7 changes:
//   - Players spawn at one of 3 SPAWN_POINTS using round-robin assignment.
//   - Tile coordinates converted to pixel coordinates (tile.x * tileSize).
// ─────────────────────────────────────────────────────────────────────────────

import type uWS from 'uWebSockets.js';

import {
  MessageType,
  SERVER_TICK_MS,
  SERVER_TICK_S,
  MAX_PLAYERS_PER_ROOM,
  TILE_SIZE,
  generateMaze,
  SPAWN_POINTS,
  applyInputWithCollision,
  type FacingDirection,
  type TileMapData,
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

  /**
   * Monotonically increasing join counter for round-robin spawn assignment.
   * Never decremented — ensures even distribution even after disconnects.
   */
  private joinCounter = 0;

  /** Random seed used to generate this room's maze. */
  readonly mapSeed: number;

  /** The generated maze tile map for this room. */
  private readonly map: TileMapData;

  constructor(id: string) {
    this.id = id;
    this.mapSeed = Math.floor(Math.random() * 2147483647);
    this.map = generateMaze(this.mapSeed);
    this.state = {
      tick: 0,
      players: [],
    };
    console.info(`[Room:${this.id}] Created with maze seed ${this.mapSeed}`);
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

    // ── Round-Robin Spawn Assignment ────────────────────────────────
    // Player x,y = bottom-center of sprite (feet position)
    const spawnIndex = this.joinCounter % SPAWN_POINTS.length;
    const spawnTile = SPAWN_POINTS[spawnIndex];
    // Center horizontally in the tile, bottom of tile vertically
    const spawnX = (spawnTile.x + 0.5) * TILE_SIZE;
    const spawnY = (spawnTile.y + 1) * TILE_SIZE;
    this.joinCounter++;

    const playerInfo: PlayerInfo = {
      id: playerId,
      displayName,
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
      `[Room:${this.id}] Player joined: ${displayName} (${playerId}) at spawn ${spawnIndex} → (${spawnX}, ${spawnY}) — ${this.playerCount} player(s)`,
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
      if (!queue || queue.length === 0) continue;

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
