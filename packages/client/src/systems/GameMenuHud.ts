import { Container, Graphics, Text, TextStyle } from 'pixi.js';

// Match the crisp in-world interaction prompt: render the pixel font large,
// then reduce it to its native size on whole-pixel coordinates.
const TEXT_RENDER_SCALE = 8;
const PANEL_WIDTH = 224;
const PANEL_HEIGHT = 206;
const DIVIDER_Y = 45;
const BUTTON_WIDTH = 132;
const BUTTON_HEIGHT = 25;
const MAIN_BUTTON_X = (PANEL_WIDTH - BUTTON_WIDTH) / 2;

type MenuPage = 'main' | 'controls' | 'exit-confirmation';

export interface GameMenuActions {
  onVisibilityChange: (visible: boolean) => void;
  onOpenAdminPanel: () => void;
  onExitMatch: () => void;
}

/** Local-only multiplayer menu styled to match the end-of-match panel. */
export class GameMenuHud {
  private readonly container = new Container();
  private readonly title: Text;
  private readonly mainPage = new Container();
  private readonly controlsPage = new Container();
  private readonly exitConfirmationPage = new Container();
  private readonly adminButton: Container;
  private readonly controlsButton: Container;
  private readonly exitButton: Container;
  private available = false;
  private adminAvailable = false;
  private page: MenuPage = 'main';

  constructor(
    internalWidth: number,
    internalHeight: number,
    private readonly actions: GameMenuActions,
  ) {
    this.container.eventMode = 'static';
    this.container.zIndex = 110_000;

    const scrim = new Graphics();
    scrim.rect(0, 0, internalWidth, internalHeight);
    scrim.fill({ color: 0x05070a, alpha: 0.72 });
    this.container.addChild(scrim);

    const panel = new Container();
    panel.x = Math.round((internalWidth - PANEL_WIDTH) / 2);
    panel.y = Math.round((internalHeight - PANEL_HEIGHT) / 2);
    this.container.addChild(panel);

    panel.addChild(this.createPanelBackground());

    this.title = this.createText('Game menu', 16, '#fff5cf');
    this.title.anchor.set(0.5);
    this.title.x = PANEL_WIDTH / 2;
    this.title.y = 25;
    panel.addChild(this.title, this.createDivider());

    const mainPageButtons = this.buildMainPage();
    this.adminButton = mainPageButtons.admin;
    this.controlsButton = mainPageButtons.controls;
    this.exitButton = mainPageButtons.exit;
    this.layoutMainPage();
    this.buildControlsPage();
    this.buildExitConfirmationPage();
    panel.addChild(this.mainPage, this.controlsPage, this.exitConfirmationPage);

    this.container.visible = false;
    this.showPage('main');
  }

  addToStage(stage: Container): void {
    stage.addChild(this.container);
  }

  setAvailable(available: boolean): void {
    this.available = available;
    if (!available) this.close();
  }

  setAdminAvailable(available: boolean): void {
    this.adminAvailable = available;
    this.layoutMainPage();
  }

  isOpen(): boolean {
    return this.container.visible;
  }

  open(): void {
    if (!this.available || this.container.visible) return;
    this.showPage('main');
    this.container.visible = true;
    this.actions.onVisibilityChange(true);
  }

  close(): void {
    if (!this.container.visible) return;
    this.container.visible = false;
    this.showPage('main');
    this.actions.onVisibilityChange(false);
  }

  toggle(): void {
    if (this.container.visible) this.close();
    else this.open();
  }

  /** Escape backs out of a sub-page before closing the menu itself. */
  handleEscape(): void {
    if (!this.container.visible) {
      this.open();
      return;
    }
    if (this.page !== 'main') {
      this.showPage('main');
      return;
    }
    this.close();
  }

  destroy(): void {
    this.container.parent?.removeChild(this.container);
    this.container.destroy({ children: true });
  }

  private buildMainPage(): {
    admin: Container;
    controls: Container;
    exit: Container;
  } {
    const resumeButton = this.createButton('Resume game', MAIN_BUTTON_X, 58, () =>
      this.close(),
    );
    const adminButton = this.createButton(
      'Admin panel',
      MAIN_BUTTON_X,
      87,
      this.actions.onOpenAdminPanel,
    );
    const controlsButton = this.createButton('Controls', MAIN_BUTTON_X, 92, () =>
      this.showPage('controls'),
    );
    const exitButton = this.createButton('Exit match', MAIN_BUTTON_X, 126, () =>
      this.showPage('exit-confirmation'),
    );
    this.mainPage.addChild(
      resumeButton,
      adminButton,
      controlsButton,
      exitButton,
    );

    const hint = this.createText('[Esc] Resume', 8, '#b8c1bd');
    hint.anchor.set(0.5);
    hint.x = PANEL_WIDTH / 2;
    hint.y = PANEL_HEIGHT - 15;
    this.mainPage.addChild(hint);
    return { admin: adminButton, controls: controlsButton, exit: exitButton };
  }

  private layoutMainPage(): void {
    this.adminButton.visible = this.adminAvailable;
    this.controlsButton.y = this.adminAvailable ? 116 : 92;
    this.exitButton.y = this.adminAvailable ? 145 : 126;
  }

