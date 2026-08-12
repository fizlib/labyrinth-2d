import type { AuthChangeEvent } from '@supabase/supabase-js';
import {
  isValidRoomCode,
  normalizeRoomCode,
  type LobbyJoinMode,
} from '@labyrinth/shared';
import {
  clearOAuthParameters,
  configureSupabase,
  getOAuthErrorFromUrl,
  getOAuthRedirectUrl,
  loadOrCreateProfile,
  updateProfile,
  type Profile,
  type Session,
} from './auth/supabase';
import {
  clearGuestProfile,
  createGuestProfile,
  loadGuestProfile,
  updateGuestProfile,
} from './auth/guest';
import {
  clearReconnectSession,
  createReconnectSession,
  loadReconnectSession,
  RELEASE_ROOM_EVENT,
  type ReconnectSession,
} from './net/ReconnectSession';

const PLAY_AGAIN_STORAGE_KEY = 'labyrinth-play-again';

type AppView =
  | 'restoring'
  | 'auth'
  | 'profile-loading'
  | 'profile-error'
  | 'menu'
  | 'join'
  | 'profile'
  | 'launching-game'
  | 'game';

type IdentityMode = 'authenticated' | 'guest';

function getAppRoot(): HTMLDivElement {
  const appRoot = document.querySelector<HTMLDivElement>('#app');
  if (!appRoot) throw new Error('Missing #app');
  return appRoot;
}

const root = getAppRoot();

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function avatarMarkup(profile: Profile, size: 'small' | 'large'): string {
  const initial = Array.from(profile.display_name.trim())[0]?.toUpperCase() ?? '?';
  const image = profile.avatar_url
    ? `<img src="${escapeHtml(profile.avatar_url)}" alt="" referrerpolicy="no-referrer" />`
    : '';
  return `
    <span class="profile-avatar profile-avatar--${size}" aria-hidden="true">
      <span class="profile-avatar__fallback">${escapeHtml(initial)}</span>
      ${image}
    </span>`;
}

function brandMarkup(): string {
  return `
    <div class="app-brand__gate" aria-hidden="true">
      <span class="app-brand__rune">◆</span>
    </div>
    <p class="app-brand__eyebrow">Enter the ancient maze</p>
    <h1 class="app-brand__title">Labyrinth</h1>`;
}

function shellMarkup(content: string, modifier = ''): string {
  return `
    <main class="app-screen ${modifier}">
      <div class="app-parallax" aria-hidden="true">
        <img class="app-parallax__layer app-parallax__layer--sky" src="/assets/home/sky.png" alt="" />
        <img class="app-parallax__layer app-parallax__layer--clouds" src="/assets/home/clouds.png" alt="" />
        <img class="app-parallax__layer app-parallax__layer--hills" src="/assets/home/hills.png" alt="" />
        <img class="app-parallax__layer app-parallax__layer--field" src="/assets/home/field.png" alt="" />
      </div>
      <div class="app-screen__mist" aria-hidden="true"></div>
      ${content}
    </main>`;
}

