import { Container, Sprite, Texture } from 'pixi.js';
import type { BridgePlacement } from '@labyrinth/shared';
import {
  BRIDGE_OBSTACLE_SPRITES,
  BRIDGE_OBSTACLE_TERRAIN_SPRITES,
  getBridgeObstacleAssetPath,
} from './BridgeObstacleLayout';

const AUTHORING_TILE_SIZE = 16;

/** Add the style-editor bridge prefab to its terrain and ground-detail layers. */
export function addBridgeObstacles(
  bridges: readonly BridgePlacement[],
  tileSize: number,
  textures: ReadonlyMap<string, Texture>,
  terrainParent: Container,
  detailParent: Container,
): void {
  const scale = tileSize / AUTHORING_TILE_SIZE;
  const terrainSpecs = [
    ...BRIDGE_OBSTACLE_SPRITES.filter((spec) => spec.z === 0),
    ...BRIDGE_OBSTACLE_TERRAIN_SPRITES,
  ].sort((a, b) => a.z - b.z);
  const detailSpecs = BRIDGE_OBSTACLE_SPRITES.filter((spec) => spec.z > 0)
    .sort((a, b) => a.z - b.z);

  for (const bridge of bridges) {
    const anchorX = bridge.tileX * tileSize;
    const anchorY = bridge.tileY * tileSize;

    const addSpecs = (
      specs: typeof terrainSpecs,
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
      }

      parent.addChild(container);
    };

    // The water repaint belongs above the ordinary floor but below solid
    // forest ground (including asset 997) and the authored corner modules.
    addSpecs(terrainSpecs, terrainParent, -1);
    addSpecs(detailSpecs, detailParent, anchorY + 10 * tileSize);
  }
}
