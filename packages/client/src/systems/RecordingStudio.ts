import {
  findTrapCellInteractionTarget,
  isPlayerInTrapCell,
  type CageState,
  type FacingDirection,
  type PlayerRole,
  type TrapCellPlacement,
} from '@labyrinth/shared';

export interface RecordingMoveInput {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

export interface RecordingActorFrame {
  time: number;
  x: number;
  y: number;
  facing: FacingDirection;
  isMoving: boolean;
}

export interface RecordingChatCue {
  id: string;
  time: number;
  duration: number;
  text: string;
}

export interface RecordingInteractionCue {
  id: string;
  time: number;
  type: 'activate-trap';
}

export interface RecordingActor {
  id: string;
  name: string;
  spriteIndex: number;
  teamId: number;
  role: PlayerRole;
  startX: number;
  startY: number;
  startFacing: FacingDirection;
  frames: RecordingActorFrame[];
  messages: RecordingChatCue[];
  interactions: RecordingInteractionCue[];
}

export interface RecordingActorRenderState {
  actorId: string;
  spriteId: string;
  name: string;
  spriteIndex: number;
  teamId: number;
  role: PlayerRole;
  x: number;
  y: number;
  facing: FacingDirection;
  isMoving: boolean;
  chatText: string | null;
}

export interface RecordingCameraState {
  x: number;
  y: number;
}

export interface RecordingCameraAttachment extends RecordingCameraState {
  actorId: string;
  spriteId: string;
  name: string;
  role: PlayerRole;
}

export interface RecordingTrapCapture {
  cageId: number;
  actorId: string;
  wardenActorId: string;
  interactionId: string;
  trapCellIndex: number;
  time: number;
  x: number;
  y: number;
}

export interface RecordingStudioOptions {
  characterNames: readonly string[];
  teamNames: readonly string[];
  storageKey: string;
  trapCells: readonly TrapCellPlacement[];
  tileSize: number;
  getLocalPosition: () => { x: number; y: number; facing: FacingDirection };
  moveActor: (
    actorId: string,
    pose: { x: number; y: number; facing: FacingDirection },
    input: RecordingMoveInput,
    dt: number,
  ) => { x: number; y: number; facing: FacingDirection };
  getZoom: () => number;
  setZoom: (zoom: number) => void;
  onInputCaptureChange: () => void;
  onCleanModeChange: (clean: boolean) => void;
}

type StudioMode = 'idle' | 'playing' | 'recording';

export interface RecordingProjectFile {
  version: 1 | 2;
  actors: RecordingActor[];
}

const ACTOR_SPRITE_PREFIX = 'recording-actor:';
const SAMPLE_INTERVAL = 1 / 30;
const MAX_RECORDING_SECONDS = 10 * 60;
const DEFAULT_CHAT_DURATION = 2.4;
const DEFAULT_CAMERA_SPEED = 120;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 2;

const EMPTY_INPUT: RecordingMoveInput = {
  up: false,
  down: false,
  left: false,
  right: false,
};

function createId(prefix: string): string {
  const suffix =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${suffix}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isFacing(value: unknown): value is FacingDirection {
  return (
    value === 'up' ||
    value === 'down' ||
    value === 'left' ||
    value === 'right' ||
    value === 'up-left' ||
    value === 'up-right' ||
    value === 'down-left' ||
    value === 'down-right'
  );
}

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

function formatTime(seconds: number): string {
  const safeSeconds = Math.max(0, seconds);
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds - minutes * 60;
  return `${minutes}:${remainder.toFixed(1).padStart(4, '0')}`;
}

export function getRecordingActorDuration(actor: RecordingActor): number {
  const frameDuration = getRecordingActorMovementDuration(actor);
  const chatDuration = actor.messages.reduce(
    (latest, cue) => Math.max(latest, cue.time + cue.duration),
    0,
  );
  const interactionDuration = (actor.interactions ?? []).reduce(
    (latest, cue) => Math.max(latest, cue.time),
    0,
  );
  return Math.max(frameDuration, chatDuration, interactionDuration);
}

export function getRecordingActorMovementDuration(actor: RecordingActor): number {
  return actor.frames.at(-1)?.time ?? 0;
}

export function sampleRecordingActor(
  actor: RecordingActor,
  time: number,
): RecordingActorFrame {
  const frames = actor.frames;
  if (frames.length === 0 || time <= 0) {
    const first = frames[0];
    return first
      ? { ...first, time: Math.max(0, time), isMoving: false }
      : {
          time: Math.max(0, time),
          x: actor.startX,
          y: actor.startY,
          facing: actor.startFacing,
          isMoving: false,
        };
  }

  const last = frames[frames.length - 1];
  if (time >= last.time) return { ...last, time, isMoving: false };

  let low = 0;
  let high = frames.length - 1;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (frames[middle].time <= time) low = middle;
    else high = middle;
  }

  const before = frames[low];
  const after = frames[high];
  const span = Math.max(0.000_001, after.time - before.time);
  const progress = clamp((time - before.time) / span, 0, 1);
  return {
    time,
    x: before.x + (after.x - before.x) * progress,
    y: before.y + (after.y - before.y) * progress,
    facing: progress < 0.5 ? before.facing : after.facing,
    isMoving: before.isMoving || after.isMoving,
  };
}

/** Replay all recorded Warden trap activations up to one timeline position. */
export function deriveRecordingTrapCaptures(
  actors: readonly RecordingActor[],
  time: number,
  trapCells: readonly TrapCellPlacement[],
  tileSize: number,
): RecordingTrapCapture[] {
  const activations = actors
    .filter((actor) => actor.role === 'warden')
    .flatMap((actor) =>
      (actor.interactions ?? []).map((interaction) => ({ actor, interaction })),
    )
    .filter(
      ({ interaction }) =>
        interaction.type === 'activate-trap' && interaction.time <= time,
    )
    .sort(
      (a, b) =>
        a.interaction.time - b.interaction.time ||
        a.interaction.id.localeCompare(b.interaction.id),
    );
  const capturedActorIds = new Set<string>();
  const captures: RecordingTrapCapture[] = [];

  for (const { actor: warden, interaction } of activations) {
    const wardenPose = sampleRecordingActor(warden, interaction.time);
    const target = findTrapCellInteractionTarget(
      trapCells,
      wardenPose.x,
      wardenPose.y,
      tileSize,
    );
    if (!target) continue;

    for (const survivor of actors) {
      if (survivor.role !== 'survivor' || capturedActorIds.has(survivor.id)) continue;
      const survivorPose = sampleRecordingActor(survivor, interaction.time);
      const trapCellIndex = trapCells.findIndex((trapCell) =>
        isPlayerInTrapCell(trapCell, survivorPose.x, survivorPose.y, tileSize),
      );
      if (trapCellIndex < 0) continue;

      capturedActorIds.add(survivor.id);
      captures.push({
        cageId: -(captures.length + 1),
        actorId: survivor.id,
        wardenActorId: warden.id,
        interactionId: interaction.id,
        trapCellIndex,
        time: interaction.time,
        x: survivorPose.x,
        y: survivorPose.y,
      });
    }
  }

  return captures;
}

export function parseRecordingProject(value: unknown): RecordingActor[] | null {
  if (!value || typeof value !== 'object') return null;
  const project = value as Partial<RecordingProjectFile>;
  if (
    (project.version !== 1 && project.version !== 2) ||
    !Array.isArray(project.actors)
  ) {
    return null;
  }

  const actors: RecordingActor[] = [];
  for (const candidate of project.actors) {
    if (!candidate || typeof candidate !== 'object') continue;
    const actor = candidate as Partial<RecordingActor>;
    if (
      typeof actor.id !== 'string' ||
      typeof actor.name !== 'string' ||
      typeof actor.startX !== 'number' ||
      typeof actor.startY !== 'number'
    ) {
      continue;
    }
    const startFacing = isFacing(actor.startFacing) ? actor.startFacing : 'down';
    const frames = Array.isArray(actor.frames)
      ? actor.frames
          .filter(
            (frame): frame is RecordingActorFrame =>
              Boolean(frame) &&
              typeof frame.time === 'number' &&
              Number.isFinite(frame.time) &&
              frame.time >= 0 &&
              typeof frame.x === 'number' &&
              Number.isFinite(frame.x) &&
              typeof frame.y === 'number' &&
              Number.isFinite(frame.y) &&
              isFacing(frame.facing) &&
              typeof frame.isMoving === 'boolean',
          )
          .sort((a, b) => a.time - b.time)
      : [];
    const messages = Array.isArray(actor.messages)
      ? actor.messages
          .filter(
            (cue): cue is RecordingChatCue =>
              Boolean(cue) &&
              typeof cue.id === 'string' &&
              typeof cue.text === 'string' &&
              cue.text.trim().length > 0 &&
              typeof cue.time === 'number' &&
              Number.isFinite(cue.time) &&
              cue.time >= 0 &&
              typeof cue.duration === 'number' &&
              Number.isFinite(cue.duration) &&
              cue.duration > 0,
          )
          .map((cue) => ({
            ...cue,
            text: cue.text.trim().slice(0, 180),
            time: clamp(cue.time, 0, MAX_RECORDING_SECONDS),
            duration: clamp(cue.duration, 0.2, 30),
          }))
          .sort((a, b) => a.time - b.time)
      : [];
    const interactions = Array.isArray(actor.interactions)
      ? actor.interactions
          .filter(
            (cue): cue is RecordingInteractionCue =>
              Boolean(cue) &&
              typeof cue.id === 'string' &&
              cue.type === 'activate-trap' &&
              typeof cue.time === 'number' &&
              Number.isFinite(cue.time) &&
              cue.time >= 0,
          )
          .map((cue) => ({
            ...cue,
            time: clamp(cue.time, 0, MAX_RECORDING_SECONDS),
          }))
          .sort((a, b) => a.time - b.time)
      : [];
    actors.push({
      id: actor.id,
      name: actor.name.trim().slice(0, 24) || 'Actor',
      spriteIndex:
        typeof actor.spriteIndex === 'number' && Number.isInteger(actor.spriteIndex)
          ? Math.max(0, actor.spriteIndex)
          : 0,
      teamId:
        typeof actor.teamId === 'number' && Number.isInteger(actor.teamId)
          ? Math.max(0, actor.teamId)
          : 0,
      role: actor.role === 'warden' ? 'warden' : 'survivor',
      startX: actor.startX,
      startY: actor.startY,
      startFacing,
      frames,
      messages,
      interactions,
    });
  }
  return actors;
}

export class RecordingStudio {
  private readonly root: HTMLDivElement;
  private readonly panel: HTMLElement;
  private readonly actorList: HTMLDivElement;
  private readonly actorEditor: HTMLDivElement;
  private readonly emptyEditor: HTMLDivElement;
  private readonly timelineInput: HTMLInputElement;
  private readonly timelineReadout: HTMLElement;
  private readonly status: HTMLElement;
  private readonly replayButton: HTMLButtonElement;
  private readonly stopButton: HTMLButtonElement;
  private readonly cameraButton: HTMLButtonElement;
  private readonly cleanButton: HTMLButtonElement;
  private readonly restartButton: HTMLButtonElement;
  private readonly continueButton: HTMLButtonElement;
  private readonly attachCameraButton: HTMLButtonElement;
  private readonly actorNameInput: HTMLInputElement;
  private readonly actorSkinSelect: HTMLSelectElement;
  private readonly actorTeamSelect: HTMLSelectElement;
  private readonly actorRoleSelect: HTMLSelectElement;
  private readonly messageList: HTMLDivElement;
  private readonly interactionList: HTMLDivElement;
  private readonly messageTimeInput: HTMLInputElement;
  private readonly messageDurationInput: HTMLInputElement;
  private readonly messageTextInput: HTMLInputElement;
  private readonly cameraSpeedInput: HTMLInputElement;
  private readonly projectFileInput: HTMLInputElement;
  private readonly options: RecordingStudioOptions;
  private readonly movementKeys = { ...EMPTY_INPUT };
  private readonly pressedCodes = new Set<string>();
  private actors: RecordingActor[];
  private poses = new Map<string, RecordingActorFrame>();
  private selectedActorId: string | null = null;
  private mode: StudioMode = 'idle';
  private cameraActive = false;
  private cameraActorId: string | null = null;
  private panelOpen = false;
  private cleanMode = false;
  private currentTime = 0;
  private recordSampleAccumulator = 0;
  private cameraX = 0;
  private cameraY = 0;
  private cameraVelocityX = 0;
  private cameraVelocityY = 0;
  private lastTransportRefresh = -Infinity;

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    const editable = isEditableTarget(event.target);
    if (event.code === 'KeyR' && !editable && !event.repeat) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (this.cleanMode) this.setCleanMode(false);
      this.setPanelOpen(!this.panelOpen);
      return;
    }
    if (event.code === 'KeyH' && !editable && !event.repeat) {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.setCleanMode(!this.cleanMode);
      return;
    }
    if (editable) {
      // Studio text fields must own their keystrokes. In particular, letting T
      // bubble into the game's global handler opens proximity chat and steals
      // focus before the character can be entered into a scheduled message.
      if (event.target instanceof Node && this.root.contains(event.target)) {
        event.stopImmediatePropagation();
      }
      return;
    }

