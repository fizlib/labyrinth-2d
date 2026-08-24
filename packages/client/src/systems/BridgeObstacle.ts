import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import {
  BRIDGE_WALKWAY_COLUMNS,
  BRIDGE_WALKWAY_ROWS,
  BRIDGE_FAILURE_FEEDBACK_DURATION_MS,
  BRIDGE_TILE_RESTORE_DURATION_MS,
  getBridgeTileBit,
  getBridgeSafeTileOrder,
  type BridgeEntrySide,
  type BridgePlacement,
} from '@labyrinth/shared';
import {
  BRIDGE_COLLAPSE_DECORATION_SPRITES,
  BRIDGE_OBSTACLE_SPRITES,
  BRIDGE_OBSTACLE_TERRAIN_SPRITES,
  getBridgeObstacleAssetPath,
  getBridgeRepairCircleSideForSpec,
  getBridgeRowShadowLayout,
  getBridgeWalkwayTileForSpec,
  type BridgeCollapseDecorationSpriteSpec,
  type BridgeObstacleSpriteSpec,
} from './BridgeObstacleLayout';

const AUTHORING_TILE_SIZE = 16;
const BRIDGE_TILE_FALL_DURATION = 0.25;
const BRIDGE_TILE_RISE_DURATION = BRIDGE_TILE_RESTORE_DURATION_MS / 1000;
const BRIDGE_TILE_FALL_STAGGER = 0.05;
const BRIDGE_TILE_FALL_DISTANCE = 8;
const BRIDGE_COLLAPSE_FRONT_Z_INDEX = 0;
const BRIDGE_COLLAPSE_SHADOW_Z_INDEX = -1;
const BRIDGE_REPAIR_PARTICLE_COUNT = 6;
const BRIDGE_WISDOM_HINT_STEP_DURATION = 0.14;
const BRIDGE_WISDOM_HINT_SPARKLE_LIFETIME = 0.8;
const BRIDGE_WRONG_TILE_FEEDBACK_DURATION = BRIDGE_FAILURE_FEEDBACK_DURATION_MS / 1000;
const BRIDGE_WRONG_TILE_DIP_DISTANCE = 3;

interface TrackedBridgeSprite {
  sprite: Sprite;
  originalY: number;
}

interface TrackedBridgeShadow extends TrackedBridgeSprite {
  originalX: number;
  originalWidth: number;
}

interface BridgeTileVisual {
  sprites: TrackedBridgeSprite[];
  collapseFront: TrackedBridgeSprite | null;
  wisdomSparkle: Container | null;
}

interface BridgeRowVisual {
  collapseShadow: TrackedBridgeShadow | null;
}

interface BridgeWrongTileFeedback {
  tileIndex: number;
  elapsed: number;
}

interface BridgeTileAnimation {
  tileIndex: number;
  delay: number;
  elapsed: number;
  mode: 'fall' | 'rise';
}

interface BridgeRepairMagicVisual {
  circleSprite: Sprite;
  effect: Container;
  aura: Graphics;
  particles: Graphics[];
  elapsed: number;
}

interface BridgeWisdomHintVisual {
  tileIndices: number[];
  elapsed: number;
  currentStep: number;
  sparkleAges: Map<number, number>;
}

function isBridgeCollapseDecorationSpec(
  spec: BridgeObstacleSpriteSpec,
): spec is BridgeCollapseDecorationSpriteSpec {
  return 'collapseKind' in spec;
}

/** Mutable visual controller for one bridge's 12 central puzzle stones. */
export class BridgeObstacleVisual {
  private readonly tiles: BridgeTileVisual[] = Array.from(
    { length: BRIDGE_WALKWAY_ROWS * BRIDGE_WALKWAY_COLUMNS },
    () => ({ sprites: [], collapseFront: null, wisdomSparkle: null }),
  );
  private readonly rows: BridgeRowVisual[] = Array.from(
    { length: BRIDGE_WALKWAY_ROWS },
    () => ({ collapseShadow: null }),
  );
  private readonly animations = new Map<number, BridgeTileAnimation>();
  private readonly repairMagic = new Map<BridgeEntrySide, BridgeRepairMagicVisual>();
  private collapsedTileMask = 0;
  private repairingSide: BridgeEntrySide | null = null;
  private repairActive = false;
  private magicalTileMask = 0;
  private animationElapsed = 0;
  private syncedWrongTileIndex: number | null = null;
  private wrongTileFeedback: BridgeWrongTileFeedback | null = null;
  private wisdomHint: BridgeWisdomHintVisual | null = null;
  private wisdomHintSuppressed = false;

