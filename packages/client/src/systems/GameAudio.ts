const AUDIO_ROOT = './assets/audio/game';

const FOOTSTEP_CLIPS = {
  grass: Array.from(
    { length: 5 },
    (_, index) => `${AUDIO_ROOT}/footsteps/grass-${index + 1}.ogg`,
  ),
  stone: Array.from(
    { length: 5 },
    (_, index) => `${AUDIO_ROOT}/footsteps/stone-${index + 1}.ogg`,
  ),
  wood: Array.from(
    { length: 5 },
    (_, index) => `${AUDIO_ROOT}/footsteps/wood-${index + 1}.ogg`,
  ),
  mud: Array.from(
    { length: 5 },
    (_, index) => `${AUDIO_ROOT}/footsteps/mud-${index + 1}.ogg`,
  ),
  splash: Array.from(
    { length: 3 },
    (_, index) => `${AUDIO_ROOT}/footsteps/splash-${index + 1}.ogg`,
  ),
} as const;

const CLIPS = {
  gateOpen: `${AUDIO_ROOT}/mechanisms/gate-open.ogg`,
  gateClose: `${AUDIO_ROOT}/mechanisms/gate-close.ogg`,
  plateDown: `${AUDIO_ROOT}/mechanisms/plate-down.ogg`,
  plateClick: `${AUDIO_ROOT}/mechanisms/plate-click.ogg`,
  plateLatch: `${AUDIO_ROOT}/mechanisms/plate-latch.ogg`,
  swordMetal: `${AUDIO_ROOT}/mechanisms/sword-metal.ogg`,
  cageOpen: `${AUDIO_ROOT}/mechanisms/cage-open.ogg`,
  chestOpen: `${AUDIO_ROOT}/mechanisms/chest-open.wav`,
  wardstone: `${AUDIO_ROOT}/magic/wardstone.ogg`,
  swordField: `${AUDIO_ROOT}/magic/sword-field.ogg`,
  cageMaterialize: `${AUDIO_ROOT}/magic/cage-materialize.ogg`,
  orbGrant: `${AUDIO_ROOT}/magic/orb-grant.ogg`,
  wisdomOrbUse: `${AUDIO_ROOT}/magic/wisdom-orb-use.wav`,
  teleport: `${AUDIO_ROOT}/magic/teleport.wav`,
  bridgeRepair: Array.from(
    { length: 5 },
    (_, index) => `${AUDIO_ROOT}/bridge/repair-${index + 1}.ogg`,
  ),
  bridgeCollapse: Array.from(
    { length: 3 },
    (_, index) => `${AUDIO_ROOT}/bridge/collapse-${index + 1}.ogg`,
  ),
} as const;

const FOREST_AMBIENCE = `${AUDIO_ROOT}/ambience/forest.ogg`;
const SWAMP_AMBIENCE = `${AUDIO_ROOT}/ambience/swamp.ogg`;
const FOREST_AMBIENCE_VOLUME = 0.06;
const FOREST_AMBIENCE_SWAMP_VOLUME = 0.03;
const AMBIENCE_FADE_IN_SECONDS = 4;
const MAX_ACTIVE_VOICES = 28;
const FOOTSTEP_MIN_INTERVAL_MS = 320;

export type FootstepSurface = keyof typeof FOOTSTEP_CLIPS;

export interface AudioPoint {
  x: number;
  y: number;
}

export interface GameAudioPreferences {
  musicMuted: boolean;
  soundEffectsMuted: boolean;
}

interface PlayOptions {
  source?: AudioPoint;
  listener?: AudioPoint;
  volume?: number;
  maxDistance?: number;
  playbackRate?: number;
}

interface FootstepState {
  x: number;
  y: number;
  distance: number;
  surface: FootstepSurface;
  lastStepAt: number;
}

interface FootstepUpdate {
  playerId: string;
  x: number;
  y: number;
  moving: boolean;
  surface: FootstepSurface;
  listener: AudioPoint;
  local: boolean;
}

interface AmbienceLoop {
  audio: HTMLAudioElement;
  currentVolume: number;
  targetVolume: number;
}

/** Linear world-space attenuation with a small full-volume inner radius. */
export function getSpatialGain(
  source: AudioPoint,
  listener: AudioPoint,
  maxDistance: number,
  fullVolumeDistance = 24,
): number {
  if (maxDistance <= fullVolumeDistance) return 0;
  const distance = Math.hypot(source.x - listener.x, source.y - listener.y);
  if (distance <= fullVolumeDistance) return 1;
  if (distance >= maxDistance) return 0;
  return 1 - (distance - fullVolumeDistance) / (maxDistance - fullVolumeDistance);
}

