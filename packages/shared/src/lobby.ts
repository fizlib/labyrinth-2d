/** Maximum number of players in one lobby/match. */
export const LOBBY_MAX_PLAYERS = 9;

/** Minimum population allowed to start through a vote. */
export const LOBBY_MIN_PLAYERS = 6;

/** Time players must wait before an underfilled start vote is available. */
export const LOBBY_VOTE_DELAY_MS = 60_000;

/** Short server-authoritative pause before a locked roster enters the match. */
export const LOBBY_COUNTDOWN_MS = 8_000;

/** Time an unexpectedly disconnected player keeps their occupied room seat. */
export const RECONNECT_GRACE_MS = 45_000;

/** 256-bit base64url bearer token used to reclaim one occupied seat. */
export const RECONNECT_TOKEN_BYTES = 32;
export const RECONNECT_TOKEN_LENGTH = 43;

/** Room codes omit visually ambiguous characters such as 0/O and 1/I. */
export const ROOM_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export const ROOM_CODE_LENGTH = 6;

export type LobbyPhase = 'waiting' | 'countdown';
export type LobbyStartReason = 'full' | 'vote' | null;
export type LobbyJoinMode = 'quick' | 'create' | 'join';

export interface LobbyPlayerInfo {
  id: string;
  displayName: string;
  votedToStart: boolean;
  connected: boolean;
}

/** Public, event-driven state used only before gameplay begins. */
export interface LobbyState {
  roomId: string;
  phase: LobbyPhase;
  players: LobbyPlayerInfo[];
  minPlayers: number;
  maxPlayers: number;
  votesRequired: number;
  voteAvailableAt: number;
  countdownEndsAt: number | null;
  startReason: LobbyStartReason;
}

/** Two thirds of connected players must agree to start an underfilled match. */
export function getLobbyVotesRequired(playerCount: number): number {
  const count = Number.isFinite(playerCount) ? Math.max(0, Math.floor(playerCount)) : 0;
  return Math.max(1, Math.ceil((count * 2) / 3));
}

/** Preserve the intended hidden-role ratio for supported underfilled matches. */
export function getWardenCountForPlayers(playerCount: number): number {
  const count = Number.isFinite(playerCount) ? Math.max(0, Math.floor(playerCount)) : 0;
  if (count === 0) return 0;
  return count >= 7 ? 2 : 1;
}

export function normalizeRoomCode(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

export function isValidRoomCode(value: unknown): boolean {
  const normalized = normalizeRoomCode(value);
  if (normalized.length !== ROOM_CODE_LENGTH) return false;
  return Array.from(normalized).every((character) => ROOM_CODE_ALPHABET.includes(character));
}

export function isValidReconnectToken(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length === RECONNECT_TOKEN_LENGTH &&
    /^[A-Za-z0-9_-]+$/.test(value)
  );
}
