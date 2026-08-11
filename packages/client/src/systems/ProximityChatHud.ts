import { CHAT_MAX_LENGTH, normalizeChatMessageText } from '@labyrinth/shared';

const CHAT_HISTORY_LIMIT = 4;
const CHAT_INACTIVITY_MS = 10_000;
const CHAT_INTERNAL_WIDTH = 270;
const CHAT_INTERNAL_LEFT = 14;
const CHAT_INTERNAL_BOTTOM = 10;

/** Brighter variants of the public blue, green, and yellow squad colors. */
const CHAT_SQUAD_NAME_COLORS = ['#72cfff', '#7ee879', '#ffe06a'] as const;
const CHAT_FALLBACK_NAME_COLOR = '#d8ded9';

export interface ProximityChatMessage {
  playerId: string;
  displayName: string;
  teamId: number;
  text: string;
}

interface SystemChatMessage {
  system: true;
  text: string;
}

type ChatHistoryMessage =
  | (ProximityChatMessage & { system: false })
  | SystemChatMessage;

interface ProximityChatHudOptions {
  parent: HTMLElement;
  canvas: HTMLCanvasElement;
  onSend: (text: string) => void;
  onActiveChange: (active: boolean) => void;
}

/** DOM-backed chat HUD so touch devices can use their native text keyboard. */
export class ProximityChatHud {
  private readonly root: HTMLDivElement;
  private readonly panel: HTMLDivElement;
  private readonly history: HTMLDivElement;
  private readonly form: HTMLFormElement;
  private readonly input: HTMLInputElement;
  private readonly counter: HTMLSpanElement;
  private readonly prompt: HTMLButtonElement;
  private readonly messages: ChatHistoryMessage[] = [];
  private readonly resizeObserver: ResizeObserver | null;
  private inactivityTimer: ReturnType<typeof setTimeout> | null = null;
  private active = false;
  private enabled = false;
  private suppressed = false;
  private historyVisible = false;

  constructor(private readonly options: ProximityChatHudOptions) {
    this.root = document.createElement('div');
    this.root.className = 'proximity-chat proximity-chat--disabled';

    this.panel = document.createElement('div');
    this.panel.className = 'proximity-chat__panel';

    this.history = document.createElement('div');
    this.history.className = 'proximity-chat__history';
    this.history.setAttribute('role', 'log');
    this.history.setAttribute('aria-live', 'polite');
    this.history.setAttribute('aria-relevant', 'additions');

    this.form = document.createElement('form');
    this.form.className = 'proximity-chat__form';
    this.form.noValidate = true;

    this.input = document.createElement('input');
    this.input.className = 'proximity-chat__input';
    this.input.type = 'text';
    this.input.maxLength = CHAT_MAX_LENGTH;
    this.input.autocomplete = 'off';
    this.input.enterKeyHint = 'send';
    this.input.setAttribute('aria-label', 'Chat message');

    this.counter = document.createElement('span');
    this.counter.className = 'proximity-chat__counter';
    this.counter.setAttribute('aria-label', 'Characters remaining');

    this.prompt = document.createElement('button');
    this.prompt.className = 'proximity-chat__prompt';
    this.prompt.type = 'button';
    this.prompt.textContent = '[Enter] To Chat';
    this.prompt.setAttribute('aria-label', 'Open proximity chat');

    this.form.append(this.input, this.counter);
    this.panel.append(this.history, this.form, this.prompt);
    this.root.appendChild(this.panel);
    this.options.parent.appendChild(this.root);

    this.updateCounter();
    this.syncLayout();

    this.prompt.addEventListener('click', this.handlePromptClick);
    this.form.addEventListener('submit', this.handleSubmit);
    this.input.addEventListener('input', this.handleInput);
    this.input.addEventListener('keydown', this.handleInputKeyDown);
    this.input.addEventListener('keyup', this.stopKeyboardPropagation);
    this.root.addEventListener('pointerdown', this.stopPointerPropagation);
    document.addEventListener('pointerdown', this.handleOutsidePointerDown, true);
    window.addEventListener('resize', this.handleViewportChange);
    window.addEventListener('orientationchange', this.handleViewportChange);

    if (typeof ResizeObserver === 'undefined') {
      this.resizeObserver = null;
    } else {
      this.resizeObserver = new ResizeObserver(() => this.syncLayout());
      this.resizeObserver.observe(this.options.parent);
      this.resizeObserver.observe(this.options.canvas);
    }
  }

