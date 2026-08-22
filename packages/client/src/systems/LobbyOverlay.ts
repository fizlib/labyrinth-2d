import {
  CHAT_MAX_LENGTH,
  type LobbyChatMessageKind,
  type LobbyState,
} from '@labyrinth/shared';
import { audioToggleMarkup } from './AudioToggle';
import {
  formatCommunityRoundWait,
  getCommunityRoundGoogleCalendarUrl,
  getNextCommunityRoundState,
} from './CommunityRoundSchedule';

const COMMUNITY_ROUND_DISCORD_REMINDER_URL =
  'https://discord.gg/kJYab8PbD?event=1540020495485894686';

interface LobbyOverlayOptions {
  parent: HTMLElement;
  localPlayerId: string;
  initialState: LobbyState;
  isAdmin: boolean;
  onVote: (vote: boolean) => void;
  onStartNow: () => void;
  onKick: (playerId: string) => void;
  onSendChat: (text: string) => void;
  onLeave: () => void;
  firstTimeTraining?: {
    onStart: () => void;
    onWait?: () => void;
  };
  trainingComplete?: boolean;
}

interface LobbyChatEntry {
  playerId: string;
  displayName: string;
  text: string;
  kind: LobbyChatMessageKind;
  sentAt: number;
}

export class LobbyOverlay {
  private readonly root = document.createElement('section');
  private readonly roster: HTMLUListElement;
  private readonly count: HTMLElement;
  private readonly status: HTMLElement;
  private readonly voteButton: HTMLButtonElement;
  private readonly adminStartButton: HTMLButtonElement;
  private readonly chatLog: HTMLDivElement;
  private readonly chatForm: HTMLFormElement;
  private readonly chatInput: HTMLInputElement;
  private readonly trainingCompleteCountdown: HTMLElement | null;
  private readonly trainingCompleteCalendarLink: HTMLAnchorElement | null;
  private readonly localPlayerId: string;
  private readonly isAdmin: boolean;
  private readonly onVote: (vote: boolean) => void;
  private readonly onKick: (playerId: string) => void;
  private readonly onSendChat: (text: string) => void;
  private state: LobbyState;
  private readonly messages: LobbyChatEntry[] = [];
  private readonly clockHandle: number;

