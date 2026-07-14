// packages/client/src/systems/Portal.ts
// ─────────────────────────────────────────────────────────────────────────────
// Animated portal sprite with three phases:
//
//   Phase 1 — Inactive: Shows the unlit portal from the start of the match.
//   Phase 2 — Activation: Lights the portal once all runestones are active.
//   Phase 3 — Active: Loops through the lit idle frames continuously.
//
// Frame counts are passed in from the asset loader (no hardcoded counts).
// No additional scale, rotation, or alpha effects — the spritesheet
// contains all visual information.
// ─────────────────────────────────────────────────────────────────────────────

import { Sprite, Container, Texture } from 'pixi.js';

type PortalPhase = 'inactive' | 'activation' | 'active';

/** Duration (seconds) for the full activation animation. */
const ACTIVATION_DURATION = 0.6;

/** Duration (seconds) for one full active idle cycle. */
const ACTIVE_CYCLE_DURATION = 1.0;

export class Portal {
  readonly sprite: Sprite;

  private frames: Texture[];
  private phase: PortalPhase;
  private elapsed = 0;

  /** Number of activation frames (first N in the frames array). */
  private activationCount: number;
  /** Number of active idle frames (remaining frames after activation). */
  private activeCount: number;

  /**
   * @param x                World pixel X (center of cell)
   * @param y                World pixel Y (center of cell)
   * @param frames           All portal textures (activation first, then active idle)
   * @param activationCount  How many frames are activation (the rest are active idle)
   * @param parent           Container to add the sprite to (entityLayer)
   * @param active           Whether the portal should start already lit
   */
  constructor(
    x: number,
    y: number,
    frames: Texture[],
    activationCount: number,
    parent: Container,
    active = false,
  ) {
    this.frames = frames;
    this.activationCount = activationCount;
    this.activeCount = frames.length - activationCount;
    this.phase = active ? 'active' : 'inactive';

    // The first activation frame is the fully inactive portal.
    const initialFrame = active ? frames[activationCount] : frames[0];
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
    if (this.phase === 'inactive') return;

    this.elapsed += dt;

    if (this.phase === 'activation') {
      this.updateActivation();
    } else {
      this.updateActive();
    }
  }

  // ── Activation Animation ────────────────────────────────────────────────

  /** Start the one-shot light-up sequence. */
  activate(): void {
    if (this.phase !== 'inactive') return;
    this.phase = 'activation';
    this.elapsed = 0;
  }

  private updateActivation(): void {
    const t = Math.min(this.elapsed / ACTIVATION_DURATION, 1);

    const frameIdx = Math.min(
      Math.floor(t * this.activationCount),
      this.activationCount - 1,
    );
    this.sprite.texture = this.frames[frameIdx];

    // Transition to the active loop when the light-up sequence is complete.
    if (t >= 1) {
      this.phase = 'active';
      this.elapsed = 0;
      this.sprite.texture = this.frames[this.activationCount];
    }
  }

  // ── Active Animation ────────────────────────────────────────────────────

  private updateActive(): void {
    const tActive = (this.elapsed % ACTIVE_CYCLE_DURATION) / ACTIVE_CYCLE_DURATION;
    const frameOffset = Math.min(
      Math.floor(tActive * this.activeCount),
      this.activeCount - 1,
    );
    const frameIdx = this.activationCount + frameOffset;
    this.sprite.texture = this.frames[frameIdx];
  }

  // ── Cleanup ─────────────────────────────────────────────────────────────

  destroy(): void {
    this.sprite.parent?.removeChild(this.sprite);
    this.sprite.destroy();
  }
}
