import { Container, Graphics, Text, TextStyle } from 'pixi.js';

import type { MatchResultPlayer, MatchState } from '@labyrinth/shared';

const TIMER_TOP = 8;
const TEXT_RENDER_SCALE = 4;
const RESULT_WIDTH = 224;
const RESULT_HEIGHT = 184;
const RESULT_DIVIDER_Y = 45;
const RESULT_LIST_Y = 69;
const RESULT_LIST_LINE_HEIGHT = 10;
const RESULT_BUTTON_Y = 150;
const RESULT_BUTTON_WIDTH = 90;
const RESULT_BUTTON_HEIGHT = 25;
const MAX_RESULT_NAME_LENGTH = 16;

export interface MatchHudActions {
  onPlayAgain: () => void;
  onExit: () => void;
}

export interface MatchHudOptions {
  showTimer?: boolean;
}

export class MatchHud {
  private readonly container = new Container();
  private readonly timerText: Text;
  private readonly resultContainer = new Container();
  private readonly resultTitle: Text;
  private readonly survivorList: Text;
  private readonly wardenList: Text;
  private remainingMs = 0;
  private lastSyncAt = performance.now();
  private status: MatchState['status'] = 'waiting';

  constructor(
    private readonly internalWidth: number,
    private readonly internalHeight: number,
    actions: MatchHudActions,
    private readonly options: MatchHudOptions = {},
  ) {
    this.container.eventMode = 'passive';
    this.container.zIndex = 100_000;

    this.timerText = this.createText('10:00', 16, '#fff5cf');
    this.timerText.anchor.set(0.5);
    this.timerText.x = Math.round(internalWidth / 2);
    this.timerText.y = TIMER_TOP + 11;
    this.container.addChild(this.timerText);

    this.resultContainer.eventMode = 'static';
    const scrim = new Graphics();
    scrim.rect(0, 0, internalWidth, internalHeight);
    scrim.fill({ color: 0x05070a, alpha: 0.66 });
    this.resultContainer.addChild(scrim);

    const panel = new Container();
    panel.x = Math.round((internalWidth - RESULT_WIDTH) / 2);
    panel.y = Math.round((internalHeight - RESULT_HEIGHT) / 2);
    this.resultContainer.addChild(panel);

    const resultBackground = new Graphics();
    resultBackground.rect(3, 3, RESULT_WIDTH, RESULT_HEIGHT);
    resultBackground.fill({ color: 0x000000, alpha: 0.7 });
    resultBackground.rect(0, 0, RESULT_WIDTH, RESULT_HEIGHT);
    resultBackground.fill({ color: 0x5c341d });
    resultBackground.rect(2, 2, RESULT_WIDTH - 4, RESULT_HEIGHT - 4);
    resultBackground.fill({ color: 0xb16d39 });
    resultBackground.rect(4, 4, RESULT_WIDTH - 8, RESULT_HEIGHT - 8);
    resultBackground.fill({ color: 0x111a20, alpha: 0.98 });
    resultBackground.rect(6, 6, RESULT_WIDTH - 12, RESULT_HEIGHT - 12);
    resultBackground.stroke({ color: 0x313d40, width: 1, alignment: 0 });
    panel.addChild(resultBackground);

    this.resultTitle = this.createText('', 16, '#fff5cf');
    this.resultTitle.anchor.set(0.5);
    this.resultTitle.x = RESULT_WIDTH / 2;
    this.resultTitle.y = 25;
    panel.addChild(this.resultTitle);

    const divider = new Graphics();
    divider.moveTo(15, RESULT_DIVIDER_Y);
    divider.lineTo(RESULT_WIDTH - 15, RESULT_DIVIDER_Y);
    divider.stroke({ color: 0x66533c, alpha: 0.85, width: 1 });
    divider.rect(13, RESULT_DIVIDER_Y - 1, 3, 3);
    divider.fill({ color: 0x8a704e });
    divider.rect(RESULT_WIDTH - 16, RESULT_DIVIDER_Y - 1, 3, 3);
    divider.fill({ color: 0x8a704e });
    const dividerDiamond = new Graphics();
    dividerDiamond.rect(-3, -3, 6, 6);
    dividerDiamond.fill({ color: 0x172229 });
    dividerDiamond.stroke({ color: 0x80694a, width: 1, alignment: 0 });
    dividerDiamond.x = RESULT_WIDTH / 2;
    dividerDiamond.y = RESULT_DIVIDER_Y;
    dividerDiamond.rotation = Math.PI / 4;
    panel.addChild(divider, dividerDiamond);

    const survivorHeading = this.createText('Survivors:', 8, '#f0c94d');
    survivorHeading.x = 18;
    survivorHeading.y = 54;
    panel.addChild(survivorHeading);

    const wardenHeading = this.createText('Wardens:', 8, '#ef715c');
    wardenHeading.x = 121;
    wardenHeading.y = 54;
    panel.addChild(wardenHeading);

    this.survivorList = this.createText(
      '',
      8,
      '#fff5cf',
      TEXT_RENDER_SCALE,
      RESULT_LIST_LINE_HEIGHT,
    );
    this.survivorList.x = 18;
    this.survivorList.y = RESULT_LIST_Y;
    panel.addChild(this.survivorList);

    this.wardenList = this.createText(
      '',
      8,
      '#fff5cf',
      TEXT_RENDER_SCALE,
      RESULT_LIST_LINE_HEIGHT,
    );
    this.wardenList.x = 121;
    this.wardenList.y = RESULT_LIST_Y;
    panel.addChild(this.wardenList);

    panel.addChild(
      this.createButton('Play again', 18, RESULT_BUTTON_Y, actions.onPlayAgain),
      this.createButton('Exit', 116, RESULT_BUTTON_Y, actions.onExit),
    );

    this.resultContainer.visible = false;
    this.container.addChild(this.resultContainer);
  }