export function advanceAmbienceFadeGain(
  currentGain: number,
  dt: number,
  durationSeconds: number,
): number {
  if (durationSeconds <= 0) return 1;
  return Math.min(1, Math.max(0, currentGain) + Math.max(0, dt) / durationSeconds);
}

function choose<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

function getAllOneShotUrls(): string[] {
  return [
    ...Object.values(FOOTSTEP_CLIPS).flat(),
    CLIPS.gateOpen,
    CLIPS.gateClose,
    CLIPS.plateDown,
    CLIPS.plateClick,
    CLIPS.plateLatch,
    CLIPS.swordMetal,
    CLIPS.cageOpen,
    CLIPS.chestOpen,
    CLIPS.wardstone,
    CLIPS.swordField,
    CLIPS.cageMaterialize,
    CLIPS.orbGrant,
    CLIPS.wisdomOrbUse,
    CLIPS.teleport,
    ...CLIPS.bridgeRepair,
    ...CLIPS.bridgeCollapse,
  ];
}

export class GameAudio {
  private musicMuted: boolean;
  private soundEffectsMuted: boolean;
  private matchActive = false;
  private swampActive = false;
  private ambienceFadeGain = 1;
  private readonly templates = new Map<string, HTMLAudioElement>();
  private readonly voices = new Set<HTMLAudioElement>();
  private readonly footsteps = new Map<string, FootstepState>();
  private readonly lastCueTimes = new Map<string, number>();
  private readonly forestLoop: AmbienceLoop;
  private readonly swampLoop: AmbienceLoop;
  private readonly unlock: () => void;

  constructor(preferences: GameAudioPreferences) {
    this.musicMuted = preferences.musicMuted;
    this.soundEffectsMuted = preferences.soundEffectsMuted;

    for (const url of getAllOneShotUrls()) {
      const audio = new Audio(url);
      audio.preload = 'auto';
      this.templates.set(url, audio);
    }

    this.forestLoop = this.createLoop(FOREST_AMBIENCE);
    this.swampLoop = this.createLoop(SWAMP_AMBIENCE);
    this.unlock = (): void => {
      this.ensureAmbiencePlaying();
    };
    window.addEventListener('pointerdown', this.unlock, { passive: true });
    window.addEventListener('keydown', this.unlock);
  }

  setMusicMuted(muted: boolean): void {
    this.musicMuted = muted;
    this.forestLoop.audio.muted = muted;
    this.swampLoop.audio.muted = muted;
    if (!muted) this.ensureAmbiencePlaying();
  }

  setSoundEffectsMuted(muted: boolean): void {
    this.soundEffectsMuted = muted;
    for (const voice of this.voices) voice.muted = muted;
  }

  setAmbience(matchActive: boolean, swampActive: boolean): void {
    const matchJustStarted = matchActive && !this.matchActive;
    this.matchActive = matchActive;
    this.swampActive = swampActive;
    if (matchJustStarted) this.ambienceFadeGain = 0;
    this.forestLoop.targetVolume = matchActive
      ? swampActive
        ? FOREST_AMBIENCE_SWAMP_VOLUME
        : FOREST_AMBIENCE_VOLUME
      : 0;
    this.swampLoop.targetVolume = matchActive && swampActive ? 0.24 : 0;
    this.ensureAmbiencePlaying();
  }

  update(dt: number): void {
    if (this.matchActive) {
      this.ambienceFadeGain = advanceAmbienceFadeGain(
        this.ambienceFadeGain,
        dt,
        AMBIENCE_FADE_IN_SECONDS,
      );
    }
    this.updateLoop(this.forestLoop, dt);
    this.updateLoop(this.swampLoop, dt);
  }