function gameMarkup(): string {
  return `
    <div id="game-container">
      <section
        id="loading-screen"
        class="loading-screen"
        role="status"
        aria-live="polite"
        aria-busy="true"
        aria-label="Loading Labyrinth 2D"
      >
        <audio
          id="loading-theme"
          src="./assets/audio/main-theme.mp3"
          preload="auto"
          autoplay
          loop
          aria-hidden="true"
        ></audio>
        <div class="loading-screen__landscape" aria-hidden="true">
          <img class="app-parallax__layer app-parallax__layer--sky" src="/assets/home/sky.png" alt="" />
          <img class="app-parallax__layer app-parallax__layer--clouds" src="/assets/home/clouds.png" alt="" />
          <img class="app-parallax__layer app-parallax__layer--hills" src="/assets/home/hills.png" alt="" />
          <img class="app-parallax__layer app-parallax__layer--field" src="/assets/home/field.png" alt="" />
        </div>
        <div class="loading-screen__content">
          <div class="loading-screen__progress-frame">
            <div
              id="loading-progress"
              class="loading-screen__progress"
              role="progressbar"
              aria-label="Game loading progress"
              aria-valuemin="0"
              aria-valuemax="100"
              aria-valuenow="4"
            ></div>
          </div>
          <div class="loading-screen__readout">
            <span id="loading-status">Loading textures</span>
            <span id="loading-percent" aria-hidden="true">04%</span>
          </div>
        </div>
      </section>
    </div>
    <button
      id="fullscreen-toggle"
      class="fullscreen-toggle"
      type="button"
      aria-label="Enter fullscreen"
      aria-pressed="false"
      title="Enter fullscreen"
    >
      <svg class="fullscreen-toggle__icon fullscreen-toggle__icon--enter" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />
      </svg>
      <svg class="fullscreen-toggle__icon fullscreen-toggle__icon--exit" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5" />
      </svg>
    </button>
    <button
      id="game-menu-toggle"
      class="game-menu-toggle"
      type="button"
      aria-label="Open game menu"
      aria-expanded="false"
      title="Game menu (Esc)"
      hidden
    >
      <svg class="game-menu-toggle__icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 7h14M5 12h14M5 17h14" />
      </svg>
    </button>
    <div
      id="ios-fullscreen-help"
      class="fullscreen-help"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ios-fullscreen-help-title"
      hidden
    >
      <div class="fullscreen-help__panel">
        <button id="ios-fullscreen-help-close" class="fullscreen-help__close" type="button" aria-label="Close fullscreen instructions">×</button>
        <h2 id="ios-fullscreen-help-title">Fullscreen on iPhone</h2>
        <p id="ios-fullscreen-help-message">Safari can open this game fullscreen from your Home Screen.</p>
        <ol id="ios-fullscreen-help-steps" class="fullscreen-help__steps">
          <li>Tap Safari’s <span class="fullscreen-help__share-icon" aria-label="Share">⇧</span> <strong>Share</strong> button.</li>
          <li>Choose <strong>Add to Home Screen</strong>, then tap <strong>Add</strong>.</li>
          <li>Open <strong>Labyrinth</strong> from your Home Screen.</li>
        </ol>
        <button id="ios-fullscreen-help-ok" class="fullscreen-help__ok" type="button">Got it</button>
      </div>
    </div>`;
}

class AppController {
  private readonly configuration = configureSupabase();
  private session: Session | null = null;
  private profile: Profile | null = null;
  private identityMode: IdentityMode | null = null;
  private view: AppView = 'restoring';
  private authError: string | null = null;
  private profileError: string | null = null;
  private profileNotice: string | null = null;
  private sessionRevision = 0;
  private gameLaunchStarted = false;
  private restoringInitialSession = true;
  private pendingRoomCode = (() => {
    const code = normalizeRoomCode(new URL(window.location.href).searchParams.get('room'));
    return isValidRoomCode(code) ? code : null;
  })();

  async start(): Promise<void> {
    this.renderRestoring('Restoring your passage…');
    const client = this.configuration.client;

    if (!client) {
      const guestProfile = loadGuestProfile();
      if (guestProfile) {
        this.enterGuestMode(guestProfile);
        return;
      }
      this.authError = this.configuration.error.message;
      this.view = 'auth';
      this.renderAuth();
      return;
    }

    const oauthError = getOAuthErrorFromUrl();
    client.auth.onAuthStateChange(
      (event: AuthChangeEvent, session: Session | null) => {
        if (this.restoringInitialSession && event === 'INITIAL_SESSION') return;
        window.setTimeout(() => void this.handleAuthChange(event, session), 0);
      },
    );

    try {
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      this.authError = oauthError;
      if (data.session) {
        await this.reconcileSession(data.session);
      } else {
        const guestProfile = loadGuestProfile();
        if (guestProfile) this.enterGuestMode(guestProfile);
        else await this.reconcileSession(null);
      }
    } catch (error) {
      this.session = null;
      this.profile = null;
      this.authError = errorMessage(error, 'Unable to restore your session.');
      this.view = 'auth';
      this.renderAuth();
    } finally {
      this.restoringInitialSession = false;
      clearOAuthParameters();
    }
  }

  private async handleAuthChange(event: AuthChangeEvent, session: Session | null): Promise<void> {
    if (this.identityMode === 'guest') {
      if (!session) return;
      clearGuestProfile();
      this.identityMode = null;
      this.profile = null;
    }

    if (
      !session
      && this.identityMode === 'authenticated'
      && (this.view === 'launching-game' || this.view === 'game')
    ) {
      window.dispatchEvent(new Event(RELEASE_ROOM_EVENT));
      clearReconnectSession();
      window.location.reload();
      return;
    }

    if (event === 'TOKEN_REFRESHED' && session?.user.id === this.session?.user.id) {
      this.session = session;
      return;
    }

    await this.reconcileSession(session);
  }

