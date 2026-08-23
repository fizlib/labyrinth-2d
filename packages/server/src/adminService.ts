import type {
  AdminAuditAction,
  AdminAuditEntry,
  AdminCompletedRoundDetail,
  AdminCompletedRoundSummary,
  AdminMutationResult,
  AdminOverview,
  AdminPage,
  AdminRoomSnapshot,
  AdminUserSummary,
} from '@labyrinth/shared';
import { ADMIN_DEFAULT_PAGE_SIZE, ADMIN_MAX_PAGE_SIZE } from '@labyrinth/shared';

import {
  getSupabaseAdminClient,
  isSupabaseAdminConfigured,
  verifyPlayerAccessToken,
  type VerifiedPlayerIdentity,
} from './supabaseAdmin.js';

const DIRECTORY_CACHE_MS = 30_000;
const OVERVIEW_CACHE_MS = 30_000;
const TABLE_PAGE_SIZE = 1_000;
const AUTH_PAGE_SIZE = 1_000;
const LONG_AUTH_BAN = '876000h';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface ProfileRow {
  id: string;
  display_name: string;
  avatar_url: string | null;
  is_admin: boolean;
  suspended_at: string | null;
  display_name_chosen: boolean;
  created_at: string;
  updated_at: string;
}

interface StatsRow {
  profile_id: string;
  rating: number;
  matches_played: number;
  rated_matches: number;
  wins: number;
  losses: number;
}

interface MatchRow {
  id: string;
  room_id: string;
  winner: 'survivors' | 'wardens';
  player_count: number;
  authenticated_player_count: number;
  rated: boolean;
  started_at: string;
  ended_at: string;
  created_at: string;
}

interface ParticipantRow {
  profile_id: string;
  display_name: string;
  role: 'survivor' | 'warden';
  outcome: 'win' | 'loss';
  escaped: boolean;
  abandoned: boolean;
  rating_before: number;
  rating_delta: number;
  rating_after: number;
}

interface GuestParticipantRow {
  participant_id: string;
  display_name: string;
  role: 'survivor' | 'warden';
  outcome: 'win' | 'loss';
  escaped: boolean;
  abandoned: boolean;
}

interface AuditRow {
  id: number;
  actor_id: string;
  target_id: string;
  action: AdminAuditAction;
  before_value: Record<string, unknown>;
  after_value: Record<string, unknown>;
  reason: string | null;
  created_at: string;
}

type DirectoryUser = Omit<AdminUserSummary, 'currentRoomId'>;

let directoryCache: { expiresAt: number; users: DirectoryUser[] } | null = null;
let overviewCache: {
  expiresAt: number;
  counts: Pick<
    AdminOverview,
    'registeredUsers' | 'suspendedUsers' | 'completedRounds' | 'ratedRounds'
  >;
} | null = null;

export class AdminServiceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function requireConfiguration(): void {
  if (!isSupabaseAdminConfigured) {
    throw new AdminServiceError(
      503,
      'ADMIN_NOT_CONFIGURED',
      'Administrator data access is not configured on the game server.',
    );
  }
}

export async function authorizeAdmin(
  accessToken: string | null,
): Promise<VerifiedPlayerIdentity> {
  requireConfiguration();
  if (!accessToken) {
    throw new AdminServiceError(401, 'AUTH_REQUIRED', 'Sign in is required.');
  }
  const identity = await verifyPlayerAccessToken(accessToken);
  if (!identity) {
    throw new AdminServiceError(401, 'INVALID_TOKEN', 'Your session is no longer valid.');
  }
  if (identity.suspendedAt) {
    throw new AdminServiceError(403, 'ACCOUNT_SUSPENDED', 'This account is suspended.');
  }
  if (!identity.isAdmin) {
    throw new AdminServiceError(
      403,
      'ADMIN_REQUIRED',
      'Administrator access is required.',
    );
  }
  return identity;
}

function pageNumber(value: string | null): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function pageSize(value: string | null): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isInteger(parsed) || parsed < 1) return ADMIN_DEFAULT_PAGE_SIZE;
  return Math.min(ADMIN_MAX_PAGE_SIZE, parsed);
}

export function readPagination(query: URLSearchParams): {
  page: number;
  perPage: number;
} {
  return {
    page: pageNumber(query.get('page')),
    perPage: pageSize(query.get('perPage')),
  };
}