  constructor(private readonly scale: number) {}

  addCollapseDecoration(spec: BridgeCollapseDecorationSpriteSpec, sprite: Sprite): void {
    const tracked = { sprite, originalY: sprite.y };
    if (spec.collapseKind === 'shadow') {
      const row = this.rows[spec.row];
      if (row) {
        row.collapseShadow = {
          ...tracked,
          originalX: sprite.x,
          originalWidth: sprite.width,
        };
      }
      return;
    }

    sprite.visible = true;
    if (spec.column === undefined) return;
    const tileIndex = spec.row * BRIDGE_WALKWAY_COLUMNS + spec.column;
    const tile = this.tiles[tileIndex];
    if (tile) tile.collapseFront = tracked;
  }

  addSprite(row: number, column: number, sprite: Sprite): void {
    const tileIndex = row * BRIDGE_WALKWAY_COLUMNS + column;
    const tile = this.tiles[tileIndex];
    if (!tile) return;
    tile.sprites.push({ sprite, originalY: sprite.y });

    if (tile.wisdomSparkle || !sprite.parent) return;
    const sparkle = this.createWisdomSparkle();
    sparkle.x = sprite.x + sprite.width / 2;
    sparkle.y = sprite.y + sprite.height / 2;
    sparkle.zIndex = sprite.zIndex + 1_000;
    sprite.parent.addChild(sparkle);
    tile.wisdomSparkle = sparkle;
  }

  /** React once when the authoritative state identifies a newly failed stone. */
  syncWrongTileState(tileIndex: number | null): void {
    if (tileIndex === this.syncedWrongTileIndex) return;
    this.syncedWrongTileIndex = tileIndex;
    if (tileIndex === null || !this.tiles[tileIndex]) return;
    this.startWrongTileFeedback(tileIndex);
  }

  /** Begin a local-only, bank-to-bank reveal of the safe bridge route. */
  showWisdomHint(safeTileMask: number, entrySide: BridgeEntrySide): void {
    this.clearWisdomHint();
    const tileIndices = getBridgeSafeTileOrder(safeTileMask, entrySide).map(
      ({ row, column }) => row * BRIDGE_WALKWAY_COLUMNS + column,
    );
    if (tileIndices.length === 0) return;
    this.wisdomHint = {
      tileIndices,
      elapsed: 0,
      currentStep: -1,
      sparkleAges: new Map(),
    };
    this.updateWisdomHint(0);
  }

  addRepairCircle(side: BridgeEntrySide, circleSprite: Sprite, parent: Container): void {
    const effect = new Container();
    effect.x = circleSprite.x + circleSprite.width / 2;
    effect.y = circleSprite.y + circleSprite.height / 2;
    effect.zIndex = circleSprite.zIndex + 1;
    effect.visible = false;

    const aura = new Graphics()
      .circle(0, 0, 7 * this.scale)
      .stroke({ color: 0x72f1ff, alpha: 0.8, width: Math.max(1, this.scale) });
    effect.addChild(aura);

    const particles: Graphics[] = [];
    for (let index = 0; index < BRIDGE_REPAIR_PARTICLE_COUNT; index++) {
      const color = index % 2 === 0 ? 0x9ffcff : 0xffe88a;
      const particle = new Graphics()
        .rect(-this.scale, -this.scale, 2 * this.scale, 2 * this.scale)
        .fill({ color });
      particles.push(particle);
      effect.addChild(particle);
    }

    parent.addChild(effect);
    this.repairMagic.set(side, {
      circleSprite,
      effect,
      aura,
      particles,
      elapsed: 0,
    });
  }

