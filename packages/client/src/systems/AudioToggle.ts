const AUDIO_MUTED_STORAGE_KEY = 'labyrinth-audio-muted';

export const AUDIO_TOGGLE_SELECTOR = '[data-audio-toggle]';

export function audioToggleMarkup(
  modifierClass: string,
  muted = loadAudioMutedPreference(),
): string {
  const label = muted ? 'Unmute sound' : 'Mute sound';
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

export function loadAudioMutedPreference(): boolean {
  try {
    return window.localStorage.getItem(AUDIO_MUTED_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveAudioMutedPreference(muted: boolean): void {
  try {
    window.localStorage.setItem(AUDIO_MUTED_STORAGE_KEY, muted ? '1' : '0');
  } catch {
    // Muting still works for this session when storage is unavailable.
  }
}

export function syncAudioToggleState(root: ParentNode, muted: boolean): void {
  const label = muted ? 'Unmute sound' : 'Mute sound';
  root.querySelectorAll<HTMLButtonElement>(AUDIO_TOGGLE_SELECTOR).forEach((button) => {
    button.classList.toggle('is-muted', muted);
    button.setAttribute('aria-pressed', muted.toString());
    button.setAttribute('aria-label', label);
    button.title = label;
  });
}
