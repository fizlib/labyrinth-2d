import type { MatchRecord } from './Room.js';

const SUPABASE_REQUEST_TIMEOUT_MS = 5_000;
const MATCH_WRITE_ATTEMPTS = 3;

interface SupabaseAuthConfiguration {
  url: string;
  publishableKey: string;
}

interface SupabasePersistenceConfiguration {
  url: string;
  secretKey: string;
}

export interface VerifiedPlayerIdentity {
  userId: string;
  displayName: string;
  isAdmin: boolean;
  rating: number;
  ratedMatches: number;
}

function readSupabaseUrl(): string | null {
  const configuredUrl = (
    process.env.SUPABASE_URL ??
    process.env.VITE_SUPABASE_URL ??
    ''
  ).trim();

  try {
    const url = new URL(configuredUrl);
    const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocal)) return null;
    return url.href.replace(/\/$/, '');
  } catch {
    return null;
  }
}

function readAuthConfiguration(): SupabaseAuthConfiguration | null {
  const url = readSupabaseUrl();
  const publishableKey = (
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    process.env.SUPABASE_ANON_KEY ??
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
    ''
  ).trim();
  return url && publishableKey.length >= 20 ? { url, publishableKey } : null;
}

function readPersistenceConfiguration(): SupabasePersistenceConfiguration | null {
  const url = readSupabaseUrl();
  const secretKey = (
    process.env.SUPABASE_SECRET_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    ''
  ).trim();
  return url && secretKey.length >= 20 ? { url, secretKey } : null;
}

const authConfiguration = readAuthConfiguration();
const persistenceConfiguration = readPersistenceConfiguration();

export const isSupabasePlayerVerificationConfigured = authConfiguration !== null;
export const isSupabaseMatchPersistenceConfigured = persistenceConfiguration !== null;

function bearerHeaders(accessToken: string): Record<string, string> {
  return {
    Accept: 'application/json',
    apikey: authConfiguration!.publishableKey,
    Authorization: `Bearer ${accessToken}`,
  };
}

/**
 * Verify a Supabase access token and load the server-trusted identity, admin
 * permission, and current competitive snapshot through owner-only RLS.
 */
export async function verifyPlayerAccessToken(
  accessToken: unknown,
): Promise<VerifiedPlayerIdentity | null> {
  if (
    !authConfiguration ||
    typeof accessToken !== 'string' ||
    accessToken.length < 20 ||
    accessToken.length > 4_096
  ) {
    return null;
  }

  try {
    const signal = AbortSignal.timeout(SUPABASE_REQUEST_TIMEOUT_MS);
    const userResponse = await fetch(`${authConfiguration.url}/auth/v1/user`, {
      headers: bearerHeaders(accessToken),
      signal,
    });
    if (!userResponse.ok) return null;

    const user = (await userResponse.json()) as { id?: unknown };
    if (typeof user.id !== 'string' || !user.id) return null;

    const profileUrl = new URL(`${authConfiguration.url}/rest/v1/profiles`);
    profileUrl.searchParams.set('select', 'display_name,is_admin');
    profileUrl.searchParams.set('id', `eq.${user.id}`);
    profileUrl.searchParams.set('limit', '1');

    const statsUrl = new URL(`${authConfiguration.url}/rest/v1/player_stats`);
    statsUrl.searchParams.set('select', 'rating,rated_matches');
    statsUrl.searchParams.set('profile_id', `eq.${user.id}`);
    statsUrl.searchParams.set('limit', '1');

    const [profileResponse, statsResponse] = await Promise.all([
      fetch(profileUrl, { headers: bearerHeaders(accessToken), signal }),
      fetch(statsUrl, { headers: bearerHeaders(accessToken), signal }),
    ]);
    if (!profileResponse.ok || !statsResponse.ok) return null;

    const profiles = (await profileResponse.json()) as Array<{
      display_name?: unknown;
      is_admin?: unknown;
    }>;
    const stats = (await statsResponse.json()) as Array<{
      rating?: unknown;
      rated_matches?: unknown;
    }>;
    const profile = profiles[0];
    const playerStats = stats[0];
    if (
      !profile ||
      typeof profile.display_name !== 'string' ||
      !playerStats ||
      typeof playerStats.rating !== 'number' ||
      typeof playerStats.rated_matches !== 'number'
    ) {
      return null;
    }

    return {
      userId: user.id,
      displayName: profile.display_name,
      isAdmin: profile.is_admin === true,
      rating: playerStats.rating,
      ratedMatches: playerStats.rated_matches,
    };
  } catch (error) {
    console.warn(
      '[Auth] Supabase player verification failed:',
      error instanceof Error ? error.message : 'Unknown error',
    );
    return null;
  }
}

function waitBeforeRetry(attempt: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
}

function persistenceHeaders(): Record<string, string> {
  const secretKey = persistenceConfiguration!.secretKey;
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    apikey: secretKey,
  };
  // Opaque sb_secret keys must be sent only as apikey. Legacy service_role
  // keys are JWTs and continue to use Authorization as well.
  if (!secretKey.startsWith('sb_secret_')) {
    headers.Authorization = `Bearer ${secretKey}`;
  }
  return headers;
}

/** Persist one completed match through the service-role-only atomic RPC. */
export async function recordMatchResult(record: MatchRecord): Promise<void> {
  if (!persistenceConfiguration) {
    throw new Error('Supabase match persistence is not configured.');
  }

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < MATCH_WRITE_ATTEMPTS; attempt++) {
    try {
      const signal = AbortSignal.timeout(SUPABASE_REQUEST_TIMEOUT_MS);
      const response = await fetch(
        `${persistenceConfiguration.url}/rest/v1/rpc/record_match_result`,
        {
          method: 'POST',
          headers: persistenceHeaders(),
          body: JSON.stringify({
            p_match_id: record.matchId,
            p_room_id: record.roomId,
            p_winner: record.winner,
            p_player_count: record.playerCount,
            p_rated: record.rated,
            p_started_at: record.startedAt,
            p_ended_at: record.endedAt,
            p_participants: record.participants,
          }),
          signal,
        },
      );
      if (!response.ok) {
        throw new Error(`Supabase returned HTTP ${response.status}`);
      }
      console.info(
        `[Match] Recorded ${record.rated ? 'rated' : 'unrated'} match ${record.matchId} (${record.participants.length}/${record.playerCount} authenticated players)`,
      );
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Unknown Supabase error');
      if (attempt + 1 < MATCH_WRITE_ATTEMPTS) await waitBeforeRetry(attempt);
    }
  }

  throw lastError ?? new Error('Unable to record ranked match.');
}