  isActive(): boolean {
    return this.active;
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    this.root.classList.toggle('proximity-chat--disabled', !enabled);
    this.prompt.disabled = !enabled;
    if (!enabled && this.active) this.close();
  }

  /** Temporarily yield the bottom HUD area to a higher-priority game panel. */
  setSuppressed(suppressed: boolean): void {
    if (this.suppressed === suppressed) return;
    this.suppressed = suppressed;
    this.root.classList.toggle('proximity-chat--suppressed', suppressed);
    if (suppressed && this.active) this.close();
  }

  open(): void {
    if (!this.enabled || this.suppressed || this.active) return;
    this.cancelInactivityTimer();
    this.active = true;
    this.historyVisible = this.messages.length > 0;
    this.root.classList.add('proximity-chat--active');
    this.syncHistoryVisibility();
    this.input.value = '';
    this.updateCounter();
    this.options.onActiveChange(true);
    this.input.focus({ preventScroll: true });
  }

  close(): void {
    if (!this.active) return;
    this.active = false;
    this.root.classList.remove('proximity-chat--active');
    this.input.value = '';
    this.updateCounter();
    this.input.blur();
    this.options.onActiveChange(false);
    if (this.messages.length > 0) this.scheduleInactivityFade();
  }

  addMessage(message: ProximityChatMessage): void {
    this.addHistoryMessage({ ...message, system: false });
  }

  /** Add a server-triggered room-wide notice without attributing it to a player. */
  addSystemMessage(text: string): void {
    this.addHistoryMessage({ system: true, text });
  }

  private addHistoryMessage(message: ChatHistoryMessage): void {
    this.messages.push(message);
    if (this.messages.length > CHAT_HISTORY_LIMIT) this.messages.shift();
    this.historyVisible = true;
    this.renderMessages();
    this.syncHistoryVisibility();
    window.requestAnimationFrame(() => {
      this.history.scrollTop = this.history.scrollHeight;
    });
    if (!this.active) this.scheduleInactivityFade();
  }

  clear(): void {
    if (this.active) this.close();
    this.cancelInactivityTimer();
    this.messages.length = 0;
    this.historyVisible = false;
    this.history.replaceChildren();
    this.syncHistoryVisibility();
  }

  destroy(): void {
    this.cancelInactivityTimer();
    if (this.active) this.options.onActiveChange(false);
    this.resizeObserver?.disconnect();
    this.prompt.removeEventListener('click', this.handlePromptClick);
    this.form.removeEventListener('submit', this.handleSubmit);
    this.input.removeEventListener('input', this.handleInput);
    this.input.removeEventListener('keydown', this.handleInputKeyDown);
    this.input.removeEventListener('keyup', this.stopKeyboardPropagation);
    this.root.removeEventListener('pointerdown', this.stopPointerPropagation);
    document.removeEventListener('pointerdown', this.handleOutsidePointerDown, true);
    window.removeEventListener('resize', this.handleViewportChange);
    window.removeEventListener('orientationchange', this.handleViewportChange);
    this.root.remove();
  }