  private async reconcileSession(session: Session | null): Promise<void> {
    const revision = ++this.sessionRevision;
    this.session = session;

    if (!session) {
      if (this.identityMode === 'guest') return;
      this.identityMode = null;
      this.profile = null;
      this.profileError = null;
      this.view = 'auth';
      this.renderAuth();
      return;
    }

    this.identityMode = 'authenticated';

    if (this.profile?.id === session.user.id) {
      if (this.view !== 'profile' && this.view !== 'launching-game' && this.view !== 'game') {
        this.view = 'menu';
        this.renderMenu();
      }
      return;
    }

    this.view = 'profile-loading';
    this.renderRestoring('Reading your explorer record…');

    try {
      const profile = await loadOrCreateProfile(this.configuration.client!, session.user);
      if (revision !== this.sessionRevision) return;
      this.profile = profile;
      this.profileError = null;
      this.authError = null;
      this.view = 'menu';
      this.renderMenu();
    } catch (error) {
      if (revision !== this.sessionRevision) return;
      this.profile = null;
      this.profileError = errorMessage(error, 'Unable to load your profile.');
      this.view = 'profile-error';
      this.renderProfileError();
    }
  }

  private renderRestoring(status: string): void {
    root.innerHTML = shellMarkup(`
      <section class="loading-screen__content loading-screen__content--restoring" role="status" aria-live="polite" aria-busy="true">
        <div class="loading-screen__progress-frame">
          <div
            class="loading-screen__progress loading-screen__progress--indeterminate"
            role="progressbar"
            aria-label="Loading"
          ></div>
        </div>
        <div class="loading-screen__readout">
          <span>${escapeHtml(status)}</span>
        </div>
      </section>`, 'app-screen--loading');
  }

  private renderAuth(): void {
    const configured = this.configuration.client !== null;
    root.innerHTML = shellMarkup(`
      <section class="app-panel app-panel--auth" aria-labelledby="auth-title">
        <div class="app-brand">
          <img class="app-brand__logo" src="/assets/home/false-arrow-logo.png" alt="False Arrow" />
          <h1 id="auth-title" class="sr-only">False Arrow</h1>
        </div>
        ${this.authError ? `<div class="app-alert app-alert--error" role="alert">${escapeHtml(this.authError)}</div>` : ''}
        <button id="google-sign-in" class="pixel-button pixel-button--primary" type="button" ${configured ? '' : 'disabled'}>
          <svg class="google-mark" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="#4285f4" d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.92h5.38a4.6 4.6 0 0 1-2 3.02v2.54h3.24c1.9-1.75 2.98-4.33 2.98-7.41Z" />
            <path fill="#34a853" d="M12 22c2.7 0 4.98-.9 6.63-2.43l-3.24-2.54a6.01 6.01 0 0 1-8.96-3.16H3.08v2.62A10 10 0 0 0 12 22Z" />
            <path fill="#fbbc05" d="M6.43 13.87A6 6 0 0 1 6.12 12c0-.65.11-1.28.31-1.87V7.51H3.08A10 10 0 0 0 2 12c0 1.61.39 3.14 1.08 4.49l3.35-2.62Z" />
            <path fill="#ea4335" d="M12 6.02c1.47 0 2.8.5 3.84 1.5l2.87-2.88A9.64 9.64 0 0 0 12 2a10 10 0 0 0-8.92 5.51l3.35 2.62A5.96 5.96 0 0 1 12 6.02Z" />
          </svg>
          <span>Continue with Google</span>
        </button>
        <div class="auth-separator" aria-hidden="true"><span>or</span></div>
        <button id="guest-sign-in" class="pixel-button" type="button">
          <svg class="guest-mark" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0H5Z" />
          </svg>
          <span>Continue as guest</span>
        </button>
        <p id="auth-status" class="app-status" aria-live="polite"></p>
        <p class="app-panel__fineprint">Guest progress won’t be saved.</p>
      </section>`, 'app-screen--auth');

    document.querySelector<HTMLButtonElement>('#google-sign-in')?.addEventListener('click', () => {
      void this.signInWithGoogle();
    });
    document.querySelector<HTMLButtonElement>('#guest-sign-in')?.addEventListener('click', () => {
      this.enterGuestMode(loadGuestProfile() ?? createGuestProfile());
    });
  }

  private enterGuestMode(profile: Profile): void {
    ++this.sessionRevision;
    this.session = null;
    this.profile = profile;
    this.identityMode = 'guest';
    this.authError = null;
    this.profileError = null;
    this.profileNotice = null;
    this.view = 'menu';
    this.renderMenu();
  }

