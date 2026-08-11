import { Container, Sprite, Texture } from 'pixi.js';
import type { TIntersectionDecorationPlacement } from '@labyrinth/shared';
import {
  T_INTERSECTION_DECORATION_SPRITES,
  getTIntersectionDecorationAssetPath,
} from './TIntersectionDecorationLayout';
import { SOUTH_CLOSED_T_INTERSECTION_DECORATION_SPRITES } from './TIntersectionDecorationSouthLayout';

const AUTHORING_TILE_SIZE = 16;

/** Render the authored ruins and return props that must Y-sort with players. */
export function addTIntersectionDecorations(
  placements: readonly TIntersectionDecorationPlacement[],
  tileSize: number,
  textures: ReadonlyMap<string, Texture>,
  groundDetailParent: Container,
): Container[] {
  const scale = tileSize / AUTHORING_TILE_SIZE;
  const entities: Container[] = [];

  for (const placement of placements) {
    const spriteSpecs =
      placement.closedDirection === 'south'
        ? SOUTH_CLOSED_T_INTERSECTION_DECORATION_SPRITES
        : T_INTERSECTION_DECORATION_SPRITES;
    const anchorX = placement.tileX * tileSize;
    const anchorY = placement.tileY * tileSize;
    const ground = new Container();
    ground.sortableChildren = true;
    ground.x = anchorX;
    ground.y = anchorY;
    ground.zIndex = 0;
    const entityGroups = new Map<string, Container>();

    for (const spec of spriteSpecs) {
      const texture = textures.get(getTIntersectionDecorationAssetPath(spec.asset));
      if (!texture) continue;

      const sprite = new Sprite(texture);
      sprite.x = spec.x * scale;
      sprite.y = spec.y * scale;
      sprite.width = spec.w * scale;
      sprite.height = spec.h * scale;
      sprite.zIndex = spec.z;

      if (spec.layer === 'ground') {
        ground.addChild(sprite);
        continue;
      }

      if (spec.entityGroup) {
        let group = entityGroups.get(spec.entityGroup);
        if (!group) {
          group = new Container();
          group.sortableChildren = true;
          group.x = anchorX;
          group.y = anchorY;
          group.zIndex = Math.round(anchorY + 32 * scale);
          entityGroups.set(spec.entityGroup, group);
          entities.push(group);
        }
        group.addChild(sprite);
        continue;
      }

      sprite.x += anchorX;
      sprite.y += anchorY;
      sprite.zIndex = Math.round(anchorY + (spec.y + spec.h) * scale);
      entities.push(sprite);
    }

    if (ground.children.length > 0) groundDetailParent.addChild(ground);
    else ground.destroy();
  }

  return entities;
}
