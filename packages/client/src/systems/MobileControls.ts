export type MobileControlDirection = 'up' | 'down' | 'left' | 'right';

type MobileControlHandler = (direction: MobileControlDirection, pressed: boolean) => void;

export interface FloatingJoystickConfig {
  /** Maximum knob travel in CSS pixels. Defaults to the visible base's inner radius. */
  maxRadius?: number;
  /** Distance from the center, in CSS pixels, that produces no movement. */
  deadZone?: number;
  /** Extra angular distance required to leave the current 45-degree sector. */
  hysteresisDegrees?: number;
}

interface MobileControlsOptions {
  parent: HTMLElement;
  onDirectionChange: MobileControlHandler;
  onInteract: () => void;
  onUseWisdom: () => void;
  joystick?: FloatingJoystickConfig;
}

const MOBILE_CONTROLS_QUERY = '(hover: none) and (pointer: coarse)';
const MOVE_DIRECTIONS: readonly MobileControlDirection[] = ['up', 'down', 'left', 'right'];
const DEFAULT_DEAD_ZONE = 14;
const DEFAULT_HYSTERESIS_DEGREES = 7.5;
const SECTOR_ANGLE_RADIANS = Math.PI / 4;
const HALF_SECTOR_ANGLE_RADIANS = SECTOR_ANGLE_RADIANS / 2;
const FULL_CIRCLE_RADIANS = Math.PI * 2;

// Screen-space sectors proceed clockwise because PointerEvent clientY grows downward.
const SECTOR_DIRECTIONS: readonly (readonly MobileControlDirection[])[] = [
  ['right'],
  ['right', 'down'],
  ['down'],
  ['down', 'left'],
  ['left'],
  ['left', 'up'],
  ['up'],
  ['up', 'right'],
];

function normalizeAngle(angle: number): number {
  return ((angle % FULL_CIRCLE_RADIANS) + FULL_CIRCLE_RADIANS) % FULL_CIRCLE_RADIANS;
}

function angularDistance(first: number, second: number): number {
  const difference = Math.abs(normalizeAngle(first) - normalizeAngle(second));
  return Math.min(difference, FULL_CIRCLE_RADIANS - difference);
}

export class MobileControls {
  private readonly root: HTMLDivElement;
  private readonly joystickRegion: HTMLDivElement;
  private readonly joystickVisual: HTMLDivElement;
  private readonly joystickKnob: HTMLDivElement;
  private readonly joystickDirections: Record<MobileControlDirection, boolean> = {
    up: false,
    down: false,
    left: false,
    right: false,
  };
  private readonly interactPointers = new Set<number>();
  private readonly wisdomPointers = new Set<number>();
  private readonly interactButton: HTMLButtonElement;
  private readonly wisdomButton: HTMLButtonElement;
  private readonly mediaQuery: MediaQueryList;
  private readonly disposers: Array<() => void> = [];
  private activeJoystickPointerId: number | null = null;
  private joystickCenterX = 0;
  private joystickCenterY = 0;
  private joystickSector: number | null = null;
  private wisdomAvailable = true;