  private handlePromptClick = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    this.open();
  };

  private handleSubmit = (event: SubmitEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    this.submitCurrentMessage();
  };

  private submitCurrentMessage(): void {
    const text = normalizeChatMessageText(this.input.value);
    if (text !== null) this.options.onSend(text);
    this.close();
  }

  private handleInput = (): void => {
    if (this.input.value.length > CHAT_MAX_LENGTH) {
      this.input.value = this.input.value.slice(0, CHAT_MAX_LENGTH);
    }
    this.updateCounter();
  };

  private handleInputKeyDown = (event: KeyboardEvent): void => {
    event.stopPropagation();
    if (event.code === 'Enter' || event.code === 'NumpadEnter') {
      event.preventDefault();
      if (!event.repeat) this.submitCurrentMessage();
      return;
    }
    if (event.code !== 'Escape') return;
    event.preventDefault();
    this.close();
  };

  private stopKeyboardPropagation = (event: KeyboardEvent): void => {
    event.stopPropagation();
  };

  private stopPointerPropagation = (event: PointerEvent): void => {
    event.stopPropagation();
  };

  private handleOutsidePointerDown = (event: PointerEvent): void => {
    if (!this.active || this.root.contains(event.target as Node)) return;
    this.close();
  };

  private handleViewportChange = (): void => {
    this.syncLayout();
  };

  private updateCounter(): void {
    this.counter.textContent = String(
      Math.max(0, CHAT_MAX_LENGTH - this.input.value.length),
    );
  }

  private renderMessages(): void {
    const entries = this.messages.map((message) => {
      const entry = document.createElement('div');
      entry.className = 'proximity-chat__message';

      if (message.system) {
        entry.classList.add('proximity-chat__message--system');
        entry.textContent = message.text;
        return entry;
      }

      const name = document.createElement('span');
      name.className = 'proximity-chat__name';
      name.style.color = this.getSquadColor(message.teamId);
      name.textContent = `${message.displayName}:`;

      const body = document.createElement('span');
      body.className = 'proximity-chat__message-body';
      body.textContent = ` ${message.text}`;

      entry.append(name, body);
      return entry;
    });
    this.history.replaceChildren(...entries);
  }

  private getSquadColor(teamId: number): string {
    return CHAT_SQUAD_NAME_COLORS[teamId] ?? CHAT_FALLBACK_NAME_COLOR;
  }

  private scheduleInactivityFade(): void {
    this.cancelInactivityTimer();
    this.inactivityTimer = setTimeout(() => {
      this.inactivityTimer = null;
      if (this.active) return;
      this.historyVisible = false;
      this.syncHistoryVisibility();
    }, CHAT_INACTIVITY_MS);
  }

  private cancelInactivityTimer(): void {
    if (this.inactivityTimer === null) return;
    clearTimeout(this.inactivityTimer);
    this.inactivityTimer = null;
  }

  private syncHistoryVisibility(): void {
    this.root.classList.toggle(
      'proximity-chat--history-visible',
      this.historyVisible && this.messages.length > 0,
    );
  }

  private syncLayout(): void {
    const parentRect = this.options.parent.getBoundingClientRect();
    const canvasRect = this.options.canvas.getBoundingClientRect();
    if (canvasRect.width <= 0 || canvasRect.height <= 0) return;

    const scale = canvasRect.width / this.options.canvas.width;
    const width = Math.min(
      CHAT_INTERNAL_WIDTH * scale,
      canvasRect.width - CHAT_INTERNAL_LEFT * scale * 2,
    );

    this.root.style.left = `${canvasRect.left - parentRect.left}px`;
    this.root.style.top = `${canvasRect.top - parentRect.top}px`;
    this.root.style.width = `${canvasRect.width}px`;
    this.root.style.height = `${canvasRect.height}px`;
    this.root.style.setProperty('--chat-scale', String(scale));
    this.root.style.setProperty('--chat-width', `${Math.max(0, width)}px`);
    this.root.style.setProperty('--chat-left', `${CHAT_INTERNAL_LEFT * scale}px`);
    this.root.style.setProperty('--chat-bottom', `${CHAT_INTERNAL_BOTTOM * scale}px`);
  }
}
