import { Container, Sprite, Texture } from 'pixi.js';
import type { DecoratedVerticalPassagePlacement } from '@labyrinth/shared';
import {
  DECORATED_VERTICAL_PASSAGE_SPRITES,
  getDecoratedVerticalPassageAssetPath,
} from './DecoratedVerticalPassageLayout';

const AUTHORING_TILE_SIZE = 16;

/** Add the exact visual-only 6x12 passage repaint exported from the style editor. */
export function addDecoratedVerticalPassages(
  placements: readonly DecoratedVerticalPassagePlacement[],
  tileSize: number,
  textures: ReadonlyMap<string, Texture>,
  groundDetailParent: Container,
): void {
  const scale = tileSize / AUTHORING_TILE_SIZE;

  for (const placement of placements) {
    const ground = new Container();
    ground.sortableChildren = true;
    ground.x = placement.tileX * tileSize;
    ground.y = placement.tileY * tileSize;

    for (const spec of DECORATED_VERTICAL_PASSAGE_SPRITES) {
      const texture = textures.get(getDecoratedVerticalPassageAssetPath(spec.asset));
      if (!texture) continue;

      const sprite = new Sprite(texture);
      sprite.x = spec.x * scale;
      sprite.y = spec.y * scale;
      sprite.width = spec.w * scale;
      sprite.height = spec.h * scale;
      sprite.zIndex = spec.z;
      ground.addChild(sprite);
    }

    if (ground.children.length > 0) groundDetailParent.addChild(ground);
    else ground.destroy();
  }
}
