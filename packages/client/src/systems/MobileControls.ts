export type MobileControlDirection = 'up' | 'down' | 'left' | 'right';

type MobileControlHandler = (direction: MobileControlDirection, pressed: boolean) => void;

interface MobileControlsOptions {
  parent: HTMLElement;
  onDirectionChange: MobileControlHandler;
  onInteract: () => void;
  onUseWisdom: () => void;
}

interface DirectionButtonConfig {
  direction: MobileControlDirection;
  label: string;
  ariaLabel: string;
  gridArea: string;
}

const MOBILE_CONTROLS_QUERY = '(hover: none) and (pointer: coarse)';

const DIRECTION_BUTTONS: readonly DirectionButtonConfig[] = [
  { direction: 'up', label: '&uarr;', ariaLabel: 'Walk north', gridArea: 'up' },
  { direction: 'left', label: '&larr;', ariaLabel: 'Walk west', gridArea: 'left' },
  { direction: 'right', label: '&rarr;', ariaLabel: 'Walk east', gridArea: 'right' },
  { direction: 'down', label: '&darr;', ariaLabel: 'Walk south', gridArea: 'down' },
];

export class MobileControls {
  private readonly root: HTMLDivElement;
  private readonly directionButtons: Record<MobileControlDirection, HTMLButtonElement>;
  private readonly directionPointers: Record<MobileControlDirection, Set<number>>;
  private readonly pointerDirections = new Map<number, MobileControlDirection>();
  private readonly interactPointers = new Set<number>();
  private readonly wisdomPointers = new Set<number>();
  private readonly interactButton: HTMLButtonElement;
  private readonly wisdomButton: HTMLButtonElement;
  private readonly mediaQuery: MediaQueryList;
  private readonly disposers: Array<() => void> = [];

  constructor(private readonly options: MobileControlsOptions) {
    this.mediaQuery = window.matchMedia(MOBILE_CONTROLS_QUERY);
    this.directionPointers = {
      up: new Set<number>(),
      down: new Set<number>(),
      left: new Set<number>(),
      right: new Set<number>(),
    };
    this.directionButtons = {
      up: this.createDirectionButton(DIRECTION_BUTTONS[0]),
      down: this.createDirectionButton(DIRECTION_BUTTONS[3]),
      left: this.createDirectionButton(DIRECTION_BUTTONS[1]),
      right: this.createDirectionButton(DIRECTION_BUTTONS[2]),
    };
    this.interactButton = this.createActionButton(
      'mobile-controls__button mobile-controls__button--interact',
      'E',
      'Interact',
      this.interactPointers,
      () => this.options.onInteract(),
    );
    this.wisdomButton = this.createActionButton(
      'mobile-controls__button mobile-controls__button--wisdom',
      'Q',
      'Use wisdom orb',
      this.wisdomPointers,
      () => this.options.onUseWisdom(),
    );

    this.root = document.createElement('div');
    this.root.className = 'mobile-controls';
    this.root.setAttribute('aria-hidden', 'true');

    const dpad = document.createElement('div');
    dpad.className = 'mobile-controls__dpad';
    for (const config of DIRECTION_BUTTONS) {
      dpad.appendChild(this.directionButtons[config.direction]);
    }

    const actions = document.createElement('div');
    actions.className = 'mobile-controls__actions';
    actions.appendChild(this.interactButton);
    actions.appendChild(this.wisdomButton);

    this.root.appendChild(dpad);
    this.root.appendChild(actions);
    this.options.parent.appendChild(this.root);

    this.addDisposable(window, 'pointerup', this.handlePointerRelease);
    this.addDisposable(window, 'pointercancel', this.handlePointerRelease);
    this.addDisposable(window, 'resize', this.updateVisibility);
    this.addDisposable(window, 'orientationchange', this.updateVisibility);
    this.addDisposable(window, 'blur', this.handleBlur);
    this.addDisposable(document, 'visibilitychange', this.handleVisibilityChange);
    this.addMediaQueryListener();
    this.updateVisibility();
  }

  destroy(): void {
    this.releaseAllInputs();
    for (const dispose of this.disposers.splice(0)) {
      dispose();
    }
    this.root.remove();
  }

  private createDirectionButton(config: DirectionButtonConfig): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'mobile-controls__button mobile-controls__button--direction';
    button.style.gridArea = config.gridArea;
    button.innerHTML = config.label;
    button.setAttribute('aria-label', config.ariaLabel);

    this.addDisposable(button, 'pointerdown', (event: PointerEvent) => {
      event.preventDefault();

      const previousDirection = this.pointerDirections.get(event.pointerId);
      if (previousDirection && previousDirection !== config.direction) {
        this.releaseDirectionPointer(previousDirection, event.pointerId);
      }

      const pointers = this.directionPointers[config.direction];
      if (pointers.has(event.pointerId)) return;

      this.pointerDirections.set(event.pointerId, config.direction);
      const wasInactive = pointers.size === 0;
      pointers.add(event.pointerId);
      if (wasInactive) {
        this.options.onDirectionChange(config.direction, true);
      }
      this.syncDirectionButtonState(config.direction);
    });

