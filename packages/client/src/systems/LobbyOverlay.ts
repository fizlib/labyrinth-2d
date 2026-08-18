import {
  CHAT_MAX_LENGTH,
  type LobbyChatMessageKind,
  type LobbyState,
} from '@labyrinth/shared';

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
      <div class="lobby-panel">
        <header class="lobby-header">
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
      </div>`;

    const roster = this.root.querySelector<HTMLUListElement>('.lobby-roster');
    const count = this.root.querySelector<HTMLElement>('.lobby-count');
    const status = this.root.querySelector<HTMLElement>('.lobby-status');
    const voteButton = this.root.querySelector<HTMLButtonElement>('.lobby-vote');
    const adminStartButton = this.root.querySelector<HTMLButtonElement>('.lobby-admin-start');
    const chatLog = this.root.querySelector<HTMLDivElement>('.lobby-chat__log');
    const chatForm = this.root.querySelector<HTMLFormElement>('.lobby-chat__form');
    const chatInput = this.root.querySelector<HTMLInputElement>('#lobby-chat-input');
    if (!roster || !count || !status || !voteButton || !adminStartButton || !chatLog || !chatForm || !chatInput) {
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

    const codeButton = this.root.querySelector<HTMLButtonElement>('.lobby-code');
    const code = codeButton?.querySelector('strong');
    if (code) code.textContent = this.state.roomId;
    codeButton?.addEventListener('click', () => void this.copyRoomLink(codeButton));
    this.voteButton.addEventListener('click', () => {
      const me = this.state.players.find((player) => player.id === this.localPlayerId);
      this.onVote(!(me?.votedToStart ?? false));
    });
    this.adminStartButton.addEventListener('click', options.onStartNow);
    this.root.querySelector<HTMLButtonElement>('.lobby-leave')?.addEventListener('click', () => {
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
    this.count.textContent = disconnectedCount > 0
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
          ? player.votedToStart ? 'Ready' : ''
          : 'Reconnecting'
        : '';
      item.append(ordinal, identity, vote);
      this.roster.appendChild(item);
    }
    this.renderStatus();
  }

  private renderStatus(): void {
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
      this.status.textContent = disconnectedCount === 1
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

  private async copyRoomLink(button: HTMLButtonElement): Promise<void> {
    const url = new URL(window.location.href);
    url.searchParams.set('room', this.state.roomId);
    try {
      await navigator.clipboard.writeText(url.toString());
      const label = button.querySelector('small');
      if (label) {
        label.textContent = 'Copied!';
        window.setTimeout(() => { label.textContent = 'Copy link'; }, 1_500);
      }
    } catch {
      window.prompt('Copy this room link:', url.toString());
    }
  }
}
