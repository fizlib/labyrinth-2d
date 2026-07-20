import {
  createClient,
  type Session,
  type SupabaseClient,
  type User,
} from '@supabase/supabase-js';

export type { Session, User };

export interface Profile {
  id: string;
  display_name: string;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProfileUpdateInput {
  displayName: string;
  avatarUrl: string;
}

interface ProfilesTable {
  Row: Profile & Record<string, unknown>;
  Insert: Record<string, unknown> & {
    id: string;
    display_name: string;
    avatar_url?: string | null;
    created_at?: string;
    updated_at?: string;
  };
  Update: Record<string, unknown> & {
    display_name?: string;
    avatar_url?: string | null;
  };
  Relationships: [];
}

interface Database {
  public: {
    Tables: {
      profiles: ProfilesTable;
    };
    Views: Record<never, never>;
    Functions: Record<never, never>;
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
}

export interface SupabaseConfigurationError {
  message: string;
}

export type SupabaseConfiguration =
  | { client: SupabaseClient<Database>; error: null }
  | { client: null; error: SupabaseConfigurationError };

const PROFILE_COLUMNS = 'id, display_name, avatar_url, created_at, updated_at';
const MAX_DISPLAY_NAME_LENGTH = 32;
const MAX_AVATAR_URL_LENGTH = 2048;

function isLocalHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

function validateSupabaseUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' || (url.protocol === 'http:' && isLocalHostname(url.hostname))) {
      return url.href.replace(/\/$/, '');
    }
  } catch {
    // The caller receives one configuration-safe message below.
  }
  return null;
}

export function configureSupabase(): SupabaseConfiguration {
  const configuredUrl = import.meta.env.VITE_SUPABASE_URL?.trim() ?? '';
  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? '';
  const supabaseUrl = validateSupabaseUrl(configuredUrl);

  if (!supabaseUrl || publishableKey.length < 20) {
    return {
      client: null,
      error: {
        message:
          'Supabase is not configured. Add a valid VITE_SUPABASE_URL and browser-safe VITE_SUPABASE_PUBLISHABLE_KEY.',
      },
    };
  }

  return {
    client: createClient<Database>(supabaseUrl, publishableKey, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        persistSession: true,
      },
    }),
    error: null,
  };
}

export function validateProfileInput(input: ProfileUpdateInput): {
  displayName: string;
  avatarUrl: string | null;
} {
  const displayName = input.displayName.trim().replace(/\s+/g, ' ');
  const displayNameLength = Array.from(displayName).length;

  if (displayNameLength < 1 || displayNameLength > MAX_DISPLAY_NAME_LENGTH) {
    throw new Error(`Display name must be between 1 and ${MAX_DISPLAY_NAME_LENGTH} characters.`);
  }

  const rawAvatarUrl = input.avatarUrl.trim();
  if (!rawAvatarUrl) return { displayName, avatarUrl: null };
  if (rawAvatarUrl.length > MAX_AVATAR_URL_LENGTH) {
    throw new Error('Avatar URL is too long.');
  }

  let avatarUrl: URL;
  try {
    avatarUrl = new URL(rawAvatarUrl);
  } catch {
    throw new Error('Avatar URL must be a valid HTTPS URL.');
  }

  if (avatarUrl.protocol !== 'https:' || avatarUrl.username || avatarUrl.password) {
    throw new Error('Avatar URL must be a valid HTTPS URL.');
  }

  return { displayName, avatarUrl: avatarUrl.href };
}

function firstMetadataString(user: User, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = user.user_metadata[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function seedProfileValues(user: User): { displayName: string; avatarUrl: string | null } {
  const metadataName = firstMetadataString(user, ['full_name', 'name', 'user_name']);
  const emailName = user.email?.split('@')[0]?.trim();
  const rawDisplayName = metadataName || emailName || 'Explorer';
  const displayName = Array.from(rawDisplayName.trim().replace(/\s+/g, ' '))
    .slice(0, MAX_DISPLAY_NAME_LENGTH)
    .join('') || 'Explorer';
  const rawAvatarUrl = firstMetadataString(user, ['avatar_url', 'picture']) ?? '';

  try {
    return {
      displayName,
      avatarUrl: validateProfileInput({ displayName, avatarUrl: rawAvatarUrl }).avatarUrl,
    };
  } catch {
    return { displayName, avatarUrl: null };
  }
}

export async function loadOrCreateProfile(
  client: SupabaseClient<Database>,
  user: User,
): Promise<Profile> {
  const { data: existingProfile, error: selectError } = await client
    .from('profiles')
    .select(PROFILE_COLUMNS)
    .eq('id', user.id)
    .maybeSingle();

  if (selectError) throw new Error(`Unable to load your profile: ${selectError.message}`);
  if (existingProfile) return existingProfile;

  const seed = seedProfileValues(user);
  const { data: createdProfile, error: createError } = await client
    .from('profiles')
    .insert({
      id: user.id,
      display_name: seed.displayName,
      avatar_url: seed.avatarUrl,
    })
    .select(PROFILE_COLUMNS)
    .single();

  if (createdProfile) return createdProfile;

  // The database trigger and another browser can both fill the same missing
  // row between the select and insert. Re-read on that harmless race instead
  // of requiring UPDATE permission on identity columns for an UPSERT.
  if (createError?.code === '23505') {
    const { data: racedProfile, error: racedSelectError } = await client
      .from('profiles')
      .select(PROFILE_COLUMNS)
      .eq('id', user.id)
      .single();
    if (racedProfile) return racedProfile;
    throw new Error(
      `Unable to load your profile: ${racedSelectError?.message ?? 'Unknown error'}`,
    );
  }

  throw new Error(`Unable to create your profile: ${createError?.message ?? 'Unknown error'}`);
}

export async function updateProfile(
  client: SupabaseClient<Database>,
  userId: string,
  input: ProfileUpdateInput,
): Promise<Profile> {
  const values = validateProfileInput(input);
  const { data, error } = await client
    .from('profiles')
    .update({
      display_name: values.displayName,
      avatar_url: values.avatarUrl,
    })
    .eq('id', userId)
    .select(PROFILE_COLUMNS)
    .single();

  if (error || !data) {
    throw new Error(`Unable to save your profile: ${error?.message ?? 'Unknown error'}`);
  }
  return data;
}

export function getOAuthErrorFromUrl(): string | null {
  const url = new URL(window.location.href);
  const query = url.searchParams;
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
  return query.get('error_description')
    ?? query.get('error')
    ?? hash.get('error_description')
    ?? hash.get('error');
}

export function clearOAuthParameters(): void {
  const url = new URL(window.location.href);
  const oauthParameters = [
    'code',
    'error',
    'error_code',
    'error_description',
    'access_token',
    'refresh_token',
    'expires_at',
    'expires_in',
    'provider_token',
    'token_type',
  ];

  for (const parameter of oauthParameters) url.searchParams.delete(parameter);
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
  const hadOAuthHash = oauthParameters.some((parameter) => hash.has(parameter));
  if (hadOAuthHash) url.hash = '';
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
}

export function getOAuthRedirectUrl(): string {
  return new URL(import.meta.env.BASE_URL, window.location.origin).href;
}