    if (event.code === 'Escape' && this.panelOpen && !event.repeat) {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.setPanelOpen(false);
      return;
    }
    if (
      event.code === 'Space' &&
      (this.mode !== 'idle' || this.cameraActive || this.cameraActorId !== null)
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.repeat) {
        if (this.mode !== 'idle') this.stop();
        else if (this.cameraActorId) this.detachActorCamera();
        else this.toggleCamera();
      }
      return;
    }

    if (this.mode === 'recording' && event.code === 'KeyE') {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.repeat) this.recordTrapInteraction();
      return;
    }

    if (
      this.cameraActorId &&
      this.mode !== 'recording' &&
      (event.code === 'KeyE' || event.code === 'KeyQ')
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }

    if (this.mode !== 'recording' && !this.cameraActive) {
      if (this.cameraActorId && this.directionForCode(event.code)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      return;
    }
    const direction = this.directionForCode(event.code);
    if (direction) {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.pressedCodes.add(event.code);
      this.movementKeys[direction] = true;
      return;
    }
    if (this.cameraActive && (event.code === 'KeyQ' || event.code === 'KeyE')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.pressedCodes.add(event.code);
    }
  };

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    if (
      isEditableTarget(event.target) &&
      event.target instanceof Node &&
      this.root.contains(event.target)
    ) {
      event.stopImmediatePropagation();
      return;
    }
    const direction = this.directionForCode(event.code);
    if (direction && this.pressedCodes.delete(event.code)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.movementKeys[direction] = this.hasPressedDirection(direction);
    }
    if (event.code === 'KeyQ' || event.code === 'KeyE') {
      this.pressedCodes.delete(event.code);
    }
  };

  private readonly handleWindowBlur = (): void => {
    this.clearMovementKeys();
  };

  constructor(options: RecordingStudioOptions) {
    this.options = options;
    this.actors = this.load();
    this.root = document.createElement('div');
    this.root.id = 'recording-studio';
    this.root.className = 'recording-studio';
    this.root.innerHTML = `
      <section class="recording-studio__panel" role="dialog" aria-modal="false" aria-labelledby="recording-studio-title" hidden>
        <header class="recording-studio__header">
          <div>
            <span class="recording-studio__eyebrow">Admin tools · R</span>
            <h2 id="recording-studio-title">Recording studio</h2>
          </div>
          <button type="button" data-studio-action="close" aria-label="Close recording studio">×</button>
        </header>
        <div class="recording-studio__transport">
          <button type="button" data-studio-action="replay">▶ Replay all</button>
          <button type="button" data-studio-action="stop" disabled>■ Stop</button>
          <button type="button" data-studio-action="camera">Camera</button>
          <button type="button" data-studio-action="clean">Hide UI</button>
        </div>
        <div class="recording-studio__timeline">
          <input data-studio-field="timeline" type="range" min="0" max="0" step="0.01" value="0" aria-label="Recording timeline">
          <output data-studio-output="time">0:00.0 / 0:00.0</output>
        </div>
        <p class="recording-studio__status" data-studio-output="status">Spawn an actor at your current position, then record a take.</p>
        <div class="recording-studio__project-actions">
          <button type="button" data-studio-action="export-project">Save recording file</button>
          <button type="button" data-studio-action="import-project">Load recording file</button>
          <input data-studio-field="project-file" class="recording-studio__file-input" type="file" accept=".json,application/json" aria-label="Load recording project">
        </div>
        <section class="recording-studio__section">
          <h3>Actors</h3>
          <form class="recording-studio__spawn" data-studio-form="spawn">
            <input name="name" maxlength="24" value="Explorer ${this.actors.length + 1}" aria-label="Fake player name" required>
            <select name="skin" aria-label="Character skin">
              ${options.characterNames.map((name, index) => `<option value="${index}">${name}</option>`).join('')}
            </select>
            <select name="team" aria-label="Squad">
              ${options.teamNames.map((name, index) => `<option value="${index}">${name}</option>`).join('')}
            </select>
            <select name="role" aria-label="Role">
              <option value="survivor">Survivor</option>
              <option value="warden">Warden</option>
            </select>
            <button type="submit">+ Spawn</button>
          </form>
          <div class="recording-studio__actors" data-studio-list="actors"></div>
        </section>
        <section class="recording-studio__section recording-studio__editor" data-studio-editor hidden>
          <div class="recording-studio__editor-grid">
            <label>Name<input data-studio-field="actor-name" maxlength="24"></label>
            <label>Skin<select data-studio-field="actor-skin">${options.characterNames.map((name, index) => `<option value="${index}">${name}</option>`).join('')}</select></label>
            <label>Squad<select data-studio-field="actor-team">${options.teamNames.map((name, index) => `<option value="${index}">${name}</option>`).join('')}</select></label>
            <label>Role<select data-studio-field="actor-role"><option value="survivor">Survivor</option><option value="warden">Warden</option></select></label>
          </div>
          <div class="recording-studio__actor-actions">
            <button type="button" data-studio-action="restart-recording">● Start take</button>
            <button type="button" data-studio-action="continue-recording" disabled>▶ Continue recording</button>
            <button type="button" data-studio-action="attach-camera">Attach camera</button>
            <button type="button" data-studio-action="set-start">Set start here</button>
            <button type="button" data-studio-action="delete-actor" class="danger">Delete</button>
          </div>
          <p class="recording-studio__hint">Use WASD or arrows. Wardens record trap activations with E. Space pauses and saves the take. Continue resumes at the endpoint; discard & restart returns to the actor's start.</p>
          <div class="recording-studio__interactions">
            <h3>Recorded interactions</h3>
            <div data-studio-list="interactions" class="recording-studio__interaction-list"></div>
          </div>
          <div class="recording-studio__messages">
            <h3>Chat bubbles</h3>
            <form data-studio-form="message" class="recording-studio__message-form">
              <label>At (sec)<input data-studio-field="message-time" type="number" min="0" max="600" step="0.1" value="0"></label>
              <label>For (sec)<input data-studio-field="message-duration" type="number" min="0.2" max="30" step="0.1" value="${DEFAULT_CHAT_DURATION}"></label>
              <label class="recording-studio__message-text">Message<input data-studio-field="message-text" maxlength="180" placeholder="What should they say?" required></label>
              <button type="submit">+ Add bubble</button>
            </form>
            <div data-studio-list="messages" class="recording-studio__message-list"></div>
          </div>
        </section>
        <div class="recording-studio__empty" data-studio-empty>Select an actor to edit its take and bubbles.</div>
        <section class="recording-studio__section recording-studio__camera-settings">
          <h3>Smooth camera</h3>
          <label>Pan speed <input data-studio-field="camera-speed" type="range" min="40" max="320" step="10" value="${DEFAULT_CAMERA_SPEED}"></label>
          <p>Click Camera, then use WASD/arrows to glide. Q/E zoom. Hide UI when ready; H restores it.</p>
        </section>
      </section>
    `;
    document.body.appendChild(this.root);

    const query = <T extends Element>(selector: string): T => {
      const element = this.root.querySelector<T>(selector);
      if (!element) throw new Error(`Missing recording studio element: ${selector}`);
      return element;
    };
    this.panel = query<HTMLElement>('.recording-studio__panel');
    this.actorList = query<HTMLDivElement>('[data-studio-list="actors"]');
    this.actorEditor = query<HTMLDivElement>('[data-studio-editor]');
    this.emptyEditor = query<HTMLDivElement>('[data-studio-empty]');
    this.timelineInput = query<HTMLInputElement>('[data-studio-field="timeline"]');
    this.timelineReadout = query<HTMLElement>('[data-studio-output="time"]');
    this.status = query<HTMLElement>('[data-studio-output="status"]');
    this.replayButton = query<HTMLButtonElement>('[data-studio-action="replay"]');
    this.stopButton = query<HTMLButtonElement>('[data-studio-action="stop"]');
    this.cameraButton = query<HTMLButtonElement>('[data-studio-action="camera"]');
    this.cleanButton = query<HTMLButtonElement>('[data-studio-action="clean"]');
    this.restartButton = query<HTMLButtonElement>(
      '[data-studio-action="restart-recording"]',
    );
    this.continueButton = query<HTMLButtonElement>(
      '[data-studio-action="continue-recording"]',
    );
    this.attachCameraButton = query<HTMLButtonElement>(
      '[data-studio-action="attach-camera"]',
    );
    this.actorNameInput = query<HTMLInputElement>('[data-studio-field="actor-name"]');
    this.actorSkinSelect = query<HTMLSelectElement>('[data-studio-field="actor-skin"]');
    this.actorTeamSelect = query<HTMLSelectElement>('[data-studio-field="actor-team"]');
    this.actorRoleSelect = query<HTMLSelectElement>('[data-studio-field="actor-role"]');
    this.messageList = query<HTMLDivElement>('[data-studio-list="messages"]');
    this.interactionList = query<HTMLDivElement>('[data-studio-list="interactions"]');
    this.messageTimeInput = query<HTMLInputElement>('[data-studio-field="message-time"]');
    this.messageDurationInput = query<HTMLInputElement>(
      '[data-studio-field="message-duration"]',
    );
    this.messageTextInput = query<HTMLInputElement>('[data-studio-field="message-text"]');
    this.cameraSpeedInput = query<HTMLInputElement>('[data-studio-field="camera-speed"]');
    this.projectFileInput = query<HTMLInputElement>('[data-studio-field="project-file"]');

    this.bindDomEvents();
    window.addEventListener('keydown', this.handleKeyDown, true);
    window.addEventListener('keyup', this.handleKeyUp, true);
    window.addEventListener('blur', this.handleWindowBlur);
    this.selectedActorId = this.actors[0]?.id ?? null;
    this.applyTimelinePose(0);
    this.renderActors();
    this.renderEditor();
    this.refreshTransport(true);
  }

  get isCleanMode(): boolean {
    return this.cleanMode;
  }

  blocksLocalMovement(): boolean {
    return (
      this.panelOpen ||
      this.mode !== 'idle' ||
      this.cameraActive ||
      this.cameraActorId !== null ||
      this.cleanMode
    );
  }

  hasActorSpriteId(spriteId: string): boolean {
    return this.actors.some((actor) => this.spriteIdFor(actor.id) === spriteId);
  }

  getActorSpriteIds(): string[] {
    return this.actors.map((actor) => this.spriteIdFor(actor.id));
  }

  getTimelineTime(): number {
    return this.currentTime;
  }

  /** Sample actor movement at an arbitrary timeline position for world rebuilds. */
  getActorStatesAtTime(time: number): RecordingActorRenderState[] {
    return this.buildActorStates(Math.max(0, time), false);
  }

  /** Apply local world reactions, persisting corrections made to the active take. */
  applyActorPositionOverrides(
    overrides: readonly { actorId: string; x: number; y: number }[],
  ): void {
    for (const override of overrides) {
      const pose = this.poses.get(override.actorId);
      if (!pose) continue;
      const correctedPose = {
        ...pose,
        x: override.x,
        y: override.y,
        isMoving: false,
      };
      this.poses.set(override.actorId, correctedPose);

      if (this.mode !== 'recording' || override.actorId !== this.selectedActorId) {
        continue;
      }
      const actor = this.getSelectedActor();
      if (!actor) continue;
      const lastFrame = actor.frames.at(-1);
      if (lastFrame && Math.abs(lastFrame.time - this.currentTime) < 0.000_001) {
        actor.frames[actor.frames.length - 1] = { ...correctedPose };
      } else {
        actor.frames.push({ ...correctedPose, time: this.currentTime });
      }
    }
  }

  getCameraOverride(): RecordingCameraState | null {
    if (this.cameraActive) return { x: this.cameraX, y: this.cameraY };
    if (!this.cameraActorId) return null;
    const actor = this.getActorStates().find(
      (candidate) => candidate.actorId === this.cameraActorId,
    );
    return actor ? { x: actor.x, y: actor.y } : null;
  }

  getCameraAttachment(): RecordingCameraAttachment | null {
    if (!this.cameraActorId) return null;
    const actor = this.getActorStates().find(
      (candidate) => candidate.actorId === this.cameraActorId,
    );
    return actor
      ? {
          actorId: actor.actorId,
          spriteId: actor.spriteId,
          name: actor.name,
          role: actor.role,
          x: actor.x,
          y: actor.y,
        }
      : null;
  }

  getRecordingCageStates(): CageState[] {
    return this.getTrapCaptures().map((capture) => ({
      cageId: capture.cageId,
      prisonerPlayerId: this.spriteIdFor(capture.actorId),
      x: capture.x,
      y: capture.y,
      opened: false,
      vacated: false,
    }));
  }

  getActorStates(): RecordingActorRenderState[] {
    return this.buildActorStates(this.currentTime, true);
  }

  private buildActorStates(
    time: number,
    useLivePoses: boolean,
  ): RecordingActorRenderState[] {
    const captureByActorId = new Map(
      deriveRecordingTrapCaptures(
        this.actors,
        time,
        this.options.trapCells,
        this.options.tileSize,
      ).map((capture) => [capture.actorId, capture]),
    );
    return this.actors.map((actor) => {
      const recordedPose =
        (useLivePoses ? this.poses.get(actor.id) : null) ??
        sampleRecordingActor(actor, time);
      const capture = captureByActorId.get(actor.id);
      const pose = capture
        ? {
            ...recordedPose,
            x: capture.x,
            y: capture.y,
            isMoving: false,
          }
        : recordedPose;
      const cue = actor.messages.find(
        (candidate) =>
          time >= candidate.time && time < candidate.time + candidate.duration,
      );
      return {
        actorId: actor.id,
        spriteId: this.spriteIdFor(actor.id),
        name: actor.name,
        spriteIndex: actor.spriteIndex,
        teamId: actor.teamId,
        role: actor.role,
        x: pose.x,
        y: pose.y,
        facing: pose.facing,
        isMoving: pose.isMoving,
        chatText:
          useLivePoses && (this.mode === 'playing' || this.mode === 'recording')
            ? (cue?.text ?? null)
            : null,
      };
    });
  }

  update(dt: number): void {
    if (this.mode === 'playing') {
      const duration = this.getDuration();
      this.currentTime = Math.min(duration, this.currentTime + dt);
      this.applyTimelinePose(this.currentTime);
      if (this.currentTime >= duration) this.stop(false);
    } else if (this.mode === 'recording') {
      this.updateRecording(dt);
    }
    if (this.cameraActive) {
      this.updateCamera(dt);
    }

    const now = performance.now();
    if (now - this.lastTransportRefresh >= 80) {
      this.refreshTransport();
      this.lastTransportRefresh = now;
    }
  }

  destroy(): void {
    this.setCleanMode(false);
    window.removeEventListener('keydown', this.handleKeyDown, true);
    window.removeEventListener('keyup', this.handleKeyUp, true);
    window.removeEventListener('blur', this.handleWindowBlur);
    this.root.remove();
  }

  private bindDomEvents(): void {
    this.root.addEventListener('click', (event) => {
      if (!(event.target instanceof Element)) return;
      const actorButton = event.target.closest<HTMLButtonElement>('[data-actor-id]');
      if (actorButton) {
        this.selectedActorId = actorButton.dataset.actorId ?? null;
        this.renderActors();
        this.renderEditor();
        return;
      }
      const actionButton =
        event.target.closest<HTMLButtonElement>('[data-studio-action]');
      if (!actionButton) return;
      switch (actionButton.dataset.studioAction) {
        case 'close':
          this.setPanelOpen(false);
          break;
        case 'replay':
          this.playAll();
          break;
        case 'stop':
          this.stop();
          break;
        case 'camera':
          this.toggleCamera();
          break;
        case 'clean':
          this.setCleanMode(true);
          break;
        case 'export-project':
          this.exportProject();
          break;
        case 'import-project':
          this.projectFileInput.click();
          break;
        case 'restart-recording':
          this.startRecording();
          break;
        case 'continue-recording':
          this.continueRecording();
          break;
        case 'attach-camera':
          this.toggleActorCamera();
          break;
        case 'set-start':
          this.setSelectedStart();
          break;
        case 'delete-actor':
          this.deleteSelectedActor();
          break;
        case 'delete-message': {
          const cueId = actionButton.dataset.messageId;
          if (cueId) this.deleteMessage(cueId);
          break;
        }
        case 'delete-interaction': {
          const interactionId = actionButton.dataset.interactionId;
          if (interactionId) this.deleteInteraction(interactionId);
          break;
        }
      }
    });

    this.root
      .querySelector<HTMLFormElement>('[data-studio-form="spawn"]')
      ?.addEventListener('submit', (event) => {
        event.preventDefault();
        const form = event.currentTarget as HTMLFormElement;
        const data = new FormData(form);
        const name = String(data.get('name') ?? '').trim();
        const spriteIndex = Number.parseInt(String(data.get('skin') ?? '0'), 10);
        const teamId = Number.parseInt(String(data.get('team') ?? '0'), 10);
        const role = data.get('role') === 'warden' ? 'warden' : 'survivor';
        this.spawnActor(name, spriteIndex, teamId, role);
        const nameInput = form.elements.namedItem('name');
        if (nameInput instanceof HTMLInputElement) {
          nameInput.value = `Explorer ${this.actors.length + 1}`;
          nameInput.select();
        }
      });

    this.root
      .querySelector<HTMLFormElement>('[data-studio-form="message"]')
      ?.addEventListener('submit', (event) => {
        event.preventDefault();
        this.addMessage();
      });

    this.projectFileInput.addEventListener('change', () => {
      const file = this.projectFileInput.files?.[0];
      if (file) void this.importProject(file);
    });

    this.actorNameInput.addEventListener('input', () => {
      const actor = this.getSelectedActor();
      if (!actor) return;
      actor.name = this.actorNameInput.value.slice(0, 24);
      this.save();
      this.renderActors();
    });
    this.actorNameInput.addEventListener('change', () => {
      const actor = this.getSelectedActor();
      if (!actor) return;
      actor.name = actor.name.trim() || 'Actor';
      this.actorNameInput.value = actor.name;
      this.save();
      this.renderActors();
    });
    this.actorSkinSelect.addEventListener('change', () => {
      const actor = this.getSelectedActor();
      if (!actor) return;
      actor.spriteIndex = Number.parseInt(this.actorSkinSelect.value, 10) || 0;
      this.save();
    });
    this.actorTeamSelect.addEventListener('change', () => {
      const actor = this.getSelectedActor();
      if (!actor) return;
      actor.teamId = Number.parseInt(this.actorTeamSelect.value, 10) || 0;
      this.save();
    });
    this.actorRoleSelect.addEventListener('change', () => {
      const actor = this.getSelectedActor();
      if (!actor) return;
      actor.role = this.actorRoleSelect.value === 'warden' ? 'warden' : 'survivor';
      this.save();
      this.renderActors();
      this.renderInteractions();
      this.refreshTransport(true);
    });

    this.timelineInput.addEventListener('input', () => {
      this.stop(false);
      this.currentTime = Number.parseFloat(this.timelineInput.value) || 0;
      this.applyTimelinePose(this.currentTime);
      this.refreshTransport(true);
    });

    this.messageList.addEventListener('change', (event) => {
      if (!(event.target instanceof HTMLInputElement)) return;
      const cueId = event.target.dataset.messageId;
      const field = event.target.dataset.messageField;
      const actor = this.getSelectedActor();
      const cue = actor?.messages.find((candidate) => candidate.id === cueId);
      if (!actor || !cue || !field) return;
      if (field === 'text')
        cue.text = event.target.value.trim().slice(0, 180) || cue.text;
      if (field === 'time') {
        cue.time = clamp(
          Number.parseFloat(event.target.value) || 0,
          0,
          MAX_RECORDING_SECONDS,
        );
      }
      if (field === 'duration') {
        cue.duration = clamp(Number.parseFloat(event.target.value) || 0.2, 0.2, 30);
      }
      actor.messages.sort((a, b) => a.time - b.time);
      this.save();
      this.renderActors();
      this.renderMessages();
      this.refreshTransport(true);
    });

    this.interactionList.addEventListener('change', (event) => {
      if (!(event.target instanceof HTMLInputElement)) return;
      const interactionId = event.target.dataset.interactionId;
      const actor = this.getSelectedActor();
      const interaction = actor?.interactions.find(
        (candidate) => candidate.id === interactionId,
      );
      if (!actor || !interaction) return;
      interaction.time = clamp(
        Number.parseFloat(event.target.value) || 0,
        0,
        MAX_RECORDING_SECONDS,
      );
      actor.interactions.sort((a, b) => a.time - b.time);
      this.save();
      this.renderInteractions();
      this.refreshTransport(true);
    });
  }

  private spawnActor(
    name: string,
    spriteIndex: number,
    teamId: number,
    role: PlayerRole,
  ): void {
    const local = this.options.getLocalPosition();
    const actor: RecordingActor = {
      id: createId('actor'),
      name: name.slice(0, 24) || `Explorer ${this.actors.length + 1}`,
      spriteIndex: clamp(spriteIndex, 0, this.options.characterNames.length - 1),
      teamId: clamp(teamId, 0, this.options.teamNames.length - 1),
      role,
      startX: local.x,
      startY: local.y,
      startFacing: local.facing,
      frames: [],
      messages: [],
      interactions: [],
    };
    this.actors.push(actor);
    this.selectedActorId = actor.id;
    this.poses.set(actor.id, sampleRecordingActor(actor, 0));
    this.currentTime = 0;
    this.save();
    this.renderActors();
    this.renderEditor();
    this.refreshTransport(true);
    this.setStatus(`${actor.name} spawned at your current position.`);
  }

  private setSelectedStart(): void {
    const actor = this.getSelectedActor();
    if (!actor) return;
    this.stop(false);
    const local = this.options.getLocalPosition();
    actor.startX = local.x;
    actor.startY = local.y;
    actor.startFacing = local.facing;
    actor.frames = [];
    actor.interactions = [];
    this.currentTime = 0;
    this.poses.set(actor.id, sampleRecordingActor(actor, 0));
    this.save();
    this.renderActors();
    this.renderInteractions();
    this.refreshTransport(true);
    this.setStatus(`${actor.name}'s start moved here; its previous take was cleared.`);
  }

  private deleteSelectedActor(): void {
    const actor = this.getSelectedActor();
    if (!actor) return;
    this.stop(false);
    if (this.cameraActorId === actor.id) this.cameraActorId = null;
    this.actors = this.actors.filter((candidate) => candidate.id !== actor.id);
    this.poses.delete(actor.id);
    this.selectedActorId = this.actors[0]?.id ?? null;
    this.save();
    this.renderActors();
    this.renderEditor();
    this.refreshTransport(true);
    this.setStatus(`${actor.name} deleted.`);
  }

  private addMessage(): void {
    const actor = this.getSelectedActor();
    const text = this.messageTextInput.value.trim().slice(0, 180);
    if (!actor || !text) return;
    actor.messages.push({
      id: createId('cue'),
      time: clamp(
        Number.parseFloat(this.messageTimeInput.value) || 0,
        0,
        MAX_RECORDING_SECONDS,
      ),
      duration: clamp(
        Number.parseFloat(this.messageDurationInput.value) || DEFAULT_CHAT_DURATION,
        0.2,
        30,
      ),
      text,
    });
    actor.messages.sort((a, b) => a.time - b.time);
    this.messageTextInput.value = '';
    this.save();
    this.renderActors();
    this.renderMessages();
    this.refreshTransport(true);
  }

  private deleteMessage(cueId: string): void {
    const actor = this.getSelectedActor();
    if (!actor) return;
    actor.messages = actor.messages.filter((cue) => cue.id !== cueId);
    this.save();
    this.renderActors();
    this.renderMessages();
    this.refreshTransport(true);
  }

  private recordTrapInteraction(): void {
    const actor = this.getSelectedActor();
    if (!actor || actor.role !== 'warden') {
      this.setStatus('Only a Warden actor can record an E trap activation.');
      return;
    }
    const pose =
      this.poses.get(actor.id) ?? sampleRecordingActor(actor, this.currentTime);
    const target = findTrapCellInteractionTarget(
      this.options.trapCells,
      pose.x,
      pose.y,
      this.options.tileSize,
    );
    if (!target) {
      this.setStatus('Move the Warden next to a trap cell before pressing E.');
      return;
    }
    const lastFrame = actor.frames.at(-1);
    if (!lastFrame || lastFrame.time < this.currentTime) {
      actor.frames.push({ ...pose, time: this.currentTime });
    }
    actor.interactions.push({
      id: createId('interaction'),
      time: this.currentTime,
      type: 'activate-trap',
    });
    actor.interactions.sort((a, b) => a.time - b.time);
    this.save();
    this.renderActors();
    this.renderInteractions();
    this.refreshTransport(true);
    this.setStatus(
      `${actor.name} activated trap cell ${target.trapCellIndex + 1} at ${formatTime(this.currentTime)}.`,
    );
  }

  private deleteInteraction(interactionId: string): void {
    const actor = this.getSelectedActor();
    if (!actor) return;
    actor.interactions = actor.interactions.filter(
      (interaction) => interaction.id !== interactionId,
    );
    this.save();
    this.renderActors();
    this.renderInteractions();
    this.refreshTransport(true);
  }

  private exportProject(): void {
    const project: RecordingProjectFile = { version: 2, actors: this.actors };
    const blob = new Blob([JSON.stringify(project, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    link.href = url;
    link.download = `labyrinth-recording-${timestamp}.json`;
    link.hidden = true;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    this.setStatus(
      `Saved ${this.actors.length} actor${this.actors.length === 1 ? '' : 's'} to a recording file.`,
    );
  }

  private async importProject(file: File): Promise<void> {
    try {
      const project = parseRecordingProject(JSON.parse(await file.text()));
      if (!project) throw new Error('Unsupported recording project');

      this.stop(false);
      this.cameraActorId = null;
      this.actors = project.map((actor) => ({
        ...actor,
        spriteIndex: clamp(actor.spriteIndex, 0, this.options.characterNames.length - 1),
        teamId: clamp(actor.teamId, 0, this.options.teamNames.length - 1),
      }));
      this.selectedActorId = this.actors[0]?.id ?? null;
      this.currentTime = 0;
      this.poses.clear();
      this.applyTimelinePose(0);
      this.save();
      this.renderActors();
      this.renderEditor();
      this.refreshTransport(true);
      this.setStatus(
        `Loaded ${this.actors.length} actor${this.actors.length === 1 ? '' : 's'} from ${file.name}.`,
      );
    } catch {
      this.setStatus(
        'Could not load that file. Choose a valid recording project JSON file.',
      );
    } finally {
      this.projectFileInput.value = '';
    }
  }

  private playAll(): void {
    if (this.actors.length === 0 || this.getDuration() <= 0) {
      this.setStatus('Record at least one take before replaying.');
      return;
    }
    this.stop(false);
    this.mode = 'playing';
    this.currentTime = 0;
    this.applyTimelinePose(0);
    this.setStatus('Replaying every actor from the shared timeline. Space stops.');
    this.options.onInputCaptureChange();
    this.refreshTransport(true);
  }

  private startRecording(): void {
    const actor = this.getSelectedActor();
    if (!actor) return;
    this.stop(false);
    this.cameraActive = false;
    this.mode = 'recording';
    this.currentTime = 0;
    this.recordSampleAccumulator = 0;
    actor.frames = [
      {
        time: 0,
        x: actor.startX,
        y: actor.startY,
        facing: actor.startFacing,
        isMoving: false,
      },
    ];
    actor.interactions = [];
    this.applyTimelinePose(0);
    // Discarding is committed immediately; closing the page mid-retake must not
    // resurrect the take the admin explicitly chose to replace.
    this.save();
    this.renderActors();
    this.renderInteractions();
    this.setStatus(
      `Recording ${actor.name} from the beginning. Use WASD/arrows${actor.role === 'warden' ? ', E activates traps' : ''}; Space pauses.`,
    );
    this.options.onInputCaptureChange();
    this.refreshTransport(true);
  }

  private continueRecording(): void {
    const actor = this.getSelectedActor();
    const lastFrame = actor?.frames.at(-1);
    if (!actor || !lastFrame || actor.frames.length < 2) {
      this.startRecording();
      return;
    }
    this.stop(false);
    this.cameraActive = false;
    this.mode = 'recording';
    this.currentTime = lastFrame.time;
    this.recordSampleAccumulator = 0;
    this.applyTimelinePose(this.currentTime);
    this.setStatus(
      `Continuing ${actor.name} at ${formatTime(this.currentTime)}${actor.role === 'warden' ? '; E activates traps' : ''}. Space pauses.`,
    );
    this.options.onInputCaptureChange();
    this.refreshTransport(true);
  }

  private updateRecording(dt: number): void {
    const actor = this.getSelectedActor();
    if (!actor) {
      this.stop();
      return;
    }
    if (this.currentTime >= MAX_RECORDING_SECONDS) {
      this.stop();
      return;
    }

    this.currentTime = Math.min(MAX_RECORDING_SECONDS, this.currentTime + dt);
    for (const other of this.actors) {
      if (other.id !== actor.id) {
        this.poses.set(other.id, sampleRecordingActor(other, this.currentTime));
      }
    }

    const previous = this.poses.get(actor.id) ?? sampleRecordingActor(actor, 0);
    const moved = this.options.moveActor(actor.id, previous, this.movementKeys, dt);
    const isMoving =
      this.movementKeys.up ||
      this.movementKeys.down ||
      this.movementKeys.left ||
      this.movementKeys.right;
    const pose: RecordingActorFrame = {
      time: this.currentTime,
      x: moved.x,
      y: moved.y,
      facing: moved.facing,
      isMoving,
    };
    this.poses.set(actor.id, pose);

    this.recordSampleAccumulator += dt;
    if (this.recordSampleAccumulator >= SAMPLE_INTERVAL) {
      this.recordSampleAccumulator %= SAMPLE_INTERVAL;
      actor.frames.push({ ...pose });
    }
  }

  private toggleActorCamera(): void {
    const actor = this.getSelectedActor();
    if (!actor) return;
    if (this.cameraActorId === actor.id) {
      this.detachActorCamera();
      return;
    }
    this.cameraActive = false;
    this.cameraVelocityX = 0;
    this.cameraVelocityY = 0;
    this.clearMovementKeys();
    this.cameraActorId = actor.id;
    this.setStatus(
      `Camera attached to ${actor.name}. Their ${actor.role} HUD is now displayed.`,
    );
    this.options.onInputCaptureChange();
    this.renderActors();
    this.refreshTransport(true);
  }

  private detachActorCamera(): void {
    const actor = this.actors.find((candidate) => candidate.id === this.cameraActorId);
    this.cameraActorId = null;
    this.setStatus(actor ? `Camera detached from ${actor.name}.` : 'Camera detached.');
    this.options.onInputCaptureChange();
    this.renderActors();
    this.refreshTransport(true);
  }

  private toggleCamera(): void {
    if (this.cameraActive) {
      this.cameraActive = false;
      this.cameraVelocityX = 0;
      this.cameraVelocityY = 0;
      this.clearMovementKeys();
      this.setStatus(
        this.mode === 'playing'
          ? 'Camera released; character replay is still running.'
          : 'Camera released.',
      );
      this.options.onInputCaptureChange();
      this.refreshTransport(true);
      return;
    }
    // Actor recording and camera movement both use WASD, so beginning camera
    // control pauses an active take. Timeline playback has no such conflict and
    // deliberately continues while the camera is controlled.
    if (this.mode === 'recording') this.stop();
    this.cameraActorId = null;
    const local = this.options.getLocalPosition();
    this.cameraX = local.x;
    this.cameraY = local.y;
    this.cameraVelocityX = 0;
    this.cameraVelocityY = 0;
    this.cameraActive = true;
    this.setStatus(
      this.mode === 'playing'
        ? 'Camera active while characters replay. WASD/arrows glide; Q/E zoom.'
        : 'Camera active. WASD/arrows glide, Q/E zoom, Space releases it.',
    );
    this.options.onInputCaptureChange();
    this.refreshTransport(true);
  }

  private updateCamera(dt: number): void {
    const horizontal = Number(this.movementKeys.right) - Number(this.movementKeys.left);
    const vertical = Number(this.movementKeys.down) - Number(this.movementKeys.up);
    const length = Math.hypot(horizontal, vertical) || 1;
    const speed = Number.parseFloat(this.cameraSpeedInput.value) || DEFAULT_CAMERA_SPEED;
    const targetVelocityX = (horizontal / length) * speed;
    const targetVelocityY = (vertical / length) * speed;
    const response = 1 - Math.exp(-8 * dt);
    this.cameraVelocityX += (targetVelocityX - this.cameraVelocityX) * response;
    this.cameraVelocityY += (targetVelocityY - this.cameraVelocityY) * response;
    this.cameraX += this.cameraVelocityX * dt;
    this.cameraY += this.cameraVelocityY * dt;

    const zoomDirection =
      Number(this.pressedCodes.has('KeyE')) - Number(this.pressedCodes.has('KeyQ'));
    if (zoomDirection !== 0) {
      this.options.setZoom(
        clamp(this.options.getZoom() + zoomDirection * 0.65 * dt, MIN_ZOOM, MAX_ZOOM),
      );
    }
  }

  private stop(saveRecording = true): void {
    const wasRecording = this.mode === 'recording';
    const recordedActor = wasRecording ? this.getSelectedActor() : null;
    if (recordedActor && saveRecording) {
      const pose = this.poses.get(recordedActor.id);
      if (pose) {
        const last = recordedActor.frames.at(-1);
        if (!last || last.time < pose.time) recordedActor.frames.push({ ...pose });
      }
      this.save();
      this.renderActors();
      this.setStatus(
        `${recordedActor.name} paused at ${formatTime(getRecordingActorMovementDuration(recordedActor))}. Continue or replay when ready.`,
      );
    } else if (this.mode !== 'idle' && saveRecording) {
      this.setStatus('Stopped.');
    }
    this.mode = 'idle';
    this.cameraVelocityX = 0;
    this.cameraVelocityY = 0;
    this.clearMovementKeys();
    this.options.onInputCaptureChange();
    this.refreshTransport(true);
  }

  private setPanelOpen(open: boolean): void {
    this.panelOpen = open;
    this.panel.hidden = !open;
    this.panel.setAttribute('aria-hidden', String(!open));
    if (!open && this.panel.contains(document.activeElement)) {
      (document.activeElement as HTMLElement).blur();
    }
    this.options.onInputCaptureChange();
  }

  private setCleanMode(clean: boolean): void {
    this.cleanMode = clean;
    this.root.classList.toggle('recording-studio--clean', clean);
    document.body.classList.toggle('recording-clean-ui', clean);
    this.cleanButton.textContent = clean ? 'Show UI' : 'Hide UI';
    this.options.onCleanModeChange(clean);
    if (clean) this.setPanelOpen(false);
    this.options.onInputCaptureChange();
  }

  private applyTimelinePose(time: number): void {
    for (const actor of this.actors) {
      this.poses.set(actor.id, sampleRecordingActor(actor, time));
    }
  }

  private getDuration(): number {
    return this.actors.reduce(
      (duration, actor) => Math.max(duration, getRecordingActorDuration(actor)),
      0,
    );
  }

  private getSelectedActor(): RecordingActor | null {
    return this.actors.find((candidate) => candidate.id === this.selectedActorId) ?? null;
  }

  private renderActors(): void {
    if (this.actors.length === 0) {
      this.actorList.innerHTML =
        '<p class="recording-studio__muted">No fake players yet.</p>';
      return;
    }
    this.actorList.innerHTML = this.actors
      .map((actor) => {
        const selected = actor.id === this.selectedActorId;
        const cameraAttached = actor.id === this.cameraActorId;
        const duration = getRecordingActorDuration(actor);
        const name = this.escapeHtml(actor.name);
        const roleName = actor.role === 'warden' ? 'Warden' : 'Survivor';
        return `<button type="button" class="recording-studio__actor${selected ? ' is-selected' : ''}${cameraAttached ? ' is-camera' : ''}" data-actor-id="${this.escapeHtml(actor.id)}"><span>${cameraAttached ? '◉ ' : ''}${name}</span><small>${roleName} · ${actor.frames.length > 1 ? formatTime(duration) : 'No take'} · ${actor.interactions.length} E</small></button>`;
      })
      .join('');
  }

  private renderEditor(): void {
    const actor = this.getSelectedActor();
    this.actorEditor.hidden = !actor;
    this.emptyEditor.hidden = Boolean(actor);
    if (!actor) return;
    this.actorNameInput.value = actor.name;
    this.actorSkinSelect.value = String(actor.spriteIndex);
    this.actorTeamSelect.value = String(actor.teamId);
    this.actorRoleSelect.value = actor.role;
    this.renderInteractions();
    this.renderMessages();
  }

  private renderInteractions(): void {
    const actor = this.getSelectedActor();
    if (!actor || actor.interactions.length === 0) {
      this.interactionList.innerHTML =
        actor?.role === 'warden'
          ? '<p class="recording-studio__muted">No E trap activations recorded.</p>'
          : '<p class="recording-studio__muted">Set this actor to Warden to record E.</p>';
      return;
    }
    this.interactionList.innerHTML = actor.interactions
      .map(
        (interaction) => `
          <div class="recording-studio__interaction-row">
            <span>Activate trap</span>
            <input data-interaction-id="${this.escapeHtml(interaction.id)}" type="number" min="0" max="600" step="0.1" value="${interaction.time.toFixed(1)}" aria-label="Trap activation time">
            <button type="button" class="danger" data-studio-action="delete-interaction" data-interaction-id="${this.escapeHtml(interaction.id)}" aria-label="Delete trap activation">×</button>
          </div>`,
      )
      .join('');
  }

  private renderMessages(): void {
    const actor = this.getSelectedActor();
    if (!actor || actor.messages.length === 0) {
      this.messageList.innerHTML =
        '<p class="recording-studio__muted">No scheduled bubbles.</p>';
      return;
    }
    this.messageList.innerHTML = actor.messages
      .map(
        (cue) => `
          <div class="recording-studio__message-row">
            <input data-message-id="${this.escapeHtml(cue.id)}" data-message-field="time" type="number" min="0" max="600" step="0.1" value="${cue.time.toFixed(1)}" aria-label="Bubble start time">
            <input data-message-id="${this.escapeHtml(cue.id)}" data-message-field="duration" type="number" min="0.2" max="30" step="0.1" value="${cue.duration.toFixed(1)}" aria-label="Bubble duration">
            <input data-message-id="${this.escapeHtml(cue.id)}" data-message-field="text" maxlength="180" value="${this.escapeHtml(cue.text)}" aria-label="Bubble text">
            <button type="button" class="danger" data-studio-action="delete-message" data-message-id="${this.escapeHtml(cue.id)}" aria-label="Delete bubble">×</button>
          </div>`,
      )
      .join('');
  }

  private refreshTransport(force = false): void {
    const duration = this.getDuration();
    const safeTime = Math.min(this.currentTime, Math.max(duration, this.currentTime));
    if (force || document.activeElement !== this.timelineInput) {
      this.timelineInput.max = String(Math.max(0.01, duration));
      this.timelineInput.value = String(Math.min(safeTime, Math.max(0.01, duration)));
    }
    this.timelineReadout.textContent = `${formatTime(safeTime)} / ${formatTime(duration)}`;
    this.replayButton.disabled = this.actors.length === 0 || duration <= 0;
    this.stopButton.disabled = this.mode === 'idle';
    this.stopButton.classList.toggle('is-recording', this.mode === 'recording');
    this.stopButton.textContent = this.mode === 'recording' ? 'Ⅱ Pause take' : '■ Stop';
    this.cameraButton.classList.toggle('is-active', this.cameraActive);
    this.cameraButton.textContent = this.cameraActive ? 'Camera on' : 'Camera';
    const selectedActor = this.getSelectedActor();
    const hasTake = (selectedActor?.frames.length ?? 0) > 1;
    this.restartButton.classList.toggle('is-recording', this.mode === 'recording');
    this.restartButton.disabled = this.mode === 'recording';
    this.restartButton.textContent = hasTake ? '↻ Discard & restart' : '● Start take';
    this.continueButton.disabled = !hasTake || this.mode === 'recording';
    const cameraAttached = selectedActor?.id === this.cameraActorId;
    this.attachCameraButton.classList.toggle('is-active', cameraAttached);
    this.attachCameraButton.textContent = cameraAttached
      ? 'Detach camera'
      : 'Attach camera';
  }

  private setStatus(text: string): void {
    this.status.textContent = text;
  }

  private directionForCode(code: string): keyof RecordingMoveInput | null {
    switch (code) {
      case 'ArrowUp':
      case 'KeyW':
        return 'up';
      case 'ArrowDown':
      case 'KeyS':
        return 'down';
      case 'ArrowLeft':
      case 'KeyA':
        return 'left';
      case 'ArrowRight':
      case 'KeyD':
        return 'right';
      default:
        return null;
    }
  }

  private hasPressedDirection(direction: keyof RecordingMoveInput): boolean {
    const codes: Record<keyof RecordingMoveInput, readonly string[]> = {
      up: ['ArrowUp', 'KeyW'],
      down: ['ArrowDown', 'KeyS'],
      left: ['ArrowLeft', 'KeyA'],
      right: ['ArrowRight', 'KeyD'],
    };
    return codes[direction].some((code) => this.pressedCodes.has(code));
  }

  private clearMovementKeys(): void {
    this.pressedCodes.clear();
    Object.assign(this.movementKeys, EMPTY_INPUT);
  }

  private spriteIdFor(actorId: string): string {
    return `${ACTOR_SPRITE_PREFIX}${actorId}`;
  }

  private getTrapCaptures(): RecordingTrapCapture[] {
    return deriveRecordingTrapCaptures(
      this.actors,
      this.currentTime,
      this.options.trapCells,
      this.options.tileSize,
    );
  }

  private load(): RecordingActor[] {
    try {
      const raw = localStorage.getItem(this.options.storageKey);
      return raw ? (parseRecordingProject(JSON.parse(raw)) ?? []) : [];
    } catch {
      return [];
    }
  }

  private save(): void {
    try {
      const project: RecordingProjectFile = { version: 2, actors: this.actors };
      localStorage.setItem(this.options.storageKey, JSON.stringify(project));
    } catch {
      // Recording remains usable for this session when storage is unavailable.
    }
  }

  private escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (character) => {
      const replacements: Record<string, string> = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      };
      return replacements[character];
    });
  }
}
