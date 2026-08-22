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
  type GameState,
  type LobbyState,
  type LobbyChatMessageKind,
  type MatchResultPlayer,
  type PlayerRole,
  type TrapActivationFailureReason,
  type WisdomOrbHint,
  type JoinRoomMessage,
  type ReconnectRoomMessage,
  type LeaveRoomMessage,
  type SnapshotAppliedMessage,
  type VoteToStartMessage,
  type SendLobbyChatMessage,
  type AdminStartGameMessage,
  type AdminKickPlayerMessage,
  type GameReadyMessage,
  type PlayerInputMessage,
  type ActivateRunestoneMessage,
  type OpenChestMessage,
  type PressPressurePlateMessage,
  type PressSpikePlateMessage,
  type ActivateTrapCellMessage,
  type OpenCageMessage,
  type UseWisdomOrbMessage,
  type SendChatMessage,
  type EscapePortalMessage,
  type DebugTeleportMessage,
  type DebugSetMatchTimeMessage,
  type DebugSetNetworkStatsMessage,
  type DebugSetToolsEnabledMessage,
  type DebugPlayerAction,
  type DebugPlayerActionMessage,
  type TickUpdateMessage,
  type ServerToClientMessage,
} from '@labyrinth/shared';
import {
  clearReconnectSession,
  confirmReconnectRoom,
  markReconnectDisconnected,
  type ReconnectSession,
} from './ReconnectSession';
import {
  NetworkDiagnosticsTracker,
  type NetworkDiagnostics,
} from './NetworkDiagnosticsTracker';
import { LatestSnapshotScheduler } from './LatestSnapshotScheduler';

export type NetworkConnectionState =
  | { status: 'connected' }
  | { status: 'reconnecting'; attempt: number; deadline: number }
  | { status: 'failed'; message: string };

/** Callback signatures for network events. */
export interface NetworkCallbacks {
  onLobbyJoined: (
    playerId: string,
    lobby: LobbyState,
    isAdmin: boolean,
    resumed: boolean,
  ) => void;
  onLobbyUpdated: (lobby: LobbyState) => void;
  onLobbyChatMessage: (
    playerId: string,
    displayName: string,
    text: string,
    kind: LobbyChatMessageKind,
    sentAt: number,
  ) => void;
  onLobbyKicked: (message: string) => void;
  onRoomJoined: (
    roomId: string,
    playerId: string,
    mapSeed: number,
    role: PlayerRole,
    wisdomOrbs: number,
    gameState: GameState,
    isAdmin: boolean,
    resumed: boolean,
  ) => void;
  onMatchStarted: (gameState: GameState) => void;
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
  onTrapActivationResult: (
    trapCellIndex: number,
    capturedCount: number,
    failureReason: TrapActivationFailureReason | null,
  ) => void;
  onPlayerTrapped: (cageId: number) => void;
  onChatMessage: (
    playerId: string,
    displayName: string,
    teamId: number,
    text: string,
    durationMs?: number,
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
    finalRoster: MatchResultPlayer[],
  ) => void;
  onError: (code: string, message: string) => void;
  onConnectionState: (state: NetworkConnectionState) => void;
}

export class NetworkManager {
  private static readonly INITIAL_RECONNECT_DELAY_MS = 500;
  private static readonly MAX_RECONNECT_DELAY_MS = 5_000;

  private ws: WebSocket | null = null;
  private callbacks: NetworkCallbacks;
  private connectionUrl: string | null = null;
  private reconnectSession: ReconnectSession | null = null;
  private displayName: string = 'Player';
  private accessToken: string | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private shouldReconnect = false;
  private recovering = false;
  private readonly diagnosticsTracker = new NetworkDiagnosticsTracker();
  private readonly snapshotScheduler: LatestSnapshotScheduler<TickUpdateMessage>;

  /** The latest game state received from the server. */
  private _gameState: GameState | null = null;

  /** The local player's server-assigned ID (set on RoomJoined). */
  private _playerId: string | null = null;

