import { validateProfileInput, type Profile, type ProfileUpdateInput } from './supabase';

const GUEST_PROFILE_STORAGE_KEY = 'labyrinth.guest-profile.v1';

function randomGuestSuffix(): string {
  const randomValue = new Uint32Array(1);
  window.crypto.getRandomValues(randomValue);
  return String(randomValue[0] % 10_000).padStart(4, '0');
}

function guestId(): string {
  return `guest:${window.crypto.randomUUID()}`;
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
