import { Container, Graphics, Text, TextStyle } from 'pixi.js';

const PANEL_WIDTH = 316;
const PANEL_MARGIN = 8;
const PANEL_PADDING_X = 12;
const PANEL_PADDING_Y = 8;
const PANEL_MIN_HEIGHT = 44;
const BUTTON_SIZE = 18;
const BUTTON_SLOT_WIDTH = 28;
const TEXT_SCALE = 0.125;
const TYPEWRITER_CHARS_PER_SECOND = 72;

export class IntroDialogueHud {
  private readonly container: Container;
  private readonly background: Graphics;
  private readonly messageText: Text;
  private readonly advanceButton: Container;
  private readonly pages: readonly string[];
  private readonly internalWidth: number;
  private readonly internalHeight: number;
  private panelHeight = PANEL_MIN_HEIGHT;
  private pageIndex = 0;
  private revealedChars = 0;
  private visible = true;

  constructor(internalWidth: number, internalHeight: number, pages: readonly string[]) {
    this.pages = pages;
    this.internalWidth = internalWidth;
    this.internalHeight = internalHeight;
    this.container = new Container();
    this.container.eventMode = 'passive';

    this.background = new Graphics();
    this.messageText = new Text({
      text: '',
      style: new TextStyle({
        fontFamily: 'PixelOperator8',
        fontSize: 64,
        fill: '#f7edd2',
        wordWrap: true,
        wordWrapWidth: (PANEL_WIDTH - PANEL_PADDING_X * 2 - BUTTON_SLOT_WIDTH) / TEXT_SCALE,
        lineHeight: 72,
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
    this.messageText.scale.set(TEXT_SCALE);
    this.messageText.x = PANEL_PADDING_X;
    this.messageText.y = PANEL_PADDING_Y;

    this.advanceButton = this.createAdvanceButton();

    this.container.addChild(this.background);
    this.container.addChild(this.messageText);
    this.container.addChild(this.advanceButton);

    this.setPage(0);
  }

  addToStage(stage: Container): void {
    stage.addChild(this.container);
  }

  isVisible(): boolean {
    return this.visible;
  }

  update(dtSeconds: number): void {
    if (!this.visible || this.isCurrentPageFullyRevealed()) return;

    this.revealedChars = Math.min(
      this.getCurrentPage().length,
      this.revealedChars + TYPEWRITER_CHARS_PER_SECOND * dtSeconds,
    );
    this.updateDisplayedText();
  }

  advance(): void {
    if (!this.visible) return;

    if (!this.isCurrentPageFullyRevealed()) {
      this.revealCurrentPage();
      return;
    }

    const nextPageIndex = this.pageIndex + 1;
    if (nextPageIndex < this.pages.length) {
      this.setPage(nextPageIndex);
      return;
    }

    this.visible = false;
    this.container.visible = false;
    this.advanceButton.eventMode = 'none';
    this.advanceButton.cursor = 'default';
  }

  destroy(): void {
    this.container.parent?.removeChild(this.container);
    this.container.destroy({ children: true });
  }

  private setPage(pageIndex: number): void {
    this.pageIndex = pageIndex;
    this.revealedChars = 0;
    this.resizeToCurrentPage();
    this.updateDisplayedText();
  }

  private drawPanel(): void {
    this.background.clear();
    this.background.roundRect(2, 2, PANEL_WIDTH, this.panelHeight, 7);
    this.background.fill({ color: 0x000000, alpha: 0.35 });
    this.background.roundRect(0, 0, PANEL_WIDTH, this.panelHeight, 6);
    this.background.fill({ color: 0x10161e, alpha: 0.95 });
    this.background.roundRect(1, 1, PANEL_WIDTH - 2, this.panelHeight - 2, 5);
    this.background.stroke({ color: 0xe8cf97, alpha: 0.55, width: 1, alignment: 0 });
  }

  private createAdvanceButton(): Container {
    const button = new Container();
    button.eventMode = 'static';
    button.cursor = 'pointer';
    button.on('pointertap', () => this.advance());

    const buttonBg = new Graphics();
    buttonBg.roundRect(0, 0, BUTTON_SIZE, BUTTON_SIZE, 4);
    buttonBg.fill({ color: 0x243140, alpha: 0.98 });
    buttonBg.roundRect(1, 1, BUTTON_SIZE - 2, BUTTON_SIZE - 2, 3);
    buttonBg.stroke({ color: 0xe8cf97, alpha: 0.8, width: 1, alignment: 0 });

    const arrowText = new Text({
      text: '>',
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
    arrowText.scale.set(TEXT_SCALE);
    arrowText.anchor.set(0.5);
    arrowText.x = Math.round(BUTTON_SIZE / 2);
    arrowText.y = Math.round(BUTTON_SIZE / 2) + 1;

    button.addChild(buttonBg);
    button.addChild(arrowText);

    return button;
  }

  private resizeToCurrentPage(): void {
    const page = this.getCurrentPage();
    this.messageText.text = page;
    this.panelHeight = Math.max(
      PANEL_MIN_HEIGHT,
      Math.ceil(this.messageText.height + PANEL_PADDING_Y * 2),
    );
    this.drawPanel();
    this.advanceButton.x = PANEL_WIDTH - PANEL_PADDING_X - BUTTON_SIZE;
    this.advanceButton.y = Math.round((this.panelHeight - BUTTON_SIZE) / 2);
    this.container.x = Math.round((this.internalWidth - PANEL_WIDTH) / 2);
    this.container.y = Math.round(this.internalHeight - this.panelHeight - PANEL_MARGIN);
  }

  private updateDisplayedText(): void {
    const currentPage = this.getCurrentPage();
    this.messageText.text = currentPage.slice(0, Math.floor(this.revealedChars));
  }

  private revealCurrentPage(): void {
    this.revealedChars = this.getCurrentPage().length;
    this.updateDisplayedText();
  }

  private getCurrentPage(): string {
    return this.pages[this.pageIndex] ?? '';
  }

  private isCurrentPageFullyRevealed(): boolean {
    return Math.floor(this.revealedChars) >= this.getCurrentPage().length;
  }
}