function currentRoomByProfile(
  rooms: readonly AdminRoomSnapshot[],
): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  for (const room of rooms) {
    for (const player of room.players) {
      if (player.profileId) result.set(player.profileId, room.roomId);
    }
  }
  return result;
}

function withCurrentRoom(
  user: DirectoryUser,
  roomByProfile: ReadonlyMap<string, string>,
): AdminUserSummary {
  return { ...user, currentRoomId: roomByProfile.get(user.id) ?? null };
}

async function fetchAllProfiles(): Promise<ProfileRow[]> {
  const client = getSupabaseAdminClient();
  const rows: ProfileRow[] = [];
  for (let offset = 0; ; offset += TABLE_PAGE_SIZE) {
    const { data, error } = await client
      .from('profiles')
      .select(
        'id, display_name, avatar_url, is_admin, suspended_at, display_name_chosen, created_at, updated_at',
      )
      .order('created_at', { ascending: false })
      .range(offset, offset + TABLE_PAGE_SIZE - 1);
    if (error) throw new AdminServiceError(502, 'SUPABASE_ERROR', error.message);
    const batch = (data ?? []) as ProfileRow[];
    rows.push(...batch);
    if (batch.length < TABLE_PAGE_SIZE) return rows;
  }
}

async function fetchAllStats(): Promise<StatsRow[]> {
  const client = getSupabaseAdminClient();
  const rows: StatsRow[] = [];
  for (let offset = 0; ; offset += TABLE_PAGE_SIZE) {
    const { data, error } = await client
      .from('player_stats')
      .select('profile_id, rating, matches_played, rated_matches, wins, losses')
      .range(offset, offset + TABLE_PAGE_SIZE - 1);
    if (error) throw new AdminServiceError(502, 'SUPABASE_ERROR', error.message);
    const batch = (data ?? []) as StatsRow[];
    rows.push(...batch);
    if (batch.length < TABLE_PAGE_SIZE) return rows;
  }
}

async function fetchAllAuthUsers() {
  const client = getSupabaseAdminClient();
  const users = [];
  for (let page = 1; page <= 100; page++) {
    const { data, error } = await client.auth.admin.listUsers({
      page,
      perPage: AUTH_PAGE_SIZE,
    });
    if (error) throw new AdminServiceError(502, 'SUPABASE_AUTH_ERROR', error.message);
    users.push(...data.users);
    if (data.users.length < AUTH_PAGE_SIZE) return users;
  }
  throw new AdminServiceError(
    502,
    'USER_DIRECTORY_TOO_LARGE',
    'The user directory exceeded the supported paging limit.',
  );
}

async function getDirectory(force = false): Promise<DirectoryUser[]> {
  const now = Date.now();
  if (!force && directoryCache && directoryCache.expiresAt > now) {
    return directoryCache.users;
  }

  const [profiles, stats, authUsers] = await Promise.all([
    fetchAllProfiles(),
    fetchAllStats(),
    fetchAllAuthUsers(),
  ]);
  const statsById = new Map(stats.map((row) => [row.profile_id, row]));
  const authById = new Map(authUsers.map((user) => [user.id, user]));
  const users = profiles.map((profile): DirectoryUser => {
    const playerStats = statsById.get(profile.id);
    const authUser = authById.get(profile.id);
    return {
      id: profile.id,
      email: authUser?.email ?? null,
      displayName: profile.display_name,
      avatarUrl: profile.avatar_url,
      isAdmin: profile.is_admin,
      suspendedAt: profile.suspended_at,
      authBannedUntil: authUser?.banned_until ?? null,
      displayNameChosen: profile.display_name_chosen,
      createdAt: authUser?.created_at ?? profile.created_at,
      updatedAt: profile.updated_at,
      lastSignInAt: authUser?.last_sign_in_at ?? null,
      rating: playerStats?.rating ?? 1200,
      matchesPlayed: playerStats?.matches_played ?? 0,
      ratedMatches: playerStats?.rated_matches ?? 0,
      wins: playerStats?.wins ?? 0,
      losses: playerStats?.losses ?? 0,
    };
  });
  directoryCache = { expiresAt: now + DIRECTORY_CACHE_MS, users };
  return users;
}

function invalidateAdminCaches(): void {
  directoryCache = null;
  overviewCache = null;
}