  private async signInWithGoogle(): Promise<void> {
    const client = this.configuration.client;
    const button = document.querySelector<HTMLButtonElement>('#google-sign-in');
    const status = document.querySelector<HTMLElement>('#auth-status');
    if (!client || !button || button.disabled) return;

    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    if (status) status.textContent = 'Opening Google sign-in…';
    this.authError = null;

    const { error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: getOAuthRedirectUrl() },
    });

    if (error) {
      this.authError = `Google sign-in could not start: ${error.message}`;
      this.renderAuth();
    }
  }

  private renderMenu(): void {
    if (!this.profile || !this.identityMode) return;

    const playAgain = window.sessionStorage.getItem(PLAY_AGAIN_STORAGE_KEY) === '1';
    if (playAgain) {
      window.sessionStorage.removeItem(PLAY_AGAIN_STORAGE_KEY);
      clearReconnectSession();
      this.pendingRoomCode = null;
    } else {
      const reconnectSession = loadReconnectSession(this.profile.id);
      const reconnectRoomCode = reconnectSession?.roomId
        ?? (reconnectSession?.joinMode === 'join'
          ? reconnectSession.requestedRoomId
          : null);
      if (
        reconnectSession &&
        (!this.pendingRoomCode || reconnectRoomCode === this.pendingRoomCode)
      ) {
        this.pendingRoomCode = null;
        this.view = 'launching-game';
        this.renderRestoring('Reclaiming your place in the maze…');
        window.setTimeout(
          () => void this.launchGame(
            reconnectSession.joinMode,
            reconnectSession.requestedRoomId,
            reconnectSession,
          ),
          0,
        );
        return;
      }
      if (reconnectSession) {
        clearReconnectSession();
      }
    }

    if (this.pendingRoomCode) {
      const roomCode = this.pendingRoomCode;
      this.pendingRoomCode = null;
      this.view = 'join';
      this.renderJoinRoom(roomCode);
      return;
    }
    const isGuest = this.identityMode === 'guest';
    const statusLabel = this.profile.is_admin ? 'Admin' : isGuest ? 'Guest' : 'Explorer';
    root.innerHTML = shellMarkup(`
      <div class="app-menu-shell">
        <img class="app-menu-logo" src="/assets/home/false-arrow-logo.png" alt="False Arrow" />
        <section class="app-panel app-panel--menu" aria-labelledby="menu-title">
          <header class="menu-profile">
            <button id="open-profile-avatar" class="menu-profile__avatar" type="button" aria-label="Open profile" title="Open profile">
              ${avatarMarkup(this.profile, 'small')}
            </button>
            <div class="menu-profile__text">
              <h1 id="menu-title">${escapeHtml(this.profile.display_name)}</h1>
              <span>${escapeHtml(statusLabel)}</span>
            </div>
            <span class="menu-rating" aria-label="Player rating">ELO 1200</span>
          </header>
          <div class="menu-divider" aria-hidden="true"><span>◇</span></div>
          <nav class="menu-actions" aria-label="Main menu">
            <button id="quick-play" class="pixel-button pixel-button--primary" type="button">Quick Play</button>
            <button id="create-game" class="pixel-button" type="button">Create Private Game</button>
            <button id="join-game" class="pixel-button" type="button">Join with Code</button>
            <button class="pixel-button menu-button--coming-soon" type="button" disabled>Leaderboard</button>
            <button class="pixel-button menu-button--coming-soon" type="button" disabled>Settings</button>
            <button id="sign-out" class="menu-sign-out" type="button">${isGuest ? 'Leave Guest Session' : 'Sign Out'}</button>
          </nav>
          <div id="menu-notice" class="app-alert app-alert--notice" role="status" aria-live="polite" hidden></div>
          <p id="menu-status" class="app-status" aria-live="polite"></p>
        </section>
      </div>`, 'app-screen--menu');

    this.activateAvatarFallbacks();

    document.querySelector<HTMLButtonElement>('#quick-play')?.addEventListener('click', () => {
      void this.launchGame('quick');
    });
    document.querySelector<HTMLButtonElement>('#create-game')?.addEventListener('click', () => {
      void this.launchGame('create');
    });
    document.querySelector<HTMLButtonElement>('#join-game')?.addEventListener('click', () => {
      this.view = 'join';
      this.renderJoinRoom();
    });
    document.querySelector<HTMLButtonElement>('#open-profile-avatar')?.addEventListener('click', () => {
      this.profileNotice = null;
      this.view = 'profile';
      this.renderProfile();
    });
    document.querySelector<HTMLButtonElement>('#sign-out')?.addEventListener('click', () => {
      void this.signOut();
    });

    if (playAgain) {
      window.setTimeout(() => void this.launchGame('quick'), 0);
    }
  }

  private renderJoinRoom(initialCode = ''): void {
    if (!this.profile) return;
    root.innerHTML = shellMarkup(`
      <section class="app-panel app-panel--join" aria-label="Join with code">
        <form id="join-room-form" class="join-room-form" novalidate>
          <label for="room-code">Enter room code</label>
          <input id="room-code" name="roomCode" type="text" maxlength="6" required autocomplete="off" autocapitalize="characters" spellcheck="false" inputmode="text" placeholder="ABC234" value="${escapeHtml(initialCode)}" />
          <div id="join-room-error" class="app-alert app-alert--error" role="alert" hidden></div>
          <div class="profile-actions">
            <button id="back-to-menu" class="pixel-button pixel-button--quiet" type="button">Back</button>
            <button class="pixel-button pixel-button--primary" type="submit">Join Room</button>
          </div>
        </form>
      </section>`, 'app-screen--join');

    const input = document.querySelector<HTMLInputElement>('#room-code');
    input?.focus();
    input?.select();
    input?.addEventListener('input', () => {
      input.value = normalizeRoomCode(input.value).slice(0, 6);
    });
    document.querySelector<HTMLButtonElement>('#back-to-menu')?.addEventListener('click', () => {
      const url = new URL(window.location.href);
      url.searchParams.delete('room');
      window.history.replaceState(null, '', url);
      this.view = 'menu';
      this.renderMenu();
    });
    document.querySelector<HTMLFormElement>('#join-room-form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const code = normalizeRoomCode(input?.value);
      const error = document.querySelector<HTMLDivElement>('#join-room-error');
      if (!isValidRoomCode(code)) {
        if (error) {
          error.textContent = 'Enter a valid six-character room code.';
          error.hidden = false;
        }
        return;
      }
      void this.launchGame('join', code);
    });
  }

  private renderProfile(): void {
    if (!this.profile || !this.identityMode) return;
    const isGuest = this.identityMode === 'guest';
    const statusLabel = this.profile.is_admin ? 'Admin' : isGuest ? 'Guest' : 'Explorer';
    root.innerHTML = shellMarkup(`
      <section class="app-panel app-panel--profile" aria-labelledby="profile-title">
        <header class="profile-header">
          ${avatarMarkup(this.profile, 'large')}
          <div>
            <h1 id="profile-title">Profile</h1>
            <span>${escapeHtml(statusLabel)}</span>
          </div>
        </header>
        <form id="profile-form" class="profile-form" novalidate>
          <label for="display-name">Display name</label>
          <input id="display-name" name="displayName" type="text" maxlength="32" required autocomplete="nickname" value="${escapeHtml(this.profile.display_name)}" />
          <p class="field-hint">Shown to other explorers inside the game.</p>
          <dl class="profile-timestamps">
            <div><dt>Created</dt><dd>${escapeHtml(formatDate(this.profile.created_at))}</dd></div>
            <div><dt>Updated</dt><dd>${escapeHtml(formatDate(this.profile.updated_at))}</dd></div>
          </dl>
          ${this.profileNotice ? `<div class="app-alert app-alert--success" role="status">${escapeHtml(this.profileNotice)}</div>` : ''}
          <div id="profile-error" class="app-alert app-alert--error" role="alert" hidden></div>
          <p id="profile-status" class="app-status" aria-live="polite"></p>
          <div class="profile-actions">
            <button id="back-to-menu" class="pixel-button pixel-button--quiet" type="button">Back</button>
            <button id="save-profile" class="pixel-button pixel-button--primary" type="submit">Save Profile</button>
          </div>
        </form>
      </section>`, 'app-screen--profile');

    this.activateAvatarFallbacks();

    document.querySelector<HTMLButtonElement>('#back-to-menu')?.addEventListener('click', () => {
      this.view = 'menu';
      this.renderMenu();
    });
    document.querySelector<HTMLFormElement>('#profile-form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      if (event.currentTarget instanceof HTMLFormElement) {
        void this.saveProfile(event.currentTarget);
      }
    });
  }

  private async saveProfile(form: HTMLFormElement): Promise<void> {
    const client = this.configuration.client;
    if (!this.profile || !this.identityMode) return;
    const saveButton = form.querySelector<HTMLButtonElement>('#save-profile');
    const backButton = form.querySelector<HTMLButtonElement>('#back-to-menu');
    const status = form.querySelector<HTMLElement>('#profile-status');
    const errorBox = form.querySelector<HTMLDivElement>('#profile-error');
    const data = new FormData(form);

    if (saveButton) saveButton.disabled = true;
    if (backButton) backButton.disabled = true;
    if (status) status.textContent = 'Saving your explorer record…';
    if (errorBox) errorBox.hidden = true;

    try {
      const input = {
        displayName: String(data.get('displayName') ?? ''),
        avatarUrl: this.profile.avatar_url ?? '',
      };
      if (this.identityMode === 'guest') {
        this.profile = updateGuestProfile(this.profile, input);
      } else {
        if (!client || !this.session) throw new Error('Your signed-in session is unavailable.');
        this.profile = await updateProfile(client, this.session.user.id, input);
      }
      this.profileNotice = 'Profile saved.';
      this.renderProfile();
    } catch (error) {
      if (saveButton) saveButton.disabled = false;
      if (backButton) backButton.disabled = false;
      if (status) status.textContent = '';
      if (errorBox) {
        errorBox.textContent = errorMessage(error, 'Unable to save your profile.');
        errorBox.hidden = false;
      }
    }
  }

  private renderProfileError(): void {
    root.innerHTML = shellMarkup(`
      <section class="app-panel app-panel--compact" aria-labelledby="profile-error-title">
        <div class="app-brand">${brandMarkup()}</div>
        <h2 id="profile-error-title" class="app-panel__heading">Explorer record unavailable</h2>
        <div class="app-alert app-alert--error" role="alert">${escapeHtml(this.profileError ?? 'Unable to load your profile.')}</div>
        <div class="error-actions">
          <button id="retry-profile" class="pixel-button pixel-button--primary" type="button">Retry</button>
          <button id="error-sign-out" class="pixel-button pixel-button--quiet" type="button">Sign Out</button>
        </div>
        <p id="error-status" class="app-status" aria-live="polite"></p>
      </section>`, 'app-screen--error');

    document.querySelector<HTMLButtonElement>('#retry-profile')?.addEventListener('click', () => {
      void this.reconcileSession(this.session);
    });
    document.querySelector<HTMLButtonElement>('#error-sign-out')?.addEventListener('click', () => {
      void this.signOut('#error-status');
    });
  }

  private async signOut(statusSelector = '#menu-status'): Promise<void> {
    window.dispatchEvent(new Event(RELEASE_ROOM_EVENT));
    clearReconnectSession();
    if (this.identityMode === 'guest') {
      clearGuestProfile();
      ++this.sessionRevision;
      this.identityMode = null;
      this.session = null;
      this.profile = null;
      this.profileNotice = null;
      this.view = 'auth';
      this.authError = this.configuration.client ? null : this.configuration.error.message;
      this.renderAuth();
      return;
    }

    const client = this.configuration.client;
    if (!client) return;
    const status = document.querySelector<HTMLElement>(statusSelector);
    const buttons = root.querySelectorAll<HTMLButtonElement>('button');
    buttons.forEach((button) => { button.disabled = true; });
    if (status) status.textContent = 'Signing out…';

    const { error } = await client.auth.signOut();
    if (error) {
      buttons.forEach((button) => { button.disabled = false; });
      if (status) status.textContent = `Sign out failed: ${error.message}`;
    }
  }

  private async launchGame(
    joinMode: LobbyJoinMode,
    roomId = '',
    existingReconnectSession?: ReconnectSession,
  ): Promise<void> {
    if (this.gameLaunchStarted || !this.profile || !this.identityMode) return;
    this.gameLaunchStarted = true;
    this.view = 'launching-game';
    root.innerHTML = gameMarkup();

    try {
      const { startGame } = await import('./game');
      const reconnectSession =
        existingReconnectSession ??
        createReconnectSession(this.profile.id, joinMode, roomId);
      await startGame({
        displayName: this.profile.display_name,
        reconnectSession,
        accessToken: this.session?.access_token,
      });
      this.view = 'game';
    } catch {
      // The game module owns the loading-screen error presentation.
    }
  }

  private activateAvatarFallbacks(): void {
    root.querySelectorAll<HTMLImageElement>('.profile-avatar img').forEach((image) => {
      image.addEventListener('error', () => image.remove(), { once: true });
    });
  }
}

const controller = new AppController();
void controller.start();