  constructor(private readonly options: MobileControlsOptions) {
    this.mediaQuery = window.matchMedia(MOBILE_CONTROLS_QUERY);

    this.root = document.createElement('div');
    this.root.className = 'mobile-controls';
    this.root.setAttribute('aria-hidden', 'true');

    this.joystickRegion = document.createElement('div');
    this.joystickRegion.className = 'mobile-controls__joystick-region';
    this.joystickRegion.setAttribute('aria-label', 'Movement joystick');

    this.joystickVisual = document.createElement('div');
    this.joystickVisual.className = 'mobile-controls__joystick';
    this.joystickVisual.setAttribute('aria-hidden', 'true');

    this.joystickKnob = document.createElement('div');
    this.joystickKnob.className = 'mobile-controls__joystick-knob';
    this.joystickVisual.appendChild(this.joystickKnob);
    this.joystickRegion.appendChild(this.joystickVisual);

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

    const actions = document.createElement('div');
    actions.className = 'mobile-controls__actions';
    actions.appendChild(this.interactButton);
    actions.appendChild(this.wisdomButton);

    this.root.appendChild(this.joystickRegion);
    this.root.appendChild(actions);
    this.options.parent.appendChild(this.root);

    this.addDisposable(this.joystickRegion, 'pointerdown', this.handleJoystickPointerDown);
    this.addDisposable(this.joystickRegion, 'lostpointercapture', this.handleLostPointerCapture);
    this.addDisposable(this.joystickRegion, 'contextmenu', this.preventDefault);
    this.addDisposable(this.joystickRegion, 'selectstart', this.preventDefault);
    this.addDisposable(window, 'pointermove', this.handleJoystickPointerMove);
    this.addDisposable(window, 'pointerup', this.handlePointerRelease);
    this.addDisposable(window, 'pointercancel', this.handlePointerRelease);
    this.addDisposable(window, 'resize', this.handleViewportChange);
    this.addDisposable(window, 'orientationchange', this.handleViewportChange);
    this.addDisposable(window, 'blur', this.handleBlur);
    this.addDisposable(document, 'visibilitychange', this.handleVisibilityChange);
    this.addMediaQueryListener();
    this.addParentResizeObserver();
    this.updateVisibility();
  }

  /** Hide the wisdom action entirely for roles that do not own an orb. */
  setWisdomAvailable(available: boolean): void {
    this.wisdomAvailable = available;
    this.wisdomButton.hidden = !available;
    this.wisdomButton.disabled = !available;
    if (!available) {
      this.wisdomPointers.clear();
      this.syncActionButtonState(this.wisdomButton, this.wisdomPointers);
    }
  }

  destroy(): void {
    this.releaseAllInputs();
    for (const dispose of this.disposers.splice(0)) {
      dispose();
    }
    this.root.remove();
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

    this.addDisposable(button, 'contextmenu', this.preventDefault);
    return button;
  }

  private addMediaQueryListener(): void {
    const listener = this.updateVisibility;
    this.mediaQuery.addEventListener('change', listener);
    this.disposers.push(() => this.mediaQuery.removeEventListener('change', listener));
  }

  private addParentResizeObserver(): void {
    if (typeof ResizeObserver === 'undefined') return;

    let previousWidth = this.options.parent.clientWidth;
    let previousHeight = this.options.parent.clientHeight;
    const observer = new ResizeObserver(() => {
      const width = this.options.parent.clientWidth;
      const height = this.options.parent.clientHeight;
      if (width === previousWidth && height === previousHeight) return;
      previousWidth = width;
      previousHeight = height;
      this.releaseJoystick();
    });
    observer.observe(this.options.parent);
    this.disposers.push(() => observer.disconnect());
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

  private handleJoystickPointerDown = (event: PointerEvent): void => {
    if (this.activeJoystickPointerId !== null) {
      // Only the pointer that opened the floating stick is allowed to steer it.
      event.preventDefault();
      return;
    }

    event.preventDefault();
    this.activeJoystickPointerId = event.pointerId;
    this.joystickCenterX = event.clientX;
    this.joystickCenterY = event.clientY;
    this.joystickSector = null;

    const regionRect = this.joystickRegion.getBoundingClientRect();
    this.joystickVisual.style.left = `${event.clientX - regionRect.left}px`;
    this.joystickVisual.style.top = `${event.clientY - regionRect.top}px`;
    this.joystickKnob.style.transform = 'translate3d(0, 0, 0)';
    this.joystickVisual.classList.add('is-active');

    try {
      this.joystickRegion.setPointerCapture(event.pointerId);
    } catch {
      // Window-level pointer listeners still provide a safe fallback for mouse testing.
    }
  };

  private handleJoystickPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.activeJoystickPointerId) return;
    event.preventDefault();

    const offsetX = event.clientX - this.joystickCenterX;
    const offsetY = event.clientY - this.joystickCenterY;
    const distance = Math.hypot(offsetX, offsetY);
    const maxRadius = this.getJoystickMaxRadius();
    const visualScale = distance > maxRadius ? maxRadius / distance : 1;
    const knobX = offsetX * visualScale;
    const knobY = offsetY * visualScale;
    this.joystickKnob.style.transform = `translate3d(${knobX}px, ${knobY}px, 0)`;