async function getPersistentOverviewCounts() {
  const now = Date.now();
  if (overviewCache && overviewCache.expiresAt > now) return overviewCache.counts;
  const client = getSupabaseAdminClient();
  const [users, suspended, rounds, rated] = await Promise.all([
    client.from('profiles').select('id', { count: 'exact', head: true }),
    client
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .not('suspended_at', 'is', null),
    client.from('matches').select('id', { count: 'exact', head: true }),
    client.from('matches').select('id', { count: 'exact', head: true }).eq('rated', true),
  ]);
  for (const result of [users, suspended, rounds, rated]) {
    if (result.error) {
      throw new AdminServiceError(502, 'SUPABASE_ERROR', result.error.message);
    }
  }
  const counts = {
    registeredUsers: users.count ?? 0,
    suspendedUsers: suspended.count ?? 0,
    completedRounds: rounds.count ?? 0,
    ratedRounds: rated.count ?? 0,
  };
  overviewCache = { expiresAt: now + OVERVIEW_CACHE_MS, counts };
  return counts;
}

export async function getAdminOverview(
  rooms: readonly AdminRoomSnapshot[],
): Promise<AdminOverview> {
  requireConfiguration();
  const counts = await getPersistentOverviewCounts();
  return {
    generatedAt: new Date().toISOString(),
    ...counts,
    activeRooms: rooms.length,
    runningRounds: rooms.filter((room) => room.phase === 'running').length,
    connectedRegisteredPlayers: rooms.reduce(
      (total, room) =>
        total +
        room.players.filter((player) => player.connected && !player.isGuest).length,
      0,
    ),
    connectedGuests: rooms.reduce(
      (total, room) =>
        total +
        room.players.filter((player) => player.connected && player.isGuest).length,
      0,
    ),
    rooms: [...rooms].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  };
}

export async function listAdminUsers(
  query: URLSearchParams,
  rooms: readonly AdminRoomSnapshot[],
): Promise<AdminPage<AdminUserSummary>> {
  requireConfiguration();
  const { page, perPage } = readPagination(query);
  const search = (query.get('q') ?? '').trim().toLocaleLowerCase();
  const adminFilter = query.get('admin') ?? 'all';
  const suspensionFilter = query.get('suspension') ?? 'all';
  const roomByProfile = currentRoomByProfile(rooms);
  const directory = await getDirectory();
  const filtered = directory.filter((user) => {
    if (
      search &&
      !user.id.toLocaleLowerCase().includes(search) &&
      !user.displayName.toLocaleLowerCase().includes(search) &&
      !user.email?.toLocaleLowerCase().includes(search)
    ) {
      return false;
    }
    if (adminFilter === 'admin' && !user.isAdmin) return false;
    if (adminFilter === 'user' && user.isAdmin) return false;
    if (suspensionFilter === 'suspended' && !user.suspendedAt) return false;
    if (suspensionFilter === 'active' && user.suspendedAt) return false;
    return true;
  });
  const offset = (page - 1) * perPage;
  return {
    items: filtered
      .slice(offset, offset + perPage)
      .map((user) => withCurrentRoom(user, roomByProfile)),
    page,
    perPage,
    total: filtered.length,
  };
}

async function userMutationResult(
  targetId: string,
  rooms: readonly AdminRoomSnapshot[],
  warning?: string,
): Promise<AdminMutationResult> {
  const directory = await getDirectory(true);
  const user = directory.find((candidate) => candidate.id === targetId);
  if (!user) throw new AdminServiceError(404, 'USER_NOT_FOUND', 'User not found.');
  return {
    user: withCurrentRoom(user, currentRoomByProfile(rooms)),
    ...(warning ? { warning } : {}),
  };
}

function validateTargetId(targetId: string): void {
  if (!UUID_PATTERN.test(targetId)) {
    throw new AdminServiceError(400, 'INVALID_USER_ID', 'A valid user ID is required.');
  }
}

function mapRpcError(error: { message: string; code?: string }): AdminServiceError {
  const message = error.message || 'The administrator action failed.';
  if (error.code === '42501')
    return new AdminServiceError(403, 'ADMIN_REQUIRED', message);
  if (error.code === 'P0002' || /not found/i.test(message)) {
    return new AdminServiceError(404, 'USER_NOT_FOUND', message);
  }
  if (/final active|cannot|suspended user/i.test(message)) {
    return new AdminServiceError(409, 'ADMIN_SAFEGUARD', message);
  }
  return new AdminServiceError(400, 'INVALID_ADMIN_ACTION', message);
}

