import { Container, Sprite, Texture } from 'pixi.js';
import {
  PORTAL_PLATFORM_BASE_Z_OFFSET,
  PORTAL_PLATFORM_GROUND_DETAIL_SPRITES,
  PORTAL_PLATFORM_GROUND_SPRITES,
  PORTAL_PLATFORM_STRUCTURE_SPRITES,
  getPortalPlatformAssetPath,
  type PortalPlatformSpriteSpec,
} from './PortalPlatformLayout';

/**
 * The editable portal clearing and raised stone platform exported from the
 * style editor. Coordinates in the layout are relative to the portal center.
 */
export class PortalPlatform {
  private readonly sprites: Sprite[] = [];

  constructor(
    x: number,
    y: number,
    textures: ReadonlyMap<string, Texture>,
    groundParent: Container,
    groundDetailParent: Container,
    entityParent: Container,
  ) {
    for (const spec of PORTAL_PLATFORM_GROUND_SPRITES) {
      this.addSprite(spec, x, y, textures, groundParent, y + spec.y + spec.h);
    }

    for (const spec of PORTAL_PLATFORM_GROUND_DETAIL_SPRITES) {
      this.addSprite(spec, x, y, textures, groundDetailParent, y + spec.y + spec.h);
    }

    for (const spec of PORTAL_PLATFORM_STRUCTURE_SPRITES) {
      this.addSprite(
        spec,
        x,
        y,
        textures,
        entityParent,
        Math.round(y) + PORTAL_PLATFORM_BASE_Z_OFFSET + (spec.z ?? 0),
      );
    }
  }

  private addSprite(
    spec: PortalPlatformSpriteSpec,
    x: number,
    y: number,
    textures: ReadonlyMap<string, Texture>,
    parent: Container,
    zIndex: number,
  ): void {
    const texture = textures.get(getPortalPlatformAssetPath(spec.asset));
    if (!texture) return;

    const sprite = new Sprite(texture);
    sprite.x = x + spec.x;
    sprite.y = y + spec.y;
    sprite.width = spec.w;
    sprite.height = spec.h;
    sprite.zIndex = zIndex;
    parent.addChild(sprite);
    this.sprites.push(sprite);
  }

  destroy(): void {
    for (const sprite of this.sprites) {
      sprite.parent?.removeChild(sprite);
      sprite.destroy();
    }
    this.sprites.length = 0;
  }
}