  updateFootstep(update: FootstepUpdate): void {
    const previous = this.footsteps.get(update.playerId);
    if (!previous) {
      this.footsteps.set(update.playerId, {
        x: update.x,
        y: update.y,
        distance: 0,
        surface: update.surface,
        lastStepAt: -Infinity,
      });
      return;
    }

    const movedDistance = Math.hypot(update.x - previous.x, update.y - previous.y);
    previous.x = update.x;
    previous.y = update.y;

    if (!update.moving || movedDistance > 48) {
      previous.distance = 0;
      previous.surface = update.surface;
      return;
    }

    if (previous.surface !== update.surface) {
      previous.distance = 0;
      previous.surface = update.surface;
    }

    previous.distance += movedDistance;
    const stride =
      update.surface === 'splash'
        ? 9
        : update.surface === 'wood'
          ? 31
          : update.surface === 'mud'
            ? 32
            : 33;
    const now = performance.now();
    if (
      previous.distance < stride ||
      now - previous.lastStepAt < FOOTSTEP_MIN_INTERVAL_MS
    ) {
      return;
    }
    previous.distance %= stride;
    previous.lastStepAt = now;

    this.play(choose(FOOTSTEP_CLIPS[update.surface]), {
      source: { x: update.x, y: update.y },
      listener: update.listener,
      volume: update.local ? (update.surface === 'splash' ? 0.34 : 0.28) : 0.2,
      maxDistance: 190,
      playbackRate: 0.96 + Math.random() * 0.08,
    });
  }

  removePlayer(playerId: string): void {
    this.footsteps.delete(playerId);
  }

  playGate(open: boolean, source: AudioPoint, listener: AudioPoint): void {
    this.play(open ? CLIPS.gateOpen : CLIPS.gateClose, {
      source,
      listener,
      volume: open ? 0.62 : 0.7,
      maxDistance: 320,
    });
  }

  playPressurePlate(
    state: 'pressed' | 'released' | 'latched',
    source: AudioPoint,
    listener: AudioPoint,
  ): void {
    if (state === 'released') {
      this.play(CLIPS.plateClick, { source, listener, volume: 0.38, maxDistance: 180 });
      return;
    }
    this.play(CLIPS.plateDown, { source, listener, volume: 0.44, maxDistance: 190 });
    this.play(state === 'latched' ? CLIPS.plateLatch : CLIPS.plateClick, {
      source,
      listener,
      volume: state === 'latched' ? 0.55 : 0.34,
      maxDistance: 210,
      playbackRate: state === 'latched' ? 0.94 : 1.04,
    });
  }

  playWardstone(index: number, source: AudioPoint, listener: AudioPoint): void {
    if (!this.canPlay(`wardstone:${index}`, 800)) return;
    this.play(CLIPS.wardstone, { source, listener, volume: 0.72, maxDistance: 420 });
  }

  playSwordField(index: number, source: AudioPoint, listener: AudioPoint): void {
    if (!this.canPlay(`sword-field:${index}`, 1_500)) return;
    this.play(CLIPS.swordField, { source, listener, volume: 0.66, maxDistance: 360 });
    this.play(CLIPS.swordMetal, {
      source,
      listener,
      volume: 0.5,
      maxDistance: 300,
      playbackRate: 0.9,
    });
  }

  playCageMaterialize(cageId: number, source: AudioPoint, listener: AudioPoint): void {
    if (!this.canPlay(`cage-spawn:${cageId}`, 1_000)) return;
    this.play(CLIPS.cageMaterialize, {
      source,
      listener,
      volume: 0.58,
      maxDistance: 300,
    });
  }

  playCageOpen(cageId: number, source: AudioPoint, listener: AudioPoint): void {
    if (!this.canPlay(`cage-open:${cageId}`, 1_000)) return;
    this.play(CLIPS.cageOpen, { source, listener, volume: 0.62, maxDistance: 260 });
  }

  playChestOpen(chestIndex: number, source: AudioPoint, listener: AudioPoint): void {
    if (!this.canPlay(`chest:${chestIndex}`, 1_000)) return;
    this.play(CLIPS.chestOpen, { source, listener, volume: 0.58, maxDistance: 260 });
  }

  playOrbGrant(source: AudioPoint, listener: AudioPoint): void {
    this.play(CLIPS.orbGrant, { source, listener, volume: 0.56, maxDistance: 300 });
  }

  playWisdomOrbUse(): void {
    if (!this.canPlay('wisdom-orb-use', 250)) return;
    this.play(CLIPS.wisdomOrbUse, { volume: 0.48 });
  }

  playPortalActivation(source: AudioPoint, listener: AudioPoint): void {
    if (!this.canPlay('portal-activation', 2_000)) return;
    this.play(CLIPS.wardstone, { source, listener, volume: 0.72, maxDistance: 480 });
    this.play(CLIPS.teleport, { source, listener, volume: 0.58, maxDistance: 480 });
  }