export async function updateAdminUserProfile(
  actorId: string,
  targetId: string,
  displayName: string,
  avatarUrl: string,
  rooms: readonly AdminRoomSnapshot[],
): Promise<AdminMutationResult> {
  validateTargetId(targetId);
  const { error } = await getSupabaseAdminClient().rpc('admin_update_user_profile', {
    p_actor_id: actorId,
    p_target_id: targetId,
    p_display_name: displayName,
    p_avatar_url: avatarUrl,
  });
  if (error) throw mapRpcError(error);
  invalidateAdminCaches();
  return userMutationResult(targetId, rooms);
}

export async function setAdminUserRole(
  actorId: string,
  targetId: string,
  isAdmin: boolean,
  rooms: readonly AdminRoomSnapshot[],
  applyToLiveRoom: (userId: string, isAdmin: boolean) => void,
): Promise<AdminMutationResult> {
  validateTargetId(targetId);
  const { error } = await getSupabaseAdminClient().rpc('admin_set_user_admin', {
    p_actor_id: actorId,
    p_target_id: targetId,
    p_is_admin: isAdmin,
  });
  if (error) throw mapRpcError(error);
  applyToLiveRoom(targetId, isAdmin);
  invalidateAdminCaches();
  return userMutationResult(targetId, rooms);
}

export async function setAdminUserSuspension(
  actorId: string,
  targetId: string,
  suspended: boolean,
  reason: string,
  rooms: readonly AdminRoomSnapshot[],
  removeFromRoom: (userId: string) => void,
): Promise<AdminMutationResult> {
  validateTargetId(targetId);
  const client = getSupabaseAdminClient();

  if (!suspended) {
    const { error: authError } = await client.auth.admin.updateUserById(targetId, {
      ban_duration: 'none',
    });
    if (authError) {
      throw new AdminServiceError(502, 'AUTH_SYNC_FAILED', authError.message);
    }
  }

  const { error } = await client.rpc('admin_set_user_suspension', {
    p_actor_id: actorId,
    p_target_id: targetId,
    p_suspended: suspended,
    p_reason: reason,
  });
  if (error) throw mapRpcError(error);

  let warning: string | undefined;
  if (suspended) {
    removeFromRoom(targetId);
    const { error: authError } = await client.auth.admin.updateUserById(targetId, {
      ban_duration: LONG_AUTH_BAN,
    });
    if (authError) {
      warning =
        'Application access is blocked, but the Supabase sign-in ban could not be synchronized. Use Retry Auth ban to synchronize it.';
    }
  }

  invalidateAdminCaches();
  const result = await userMutationResult(targetId, rooms, warning);
  if (suspended) result.user.currentRoomId = null;
  return result;
}

function mapMatch(row: MatchRow): AdminCompletedRoundSummary {
  return {
    id: row.id,
    roomId: row.room_id,
    winner: row.winner,
    playerCount: row.player_count,
    authenticatedPlayerCount: row.authenticated_player_count,
    rated: row.rated,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    createdAt: row.created_at,
  };
}

export async function listCompletedRounds(
  query: URLSearchParams,
): Promise<AdminPage<AdminCompletedRoundSummary>> {
  requireConfiguration();
  const { page, perPage } = readPagination(query);
  const search = (query.get('q') ?? '').trim();
  const winner = query.get('winner') ?? 'all';
  const rated = query.get('rated') ?? 'all';
  const offset = (page - 1) * perPage;
  let request = getSupabaseAdminClient()
    .from('matches')
    .select(
      'id, room_id, winner, player_count, authenticated_player_count, rated, started_at, ended_at, created_at',
      { count: 'exact' },
    )
    .order('ended_at', { ascending: false })
    .range(offset, offset + perPage - 1);
  if (search) {
    request = UUID_PATTERN.test(search)
      ? request.or(`id.eq.${search},room_id.ilike.%${search}%`)
      : request.ilike('room_id', `%${search.replace(/[%_,()]/g, '')}%`);
  }
  if (winner === 'survivors' || winner === 'wardens')
    request = request.eq('winner', winner);
  if (rated === 'rated') request = request.eq('rated', true);
  if (rated === 'unrated') request = request.eq('rated', false);
  const { data, error, count } = await request;
  if (error) throw new AdminServiceError(502, 'SUPABASE_ERROR', error.message);
  return {
    items: ((data ?? []) as MatchRow[]).map(mapMatch),
    page,
    perPage,
    total: count ?? 0,
  };
}

