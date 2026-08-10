import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import {
  getChestInteractionPoint,
  type ChestDeadEndPlacement,
} from '@labyrinth/shared';
import {
  CHEST_DEAD_END_SPRITES,
  getChestDeadEndChestSpritePair,
  getChestDeadEndAssetPath,
} from './ChestDeadEndLayout';

const AUTHORING_TILE_SIZE = 16;
const MAGIC_DURATION = 1.8;
const MAGIC_PARTICLE_COUNT = 10;

interface MagicParticle {
  graphic: Graphics;
  phase: number;
  drift: number;
}

/** Stateful opened/closed sprite and one-shot wisdom-magic burst for one chest. */
export class ChestDeadEndVisual {
  readonly container: Container;
  readonly interactionX: number;
  readonly interactionY: number;
  readonly promptX: number;
  readonly promptY: number;

  private readonly closedSprite: Sprite;
  private readonly openSprite: Sprite;
  private readonly magic: Container;
  private readonly aura: Graphics;
  private readonly particles: MagicParticle[] = [];
  private readonly renderScale: number;
  private opened = false;
  private magicElapsed = MAGIC_DURATION;

  constructor(
    readonly index: number,
    placement: ChestDeadEndPlacement,
    tileSize: number,
    closedTexture: Texture,
    openTexture: Texture,
  ) {
    const scale = tileSize / AUTHORING_TILE_SIZE;
    this.renderScale = scale;
    const { closed: closedSpec, open: openSpec } = getChestDeadEndChestSpritePair(
      placement.chestCount,
      placement.chestSlot,
    );

    const anchorX = placement.tileX * tileSize;
    const anchorY = placement.tileY * tileSize;
    const interaction = getChestInteractionPoint(placement, tileSize);
    this.interactionX = interaction.x;
    this.interactionY = interaction.y;
    this.promptX = interaction.x;
    this.promptY = anchorY + (openSpec.y - 2) * scale;

    this.container = new Container();
    this.container.sortableChildren = true;
    this.container.x = anchorX;
    this.container.y = anchorY;
    this.container.zIndex = Math.round(
      anchorY + (closedSpec.y + closedSpec.h) * scale,
    );

    this.closedSprite = new Sprite(closedTexture);
    this.closedSprite.x = closedSpec.x * scale;
    this.closedSprite.y = closedSpec.y * scale;
    this.closedSprite.width = closedSpec.w * scale;
    this.closedSprite.height = closedSpec.h * scale;
    this.closedSprite.zIndex = closedSpec.z;
    this.container.addChild(this.closedSprite);

    this.openSprite = new Sprite(openTexture);
    this.openSprite.x = openSpec.x * scale;
    this.openSprite.y = openSpec.y * scale;
    this.openSprite.width = openSpec.w * scale;
    this.openSprite.height = openSpec.h * scale;
    this.openSprite.zIndex = openSpec.z;
    this.openSprite.visible = false;
    this.container.addChild(this.openSprite);

    this.magic = new Container();
    this.magic.x = (openSpec.x + openSpec.w / 2) * scale;
    this.magic.y = (openSpec.y + 12) * scale;
    this.magic.zIndex = openSpec.z + 1;
    this.magic.visible = false;

    this.aura = new Graphics()
      .circle(0, 0, 7 * scale)
      .fill({ color: 0x5acde0, alpha: 0.34 })
      .circle(0, 0, 4 * scale)
      .stroke({ color: 0xd7fbff, alpha: 0.9, width: Math.max(1, scale) });
    this.magic.addChild(this.aura);

    for (let particleIndex = 0; particleIndex < MAGIC_PARTICLE_COUNT; particleIndex++) {
      const graphic = new Graphics()
        .rect(-scale, -scale, 2 * scale, 2 * scale)
        .fill({ color: particleIndex % 3 === 0 ? 0xd7fbff : 0x5acde0 });
      this.magic.addChild(graphic);
      this.particles.push({
        graphic,
        phase: particleIndex / MAGIC_PARTICLE_COUNT,
        drift: ((particleIndex * 7) % 9) - 4,
      });
    }
    this.container.addChild(this.magic);
  }

  isOpened(): boolean {
    return this.opened;
  }

