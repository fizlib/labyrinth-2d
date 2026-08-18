import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import {
  getSwampFirmGroundTiles,
  type SwampPlacement,
} from '@labyrinth/shared';
import {
  getSwampObstacleDetailSprites,
  getSwampObstacleTerrainSprites,
  getSwampObstacleAssetPath,
  type SwampObstacleSpriteSpec,
} from './SwampObstacleLayout';

const AUTHORING_TILE_SIZE = 16;
const FOREGROUND_Z_INDEX = 500;
const WISDOM_WAVE_STEP_DURATION = 0.14;
const WISDOM_WAVE_SPAN = 5;

interface SwampFirmGroundVisualTile {
  graphic: Graphics;
  pathIndex: number;
}

type SwampFirmGroundReveal = 'hidden' | 'wisdom' | 'warden';

/** Persistent local reveal of one swamp's otherwise hidden firm-ground route. */
export class SwampObstacleVisual {
  private readonly tiles: SwampFirmGroundVisualTile[] = [];
  private readonly container: Container;
  private reveal: SwampFirmGroundReveal = 'hidden';
  private elapsed = 0;

  constructor(swamp: SwampPlacement, tileSize: number, parent: Container) {
    const scale = tileSize / AUTHORING_TILE_SIZE;
    this.container = new Container();
    this.container.x = swamp.tileX * tileSize;
    this.container.y = swamp.tileY * tileSize;
    this.container.zIndex = -1;
    this.container.visible = false;

    for (const tile of getSwampFirmGroundTiles(swamp)) {
      // Terrain extends south for player classification, but the revealed path
      // keeps the original square tile footprint.
      const visualSize = (AUTHORING_TILE_SIZE - 2) * scale;
      const graphic = new Graphics()
        .rect(
          (tile.x + 1) * scale,
          (tile.y + 1) * scale,
          visualSize,
          visualSize,
        )
        .fill({ color: 0xffd85c, alpha: 0.12 })
        .rect(
          (tile.x + 1) * scale,
          (tile.y + 1) * scale,
          visualSize,
          visualSize,
        )
        .stroke({ color: 0xffdd72, alpha: 0.68, width: Math.max(1, scale) });
      graphic.alpha = 0;
      this.container.addChild(graphic);
      this.tiles.push({ graphic, pathIndex: tile.pathIndex });
    }

    parent.addChild(this.container);
  }

  showWisdomHint(): void {
    this.reveal = 'wisdom';
    this.elapsed = 0;
    this.syncVisibility();
  }

  setWardenVisible(visible: boolean): void {
    this.reveal = visible ? 'warden' : 'hidden';
    this.elapsed = 0;
    this.syncVisibility();
  }

  update(dt: number): void {
    if (this.reveal === 'hidden' || this.tiles.length === 0) return;
    this.elapsed += dt;

    if (this.reveal === 'warden') {
      const alpha = 0.44 + Math.sin(this.elapsed * 2.2) * 0.035;
      for (const tile of this.tiles) tile.graphic.alpha = alpha;
      return;
    }

    const pathSpan = this.tiles.length;
    const wavePosition = (this.elapsed / WISDOM_WAVE_STEP_DURATION) % pathSpan;
    for (const tile of this.tiles) {
      const directDistance = Math.abs(tile.pathIndex - wavePosition);
      const wrappedDistance = pathSpan - directDistance;
      const distance = Math.min(directDistance, wrappedDistance);
      const waveStrength = Math.max(0, 1 - distance / WISDOM_WAVE_SPAN);
      tile.graphic.alpha = 0.36 + waveStrength * 0.44;
    }
  }

  private syncVisibility(): void {
    this.container.visible = this.reveal !== 'hidden';
    const baseAlpha = this.reveal === 'warden' ? 0.44 : 0.36;
    for (const tile of this.tiles) tile.graphic.alpha = baseAlpha;
  }
}

export interface SwampObstacleRenderResult {
  foregroundSprites: Sprite[];
  visuals: SwampObstacleVisual[];
}

/** Add authored swamp passages and return vegetation that must Y-sort with players. */
export function addSwampObstacles(
  swamps: readonly SwampPlacement[],
  tileSize: number,
  textures: ReadonlyMap<string, Texture>,
  terrainParent: Container,
  groundDetailParent: Container,
): SwampObstacleRenderResult {
  const scale = tileSize / AUTHORING_TILE_SIZE;
  const foregroundSprites: Sprite[] = [];
  const visuals: SwampObstacleVisual[] = [];

  const addGroundSpecs = (
    swamp: SwampPlacement,
    specs: readonly SwampObstacleSpriteSpec[],
    parent: Container,
    zIndex: number,
  ): void => {
    const container = new Container();
    container.sortableChildren = true;
    container.x = swamp.tileX * tileSize;
    container.y = swamp.tileY * tileSize;
    container.zIndex = zIndex;

    for (const spec of specs) {
      const texture = textures.get(getSwampObstacleAssetPath(spec.asset));
      if (!texture) continue;
      const sprite = new Sprite(texture);
      sprite.x = spec.x * scale;
      sprite.y = spec.y * scale;
      sprite.width = spec.w * scale;
      sprite.height = spec.h * scale;
      sprite.zIndex = spec.z;
      container.addChild(sprite);
    }

    parent.addChild(container);
  };

  for (const swamp of swamps) {
    const anchorX = swamp.tileX * tileSize;
    const anchorY = swamp.tileY * tileSize;
    const detailSpecs = getSwampObstacleDetailSprites(swamp);
    const groundSpecs = detailSpecs.filter((spec) => spec.z < FOREGROUND_Z_INDEX);
    const foregroundSpecs = detailSpecs.filter((spec) => spec.z >= FOREGROUND_Z_INDEX);
    addGroundSpecs(swamp, getSwampObstacleTerrainSprites(swamp), terrainParent, -1);
    visuals.push(new SwampObstacleVisual(swamp, tileSize, groundDetailParent));
    addGroundSpecs(swamp, groundSpecs, groundDetailParent, 0);

    for (const spec of foregroundSpecs) {
      const texture = textures.get(getSwampObstacleAssetPath(spec.asset));
      if (!texture) continue;
      const sprite = new Sprite(texture);
      sprite.x = anchorX + spec.x * scale;
      sprite.y = anchorY + spec.y * scale;
      sprite.width = spec.w * scale;
      sprite.height = spec.h * scale;
      sprite.zIndex = Math.round(anchorY + (spec.y + spec.h) * scale);
      foregroundSprites.push(sprite);
    }
  }

  return { foregroundSprites, visuals };
}