  constructor(callbacks: NetworkCallbacks) {
    this.callbacks = callbacks;
    this.snapshotScheduler = new LatestSnapshotScheduler<TickUpdateMessage>({
      apply: (message) => {
        const { gameState } = message;
        this._gameState = gameState;
        this.callbacks.onTickUpdate(gameState);
        this.diagnosticsTracker.recordSnapshotApplied(performance.now());

        // ACK only after the expensive game-state callback has completed. The
        // server uses this as proof that it can safely send another snapshot.
        if (Number.isSafeInteger(message.snapshotId)) {
          const acknowledgement: SnapshotAppliedMessage = {
            type: MessageType.SnapshotApplied,
            snapshotId: message.snapshotId,
          };
          this.send(acknowledgement);
        }
      },
    });
    window.addEventListener('pagehide', () => {
      if (!this.shouldReconnect || !this.reconnectSession?.roomId) return;
      this.reconnectSession = markReconnectDisconnected(this.reconnectSession);
    });
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

  getNetworkDiagnostics(): NetworkDiagnostics {
    return this.diagnosticsTracker.getDiagnostics(
      performance.now(),
      this.ws?.bufferedAmount ?? 0,
    );
  }

  // ── Connection ──────────────────────────────────────────────────────────

  connect(
    url: string,
    reconnectSession: ReconnectSession,
    displayName: string = 'Player',
    accessToken?: string,
  ): void {
    if (this.ws) {
      console.warn('[Net] Already connected — disconnect first.');
      return;
    }

    this.connectionUrl = url;
    this.reconnectSession = reconnectSession;
    this.recovering =
      reconnectSession.roomId !== null || reconnectSession.disconnectDeadline !== null;
    this.displayName = displayName;
    this.accessToken = accessToken;
    this.shouldReconnect = true;
    this.reconnectAttempt = 0;
    this.clearReconnectTimer();
    this.openConnection();
  }

  private openConnection(): void {
    if (!this.connectionUrl || this.ws) return;

    this.diagnosticsTracker.reset();
    this.snapshotScheduler.reset();
    const url = this.connectionUrl;
    console.info(`[Net] Connecting to ${url}...`);
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      const session = this.reconnectSession;
      if (!session) return;

      if (session.roomId) {
        console.info('[Net] Connected — reclaiming reserved seat');
        const reconnectMsg: ReconnectRoomMessage = {
          type: MessageType.ReconnectRoom,
          roomId: session.roomId,
          reconnectToken: session.reconnectToken,
          supportsSnapshotFlowControl: true,
        };
        this.send(reconnectMsg);
      } else {
        console.info('[Net] Connected — sending JoinRoom');
        const joinMsg: JoinRoomMessage = {
          type: MessageType.JoinRoom,
          roomId: session.requestedRoomId,
          displayName: this.displayName,
          mode: session.joinMode,
          reconnectToken: session.reconnectToken,
          accessToken: this.accessToken,
          supportsSnapshotFlowControl: true,
        };
        this.send(joinMsg);
      }
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
      this.snapshotScheduler.reset();
      this.ws = null;
      this.recovering = true;
      if (this.reconnectSession) {
        this.reconnectSession = markReconnectDisconnected(this.reconnectSession);
        this.callbacks.onConnectionState({
          status: 'reconnecting',
          attempt: this.reconnectAttempt + 1,
          deadline: this.reconnectSession.disconnectDeadline!,
        });
      }
      this.scheduleReconnect();
    };

    ws.onerror = (err) => {
      console.error('[Net] WebSocket error:', err);
    };
  }

  /** Gracefully close the connection. */
  disconnect(): void {
    this.leaveRoom();
  }

  /** Explicitly release the occupied seat and stop automatic reconnects. */
  leaveRoom(): void {
    this.shouldReconnect = false;
    this.clearReconnectTimer();
    clearReconnectSession();
    this.reconnectSession = null;

    const ws = this.ws;
    if (!ws) return;

    if (ws.readyState === WebSocket.OPEN) {
      const leaveMessage: LeaveRoomMessage = { type: MessageType.LeaveRoom };
      this.send(leaveMessage);
    }

    // Clear our reference before closing so a new connect() can start right
    // away; the stale socket's close handler is deliberately ignored.
    this.ws = null;
    this._playerId = null;
    this.snapshotScheduler.reset();
    ws.close();
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect || this.reconnectTimer !== null || !this.reconnectSession)
      return;

    const deadline = this.reconnectSession.disconnectDeadline;
    if (deadline !== null && Date.now() >= deadline) {
      this.failReconnect('Your reserved seat expired before the connection recovered.');
      return;
    }

    const delayMs = Math.min(
      NetworkManager.INITIAL_RECONNECT_DELAY_MS * 2 ** this.reconnectAttempt,
      NetworkManager.MAX_RECONNECT_DELAY_MS,
    );
    this.reconnectAttempt += 1;
    console.info(`[Net] Reconnecting in ${delayMs}ms...`);
    if (deadline !== null) {
      this.callbacks.onConnectionState({
        status: 'reconnecting',
        attempt: this.reconnectAttempt,
        deadline,
      });
    }

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

  private finishAdmission(roomId: string): boolean {
    const resumed = this.recovering;
    if (this.reconnectSession) {
      this.reconnectSession = confirmReconnectRoom(this.reconnectSession, roomId);
    }
    this.recovering = false;
    this.reconnectAttempt = 0;
    this.callbacks.onConnectionState({ status: 'connected' });
    return resumed;
  }

  private failReconnect(message: string): void {
    this.shouldReconnect = false;
    this.clearReconnectTimer();
    clearReconnectSession();
    this.reconnectSession = null;
    this.callbacks.onConnectionState({ status: 'failed', message });
    const ws = this.ws;
    this.ws = null;
    if (ws && ws.readyState < WebSocket.CLOSING) ws.close();
  }

  // ── Message Handling ────────────────────────────────────────────────────

