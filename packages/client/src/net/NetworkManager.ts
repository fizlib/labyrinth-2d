// packages/client/src/net/NetworkManager.ts
// ─────────────────────────────────────────────────────────────────────────────
// NetworkManager — Client-side WebSocket connection to the authoritative server.
//
// Step 4 changes:
// - sendInput() now accepts a sequenceNumber from the caller (main.ts manages
//   the counter so it can store the input in pendingInputs for reconciliation).
// ─────────────────────────────────────────────────────────────────────────────

import {
  MessageType,
  DEFAULT_ROOM_ID,
  type GameState,
  type HubDirection,
  type JoinRoomMessage,
  type PlayerInputMessage,
  type ActivateRunestoneMessage,
  type UseWisdomOrbMessage,
  type DebugTeleportMessage,
  type ServerToClientMessage,
} from '@labyrinth/shared';

/** Callback signatures for network events. */
export interface NetworkCallbacks {
  onRoomJoined: (roomId: string, playerId: string, mapSeed: number, gameState: GameState) => void;
  onTickUpdate: (gameState: GameState) => void;
  onPlayerLeft: (playerId: string) => void;
  onRunestoneActivated: (runestoneIndex: number) => void;
  onAllRunestonesActivated: (portalX: number, portalY: number) => void;
  onWisdomOrbUsed: (direction: HubDirection, remainingWisdomOrbs: number) => void;
  onGateStateChanged: (gateIndex: number, open: boolean) => void;
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
        this.callbacks.onRoomJoined(msg.roomId, msg.playerId, msg.mapSeed, msg.gameState);
        break;

      case MessageType.TickUpdate:
        this._gameState = msg.gameState;
        this.callbacks.onTickUpdate(msg.gameState);
        break;

      case MessageType.PlayerLeft:
        this.callbacks.onPlayerLeft(msg.playerId);
        break;

      case MessageType.RunestoneActivated:
        this.callbacks.onRunestoneActivated(msg.runestoneIndex);
        break;

      case MessageType.AllRunestonesActivated:
        this.callbacks.onAllRunestonesActivated(msg.portalX, msg.portalY);
        break;

      case MessageType.WisdomOrbUsed:
        if (this._gameState && this._playerId) {
          const localPlayer = this._gameState.players.find((player) => player.id === this._playerId);
          if (localPlayer) {
            localPlayer.wisdomOrbs = msg.remainingWisdomOrbs;
          }
        }
        this.callbacks.onWisdomOrbUsed(msg.direction, msg.remainingWisdomOrbs);
        break;

      case MessageType.Error:
        this.callbacks.onError(msg.code, msg.message);
        break;

      case MessageType.GateStateChanged:
        this.callbacks.onGateStateChanged(msg.gateIndex, msg.open);
        break;

      default:
        console.warn('[Net] Unknown message type:', (msg as { type: string }).type);
    }
  }

  // ── Sending ─────────────────────────────────────────────────────────────

  /**
   * Send a player input to the server with a specific sequence number.
   * The sequence number is managed by the caller (main.ts) for reconciliation.
   */
  sendInput(
    sequenceNumber: number,
    up: boolean,
    down: boolean,
    left: boolean,
    right: boolean,
    dt: number,
  ): void {
    const msg: PlayerInputMessage = {
      type: MessageType.PlayerInput,
      sequenceNumber,
      up,
      down,
      left,
      right,
      dt,
    };
    this.send(msg);
  }

  /** Send a runestone activation request to the server. */
  sendActivateRunestone(runestoneIndex: number): void {
    const msg: ActivateRunestoneMessage = {
      type: MessageType.ActivateRunestone,
      runestoneIndex,
    };
    this.send(msg);
  }

  /** Send a wisdom orb use request to the server. */
  sendUseWisdomOrb(): void {
    console.info('[WisdomOrb][Net] Sending USE_WISDOM_ORB to server');
    const msg: UseWisdomOrbMessage = {
      type: MessageType.UseWisdomOrb,
    };
    this.send(msg);
  }

  /** Send a debug teleport position to the server. */
  sendDebugTeleport(x: number, y: number): void {
    const msg: DebugTeleportMessage = {
      type: MessageType.DebugTeleport,
      x,
      y,
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