  syncRepairState(
    side: BridgeEntrySide | null,
    active: boolean,
    initialCollapsedTileMask: number,
  ): void {
    const nextMagicalTileMask = side
      ? initialCollapsedTileMask & ~this.collapsedTileMask
      : 0;
    this.resetMagicalTiles(this.magicalTileMask & ~nextMagicalTileMask);
    this.magicalTileMask = nextMagicalTileMask;

    if (side === this.repairingSide && active === this.repairActive) return;
    this.deactivateRepairMagic();
    this.repairingSide = side;
    this.repairActive = active;
    this.syncWisdomHintSuppression();
    if (!side || !active) return;

    const magic = this.repairMagic.get(side);
    if (!magic) return;
    magic.elapsed = 0;
    magic.effect.visible = true;
  }

  syncCollapsedTileMask(mask: number, animate: boolean): void {
    if (mask === this.collapsedTileMask) return;

    const restoredMask = this.collapsedTileMask & ~mask;
    for (let row = 0; row < BRIDGE_WALKWAY_ROWS; row++) {
      for (let column = 0; column < BRIDGE_WALKWAY_COLUMNS; column++) {
        const bit = getBridgeTileBit(row, column);
        if ((restoredMask & bit) === 0) continue;
        if (animate) this.animateRestoreTile(row, column);
        else this.restoreTile(row, column);
      }
    }

    const newlyCollapsedMask = mask & ~this.collapsedTileMask;
    this.collapsedTileMask = mask;
    this.syncWisdomHintSuppression();
    if (newlyCollapsedMask === 0) {
      this.syncRowShadows();
      return;
    }

    if (!animate) {
      for (let row = 0; row < BRIDGE_WALKWAY_ROWS; row++) {
        for (let column = 0; column < BRIDGE_WALKWAY_COLUMNS; column++) {
          if ((newlyCollapsedMask & getBridgeTileBit(row, column)) !== 0) {
            this.hideTile(row, column);
          }
        }
      }
      this.syncRowShadows();
      return;
    }

    const collapsedRows = Array.from(
      { length: BRIDGE_WALKWAY_ROWS },
      (_, row) => row,
    ).filter((row) =>
      [0, 1].some((column) => (newlyCollapsedMask & getBridgeTileBit(row, column)) !== 0),
    );
    const northbound =
      collapsedRows.includes(0) && !collapsedRows.includes(BRIDGE_WALKWAY_ROWS - 1);
    collapsedRows.sort((a, b) => (northbound ? b - a : a - b));

    for (const [rowOrder, row] of collapsedRows.entries()) {
      this.hideCollapseShadow(row);
      for (let column = 0; column < BRIDGE_WALKWAY_COLUMNS; column++) {
        if ((newlyCollapsedMask & getBridgeTileBit(row, column)) === 0) continue;
        const tileIndex = row * BRIDGE_WALKWAY_COLUMNS + column;
        const tile = this.tiles[tileIndex];
        this.hideCollapseFront(tileIndex);
        for (const tracked of tile.sprites) {
          tracked.sprite.visible = true;
          tracked.sprite.alpha = 1;
          tracked.sprite.y = tracked.originalY;
        }
        this.animations.set(tileIndex, {
          tileIndex,
          delay: rowOrder * BRIDGE_TILE_FALL_STAGGER,
          elapsed: 0,
          mode: 'fall',
        });
      }
    }
    this.syncRowShadows();
  }