  syncOpened(opened: boolean, animate: boolean): void {
    if (this.opened === opened) return;
    this.opened = opened;
    this.closedSprite.visible = !opened;
    this.openSprite.visible = opened;
    if (opened && animate) this.playMagic();
    else if (!opened) this.magic.visible = false;
  }

  playMagic(): void {
    this.magicElapsed = 0;
    this.magic.visible = true;
  }

  update(dt: number): void {
    if (!this.magic.visible) return;
    this.magicElapsed += dt;
    if (this.magicElapsed >= MAGIC_DURATION) {
      this.magic.visible = false;
      return;
    }

    const durationProgress = this.magicElapsed / MAGIC_DURATION;
    const fade = Math.pow(1 - durationProgress, 0.7);
    const pulse = 0.82 + Math.sin(this.magicElapsed * 9) * 0.16;
    this.aura.scale.set(pulse);
    this.aura.alpha = fade;

    for (const particle of this.particles) {
      const progress = (durationProgress * 1.65 + particle.phase) % 1;
      particle.graphic.x =
        (particle.drift + Math.sin((progress + particle.phase) * Math.PI * 2) * 2) *
        this.renderScale;
      particle.graphic.y = -progress * 24 * this.renderScale;
      particle.graphic.alpha = Math.sin(progress * Math.PI) * fade;
      const particleScale = 0.65 + (1 - progress) * 0.45;
      particle.graphic.scale.set(particleScale);
    }
  }
}

export interface ChestDeadEndRenderResult {
  entities: Container[];
  visuals: ChestDeadEndVisual[];
}

/** Build the authored treasure prefabs as entities so players sort around them. */
export function addChestDeadEnds(
  placements: readonly ChestDeadEndPlacement[],
  tileSize: number,
  textures: ReadonlyMap<string, Texture>,
  terrainParent: Container,
): ChestDeadEndRenderResult {
  const scale = tileSize / AUTHORING_TILE_SIZE;
  const entities: Container[] = [];
  const visuals: ChestDeadEndVisual[] = [];

  for (const [index, placement] of placements.entries()) {
    const anchorX = placement.tileX * tileSize;
    const anchorY = placement.tileY * tileSize;
    if (placement.chestSlot === 0) {
      const terrain = new Container();
      terrain.sortableChildren = true;
      terrain.x = anchorX;
      terrain.y = anchorY;
      terrain.zIndex = -1;
      const backdrop = new Container();
      backdrop.sortableChildren = true;
      backdrop.x = anchorX;
      backdrop.y = anchorY;
      backdrop.zIndex = Math.round(anchorY + 16 * scale);

      for (const spec of CHEST_DEAD_END_SPRITES) {
        const texture = textures.get(getChestDeadEndAssetPath(spec.asset));
        if (!texture) continue;

        const sprite = new Sprite(texture);
        sprite.width = spec.w * scale;
        sprite.height = spec.h * scale;

        if (spec.layer === 'terrain') {
          sprite.x = spec.x * scale;
          sprite.y = spec.y * scale;
          sprite.zIndex = spec.z;
          terrain.addChild(sprite);
          continue;
        }

        if (spec.layer === 'backdrop') {
          sprite.x = spec.x * scale;
          sprite.y = spec.y * scale;
          sprite.zIndex = spec.z;
          backdrop.addChild(sprite);
          continue;
        }

        sprite.x = anchorX + spec.x * scale;
        sprite.y = anchorY + spec.y * scale;
        sprite.zIndex = Math.round(anchorY + (spec.y + spec.h) * scale);
        entities.push(sprite);
      }

      if (terrain.children.length > 0) terrainParent.addChild(terrain);
      else terrain.destroy();
      if (backdrop.children.length > 0) entities.push(backdrop);
      else backdrop.destroy();
    }

    const closedTexture = textures.get(getChestDeadEndAssetPath('chest'));
    if (closedTexture) {
      const openTexture =
        textures.get(getChestDeadEndAssetPath('chestOpen')) ?? closedTexture;
      const visual = new ChestDeadEndVisual(
        index,
        placement,
        tileSize,
        closedTexture,
        openTexture,
      );
      visuals.push(visual);
      entities.push(visual.container);
    }
  }

  return { entities, visuals };
}
