import { Container, Sprite, Texture } from 'pixi.js';
import {
  BRIDGE_WALKWAY_COLUMNS,
  BRIDGE_WALKWAY_ROWS,
  getBridgeTileBit,
  type BridgePlacement,
} from '@labyrinth/shared';
import {
  BRIDGE_OBSTACLE_SPRITES,
  BRIDGE_OBSTACLE_TERRAIN_SPRITES,
  getBridgeObstacleAssetPath,
  getBridgeWalkwayTileForSpec,
  type BridgeObstacleSpriteSpec,
} from './BridgeObstacleLayout';

const AUTHORING_TILE_SIZE = 16;
const BRIDGE_TILE_FALL_DURATION = 0.25;
const BRIDGE_TILE_FALL_STAGGER = 0.05;
const BRIDGE_TILE_FALL_DISTANCE = 8;

interface TrackedBridgeSprite {
  sprite: Sprite;
  originalY: number;
}

interface BridgeTileVisual {
  sprites: TrackedBridgeSprite[];
}

interface BridgeTileAnimation {
  tileIndex: number;
  delay: number;
  elapsed: number;
}

/** Mutable visual controller for one bridge's 12 central puzzle stones. */
export class BridgeObstacleVisual {
  private readonly tiles: BridgeTileVisual[] = Array.from(
    { length: BRIDGE_WALKWAY_ROWS * BRIDGE_WALKWAY_COLUMNS },
    () => ({ sprites: [] }),
  );
  private readonly animations = new Map<number, BridgeTileAnimation>();
  private collapsedTileMask = 0;

  constructor(private readonly scale: number) {}

  addSprite(row: number, column: number, sprite: Sprite): void {
    const tileIndex = row * BRIDGE_WALKWAY_COLUMNS + column;
    this.tiles[tileIndex]?.sprites.push({ sprite, originalY: sprite.y });
  }

  syncCollapsedTileMask(mask: number, animate: boolean): void {
    if (mask === this.collapsedTileMask) return;

    const restoredMask = this.collapsedTileMask & ~mask;
    for (let row = 0; row < BRIDGE_WALKWAY_ROWS; row++) {
      for (let column = 0; column < BRIDGE_WALKWAY_COLUMNS; column++) {
        const bit = getBridgeTileBit(row, column);
        if ((restoredMask & bit) !== 0) this.restoreTile(row, column);
      }
    }

    const newlyCollapsedMask = mask & ~this.collapsedTileMask;
    this.collapsedTileMask = mask;
    if (newlyCollapsedMask === 0) return;

    if (!animate) {
      for (let row = 0; row < BRIDGE_WALKWAY_ROWS; row++) {
        for (let column = 0; column < BRIDGE_WALKWAY_COLUMNS; column++) {
          if ((newlyCollapsedMask & getBridgeTileBit(row, column)) !== 0) {
            this.hideTile(row, column);
          }
        }
      }
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
      for (let column = 0; column < BRIDGE_WALKWAY_COLUMNS; column++) {
        if ((newlyCollapsedMask & getBridgeTileBit(row, column)) === 0) continue;
        const tileIndex = row * BRIDGE_WALKWAY_COLUMNS + column;
        const tile = this.tiles[tileIndex];
        for (const tracked of tile.sprites) {
          tracked.sprite.visible = true;
          tracked.sprite.alpha = 1;
          tracked.sprite.y = tracked.originalY;
        }
        this.animations.set(tileIndex, {
          tileIndex,
          delay: rowOrder * BRIDGE_TILE_FALL_STAGGER,
          elapsed: 0,
        });
      }
    }
  }

  update(dt: number): void {
    for (const [tileIndex, animation] of this.animations) {
      animation.elapsed += dt;
      const progress = Math.max(
        0,
        Math.min(1, (animation.elapsed - animation.delay) / BRIDGE_TILE_FALL_DURATION),
      );
      if (progress <= 0) continue;

      const easedProgress = progress * progress;
      for (const tracked of this.tiles[animation.tileIndex].sprites) {
        tracked.sprite.y =
          tracked.originalY +
          Math.round(BRIDGE_TILE_FALL_DISTANCE * this.scale * easedProgress);
        tracked.sprite.alpha = 1 - progress;
        if (progress >= 1) tracked.sprite.visible = false;
      }
      if (progress >= 1) this.animations.delete(tileIndex);
    }
  }

  private restoreTile(row: number, column: number): void {
    const tileIndex = row * BRIDGE_WALKWAY_COLUMNS + column;
    this.animations.delete(tileIndex);
    for (const tracked of this.tiles[tileIndex].sprites) {
      tracked.sprite.y = tracked.originalY;
      tracked.sprite.alpha = 1;
      tracked.sprite.visible = true;
    }
  }

  private hideTile(row: number, column: number): void {
    const tileIndex = row * BRIDGE_WALKWAY_COLUMNS + column;
    this.animations.delete(tileIndex);
    for (const tracked of this.tiles[tileIndex].sprites) {
      tracked.sprite.y = tracked.originalY;
      tracked.sprite.alpha = 0;
      tracked.sprite.visible = false;
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
  const detailSpecs = BRIDGE_OBSTACLE_SPRITES.filter((spec) => spec.z > 0).sort(
    (a, b) => a.z - b.z,
  );
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
        sprite.zIndex = spec.z;
        container.addChild(sprite);

        const walkwayTile = getBridgeWalkwayTileForSpec(spec);
        if (walkwayTile) {
          visual.addSprite(walkwayTile.row, walkwayTile.column, sprite);
        }
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
