import { Container, Sprite, Texture } from 'pixi.js';
import {
  SPIKE_GATE_AUTHORING_TILE_SIZE,
  SPIKE_GATE_COLORS,
  SPIKE_GATE_HORIZONTAL_TERRAIN_COLUMNS,
  SPIKE_GATE_HORIZONTAL_TERRAIN_ROWS,
  SPIKE_GATE_VERTICAL_TERRAIN_COLUMNS,
  SPIKE_GATE_VERTICAL_TERRAIN_ROWS,
  getSpikeGateBarrierOffset,
  getSpikeGatePlatePlacements,
  getSpikeGateStateIndex,
  type SpikeGateObstaclePlacement,
  type SpikeGateState,
  type SpikePlateState,
} from '@labyrinth/shared';
import {
  SPIKE_GATE_CLOSED_FRAME,
  SPIKE_GATE_BASIC_GRASS_ASSET,
  SPIKE_GATE_PLATE_ACTIVATED_PATH,
  SPIKE_GATE_PLATE_DEACTIVATED_PATH,
  SPIKE_GATE_HORIZONTAL_POST_SPRITES,
  SPIKE_GATE_HORIZONTAL_TERRAIN_SPRITES,
  SPIKE_GATE_VERTICAL_POST_SPRITES,
  SPIKE_GATE_VERTICAL_TERRAIN_SPRITES,
  SPIKE_GATE_TRANSITION_FRAMES,
  getSpikeGatePillarAssetPath,
  getSpikeGateTerrainAssetPath,
  type SpikeGatePostSpriteSpec,
} from './SpikeGateLayout';

const FRAME_DURATION = 0.085;

interface AnimatedGate {
  sprites: Sprite[];
  postSpecs: readonly SpikeGatePostSpriteSpec[];
  color: (typeof SPIKE_GATE_COLORS)[number];
  currentFrame: number;
  queuedFrames: number[];
  elapsed: number;
  targetOpen: boolean;
}

interface TrackedPlate {
  sprite: Sprite;
  spikePlateIndex: number;
  pressed: boolean;
}

/** Animation and plate controller for one two- or three-gate obstacle chain. */
export class SpikeGateObstacleVisual {
  readonly entities: Container[] = [];

  private readonly gates: AnimatedGate[] = [];
  private readonly plates: TrackedPlate[] = [];
  private readonly scale: number;

  constructor(
    readonly index: number,
    placement: SpikeGateObstaclePlacement,
    tileSize: number,
    private readonly textures: ReadonlyMap<string, Texture>,
  ) {
    this.scale = tileSize / SPIKE_GATE_AUTHORING_TILE_SIZE;
    const anchorX = placement.tileX * tileSize;
    const anchorY = placement.tileY * tileSize;
    const horizontal = placement.orientation === 'horizontal';
    const postSpecs = horizontal
      ? SPIKE_GATE_HORIZONTAL_POST_SPRITES
      : SPIKE_GATE_VERTICAL_POST_SPRITES;

    for (let gateIndex = 0; gateIndex < placement.gateCount; gateIndex++) {
      const color = SPIKE_GATE_COLORS[gateIndex];
      const offset = getSpikeGateBarrierOffset(placement, gateIndex);
      const gateAnchorX = anchorX + (horizontal ? offset : 0) * this.scale;
      const gateAnchorY = anchorY + (horizontal ? 0 : offset) * this.scale;
      const sprites: Sprite[] = [];
      const texture = textures.get(
        getSpikeGatePillarAssetPath(color, SPIKE_GATE_CLOSED_FRAME),
      );
      if (texture) {
        for (const spec of postSpecs) {
          const sprite = new Sprite(texture);
          sprite.x = gateAnchorX + spec.x * this.scale;
          sprite.y = gateAnchorY + spec.y * this.scale;
          sprite.width = spec.w * this.scale;
          sprite.height = spec.h * this.scale;
          // Match central-hub pillars: switch depth at this pillar's ground contact.
          sprite.zIndex = Math.round(
            gateAnchorY + (spec.y + spec.h - 1) * this.scale,
          );
          sprites.push(sprite);
          this.entities.push(sprite);
        }
      }
      this.gates.push({
        sprites,
        postSpecs,
        color,
        currentFrame: SPIKE_GATE_CLOSED_FRAME,
        queuedFrames: [],
        elapsed: 0,
        targetOpen: false,
      });
    }

    const deactivatedTexture = textures.get(SPIKE_GATE_PLATE_DEACTIVATED_PATH);
    if (deactivatedTexture) {
      for (const plate of getSpikeGatePlatePlacements(placement, index, tileSize)) {
        const sprite = new Sprite(deactivatedTexture);
        sprite.x = plate.x;
        sprite.y = plate.y;
        sprite.width = plate.width;
        sprite.height = plate.height;
        sprite.zIndex = Math.round(plate.y);
        this.plates.push({
          sprite,
          spikePlateIndex: plate.spikePlateIndex,
          pressed: false,
        });
        this.entities.push(sprite);
      }
    }
  }

