// packages/server/src/Room.ts
// ─────────────────────────────────────────────────────────────────────────────
// Room — Manages one maze instance and its connected players.
//
// Each room holds the authoritative GameState and runs a fixed-rate game loop
// at ~20 ticks/sec. Every tick it:
//   1. Increments the tick counter.
//   2. Processes ALL queued inputs with collision detection (sliding walls).
//   3. Updates lastProcessedInput so clients can reconcile.
//   4. Broadcasts a TickUpdate to every connected client.
// ─────────────────────────────────────────────────────────────────────────────

import type uWS from 'uWebSockets.js';

import {
  MessageType,
  SERVER_TICK_MS,
  SERVER_TICK_S,
  MAX_PLAYERS_PER_ROOM,
  SPAWN_X,
  SPAWN_Y,
  LEVEL_1_MAP,
  applyInputWithCollision,
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

/** Convenience alias for a uWS WebSocket with our user data. */
type PlayerSocket = uWS.WebSocket<SocketData>;

/**
 * A queued input from a client, waiting to be processed on the next tick.
 */
interface QueuedInput {
  sequenceNumber: number;
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

export class Room {
  /** Unique room identifier. */
  readonly id: string;

  /** Authoritative game state — the single source of truth. */
  private state: GameState;

  /** All connected sockets, keyed by player ID. */
  private sockets: Map<string, PlayerSocket> = new Map();

  /**
   * Input queue per player, keyed by player ID.
   * Inputs arrive between ticks and are ALL processed on the next tick.
   */
  private inputQueues: Map<string, QueuedInput[]> = new Map();

  /** Handle for the setInterval running the game loop. */
  private loopHandle: ReturnType<typeof setInterval> | null = null;

  constructor(id: string) {
    this.id = id;
    this.state = {
      tick: 0,
      players: [],
    };
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

    const playerInfo: PlayerInfo = {
      id: playerId,
      displayName,
      x: SPAWN_X,
      y: SPAWN_Y,
      lastProcessedInput: 0,
    };
    this.state.players.push(playerInfo);

    data.roomId = this.id;

    const joinMsg: RoomJoinedMessage = {
      type: MessageType.RoomJoined,
      roomId: this.id,
      playerId,
      gameState: this.cloneState(),
    };
    this.send(ws, joinMsg);

    console.info(
      `[Room:${this.id}] Player joined: ${displayName} (${playerId}) at (${SPAWN_X}, ${SPAWN_Y}) — ${this.playerCount} player(s)`,
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

  /**
   * Execute one server tick.
   *
   * For each player: process ALL queued inputs using applyInputWithCollision().
   * This enforces wall collision on the server side (authoritative).
   * The shared collision function does axis-independent sliding so players
   * can slide along walls.
   */
  private tick(): void {
    // 1. Advance tick counter
    this.state.tick++;

    // 2. Process all queued inputs for each player
    for (const player of this.state.players) {
      const queue = this.inputQueues.get(player.id);
      if (!queue || queue.length === 0) continue;

      // Distribute the tick's time budget across all queued inputs
      const dtPerInput = SERVER_TICK_S / queue.length;

      for (const input of queue) {
        // Apply movement WITH collision detection against the map
        const result = applyInputWithCollision(
          player.x,
          player.y,
          input,
          dtPerInput,
          LEVEL_1_MAP,
        );
        player.x = result.x;
        player.y = result.y;

        // Track the highest processed sequence number
        if (input.sequenceNumber > player.lastProcessedInput) {
          player.lastProcessedInput = input.sequenceNumber;
        }
      }

      // Clear processed inputs
      queue.length = 0;
    }

    // 3. Broadcast TickUpdate with current state
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
