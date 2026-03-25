// packages/server/src/Room.ts
// ─────────────────────────────────────────────────────────────────────────────
// Room — Manages one maze instance and its connected players.
//
// Each room holds the authoritative GameState and runs a fixed-rate game loop
// at ~20 ticks/sec. Every tick it:
//   1. Increments the tick counter.
//   2. Applies each player's latest input to move them.
//   3. Broadcasts a TickUpdate to every connected client.
// ─────────────────────────────────────────────────────────────────────────────

import type uWS from 'uWebSockets.js';

import {
  MessageType,
  SERVER_TICK_MS,
  MAX_PLAYERS_PER_ROOM,
  PLAYER_SPEED,
  SPAWN_X,
  SPAWN_Y,
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
 * Stores each player's latest input state.
 * The server reads this every tick to apply movement.
 */
interface InputState {
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

  /** Latest input state per player, keyed by player ID. */
  private inputs: Map<string, InputState> = new Map();

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

    // Initialize input state (all keys released)
    this.inputs.set(playerId, { up: false, down: false, left: false, right: false });

    // Add to game state with spawn position
    const playerInfo: PlayerInfo = {
      id: playerId,
      displayName,
      x: SPAWN_X,
      y: SPAWN_Y,
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
    this.inputs.delete(playerId);
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
   * Store a player's latest input state.
   * Called from the WebSocket message handler in index.ts.
   */
  handleInput(playerId: string, msg: PlayerInputMessage): void {
    this.inputs.set(playerId, {
      up: msg.up,
      down: msg.down,
      left: msg.left,
      right: msg.right,
    });
  }

  // ── Game Loop ─────────────────────────────────────────────────────────

  /**
   * Start the fixed-rate server game loop (~20 ticks/sec, 50ms interval).
   * Each tick:
   *   1. Increment the tick counter.
   *   2. Apply movement from each player's latest input.
   *   3. Broadcast TickUpdate (current state) to all clients.
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

  /** Execute one server tick. */
  private tick(): void {
    // 1. Advance tick counter
    this.state.tick++;

    // 2. Apply movement for each player based on their latest input
    for (const player of this.state.players) {
      const input = this.inputs.get(player.id);
      if (!input) continue;

      // Apply constant speed movement in each active direction
      if (input.up) player.y -= PLAYER_SPEED;
      if (input.down) player.y += PLAYER_SPEED;
      if (input.left) player.x -= PLAYER_SPEED;
      if (input.right) player.x += PLAYER_SPEED;
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
    this.inputs.clear();
    this.state.players = [];
  }
}