  update(dt: number): void {
    this.animationElapsed += dt;
    let animationCompleted = false;
    for (const [tileIndex, animation] of this.animations) {
      animation.elapsed += dt;
      const duration =
        animation.mode === 'fall' ? BRIDGE_TILE_FALL_DURATION : BRIDGE_TILE_RISE_DURATION;
      const progress = Math.max(
        0,
        Math.min(1, (animation.elapsed - animation.delay) / duration),
      );
      if (progress <= 0) continue;

      if (animation.mode === 'fall') {
        const easedProgress = progress * progress;
        const fallOffset = Math.round(
          BRIDGE_TILE_FALL_DISTANCE * this.scale * easedProgress,
        );
        const tile = this.tiles[animation.tileIndex];
        for (const tracked of tile.sprites) {
          tracked.sprite.y = tracked.originalY + fallOffset;
          tracked.sprite.alpha = 1 - progress;
          if (progress >= 1) tracked.sprite.visible = false;
        }
        if (tile.collapseFront) {
          tile.collapseFront.sprite.visible = progress < 1;
          tile.collapseFront.sprite.y = tile.collapseFront.originalY + fallOffset;
          tile.collapseFront.sprite.alpha = 1 - progress;
        }

        const column = animation.tileIndex % BRIDGE_WALKWAY_COLUMNS;
        if (column === 0) {
          const row = Math.floor(animation.tileIndex / BRIDGE_WALKWAY_COLUMNS);
          const shadow = this.rows[row]?.collapseShadow;
          if (shadow) {
            shadow.sprite.visible = progress < 1;
            shadow.sprite.y = shadow.originalY;
            shadow.sprite.alpha = 1 - progress;
          }
        }
      } else {
        const easedProgress = 1 - (1 - progress) * (1 - progress);
        const riseOffset = Math.round(
          BRIDGE_TILE_FALL_DISTANCE * this.scale * (1 - easedProgress),
        );
        const tile = this.tiles[animation.tileIndex];
        for (const tracked of tile.sprites) {
          tracked.sprite.y = tracked.originalY + riseOffset;
          tracked.sprite.alpha = progress;
          tracked.sprite.visible = true;
          if (progress >= 1) {
            tracked.sprite.y = tracked.originalY;
            tracked.sprite.alpha = 1;
          }
        }
        if (tile.collapseFront) {
          tile.collapseFront.sprite.y = tile.collapseFront.originalY + riseOffset;
          tile.collapseFront.sprite.alpha = progress;
          tile.collapseFront.sprite.visible = true;
          if (progress >= 1) {
            tile.collapseFront.sprite.y = tile.collapseFront.originalY;
            tile.collapseFront.sprite.alpha = 1;
          }
        }
      }
      if (progress >= 1) {
        this.animations.delete(tileIndex);
        animationCompleted = true;
      }
    }
    if (animationCompleted) this.syncRowShadows();

    this.updateRepairMagic(dt);
    this.updateMagicalTiles();
    this.updateWrongTileFeedback(dt);
    this.updateWisdomHint(dt);
  }

  private startWrongTileFeedback(tileIndex: number): void {
    this.resetWrongTileFeedback();
    const tile = this.tiles[tileIndex];
    if (!tile) return;

    this.animations.delete(tileIndex);
    this.wrongTileFeedback = { tileIndex, elapsed: 0 };
    for (const tracked of tile.sprites) {
      tracked.sprite.visible = true;
      tracked.sprite.alpha = 1;
      tracked.sprite.y = tracked.originalY;
      tracked.sprite.tint = 0xff683e;
    }
    if (tile.collapseFront) {
      tile.collapseFront.sprite.visible = true;
      tile.collapseFront.sprite.alpha = 1;
      tile.collapseFront.sprite.y = tile.collapseFront.originalY;
      tile.collapseFront.sprite.tint = 0xff683e;
    }
  }

  private updateWrongTileFeedback(dt: number): void {
    const feedback = this.wrongTileFeedback;
    if (!feedback) return;
    const tile = this.tiles[feedback.tileIndex];
    if (!tile) {
      this.wrongTileFeedback = null;
      return;
    }

    feedback.elapsed += dt;
    const progress = Math.min(1, feedback.elapsed / BRIDGE_WRONG_TILE_FEEDBACK_DURATION);
    const dip =
      Math.sin(progress * Math.PI) * BRIDGE_WRONG_TILE_DIP_DISTANCE * this.scale;
    const flash = Math.sin(progress * Math.PI * 4) >= 0 ? 0xff683e : 0xff9a45;
    for (const tracked of tile.sprites) {
      tracked.sprite.y = tracked.originalY + Math.round(dip);
      tracked.sprite.tint = flash;
    }
    if (tile.collapseFront) {
      tile.collapseFront.sprite.y = tile.collapseFront.originalY + Math.round(dip);
      tile.collapseFront.sprite.tint = flash;
    }

    if (progress >= 1) this.resetWrongTileFeedback();
  }

