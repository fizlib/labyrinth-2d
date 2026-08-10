import { Container, Sprite, Texture } from 'pixi.js';
import type { ChestDeadEndPlacement } from '@labyrinth/shared';
import { CHEST_DEAD_END_SPRITES, getChestDeadEndAssetPath } from './ChestDeadEndLayout';

const AUTHORING_TILE_SIZE = 16;

/** Build the authored treasure prefabs as entities so players sort around them. */
export function addChestDeadEnds(
  placements: readonly ChestDeadEndPlacement[],
  tileSize: number,
  textures: ReadonlyMap<string, Texture>,
  terrainParent: Container,
): Container[] {
  const scale = tileSize / AUTHORING_TILE_SIZE;
  const entities: Container[] = [];

  for (const placement of placements) {
    const anchorX = placement.tileX * tileSize;
    const anchorY = placement.tileY * tileSize;
    const terrain = new Container();
    terrain.sortableChildren = true;
    terrain.x = anchorX;
    terrain.y = anchorY;
    terrain.zIndex = -1;
    const backdrop = new Container();
    backdrop.sortableChildren = true;
    backdrop.x = anchorX;
    backdrop.y = anchorY;
    backdrop.zIndex = Math.round(anchorY + 16 * scale);

    for (const spec of CHEST_DEAD_END_SPRITES) {
      const texture = textures.get(getChestDeadEndAssetPath(spec.asset));
      if (!texture) continue;

      const sprite = new Sprite(texture);
      sprite.width = spec.w * scale;
      sprite.height = spec.h * scale;

      if (spec.layer === 'terrain') {
        sprite.x = spec.x * scale;
        sprite.y = spec.y * scale;
        sprite.zIndex = spec.z;
        terrain.addChild(sprite);
        continue;
      }

      if (spec.layer === 'backdrop') {
        sprite.x = spec.x * scale;
        sprite.y = spec.y * scale;
        sprite.zIndex = spec.z;
        backdrop.addChild(sprite);
        continue;
      }

      sprite.x = anchorX + spec.x * scale;
      sprite.y = anchorY + spec.y * scale;
      sprite.zIndex = Math.round(anchorY + (spec.y + spec.h) * scale);
      entities.push(sprite);
    }

    if (terrain.children.length > 0) terrainParent.addChild(terrain);
    else terrain.destroy();
    if (backdrop.children.length > 0) entities.push(backdrop);
    else backdrop.destroy();
  }

  return entities;
}
