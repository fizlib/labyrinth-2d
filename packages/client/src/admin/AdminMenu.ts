import type {
  AdminCompletedRoundDetail,
  AdminCompletedRoundSummary,
  AdminOverview,
  AdminPage,
  AdminRoomSnapshot,
  AdminTutorialReport,
  AdminUserSummary,
  CommunityRoundSchedule,
} from './types';
import { AdminApiClient, AdminApiRequestError } from './AdminApiClient';
import {
  communityRoundStartAtFromZonedInput,
  getCommunityRoundScheduleInputValues,
  getNextCommunityRoundState,
} from '../systems/CommunityRoundSchedule';
import { cacheCommunityRoundSchedule } from '../systems/CommunityRoundScheduleApi';

type AdminTab = 'users' | 'ongoing' | 'past' | 'tutorials';

interface AdminMenuOptions {
  currentUserId: string;
  getAccessToken: () => string | null;
  onBack: () => void;
  onAccessLost: (code: string) => void;
  onCurrentUserUpdated: (user: AdminUserSummary) => void;
}

interface PageFilters {
  page: number;
  q: string;
}

const POLL_INTERVAL_MS = 10_000;
const PAGE_SIZE = 25;
const FILTER_SEARCH_DEBOUNCE_MS = 250;

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatDate(value: string | null): string {
  if (!value) return 'Never';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function formatScheduledRoundDate(date: Date, schedule: CommunityRoundSchedule): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: schedule.timeZone,
    dateStyle: 'full',
    timeStyle: 'short',
  }).format(date);
}

function compactId(value: string): string {
  return value.length > 14 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
}

function pageCount(page: AdminPage<unknown> | null): number {
  return page ? Math.max(1, Math.ceil(page.total / page.perPage)) : 1;
}

function needsAuthBanRetry(user: AdminUserSummary): boolean {
  if (!user.suspendedAt) return false;
  if (!user.authBannedUntil) return true;
  const bannedUntil = new Date(user.authBannedUntil).getTime();
  return Number.isNaN(bannedUntil) || bannedUntil <= Date.now();
}

function paginationMarkup(data: AdminPage<unknown> | null, kind: string): string {
  if (!data || data.total <= data.perPage) return '';
  const pages = pageCount(data);
  return `<nav class="admin-pagination" aria-label="Pagination">
    <button type="button" data-page-kind="${kind}" data-page="${data.page - 1}" ${data.page <= 1 ? 'disabled' : ''}>Previous</button>
    <span>Page ${data.page} of ${pages} · ${data.total} total</span>
    <button type="button" data-page-kind="${kind}" data-page="${data.page + 1}" ${data.page >= pages ? 'disabled' : ''}>Next</button>
  </nav>`;
}

function statusBadge(label: string, tone: string): string {
  return `<span class="admin-badge admin-badge--${tone}">${escapeHtml(label)}</span>`;
}

export class AdminMenu {
  private readonly api: AdminApiClient;
  private activeTab: AdminTab = 'users';
  private overview: AdminOverview | null = null;
  private users: AdminPage<AdminUserSummary> | null = null;
  private rounds: AdminPage<AdminCompletedRoundSummary> | null = null;
  private tutorials: AdminTutorialReport | null = null;
  private selectedUser: AdminUserSummary | null = null;
  private selectedRound: AdminCompletedRoundDetail | null = null;
  private communityRoundSchedule: CommunityRoundSchedule | null = null;
  private schedulePanelOpen = false;
  private scheduleLoading = false;
  private usersFilter: PageFilters & { admin: string; suspension: string } = {
    page: 1,
    q: '',
    admin: 'all',
    suspension: 'all',
  };
  private roundsFilter: PageFilters & { winner: string; rated: string } = {
    page: 1,
    q: '',
    winner: 'all',
    rated: 'all',
  };
  private tutorialsFilter: PageFilters & { status: string; source: string } = {
    page: 1,
    q: '',
    status: 'all',
    source: 'all',
  };
  private readonly expandedRoomIds = new Set<string>();
  private loading = true;
  private busy = false;
  private error: string | null = null;
  private notice: string | null = null;
  private authSyncRetryUserId: string | null = null;
  private pollTimer: number | null = null;
  private userFilterTimer: number | null = null;
  private userFilterGeneration = 0;
  private roundFilterTimer: number | null = null;
  private roundFilterGeneration = 0;
  private tutorialFilterTimer: number | null = null;
  private tutorialFilterGeneration = 0;
  private destroyed = false;
  private readonly handleVisibilityChange = () => {
    if (document.hidden) this.stopPolling();
    else {
      this.startPolling();
      void this.refreshOverview(true);
    }
  };

  constructor(
    private readonly host: HTMLElement,
    private readonly options: AdminMenuOptions,
  ) {
    this.api = new AdminApiClient(options.getAccessToken);
  }