  private resetWrongTileFeedback(): void {
    const feedback = this.wrongTileFeedback;
    if (!feedback) return;
    const tile = this.tiles[feedback.tileIndex];
    for (const tracked of tile?.sprites ?? []) {
      tracked.sprite.y = tracked.originalY;
      tracked.sprite.tint = 0xffffff;
    }
    if (tile?.collapseFront) {
      tile.collapseFront.sprite.y = tile.collapseFront.originalY;
      tile.collapseFront.sprite.tint = 0xffffff;
    }
    this.wrongTileFeedback = null;
  }

  private createWisdomSparkle(): Container {
    const sparkle = new Container();
    sparkle.visible = false;

    const outer = new Graphics()
      .poly([
        0,
        -4.5 * this.scale,
        0.7 * this.scale,
        -0.7 * this.scale,
        4.5 * this.scale,
        0,
        0.7 * this.scale,
        0.7 * this.scale,
        0,
        4.5 * this.scale,
        -0.7 * this.scale,
        0.7 * this.scale,
        -4.5 * this.scale,
        0,
        -0.7 * this.scale,
        -0.7 * this.scale,
      ])
      .fill({ color: 0xffdd72, alpha: 0.65 });
    sparkle.addChild(outer);

    const core = new Graphics()
      .poly([
        0,
        -1.8 * this.scale,
        0.55 * this.scale,
        -0.55 * this.scale,
        1.8 * this.scale,
        0,
        0.55 * this.scale,
        0.55 * this.scale,
        0,
        1.8 * this.scale,
        -0.55 * this.scale,
        0.55 * this.scale,
        -1.8 * this.scale,
        0,
        -0.55 * this.scale,
        -0.55 * this.scale,
      ])
      .fill({ color: 0xfffbea, alpha: 0.9 });
    sparkle.addChild(core);
    return sparkle;
  }

  private updateWisdomHint(dt: number): void {
    const hint = this.wisdomHint;
    if (!hint || this.wisdomHintSuppressed) return;

    for (const [tileIndex, age] of hint.sparkleAges) {
      const nextAge = age + dt;
      if (nextAge >= BRIDGE_WISDOM_HINT_SPARKLE_LIFETIME) {
        hint.sparkleAges.delete(tileIndex);
        this.setWisdomHintTileActive(tileIndex, false);
      } else {
        hint.sparkleAges.set(tileIndex, nextAge);
        this.updateWisdomHintTile(tileIndex, nextAge);
      }
    }

    const cycleDuration = hint.tileIndices.length * BRIDGE_WISDOM_HINT_STEP_DURATION;
    hint.elapsed = (hint.elapsed + dt) % cycleDuration;

    const step = Math.floor(hint.elapsed / BRIDGE_WISDOM_HINT_STEP_DURATION);
    if (hint.currentStep !== step) {
      hint.currentStep = step;
      const tileIndex = hint.tileIndices[step];
      hint.sparkleAges.set(tileIndex, 0);
      this.setWisdomHintTileActive(tileIndex, true);
      this.updateWisdomHintTile(tileIndex, 0);
    }
  }

  private updateWisdomHintTile(tileIndex: number, age: number): void {
    const sparkle = this.tiles[tileIndex]?.wisdomSparkle;
    if (!sparkle) return;
    const lifetimeProgress = age / BRIDGE_WISDOM_HINT_SPARKLE_LIFETIME;
    const fadeIn = Math.min(1, age / 0.06);
    const fadeOut = Math.pow(Math.max(0, 1 - lifetimeProgress), 0.75);
    const strength = fadeIn * fadeOut;
    sparkle.alpha = 0.72 * strength;
    sparkle.rotation = this.animationElapsed * 1.4 + tileIndex * 0.12;
    const pulse = 0.78 + Math.sin(Math.min(1, age / 0.2) * Math.PI) * 0.12;
    sparkle.scale.set(pulse);

    const green = Math.round(255 - 14 * strength);
    const blue = Math.round(255 - 55 * strength);
    const tint = (0xff << 16) | (green << 8) | blue;
    for (const tracked of this.tiles[tileIndex].sprites) tracked.sprite.tint = tint;
    const front = this.tiles[tileIndex].collapseFront;
    if (front?.sprite.visible) front.sprite.tint = tint;
  }

