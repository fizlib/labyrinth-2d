const ADMIN_VERIFICATION_TIMEOUT_MS = 5_000;

interface SupabaseConfiguration {
  url: string;
  publishableKey: string;
}

function readConfiguration(): SupabaseConfiguration | null {
  const configuredUrl = (
    process.env.SUPABASE_URL ??
    process.env.VITE_SUPABASE_URL ??
    ''
  ).trim();
  const publishableKey = (
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    process.env.SUPABASE_ANON_KEY ??
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
    ''
  ).trim();

  try {
    const url = new URL(configuredUrl);
    const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocal)) ||
      publishableKey.length < 20
    ) {
      return null;
    }
    return { url: url.href.replace(/\/$/, ''), publishableKey };
  } catch {
    return null;
  }
}

const configuration = readConfiguration();

export const isSupabaseAdminVerificationConfigured = configuration !== null;

function bearerHeaders(accessToken: string): Record<string, string> {
  return {
    Accept: 'application/json',
    apikey: configuration!.publishableKey,
    Authorization: `Bearer ${accessToken}`,
  };
}

/**
 * Verify the Supabase access token, then read the caller's own profile through
 * RLS. Any missing configuration, invalid token, timeout, or Supabase error
 * fails closed to a regular-player session.
 */
export async function verifyAdminAccessToken(accessToken: unknown): Promise<boolean> {
  if (
    !configuration ||
    typeof accessToken !== 'string' ||
    accessToken.length < 20 ||
    accessToken.length > 4_096
  ) {
    return false;
  }

  try {
    const signal = AbortSignal.timeout(ADMIN_VERIFICATION_TIMEOUT_MS);
    const userResponse = await fetch(`${configuration.url}/auth/v1/user`, {
      headers: bearerHeaders(accessToken),
      signal,
    });
    if (!userResponse.ok) return false;

    const user = (await userResponse.json()) as { id?: unknown };
    if (typeof user.id !== 'string' || !user.id) return false;

    const profileUrl = new URL(`${configuration.url}/rest/v1/profiles`);
    profileUrl.searchParams.set('select', 'is_admin');
    profileUrl.searchParams.set('id', `eq.${user.id}`);
    profileUrl.searchParams.set('limit', '1');
    const profileResponse = await fetch(profileUrl, {
      headers: bearerHeaders(accessToken),
      signal,
    });
    if (!profileResponse.ok) return false;

    const profiles = (await profileResponse.json()) as Array<{ is_admin?: unknown }>;
    return Array.isArray(profiles) && profiles[0]?.is_admin === true;
  } catch (error) {
    console.warn(
      '[Auth] Supabase admin verification failed:',
      error instanceof Error ? error.message : 'Unknown error',
    );
    return false;
  }
}