  syncStates(
    gateStates: readonly SpikeGateState[],
    plateStates: readonly SpikePlateState[],
    animate: boolean,
  ): void {
    for (let gateIndex = 0; gateIndex < this.gates.length; gateIndex++) {
      const spikeGateIndex = getSpikeGateStateIndex(this.index, gateIndex);
      const open =
        gateStates.find((state) => state.spikeGateIndex === spikeGateIndex)?.open ??
        false;
      this.syncGate(this.gates[gateIndex], open, animate);
    }

    const activatedTexture = this.textures.get(SPIKE_GATE_PLATE_ACTIVATED_PATH);
    const deactivatedTexture = this.textures.get(SPIKE_GATE_PLATE_DEACTIVATED_PATH);
    for (const plate of this.plates) {
      const pressed =
        plateStates.find((state) => state.spikePlateIndex === plate.spikePlateIndex)
          ?.pressed ?? false;
      if (pressed === plate.pressed) continue;
      plate.pressed = pressed;
      const texture = pressed ? activatedTexture : deactivatedTexture;
      if (texture) plate.sprite.texture = texture;
    }
  }

  update(dt: number): void {
    for (const gate of this.gates) {
      if (gate.queuedFrames.length === 0) continue;
      gate.elapsed += dt;
      while (gate.elapsed >= FRAME_DURATION && gate.queuedFrames.length > 0) {
        gate.elapsed -= FRAME_DURATION;
        this.applyGateFrame(gate, gate.queuedFrames.shift()!);
      }
    }
  }

  private syncGate(gate: AnimatedGate, open: boolean, animate: boolean): void {
    if (gate.targetOpen === open) return;
    gate.targetOpen = open;
    gate.elapsed = 0;
    if (!animate) {
      gate.queuedFrames.length = 0;
      this.applyGateFrame(
        gate,
        open
          ? SPIKE_GATE_TRANSITION_FRAMES[SPIKE_GATE_TRANSITION_FRAMES.length - 1]
          : SPIKE_GATE_CLOSED_FRAME,
      );
      return;
    }

    const sequence = [
      SPIKE_GATE_CLOSED_FRAME,
      ...SPIKE_GATE_TRANSITION_FRAMES,
    ];
    const currentIndex = Math.max(0, sequence.indexOf(gate.currentFrame));
    gate.queuedFrames = open
      ? sequence.slice(currentIndex + 1)
      : sequence.slice(0, currentIndex).reverse();
  }

  private applyGateFrame(gate: AnimatedGate, frame: number): void {
    const texture = this.textures.get(getSpikeGatePillarAssetPath(gate.color, frame));
    if (!texture) return;
    gate.currentFrame = frame;
    for (let index = 0; index < gate.sprites.length; index++) {
      const sprite = gate.sprites[index];
      const spec = gate.postSpecs[index];
      sprite.texture = texture;
      sprite.width = spec.w * this.scale;
      sprite.height = spec.h * this.scale;
    }
  }
}

