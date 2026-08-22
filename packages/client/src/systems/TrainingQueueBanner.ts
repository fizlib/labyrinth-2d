export interface TrainingQueueStatus {
  matchReady: boolean;
}

export interface TrainingQueueSubscription {
  initialStatus: TrainingQueueStatus;
  subscribe: (listener: (status: TrainingQueueStatus) => void) => () => void;
  onReturnToLobby: () => void;
  onTrainingComplete: () => void;
}

/** Matchmaking status shown above the local tutorial while the real seat stays queued. */
export class TrainingQueueBanner {
  private readonly root = document.createElement('aside');
  private readonly headline: HTMLElement;
  private readonly detail: HTMLElement;
  private readonly unsubscribe: () => void;
  private dots = 0;
  private dotsHandle: number | null = null;
  private matchReady = false;

  constructor(parent: HTMLElement, queue: TrainingQueueSubscription) {
    this.root.className = 'training-queue-banner';
    this.root.setAttribute('aria-label', 'Matchmaking status');
    this.root.innerHTML = `
      <button class="training-queue-banner__back" type="button" aria-label="Back to lobby">
        <span aria-hidden="true">←</span>
        <span>Back to lobby</span>
      </button>
      <div class="training-queue-banner__message" role="status" aria-live="polite">
        <strong class="training-queue-banner__headline"></strong>
        <span class="training-queue-banner__detail"></span>
      </div>`;

    const headline = this.root.querySelector<HTMLElement>(
      '.training-queue-banner__headline',
    );
    const detail = this.root.querySelector<HTMLElement>('.training-queue-banner__detail');
    if (!headline || !detail) {
      throw new Error('Training queue banner markup is incomplete.');
    }
    this.headline = headline;
    this.detail = detail;
    this.root
      .querySelector<HTMLButtonElement>('.training-queue-banner__back')
      ?.addEventListener('click', queue.onReturnToLobby);

    parent.appendChild(this.root);
    this.setStatus(queue.initialStatus);
    this.unsubscribe = queue.subscribe((status) => this.setStatus(status));
  }

  destroy(): void {
    this.stopDots();
    this.unsubscribe();
    this.root.remove();
  }

  setCoveredByGameMenu(covered: boolean): void {
    this.root.hidden = covered;
  }

  private setStatus(status: TrainingQueueStatus): void {
    if (status.matchReady === this.matchReady && this.headline.textContent) return;
    this.matchReady = status.matchReady;
    this.root.classList.toggle('training-queue-banner--ready', this.matchReady);

    if (this.matchReady) {
      this.stopDots();
      this.headline.textContent = 'Match ready!';
      this.detail.textContent = 'Join the lobby';
      return;
    }

    this.dots = 0;
    this.detail.textContent = 'Keep training while you wait';
    this.renderFindingPlayers();
    this.startDots();
  }

  private startDots(): void {
    if (this.dotsHandle !== null) return;
    this.dotsHandle = window.setInterval(() => {
      this.dots = (this.dots + 1) % 3;
      this.renderFindingPlayers();
    }, 650);
  }

  private stopDots(): void {
    if (this.dotsHandle === null) return;
    window.clearInterval(this.dotsHandle);
    this.dotsHandle = null;
  }

  private renderFindingPlayers(): void {
    this.headline.textContent = `Finding players${'.'.repeat(this.dots + 1)}`;
  }
}