  private setWisdomHintTileActive(tileIndex: number, active: boolean): void {
    const tile = this.tiles[tileIndex];
    if (!tile) return;
    if (tile.wisdomSparkle) {
      tile.wisdomSparkle.visible = active;
      tile.wisdomSparkle.alpha = active ? 1 : 0;
      if (!active) tile.wisdomSparkle.scale.set(1);
    }
    if (!active) {
      for (const tracked of tile.sprites) tracked.sprite.tint = 0xffffff;
      if (tile.collapseFront) tile.collapseFront.sprite.tint = 0xffffff;
    }
  }

  clearWisdomHint(): void {
    this.resetWisdomHintWave();
    this.wisdomHint = null;
  }

  private syncWisdomHintSuppression(): void {
    const suppressed = this.collapsedTileMask !== 0 || this.repairingSide !== null;
    if (suppressed === this.wisdomHintSuppressed) return;

    this.wisdomHintSuppressed = suppressed;
    this.resetWisdomHintWave();
    if (!suppressed) this.updateWisdomHint(0);
  }

  private resetWisdomHintWave(): void {
    const hint = this.wisdomHint;
    if (!hint) return;
    for (const tileIndex of hint.sparkleAges.keys()) {
      this.setWisdomHintTileActive(tileIndex, false);
    }
    hint.sparkleAges.clear();
    hint.elapsed = 0;
    hint.currentStep = -1;
  }

  private syncRowShadows(): void {
    for (let row = 0; row < this.rows.length; row++) {
      let rowIsFalling = false;
      for (let column = 0; column < BRIDGE_WALKWAY_COLUMNS; column++) {
        const animation = this.animations.get(row * BRIDGE_WALKWAY_COLUMNS + column);
        if (animation?.mode === 'fall') {
          rowIsFalling = true;
          break;
        }
      }
      if (rowIsFalling) continue;
      const shadow = this.rows[row].collapseShadow;
      if (!shadow) continue;
      const layout = getBridgeRowShadowLayout(this.collapsedTileMask, row);
      shadow.sprite.y = shadow.originalY;
      shadow.sprite.alpha = 1;
      if (!layout) {
        shadow.sprite.x = shadow.originalX;
        shadow.sprite.width = shadow.originalWidth;
        shadow.sprite.visible = false;
        continue;
      }
      shadow.sprite.x = layout.x * this.scale;
      shadow.sprite.width = layout.width * this.scale;
      shadow.sprite.visible = true;
    }
  }

  private hideCollapseFront(tileIndex: number): void {
    const front = this.tiles[tileIndex]?.collapseFront;
    if (!front) return;
    front.sprite.y = front.originalY;
    front.sprite.alpha = 1;
    front.sprite.tint = 0xffffff;
    front.sprite.visible = false;
  }

  private hideCollapseShadow(row: number): void {
    const shadow = this.rows[row]?.collapseShadow;
    if (!shadow) return;
    shadow.sprite.y = shadow.originalY;
    shadow.sprite.x = shadow.originalX;
    shadow.sprite.width = shadow.originalWidth;
    shadow.sprite.alpha = 1;
    shadow.sprite.visible = false;
  }

  private animateRestoreTile(row: number, column: number): void {
    const tileIndex = row * BRIDGE_WALKWAY_COLUMNS + column;
    this.animations.delete(tileIndex);
    for (const tracked of this.tiles[tileIndex].sprites) {
      tracked.sprite.y = tracked.originalY + BRIDGE_TILE_FALL_DISTANCE * this.scale;
      tracked.sprite.alpha = 0;
      tracked.sprite.visible = true;
    }
    const front = this.tiles[tileIndex].collapseFront;
    if (front) {
      front.sprite.y = front.originalY + BRIDGE_TILE_FALL_DISTANCE * this.scale;
      front.sprite.alpha = 0;
      front.sprite.tint = 0xffffff;
      front.sprite.visible = true;
    }
    this.animations.set(tileIndex, {
      tileIndex,
      delay: 0,
      elapsed: 0,
      mode: 'rise',
    });
  }

