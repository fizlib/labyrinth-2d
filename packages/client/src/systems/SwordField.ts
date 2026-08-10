import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import {
  SERVER_TICK_MS,
  SWORD_FIELD_AUTHORING_TILE_SIZE,
  SWORD_FIELD_LOWER_DURATION_MS,
  type SwordFieldPlacement,
  type SwordFieldState,
} from '@labyrinth/shared';
import {
  SWORD_FIELD_SCENERY_SPRITES,
  SWORD_FIELD_SWORD_SPRITES,
  SWORD_FIELD_TERRAIN_SPRITES,
  getSwordFieldAssetPath,
} from './SwordFieldLayout';

const SHAKE_DURATION = 0.36;
const SINK_START = 0.28;
const MAGIC_PARTICLE_COUNT = 28;

interface TrackedSword {
  sprite: Sprite;
  originalX: number;
  originalY: number;
  originalScaleX: number;
  originalScaleY: number;
  phase: number;
}

interface MagicParticle {
  graphic: Graphics;
  baseX: number;
  baseY: number;
  phase: number;
}

/** Shared-state animation controller for one sword barrier. */
export class SwordFieldVisual {
  readonly entities: Container[] = [];

  private readonly swords: TrackedSword[] = [];
  private readonly magic = new Container();
  private readonly aura: Graphics;
  private readonly particles: MagicParticle[] = [];
  private readonly scale: number;
  private lowering = false;
  private cleared = false;
  private elapsed = 0;

  constructor(
    readonly index: number,
    placement: SwordFieldPlacement,
    tileSize: number,
    textures: ReadonlyMap<string, Texture>,
  ) {
    this.scale = tileSize / SWORD_FIELD_AUTHORING_TILE_SIZE;
    const anchorX = placement.tileX * tileSize;
    const anchorY = placement.tileY * tileSize;

    for (const spec of SWORD_FIELD_SCENERY_SPRITES) {
      const texture = textures.get(getSwordFieldAssetPath(spec.asset));
      if (!texture) continue;
      const sprite = new Sprite(texture);
      sprite.x = anchorX + spec.x * this.scale;
      sprite.y = anchorY + spec.y * this.scale;
      sprite.width = spec.w * this.scale;
      sprite.height = spec.h * this.scale;
      sprite.zIndex = Math.round(anchorY + (spec.y + spec.h) * this.scale);
      this.entities.push(sprite);
    }

    for (const [swordIndex, spec] of SWORD_FIELD_SWORD_SPRITES.entries()) {
      const texture = textures.get(getSwordFieldAssetPath(spec.asset));
      if (!texture) continue;
      const sprite = new Sprite(texture);
      sprite.anchor.set(0, 1);
      sprite.x = anchorX + spec.x * this.scale;
      sprite.y = anchorY + (spec.y + spec.h) * this.scale;
      sprite.width = spec.w * this.scale;
      sprite.height = spec.h * this.scale;
      sprite.zIndex = Math.round(sprite.y);
      this.swords.push({
        sprite,
        originalX: sprite.x,
        originalY: sprite.y,
        originalScaleX: sprite.scale.x,
        originalScaleY: sprite.scale.y,
        phase: swordIndex * 0.83,
      });
      this.entities.push(sprite);
    }

    this.magic.x = anchorX;
    this.magic.y = anchorY;
    this.magic.zIndex = Math.round(anchorY + 1_000);
    this.magic.visible = false;
    this.aura = new Graphics()
      .circle(64 * this.scale, 48 * this.scale, 28 * this.scale)
      .stroke({ color: 0x8ceeff, alpha: 0.42, width: Math.max(1, this.scale) })
      .circle(128 * this.scale, 48 * this.scale, 28 * this.scale)
      .stroke({ color: 0xffed9a, alpha: 0.34, width: Math.max(1, this.scale) });
    this.magic.addChild(this.aura);

    for (let particleIndex = 0; particleIndex < MAGIC_PARTICLE_COUNT; particleIndex++) {
      const phase = particleIndex / MAGIC_PARTICLE_COUNT;
      const graphic = new Graphics()
        .poly([
          0,
          -2 * this.scale,
          1.2 * this.scale,
          0,
          0,
          2 * this.scale,
          -1.2 * this.scale,
          0,
        ])
        .fill({ color: particleIndex % 3 === 0 ? 0xffed9a : 0xa7f7ff });
      this.magic.addChild(graphic);
      this.particles.push({
        graphic,
        baseX: (24 + ((particleIndex * 47) % 144)) * this.scale,
        baseY: (20 + ((particleIndex * 29) % 58)) * this.scale,
        phase,
      });
    }
    this.entities.push(this.magic);
  }

  /** Start immediately for the player who spent the orb, before the next snapshot arrives. */
  playFromStart(): void {
    if (this.cleared || this.lowering) return;
    this.lowering = true;
    this.elapsed = 0;
    this.magic.visible = true;
    this.applyFrame();
  }