    this.addDisposable(button, 'pointerleave', (event: PointerEvent) => {
      this.releaseDirectionPointer(config.direction, event.pointerId);
    });

    this.addDisposable(button, 'contextmenu', (event: MouseEvent) => {
      event.preventDefault();
    });

    return button;
  }

  private createActionButton(
    className: string,
    label: string,
    ariaLabel: string,
    pointers: Set<number>,
    onPress: () => void,
  ): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = label;
    button.setAttribute('aria-label', ariaLabel);

    this.addDisposable(button, 'pointerdown', (event: PointerEvent) => {
      event.preventDefault();
      if (pointers.has(event.pointerId)) return;
      pointers.add(event.pointerId);
      this.syncActionButtonState(button, pointers);
      onPress();
    });

    this.addDisposable(button, 'pointerleave', (event: PointerEvent) => {
      this.releaseActionPointer(pointers, button, event.pointerId);
    });

    this.addDisposable(button, 'contextmenu', (event: MouseEvent) => {
      event.preventDefault();
    });

    return button;
  }

  private addMediaQueryListener(): void {
    const listener = this.updateVisibility;
    this.mediaQuery.addListener(listener);
    this.disposers.push(() => this.mediaQuery.removeListener(listener));
  }

  private addDisposable<K extends keyof WindowEventMap>(
    target: Window,
    type: K,
    listener: (event: WindowEventMap[K]) => void,
  ): void;
  private addDisposable<K extends keyof DocumentEventMap>(
    target: Document,
    type: K,
    listener: (event: DocumentEventMap[K]) => void,
  ): void;
  private addDisposable<K extends keyof HTMLElementEventMap>(
    target: HTMLElement,
    type: K,
    listener: (event: HTMLElementEventMap[K]) => void,
  ): void;
  private addDisposable(
    target: Window | Document | HTMLElement,
    type: string,
    listener: EventListenerOrEventListenerObject,
  ): void {
    target.addEventListener(type, listener);
    this.disposers.push(() => target.removeEventListener(type, listener));
  }

  private updateVisibility = (): void => {
    const visible = this.mediaQuery.matches;
    this.root.classList.toggle('mobile-controls--visible', visible);
    this.root.setAttribute('aria-hidden', visible ? 'false' : 'true');
    if (!visible) {
      this.releaseAllInputs();
    }
  };

  private handlePointerRelease = (event: PointerEvent): void => {
    const direction = this.pointerDirections.get(event.pointerId);
    if (direction) {
      this.releaseDirectionPointer(direction, event.pointerId);
    }
    this.releaseActionPointer(this.interactPointers, this.interactButton, event.pointerId);
    this.releaseActionPointer(this.wisdomPointers, this.wisdomButton, event.pointerId);
  };

  private handleBlur = (): void => {
    this.releaseAllInputs();
  };

  private handleVisibilityChange = (): void => {
    if (document.hidden) {
      this.releaseAllInputs();
      return;
    }
    this.updateVisibility();
  };

  private releaseDirectionPointer(direction: MobileControlDirection, pointerId: number): void {
    const pointers = this.directionPointers[direction];
    if (!pointers.delete(pointerId)) return;

    this.pointerDirections.delete(pointerId);
    if (pointers.size === 0) {
      this.options.onDirectionChange(direction, false);
    }
    this.syncDirectionButtonState(direction);
  }

  private releaseActionPointer(
    pointers: Set<number>,
    button: HTMLButtonElement,
    pointerId: number,
  ): void {
    if (!pointers.delete(pointerId)) return;
    this.syncActionButtonState(button, pointers);
  }

  private releaseAllInputs(): void {
    for (const direction of Object.keys(this.directionPointers) as MobileControlDirection[]) {
      if (this.directionPointers[direction].size > 0) {
        this.directionPointers[direction].clear();
        this.options.onDirectionChange(direction, false);
      }
      this.syncDirectionButtonState(direction);
    }

    this.pointerDirections.clear();
    this.interactPointers.clear();
    this.wisdomPointers.clear();
    this.syncActionButtonState(this.interactButton, this.interactPointers);
    this.syncActionButtonState(this.wisdomButton, this.wisdomPointers);
  }

  private syncDirectionButtonState(direction: MobileControlDirection): void {
    this.directionButtons[direction].classList.toggle(
      'is-pressed',
      this.directionPointers[direction].size > 0,
    );
  }

  private syncActionButtonState(button: HTMLButtonElement, pointers: Set<number>): void {
    button.classList.toggle('is-pressed', pointers.size > 0);
  }
}