  playTeleport(source: AudioPoint, listener: AudioPoint): void {
    this.play(CLIPS.teleport, { source, listener, volume: 0.66, maxDistance: 420 });
  }

  playBridgeRepair(bridgeIndex: number, source: AudioPoint, listener: AudioPoint): void {
    if (!this.canPlay(`bridge-repair:${bridgeIndex}`, 130)) return;
    this.play(choose(CLIPS.bridgeRepair), {
      source,
      listener,
      volume: 0.42,
      maxDistance: 260,
      playbackRate: 0.96 + Math.random() * 0.08,
    });
  }

  playBridgeCollapse(
    bridgeIndex: number,
    source: AudioPoint,
    listener: AudioPoint,
  ): void {
    if (!this.canPlay(`bridge-collapse:${bridgeIndex}`, 220)) return;
    this.play(choose(CLIPS.bridgeCollapse), {
      source,
      listener,
      volume: 0.66,
      maxDistance: 340,
      playbackRate: 0.94 + Math.random() * 0.08,
    });
  }

  resetWorld(): void {
    this.footsteps.clear();
    this.lastCueTimes.clear();
    this.setAmbience(false, false);
  }

  destroy(): void {
    window.removeEventListener('pointerdown', this.unlock);
    window.removeEventListener('keydown', this.unlock);
    for (const voice of this.voices) {
      voice.pause();
      voice.removeAttribute('src');
    }
    this.voices.clear();
    for (const loop of [this.forestLoop, this.swampLoop]) {
      loop.audio.pause();
      loop.audio.removeAttribute('src');
    }
    this.templates.clear();
    this.footsteps.clear();
  }

  private createLoop(url: string): AmbienceLoop {
    const audio = new Audio(url);
    audio.loop = true;
    audio.preload = 'auto';
    audio.volume = 0;
    audio.muted = this.musicMuted;
    return { audio, currentVolume: 0, targetVolume: 0 };
  }

  private updateLoop(loop: AmbienceLoop, dt: number): void {
    const blend = Math.min(1, dt * 2.5);
    loop.currentVolume += (loop.targetVolume - loop.currentVolume) * blend;
    if (Math.abs(loop.currentVolume - loop.targetVolume) < 0.001) {
      loop.currentVolume = loop.targetVolume;
    }
    loop.audio.volume = Math.max(
      0,
      Math.min(1, loop.currentVolume * this.ambienceFadeGain),
    );
    if (loop.targetVolume > 0.001 && loop.audio.paused) {
      void loop.audio.play().catch(() => undefined);
    } else if (loop.currentVolume <= 0.001 && loop.targetVolume === 0) {
      loop.audio.pause();
    }
  }

  private ensureAmbiencePlaying(): void {
    if (!this.matchActive || this.musicMuted) return;
    if (this.forestLoop.targetVolume > 0 && this.forestLoop.audio.paused) {
      void this.forestLoop.audio.play().catch(() => undefined);
    }
    if (this.swampActive && this.swampLoop.audio.paused) {
      void this.swampLoop.audio.play().catch(() => undefined);
    }
  }

  private canPlay(key: string, cooldownMs: number): boolean {
    const now = performance.now();
    const lastPlayed = this.lastCueTimes.get(key) ?? -Infinity;
    if (now - lastPlayed < cooldownMs) return false;
    this.lastCueTimes.set(key, now);
    return true;
  }

  private play(url: string, options: PlayOptions = {}): void {
    if (this.soundEffectsMuted || this.voices.size >= MAX_ACTIVE_VOICES) return;

    const spatialGain =
      options.source && options.listener
        ? getSpatialGain(options.source, options.listener, options.maxDistance ?? 280)
        : 1;
    const volume = Math.max(0, Math.min(1, (options.volume ?? 1) * spatialGain));
    if (volume < 0.01) return;

    const template = this.templates.get(url);
    const voice = template
      ? (template.cloneNode(true) as HTMLAudioElement)
      : new Audio(url);
    voice.preload = 'auto';
    voice.muted = this.soundEffectsMuted;
    voice.volume = volume;
    voice.playbackRate = options.playbackRate ?? 1;
    this.voices.add(voice);

    const cleanup = (): void => {
      voice.removeEventListener('ended', cleanup);
      voice.removeEventListener('error', cleanup);
      this.voices.delete(voice);
    };
    voice.addEventListener('ended', cleanup);
    voice.addEventListener('error', cleanup);
    void voice.play().catch(cleanup);
  }
}
