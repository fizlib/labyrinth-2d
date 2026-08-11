import { Container, Graphics, Text, TextStyle } from 'pixi.js';

import type { MatchState, MatchWinner } from '@labyrinth/shared';

const TIMER_TOP = 8;
const TIMER_TEXT_RENDER_SCALE = 4;
const RESULT_WIDTH = 224;
const RESULT_HEIGHT = 58;

export class MatchHud {
  private readonly container = new Container();
  private readonly timerText: Text;
  private readonly resultContainer = new Container();
  private readonly resultTitle: Text;
  private readonly resultDetail: Text;
  private remainingMs = 0;
  private lastSyncAt = performance.now();
  private status: MatchState['status'] = 'waiting';

  constructor(
    private readonly internalWidth: number,
    private readonly internalHeight: number,
  ) {
    this.container.eventMode = 'none';
    this.container.zIndex = 100_000;

    this.timerText = this.createText(
      '10:00',
      16,
      '#fff5cf',
      TIMER_TEXT_RENDER_SCALE,
    );
    this.timerText.anchor.set(0.5);
    this.timerText.x = Math.round(internalWidth / 2);
    this.timerText.y = TIMER_TOP + 11;
    this.container.addChild(this.timerText);

    const resultBackground = new Graphics();
    resultBackground.roundRect(3, 3, RESULT_WIDTH, RESULT_HEIGHT, 8);
    resultBackground.fill({ color: 0x000000, alpha: 0.55 });
    resultBackground.roundRect(0, 0, RESULT_WIDTH, RESULT_HEIGHT, 7);
    resultBackground.fill({ color: 0x10161e, alpha: 0.97 });
    resultBackground.roundRect(1, 1, RESULT_WIDTH - 2, RESULT_HEIGHT - 2, 6);
    resultBackground.stroke({ color: 0xe8cf97, alpha: 0.85, width: 1, alignment: 0 });
    this.resultContainer.addChild(resultBackground);

    this.resultTitle = this.createText('', 18, '#ffffff');
    this.resultTitle.anchor.set(0.5);
    this.resultTitle.x = RESULT_WIDTH / 2;
    this.resultTitle.y = 21;
    this.resultContainer.addChild(this.resultTitle);

    this.resultDetail = this.createText('', 8, '#d8ded9');
    this.resultDetail.anchor.set(0.5);
    this.resultDetail.x = RESULT_WIDTH / 2;
    this.resultDetail.y = 43;
    this.resultContainer.addChild(this.resultDetail);

    this.resultContainer.x = Math.round((internalWidth - RESULT_WIDTH) / 2);
    this.resultContainer.y = Math.round((internalHeight - RESULT_HEIGHT) / 2);
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
    if (match.status === 'ended' && match.winner) {
      this.showResult(match.winner, match.escapedCount, match.escapeThreshold);
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

  showResult(winner: MatchWinner, escapedCount: number, escapeThreshold: number): void {
    this.status = 'ended';
    this.resultTitle.text = winner === 'survivors' ? 'SURVIVORS WIN' : 'WARDENS WIN';
    this.resultTitle.style.fill = winner === 'survivors' ? '#7ee879' : '#ef6262';
    this.resultDetail.text = `${escapedCount} / ${escapeThreshold} survivors escaped`;
    this.resultContainer.visible = true;
  }

  destroy(): void {
    this.container.parent?.removeChild(this.container);
    this.container.destroy({ children: true });
  }

  private createText(
    text: string,
    fontSize: number,
    fill: string,
    renderScale = 1,
  ): Text {
    const label = new Text({
      text,
      style: new TextStyle({
        fontFamily: 'PixelOperator8',
        fontSize: fontSize * renderScale,
        fill,
        align: 'center',
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
