import { Container, Sprite, Texture } from 'pixi.js';
import type { SwampPlacement } from '@labyrinth/shared';
import {
  getSwampObstacleDetailSprites,
  getSwampObstacleTerrainSprites,
  getSwampObstacleAssetPath,
  type SwampObstacleSpriteSpec,
} from './SwampObstacleLayout';

const AUTHORING_TILE_SIZE = 16;
const FOREGROUND_Z_INDEX = 500;

/** Add authored swamp passages and return vegetation that must Y-sort with players. */
export function addSwampObstacles(
  swamps: readonly SwampPlacement[],
  tileSize: number,
  textures: ReadonlyMap<string, Texture>,
  terrainParent: Container,
  groundDetailParent: Container,
): Sprite[] {
  const scale = tileSize / AUTHORING_TILE_SIZE;
  const foregroundSprites: Sprite[] = [];

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

  return foregroundSprites;
}
