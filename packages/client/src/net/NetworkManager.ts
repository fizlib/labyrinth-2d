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
  type PlayerRole,
  type WisdomOrbHint,
  type JoinRoomMessage,
  type PlayerInputMessage,
  type ActivateRunestoneMessage,
  type OpenChestMessage,
  type PressPressurePlateMessage,
  type ActivateTrapCellMessage,
  type OpenCageMessage,
  type UseWisdomOrbMessage,
  type SendChatMessage,
  type EscapePortalMessage,
  type DebugTeleportMessage,
  type DebugSetMatchTimeMessage,
  type DebugPlayerAction,
  type DebugPlayerActionMessage,
  type ServerToClientMessage,
} from '@labyrinth/shared';

/** Callback signatures for network events. */
export interface NetworkCallbacks {
  onRoomJoined: (
    roomId: string,
    playerId: string,
    mapSeed: number,
    role: PlayerRole,
    wisdomOrbs: number,
    gameState: GameState,
  ) => void;
  onTickUpdate: (gameState: GameState) => void;
  onPlayerLeft: (playerId: string) => void;
  onRunestoneActivated: (runestoneIndex: number) => void;
  onAllRunestonesActivated: (portalX: number, portalY: number) => void;
  onChestOpened: (chestIndex: number, playerId: string) => void;
  onWisdomOrbGranted: (chestIndex: number, wisdomOrbs: number) => void;
  onWisdomOrbUsed: (hint: WisdomOrbHint, remainingWisdomOrbs: number) => void;
  onPlayerRoleChanged: (role: PlayerRole, wisdomOrbs: number) => void;
  onDebugPlayerRole: (playerId: string, role: PlayerRole) => void;
  onGateStateChanged: (gateIndex: number, open: boolean) => void;
  onTrapActivationResult: (trapCellIndex: number, capturedCount: number) => void;
  onChatMessage: (
    playerId: string,
    displayName: string,
    teamId: number,
    text: string,
  ) => void;
  onPlayerEscaped: (
    playerId: string,
    displayName: string,
    portalX: number,
    portalY: number,
    escapedCount: number,
    escapeThreshold: number,
    remainingToEscape: number,
  ) => void;
  onMatchEnded: (
    winner: 'survivors' | 'wardens',
    escapedCount: number,
    escapeThreshold: number,
    remainingMs: number,
  ) => void;
  onError: (code: string, message: string) => void;
  onDisconnect: () => void;
}

export class NetworkManager {
  private static readonly INITIAL_RECONNECT_DELAY_MS = 500;
  private static readonly MAX_RECONNECT_DELAY_MS = 5_000;

  private ws: WebSocket | null = null;
  private callbacks: NetworkCallbacks;
  private connectionUrl: string | null = null;
  private roomId: string = DEFAULT_ROOM_ID;
  private displayName: string = 'Player';
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private shouldReconnect = false;

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

  connect(
    url: string,
    roomId: string = DEFAULT_ROOM_ID,
    displayName: string = 'Player',
  ): void {
    if (this.ws) {
      console.warn('[Net] Already connected — disconnect first.');
      return;
    }

    this.connectionUrl = url;
    this.roomId = roomId;
    this.displayName = displayName;
    this.shouldReconnect = true;
    this.reconnectAttempt = 0;
    this.clearReconnectTimer();
    this.openConnection();
  }

  private openConnection(): void {
    if (!this.connectionUrl || this.ws) return;

    const url = this.connectionUrl;
    console.info(`[Net] Connecting to ${url}...`);
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      console.info('[Net] Connected — sending JoinRoom');
      this.reconnectAttempt = 0;

      const joinMsg: JoinRoomMessage = {
        type: MessageType.JoinRoom,
        roomId: this.roomId,
        displayName: this.displayName,
      };
      this.send(joinMsg);
    };

    ws.onmessage = (event: MessageEvent) => {
      try {
        const msg: ServerToClientMessage = JSON.parse(event.data as string);
        this.handleMessage(msg);
      } catch (err) {
        console.error('[Net] Failed to parse server message:', err);
      }
    };

    ws.onclose = () => {
      // A stale socket can close after a newer reconnect has begun.
      if (this.ws !== ws) return;

      console.info('[Net] Disconnected');
      this.ws = null;
      this._playerId = null;
      this.callbacks.onDisconnect();
      this.scheduleReconnect();
    };