  private buildControlsPage(): void {
    const controls = [
      ['Move', 'WASD / Arrows'],
      ['Interact', 'E'],
      ['Wisdom orb', 'Q'],
      ['Chat', 'Enter / T'],
      ['Game menu', 'Esc'],
    ] as const;

    controls.forEach(([label, binding], index) => {
      const y = 55 + index * 17;
      const labelText = this.createText(label, 8, '#d6cfbd');
      labelText.x = 24;
      labelText.y = y;
      const bindingText = this.createText(binding, 8, '#fff5cf');
      bindingText.anchor.set(1, 0);
      bindingText.x = PANEL_WIDTH - 24;
      bindingText.y = y;
      this.controlsPage.addChild(labelText, bindingText);
    });

    this.controlsPage.addChild(
      this.createButton('Back', MAIN_BUTTON_X, 145, () => this.showPage('main')),
    );
  }

  private buildExitConfirmationPage(): void {
    const message = this.createText(
      'You will not be able to reconnect.',
      8,
      '#d6cfbd',
      TEXT_RENDER_SCALE,
      11,
      'center',
      PANEL_WIDTH - 48,
    );
    message.anchor.set(0.5, 0);
    message.x = PANEL_WIDTH / 2;
    message.y = 58;
    this.exitConfirmationPage.addChild(
      message,
      this.createButton('Stay', 18, 162, () => this.showPage('main'), 90),
      this.createButton('Exit match', 116, 162, this.actions.onExitMatch, 90, true),
    );
  }

  private showPage(page: MenuPage): void {
    this.page = page;
    this.title.text = page === 'controls' ? 'Controls' : page === 'exit-confirmation' ? 'Exit match?' : 'Game menu';
    this.mainPage.visible = page === 'main';
    this.controlsPage.visible = page === 'controls';
    this.exitConfirmationPage.visible = page === 'exit-confirmation';
  }

  private createPanelBackground(): Graphics {
    const background = new Graphics();
    background.rect(3, 3, PANEL_WIDTH, PANEL_HEIGHT);
    background.fill({ color: 0x000000, alpha: 0.7 });
    background.rect(0, 0, PANEL_WIDTH, PANEL_HEIGHT);
    background.fill({ color: 0x5c341d });
    background.rect(2, 2, PANEL_WIDTH - 4, PANEL_HEIGHT - 4);
    background.fill({ color: 0xb16d39 });
    background.rect(4, 4, PANEL_WIDTH - 8, PANEL_HEIGHT - 8);
    background.fill({ color: 0x111a20, alpha: 0.98 });
    background.rect(6, 6, PANEL_WIDTH - 12, PANEL_HEIGHT - 12);
    background.stroke({ color: 0x313d40, width: 1, alignment: 0 });
    return background;
  }

  private createDivider(): Container {
    const dividerContainer = new Container();
    const divider = new Graphics();
    divider.moveTo(15, DIVIDER_Y);
    divider.lineTo(PANEL_WIDTH - 15, DIVIDER_Y);
    divider.stroke({ color: 0x66533c, alpha: 0.85, width: 1 });
    divider.rect(13, DIVIDER_Y - 1, 3, 3);
    divider.fill({ color: 0x8a704e });
    divider.rect(PANEL_WIDTH - 16, DIVIDER_Y - 1, 3, 3);
    divider.fill({ color: 0x8a704e });

    const diamond = new Graphics();
    diamond.rect(-3, -3, 6, 6);
    diamond.fill({ color: 0x172229 });
    diamond.stroke({ color: 0x80694a, width: 1, alignment: 0 });
    diamond.x = PANEL_WIDTH / 2;
    diamond.y = DIVIDER_Y;
    diamond.rotation = Math.PI / 4;
    dividerContainer.addChild(divider, diamond);
    return dividerContainer;
  }

  private createButton(
    label: string,
    x: number,
    y: number,
    onPress: () => void,
    width = BUTTON_WIDTH,
    dangerous = false,
  ): Container {
    const button = new Container();
    button.x = x;
    button.y = y;
    button.eventMode = 'static';
    button.cursor = 'pointer';

    const background = new Graphics();
    const drawBackground = (hovered: boolean): void => {
      background.clear();
      background.rect(2, 2, width, BUTTON_HEIGHT);
      background.fill({ color: 0x000000, alpha: 0.65 });
      background.rect(0, 0, width, BUTTON_HEIGHT);
      background.fill({
        color: dangerous
          ? hovered ? 0xef715c : 0xa44c42
          : hovered ? 0xd0b16e : 0x907a55,
      });
      background.rect(2, 2, width - 4, BUTTON_HEIGHT - 4);
      background.fill({ color: hovered ? 0x263640 : 0x1b2830 });
    };
    drawBackground(false);
    button.addChild(background);

    const text = this.createText(label, 8, '#fff5cf');
    text.anchor.set(0.5);
    text.x = Math.round(width / 2);
    text.y = Math.round(BUTTON_HEIGHT / 2) + 1;
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
    align: 'left' | 'center' | 'right' = 'left',
    maxWidth?: number,
  ): Text {
    const label = new Text({
      text,
      style: new TextStyle({
        fontFamily: 'PixelOperator8',
        fontSize: fontSize * renderScale,
        fill,
        align,
        lineHeight: lineHeight ? lineHeight * renderScale : undefined,
        wordWrap: maxWidth !== undefined,
        wordWrapWidth: maxWidth ? maxWidth * renderScale : undefined,
        breakWords: maxWidth !== undefined,
        dropShadow: {
          alpha: 1,
          blur: 0,
          color: '#000000',
          // One final canvas pixel keeps the font legible without smudging it.
          distance: renderScale,
          angle: Math.PI / 4,
        },
      }),
      roundPixels: true,
      resolution: 2,
    });
    label.scale.set(1 / renderScale);
    return label;
  }
}