export async function getCompletedRound(
  roundId: string,
): Promise<AdminCompletedRoundDetail> {
  requireConfiguration();
  if (!UUID_PATTERN.test(roundId)) {
    throw new AdminServiceError(400, 'INVALID_ROUND_ID', 'A valid round ID is required.');
  }
  const client = getSupabaseAdminClient();
  const [
    { data: match, error: matchError },
    { data: participants, error: participantError },
    { data: guestParticipants, error: guestParticipantError },
  ] = await Promise.all([
    client
      .from('matches')
      .select(
        'id, room_id, winner, player_count, authenticated_player_count, rated, started_at, ended_at, created_at',
      )
      .eq('id', roundId)
      .maybeSingle(),
    client
      .from('match_participants')
      .select(
        'profile_id, display_name, role, outcome, escaped, abandoned, rating_before, rating_delta, rating_after',
      )
      .eq('match_id', roundId)
      .order('display_name'),
    client
      .from('match_guest_participants')
      .select('participant_id, display_name, role, outcome, escaped, abandoned')
      .eq('match_id', roundId)
      .order('display_name'),
  ]);
  if (matchError) throw new AdminServiceError(502, 'SUPABASE_ERROR', matchError.message);
  if (!match) throw new AdminServiceError(404, 'ROUND_NOT_FOUND', 'Round not found.');
  if (participantError) {
    throw new AdminServiceError(502, 'SUPABASE_ERROR', participantError.message);
  }
  if (guestParticipantError) {
    throw new AdminServiceError(502, 'SUPABASE_ERROR', guestParticipantError.message);
  }
  const registered = ((participants ?? []) as ParticipantRow[]).map((participant) => ({
    profileId: participant.profile_id,
    isGuest: false,
    displayName: participant.display_name,
    role: participant.role,
    outcome: participant.outcome,
    escaped: participant.escaped,
    abandoned: participant.abandoned,
    ratingBefore: participant.rating_before,
    ratingDelta: participant.rating_delta,
    ratingAfter: participant.rating_after,
  }));
  const guests = ((guestParticipants ?? []) as GuestParticipantRow[]).map(
    (participant) => ({
      profileId: null,
      isGuest: true,
      displayName: participant.display_name,
      role: participant.role,
      outcome: participant.outcome,
      escaped: participant.escaped,
      abandoned: participant.abandoned,
      ratingBefore: null,
      ratingDelta: null,
      ratingAfter: null,
    }),
  );
  return {
    ...mapMatch(match as MatchRow),
    participants: [...registered, ...guests].sort((left, right) =>
      left.displayName.localeCompare(right.displayName),
    ),
  };
}

export async function listAdminActivity(
  query: URLSearchParams,
): Promise<AdminPage<AdminAuditEntry>> {
  requireConfiguration();
  const { page, perPage } = readPagination(query);
  const offset = (page - 1) * perPage;
  const { data, error, count } = await getSupabaseAdminClient()
    .from('admin_audit_log')
    .select(
      'id, actor_id, target_id, action, before_value, after_value, reason, created_at',
      { count: 'exact' },
    )
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(offset, offset + perPage - 1);
  if (error) throw new AdminServiceError(502, 'SUPABASE_ERROR', error.message);
  const rows = (data ?? []) as AuditRow[];
  const profileIds = [...new Set(rows.flatMap((row) => [row.actor_id, row.target_id]))];
  const names = new Map<string, string>();
  if (profileIds.length > 0) {
    const { data: profiles, error: profileError } = await getSupabaseAdminClient()
      .from('profiles')
      .select('id, display_name')
      .in('id', profileIds);
    if (profileError) {
      throw new AdminServiceError(502, 'SUPABASE_ERROR', profileError.message);
    }
    for (const profile of (profiles ?? []) as Array<{
      id: string;
      display_name: string;
    }>) {
      names.set(profile.id, profile.display_name);
    }
  }
  return {
    items: rows.map((row) => ({
      id: row.id,
      actorId: row.actor_id,
      actorDisplayName: names.get(row.actor_id) ?? row.actor_id,
      targetId: row.target_id,
      targetDisplayName: names.get(row.target_id) ?? row.target_id,
      action: row.action,
      before: row.before_value,
      after: row.after_value,
      reason: row.reason,
      createdAt: row.created_at,
    })),
    page,
    perPage,
    total: count ?? 0,
  };
}