  async start(): Promise<void> {
    this.render();
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    try {
      const [overview, users] = await Promise.all([
        this.api.getOverview(),
        this.api.getUsers(this.userQuery()),
      ]);
      if (this.destroyed) return;
      this.overview = overview;
      this.users = users;
    } catch (error) {
      this.handleError(error);
    } finally {
      if (!this.destroyed) {
        this.loading = false;
        this.render();
        this.startPolling();
      }
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.stopPolling();
    this.clearUserFilterTimer();
    this.clearRoundFilterTimer();
    this.clearTutorialFilterTimer();
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
  }

  private startPolling(): void {
    if (this.destroyed || document.hidden || this.pollTimer !== null) return;
    this.pollTimer = window.setInterval(
      () => void this.refreshOverview(true),
      POLL_INTERVAL_MS,
    );
  }

  private stopPolling(): void {
    if (this.pollTimer === null) return;
    window.clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  private clearUserFilterTimer(): void {
    if (this.userFilterTimer === null) return;
    window.clearTimeout(this.userFilterTimer);
    this.userFilterTimer = null;
  }

  private readUserFilters(form: HTMLFormElement): void {
    const data = new FormData(form);
    this.usersFilter = {
      page: 1,
      q: String(data.get('q') ?? ''),
      admin: String(data.get('admin') ?? 'all'),
      suspension: String(data.get('suspension') ?? 'all'),
    };
  }

  private requestUserFilterLoad(form: HTMLFormElement, debounce: boolean): void {
    this.readUserFilters(form);
    this.clearUserFilterTimer();
    const generation = ++this.userFilterGeneration;
    const load = () => {
      this.userFilterTimer = null;
      void this.loadFilteredUsers(generation, debounce);
    };
    if (debounce) {
      this.userFilterTimer = window.setTimeout(load, FILTER_SEARCH_DEBOUNCE_MS);
    } else {
      load();
    }
  }

  private async loadFilteredUsers(
    generation: number,
    restoreSearchFocus: boolean,
  ): Promise<void> {
    this.loading = true;
    this.error = null;
    try {
      const users = await this.api.getUsers(this.userQuery());
      if (this.destroyed || generation !== this.userFilterGeneration) return;
      this.users = users;
    } catch (error) {
      if (generation !== this.userFilterGeneration) return;
      this.handleError(error);
    } finally {
      if (this.destroyed || generation !== this.userFilterGeneration) return;
      this.loading = false;
      this.render();
      if (restoreSearchFocus) {
        const input = this.host.querySelector<HTMLInputElement>(
          '#admin-user-filters input[name="q"]',
        );
        input?.focus({ preventScroll: true });
        input?.setSelectionRange(input.value.length, input.value.length);
      }
    }
  }

  private clearRoundFilterTimer(): void {
    if (this.roundFilterTimer === null) return;
    window.clearTimeout(this.roundFilterTimer);
    this.roundFilterTimer = null;
  }

  private clearTutorialFilterTimer(): void {
    if (this.tutorialFilterTimer === null) return;
    window.clearTimeout(this.tutorialFilterTimer);
    this.tutorialFilterTimer = null;
  }

  private readTutorialFilters(form: HTMLFormElement): void {
    const data = new FormData(form);
    this.tutorialsFilter = {
      page: 1,
      q: String(data.get('q') ?? ''),
      status: String(data.get('status') ?? 'all'),
      source: String(data.get('source') ?? 'all'),
    };
  }

  private requestTutorialFilterLoad(form: HTMLFormElement, debounce: boolean): void {
    this.readTutorialFilters(form);
    this.clearTutorialFilterTimer();
    const generation = ++this.tutorialFilterGeneration;
    const load = () => {
      this.tutorialFilterTimer = null;
      void this.loadFilteredTutorials(generation, debounce);
    };
    if (debounce) {
      this.tutorialFilterTimer = window.setTimeout(load, FILTER_SEARCH_DEBOUNCE_MS);
    } else {
      load();
    }
  }

  private async loadFilteredTutorials(
    generation: number,
    restoreSearchFocus: boolean,
  ): Promise<void> {
    this.loading = true;
    this.error = null;
    try {
      const tutorials = await this.api.getTutorials(this.tutorialQuery());
      if (this.destroyed || generation !== this.tutorialFilterGeneration) return;
      this.tutorials = tutorials;
    } catch (error) {
      if (generation !== this.tutorialFilterGeneration) return;
      this.handleError(error);
    } finally {
      if (this.destroyed || generation !== this.tutorialFilterGeneration) return;
      this.loading = false;
      this.render();
      if (restoreSearchFocus) {
        const input = this.host.querySelector<HTMLInputElement>(
          '#admin-tutorial-filters input[name="q"]',
        );
        input?.focus({ preventScroll: true });
        input?.setSelectionRange(input.value.length, input.value.length);
      }
    }
  }

  private readRoundFilters(form: HTMLFormElement): void {
    const data = new FormData(form);
    this.roundsFilter = {
      page: 1,
      q: String(data.get('q') ?? ''),
      winner: String(data.get('winner') ?? 'all'),
      rated: String(data.get('rated') ?? 'all'),
    };
  }

  private requestRoundFilterLoad(form: HTMLFormElement, debounce: boolean): void {
    this.readRoundFilters(form);
    this.clearRoundFilterTimer();
    const generation = ++this.roundFilterGeneration;
    const load = () => {
      this.roundFilterTimer = null;
      void this.loadFilteredRounds(generation, debounce);
    };
    if (debounce) {
      this.roundFilterTimer = window.setTimeout(load, FILTER_SEARCH_DEBOUNCE_MS);
    } else {
      load();
    }
  }

  private async loadFilteredRounds(
    generation: number,
    restoreSearchFocus: boolean,
  ): Promise<void> {
    this.loading = true;
    this.error = null;
    try {
      const rounds = await this.api.getRounds(this.roundQuery());
      if (this.destroyed || generation !== this.roundFilterGeneration) return;
      this.rounds = rounds;
    } catch (error) {
      if (generation !== this.roundFilterGeneration) return;
      this.handleError(error);
    } finally {
      if (this.destroyed || generation !== this.roundFilterGeneration) return;
      this.loading = false;
      this.render();
      if (restoreSearchFocus) {
        const input = this.host.querySelector<HTMLInputElement>(
          '#admin-round-filters input[name="q"]',
        );
        input?.focus({ preventScroll: true });
        input?.setSelectionRange(input.value.length, input.value.length);
      }
    }
  }

  private userQuery(): URLSearchParams {
    return new URLSearchParams({
      page: String(this.usersFilter.page),
      perPage: String(PAGE_SIZE),
      q: this.usersFilter.q,
      admin: this.usersFilter.admin,
      suspension: this.usersFilter.suspension,
    });
  }

  private roundQuery(): URLSearchParams {
    return new URLSearchParams({
      page: String(this.roundsFilter.page),
      perPage: String(PAGE_SIZE),
      q: this.roundsFilter.q,
      winner: this.roundsFilter.winner,
      rated: this.roundsFilter.rated,
    });
  }

  private tutorialQuery(): URLSearchParams {
    return new URLSearchParams({
      page: String(this.tutorialsFilter.page),
      perPage: String(PAGE_SIZE),
      q: this.tutorialsFilter.q,
      status: this.tutorialsFilter.status,
      source: this.tutorialsFilter.source,
    });
  }

  private async refreshOverview(silent = false): Promise<void> {
    if (this.destroyed || this.busy) return;
    try {
      this.overview = await this.api.getOverview();
      if (this.destroyed) return;
      if (this.activeTab === 'ongoing') this.render();
      else this.updateSummaryCards();
      if (!silent) this.showNotice('Admin data refreshed.');
    } catch (error) {
      this.handleError(error, silent);
    }
  }

  private async refreshCurrentTab(): Promise<void> {
    if (this.busy) return;
    this.loading = true;
    this.error = null;
    this.render();
    try {
      if (this.activeTab === 'users') {
        [this.overview, this.users] = await Promise.all([
          this.api.getOverview(),
          this.api.getUsers(this.userQuery()),
        ]);
      } else if (this.activeTab === 'past') {
        [this.overview, this.rounds] = await Promise.all([
          this.api.getOverview(),
          this.api.getRounds(this.roundQuery()),
        ]);
      } else if (this.activeTab === 'tutorials') {
        [this.overview, this.tutorials] = await Promise.all([
          this.api.getOverview(),
          this.api.getTutorials(this.tutorialQuery()),
        ]);
      } else {
        this.overview = await this.api.getOverview();
      }
      this.notice = 'Admin data refreshed.';
    } catch (error) {
      this.handleError(error);
    } finally {
      this.loading = false;
      this.render();
    }
  }

  private async loadTab(tab: AdminTab): Promise<void> {
    this.clearUserFilterTimer();
    ++this.userFilterGeneration;
    this.clearRoundFilterTimer();
    ++this.roundFilterGeneration;
    this.clearTutorialFilterTimer();
    ++this.tutorialFilterGeneration;
    this.activeTab = tab;
    this.error = null;
    this.notice = null;
    this.loading = true;
    this.render();
    try {
      if (tab === 'users') this.users = await this.api.getUsers(this.userQuery());
      if (tab === 'ongoing') this.overview = await this.api.getOverview();
      if (tab === 'past') this.rounds = await this.api.getRounds(this.roundQuery());
      if (tab === 'tutorials') {
        this.tutorials = await this.api.getTutorials(this.tutorialQuery());
      }
    } catch (error) {
      this.handleError(error);
    } finally {
      this.loading = false;
      this.render();
    }
  }

  private handleError(error: unknown, silent = false): void {
    if (error instanceof AdminApiRequestError) {
      if (['ADMIN_REQUIRED', 'ACCOUNT_SUSPENDED'].includes(error.code)) {
        this.destroy();
        this.options.onAccessLost(error.code);
        return;
      }
      if (['INVALID_TOKEN', 'AUTH_REQUIRED'].includes(error.code)) {
        if (!silent) {
          this.destroy();
          this.options.onAccessLost(error.code);
        } else {
          const updated = this.host.querySelector<HTMLElement>('#admin-last-updated');
          if (updated) updated.textContent = 'Session refreshing · retrying live data';
        }
        return;
      }
      if (!silent) this.error = error.message;
      else {
        const updated = this.host.querySelector<HTMLElement>('#admin-last-updated');
        if (updated) updated.textContent = `Live refresh unavailable · ${error.message}`;
      }
      return;
    }
    if (!silent) {
      this.error =
        error instanceof Error ? error.message : 'Administrator request failed.';
    } else {
      const updated = this.host.querySelector<HTMLElement>('#admin-last-updated');
      if (updated) updated.textContent = 'Live refresh unavailable · Network error';
    }
  }

  private showNotice(message: string): void {
    this.notice = message;
    const element = this.host.querySelector<HTMLElement>('#admin-notice');
    if (element) {
      element.textContent = message;
      element.hidden = false;
    }
  }

  private updateSummaryCards(): void {
    if (!this.overview) return;
    const metrics: Record<string, number> = {
      users: this.overview.registeredUsers,
      suspended: this.overview.suspendedUsers,
      rooms: this.overview.activeRooms,
      registered: this.overview.connectedRegisteredPlayers,
      guests: this.overview.connectedGuests,
      rounds: this.overview.completedRounds,
      rated: this.overview.ratedRounds,
    };
    for (const [key, value] of Object.entries(metrics)) {
      const element = this.host.querySelector<HTMLElement>(
        `[data-admin-metric="${key}"]`,
      );
      if (element) element.textContent = String(value);
    }
    const updated = this.host.querySelector<HTMLElement>('#admin-last-updated');
    if (updated) updated.textContent = `Updated ${formatDate(this.overview.generatedAt)}`;
  }

  private summaryMarkup(): string {
    const overview = this.overview;
    const cards: Array<[string, string, number]> = [
      ['users', 'Registered users', overview?.registeredUsers ?? 0],
      ['suspended', 'Suspended', overview?.suspendedUsers ?? 0],
      ['rooms', 'Active rooms', overview?.activeRooms ?? 0],
      ['registered', 'Players online', overview?.connectedRegisteredPlayers ?? 0],
      ['guests', 'Guests online', overview?.connectedGuests ?? 0],
      ['rounds', 'Past rounds', overview?.completedRounds ?? 0],
      ['rated', 'Rated rounds', overview?.ratedRounds ?? 0],
    ];
    return `<div class="admin-summary" aria-label="Game overview">
      ${cards
        .map(
          ([key, label, value]) => `<article class="admin-stat-card">
            <span>${escapeHtml(label)}</span>
            <strong data-admin-metric="${key}">${value}</strong>
          </article>`,
        )
        .join('')}
    </div>`;
  }

  private usersMarkup(): string {
    if (this.selectedUser) return this.userDetailMarkup(this.selectedUser);
    const items = this.users?.items ?? [];
    return `<form id="admin-user-filters" class="admin-filters admin-filters--users">
      <label>Search<input name="q" type="search" placeholder="Email, name, or user ID" value="${escapeHtml(this.usersFilter.q)}" /></label>
      <label>Role<select name="admin">
        <option value="all" ${this.usersFilter.admin === 'all' ? 'selected' : ''}>All roles</option>
        <option value="admin" ${this.usersFilter.admin === 'admin' ? 'selected' : ''}>Admins</option>
        <option value="user" ${this.usersFilter.admin === 'user' ? 'selected' : ''}>Players</option>
      </select></label>
      <label>Status<select name="suspension">
        <option value="all" ${this.usersFilter.suspension === 'all' ? 'selected' : ''}>All statuses</option>
        <option value="active" ${this.usersFilter.suspension === 'active' ? 'selected' : ''}>Active</option>
        <option value="suspended" ${this.usersFilter.suspension === 'suspended' ? 'selected' : ''}>Suspended</option>
      </select></label>
    </form>
    ${this.loading ? '<p class="admin-empty">Loading users…</p>' : ''}
    ${!this.loading && items.length === 0 ? '<p class="admin-empty">No registered users match these filters.</p>' : ''}
    <div class="admin-table-wrap" ${items.length === 0 ? 'hidden' : ''}>
      <table class="admin-table">
        <thead><tr><th>User</th><th>Email</th><th>Access</th><th>Record</th><th>Last sign-in</th></tr></thead>
        <tbody>${items.map((user) => this.userRowMarkup(user)).join('')}</tbody>
      </table>
    </div>
    ${paginationMarkup(this.users, 'users')}`;
  }

  private userRowMarkup(user: AdminUserSummary): string {
    const access = [
      user.isAdmin ? statusBadge('Admin', 'gold') : statusBadge('Player', 'neutral'),
      user.suspendedAt
        ? statusBadge('Suspended', 'danger')
        : statusBadge('Active', 'success'),
      needsAuthBanRetry(user) ? statusBadge('Auth sync needed', 'danger') : '',
      user.currentRoomId ? statusBadge(`Room ${user.currentRoomId}`, 'info') : '',
    ].join(' ');
    return `<tr class="admin-user-row" data-user-id="${escapeHtml(user.id)}" tabindex="0" aria-label="View details for ${escapeHtml(user.displayName)}">
      <td data-label="User"><span class="admin-user-summary" data-admin-selectable><strong>${escapeHtml(user.displayName)}</strong><small title="${escapeHtml(user.id)}">${escapeHtml(compactId(user.id))}</small></span></td>
      <td data-label="Email"><span data-admin-selectable>${escapeHtml(user.email ?? '—')}</span></td>
      <td data-label="Access"><div class="admin-badges" data-admin-selectable>${access}</div></td>
      <td data-label="Record"><span data-admin-selectable>Elo ${user.rating} · ${user.wins}W–${user.losses}L</span></td>
      <td data-label="Last sign-in"><span data-admin-selectable>${escapeHtml(formatDate(user.lastSignInAt))}</span></td>
    </tr>`;
  }

  private userDetailMarkup(user: AdminUserSummary): string {
    const isSelf = user.id === this.options.currentUserId;
    return `<aside class="admin-drawer admin-drawer--standalone" aria-labelledby="admin-user-detail-title">
      <header><div><span class="admin-eyebrow">Registered user</span><h3 id="admin-user-detail-title">${escapeHtml(user.displayName)}</h3></div><button id="close-admin-user" class="admin-detail-back" type="button">← User list</button></header>
      <dl class="admin-detail-grid">
        <div><dt>Email</dt><dd>${escapeHtml(user.email ?? '—')}</dd></div>
        <div><dt>User ID</dt><dd class="admin-mono">${escapeHtml(user.id)}</dd></div>
        <div><dt>Created</dt><dd>${escapeHtml(formatDate(user.createdAt))}</dd></div>
        <div><dt>Last sign-in</dt><dd>${escapeHtml(formatDate(user.lastSignInAt))}</dd></div>
        <div><dt>Game record</dt><dd>Elo ${user.rating} · ${user.matchesPlayed} matches · ${user.wins}W–${user.losses}L</dd></div>
        <div><dt>Current room</dt><dd>${escapeHtml(user.currentRoomId ?? 'Not in a room')}</dd></div>
      </dl>
      <form id="admin-profile-form" class="admin-edit-form">
        <label>Display name<input name="displayName" maxlength="32" required value="${escapeHtml(user.displayName)}" /></label>
        <button type="submit" ${this.busy ? 'disabled' : ''}>Save profile</button>
      </form>
      <div class="admin-danger-actions">
        <button id="toggle-admin-role" type="button" ${this.busy || (isSelf && user.isAdmin) ? 'disabled' : ''}>${user.isAdmin ? 'Revoke admin' : 'Grant admin'}</button>
        <button id="toggle-user-suspension" class="${user.suspendedAt ? '' : 'danger'}" type="button" ${this.busy || isSelf ? 'disabled' : ''}>${user.suspendedAt ? 'Reactivate user' : 'Suspend user'}</button>
        ${this.authSyncRetryUserId === user.id || needsAuthBanRetry(user) ? `<button id="retry-auth-ban" type="button" ${this.busy ? 'disabled' : ''}>Retry Auth ban</button>` : ''}
      </div>
      ${isSelf ? '<p class="admin-hint">You cannot demote or suspend your own account.</p>' : ''}
    </aside>`;
  }

  private ongoingMarkup(): string {
    const rooms = this.overview?.rooms ?? [];
    if (this.loading) return '<p class="admin-empty">Loading active rooms…</p>';
    if (rooms.length === 0)
      return '<p class="admin-empty">There are no active rooms.</p>';
    return `<div class="admin-room-list">${rooms.map((room) => this.roomMarkup(room)).join('')}</div>`;
  }

  private roomMarkup(room: AdminRoomSnapshot): string {
    const tone =
      room.phase === 'running' ? 'success' : room.phase === 'ended' ? 'neutral' : 'info';
    return `<details class="admin-room-card" data-room-id="${escapeHtml(room.roomId)}" ${this.expandedRoomIds.has(room.roomId) ? 'open' : ''}>
      <summary>
        <span><strong>${escapeHtml(room.roomId)}</strong>${statusBadge(room.isPublic ? 'Public' : 'Private', 'neutral')} ${statusBadge(room.phase, tone)}</span>
        <span>${room.connectedCount}/${room.playerCount} connected${room.phase === 'running' ? ` · ${formatDuration(room.remainingMs)}` : ''}</span>
      </summary>
      <div class="admin-room-meta">
        <span>Created ${escapeHtml(formatDate(room.createdAt))}</span>
        <span>Match ${escapeHtml(room.matchId ? compactId(room.matchId) : 'not started')}</span>
        <span>${room.rated ? 'Rated' : 'Unrated'}</span>
        <span>${room.authenticatedCount} registered · ${room.guestCount} guests</span>
      </div>
      <div class="admin-roster">${room.players
        .map(
          (player) => `<div>
            <span><strong>${escapeHtml(player.displayName)}</strong> ${player.isGuest ? statusBadge('Guest', 'neutral') : ''} ${player.isAdmin ? statusBadge('Admin', 'gold') : ''}</span>
            <span>${escapeHtml(player.role ?? 'Unassigned')} · ${player.connected ? 'Connected' : 'Reserved'}${player.escaped ? ' · Escaped' : ''}${player.abandoned ? ' · Abandoned' : ''}</span>
          </div>`,
        )
        .join('')}</div>
    </details>`;
  }

  private pastMarkup(): string {
    if (this.selectedRound) return this.roundDetailMarkup(this.selectedRound);
    const items = this.rounds?.items ?? [];
    return `<form id="admin-round-filters" class="admin-filters admin-filters--past">
      <label>Search<input name="q" type="search" placeholder="Room or match ID" value="${escapeHtml(this.roundsFilter.q)}" /></label>
      <label>Winner<select name="winner">
        <option value="all">All winners</option>
        <option value="survivors" ${this.roundsFilter.winner === 'survivors' ? 'selected' : ''}>Survivors</option>
        <option value="wardens" ${this.roundsFilter.winner === 'wardens' ? 'selected' : ''}>Wardens</option>
      </select></label>
      <label>Rating<select name="rated">
        <option value="all">All rounds</option>
        <option value="rated" ${this.roundsFilter.rated === 'rated' ? 'selected' : ''}>Rated</option>
        <option value="unrated" ${this.roundsFilter.rated === 'unrated' ? 'selected' : ''}>Unrated</option>
      </select></label>
    </form>
    ${this.loading ? '<p class="admin-empty">Loading past rounds…</p>' : ''}
    ${!this.loading && items.length === 0 ? '<p class="admin-empty">No completed rounds match these filters.</p>' : ''}
    <div class="admin-round-history">${items
      .map(
        (round) => `<button type="button" data-round-id="${escapeHtml(round.id)}">
          <span><strong>${escapeHtml(round.roomId)}</strong> ${statusBadge(`${round.winner} won`, round.winner === 'survivors' ? 'success' : 'danger')} ${round.rated ? statusBadge('Rated', 'gold') : statusBadge('Unrated', 'neutral')}</span>
          <span>${round.playerCount} players · ${escapeHtml(formatDate(round.endedAt))}</span>
        </button>`,
      )
      .join('')}</div>
    ${paginationMarkup(this.rounds, 'rounds')}`;
  }

  private roundDetailMarkup(round: AdminCompletedRoundDetail): string {
    return `<aside class="admin-drawer admin-drawer--standalone" aria-labelledby="admin-round-detail-title">
      <header><div><span class="admin-eyebrow">Completed round</span><h3 id="admin-round-detail-title">Room ${escapeHtml(round.roomId)}</h3></div><button id="close-admin-round" class="admin-detail-back" type="button">← Round list</button></header>
      <p>${escapeHtml(round.winner)} won · ${round.rated ? 'Rated' : 'Unrated'} · ${escapeHtml(formatDate(round.endedAt))}</p>
      <div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>Player</th><th>Role</th><th>Result</th><th>State</th><th>Elo</th></tr></thead><tbody>
        ${round.participants
          .map((player) => {
            const rating =
              player.ratingBefore === null ||
              player.ratingDelta === null ||
              player.ratingAfter === null
                ? 'Not rated'
                : `${player.ratingBefore} ${player.ratingDelta >= 0 ? '+' : ''}${player.ratingDelta} → ${player.ratingAfter}`;
            return `<tr><td data-label="Player">${escapeHtml(player.displayName)} ${player.isGuest ? statusBadge('Guest', 'neutral') : ''}</td><td data-label="Role">${escapeHtml(player.role)}</td><td data-label="Result">${escapeHtml(player.outcome)}</td><td data-label="State">${player.abandoned ? 'Abandoned' : player.escaped ? 'Escaped' : 'Finished'}</td><td data-label="Elo">${rating}</td></tr>`;
          })
          .join('')}
      </tbody></table></div>
    </aside>`;
  }

  private tutorialsMarkup(): string {
    const statistics = this.tutorials?.statistics;
    const attempts = this.tutorials?.attempts ?? null;
    const items = attempts?.items ?? [];
    const cards: Array<[string, string]> = [
      ['Attempts', String(statistics?.attempts ?? 0)],
      ['Unique people', String(statistics?.uniquePeople ?? 0)],
      ['In progress', String(statistics?.inProgress ?? 0)],
      ['Completed', String(statistics?.completed ?? 0)],
      ['Left', String(statistics?.left ?? 0)],
      ['Completion rate', `${Math.round((statistics?.completionRate ?? 0) * 100)}%`],
      ['Average elapsed', formatDuration(statistics?.averageDurationMs ?? 0)],
      ['Reminder opened', String(statistics?.reminderOpened ?? 0)],
      [
        'Discord / Google',
        `${statistics?.discordReminderClicked ?? 0} / ${statistics?.googleCalendarClicked ?? 0}`,
      ],
    ];
    return `<div class="admin-summary admin-tutorial-summary" aria-label="Tutorial statistics">
      ${cards
        .map(
          ([label, value]) =>
            `<article class="admin-stat-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></article>`,
        )
        .join('')}
    </div>
    <form id="admin-tutorial-filters" class="admin-filters admin-filters--tutorials">
      <label>Search<input name="q" type="search" placeholder="Player name or ID" value="${escapeHtml(this.tutorialsFilter.q)}" /></label>
      <label>Status<select name="status">
        <option value="all">All statuses</option>
        <option value="in_progress" ${this.tutorialsFilter.status === 'in_progress' ? 'selected' : ''}>In progress</option>
        <option value="completed" ${this.tutorialsFilter.status === 'completed' ? 'selected' : ''}>Completed</option>
        <option value="left" ${this.tutorialsFilter.status === 'left' ? 'selected' : ''}>Left</option>
      </select></label>
      <label>Source<select name="source">
        <option value="all">All tutorial sources</option>
        <option value="main_menu" ${this.tutorialsFilter.source === 'main_menu' ? 'selected' : ''}>Main menu</option>
        <option value="first_time_queue" ${this.tutorialsFilter.source === 'first_time_queue' ? 'selected' : ''}>First-time queue</option>
      </select></label>
    </form>
    ${this.loading ? '<p class="admin-empty">Loading tutorial attempts…</p>' : ''}
    ${!this.loading && items.length === 0 ? '<p class="admin-empty">No tutorial attempts match these filters.</p>' : ''}
    <div class="admin-table-wrap" ${items.length === 0 ? 'hidden' : ''}>
      <table class="admin-table admin-tutorial-table">
        <thead><tr><th>Player</th><th>Source</th><th>Status</th><th>Started</th><th>Elapsed</th><th>Reminder</th></tr></thead>
        <tbody>${items
          .map((attempt) => {
            const statusTone =
              attempt.status === 'completed'
                ? 'success'
                : attempt.status === 'left'
                  ? 'danger'
                  : 'info';
            const departure =
              attempt.departureReason === 'explicit_exit'
                ? 'Explicit exit'
                : attempt.departureReason === 'page_unload'
                  ? 'Page closed'
                  : attempt.departureReason === 'inactivity_timeout'
                    ? 'Timed out'
                    : '';
            const reminders = [
              attempt.reminderOpenedAt ? 'Opened' : '',
              attempt.discordReminderClickedAt ? 'Discord' : '',
              attempt.googleCalendarClickedAt ? 'Google' : '',
            ].filter(Boolean);
            const reminderTitle = [
              attempt.reminderOpenedAt
                ? `Opened ${formatDate(attempt.reminderOpenedAt)}`
                : '',
              attempt.discordReminderClickedAt
                ? `Discord ${formatDate(attempt.discordReminderClickedAt)}`
                : '',
              attempt.googleCalendarClickedAt
                ? `Google ${formatDate(attempt.googleCalendarClickedAt)}`
                : '',
            ]
              .filter(Boolean)
              .join(' · ');
            return `<tr>
              <td data-label="Player"><span class="admin-user-summary"><strong>${escapeHtml(attempt.displayName)} ${attempt.isGuest ? statusBadge('Guest', 'neutral') : ''}</strong><small title="${escapeHtml(attempt.participantId)}">${escapeHtml(compactId(attempt.participantId))}</small></span></td>
              <td data-label="Source">${attempt.source === 'main_menu' ? 'Main menu' : 'First-time queue'}</td>
              <td data-label="Status">${statusBadge(attempt.status === 'in_progress' ? 'In progress' : attempt.status, statusTone)}${departure ? `<small class="admin-tutorial-detail">${escapeHtml(departure)}</small>` : ''}</td>
              <td data-label="Started">${escapeHtml(formatDate(attempt.startedAt))}</td>
              <td data-label="Elapsed">${escapeHtml(formatDuration(attempt.durationMs))}</td>
              <td data-label="Reminder" title="${escapeHtml(reminderTitle)}">${reminders.length > 0 ? escapeHtml(reminders.join(' · ')) : 'None'}</td>
            </tr>`;
          })
          .join('')}</tbody>
      </table>
    </div>
    ${paginationMarkup(attempts, 'tutorials')}`;
  }

  private tabContentMarkup(): string {
    if (this.activeTab === 'users') return this.usersMarkup();
    if (this.activeTab === 'ongoing') return this.ongoingMarkup();
    if (this.activeTab === 'past') return this.pastMarkup();
    return this.tutorialsMarkup();
  }

  private schedulePanelMarkup(): string {
    const schedule = this.communityRoundSchedule;
    const content = this.scheduleLoading
      ? '<p class="admin-empty">Loading scheduled rounds…</p>'
      : !schedule
        ? '<div class="admin-empty"><p>The scheduled rounds settings could not be loaded.</p><button id="retry-admin-schedule" type="button">Try again</button></div>'
        : (() => {
            const nextRound = getNextCommunityRoundState(new Date(), schedule);
            const values = getCommunityRoundScheduleInputValues({
              ...schedule,
              startsAt: nextRound.occurrence.toISOString(),
            });
            const nextRoundLabel = formatScheduledRoundDate(
              nextRound.occurrence,
              schedule,
            );
            return `<form id="admin-schedule-form" class="admin-schedule-form">
              <div class="admin-schedule-fields">
                <label>Date<input name="date" type="date" required value="${escapeHtml(values.date)}" /></label>
                <label>Time<input name="time" type="time" step="60" required value="${escapeHtml(values.time)}" /></label>
                <label>Repeats<select name="frequency" required>
                  <option value="daily" ${schedule.frequency === 'daily' ? 'selected' : ''}>Every day</option>
                  <option value="weekly" ${schedule.frequency === 'weekly' ? 'selected' : ''}>Every week</option>
                  <option value="monthly" ${schedule.frequency === 'monthly' ? 'selected' : ''}>Every month</option>
                </select></label>
              </div>
              <p class="admin-schedule-zone">Times use <strong>${escapeHtml(schedule.timeZone)}</strong>. The date anchors weekly and monthly recurrence.</p>
              <div class="admin-schedule-preview"><span>Next round</span><strong>${escapeHtml(nextRoundLabel)}</strong></div>
              <div class="admin-schedule-actions">
                <button id="cancel-admin-schedule" type="button">Cancel</button>
                <button type="submit" ${this.busy ? 'disabled' : ''}>Save schedule</button>
              </div>
            </form>`;
          })();
    return `<div class="admin-schedule-backdrop">
      <section class="admin-schedule-panel" role="dialog" aria-modal="true" aria-labelledby="admin-schedule-title">
        <header><div><span class="admin-eyebrow">Community calendar</span><h2 id="admin-schedule-title">Scheduled rounds</h2></div><button id="close-admin-schedule" type="button" aria-label="Close scheduled rounds">×</button></header>
        <p class="admin-schedule-intro">Set when the Community Round opens for players and how often it returns.</p>
        ${content}
      </section>
    </div>`;
  }

  private render(): void {
    if (this.destroyed) return;
    this.host.innerHTML = `<section class="admin-console" aria-labelledby="admin-menu-title">
      <header class="admin-header">
        <div><span class="admin-eyebrow">False Arrow operations</span><h1 id="admin-menu-title">Admin menu</h1><p id="admin-last-updated">${this.overview ? `Updated ${escapeHtml(formatDate(this.overview.generatedAt))}` : 'Connecting to the game server…'}</p></div>
        <div class="admin-header-actions"><button id="open-admin-schedule" type="button" ${this.busy ? 'disabled' : ''}>Scheduled rounds</button><a class="admin-style-editor" href="/style-editor.html" target="_blank" rel="noopener">Style Editor</a><button id="admin-refresh" type="button" ${this.loading || this.busy ? 'disabled' : ''}>Refresh</button><button id="admin-back" type="button">Back</button></div>
      </header>
      ${this.summaryMarkup()}
      <nav class="admin-tabs" aria-label="Admin sections">
        ${(['users', 'ongoing', 'past', 'tutorials'] as const)
          .map(
            (tab) =>
              `<button type="button" data-admin-tab="${tab}" aria-selected="${this.activeTab === tab}">${tab === 'ongoing' ? 'Ongoing rounds' : tab === 'past' ? 'Past rounds' : tab === 'tutorials' ? 'Tutorials' : 'Users'}</button>`,
          )
          .join('')}
      </nav>
      ${this.error ? `<div class="app-alert app-alert--error" role="alert">${escapeHtml(this.error)}</div>` : ''}
      <div id="admin-notice" class="app-alert app-alert--success" role="status" ${this.notice ? '' : 'hidden'}>${escapeHtml(this.notice ?? '')}</div>
      <div class="admin-content">${this.tabContentMarkup()}</div>
      ${this.schedulePanelOpen ? this.schedulePanelMarkup() : ''}
    </section>`;
    this.bindEvents();
  }

  private bindEvents(): void {
    this.host
      .querySelector('#admin-back')
      ?.addEventListener('click', this.options.onBack);
    this.host.querySelector('#admin-refresh')?.addEventListener('click', () => {
      void this.refreshCurrentTab();
    });
    this.host.querySelector('#open-admin-schedule')?.addEventListener('click', () => {
      void this.openSchedulePanel();
    });
    this.host.querySelector('#retry-admin-schedule')?.addEventListener('click', () => {
      void this.openSchedulePanel();
    });
    this.host
      .querySelectorAll('#close-admin-schedule, #cancel-admin-schedule')
      .forEach((button) => {
        button.addEventListener('click', () => {
          if (this.busy) return;
          this.schedulePanelOpen = false;
          this.render();
        });
      });
    const scheduleForm = this.host.querySelector<HTMLFormElement>('#admin-schedule-form');
    scheduleForm?.addEventListener(
      'submit',
      (event) => void this.saveCommunityRoundSchedule(event),
    );
    scheduleForm
      ?.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select')
      .forEach((control) => {
        control.addEventListener('input', () =>
          this.updateCommunityRoundSchedulePreview(scheduleForm),
        );
      });
    this.host
      .querySelectorAll<HTMLButtonElement>('[data-admin-tab]')
      .forEach((button) => {
        button.addEventListener('click', () => {
          const tab = button.dataset.adminTab as AdminTab;
          if (tab !== this.activeTab) void this.loadTab(tab);
        });
      });
    this.host
      .querySelectorAll<HTMLDetailsElement>('[data-room-id]')
      .forEach((details) => {
        details.addEventListener('toggle', () => {
          const roomId = details.dataset.roomId;
          if (!roomId) return;
          if (details.open) this.expandedRoomIds.add(roomId);
          else this.expandedRoomIds.delete(roomId);
        });
      });
    const userFilters = this.host.querySelector<HTMLFormElement>('#admin-user-filters');
    userFilters?.addEventListener('submit', (event) => {
      event.preventDefault();
      this.requestUserFilterLoad(userFilters, false);
    });
    userFilters
      ?.querySelector<HTMLInputElement>('input[name="q"]')
      ?.addEventListener('input', () => this.requestUserFilterLoad(userFilters, true));
    userFilters?.querySelectorAll<HTMLSelectElement>('select').forEach((select) => {
      select.addEventListener('change', () =>
        this.requestUserFilterLoad(userFilters, false),
      );
    });
    const roundFilters = this.host.querySelector<HTMLFormElement>('#admin-round-filters');
    roundFilters?.addEventListener('submit', (event) => {
      event.preventDefault();
      this.requestRoundFilterLoad(roundFilters, false);
    });
    roundFilters
      ?.querySelector<HTMLInputElement>('input[name="q"]')
      ?.addEventListener('input', () => this.requestRoundFilterLoad(roundFilters, true));
    roundFilters?.querySelectorAll<HTMLSelectElement>('select').forEach((select) => {
      select.addEventListener('change', () =>
        this.requestRoundFilterLoad(roundFilters, false),
      );
    });
    const tutorialFilters = this.host.querySelector<HTMLFormElement>(
      '#admin-tutorial-filters',
    );
    tutorialFilters?.addEventListener('submit', (event) => {
      event.preventDefault();
      this.requestTutorialFilterLoad(tutorialFilters, false);
    });
    tutorialFilters
      ?.querySelector<HTMLInputElement>('input[name="q"]')
      ?.addEventListener('input', () =>
        this.requestTutorialFilterLoad(tutorialFilters, true),
      );
    tutorialFilters?.querySelectorAll<HTMLSelectElement>('select').forEach((select) => {
      select.addEventListener('change', () =>
        this.requestTutorialFilterLoad(tutorialFilters, false),
      );
    });
    this.host
      .querySelectorAll<HTMLButtonElement>('[data-page-kind]')
      .forEach((button) => {
        button.addEventListener('click', () => {
          const page = Number(button.dataset.page);
          if (!Number.isInteger(page) || page < 1) return;
          if (button.dataset.pageKind === 'users') {
            this.clearUserFilterTimer();
            ++this.userFilterGeneration;
            this.usersFilter.page = page;
            void this.loadTab('users');
          } else if (button.dataset.pageKind === 'rounds') {
            this.clearRoundFilterTimer();
            ++this.roundFilterGeneration;
            this.roundsFilter.page = page;
            void this.loadTab('past');
          } else if (button.dataset.pageKind === 'tutorials') {
            this.clearTutorialFilterTimer();
            ++this.tutorialFilterGeneration;
            this.tutorialsFilter.page = page;
            void this.loadTab('tutorials');
          }
        });
      });
    this.host.querySelectorAll<HTMLTableRowElement>('[data-user-id]').forEach((row) => {
      const openUser = () => {
        this.selectedUser =
          this.users?.items.find((user) => user.id === row.dataset.userId) ?? null;
        this.render();
      };
      row.addEventListener('click', (event) => {
        if ((event.target as HTMLElement).closest('[data-admin-selectable]')) return;
        const selection = window.getSelection();
        if (selection && !selection.isCollapsed) return;
        openUser();
      });
      row.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        openUser();
      });
    });
    this.host.querySelector('#close-admin-user')?.addEventListener('click', () => {
      this.selectedUser = null;
      this.render();
    });
    this.host
      .querySelector<HTMLFormElement>('#admin-profile-form')
      ?.addEventListener('submit', (event) => void this.saveSelectedProfile(event));
    this.host.querySelector('#toggle-admin-role')?.addEventListener('click', () => {
      void this.toggleSelectedAdmin();
    });
    this.host.querySelector('#toggle-user-suspension')?.addEventListener('click', () => {
      void this.toggleSelectedSuspension();
    });
    this.host.querySelector('#retry-auth-ban')?.addEventListener('click', () => {
      void this.retrySelectedAuthBan();
    });
    this.host.querySelectorAll<HTMLButtonElement>('[data-round-id]').forEach((button) => {
      button.addEventListener(
        'click',
        () => void this.openRound(button.dataset.roundId!),
      );
    });
    this.host.querySelector('#close-admin-round')?.addEventListener('click', () => {
      this.selectedRound = null;
      this.render();
    });
  }

  private async runMutation(
    action: () => Promise<{ user: AdminUserSummary; warning?: string }>,
  ) {
    if (this.busy) return;
    this.busy = true;
    this.error = null;
    this.notice = null;
    this.render();
    try {
      const result = await action();
      this.selectedUser = result.user;
      if (result.user.id === this.options.currentUserId) {
        this.options.onCurrentUserUpdated(result.user);
      }
      if (this.users) {
        this.users.items = this.users.items.map((user) =>
          user.id === result.user.id ? result.user : user,
        );
      }
      this.notice = result.warning ?? 'User updated.';
      this.overview = await this.api.getOverview();
    } catch (error) {
      this.handleError(error);
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private async openSchedulePanel(): Promise<void> {
    if (this.busy) return;
    this.schedulePanelOpen = true;
    this.error = null;
    if (this.communityRoundSchedule) {
      this.render();
      return;
    }
    this.scheduleLoading = true;
    this.render();
    try {
      this.communityRoundSchedule = cacheCommunityRoundSchedule(
        await this.api.getCommunityRoundSchedule(),
      );
    } catch (error) {
      this.handleError(error);
    } finally {
      this.scheduleLoading = false;
      this.render();
    }
  }

  private async saveCommunityRoundSchedule(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (this.busy || !this.communityRoundSchedule) return;
    const form = event.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    const startsAt = communityRoundStartAtFromZonedInput(
      String(data.get('date') ?? ''),
      String(data.get('time') ?? ''),
      this.communityRoundSchedule.timeZone,
    );
    const frequency = String(data.get('frequency') ?? '');
    if (!startsAt || !['daily', 'weekly', 'monthly'].includes(frequency)) {
      this.error = 'Choose a valid scheduled round date, time, and frequency.';
      this.render();
      return;
    }

    this.busy = true;
    this.error = null;
    form
      .querySelectorAll<
        HTMLButtonElement | HTMLInputElement | HTMLSelectElement
      >('button, input, select')
      .forEach((control) => {
        control.disabled = true;
      });
    try {
      this.communityRoundSchedule = cacheCommunityRoundSchedule(
        await this.api.updateCommunityRoundSchedule({
          startsAt: startsAt.toISOString(),
          frequency,
        }),
      );
      this.schedulePanelOpen = false;
      this.notice = 'Scheduled rounds updated.';
    } catch (error) {
      this.handleError(error);
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private updateCommunityRoundSchedulePreview(form: HTMLFormElement): void {
    if (!this.communityRoundSchedule) return;
    const data = new FormData(form);
    const startsAt = communityRoundStartAtFromZonedInput(
      String(data.get('date') ?? ''),
      String(data.get('time') ?? ''),
      this.communityRoundSchedule.timeZone,
    );
    const frequency = String(data.get('frequency') ?? '');
    const preview = form.querySelector<HTMLElement>('.admin-schedule-preview strong');
    if (!startsAt || !preview || !['daily', 'weekly', 'monthly'].includes(frequency)) {
      return;
    }
    const schedule = {
      ...this.communityRoundSchedule,
      startsAt: startsAt.toISOString(),
      frequency: frequency as CommunityRoundSchedule['frequency'],
    };
    preview.textContent = formatScheduledRoundDate(
      getNextCommunityRoundState(new Date(), schedule).occurrence,
      schedule,
    );
  }

  private async saveSelectedProfile(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!this.selectedUser) return;
    const data = new FormData(event.currentTarget as HTMLFormElement);
    const userId = this.selectedUser.id;
    const avatarUrl = this.selectedUser.avatarUrl ?? '';
    await this.runMutation(() =>
      this.api.updateProfile(userId, {
        displayName: String(data.get('displayName') ?? ''),
        avatarUrl,
      }),
    );
  }

  private async toggleSelectedAdmin(): Promise<void> {
    const user = this.selectedUser;
    if (!user) return;
    const next = !user.isAdmin;
    if (
      !window.confirm(
        `${next ? 'Grant' : 'Revoke'} administrator access for ${user.displayName}?`,
      )
    ) {
      return;
    }
    await this.runMutation(() => this.api.setAdmin(user.id, next));
  }

  private async toggleSelectedSuspension(): Promise<void> {
    const user = this.selectedUser;
    if (!user) return;
    const suspend = !user.suspendedAt;
    let reason = '';
    if (suspend) {
      const input = window.prompt(`Why should ${user.displayName} be suspended?`);
      if (input === null) return;
      reason = input.trim();
      if (!reason) {
        this.error = 'A suspension reason is required.';
        this.render();
        return;
      }
    } else if (!window.confirm(`Reactivate ${user.displayName}?`)) {
      return;
    }
    await this.runMutation(async () => {
      const result = await this.api.setSuspension(user.id, suspend, reason);
      this.authSyncRetryUserId = result.warning ? user.id : null;
      return result;
    });
  }

  private async retrySelectedAuthBan(): Promise<void> {
    const user = this.selectedUser;
    if (!user?.suspendedAt) return;
    await this.runMutation(async () => {
      const result = await this.api.setSuspension(
        user.id,
        true,
        'Retry Auth ban synchronization',
      );
      this.authSyncRetryUserId = result.warning ? user.id : null;
      return result;
    });
  }

  private async openRound(roundId: string): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.error = null;
    try {
      this.selectedRound = await this.api.getRound(roundId);
    } catch (error) {
      this.handleError(error);
    } finally {
      this.busy = false;
      this.render();
    }
  }
}
