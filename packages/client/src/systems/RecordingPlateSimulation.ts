import {
  FEET_HITBOX_H,
  FEET_HITBOX_W,
  SPIKE_GATES_PER_OBSTACLE,
  TILE_SIZE,
  getSpikeGatePlatePlacements,
} from '@labyrinth/shared';
import type {
  GameState,
  GateState,
  GeneratedMazeLayout,
  PressurePlateState,
  SpikeGateState,
  SpikePlateState,
} from '@labyrinth/shared';
import type { RecordingActorRenderState } from './RecordingStudio';

export interface RecordingWorldState {
  gateStates: GateState[];
  pressurePlateStates: PressurePlateState[];
  spikeGateStates: SpikeGateState[];
  spikePlateStates: SpikePlateState[];
}

export type RecordingWorldAudioEvent =
  | {
      kind: 'pressure-plate';
      plateId: number;
      state: 'pressed' | 'released' | 'latched';
    }
  | {
      kind: 'spike-plate';
      spikePlateIndex: number;
      state: 'pressed' | 'released' | 'latched';
    }
  | { kind: 'gate'; gateIndex: number; open: boolean }
  | { kind: 'spike-gate'; spikeGateIndex: number; open: boolean };

/** Return audible mechanism changes caused between two local recording frames. */
export function getRecordingWorldAudioEvents(
  previous: RecordingWorldState,
  next: RecordingWorldState,
): RecordingWorldAudioEvent[] {
  const events: RecordingWorldAudioEvent[] = [];

  for (const plate of next.pressurePlateStates) {
    const before = previous.pressurePlateStates.find(
      (candidate) => candidate.plateId === plate.plateId,
    );
    if (!before) continue;
    if (plate.latched && !before.latched) {
      events.push({ kind: 'pressure-plate', plateId: plate.plateId, state: 'latched' });
    } else if (plate.pressed !== before.pressed) {
      events.push({
        kind: 'pressure-plate',
        plateId: plate.plateId,
        state: plate.pressed ? 'pressed' : 'released',
      });
    }
  }

  for (const plate of next.spikePlateStates) {
    const before = previous.spikePlateStates.find(
      (candidate) => candidate.spikePlateIndex === plate.spikePlateIndex,
    );
    if (!before) continue;
    if (plate.latched && !before.latched) {
      events.push({
        kind: 'spike-plate',
        spikePlateIndex: plate.spikePlateIndex,
        state: 'latched',
      });
    } else if (plate.pressed !== before.pressed) {
      events.push({
        kind: 'spike-plate',
        spikePlateIndex: plate.spikePlateIndex,
        state: plate.pressed ? 'pressed' : 'released',
      });
    }
  }

  for (const gate of next.gateStates) {
    const before = previous.gateStates.find(
      (candidate) => candidate.gateIndex === gate.gateIndex,
    );
    if (before && gate.open !== before.open) {
      events.push({ kind: 'gate', gateIndex: gate.gateIndex, open: gate.open });
    }
  }

  for (const gate of next.spikeGateStates) {
    const before = previous.spikeGateStates.find(
      (candidate) => candidate.spikeGateIndex === gate.spikeGateIndex,
    );
    if (before && gate.open !== before.open) {
      events.push({
        kind: 'spike-gate',
        spikeGateIndex: gate.spikeGateIndex,
        open: gate.open,
      });
    }
  }

  return events;
}

function recordingActorOverlapsBounds(
  actor: Pick<RecordingActorRenderState, 'x' | 'y'>,
  bounds: { left: number; top: number; right: number; bottom: number },
): boolean {
  const playerLeft = actor.x - FEET_HITBOX_W / 2;
  const playerTop = actor.y - FEET_HITBOX_H;
  const playerRight = playerLeft + FEET_HITBOX_W - 1;
  const playerBottom = actor.y - 1;
  return (
    playerLeft <= bounds.right &&
    playerRight >= bounds.left &&
    playerTop <= bounds.bottom &&
    playerBottom >= bounds.top
  );
}

/** Merge local recording actors into the visual pressure-plate simulation. */
export function deriveRecordingWorldState(
  layout: GeneratedMazeLayout,
  gameState: GameState,
  actors: readonly RecordingActorRenderState[],
): RecordingWorldState {
  const occupiedStandardPlates = new Map<number, Set<string>>();
  for (const plate of layout.pressurePlates) {
    const bounds = {
      left: plate.tileX * TILE_SIZE,
      top: plate.tileY * TILE_SIZE,
      right: (plate.tileX + 1) * TILE_SIZE - 1,
      bottom: (plate.tileY + 1) * TILE_SIZE - 1,
    };
    const occupants = new Set(
      actors
        .filter((actor) => recordingActorOverlapsBounds(actor, bounds))
        .map((actor) => actor.actorId),
    );
    if (occupants.size > 0) occupiedStandardPlates.set(plate.id, occupants);
  }

  const pressurePlateStates = gameState.pressurePlateStates.map((state) => ({
    ...state,
    pressed: state.pressed || occupiedStandardPlates.has(state.plateId),
  }));
  const gateStates = layout.gates.map((_, gateIndex) => {
    const baseOpen =
      gameState.gateStates.find((state) => state.gateIndex === gateIndex)?.open ?? false;
    const gatePlates = layout.pressurePlates.filter(
      (plate) => plate.gateIndex === gateIndex,
    );
    const hubActivated = gatePlates
      .filter((plate) => plate.side === 'hub')
      .some((plate) => occupiedStandardPlates.has(plate.id));
    const spawnActors = new Set<string>();
    for (const plate of gatePlates) {
      if (plate.side !== 'spawn') continue;
      for (const actorId of occupiedStandardPlates.get(plate.id) ?? []) {
        spawnActors.add(actorId);
      }
    }
    return {
      gateIndex,
      open: baseOpen || hubActivated || spawnActors.size >= 2,
    };
  });

  const occupiedSpikePlates = new Set<number>();
  const spikePlatePlacements = layout.spikeGateObstacles.flatMap(
    (placement, obstacleIndex) =>
      getSpikeGatePlatePlacements(placement, obstacleIndex, TILE_SIZE),
  );
  for (const plate of spikePlatePlacements) {
    const bounds = {
      left: plate.x,
      top: plate.y,
      right: plate.x + plate.width - 1,
      bottom: plate.y + plate.height - 1,
    };
    if (actors.some((actor) => recordingActorOverlapsBounds(actor, bounds))) {
      occupiedSpikePlates.add(plate.spikePlateIndex);
    }
  }

  const spikePlateStates = gameState.spikePlateStates.map((state) => ({
    ...state,
    pressed: state.pressed || occupiedSpikePlates.has(state.spikePlateIndex),
  }));
  const spikeGateStates = gameState.spikeGateStates.map((state) => {
    const obstacleIndex = Math.floor(state.spikeGateIndex / SPIKE_GATES_PER_OBSTACLE);
    const gateIndex = state.spikeGateIndex % SPIKE_GATES_PER_OBSTACLE;
    const fakeActivated = spikePlatePlacements.some(
      (plate) =>
        plate.obstacleIndex === obstacleIndex &&
        plate.gateIndex === gateIndex &&
        occupiedSpikePlates.has(plate.spikePlateIndex),
    );
    return { ...state, open: state.open || fakeActivated };
  });

  return {
    gateStates,
    pressurePlateStates,
    spikeGateStates,
    spikePlateStates,
  };
}