    ws.onerror = (err) => {
      console.error('[Net] WebSocket error:', err);
    };
  }

  /** Gracefully close the connection. */
  disconnect(): void {
    this.shouldReconnect = false;
    this.clearReconnectTimer();

    const ws = this.ws;
    if (!ws) return;

    // Clear our reference before closing so a new connect() can start right
    // away; the stale socket's close handler is deliberately ignored.
    this.ws = null;
    this._playerId = null;
    ws.close();
    this.callbacks.onDisconnect();
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect || this.reconnectTimer !== null) return;

    const delayMs = Math.min(
      NetworkManager.INITIAL_RECONNECT_DELAY_MS * 2 ** this.reconnectAttempt,
      NetworkManager.MAX_RECONNECT_DELAY_MS,
    );
    this.reconnectAttempt += 1;
    console.info(`[Net] Reconnecting in ${delayMs}ms...`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openConnection();
    }, delayMs);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // ── Message Handling ────────────────────────────────────────────────────

  private handleMessage(msg: ServerToClientMessage): void {
    switch (msg.type) {
      case MessageType.RoomJoined:
        this._playerId = msg.playerId;
        this._gameState = msg.gameState;
        this.callbacks.onRoomJoined(
          msg.roomId,
          msg.playerId,
          msg.mapSeed,
          msg.role,
          msg.wisdomOrbs,
          msg.gameState,
        );
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

      case MessageType.ChestOpened:
        this.callbacks.onChestOpened(msg.chestIndex, msg.playerId);
        break;

      case MessageType.WisdomOrbGranted:
        this.callbacks.onWisdomOrbGranted(msg.chestIndex, msg.wisdomOrbs);
        break;

      case MessageType.WisdomOrbUsed:
        this.callbacks.onWisdomOrbUsed(msg.hint, msg.remainingWisdomOrbs);
        break;

      case MessageType.PlayerRoleChanged:
        this.callbacks.onPlayerRoleChanged(msg.role, msg.wisdomOrbs);
        break;

      case MessageType.DebugPlayerRole:
        this.callbacks.onDebugPlayerRole(msg.playerId, msg.role);
        break;

      case MessageType.Error:
        this.callbacks.onError(msg.code, msg.message);
        break;

      case MessageType.GateStateChanged:
        this.callbacks.onGateStateChanged(msg.gateIndex, msg.open);
        break;

      case MessageType.TrapActivationResult:
        this.callbacks.onTrapActivationResult(msg.trapCellIndex, msg.capturedCount);
        break;

      case MessageType.ChatMessage:
        this.callbacks.onChatMessage(msg.playerId, msg.displayName, msg.teamId, msg.text);
        break;

      case MessageType.PlayerEscaped:
        this.callbacks.onPlayerEscaped(
          msg.playerId,
          msg.displayName,
          msg.portalX,
          msg.portalY,
          msg.escapedCount,
          msg.escapeThreshold,
          msg.remainingToEscape,
        );
        break;

      case MessageType.MatchEnded:
        this.callbacks.onMatchEnded(
          msg.winner,
          msg.escapedCount,
          msg.escapeThreshold,
          msg.remainingMs,
        );
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

  /** Request opening one nearby deterministic treasure chest. */
  sendOpenChest(chestIndex: number): void {
    const msg: OpenChestMessage = {
      type: MessageType.OpenChest,
      chestIndex,
    };
    this.send(msg);
  }

  /** Ask the server to latch one nearby gate button as a warden. */
  sendPressPressurePlate(plateId: number): void {
    const msg: PressPressurePlateMessage = {
      type: MessageType.PressPressurePlate,
      plateId,
    };
    this.send(msg);
  }

  /** Fire the trap network from one nearby deterministic trap cell. */
  sendActivateTrapCell(trapCellIndex: number): void {
    const msg: ActivateTrapCellMessage = {
      type: MessageType.ActivateTrapCell,
      trapCellIndex,
    };
    this.send(msg);
  }

  /** Ask the server to open one nearby closed cage for another player. */
  sendOpenCage(cageId: number): void {
    const msg: OpenCageMessage = {
      type: MessageType.OpenCage,
      cageId,
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

  /** Send one proximity-chat message for authoritative validation and routing. */
  sendChatMessage(text: string): void {
    const msg: SendChatMessage = {
      type: MessageType.SendChatMessage,
      text,
    };
    this.send(msg);
  }

  /** Request escape through the active portal. */
  sendEscapePortal(): void {
    const msg: EscapePortalMessage = {
      type: MessageType.EscapePortal,
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

  /** Replace the running match's authoritative time remaining. */
  sendDebugSetMatchTime(remainingMs: number): void {
    const msg: DebugSetMatchTimeMessage = {
      type: MessageType.DebugSetMatchTime,
      remainingMs,
    };
    this.send(msg);
  }

  /** Send an action from the debug player menu. */
  sendDebugPlayerAction(
    targetPlayerId: string,
    action: DebugPlayerAction,
    options: Pick<
      DebugPlayerActionMessage,
      'spriteIndex' | 'teamId' | 'dead' | 'role'
    > = {},
  ): void {
    const msg: DebugPlayerActionMessage = {
      type: MessageType.DebugPlayerAction,
      targetPlayerId,
      action,
      ...options,
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
