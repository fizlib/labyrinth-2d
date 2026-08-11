import { validateProfileInput, type Profile, type ProfileUpdateInput } from './supabase';

const GUEST_PROFILE_STORAGE_KEY = 'labyrinth.guest-profile.v1';
const UINT32_RANGE = 0x1_0000_0000;

function randomUint32(): number {
  const randomValue = new Uint32Array(1);
  try {
    if (typeof window.crypto?.getRandomValues === 'function') {
      window.crypto.getRandomValues(randomValue);
      return randomValue[0] ?? 0;
    }
  } catch {
    // Web Crypto may be unavailable when the dev server is opened over plain HTTP on a LAN.
  }
  return Math.floor(Math.random() * UINT32_RANGE);
}

function randomGuestSuffix(): string {
  return String(randomUint32() % 10_000).padStart(4, '0');
}

function guestId(): string {
  try {
    const uuid = window.crypto?.randomUUID?.();
    if (uuid) return `guest:${uuid}`;
  } catch {
    // Fall through to a local-only ID when randomUUID requires a secure context.
  }

  const timestamp = Date.now().toString(36);
  const randomPart = [randomUint32(), randomUint32()]
    .map((value) => value.toString(36).padStart(7, '0'))
    .join('');
  return `guest:${timestamp}-${randomPart}`;
}

function storeGuestProfile(profile: Profile): void {
  try {
    window.sessionStorage.setItem(GUEST_PROFILE_STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // Guest mode still works in memory when browser storage is unavailable.
  }
}

function isValidDate(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(new Date(value).getTime());
}

export function loadGuestProfile(): Profile | null {
  let rawProfile: string | null;
  try {
    rawProfile = window.sessionStorage.getItem(GUEST_PROFILE_STORAGE_KEY);
  } catch {
    return null;
  }
  if (!rawProfile) return null;

  try {
    const candidate = JSON.parse(rawProfile) as Partial<Profile>;
    if (
      typeof candidate.id !== 'string'
      || !candidate.id.startsWith('guest:')
      || typeof candidate.display_name !== 'string'
      || (candidate.avatar_url !== null && typeof candidate.avatar_url !== 'string')
      || !isValidDate(candidate.created_at)
      || !isValidDate(candidate.updated_at)
    ) {
      throw new Error('Invalid guest profile');
    }

    const values = validateProfileInput({
      displayName: candidate.display_name,
      avatarUrl: candidate.avatar_url ?? '',
    });
    return {
      id: candidate.id,
      display_name: values.displayName,
      avatar_url: values.avatarUrl,
      created_at: candidate.created_at,
      updated_at: candidate.updated_at,
    };
  } catch {
    clearGuestProfile();
    return null;
  }
}

export function createGuestProfile(): Profile {
  const now = new Date().toISOString();
  const profile: Profile = {
    id: guestId(),
    display_name: `Guest ${randomGuestSuffix()}`,
    avatar_url: null,
    created_at: now,
    updated_at: now,
  };
  storeGuestProfile(profile);
  return profile;
}

export function updateGuestProfile(profile: Profile, input: ProfileUpdateInput): Profile {
  const values = validateProfileInput(input);
  const updatedProfile: Profile = {
    ...profile,
    display_name: values.displayName,
    avatar_url: values.avatarUrl,
    updated_at: new Date().toISOString(),
  };
  storeGuestProfile(updatedProfile);
  return updatedProfile;
}

export function clearGuestProfile(): void {
  try {
    window.sessionStorage.removeItem(GUEST_PROFILE_STORAGE_KEY);
  } catch {
    // There is nothing else to clear when browser storage is unavailable.
  }
}
