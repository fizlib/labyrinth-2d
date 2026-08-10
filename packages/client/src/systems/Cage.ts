import { Container, Graphics, Sprite } from 'pixi.js';
import type { CageState } from '@labyrinth/shared';
import type { CageTextures } from '../assets/AssetLoader';

const MATERIALIZE_DURATION = 0.5;
const MAGIC_PARTICLE_COUNT = 8;

interface MagicParticle {
  graphic: Graphics;
  angle: number;
}

/** Two-sided cage visual whose back/player/front z-order matches the editor export. */
export class CageVisual {
  private readonly back: Sprite;
  private readonly front: Sprite;
  private readonly magic: Container;
  private readonly ring: Graphics;
  private readonly particles: MagicParticle[] = [];
  private materializeElapsed: number;
  private opened: boolean;

  constructor(
    readonly cageId: number,
    state: CageState,
    private readonly textures: CageTextures,
    parent: Container,
    animate: boolean,
  ) {
    this.opened = state.opened;
    this.materializeElapsed = animate ? 0 : MATERIALIZE_DURATION;

    this.back = new Sprite(textures.back);
    this.back.anchor.set(0.5, 1);
    // birdCage1 is two pixels lower than birdCage2 in the supplied style export.
    this.back.position.set(state.x, state.y + 2);
    this.back.zIndex = Math.round(state.y);

    this.front = new Sprite(state.opened ? textures.open : textures.closed);
    this.front.anchor.set(0.5, 1);
    this.front.position.set(state.x, state.y);
    this.front.zIndex = Math.round(state.y) + 2;

    this.magic = new Container();
    this.magic.position.set(state.x, state.y - 12);
    this.magic.zIndex = Math.round(state.y) + 3;
    this.ring = new Graphics()
      .circle(0, 0, 13)
      .stroke({ color: 0xff4d5f, alpha: 0.95, width: 2 })
      .circle(0, 0, 8)
      .stroke({ color: 0xffd0d5, alpha: 0.8, width: 1 });
    this.magic.addChild(this.ring);

    for (let index = 0; index < MAGIC_PARTICLE_COUNT; index++) {
      const graphic = new Graphics()
        .rect(-1, -1, 2, 2)
        .fill({ color: index % 2 === 0 ? 0xff4d5f : 0xffd0d5 });
      this.magic.addChild(graphic);
      this.particles.push({
        graphic,
        angle: (index / MAGIC_PARTICLE_COUNT) * Math.PI * 2,
      });
    }

    parent.addChild(this.back, this.front, this.magic);
    if (!animate) {
      this.magic.visible = false;
      this.back.alpha = 1;
      this.front.alpha = 1;
    } else {
      this.back.alpha = 0;
      this.front.alpha = 0;
      this.back.scale.set(0.2);
      this.front.scale.set(0.2);
    }
  }

  syncState(state: CageState): void {
    if (state.opened !== this.opened) {
      this.opened = state.opened;
      this.front.texture = state.opened ? this.textures.open : this.textures.closed;
    }
  }

  update(dt: number): void {
    if (this.materializeElapsed >= MATERIALIZE_DURATION) return;
    this.materializeElapsed = Math.min(
      MATERIALIZE_DURATION,
      this.materializeElapsed + dt,
    );
    const progress = this.materializeElapsed / MATERIALIZE_DURATION;
    const eased = 1 - Math.pow(1 - progress, 3);
    const scale = 0.2 + eased * 0.8;
    this.back.scale.set(scale);
    this.front.scale.set(scale);
    this.back.alpha = Math.min(1, progress * 2.5);
    this.front.alpha = this.back.alpha;

    this.ring.scale.set(0.35 + progress * 1.1);
    this.magic.alpha = 1 - progress;
    for (let index = 0; index < this.particles.length; index++) {
      const particle = this.particles[index];
      const radius = 4 + progress * (10 + (index % 3) * 2);
      particle.graphic.x = Math.cos(particle.angle) * radius;
      particle.graphic.y = Math.sin(particle.angle) * radius;
    }

    if (progress >= 1) {
      this.back.scale.set(1);
      this.front.scale.set(1);
      this.magic.visible = false;
    }
  }

  destroy(): void {
    this.back.parent?.removeChild(this.back);
    this.front.parent?.removeChild(this.front);
    this.magic.parent?.removeChild(this.magic);
    this.back.destroy();
    this.front.destroy();
    this.magic.destroy({ children: true });
  }
}
