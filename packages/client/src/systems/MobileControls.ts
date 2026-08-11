import { MINIMAP_HUD_EXCLUSION } from './Minimap';
import { WISDOM_ORB_HUD_EXCLUSION } from './WisdomOrbHud';
import type { IntroDialogueExclusion } from './IntroDialogueHud';

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

interface ControlRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const MOBILE_CONTROLS_QUERY = '(hover: none) and (pointer: coarse)';
const MOVE_DIRECTIONS: readonly MobileControlDirection[] = ['up', 'down', 'left', 'right'];
const DEFAULT_DEAD_ZONE = 14;
const DEFAULT_HYSTERESIS_DEGREES = 7.5;
const JOYSTICK_EXCLUSION_PADDING = 6;
const MIN_ACTION_FRAME_GUTTER = 12;
const MAX_ACTION_FRAME_GUTTER = 16;
const MIN_SIDE_ACTION_SIZE = 40;
const MAX_SIDE_ACTION_SIZE = 56;
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
  private readonly joystickZones: HTMLDivElement[] = [];
  private readonly actions: HTMLDivElement;
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
  private activeJoystickCaptureTarget: HTMLElement | null = null;
  private wisdomAvailable = true;
  private dialogueExclusion: IntroDialogueExclusion | null = null;
  private expandedMinimapVisible = false;
  private inputEnabled = true;

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

    this.actions = document.createElement('div');
    this.actions.className = 'mobile-controls__actions';
    this.actions.appendChild(this.interactButton);
    this.actions.appendChild(this.wisdomButton);

    this.root.appendChild(this.joystickRegion);
    this.root.appendChild(this.actions);
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
    this.addLayoutResizeObserver();
    this.updateVisibility();
  }

  /** Hide the wisdom action entirely for roles that do not own an orb. */
  setWisdomAvailable(available: boolean): void {
    if (this.wisdomAvailable !== available) {
      this.releaseJoystick();
    }
    this.wisdomAvailable = available;
    this.wisdomButton.hidden = !available;
    this.wisdomButton.disabled = !available || !this.inputEnabled;
    if (!available) {
      this.wisdomPointers.clear();
      this.syncActionButtonState(this.wisdomButton, this.wisdomPointers);
    }
    this.updateJoystickZones();
  }

  /** Reserve the live dialogue panel for its PixiJS advance button. */
  setDialogueExclusion(bounds: IntroDialogueExclusion | null): void {
    this.releaseJoystick();
    this.dialogueExclusion = bounds;
    this.updateJoystickZones();
  }

  /** Keep the modal warden map and its click-to-close backdrop interactive. */
  setExpandedMinimapVisible(visible: boolean): void {
    this.releaseJoystick();
    this.expandedMinimapVisible = visible;
    this.updateJoystickZones();
  }

  /** Release and suppress every touch control while another modal input owns focus. */
  setInputEnabled(enabled: boolean): void {
    if (this.inputEnabled === enabled) return;
    this.inputEnabled = enabled;
    this.releaseAllInputs();
    this.root.classList.toggle('mobile-controls--input-disabled', !enabled);
    this.interactButton.disabled = !enabled;
    this.wisdomButton.disabled = !enabled || !this.wisdomAvailable;
    this.updateVisibility();
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
      if (!this.inputEnabled) return;
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

  private addLayoutResizeObserver(): void {
    if (typeof ResizeObserver === 'undefined') return;

    const canvas = this.options.parent.querySelector('canvas');
    let previousWidth = this.options.parent.clientWidth;
    let previousHeight = this.options.parent.clientHeight;
    let previousCanvasWidth = canvas?.clientWidth ?? 0;
    let previousCanvasHeight = canvas?.clientHeight ?? 0;
    const observer = new ResizeObserver(() => {
      const width = this.options.parent.clientWidth;
      const height = this.options.parent.clientHeight;
      const canvasWidth = canvas?.clientWidth ?? 0;
      const canvasHeight = canvas?.clientHeight ?? 0;
      if (
        width === previousWidth &&
        height === previousHeight &&
        canvasWidth === previousCanvasWidth &&
        canvasHeight === previousCanvasHeight
      ) {
        return;
      }
      previousWidth = width;
      previousHeight = height;
      previousCanvasWidth = canvasWidth;
      previousCanvasHeight = canvasHeight;
      this.releaseJoystick();
      this.updateControlLayout();
    });
    observer.observe(this.options.parent);
    if (canvas) observer.observe(canvas);
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
    this.root.setAttribute('aria-hidden', visible && this.inputEnabled ? 'false' : 'true');
    this.updateControlLayout();
    if (!visible) {
      this.releaseAllInputs();
    }
  };

  private updateControlLayout(): void {
    const canvas = this.options.parent.querySelector('canvas');
    if (!canvas) {
      this.root.style.removeProperty('--mobile-canvas-bottom');
      this.root.style.removeProperty('--mobile-canvas-top');
      this.root.style.removeProperty('--mobile-canvas-right');
      this.root.style.removeProperty('--mobile-side-action-size');
      this.actions.classList.remove('mobile-controls__actions--side');
      this.updateJoystickZones();
      return;
    }

    const parentRect = this.options.parent.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    const canvasBottom = Math.min(
      parentRect.height,
      Math.max(0, canvasRect.bottom - parentRect.top),
    );
    const bottomFrameHeight = Math.max(0, parentRect.bottom - canvasRect.bottom);
    this.root.style.setProperty('--mobile-canvas-bottom', `${canvasBottom}px`);
    this.root.style.setProperty(
      '--mobile-canvas-top',
      `${Math.max(0, canvasRect.top - parentRect.top)}px`,
    );
    this.root.style.setProperty(
      '--mobile-canvas-right',
      `${Math.min(parentRect.width, canvasRect.right - parentRect.left)}px`,
    );
    this.updateActionLayout(parentRect, canvasRect, bottomFrameHeight);
    this.updateJoystickZones(parentRect, canvasRect, canvas);
  }

  private updateActionLayout(
    parentRect: DOMRect,
    canvasRect: DOMRect,
    bottomFrameHeight: number,
  ): void {
    // Measure the normal horizontal layout first so the breakpoint follows the
    // actual responsive button height rather than an orientation guess.
    this.actions.classList.remove('mobile-controls__actions--side');
    const normalActionHeight = this.actions.getBoundingClientRect().height;
    const frameGutter = Math.min(
      MAX_ACTION_FRAME_GUTTER,
      Math.max(MIN_ACTION_FRAME_GUTTER, parentRect.width * 0.025),
    );
    const hasBottomRoom =
      bottomFrameHeight >= normalActionHeight + frameGutter + MIN_ACTION_FRAME_GUTTER;

    if (hasBottomRoom) {
      this.root.style.removeProperty('--mobile-side-action-size');
      return;
    }

    const rightPillarWidth = Math.max(0, parentRect.right - canvasRect.right);
    const sideActionSize = Math.min(
      MAX_SIDE_ACTION_SIZE,
      Math.max(MIN_SIDE_ACTION_SIZE, rightPillarWidth - frameGutter * 2),
    );
    this.root.style.setProperty('--mobile-side-action-size', `${sideActionSize}px`);
    this.actions.classList.add('mobile-controls__actions--side');
  }

  private updateJoystickZones(
    parentRect = this.options.parent.getBoundingClientRect(),
    canvasRect: DOMRect | null = null,
    canvas: HTMLCanvasElement | null = null,
  ): void {
    for (const zone of this.joystickZones.splice(0)) {
      zone.remove();
    }

    if (!this.inputEnabled) return;

    if (parentRect.width <= 0 || parentRect.height <= 0) return;

    const resolvedCanvas = canvas ?? this.options.parent.querySelector('canvas');
    const resolvedCanvasRect = canvasRect ?? resolvedCanvas?.getBoundingClientRect() ?? null;

    const exclusions: ControlRect[] = [];
    const addExclusion = (rect: ControlRect): void => {
      const clamped = {
        left: Math.max(0, rect.left - JOYSTICK_EXCLUSION_PADDING),
        top: Math.max(0, rect.top - JOYSTICK_EXCLUSION_PADDING),
        right: Math.min(parentRect.width, rect.right + JOYSTICK_EXCLUSION_PADDING),
        bottom: Math.min(parentRect.height, rect.bottom + JOYSTICK_EXCLUSION_PADDING),
      };
      if (clamped.right > clamped.left && clamped.bottom > clamped.top) {
        exclusions.push(clamped);
      }
    };

    const actionsRect = this.actions.getBoundingClientRect();
    if (actionsRect.width > 0 && actionsRect.height > 0) {
      addExclusion({
        left: actionsRect.left - parentRect.left,
        top: actionsRect.top - parentRect.top,
        right: actionsRect.right - parentRect.left,
        bottom: actionsRect.bottom - parentRect.top,
      });
    }

    if (
      resolvedCanvas &&
      resolvedCanvasRect &&
      resolvedCanvas.width > 0 &&
      resolvedCanvas.height > 0
    ) {
      const scaleX = resolvedCanvasRect.width / resolvedCanvas.width;
      const scaleY = resolvedCanvasRect.height / resolvedCanvas.height;
      const canvasLeft = resolvedCanvasRect.left - parentRect.left;
      const canvasTop = resolvedCanvasRect.top - parentRect.top;

      if (this.expandedMinimapVisible) {
        addExclusion({
          left: canvasLeft,
          top: canvasTop,
          right: canvasLeft + resolvedCanvasRect.width,
          bottom: canvasTop + resolvedCanvasRect.height,
        });
      }

      if (this.wisdomAvailable) {
        addExclusion({
          left: canvasLeft + WISDOM_ORB_HUD_EXCLUSION.left * scaleX,
          top: canvasTop + WISDOM_ORB_HUD_EXCLUSION.top * scaleY,
          right:
            canvasLeft +
            (WISDOM_ORB_HUD_EXCLUSION.left + WISDOM_ORB_HUD_EXCLUSION.width) * scaleX,
          bottom:
            canvasTop +
            (WISDOM_ORB_HUD_EXCLUSION.top + WISDOM_ORB_HUD_EXCLUSION.height) * scaleY,
        });
      }

      if (this.dialogueExclusion) {
        addExclusion({
          left: canvasLeft + this.dialogueExclusion.left * scaleX,
          top: canvasTop + this.dialogueExclusion.top * scaleY,
          right:
            canvasLeft +
            (this.dialogueExclusion.left + this.dialogueExclusion.width) * scaleX,
          bottom:
            canvasTop +
            (this.dialogueExclusion.top + this.dialogueExclusion.height) * scaleY,
        });
      }

      const minimapRight =
        canvasLeft + (resolvedCanvas.width - MINIMAP_HUD_EXCLUSION.edgeInset) * scaleX;
      const minimapBottom =
        canvasTop + (resolvedCanvas.height - MINIMAP_HUD_EXCLUSION.edgeInset) * scaleY;
      addExclusion({
        left: minimapRight - MINIMAP_HUD_EXCLUSION.size * scaleX,
        top: minimapBottom - MINIMAP_HUD_EXCLUSION.size * scaleY,
        right: minimapRight,
        bottom: minimapBottom,
      });
    }

    const xBoundaries = new Set<number>([0, parentRect.width]);
    const yBoundaries = new Set<number>([0, parentRect.height]);
    for (const exclusion of exclusions) {
      xBoundaries.add(exclusion.left);
      xBoundaries.add(exclusion.right);
      yBoundaries.add(exclusion.top);
      yBoundaries.add(exclusion.bottom);
    }

    const xs = [...xBoundaries].sort((first, second) => first - second);
    const ys = [...yBoundaries].sort((first, second) => first - second);
    for (let xIndex = 0; xIndex < xs.length - 1; xIndex++) {
      for (let yIndex = 0; yIndex < ys.length - 1; yIndex++) {
        const left = xs[xIndex];
        const right = xs[xIndex + 1];
        const top = ys[yIndex];
        const bottom = ys[yIndex + 1];
        const centerX = (left + right) / 2;
        const centerY = (top + bottom) / 2;
        const excluded = exclusions.some(
          (rect) =>
            centerX >= rect.left &&
            centerX <= rect.right &&
            centerY >= rect.top &&
            centerY <= rect.bottom,
        );
        if (excluded || right <= left || bottom <= top) continue;

        const zone = document.createElement('div');
        zone.className = 'mobile-controls__joystick-zone';
        zone.style.left = `${left}px`;
        zone.style.top = `${top}px`;
        zone.style.width = `${right - left}px`;
        zone.style.height = `${bottom - top}px`;
        this.joystickRegion.insertBefore(zone, this.joystickVisual);
        this.joystickZones.push(zone);
      }
    }
  }

  private handleJoystickPointerDown = (event: PointerEvent): void => {
    if (!this.inputEnabled) return;
    if (this.activeJoystickPointerId !== null) {
      // Only the pointer that opened the floating stick is allowed to steer it.
      event.preventDefault();
      return;
    }

    event.preventDefault();
    const captureTarget =
      event.target instanceof HTMLElement &&
      event.target.classList.contains('mobile-controls__joystick-zone')
        ? event.target
        : null;
    if (!captureTarget) return;

    this.activeJoystickPointerId = event.pointerId;
    this.activeJoystickCaptureTarget = captureTarget;
    this.joystickCenterX = event.clientX;
    this.joystickCenterY = event.clientY;
    this.joystickSector = null;

    const regionRect = this.joystickRegion.getBoundingClientRect();
    this.joystickVisual.style.left = `${event.clientX - regionRect.left}px`;
    this.joystickVisual.style.top = `${event.clientY - regionRect.top}px`;
    this.joystickKnob.style.transform = 'translate3d(0, 0, 0)';
    this.joystickVisual.classList.add('is-active');

    try {
      captureTarget.setPointerCapture(event.pointerId);
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
    const captureTarget = this.activeJoystickCaptureTarget;
    this.activeJoystickPointerId = null;
    this.activeJoystickCaptureTarget = null;
    this.joystickSector = null;
    this.setJoystickDirections([]);
    this.joystickVisual.classList.remove('is-active');

    if (
      releaseCapture &&
      pointerId !== null &&
      captureTarget?.hasPointerCapture(pointerId)
    ) {
      captureTarget.releasePointerCapture(pointerId);
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
