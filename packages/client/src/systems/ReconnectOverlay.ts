import type { NetworkConnectionState } from '../net/NetworkManager';

export interface ReconnectOverlayOptions {
  parent: HTMLElement;
  onLeave: () => void;
}

export class ReconnectOverlay {
  private readonly root: HTMLDivElement;
  private readonly title: HTMLHeadingElement;
  private readonly status: HTMLParagraphElement;
  private readonly leaveButton: HTMLButtonElement;
  private state: NetworkConnectionState = { status: 'connected' };
  private readonly clockHandle: number;

  constructor(options: ReconnectOverlayOptions) {
    this.root = document.createElement('div');
    this.root.className = 'reconnect-overlay';
    this.root.hidden = true;
    this.root.innerHTML = `
      <section class="reconnect-overlay__panel" role="alertdialog" aria-modal="true" aria-labelledby="reconnect-title">
        <div class="pixel-spinner reconnect-overlay__spinner" aria-hidden="true"><span></span><span></span><span></span></div>
        <h2 id="reconnect-title">Reconnecting…</h2>
        <p class="reconnect-overlay__status"></p>
        <button class="pixel-button pixel-button--quiet reconnect-overlay__leave" type="button">Return to Menu</button>
      </section>`;
    this.title = this.required('h2');
    this.status = this.required('.reconnect-overlay__status');
    this.leaveButton = this.required('.reconnect-overlay__leave');
    this.leaveButton.addEventListener('click', options.onLeave);
    options.parent.appendChild(this.root);
    this.clockHandle = window.setInterval(() => this.render(), 250);
  }

  update(state: NetworkConnectionState): void {
    this.state = state;
    this.render();
  }

  destroy(): void {
    window.clearInterval(this.clockHandle);
    this.root.remove();
  }

  private render(): void {
    if (this.state.status === 'connected') {
      this.root.hidden = true;
      return;
    }

    this.root.hidden = false;
    const spinner = this.root.querySelector<HTMLElement>('.reconnect-overlay__spinner');
    if (this.state.status === 'failed') {
      this.title.textContent = 'Connection lost';
      this.status.textContent = this.state.message;
      if (spinner) spinner.hidden = true;
      this.leaveButton.textContent = 'Return to Menu';
      return;
    }

    const remainingSeconds = Math.max(
      0,
      Math.ceil((this.state.deadline - Date.now()) / 1_000),
    );
    this.title.textContent = 'Reconnecting…';
    this.status.textContent =
      `Attempt ${this.state.attempt} · your seat is reserved for about ${remainingSeconds}s.`;
    if (spinner) spinner.hidden = false;
    this.leaveButton.textContent = 'Stop and Return to Menu';
  }

  private required<T extends Element>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) throw new Error(`Missing reconnect overlay element: ${selector}`);
    return element;
  }
}