  syncState(
    state: SwordFieldState | undefined,
    currentTick: number,
    animate: boolean,
  ): void {
    if (state?.cleared) {
      this.cleared = true;
      this.lowering = false;
      this.elapsed = SWORD_FIELD_LOWER_DURATION_MS / 1_000;
      this.applyFrame();
      return;
    }

    if (state?.loweringStartedTick !== null && state?.loweringStartedTick !== undefined) {
      const authoritativeElapsed = Math.max(
        0,
        ((currentTick - state.loweringStartedTick) * SERVER_TICK_MS) / 1_000,
      );
      if (!this.lowering) {
        this.lowering = true;
        this.magic.visible = true;
        this.elapsed = animate ? 0 : authoritativeElapsed;
      }
      this.elapsed = Math.max(this.elapsed, authoritativeElapsed);
      this.applyFrame();
      return;
    }

    this.resetBlocking();
  }

  update(dt: number): void {
    if (!this.lowering || this.cleared) return;
    this.elapsed += dt;
    this.applyFrame();
  }

  private resetBlocking(): void {
    this.lowering = false;
    this.cleared = false;
    this.elapsed = 0;
    this.magic.visible = false;
    for (const sword of this.swords) {
      sword.sprite.visible = true;
      sword.sprite.alpha = 1;
      sword.sprite.x = sword.originalX;
      sword.sprite.y = sword.originalY;
      sword.sprite.scale.set(sword.originalScaleX, sword.originalScaleY);
    }
  }

  private applyFrame(): void {
    const totalDuration = SWORD_FIELD_LOWER_DURATION_MS / 1_000;
    const sinkProgress = Math.max(
      0,
      Math.min(1, (this.elapsed - SINK_START) / (totalDuration - SINK_START)),
    );
    const easedSink = 1 - (1 - sinkProgress) ** 3;
    const shakeStrength =
      this.elapsed < SHAKE_DURATION
        ? (1 - this.elapsed / SHAKE_DURATION) * 1.5 * this.scale
        : 0;

    for (const sword of this.swords) {
      const shakeX = Math.sin(this.elapsed * 74 + sword.phase) * shakeStrength;
      const shakeY =
        Math.cos(this.elapsed * 91 + sword.phase * 1.7) * shakeStrength * 0.45;
      sword.sprite.x = sword.originalX + shakeX;
      sword.sprite.y = sword.originalY + shakeY;
      sword.sprite.scale.set(
        sword.originalScaleX,
        sword.originalScaleY * Math.max(0.001, 1 - easedSink),
      );
      sword.sprite.alpha = Math.max(0, 1 - Math.max(0, sinkProgress - 0.62) / 0.38);
      sword.sprite.visible = sinkProgress < 1;
    }

    const durationProgress = Math.min(1, this.elapsed / totalDuration);
    const magicFade = Math.sin(durationProgress * Math.PI);
    this.magic.visible = durationProgress < 1;
    this.aura.alpha = magicFade * 0.8;
    this.aura.scale.y = 0.9 + Math.sin(this.elapsed * 12) * 0.08;

    for (const particle of this.particles) {
      const cycle = (durationProgress * 2.1 + particle.phase) % 1;
      particle.graphic.x =
        particle.baseX +
        Math.sin(this.elapsed * 8 + particle.phase * 12) * 5 * this.scale;
      particle.graphic.y = particle.baseY - cycle * 22 * this.scale;
      particle.graphic.alpha = Math.sin(cycle * Math.PI) * magicFade;
      particle.graphic.rotation = this.elapsed * 2.5 + particle.phase * Math.PI;
      particle.graphic.scale.set(0.65 + (1 - cycle) * 0.55);
    }
  }
}

export interface SwordFieldRenderResult {
  entities: Container[];
  visuals: SwordFieldVisual[];
}

/** Add the exact editor-authored terrain and entity composition. */
export function addSwordFields(
  placements: readonly SwordFieldPlacement[],
  tileSize: number,
  textures: ReadonlyMap<string, Texture>,
  terrainParent: Container,
): SwordFieldRenderResult {
  const scale = tileSize / SWORD_FIELD_AUTHORING_TILE_SIZE;
  const entities: Container[] = [];
  const visuals: SwordFieldVisual[] = [];

  for (const [index, placement] of placements.entries()) {
    const terrain = new Container();
    terrain.sortableChildren = true;
    terrain.x = placement.tileX * tileSize;
    terrain.y = placement.tileY * tileSize;
    terrain.zIndex = -1;

    for (const spec of SWORD_FIELD_TERRAIN_SPRITES) {
      const texture = textures.get(getSwordFieldAssetPath(spec.asset));
      if (!texture) continue;
      const sprite = new Sprite(texture);
      sprite.x = spec.x * scale;
      sprite.y = spec.y * scale;
      sprite.width = spec.w * scale;
      sprite.height = spec.h * scale;
      terrain.addChild(sprite);
    }
    terrainParent.addChild(terrain);

    const visual = new SwordFieldVisual(index, placement, tileSize, textures);
    visuals.push(visual);
    entities.push(...visual.entities);
  }

  return { entities, visuals };
}
