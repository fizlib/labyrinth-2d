import { Container, Rectangle, Renderer, Sprite, Texture } from 'pixi.js';
import {
  CENTRAL_HUB_AUTHORING_TILE_SIZE,
  getCentralHubRunestonePlacements,
  getHubTileBounds,
  type TileMapData,
} from '@labyrinth/shared';
import {
  CENTRAL_HUB_ASSET_PATHS,
  CENTRAL_HUB_SPRITE_SPECS,
  CENTRAL_HUB_VISUAL_BOUNDS,
  CENTRAL_HUB_Y_SORTED_SPRITE_SPECS,
  type CentralHubSpriteSpec,
} from './CentralHubLayout.generated';

export type CentralHubEntranceDirection = 'north' | 'east' | 'south' | 'west';

export interface CentralHubRenderOptions {
  /** Omit authored approach paths where the surrounding maze keeps an entrance closed. */
  openEntrances?: readonly CentralHubEntranceDirection[];
}

export interface CentralHubRunestoneSprite {
  sprite: Sprite;
  index: number;
  tileX: number;
  tileY: number;
  activated: boolean;
}

export interface CentralHubRenderResult {
  runestones: CentralHubRunestoneSprite[];
  ySortedSprites: Sprite[];
}

function getExteriorApproachDirection(
  spec: CentralHubSpriteSpec,
  hubAuthoringSize: number,
): CentralHubEntranceDirection | null {
  const [, x, y, width, height, zIndex] = spec;

  // The editor-authored stone approach tiles use the 500/501 ground-detail
  // layers. Lower layers outside the hub are surrounding grass decorations.
  if (zIndex < 500) return null;
  if (x < 0) return 'west';
  if (x + width > hubAuthoringSize) return 'east';
  if (y < 0) return 'north';
  if (y + height > hubAuthoringSize) return 'south';
  return null;
}

/** Bake the exact editor-authored hub repaint and create its moved objectives. */
export function addCentralHub(
  map: TileMapData,
  textures: ReadonlyMap<string, Texture>,
  runestoneTextures: readonly [Texture, Texture][],
  renderer: Renderer,
  groundDetailParent: Container,
  options: CentralHubRenderOptions = {},
): CentralHubRenderResult {
  const runestonePlacements = getCentralHubRunestonePlacements(map);
  if (runestonePlacements.length === 0) {
    return { runestones: [], ySortedSprites: [] };
  }
  const scale = map.tileSize / CENTRAL_HUB_AUTHORING_TILE_SIZE;
  const hubBounds = getHubTileBounds(map.width, map.height);
  const hubX = hubBounds.left * map.tileSize;
  const hubY = hubBounds.top * map.tileSize;
  const hubAuthoringSize =
    (hubBounds.right - hubBounds.left + 1) * CENTRAL_HUB_AUTHORING_TILE_SIZE;
  const openEntrances = options.openEntrances
    ? new Set(options.openEntrances)
    : null;
  const source = new Container();
  source.sortableChildren = true;

  for (const spec of CENTRAL_HUB_SPRITE_SPECS) {
    const approachDirection = getExteriorApproachDirection(spec, hubAuthoringSize);
    if (
      approachDirection !== null &&
      openEntrances !== null &&
      !openEntrances.has(approachDirection)
    ) {
      continue;
    }
    const [assetIndex, x, y, width, height, zIndex, flipX] = spec;
    const texture = textures.get(CENTRAL_HUB_ASSET_PATHS[assetIndex]);
    if (!texture) continue;
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5);
    sprite.x = (x + width / 2) * scale;
    sprite.y = (y + height / 2) * scale;
    sprite.width = width * scale;
    sprite.height = height * scale;
    sprite.scale.x = Math.abs(sprite.scale.x) * (flipX ? -1 : 1);
    sprite.zIndex = zIndex;
    source.addChild(sprite);
  }

  if (source.children.length > 0) {
    source.sortChildren();
    const frame = new Rectangle(
      CENTRAL_HUB_VISUAL_BOUNDS.minX * scale,
      CENTRAL_HUB_VISUAL_BOUNDS.minY * scale,
      (CENTRAL_HUB_VISUAL_BOUNDS.maxX - CENTRAL_HUB_VISUAL_BOUNDS.minX) * scale,
      (CENTRAL_HUB_VISUAL_BOUNDS.maxY - CENTRAL_HUB_VISUAL_BOUNDS.minY) * scale,
    );
    const texture = renderer.generateTexture({
      target: source,
      frame,
      resolution: 1,
      antialias: false,
    });
    texture.source.style.scaleMode = 'nearest';
    texture.source.style.update();
    const sprite = new Sprite(texture);
    sprite.x = hubX + frame.x;
    sprite.y = hubY + frame.y;
    sprite.zIndex = 500;
    groundDetailParent.addChild(sprite);
  }
  source.destroy({ children: true });

  const ySortedSprites = CENTRAL_HUB_Y_SORTED_SPRITE_SPECS.flatMap(
    ([assetIndex, x, y, width, height, , flipX, sortY]) => {
      const texture = textures.get(CENTRAL_HUB_ASSET_PATHS[assetIndex]);
      if (!texture) return [];
      const sprite = new Sprite(texture);
      sprite.anchor.set(0.5);
      sprite.x = hubX + (x + width / 2) * scale;
      sprite.y = hubY + (y + height / 2) * scale;
      sprite.width = width * scale;
      sprite.height = height * scale;
      sprite.scale.x = Math.abs(sprite.scale.x) * (flipX ? -1 : 1);
      sprite.zIndex = Math.round(hubY + sortY * scale);
      return [sprite];
    },
  );

  const runestones = runestonePlacements.flatMap((placement) => {
    const texture = runestoneTextures[placement.index]?.[0];
    if (!texture) return [];
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5, 1.0);
    sprite.x = placement.x + placement.width / 2;
    sprite.y = placement.y + placement.height;
    sprite.width = placement.width;
    sprite.height = placement.height;
    sprite.zIndex = placement.y + placement.height;
    return [
      {
        sprite,
        index: placement.index,
        tileX: placement.tileX,
        tileY: placement.tileY,
        activated: false,
      },
    ];
  });

  return { runestones, ySortedSprites };
}