  private handleMessage(msg: ServerToClientMessage): void {
    switch (msg.type) {
      case MessageType.LobbyJoined:
        this._playerId = msg.playerId;
        this.callbacks.onLobbyJoined(
          msg.playerId,
          msg.lobby,
          msg.isAdmin,
          this.finishAdmission(msg.lobby.roomId),
        );
        break;

      case MessageType.LobbyUpdated:
        this.callbacks.onLobbyUpdated(msg.lobby);
        break;

      case MessageType.LobbyChatMessage:
        this.callbacks.onLobbyChatMessage(
          msg.playerId,
          msg.displayName,
          msg.text,
          msg.kind,
          msg.sentAt,
        );
        break;

      case MessageType.LobbyKicked: {
        this.shouldReconnect = false;
        this.clearReconnectTimer();
        clearReconnectSession();
        this.reconnectSession = null;
        this._playerId = null;
        const ws = this.ws;
        this.ws = null;
        if (ws && ws.readyState < WebSocket.CLOSING) ws.close();
        this.callbacks.onLobbyKicked(msg.message);
        break;
      }

      case MessageType.RoomJoined:
        this.snapshotScheduler.reset();
        this._playerId = msg.playerId;
        this._gameState = msg.gameState;
        {
          const resumed = this.finishAdmission(msg.roomId);
          this.callbacks.onRoomJoined(
            msg.roomId,
            msg.playerId,
            msg.mapSeed,
            msg.role,
            msg.wisdomOrbs,
            msg.gameState,
            msg.isAdmin,
            resumed,
          );
        }
        break;

      case MessageType.MatchStarted:
        this._gameState = msg.gameState;
        this.callbacks.onMatchStarted(msg.gameState);
        break;

      case MessageType.TickUpdate:
        {
          const receivedAt = performance.now();
          this.diagnosticsTracker.recordSnapshotReceived(receivedAt);
          if (this.snapshotScheduler.enqueue(msg)) {
            this.diagnosticsTracker.recordSnapshotCoalesced(receivedAt);
          }
        }
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
        if (
          msg.code === 'RECONNECT_FAILED' ||
          msg.code === 'RECONNECT_IN_USE' ||
          msg.code === 'INVALID_RECONNECT_TOKEN'
        ) {
          this.failReconnect(msg.message);
        } else if (!this._playerId) {
          this.shouldReconnect = false;
          clearReconnectSession();
          this.reconnectSession = null;
        }
        this.callbacks.onError(msg.code, msg.message);
        break;

      case MessageType.GateStateChanged:
        this.callbacks.onGateStateChanged(msg.gateIndex, msg.open);
        break;

      case MessageType.TrapActivationResult:
        this.callbacks.onTrapActivationResult(
          msg.trapCellIndex,
          msg.capturedCount,
          msg.failureReason,
        );
        break;

      case MessageType.PlayerTrapped:
        this.callbacks.onPlayerTrapped(msg.cageId);
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
          msg.finalRoster,
        );
        break;

      default:
        console.warn('[Net] Unknown message type:', (msg as { type: string }).type);
    }
  }

  // ── Sending ─────────────────────────────────────────────────────────────

  sendLobbyVote(vote: boolean): void {
    const msg: VoteToStartMessage = {
      type: MessageType.VoteToStart,
      vote,
    };
    this.send(msg);
  }

  sendLobbyChatMessage(text: string): void {
    const msg: SendLobbyChatMessage = {
      type: MessageType.SendLobbyChat,
      text,
    };
    this.send(msg);
  }

  sendAdminStartGame(): void {
    const msg: AdminStartGameMessage = {
      type: MessageType.AdminStartGame,
    };
    this.send(msg);
  }

  sendAdminKickPlayer(playerId: string): void {
    const msg: AdminKickPlayerMessage = {
      type: MessageType.AdminKickPlayer,
      playerId,
    };
    this.send(msg);
  }

  /** Confirm that assets and the initial maze scene are ready for release. */
  sendGameReady(): void {
    const msg: GameReadyMessage = { type: MessageType.GameReady };
    this.send(msg);
  }

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
  ): boolean {
    const msg: PlayerInputMessage = {
      type: MessageType.PlayerInput,
      sequenceNumber,
      up,
      down,
      left,
      right,
      dt,
    };
    const sent = this.send(msg);
    if (sent) this.diagnosticsTracker.recordMovementSent(performance.now());
    return sent;
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

  /** Ask the server to latch one nearby spike-gate plate as a warden. */
  sendPressSpikePlate(spikePlateIndex: number): void {
    const msg: PressSpikePlateMessage = {
      type: MessageType.PressSpikePlate,
      spikePlateIndex,
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

  /** Set room-wide in-match network-stat visibility. */
  sendDebugSetNetworkStats(enabled: boolean): void {
    const msg: DebugSetNetworkStatsMessage = {
      type: MessageType.DebugSetNetworkStats,
      enabled,
    };
    this.send(msg);
  }

  /** Sync this verified admin's local debug-tools switch for chat routing. */
  sendDebugSetToolsEnabled(enabled: boolean): void {
    const msg: DebugSetToolsEnabledMessage = {
      type: MessageType.DebugSetToolsEnabled,
      enabled,
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
  private send(msg: object): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[Net] Cannot send — not connected');
      return false;
    }
    this.ws.send(JSON.stringify(msg));
    return true;
  }
}