  private restoreTile(row: number, column: number): void {
    const tileIndex = row * BRIDGE_WALKWAY_COLUMNS + column;
    this.animations.delete(tileIndex);
    for (const tracked of this.tiles[tileIndex].sprites) {
      tracked.sprite.y = tracked.originalY;
      tracked.sprite.alpha = 1;
      tracked.sprite.visible = true;
    }
    const front = this.tiles[tileIndex].collapseFront;
    if (front) {
      front.sprite.y = front.originalY;
      front.sprite.alpha = 1;
      front.sprite.tint = 0xffffff;
      front.sprite.visible = true;
    }
  }

  private hideTile(row: number, column: number): void {
    const tileIndex = row * BRIDGE_WALKWAY_COLUMNS + column;
    this.animations.delete(tileIndex);
    this.hideCollapseFront(tileIndex);
    this.hideCollapseShadow(row);
    for (const tracked of this.tiles[tileIndex].sprites) {
      tracked.sprite.y = tracked.originalY;
      tracked.sprite.alpha = 0;
      tracked.sprite.visible = false;
    }
  }

  private deactivateRepairMagic(): void {
    for (const magic of this.repairMagic.values()) {
      magic.effect.visible = false;
      magic.circleSprite.alpha = 1;
      magic.circleSprite.tint = 0xffffff;
    }
  }

  private updateRepairMagic(dt: number): void {
    if (!this.repairingSide || !this.repairActive) return;
    const magic = this.repairMagic.get(this.repairingSide);
    if (!magic) return;

    magic.elapsed += dt;
    magic.effect.visible = true;
    magic.circleSprite.tint = 0xb9fbff;
    magic.circleSprite.alpha = 0.82 + Math.sin(magic.elapsed * 6) * 0.18;

    const auraPulse = 0.9 + Math.sin(magic.elapsed * 4) * 0.12;
    magic.aura.scale.set(auraPulse);
    magic.aura.alpha = 0.45 + Math.sin(magic.elapsed * 5) * 0.25;

    for (let index = 0; index < magic.particles.length; index++) {
      const particle = magic.particles[index];
      const angle = magic.elapsed * 2.8 + (index / magic.particles.length) * Math.PI * 2;
      const radius = (9 + Math.sin(magic.elapsed * 3 + index) * 2) * this.scale;
      particle.x = Math.round(Math.cos(angle) * radius);
      particle.y = Math.round(Math.sin(angle) * radius);
      particle.alpha = 0.45 + (Math.sin(magic.elapsed * 7 + index) + 1) * 0.25;
      const particlePulse = 0.7 + (Math.sin(magic.elapsed * 5 + index) + 1) * 0.2;
      particle.scale.set(particlePulse);
    }
  }

  private updateMagicalTiles(): void {
    for (let row = 0; row < BRIDGE_WALKWAY_ROWS; row++) {
      for (let column = 0; column < BRIDGE_WALKWAY_COLUMNS; column++) {
        const bit = getBridgeTileBit(row, column);
        if ((this.magicalTileMask & bit) === 0) continue;
        const tileIndex = row * BRIDGE_WALKWAY_COLUMNS + column;
        if (this.animations.has(tileIndex)) continue;
        const hoverOffset = Math.round(
          Math.sin(this.animationElapsed * 4 + tileIndex * 0.35) * 1.5 * this.scale,
        );
        for (const tracked of this.tiles[tileIndex].sprites) {
          tracked.sprite.y = tracked.originalY + hoverOffset;
          tracked.sprite.tint = 0xffffff;
          tracked.sprite.alpha = 1;
        }
        const front = this.tiles[tileIndex].collapseFront;
        if (front?.sprite.visible) {
          front.sprite.y = front.originalY + hoverOffset;
          front.sprite.tint = 0xffffff;
          front.sprite.alpha = 1;
        }
      }
    }
  }

