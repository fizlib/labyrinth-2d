// packages/server/src/Room.ts
// ─────────────────────────────────────────────────────────────────────────────
// Room — Manages one maze instance and its connected players.
//
// Each room holds the authoritative GameState and runs a fixed-rate game loop
// at ~20 ticks/sec. Every tick it:
//   1. Increments the tick counter.
//   2. Processes ALL queued inputs for each player (not just the latest).
//   3. Applies movement via the shared applyInput() function.
//   4. Updates lastProcessedInput so clients can reconcile.
//   5. Broadcasts a TickUpdate to every connected client.
// ─────────────────────────────────────────────────────────────────────────────

import type uWS from 'uWebSockets.js';

import {
  MessageType,
  SERVER_TICK_MS,
  SERVER_TICK_S,
  MAX_PLAYERS_PER_ROOM,
  SPAWN_X,
  SPAWN_Y,
  applyInput,
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
 * We store the full input + its sequence number so the server can track
 * which inputs have been acknowledged.
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
   * This ensures no inputs are dropped even if multiple arrive per tick.
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

  /** Current number of players in this room. */
  get playerCount(): number {
    return this.sockets.size;
  }

  /** Whether the room has capacity for another player. */
  get isFull(): boolean {
    return this.sockets.size >= MAX_PLAYERS_PER_ROOM;
  }

  /**
   * Add a player to the room.
   * Spawns them at the default coordinate and sends RoomJoined.
   * Starts the game loop if this is the first player.
   */
  addPlayer(ws: PlayerSocket): void {
    const data = ws.getUserData();
    const playerId = data.id;
    const displayName = data.displayName;

    // Register socket
    this.sockets.set(playerId, ws);

    // Initialize empty input queue
    this.inputQueues.set(playerId, []);

    // Add to game state with spawn position
    const playerInfo: PlayerInfo = {
      id: playerId,
      displayName,
      x: SPAWN_X,
      y: SPAWN_Y,
      lastProcessedInput: 0,
    };
    this.state.players.push(playerInfo);

    // Tag the socket so we know which room it's in
    data.roomId = this.id;

    // Send RoomJoined to the joining client with current state
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

    // Start the game loop when the first player joins
    if (this.playerCount === 1) {
      this.startLoop();
    }
  }

  /**
   * Remove a player from the room.
   * Broadcasts `PlayerLeft` to remaining clients.
   * Stops the game loop if the room is now empty.
   */
  removePlayer(playerId: string): void {
    this.sockets.delete(playerId);
    this.inputQueues.delete(playerId);
    this.state.players = this.state.players.filter((p) => p.id !== playerId);

    // Notify remaining players
    const leftMsg: PlayerLeftMessage = {
      type: MessageType.PlayerLeft,
      playerId,
    };
    this.broadcast(leftMsg);

    console.info(
      `[Room:${this.id}] Player left: ${playerId} — ${this.playerCount} player(s) remaining`,
    );

    // Stop the loop when the last player leaves
    if (this.playerCount === 0) {
      this.stopLoop();
    }
  }

  // ── Input Handling ────────────────────────────────────────────────────

  /**
   * Queue a player's input for processing on the next tick.
   * Called from the WebSocket message handler in index.ts.
   * Inputs are NOT applied immediately — they wait for the next tick.
   */
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

  /**
   * Start the fixed-rate server game loop (~20 ticks/sec, 50ms interval).
   */
  private startLoop(): void {
    if (this.loopHandle !== null) return;

    console.info(`[Room:${this.id}] Game loop started (${1000 / SERVER_TICK_MS} tps)`);

    this.loopHandle = setInterval(() => {
      this.tick();
    }, SERVER_TICK_MS);
  }

  /** Stop the game loop. */
  private stopLoop(): void {
    if (this.loopHandle === null) return;

    clearInterval(this.loopHandle);
    this.loopHandle = null;
    console.info(`[Room:${this.id}] Game loop stopped`);
  }

  /**
   * Execute one server tick.
   *
   * For each player:
   *   1. Process ALL queued inputs (may be 0, 1, or many per tick).
   *      Each input is applied with the shared applyInput() and SERVER_TICK_S
   *      divided by the number of inputs to distribute the tick's time budget.
   *      Actually, per the standard Valve/Gabriel Gambetta model, each input
   *      represents one client frame's worth of movement. We apply each with
   *      a fixed dt = SERVER_TICK_S. This means the server processes inputs
   *      at the same rate the client predicted them.
   *   2. Update lastProcessedInput to the highest sequence number processed.
   *   3. Clear the queue.
   */
  private tick(): void {
    // 1. Advance tick counter
    this.state.tick++;

    // 2. Process all queued inputs for each player
    for (const player of this.state.players) {
      const queue = this.inputQueues.get(player.id);
      if (!queue || queue.length === 0) continue;

      // Process each queued input with the same dt the client used for prediction.
      // The client predicts with its frame dt, but for deterministic reconciliation
      // we use a fixed dt per input on the server side. Since the client sends one
      // input per frame, and we want server and client to agree, we use a fixed
      // dt that matches the server tick divided by the number of inputs received.
      // This keeps total displacement per tick proportional regardless of client fps.
      const dtPerInput = SERVER_TICK_S / queue.length;

      for (const input of queue) {
        const result = applyInput(player.x, player.y, input, dtPerInput);
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

  /** Send a message to a single client. */
  private send(ws: PlayerSocket, msg: ServerToClientMessage): void {
    ws.send(JSON.stringify(msg), false);
  }

  /** Broadcast a message to all clients in this room. */
  private broadcast(msg: ServerToClientMessage): void {
    const payload = JSON.stringify(msg);
    for (const ws of this.sockets.values()) {
      ws.send(payload, false);
    }
  }

  /** Create a deep-enough clone of the state for safe serialization. */
  private cloneState(): GameState {
    return {
      tick: this.state.tick,
      players: this.state.players.map((p) => ({ ...p })),
    };
  }

  /** Clean up the room (stop loop, clear all state). */
  destroy(): void {
    this.stopLoop();
    this.sockets.clear();
    this.inputQueues.clear();
    this.state.players = [];
  }
}