  constructor(options: LobbyOverlayOptions) {
    this.localPlayerId = options.localPlayerId;
    this.isAdmin = options.isAdmin;
    this.onVote = options.onVote;
    this.onKick = options.onKick;
    this.onSendChat = options.onSendChat;
    this.state = options.initialState;
    this.root.className = 'lobby-overlay';
    this.root.setAttribute('aria-labelledby', 'lobby-title');
    this.root.innerHTML = `
      <div class="lobby-overlay__landscape" aria-hidden="true">
        <img class="app-parallax__layer app-parallax__layer--sky" src="/assets/home/sky.png" alt="" />
        <img class="app-parallax__layer app-parallax__layer--clouds" src="/assets/home/clouds.png" alt="" />
        <img class="app-parallax__layer app-parallax__layer--hills" src="/assets/home/hills.png" alt="" />
        <img class="app-parallax__layer app-parallax__layer--field" src="/assets/home/field.png" alt="" />
      </div>
      <div class="lobby-overlay__scroller">
        <div class="lobby-panel">
          <header class="lobby-header">
            ${audioToggleMarkup('audio-toggle--lobby')}
            <div class="lobby-header__title">
              <h1 id="lobby-title">Waiting Room</h1>
            </div>
            <button class="lobby-code" type="button" title="Copy room link">
              <span>Room Code</span><strong></strong><small>Copy link</small>
            </button>
          </header>
          <div class="lobby-layout">
            <section class="lobby-party" aria-labelledby="lobby-party-title">
              <div class="lobby-section-heading">
                <h2 id="lobby-party-title">Explorers</h2>
                <span class="lobby-count" aria-live="polite"></span>
              </div>
              <ul class="lobby-roster" aria-label="Players in this room"></ul>
            </section>
            <section class="lobby-chat" aria-labelledby="lobby-chat-title">
              <div class="lobby-section-heading"><h2 id="lobby-chat-title">Lobby chat</h2></div>
              <div class="lobby-chat__log" role="log" aria-live="polite"></div>
              <form class="lobby-chat__form">
                <label class="sr-only" for="lobby-chat-input">Message the lobby</label>
                <input id="lobby-chat-input" type="text" maxlength="${CHAT_MAX_LENGTH}" autocomplete="off" placeholder="Message the lobby…" />
                <button type="submit" aria-label="Send message">Send</button>
              </form>
            </section>
          </div>
          <footer class="lobby-footer">
            <p class="lobby-status" aria-live="polite"></p>
            <div class="lobby-actions">
              <button class="pixel-button pixel-button--quiet lobby-leave" type="button">Leave</button>
              <button class="pixel-button pixel-button--primary lobby-admin-start" type="button" ${options.isAdmin ? '' : 'hidden'}>Start Game Now</button>
              <button class="pixel-button pixel-button--primary lobby-vote" type="button"></button>
            </div>
          </footer>
        </div>
      </div>
      ${
        options.firstTimeTraining
          ? `
        <div class="first-time-training" role="presentation">
          <section class="first-time-training__dialog" role="dialog" aria-modal="true" aria-labelledby="first-time-training-title" aria-describedby="first-time-training-description">
            <h2 id="first-time-training-title">First time playing?</h2>
            <p id="first-time-training-description">Try a 60-second training maze while we find your next round.</p>
            <div class="first-time-training__actions">
              <button class="first-time-training__start" type="button">Start training</button>
              <button class="first-time-training__wait" type="button">Wait in lobby</button>
            </div>
          </section>
        </div>`
          : ''
      }
      ${
        options.trainingComplete
          ? `
        <div class="first-time-training training-complete" role="presentation">
          <section class="first-time-training__dialog training-complete__dialog" role="dialog" aria-modal="true" aria-labelledby="training-complete-title" aria-describedby="training-complete-description">
            <h2 id="training-complete-title">Training complete!</h2>
            <p id="training-complete-description">We’re still finding players. You can keep waiting, or come back for the next community round in <strong class="training-complete__countdown"></strong>.</p>
            <div class="training-complete__reminder-choices" aria-label="Reminder choices" hidden>
              <a class="training-complete__reminder-link training-complete__reminder-link--discord" href="${COMMUNITY_ROUND_DISCORD_REMINDER_URL}" target="_blank" rel="noopener noreferrer">
                <svg class="training-complete__reminder-icon training-complete__reminder-icon--discord" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M19.5 5.34A16.3 16.3 0 0 0 15.44 4l-.5 1.03a15.3 15.3 0 0 0-5.85 0L8.56 4A16.4 16.4 0 0 0 4.5 5.34C1.93 9.15 1.24 12.86 1.59 16.52a16.5 16.5 0 0 0 4.98 2.52l1.2-1.64a10.6 10.6 0 0 1-1.89-.91l.46-.35c3.64 1.69 7.58 1.69 11.18 0l.47.35c-.61.36-1.25.66-1.9.91l1.2 1.64a16.4 16.4 0 0 0 4.98-2.52c.41-4.24-.7-7.92-2.77-11.18ZM8.73 14.27c-1.1 0-2-1-2-2.22s.88-2.22 2-2.22c1.13 0 2.03 1 2 2.22 0 1.22-.88 2.22-2 2.22Zm6.55 0c-1.1 0-2-1-2-2.22s.88-2.22 2-2.22c1.12 0 2.02 1 2 2.22 0 1.22-.88 2.22-2 2.22Z" />
                </svg>
                <span>Remind me on Discord</span>
              </a>
              <a class="training-complete__reminder-link training-complete__calendar-link" href="https://calendar.google.com/" target="_blank" rel="noopener noreferrer">
                <svg class="training-complete__reminder-icon training-complete__reminder-icon--calendar" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M7 3v3M17 3v3M4 9h16M6 5h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" />
                  <path d="M8 13h3v3H8z" />
                </svg>
                <span>Add to Google Calendar</span>
              </a>
            </div>
            <div class="first-time-training__actions training-complete__actions">
              <button class="first-time-training__start training-complete__remind" type="button">Get a reminder</button>
              <button class="training-complete__wait" type="button">Keep waiting</button>
            </div>
          </section>
        </div>`
          : ''
      }`;

    const roster = this.root.querySelector<HTMLUListElement>('.lobby-roster');
    const count = this.root.querySelector<HTMLElement>('.lobby-count');
    const status = this.root.querySelector<HTMLElement>('.lobby-status');
    const voteButton = this.root.querySelector<HTMLButtonElement>('.lobby-vote');
    const adminStartButton =
      this.root.querySelector<HTMLButtonElement>('.lobby-admin-start');
    const chatLog = this.root.querySelector<HTMLDivElement>('.lobby-chat__log');
    const chatForm = this.root.querySelector<HTMLFormElement>('.lobby-chat__form');
    const chatInput = this.root.querySelector<HTMLInputElement>('#lobby-chat-input');
    if (
      !roster ||
      !count ||
      !status ||
      !voteButton ||
      !adminStartButton ||
      !chatLog ||
      !chatForm ||
      !chatInput
    ) {
      throw new Error('Lobby overlay markup is incomplete.');
    }
    this.roster = roster;
    this.count = count;
    this.status = status;
    this.voteButton = voteButton;
    this.adminStartButton = adminStartButton;
    this.chatLog = chatLog;
    this.chatForm = chatForm;
    this.chatInput = chatInput;
    this.trainingCompleteCountdown = this.root.querySelector<HTMLElement>(
      '.training-complete__countdown',
    );
    this.trainingCompleteCalendarLink =
      this.root.querySelector<HTMLAnchorElement>('.training-complete__calendar-link');

    const codeButton = this.root.querySelector<HTMLButtonElement>('.lobby-code');
    const code = codeButton?.querySelector('strong');
    if (code) code.textContent = this.state.roomId;
    codeButton?.addEventListener('click', () => void this.copyRoomLink(codeButton));
    this.voteButton.addEventListener('click', () => {
      const me = this.state.players.find((player) => player.id === this.localPlayerId);
      this.onVote(!(me?.votedToStart ?? false));
    });
    this.adminStartButton.addEventListener('click', options.onStartNow);
    this.root
      .querySelector<HTMLButtonElement>('.lobby-leave')
      ?.addEventListener('click', () => {
        options.onLeave();
      });
    this.chatForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const text = this.chatInput.value.trim();
      if (!text) return;
      this.onSendChat(text);
      this.chatInput.value = '';
    });
    this.chatInput.addEventListener('keydown', (event) => {
      event.stopPropagation();
    });
    this.chatInput.addEventListener('keyup', (event) => {
      event.stopPropagation();
    });

    const firstTimePrompt = this.root.querySelector<HTMLElement>('.first-time-training');
    if (firstTimePrompt && options.firstTimeTraining) {
      const dismissPrompt = (): void => {
        firstTimePrompt.remove();
        this.root.classList.remove('lobby-overlay--first-time');
      };
      const waitInLobby = (): void => {
        dismissPrompt();
        options.firstTimeTraining?.onWait?.();
      };
      this.root.classList.add('lobby-overlay--first-time');
      firstTimePrompt
        .querySelector<HTMLButtonElement>('.first-time-training__start')
        ?.addEventListener('click', () => {
          dismissPrompt();
          options.firstTimeTraining?.onStart();
        });
      firstTimePrompt
        .querySelector<HTMLButtonElement>('.first-time-training__wait')
        ?.addEventListener('click', waitInLobby);
      firstTimePrompt.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') waitInLobby();
      });
      window.requestAnimationFrame(() => {
        firstTimePrompt
          .querySelector<HTMLButtonElement>('.first-time-training__start')
          ?.focus();
      });
    }

    const trainingCompletePrompt =
      this.root.querySelector<HTMLElement>('.training-complete');
    if (trainingCompletePrompt && options.trainingComplete) {
      const keepWaiting = (): void => {
        trainingCompletePrompt.remove();
        this.root.classList.remove('lobby-overlay--first-time');
      };
      const reminderChoices = trainingCompletePrompt.querySelector<HTMLElement>(
        '.training-complete__reminder-choices',
      );
      const reminderButton = trainingCompletePrompt.querySelector<HTMLButtonElement>(
        '.training-complete__remind',
      );
      this.root.classList.add('lobby-overlay--first-time');
      reminderButton?.addEventListener('click', () => {
        reminderButton.hidden = true;
        if (reminderChoices) reminderChoices.hidden = false;
        reminderChoices?.querySelector<HTMLAnchorElement>('a')?.focus();
      });
      trainingCompletePrompt
        .querySelector<HTMLButtonElement>('.training-complete__wait')
        ?.addEventListener('click', keepWaiting);
      trainingCompletePrompt.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') keepWaiting();
      });
      window.requestAnimationFrame(() => reminderButton?.focus());
    }

    options.parent.appendChild(this.root);
    this.renderState();
    this.clockHandle = window.setInterval(() => this.renderStatus(), 250);
  }

  update(state: LobbyState): void {
    this.state = state;
    this.renderState();
  }

  addMessage(message: LobbyChatEntry): void {
    this.messages.push(message);
    if (this.messages.length > 30) this.messages.shift();

    const entry = document.createElement('p');
    entry.className = 'lobby-chat__message';
    if (message.kind === 'join' || message.kind === 'leave') {
      entry.classList.add(
        'lobby-chat__message--announcement',
        `lobby-chat__message--${message.kind}`,
      );
    }
    const name = document.createElement('strong');
    name.textContent = message.displayName;
    const body = document.createElement('span');
    body.textContent = message.text;
    entry.append(name, body);
    this.chatLog.appendChild(entry);
    while (this.chatLog.childElementCount > 30) this.chatLog.firstElementChild?.remove();
    this.chatLog.scrollTop = this.chatLog.scrollHeight;
  }

  destroy(): void {
    window.clearInterval(this.clockHandle);
    this.root.remove();
  }

  private renderState(): void {
    const connectedCount = this.state.players.filter((player) => player.connected).length;
    const disconnectedCount = this.state.players.length - connectedCount;
    this.count.textContent =
      disconnectedCount > 0
        ? `${connectedCount} online · ${this.state.players.length} / ${this.state.maxPlayers}`
        : `${this.state.players.length} / ${this.state.maxPlayers}`;
    this.roster.replaceChildren();
    for (let index = 0; index < this.state.maxPlayers; index++) {
      const player = this.state.players[index];
      const item = document.createElement('li');
      item.className = player
        ? `lobby-player${player.connected ? '' : ' lobby-player--disconnected'}`
        : 'lobby-player lobby-player--empty';
      if (player?.id === this.localPlayerId) item.classList.add('lobby-player--local');
      const ordinal = document.createElement('span');
      ordinal.className = 'lobby-player__ordinal';
      ordinal.textContent = String(index + 1).padStart(2, '0');
      const name = document.createElement('span');
      name.className = 'lobby-player__name';
      name.textContent = player
        ? `${player.displayName}${player.id === this.localPlayerId ? ' (you)' : ''}`
        : 'Open place';
      const identity = document.createElement('span');
      identity.className = 'lobby-player__identity';
      identity.appendChild(name);
      if (this.isAdmin && player && player.id !== this.localPlayerId) {
        const kickButton = document.createElement('button');
        kickButton.className = 'lobby-player__kick';
        kickButton.type = 'button';
        kickButton.textContent = '×';
        kickButton.title = `Remove ${player.displayName} from lobby`;
        kickButton.setAttribute('aria-label', kickButton.title);
        kickButton.addEventListener('click', () => this.onKick(player.id));
        identity.appendChild(kickButton);
      }
      const vote = document.createElement('span');
      vote.className = 'lobby-player__vote';
      vote.textContent = player
        ? player.connected
          ? player.votedToStart
            ? 'Ready'
            : ''
          : 'Reconnecting'
        : '';
      item.append(ordinal, identity, vote);
      this.roster.appendChild(item);
    }
    this.renderStatus();
  }

  private renderStatus(): void {
    this.renderTrainingCompleteSchedule();
    const now = Date.now();
    const playerCount = this.state.players.length;
    const connectedCount = this.state.players.filter((player) => player.connected).length;
    const disconnectedCount = playerCount - connectedCount;
    const votes = this.state.players.filter((player) => player.votedToStart).length;
    const me = this.state.players.find((player) => player.id === this.localPlayerId);

    if (this.state.phase === 'loading') {
      this.status.textContent = 'Game is starting…';
      this.voteButton.textContent = 'Starting…';
      this.voteButton.disabled = true;
      this.adminStartButton.disabled = true;
      this.chatInput.disabled = true;
      this.root.classList.add('lobby-overlay--countdown');
      return;
    }

    if (this.state.phase === 'countdown' && this.state.countdownEndsAt !== null) {
      const seconds = Math.max(0, Math.ceil((this.state.countdownEndsAt - now) / 1_000));
      this.status.textContent = `The gates open in ${seconds}…`;
      this.voteButton.textContent = 'Starting…';
      this.voteButton.disabled = true;
      this.adminStartButton.disabled = false;
      this.root.classList.add('lobby-overlay--countdown');
      return;
    }

    this.root.classList.remove('lobby-overlay--countdown');
    this.chatInput.disabled = false;
    this.adminStartButton.disabled = disconnectedCount > 0;
    const waitMs = Math.max(0, this.state.voteAvailableAt - now);
    if (disconnectedCount > 0) {
      this.status.textContent =
        disconnectedCount === 1
          ? 'Waiting for 1 player to reconnect before starting.'
          : `Waiting for ${disconnectedCount} players to reconnect before starting.`;
    } else if (connectedCount < this.state.minPlayers) {
      const needed = this.state.minPlayers - connectedCount;
      this.status.textContent = this.isAdmin
        ? `You can start now, or wait for ${needed} more ${needed === 1 ? 'player' : 'players'} to unlock voting.`
        : `Waiting for ${needed} more ${needed === 1 ? 'player' : 'players'} to unlock early start.`;
    } else if (waitMs > 0) {
      this.status.textContent = `Vote to start unlocks in ${Math.ceil(waitMs / 1_000)}s. The game starts automatically at ${this.state.maxPlayers}.`;
    } else {
      this.status.textContent = `${votes} of ${this.state.votesRequired} votes · automatic start at ${this.state.maxPlayers} players.`;
    }

    this.voteButton.textContent = me?.votedToStart
      ? 'Withdraw vote'
      : `Vote to start (${votes}/${this.state.votesRequired})`;
    this.voteButton.disabled =
      disconnectedCount > 0 || connectedCount < this.state.minPlayers || waitMs > 0;
  }

  private renderTrainingCompleteSchedule(): void {
    if (!this.trainingCompleteCountdown) return;
    const nextRound = getNextCommunityRoundState(new Date());
    this.trainingCompleteCountdown.textContent = formatCommunityRoundWait(
      nextRound.remainingMs,
    );
    if (this.trainingCompleteCalendarLink) {
      this.trainingCompleteCalendarLink.href =
        getCommunityRoundGoogleCalendarUrl(nextRound.occurrence);
    }
  }

  private async copyRoomLink(button: HTMLButtonElement): Promise<void> {
    const url = new URL(window.location.href);
    url.searchParams.set('room', this.state.roomId);
    try {
      await navigator.clipboard.writeText(url.toString());
      const label = button.querySelector('small');
      if (label) {
        label.textContent = 'Copied!';
        window.setTimeout(() => {
          label.textContent = 'Copy link';
        }, 1_500);
      }
    } catch {
      window.prompt('Copy this room link:', url.toString());
    }
  }
}
