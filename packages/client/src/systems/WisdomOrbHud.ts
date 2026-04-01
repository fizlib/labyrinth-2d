import { Container, Graphics, Sprite, Text, TextStyle, Texture } from 'pixi.js';

import { INITIAL_WISDOM_ORBS } from '@labyrinth/shared';

const MARGIN = 8;
const PANEL_WIDTH = 92;
const PANEL_HEIGHT = 30;
const ORB_SIZE = 16;
const ORB_GAP = 4;

export class WisdomOrbHud {
  private readonly container: Container;
  private readonly orbSprites: Sprite[] = [];
  private readonly countText: Text;
  private remainingOrbs = INITIAL_WISDOM_ORBS;

  constructor(texture: Texture, onUseOrb: () => void) {
    this.container = new Container();
    this.container.x = MARGIN;
    this.container.y = MARGIN;

    const bg = new Graphics();
    bg.roundRect(2, 2, PANEL_WIDTH, PANEL_HEIGHT, 6);
    bg.fill({ color: 0x000000, alpha: 0.35 });
    bg.roundRect(0, 0, PANEL_WIDTH, PANEL_HEIGHT, 5);
    bg.fill({ color: 0x18212d, alpha: 0.92 });
    bg.roundRect(1, 1, PANEL_WIDTH - 2, PANEL_HEIGHT - 2, 4);
    bg.stroke({ color: 0x5acde0, alpha: 0.35, width: 1, alignment: 0 });
    this.container.addChild(bg);

    const label = new Text({
      text: 'Wisdom',
      style: new TextStyle({
        fontFamily: 'PixelOperator8',
        fontSize: 64,
        fill: '#d7fbff',
        dropShadow: {
          alpha: 1,
          blur: 0,
          color: '#000000',
          distance: 8,
          angle: Math.PI / 4,
        },
      }),
      roundPixels: true,
      resolution: 2,
    });
    label.scale.set(0.125);
    label.x = 6;
    label.y = 3;
    this.container.addChild(label);

    const orbStartX = 6;
    const orbY = 12;
    for (let i = 0; i < INITIAL_WISDOM_ORBS; i++) {
      const orb = new Sprite(texture);
      orb.width = ORB_SIZE;
      orb.height = ORB_SIZE;
      orb.x = orbStartX + i * (ORB_SIZE + ORB_GAP);
      orb.y = orbY;
      orb.on('pointertap', () => {
        console.info(`[WisdomOrb][HUD] pointertap on orb index=${i}, remainingOrbs=${this.remainingOrbs}, eligible=${i < this.remainingOrbs}`);
        if (i < this.remainingOrbs) onUseOrb();
      });
      this.orbSprites.push(orb);
      this.container.addChild(orb);
    }

    this.countText = new Text({
      text: 'x3',
      style: new TextStyle({
        fontFamily: 'PixelOperator8',
        fontSize: 64,
        fill: '#ffffff',
        dropShadow: {
          alpha: 1,
          blur: 0,
          color: '#000000',
          distance: 8,
          angle: Math.PI / 4,
        },
      }),
      roundPixels: true,
      resolution: 2,
    });
    this.countText.scale.set(0.125);
    this.countText.x = 67;
    this.countText.y = 15;
    this.container.addChild(this.countText);

    this.setRemaining(INITIAL_WISDOM_ORBS);
  }

  addToStage(stage: Container): void {
    stage.addChild(this.container);
  }

  setRemaining(remainingOrbs: number): void {
    this.remainingOrbs = Math.max(0, Math.min(INITIAL_WISDOM_ORBS, remainingOrbs));
    this.countText.text = `x${this.remainingOrbs}`;

    for (let i = 0; i < this.orbSprites.length; i++) {
      const orb = this.orbSprites[i];
      const active = i < this.remainingOrbs;
      orb.alpha = active ? 1 : 0.25;
      orb.tint = active ? 0xffffff : 0x6f7c8d;
      orb.eventMode = active ? 'static' : 'none';
      orb.cursor = active ? 'pointer' : 'default';
    }
  }

  destroy(): void {
    this.container.parent?.removeChild(this.container);
    this.container.destroy({ children: true });
  }
}