  private resetMagicalTiles(mask: number): void {
    for (let row = 0; row < BRIDGE_WALKWAY_ROWS; row++) {
      for (let column = 0; column < BRIDGE_WALKWAY_COLUMNS; column++) {
        const bit = getBridgeTileBit(row, column);
        if ((mask & bit) === 0) continue;
        const tileIndex = row * BRIDGE_WALKWAY_COLUMNS + column;
        for (const tracked of this.tiles[tileIndex].sprites) {
          if (!this.animations.has(tileIndex)) tracked.sprite.y = tracked.originalY;
          tracked.sprite.tint = 0xffffff;
          if (!this.animations.has(tileIndex)) tracked.sprite.alpha = 1;
        }
        const front = this.tiles[tileIndex].collapseFront;
        if (front && !this.animations.has(tileIndex)) {
          front.sprite.y = front.originalY;
          front.sprite.tint = 0xffffff;
          front.sprite.alpha = 1;
        }
      }
    }
  }
}

/** Add bridge prefabs and return stateful controllers for their walkway stones. */
export function addBridgeObstacles(
  bridges: readonly BridgePlacement[],
  tileSize: number,
  textures: ReadonlyMap<string, Texture>,
  terrainParent: Container,
  detailParent: Container,
): BridgeObstacleVisual[] {
  const scale = tileSize / AUTHORING_TILE_SIZE;
  const terrainSpecs = [
    ...BRIDGE_OBSTACLE_SPRITES.filter((spec) => spec.z === 0),
    ...BRIDGE_OBSTACLE_TERRAIN_SPRITES,
  ].sort((a, b) => a.z - b.z);
  const detailSpecs: readonly BridgeObstacleSpriteSpec[] = [
    ...BRIDGE_OBSTACLE_SPRITES.filter((spec) => spec.z > 0),
    ...BRIDGE_COLLAPSE_DECORATION_SPRITES,
  ].sort((a, b) => a.z - b.z);
  const visuals: BridgeObstacleVisual[] = [];

  for (const bridge of bridges) {
    const anchorX = bridge.tileX * tileSize;
    const anchorY = bridge.tileY * tileSize;
    const visual = new BridgeObstacleVisual(scale);
    visuals.push(visual);

    const addSpecs = (
      specs: readonly BridgeObstacleSpriteSpec[],
      parent: Container,
      zIndex: number,
    ): void => {
      const container = new Container();
      container.sortableChildren = true;
      container.x = anchorX;
      container.y = anchorY;
      container.zIndex = zIndex;

      for (const spec of specs) {
        const texture = textures.get(getBridgeObstacleAssetPath(spec.asset));
        if (!texture) continue;

        const sprite = new Sprite(texture);
        sprite.x = spec.x * scale;
        sprite.y = spec.y * scale;
        sprite.width = spec.w * scale;
        sprite.height = spec.h * scale;
        sprite.zIndex = isBridgeCollapseDecorationSpec(spec)
          ? spec.collapseKind === 'front'
            ? BRIDGE_COLLAPSE_FRONT_Z_INDEX
            : BRIDGE_COLLAPSE_SHADOW_Z_INDEX
          : spec.z;
        container.addChild(sprite);

        if (isBridgeCollapseDecorationSpec(spec)) {
          visual.addCollapseDecoration(spec, sprite);
          continue;
        }

        const walkwayTile = getBridgeWalkwayTileForSpec(spec);
        if (walkwayTile) {
          visual.addSprite(walkwayTile.row, walkwayTile.column, sprite);
        }
        const repairSide = getBridgeRepairCircleSideForSpec(spec);
        if (repairSide) visual.addRepairCircle(repairSide, sprite, container);
      }

      parent.addChild(container);
    };

    // The water repaint belongs above the ordinary floor but below solid
    // forest ground (including asset 997) and the authored corner modules.
    addSpecs(terrainSpecs, terrainParent, -1);
    addSpecs(detailSpecs, detailParent, anchorY + 10 * tileSize);
  }

  return visuals;
}
