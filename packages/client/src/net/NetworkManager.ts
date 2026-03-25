// packages/client/src/net/NetworkManager.ts
// ─────────────────────────────────────────────────────────────────────────────
// NetworkManager — Client-side WebSocket connection to the authoritative server.
//
// Handles:
// - Connecting to the uWebSockets.js server.
// - Sending JoinRoom on open.
// - Sending PlayerInput when the local player's keys change.
// - Receiving and dispatching RoomJoined / TickUpdate / PlayerLeft / Error.
// - Storing the latest GameState for the rest of the client to read.
// ─────────────────────────────────────────────────────────────────────────────

import {
  MessageType,
  DEFAULT_ROOM_ID,
  type GameState,
  type JoinRoomMessage,
  type PlayerInputMessage,
  type ServerToClientMessage,
} from '@labyrinth/shared';

/** Callback signatures for network events. */
export interface NetworkCallbacks {
  onRoomJoined: (roomId: string, playerId: string, gameState: GameState) => void;
  onTickUpdate: (gameState: GameState) => void;
  onPlayerLeft: (playerId: string) => void;
  onError: (code: string, message: string) => void;
  onDisconnect: () => void;
}

export class NetworkManager {
  private ws: WebSocket | null = null;
  private callbacks: NetworkCallbacks;

  /** The latest game state received from the server. */
  private _gameState: GameState | null = null;

  /** The local player's server-assigned ID (set on RoomJoined). */
  private _playerId: string | null = null;

  constructor(callbacks: NetworkCallbacks) {
    this.callbacks = callbacks;
  }

  /** Latest game state from the last TickUpdate. */
  get gameState(): GameState | null {
    return this._gameState;
  }

  /** Local player ID assigned by the server. */
  get playerId(): string | null {
    return this._playerId;
  }

  /** Whether the WebSocket is currently open. */
  get isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  // ── Connection ──────────────────────────────────────────────────────────

  /**
   * Connect to the game server and immediately send a JoinRoom message.
   */
  connect(url: string, roomId: string = DEFAULT_ROOM_ID, displayName: string = 'Player'): void {
    if (this.ws) {
      console.warn('[Net] Already connected — disconnect first.');
      return;
    }

    console.info(`[Net] Connecting to ${url}...`);
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      console.info('[Net] Connected — sending JoinRoom');

      const joinMsg: JoinRoomMessage = {
        type: MessageType.JoinRoom,
        roomId,
        displayName,
      };
      this.send(joinMsg);
    };

    this.ws.onmessage = (event: MessageEvent) => {
      try {
        const msg: ServerToClientMessage = JSON.parse(event.data as string);
        this.handleMessage(msg);
      } catch (err) {
        console.error('[Net] Failed to parse server message:', err);
      }
    };

    this.ws.onclose = () => {
      console.info('[Net] Disconnected');
      this.ws = null;
      this._playerId = null;
      this.callbacks.onDisconnect();
    };

    this.ws.onerror = (err) => {
      console.error('[Net] WebSocket error:', err);
    };
  }

  /** Gracefully close the connection. */
  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  // ── Message Handling ────────────────────────────────────────────────────

  private handleMessage(msg: ServerToClientMessage): void {
    switch (msg.type) {
      case MessageType.RoomJoined:
        this._playerId = msg.playerId;
        this._gameState = msg.gameState;
        this.callbacks.onRoomJoined(msg.roomId, msg.playerId, msg.gameState);
        break;

      case MessageType.TickUpdate:
        this._gameState = msg.gameState;
        this.callbacks.onTickUpdate(msg.gameState);
        break;

      case MessageType.PlayerLeft:
        this.callbacks.onPlayerLeft(msg.playerId);
        break;

      case MessageType.Error:
        this.callbacks.onError(msg.code, msg.message);
        break;

      default:
        console.warn('[Net] Unknown message type:', (msg as { type: string }).type);
    }
  }

  // ── Sending ─────────────────────────────────────────────────────────────

  /**
   * Send the current input state to the server.
   * Called whenever WASD/arrow key state changes.
   */
  sendInput(up: boolean, down: boolean, left: boolean, right: boolean): void {
    const msg: PlayerInputMessage = {
      type: MessageType.PlayerInput,
      sequenceNumber: 0, // Placeholder — used for prediction in Step 4
      up,
      down,
      left,
      right,
    };
    this.send(msg);
  }

  /** Send a JSON message to the server. */
  private send(msg: object): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[Net] Cannot send — not connected');
      return;
    }
    this.ws.send(JSON.stringify(msg));
  }
}