  addToStage(stage: Container): void {
    stage.addChild(this.container);
  }

  sync(match: MatchState): void {
    this.status = match.status;
    this.remainingMs = Math.max(0, match.remainingMs);
    this.lastSyncAt = performance.now();
    this.updateTimerText();
    this.timerText.visible = (this.options.showTimer ?? true) && match.status !== 'ended';
    if (match.status === 'ended' && match.winner) {
      this.showResult(match);
    } else {
      this.resultContainer.visible = false;
    }
  }

  update(): void {
    if (this.status === 'running') {
      const now = performance.now();
      const elapsed = now - this.lastSyncAt;
      this.lastSyncAt = now;
      this.remainingMs = Math.max(0, this.remainingMs - elapsed);
    }
    this.updateTimerText();
  }

  destroy(): void {
    this.container.parent?.removeChild(this.container);
    this.container.destroy({ children: true });
  }

  private showResult(match: MatchState): void {
    this.status = 'ended';
    this.resultTitle.text =
      match.winner === 'survivors' ? 'Survivors won' : 'Wardens won';
    const roster = match.finalRoster ?? [];
    this.survivorList.text = this.formatRoster(roster, 'survivor');
    this.wardenList.text = this.formatRoster(roster, 'warden');
    this.resultContainer.visible = true;
  }

  private formatRoster(
    roster: readonly MatchResultPlayer[],
    role: MatchResultPlayer['role'],
  ): string {
    const names = roster
      .filter((player) => player.role === role)
      .map((player) => this.truncateName(player.displayName));
    return names.length > 0 ? names.join('\n') : '—';
  }

  private truncateName(name: string): string {
    if (name.length <= MAX_RESULT_NAME_LENGTH) return name;
    return `${name.slice(0, MAX_RESULT_NAME_LENGTH - 1)}…`;
  }

  private createButton(
    label: string,
    x: number,
    y: number,
    onPress: () => void,
  ): Container {
    const button = new Container();
    button.x = x;
    button.y = y;
    button.eventMode = 'static';
    button.cursor = 'pointer';

    const background = new Graphics();
    const drawBackground = (hovered: boolean): void => {
      background.clear();
      background.rect(2, 2, RESULT_BUTTON_WIDTH, RESULT_BUTTON_HEIGHT);
      background.fill({ color: 0x000000, alpha: 0.65 });
      background.rect(0, 0, RESULT_BUTTON_WIDTH, RESULT_BUTTON_HEIGHT);
      background.fill({ color: hovered ? 0xd0b16e : 0x907a55 });
      background.rect(2, 2, RESULT_BUTTON_WIDTH - 4, RESULT_BUTTON_HEIGHT - 4);
      background.fill({ color: hovered ? 0x263640 : 0x1b2830 });
    };
    drawBackground(false);
    button.addChild(background);

    const text = this.createText(label, 8, '#fff5cf');
    text.anchor.set(0.5);
    text.x = RESULT_BUTTON_WIDTH / 2;
    text.y = RESULT_BUTTON_HEIGHT / 2 + 1;
    button.addChild(text);

    button.on('pointerover', () => drawBackground(true));
    button.on('pointerout', () => drawBackground(false));
    button.on('pointertap', onPress);
    return button;
  }

  private createText(
    text: string,
    fontSize: number,
    fill: string,
    renderScale = TEXT_RENDER_SCALE,
    lineHeight?: number,
  ): Text {
    const label = new Text({
      text,
      style: new TextStyle({
        fontFamily: 'PixelOperator8',
        fontSize: fontSize * renderScale,
        fill,
        align: 'left',
        lineHeight: lineHeight ? lineHeight * renderScale : undefined,
        dropShadow: {
          alpha: 1,
          blur: 0,
          color: '#000000',
          distance: 2 * renderScale,
          angle: Math.PI / 4,
        },
      }),
      roundPixels: true,
      resolution: 2,
    });
    label.scale.set(1 / renderScale);
    return label;
  }

  private updateTimerText(): void {
    const totalSeconds = Math.ceil(this.remainingMs / 1_000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const nextText = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    if (this.timerText.text !== nextText) this.timerText.text = nextText;
  }
}
