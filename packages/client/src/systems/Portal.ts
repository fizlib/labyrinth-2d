// packages/client/src/systems/Portal.ts
// ─────────────────────────────────────────────────────────────────────────────
// Animated portal sprite with two-phase animation:
//
//   Phase 1 — Emergence: Plays through emergence frames once sequentially.
//   Phase 2 — Idle: Loops through idle frames continuously.
//
// Frame counts are passed in from the asset loader (no hardcoded counts).
// No additional scale, rotation, or alpha effects — the spritesheet
// contains all visual information.
// ─────────────────────────────────────────────────────────────────────────────

import { Sprite, Container, Texture } from 'pixi.js';

type PortalPhase = 'emergence' | 'idle';

/** Duration (seconds) for the full emergence animation. */
const EMERGENCE_DURATION = 0.6;

/** Duration (seconds) for one full idle cycle. */
const IDLE_CYCLE_DURATION = 1.0;

export class Portal {
  readonly sprite: Sprite;

  private frames: Texture[];
  private phase: PortalPhase;
  private elapsed = 0;

  /** Number of emergence frames (first N in the frames array). */
  private emergenceCount: number;
  /** Number of idle frames (remaining frames after emergence). */
  private idleCount: number;

  /**
   * @param x                World pixel X (center of cell)
   * @param y                World pixel Y (center of cell)
   * @param frames           All portal textures (emergence first, then idle)
   * @param emergenceCount   How many frames are emergence (the rest are idle)
   * @param parent           Container to add the sprite to (entityLayer)
   * @param skipEmergence    If true, start directly in idle (for late joiners)
   */
  constructor(
    x: number,
    y: number,
    frames: Texture[],
    emergenceCount: number,
    parent: Container,
    skipEmergence = false,
  ) {
    this.frames = frames;
    this.emergenceCount = emergenceCount;
    this.idleCount = frames.length - emergenceCount;
    this.phase = skipEmergence ? 'idle' : 'emergence';

    // Create sprite using the first appropriate frame
    const initialFrame = skipEmergence ? frames[emergenceCount] : frames[0];
    this.sprite = new Sprite(initialFrame);
    this.sprite.anchor.set(0.5, 0.5);
    this.sprite.x = x;
    this.sprite.y = y;

    // Portal should Y-sort with other entities
    this.sprite.zIndex = Math.round(y) + 1;

    parent.addChild(this.sprite);
  }

  /**
   * Advance the portal animation by dt seconds.
   * Call every frame from the game loop.
   */
  update(dt: number): void {
    this.elapsed += dt;

    if (this.phase === 'emergence') {
      this.updateEmergence();
    } else {
      this.updateIdle();
    }
  }

  // ── Emergence Animation ─────────────────────────────────────────────────

  private updateEmergence(): void {
    const t = Math.min(this.elapsed / EMERGENCE_DURATION, 1);

    // Linear frame progression through emergence frames
    const frameIdx = Math.min(Math.floor(t * this.emergenceCount), this.emergenceCount - 1);
    this.sprite.texture = this.frames[frameIdx];

    // Transition to idle when emergence is complete
    if (t >= 1) {
      this.phase = 'idle';
      this.elapsed = 0;
      this.sprite.texture = this.frames[this.emergenceCount];
    }
  }

  // ── Idle Animation ──────────────────────────────────────────────────────

  private updateIdle(): void {
    // Cycle through idle frames continuously
    const tIdle = (this.elapsed % IDLE_CYCLE_DURATION) / IDLE_CYCLE_DURATION;
    const frameOffset = Math.min(Math.floor(tIdle * this.idleCount), this.idleCount - 1);
    const frameIdx = this.emergenceCount + frameOffset;
    this.sprite.texture = this.frames[frameIdx];
  }

  // ── Cleanup ─────────────────────────────────────────────────────────────

  destroy(): void {
    this.sprite.parent?.removeChild(this.sprite);
    this.sprite.destroy();
  }
}
