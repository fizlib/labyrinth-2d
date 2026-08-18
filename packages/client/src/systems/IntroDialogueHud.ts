// packages/client/src/systems/IntroDialogueHud.ts
import { Container, Graphics, Text, TextStyle } from 'pixi.js';

const PANEL_WIDTH = 316;
const PANEL_MARGIN = 8;
const PANEL_PADDING_X = 12;
const PANEL_PADDING_Y = 8;
const PANEL_MIN_HEIGHT = 44;
const BUTTON_SIZE = 18;
const BUTTON_SLOT_WIDTH = 28;
// Adjusted scale to drastically reduce texture memory / bandwidth on mobile devices
const TEXT_SCALE = 0.5;
const TYPEWRITER_CHARS_PER_SECOND = 72;
const ROLE_TAG_STYLES = {
  survivor: { fill: '#70d486' },
  warden: { fill: '#ef715c' },
} as const;

function getVisibleTextLength(markup: string): number {
  return markup.replace(/<[^>]*>/g, '').length;
}

/** Return a typewriter-safe prefix while keeping any completed rich-text tags intact. */
function getVisibleMarkupPrefix(markup: string, visibleCharacters: number): string {
  if (visibleCharacters <= 0) return '';

  let result = '';
  let consumedCharacters = 0;
  let index = 0;

  while (index < markup.length) {
    if (markup[index] === '<') {
      const closeIndex = markup.indexOf('>', index);
      if (closeIndex === -1) {
        result += markup[index];
        consumedCharacters += 1;
        index += 1;
        continue;
      }

      const tag = markup.slice(index, closeIndex + 1);
      if (tag.startsWith('</')) {
        if (consumedCharacters <= visibleCharacters) result += tag;
      } else if (consumedCharacters < visibleCharacters) {
        result += tag;
      }
      index = closeIndex + 1;
      continue;
    }

    const nextTagIndex = markup.indexOf('<', index);
    const textEnd = nextTagIndex === -1 ? markup.length : nextTagIndex;
    const text = markup.slice(index, textEnd);
    const remainingCharacters = visibleCharacters - consumedCharacters;
    if (remainingCharacters <= 0) break;

    if (text.length <= remainingCharacters) {
      result += text;
      consumedCharacters += text.length;
      index = textEnd;
      continue;
    }

    result += text.slice(0, remainingCharacters);
    break;
  }

  return result;
}

export interface IntroDialogueExclusion {
  left: number;
  top: number;
  width: number;
  height: number;
}

type IntroDialogueLayoutHandler = (bounds: IntroDialogueExclusion | null) => void;

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

  constructor(
    internalWidth: number,
    internalHeight: number,
    pages: readonly string[],
    private readonly onLayoutChange?: IntroDialogueLayoutHandler,
  ) {
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
        // Render at 16px (2x native) to prevent mobile GPU buffer exhaustion 
        // while remaining perfectly crisp when scaled down by 0.5
        fontSize: 16,
        fill: '#f7edd2',
        wordWrap: true,
        wordWrapWidth: (PANEL_WIDTH - PANEL_PADDING_X * 2 - BUTTON_SLOT_WIDTH) / TEXT_SCALE,
        lineHeight: 18,
        tagStyles: ROLE_TAG_STYLES,
        dropShadow: {
          alpha: 1,
          blur: 0,
          color: '#000000',
          distance: 2,
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
      getVisibleTextLength(this.getCurrentPage()),
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
    this.onLayoutChange?.(null);
  }

  destroy(): void {
    this.onLayoutChange?.(null);
    this.container.parent?.removeChild(this.container);
    this.container.destroy({ children: true });
  }

  private setPage(pageIndex: number): void {
    this.pageIndex = pageIndex;
    this.revealedChars = 0;
    this.resizeToCurrentPage();
    this.updateDisplayedText();
    this.onLayoutChange?.(this.getExclusionBounds());
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
        fontSize: 16,
        fill: '#ffffff',
        dropShadow: {
          alpha: 1,
          blur: 0,
          color: '#000000',
          distance: 2,
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
    this.messageText.text = getVisibleMarkupPrefix(currentPage, Math.floor(this.revealedChars));
  }

  private revealCurrentPage(): void {
    this.revealedChars = getVisibleTextLength(this.getCurrentPage());
    this.updateDisplayedText();
  }

  private getCurrentPage(): string {
    return this.pages[this.pageIndex] ?? '';
  }

  private getExclusionBounds(): IntroDialogueExclusion {
    return {
      left: this.container.x,
      top: this.container.y,
      width: PANEL_WIDTH + 2,
      height: this.panelHeight + 2,
    };
  }

  private isCurrentPageFullyRevealed(): boolean {
    return Math.floor(this.revealedChars) >= getVisibleTextLength(this.getCurrentPage());
  }
}