export interface SpikeGateRenderResult {
  entities: Container[];
  visuals: SpikeGateObstacleVisual[];
}

function addSpikeGateTerrain(
  placement: SpikeGateObstaclePlacement,
  tileSize: number,
  textures: ReadonlyMap<string, Texture>,
  terrainParent: Container,
): void {
  const scale = tileSize / SPIKE_GATE_AUTHORING_TILE_SIZE;
  const terrain = new Container();
  terrain.x = placement.tileX * tileSize;
  terrain.y = placement.tileY * tileSize;
  terrain.zIndex = -1;

  const addTile = (asset: number, x: number, y: number): void => {
    const texture = textures.get(getSpikeGateTerrainAssetPath(asset));
    if (!texture) return;
    const sprite = new Sprite(texture);
    sprite.x = x * scale;
    sprite.y = y * scale;
    sprite.width = SPIKE_GATE_AUTHORING_TILE_SIZE * scale;
    sprite.height = SPIKE_GATE_AUTHORING_TILE_SIZE * scale;
    terrain.addChild(sprite);
  };

  const horizontal = placement.orientation === 'horizontal';
  const terrainSprites = horizontal
    ? SPIKE_GATE_HORIZONTAL_TERRAIN_SPRITES
    : SPIKE_GATE_VERTICAL_TERRAIN_SPRITES;
  const terrainColumns = horizontal
    ? SPIKE_GATE_HORIZONTAL_TERRAIN_COLUMNS
    : SPIKE_GATE_VERTICAL_TERRAIN_COLUMNS;
  const terrainRows = horizontal
    ? SPIKE_GATE_HORIZONTAL_TERRAIN_ROWS
    : SPIKE_GATE_VERTICAL_TERRAIN_ROWS;

  for (let gateIndex = 0; gateIndex < placement.gateCount; gateIndex++) {
    const gateOffset = getSpikeGateBarrierOffset(placement, gateIndex);
    for (const spec of terrainSprites) {
      addTile(
        spec.asset,
        spec.x + (horizontal ? gateOffset : 0),
        spec.y + (horizontal ? 0 : gateOffset),
      );
    }

    if (horizontal && gateIndex < placement.gateCount - 1) {
      const grassX =
        gateOffset + terrainColumns * SPIKE_GATE_AUTHORING_TILE_SIZE;
      for (let row = 0; row < terrainRows; row++) {
        addTile(
          SPIKE_GATE_BASIC_GRASS_ASSET,
          grassX,
          row * SPIKE_GATE_AUTHORING_TILE_SIZE,
        );
      }
    }
  }

  if (!horizontal) {
    // Red/blue have their gap below red; the third (yellow) barrier is above
    // red, so its gap is the row immediately above the authored red stamp.
    const grassRows = placement.gateCount === 3 ? [-16, 48] : [48];
    for (const grassY of grassRows) {
      for (let column = 0; column < terrainColumns; column++) {
        addTile(
          SPIKE_GATE_BASIC_GRASS_ASSET,
          column * SPIKE_GATE_AUTHORING_TILE_SIZE,
          grassY,
        );
      }
    }
  }

  terrainParent.addChild(terrain);
}

export function addSpikeGateObstacles(
  placements: readonly SpikeGateObstaclePlacement[],
  tileSize: number,
  textures: ReadonlyMap<string, Texture>,
  terrainParent: Container,
): SpikeGateRenderResult {
  const entities: Container[] = [];
  const visuals = placements.map((placement, index) => {
    addSpikeGateTerrain(placement, tileSize, textures, terrainParent);
    const visual = new SpikeGateObstacleVisual(index, placement, tileSize, textures);
    entities.push(...visual.entities);
    return visual;
  });
  return { entities, visuals };
}
