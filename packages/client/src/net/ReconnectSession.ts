import {
  isValidReconnectToken,
  isValidRoomCode,
  normalizeRoomCode,
  RECONNECT_GRACE_MS,
  RECONNECT_TOKEN_BYTES,
  type LobbyJoinMode,
} from '@labyrinth/shared';

const STORAGE_KEY = 'labyrinth.reconnect-seat.v1';

/** Lets the identity shell synchronously release an active seat before sign-out. */
export const RELEASE_ROOM_EVENT = 'labyrinth:release-room';

export interface ReconnectSession {
  identityId: string;
  reconnectToken: string;
  joinMode: LobbyJoinMode;
  requestedRoomId: string;
  roomId: string | null;
  disconnectDeadline: number | null;
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return window.btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function isReconnectSession(value: unknown): value is ReconnectSession {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ReconnectSession>;
  return (
    typeof candidate.identityId === 'string' &&
    isValidReconnectToken(candidate.reconnectToken) &&
    (candidate.joinMode === 'quick' ||
      candidate.joinMode === 'create' ||
      candidate.joinMode === 'join') &&
    typeof candidate.requestedRoomId === 'string' &&
    (candidate.roomId === null || isValidRoomCode(candidate.roomId)) &&
    (candidate.disconnectDeadline === null ||
      (typeof candidate.disconnectDeadline === 'number' &&
        Number.isFinite(candidate.disconnectDeadline)))
  );
}

export function createReconnectSession(
  identityId: string,
  joinMode: LobbyJoinMode,
  requestedRoomId = '',
): ReconnectSession {
  const bytes = new Uint8Array(RECONNECT_TOKEN_BYTES);
  window.crypto.getRandomValues(bytes);
  const session: ReconnectSession = {
    identityId,
    reconnectToken: encodeBase64Url(bytes),
    joinMode,
    requestedRoomId: normalizeRoomCode(requestedRoomId),
    roomId: null,
    disconnectDeadline: null,
  };
  saveReconnectSession(session);
  return session;
}

export function loadReconnectSession(identityId: string): ReconnectSession | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const candidate: unknown = JSON.parse(raw);
    if (!isReconnectSession(candidate) || candidate.identityId !== identityId) {
      clearReconnectSession();
      return null;
    }
    return candidate;
  } catch {
    clearReconnectSession();
    return null;
  }
}

export function saveReconnectSession(session: ReconnectSession): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Automatic in-process reconnect still works when storage is unavailable.
  }
}

export function confirmReconnectRoom(
  session: ReconnectSession,
  roomId: string,
): ReconnectSession {
  const confirmed: ReconnectSession = {
    ...session,
    roomId: normalizeRoomCode(roomId),
    disconnectDeadline: null,
  };
  saveReconnectSession(confirmed);
  return confirmed;
}

export function markReconnectDisconnected(
  session: ReconnectSession,
  now = Date.now(),
): ReconnectSession {
  const disconnected: ReconnectSession = {
    ...session,
    disconnectDeadline: session.disconnectDeadline ?? now + RECONNECT_GRACE_MS,
  };
  saveReconnectSession(disconnected);
  return disconnected;
}

export function clearReconnectSession(): void {
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // There is nothing else to clear when browser storage is unavailable.
  }
}
