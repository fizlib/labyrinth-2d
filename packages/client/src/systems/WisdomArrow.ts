import { Container, Graphics } from 'pixi.js';

import type { HubDirection } from '@labyrinth/shared';

const HINT_DURATION_S = 1.5;
const FADE_DURATION_S = 0.3;
const OFFSET_Y = 34;

export class WisdomArrow {
  private readonly container: Container;
  private timeRemaining = 0;

  constructor(parent: Container) {
    this.container = new Container();
    this.container.visible = false;

    const shadow = new Graphics();
    shadow.poly([1, -9, 6, -2, 3, -2, 3, 9, -3, 9, -3, -2, -6, -2]);
    shadow.fill({ color: 0x000000, alpha: 0.4 });
    shadow.y = 1;
    this.container.addChild(shadow);

    const arrow = new Graphics();
    arrow.poly([0, -10, 5, -3, 2, -3, 2, 10, -2, 10, -2, -3, -5, -3]);
    arrow.fill({ color: 0xffdc6b });
    arrow.stroke({ color: 0x9f6b16, width: 1, alignment: 0.5 });
    this.container.addChild(arrow);

    const highlight = new Graphics();
    highlight.poly([0, -7, 2, -4, 1, -4, 1, 4, -1, 4, -1, -4, -2, -4]);
    highlight.fill({ color: 0xfff5b7, alpha: 0.8 });
    this.container.addChild(highlight);

    parent.addChild(this.container);
  }

  show(direction: HubDirection): void {
    this.timeRemaining = HINT_DURATION_S;
    this.container.visible = true;
    this.container.alpha = 1;
    this.container.rotation = directionToRotation(direction);
  }

  update(dt: number, playerX: number, playerY: number): void {
    if (!this.container.visible) return;

    this.timeRemaining -= dt;
    if (this.timeRemaining <= 0) {
      this.container.visible = false;
      return;
    }

    this.container.x = Math.round(playerX);
    this.container.y = Math.round(playerY - OFFSET_Y);
    this.container.zIndex = Math.round(playerY) + 2;
    this.container.alpha = this.timeRemaining < FADE_DURATION_S
      ? this.timeRemaining / FADE_DURATION_S
      : 1;
  }

  destroy(): void {
    this.container.parent?.removeChild(this.container);
    this.container.destroy({ children: true });
  }
}

function directionToRotation(direction: HubDirection): number {
  switch (direction) {
    case 'north':
      return 0;
    case 'east':
      return Math.PI / 2;
    case 'south':
      return Math.PI;
    case 'west':
      return -Math.PI / 2;
  }
}
