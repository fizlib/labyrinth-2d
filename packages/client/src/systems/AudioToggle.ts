const LEGACY_AUDIO_MUTED_STORAGE_KEY = 'labyrinth-audio-muted';
const MUSIC_MUTED_STORAGE_KEY = 'labyrinth-music-muted';
const SOUND_EFFECTS_MUTED_STORAGE_KEY = 'labyrinth-sound-effects-muted';

export interface AudioPreferences {
  musicMuted: boolean;
  soundEffectsMuted: boolean;
}

export const AUDIO_TOGGLE_SELECTOR = '[data-audio-toggle]';

export function audioToggleMarkup(
  modifierClass: string,
  muted = areAllAudioMuted(loadAudioPreferences()),
): string {
  const label = muted ? 'Unmute all audio' : 'Mute all audio';
  return `
    <button
      class="audio-toggle ${modifierClass}${muted ? ' is-muted' : ''}"
      type="button"
      data-audio-toggle
      aria-label="${label}"
      aria-pressed="${muted}"
      title="${label}"
    >
      <svg class="audio-toggle__icon" viewBox="0 0 24 24" aria-hidden="true">
        <path class="audio-toggle__speaker" d="M3.5 9h4.1l4.8-4c.65-.54 1.6-.08 1.6.76v12.48c0 .84-.95 1.3-1.6.76l-4.8-4H3.5z" />
        <path class="audio-toggle__waves" d="M16.5 8.5c1.8 1.9 1.8 5.1 0 7M19.2 5.8c3.25 3.4 3.25 9 0 12.4" />
        <path class="audio-toggle__muted-mark" d="m17 8.5 5 7m0-7-5 7" />
      </svg>
    </button>`;
}

export function loadAudioPreferences(): AudioPreferences {
  try {
    const legacyMuted =
      window.localStorage.getItem(LEGACY_AUDIO_MUTED_STORAGE_KEY) === '1';
    const storedMusicMuted = window.localStorage.getItem(MUSIC_MUTED_STORAGE_KEY);
    const storedSoundEffectsMuted = window.localStorage.getItem(
      SOUND_EFFECTS_MUTED_STORAGE_KEY,
    );
    return {
      musicMuted: storedMusicMuted === null ? legacyMuted : storedMusicMuted === '1',
      soundEffectsMuted:
        storedSoundEffectsMuted === null ? legacyMuted : storedSoundEffectsMuted === '1',
    };
  } catch {
    return { musicMuted: false, soundEffectsMuted: false };
  }
}

export function areAllAudioMuted(preferences: AudioPreferences): boolean {
  return preferences.musicMuted && preferences.soundEffectsMuted;
}

export function saveMusicMutedPreference(muted: boolean): void {
  try {
    window.localStorage.setItem(MUSIC_MUTED_STORAGE_KEY, muted ? '1' : '0');
  } catch {
    // The toggle still works for this session when storage is unavailable.
  }
}

export function saveSoundEffectsMutedPreference(muted: boolean): void {
  try {
    window.localStorage.setItem(SOUND_EFFECTS_MUTED_STORAGE_KEY, muted ? '1' : '0');
  } catch {
    // The toggle still works for this session when storage is unavailable.
  }
}

export function syncAudioToggleState(root: ParentNode, muted: boolean): void {
  const label = muted ? 'Unmute all audio' : 'Mute all audio';
  root.querySelectorAll<HTMLButtonElement>(AUDIO_TOGGLE_SELECTOR).forEach((button) => {
    button.classList.toggle('is-muted', muted);
    button.setAttribute('aria-pressed', muted.toString());
    button.setAttribute('aria-label', label);
    button.title = label;
  });
}