    if (distance <= this.getJoystickDeadZone()) {
      this.joystickSector = null;
      this.setJoystickDirections([]);
      return;
    }

    const angle = normalizeAngle(Math.atan2(offsetY, offsetX));
    const nextSector = this.getSectorWithHysteresis(angle);
    if (nextSector === this.joystickSector) return;

    this.joystickSector = nextSector;
    this.setJoystickDirections(SECTOR_DIRECTIONS[nextSector]);
  };

  private handlePointerRelease = (event: PointerEvent): void => {
    if (event.pointerId === this.activeJoystickPointerId) {
      this.releaseJoystick();
    }
    this.releaseActionPointer(this.interactPointers, this.interactButton, event.pointerId);
    this.releaseActionPointer(this.wisdomPointers, this.wisdomButton, event.pointerId);
  };

  private handleLostPointerCapture = (event: PointerEvent): void => {
    if (event.pointerId === this.activeJoystickPointerId) {
      this.releaseJoystick(false);
    }
  };

  private handleViewportChange = (): void => {
    this.releaseJoystick();
    this.updateVisibility();
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

  private getSectorWithHysteresis(angle: number): number {
    const nearestSector = Math.round(angle / SECTOR_ANGLE_RADIANS) % SECTOR_DIRECTIONS.length;
    if (this.joystickSector === null || nearestSector === this.joystickSector) {
      return nearestSector;
    }

    const currentCenter = this.joystickSector * SECTOR_ANGLE_RADIANS;
    const hysteresisRadians = (this.getJoystickHysteresisDegrees() * Math.PI) / 180;
    const exitThreshold = HALF_SECTOR_ANGLE_RADIANS + hysteresisRadians;
    return angularDistance(angle, currentCenter) > exitThreshold
      ? nearestSector
      : this.joystickSector;
  }

  private getJoystickMaxRadius(): number {
    const configuredRadius = this.options.joystick?.maxRadius;
    if (configuredRadius !== undefined) {
      return Math.max(1, configuredRadius);
    }

    // Deriving the travel from rendered sizes keeps the knob inside a responsive base.
    const baseRadius = this.joystickVisual.offsetWidth / 2;
    const knobRadius = this.joystickKnob.offsetWidth / 2;
    return Math.max(1, baseRadius - knobRadius);
  }

  private getJoystickDeadZone(): number {
    return Math.max(0, this.options.joystick?.deadZone ?? DEFAULT_DEAD_ZONE);
  }

  private getJoystickHysteresisDegrees(): number {
    const configured = this.options.joystick?.hysteresisDegrees ?? DEFAULT_HYSTERESIS_DEGREES;
    return Math.min(22.4, Math.max(0, configured));
  }

  private setJoystickDirections(nextDirections: readonly MobileControlDirection[]): void {
    for (const direction of MOVE_DIRECTIONS) {
      const pressed = nextDirections.includes(direction);
      if (this.joystickDirections[direction] === pressed) continue;
      this.joystickDirections[direction] = pressed;
      this.options.onDirectionChange(direction, pressed);
    }
  }

  private releaseJoystick(releaseCapture = true): void {
    const pointerId = this.activeJoystickPointerId;
    this.activeJoystickPointerId = null;
    this.joystickSector = null;
    this.setJoystickDirections([]);
    this.joystickVisual.classList.remove('is-active');

    if (
      releaseCapture &&
      pointerId !== null &&
      this.joystickRegion.hasPointerCapture(pointerId)
    ) {
      this.joystickRegion.releasePointerCapture(pointerId);
    }
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
    this.releaseJoystick();
    this.interactPointers.clear();
    this.wisdomPointers.clear();
    this.syncActionButtonState(this.interactButton, this.interactPointers);
    this.syncActionButtonState(this.wisdomButton, this.wisdomPointers);
  }

  private syncActionButtonState(button: HTMLButtonElement, pointers: Set<number>): void {
    button.classList.toggle('is-pressed', pointers.size > 0);
  }

  private preventDefault = (event: Event): void => {
    event.preventDefault();
  };
}
