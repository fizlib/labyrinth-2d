import {
  BRIDGE_FAILURE_FEEDBACK_DURATION_MS,
  BRIDGE_REPAIR_DURATION_MS,
  BRIDGE_WALKWAY_COLUMNS,
  BRIDGE_WALKWAY_ROWS,
  FEET_HITBOX_H,
  FEET_HITBOX_W,
  getBridgeBankReturnPosition,
  getBridgeCollapseMask,
  getBridgeRepairCircleBounds,
  getBridgeRepairCollapsedMask,
  getBridgeSafeRowFeetCenter,
  getBridgeTileBit,
  getBridgeWalkwayTileAtPoint,
  getBridgeWalkwayTileBounds,
  getBridgeWalkwayTileMaskAtFeetCenter,
} from '@labyrinth/shared';
import type { BridgeEntrySide, BridgePlacement, BridgeState } from '@labyrinth/shared';

export interface RecordingBridgeActorPose {
  actorId: string;
  x: number;
  y: number;
}

export interface RecordingBridgeActorPositionOverride {
  actorId: string;
  x: number;
  y: number;
}

export interface RecordingBridgeSimulationResult {
  bridgeStates: BridgeState[];
  actorPositionOverrides: RecordingBridgeActorPositionOverride[];
}

interface RecordingBridgeTraversal {
  bridgeIndex: number;
  entrySide: BridgeEntrySide;
  lastTileMask: number;
  completed: boolean;
}

interface RecordingBridgeRepair {
  activeElapsedMs: number;
  initialCollapsedTileMask: number;
  orderSide: BridgeEntrySide;
  channelSide: BridgeEntrySide;
  repairingActorId: string | null;
}

const MAX_SIMULATION_STEP_SECONDS = 1 / 30;
const TIME_EPSILON = 0.000_001;

function createDefaultBridgeState(bridgeIndex: number): BridgeState {
  return {
    bridgeIndex,
    collapsedTileMask: 0,
    wrongTileIndex: null,
    repairingSide: null,
    repairActive: false,
    repairingPlayerId: null,
    repairStartedTick: null,
    repairInitialCollapsedTileMask: 0,
  };
}

function cloneBridgeState(state: BridgeState): BridgeState {
  return { ...state };
}

function getBaseStateSignature(states: readonly BridgeState[]): string {
  return states
    .map(
      (state) =>
        `${state.bridgeIndex}:${state.collapsedTileMask}:${state.wrongTileIndex ?? '-'}:${state.repairingSide ?? '-'}:${Number(state.repairActive)}:${state.repairingPlayerId ?? '-'}:${state.repairStartedTick ?? '-'}:${state.repairInitialCollapsedTileMask}`,
    )
    .join('|');
}

function getFeetCenter(actor: RecordingBridgeActorPose): { x: number; y: number } {
  return { x: actor.x, y: actor.y - FEET_HITBOX_H / 2 };
}

/**
 * Stateful, timeline-driven copy of the authoritative bridge interaction rules
 * for admin recording actors. The simulation is intentionally local: it drives
 * recording visuals and collision without mutating the server room.
 */
export class RecordingBridgeSimulation {
  private bridgeStates: BridgeState[] = [];
  private readonly traversals = new Map<string, RecordingBridgeTraversal>();
  private readonly previousActorPositions = new Map<string, RecordingBridgeActorPose>();
  private readonly repairOccupancy = new Map<string, string>();
  private readonly repairs = new Map<number, RecordingBridgeRepair>();
  private readonly feedbackExpirations = new Map<number, number>();
  private framePositionOverrides = new Map<
    string,
    RecordingBridgeActorPositionOverride
  >();
  private baseStateSignature = '';
  private timelineTime = 0;
  private initialized = false;

  reset(): void {
    this.bridgeStates = [];
    this.traversals.clear();
    this.previousActorPositions.clear();
    this.repairOccupancy.clear();
    this.repairs.clear();
    this.feedbackExpirations.clear();
    this.framePositionOverrides.clear();
    this.baseStateSignature = '';
    this.timelineTime = 0;
    this.initialized = false;
  }

  update(
    bridges: readonly BridgePlacement[],
    tileSize: number,
    baseBridgeStates: readonly BridgeState[],
    actors: readonly RecordingBridgeActorPose[],
    timelineTime: number,
    sampleActorsAtTime?: (time: number) => readonly RecordingBridgeActorPose[],
  ): RecordingBridgeSimulationResult {
    const targetTime = Math.max(0, timelineTime);
    const signature = getBaseStateSignature(baseBridgeStates);
    const needsRebuild =
      !this.initialized ||
      signature !== this.baseStateSignature ||
      targetTime + TIME_EPSILON < this.timelineTime;

    if (needsRebuild) {
      this.initialize(bridges, baseBridgeStates, signature);
      const initialActors = sampleActorsAtTime?.(0) ?? (targetTime === 0 ? actors : []);
      this.processFrame(bridges, tileSize, initialActors, 0);
    }

    let cursor = this.timelineTime;
    while (cursor + MAX_SIMULATION_STEP_SECONDS < targetTime - TIME_EPSILON) {
      cursor += MAX_SIMULATION_STEP_SECONDS;
      const sampledActors = sampleActorsAtTime?.(cursor);
      if (!sampledActors) break;
      this.processFrame(bridges, tileSize, sampledActors, cursor);
    }

    this.processFrame(bridges, tileSize, actors, targetTime);
    this.timelineTime = targetTime;

    return {
      bridgeStates: this.bridgeStates.map(cloneBridgeState),
      actorPositionOverrides: [...this.framePositionOverrides.values()],
    };
  }

  private initialize(
    bridges: readonly BridgePlacement[],
    baseBridgeStates: readonly BridgeState[],
    signature: string,
  ): void {
    this.bridgeStates = bridges.map((_, bridgeIndex) =>
      cloneBridgeState(
        baseBridgeStates.find((state) => state.bridgeIndex === bridgeIndex) ??
          createDefaultBridgeState(bridgeIndex),
      ),
    );
    this.traversals.clear();
    this.previousActorPositions.clear();
    this.repairOccupancy.clear();
    this.repairs.clear();
    this.feedbackExpirations.clear();
    this.framePositionOverrides.clear();
    this.baseStateSignature = signature;
    this.timelineTime = 0;
    this.initialized = true;
  }

  private processFrame(
    bridges: readonly BridgePlacement[],
    tileSize: number,
    actors: readonly RecordingBridgeActorPose[],
    frameTime: number,
  ): void {
    const elapsedSeconds = Math.max(0, frameTime - this.timelineTime);
    this.framePositionOverrides = new Map();
    this.advanceTemporalState(bridges, tileSize, elapsedSeconds, frameTime);

    const actorById = new Map(
      actors.map((actor) => [actor.actorId, { ...actor }] as const),
    );
    const activeActorIds = new Set(actorById.keys());
    for (const actorId of this.previousActorPositions.keys()) {
      if (activeActorIds.has(actorId)) continue;
      this.previousActorPositions.delete(actorId);
      this.traversals.delete(actorId);
      this.repairOccupancy.delete(actorId);
    }

    this.ejectActorsFromBlockedStones(bridges, tileSize, actorById);

    for (const actor of actorById.values()) {
      this.updateRepairInteraction(bridges, tileSize, actor, actorById);
    }
    this.pauseAbandonedRepairs(bridges, tileSize, actorById);

    for (const actor of actorById.values()) {
      const previous = this.previousActorPositions.get(actor.actorId) ?? actor;
      this.updateBridgeTraversal(
        bridges,
        tileSize,
        actor,
        previous,
        actorById,
        frameTime,
      );
    }

    this.previousActorPositions.clear();
    for (const actor of actorById.values()) {
      this.previousActorPositions.set(actor.actorId, { ...actor });
    }
    this.timelineTime = frameTime;
  }

  private advanceTemporalState(
    bridges: readonly BridgePlacement[],
    tileSize: number,
    elapsedSeconds: number,
    frameTime: number,
  ): void {
    for (const [bridgeIndex, expiresAt] of this.feedbackExpirations) {
      if (frameTime + TIME_EPSILON < expiresAt) continue;
      this.feedbackExpirations.delete(bridgeIndex);
      const state = this.bridgeStates[bridgeIndex];
      if (state) state.wrongTileIndex = null;
    }

    const elapsedMs = elapsedSeconds * 1_000;
    for (const [bridgeIndex, repair] of this.repairs) {
      const state = this.bridgeStates[bridgeIndex];
      if (!state) {
        this.repairs.delete(bridgeIndex);
        continue;
      }

      if (state.repairActive && repair.repairingActorId) {
        const actor = this.previousActorPositions.get(repair.repairingActorId);
        if (
          actor &&
          this.isActorOnRepairCircle(
            bridges,
            tileSize,
            actor,
            bridgeIndex,
            repair.channelSide,
          )
        ) {
          repair.activeElapsedMs += elapsedMs;
        } else {
          state.repairActive = false;
          state.repairingPlayerId = null;
          repair.repairingActorId = null;
        }
      }

      state.collapsedTileMask = getBridgeRepairCollapsedMask(
        repair.initialCollapsedTileMask,
        repair.orderSide,
        repair.activeElapsedMs,
      );
      if (repair.activeElapsedMs < BRIDGE_REPAIR_DURATION_MS) continue;

      state.collapsedTileMask = 0;
      state.repairingSide = null;
      state.repairActive = false;
      state.repairingPlayerId = null;
      state.repairStartedTick = null;
      state.repairInitialCollapsedTileMask = 0;
      this.repairs.delete(bridgeIndex);
      for (const [actorId, traversal] of this.traversals) {
        if (traversal.bridgeIndex === bridgeIndex) this.traversals.delete(actorId);
      }
    }
  }

  private updateRepairInteraction(
    bridges: readonly BridgePlacement[],
    tileSize: number,
    actor: RecordingBridgeActorPose,
    actorById: Map<string, RecordingBridgeActorPose>,
  ): void {
    const feet = getFeetCenter(actor);
    let repairKey: string | null = null;

    for (let bridgeIndex = 0; bridgeIndex < bridges.length; bridgeIndex++) {
      const circle = getBridgeRepairCircleBounds(bridges[bridgeIndex], tileSize).find(
        (bounds) =>
          feet.x >= bounds.left &&
          feet.x <= bounds.right &&
          feet.y >= bounds.top &&
          feet.y <= bounds.bottom,
      );
      if (!circle) continue;

      repairKey = `${bridgeIndex}:${circle.side}`;
      if (this.repairOccupancy.get(actor.actorId) !== repairKey) {
        const state = this.bridgeStates[bridgeIndex];
        if (state?.repairingSide === null && state.collapsedTileMask !== 0) {
          this.startRepair(
            bridges,
            tileSize,
            bridgeIndex,
            circle.side,
            actor.actorId,
            actorById,
          );
        } else if (state?.repairingSide !== null && !state.repairActive) {
          this.resumeRepair(bridgeIndex, circle.side, actor.actorId);
        }
      }
      break;
    }

    if (repairKey === null) this.repairOccupancy.delete(actor.actorId);
    else this.repairOccupancy.set(actor.actorId, repairKey);
  }

  private startRepair(
    bridges: readonly BridgePlacement[],
    tileSize: number,
    bridgeIndex: number,
    side: BridgeEntrySide,
    actorId: string,
    actorById: Map<string, RecordingBridgeActorPose>,
  ): void {
    const state = this.bridgeStates[bridgeIndex];
    if (!state || state.collapsedTileMask === 0 || state.repairingSide !== null) return;

    const repair: RecordingBridgeRepair = {
      activeElapsedMs: 0,
      initialCollapsedTileMask: state.collapsedTileMask,
      orderSide: side,
      channelSide: side,
      repairingActorId: actorId,
    };
    this.repairs.set(bridgeIndex, repair);
    state.repairingSide = side;
    state.repairActive = true;
    state.repairingPlayerId = actorId;
    state.repairStartedTick = null;
    state.repairInitialCollapsedTileMask = repair.initialCollapsedTileMask;
    state.collapsedTileMask = getBridgeRepairCollapsedMask(
      repair.initialCollapsedTileMask,
      repair.orderSide,
      0,
    );

    const bridge = bridges[bridgeIndex];
    for (const candidate of actorById.values()) {
      const feet = getFeetCenter(candidate);
      if (getBridgeWalkwayTileAtPoint(bridge, feet.x, feet.y, tileSize)) {
        this.returnActorToBridgeEntry(bridges, tileSize, candidate, bridgeIndex);
      }
    }
    for (const [candidateId, traversal] of this.traversals) {
      if (traversal.bridgeIndex === bridgeIndex) this.traversals.delete(candidateId);
    }
  }

  private resumeRepair(
    bridgeIndex: number,
    side: BridgeEntrySide,
    actorId: string,
  ): void {
    const state = this.bridgeStates[bridgeIndex];
    const repair = this.repairs.get(bridgeIndex);
    if (!state || !repair || state.repairActive) return;

    repair.repairingActorId = actorId;
    repair.channelSide = side;
    state.repairingSide = side;
    state.repairActive = true;
    state.repairingPlayerId = actorId;
  }

  private pauseAbandonedRepairs(
    bridges: readonly BridgePlacement[],
    tileSize: number,
    actorById: ReadonlyMap<string, RecordingBridgeActorPose>,
  ): void {
    for (const [bridgeIndex, repair] of this.repairs) {
      if (!repair.repairingActorId) continue;
      const actor = actorById.get(repair.repairingActorId);
      if (
        actor &&
        this.isActorOnRepairCircle(
          bridges,
          tileSize,
          actor,
          bridgeIndex,
          repair.channelSide,
        )
      ) {
        continue;
      }

      const state = this.bridgeStates[bridgeIndex];
      if (state) {
        state.repairActive = false;
        state.repairingPlayerId = null;
      }
      repair.repairingActorId = null;
    }
  }

  private isActorOnRepairCircle(
    bridges: readonly BridgePlacement[],
    tileSize: number,
    actor: RecordingBridgeActorPose,
    bridgeIndex: number,
    side: BridgeEntrySide,
  ): boolean {
    const bridge = bridges[bridgeIndex];
    if (!bridge) return false;
    const bounds = getBridgeRepairCircleBounds(bridge, tileSize).find(
      (circle) => circle.side === side,
    );
    if (!bounds) return false;
    const feet = getFeetCenter(actor);
    return (
      feet.x >= bounds.left &&
      feet.x <= bounds.right &&
      feet.y >= bounds.top &&
      feet.y <= bounds.bottom
    );
  }

  private updateBridgeTraversal(
    bridges: readonly BridgePlacement[],
    tileSize: number,
    actor: RecordingBridgeActorPose,
    previous: RecordingBridgeActorPose,
    actorById: Map<string, RecordingBridgeActorPose>,
    frameTime: number,
  ): void {
    const feet = getFeetCenter(actor);
    let bridgeIndex = -1;
    let currentTile: ReturnType<typeof getBridgeWalkwayTileAtPoint> = null;
    for (let candidateIndex = 0; candidateIndex < bridges.length; candidateIndex++) {
      const tile = getBridgeWalkwayTileAtPoint(
        bridges[candidateIndex],
        feet.x,
        feet.y,
        tileSize,
      );
      if (!tile) continue;
      bridgeIndex = candidateIndex;
      currentTile = tile;
      break;
    }

    if (bridgeIndex < 0 || !currentTile) {
      this.traversals.delete(actor.actorId);
      return;
    }
    const state = this.bridgeStates[bridgeIndex];
    if (!state || state.repairingSide !== null) {
      this.traversals.delete(actor.actorId);
      return;
    }

    const bridge = bridges[bridgeIndex];
    let traversal = this.traversals.get(actor.actorId);
    if (!traversal || traversal.bridgeIndex !== bridgeIndex) {
      const firstRow = getBridgeWalkwayTileBounds(bridge, 0, 0, tileSize);
      const lastRow = getBridgeWalkwayTileBounds(
        bridge,
        BRIDGE_WALKWAY_ROWS - 1,
        0,
        tileSize,
      );
      const previousFeetY = previous.y - FEET_HITBOX_H / 2;
      let entrySide: BridgeEntrySide;
      if (previousFeetY < firstRow.top) entrySide = 'north';
      else if (previousFeetY > lastRow.bottom) entrySide = 'south';
      else if (actor.y < previous.y) entrySide = 'south';
      else if (actor.y > previous.y) entrySide = 'north';
      else entrySide = currentTile.row < BRIDGE_WALKWAY_ROWS / 2 ? 'north' : 'south';

      traversal = {
        bridgeIndex,
        entrySide,
        lastTileMask: 0,
        completed: false,
      };
      this.traversals.set(actor.actorId, traversal);
    }

    const tileMask = getBridgeWalkwayTileMaskAtFeetCenter(
      bridge,
      feet.x,
      feet.y,
      FEET_HITBOX_W,
      tileSize,
    );
    if (tileMask === 0 || tileMask === traversal.lastTileMask) return;

    const safe = (tileMask & ~bridge.safeTileMask) === 0;
    const destinationRow = traversal.entrySide === 'north' ? BRIDGE_WALKWAY_ROWS - 1 : 0;
    if (safe && currentTile.row === destinationRow) {
      traversal.completed = true;
    } else if (!safe && !traversal.completed && state.collapsedTileMask === 0) {
      const direction = traversal.entrySide === 'north' ? 'south' : 'north';
      const wrongTileMask = tileMask & ~bridge.safeTileMask;
      let wrongColumn = currentTile.column;
      if ((wrongTileMask & getBridgeTileBit(currentTile.row, wrongColumn)) === 0) {
        wrongColumn =
          Array.from({ length: BRIDGE_WALKWAY_COLUMNS }, (_, column) => column).find(
            (column) => (wrongTileMask & getBridgeTileBit(currentTile.row, column)) !== 0,
          ) ?? wrongColumn;
      }
      this.triggerFailure(
        bridges,
        tileSize,
        bridgeIndex,
        currentTile.row,
        wrongColumn,
        direction,
        actor.actorId,
        actorById,
        frameTime,
      );
    }

    const currentTraversal = this.traversals.get(actor.actorId);
    if (currentTraversal) currentTraversal.lastTileMask = tileMask;
  }

  private triggerFailure(
    bridges: readonly BridgePlacement[],
    tileSize: number,
    bridgeIndex: number,
    failedRow: number,
    failedColumn: number,
    direction: 'north' | 'south',
    triggeringActorId: string,
    actorById: Map<string, RecordingBridgeActorPose>,
    frameTime: number,
  ): void {
    const state = this.bridgeStates[bridgeIndex];
    if (!state || state.collapsedTileMask !== 0) return;

    state.wrongTileIndex = failedRow * BRIDGE_WALKWAY_COLUMNS + failedColumn;
    this.feedbackExpirations.set(
      bridgeIndex,
      frameTime + BRIDGE_FAILURE_FEEDBACK_DURATION_MS / 1_000,
    );

    const collapsedTileMask = getBridgeCollapseMask(failedRow, direction);
    if (collapsedTileMask === 0) return;
    const terminalFailure =
      (direction === 'north' && failedRow === 0) ||
      (direction === 'south' && failedRow === BRIDGE_WALKWAY_ROWS - 1);

    state.collapsedTileMask = collapsedTileMask;
    state.repairingSide = null;
    state.repairActive = false;
    state.repairingPlayerId = null;
    state.repairStartedTick = null;
    state.repairInitialCollapsedTileMask = 0;
    this.repairs.delete(bridgeIndex);

    const bridge = bridges[bridgeIndex];
    let triggeringActorReturned = false;
    for (const candidate of actorById.values()) {
      if (!this.actorOverlapsBridgeMask(candidate, bridge, collapsedTileMask, tileSize)) {
        continue;
      }
      if (terminalFailure && candidate.actorId === triggeringActorId) {
        this.returnActorToPreviousBridgeRow(
          bridges,
          tileSize,
          candidate,
          bridgeIndex,
          failedRow,
          direction,
        );
      } else {
        this.returnActorToBridgeEntry(bridges, tileSize, candidate, bridgeIndex);
      }
      if (candidate.actorId === triggeringActorId) triggeringActorReturned = true;
    }

    if (terminalFailure && !triggeringActorReturned) {
      const triggeringActor = actorById.get(triggeringActorId);
      if (triggeringActor) {
        this.returnActorToPreviousBridgeRow(
          bridges,
          tileSize,
          triggeringActor,
          bridgeIndex,
          failedRow,
          direction,
        );
      }
    }

    for (const [actorId, traversal] of this.traversals) {
      if (traversal.bridgeIndex === bridgeIndex) this.traversals.delete(actorId);
    }
  }

  private ejectActorsFromBlockedStones(
    bridges: readonly BridgePlacement[],
    tileSize: number,
    actorById: Map<string, RecordingBridgeActorPose>,
  ): void {
    for (const state of this.bridgeStates) {
      const blockedMask =
        state.collapsedTileMask |
        (state.repairingSide !== null ? state.repairInitialCollapsedTileMask : 0);
      if (blockedMask === 0) continue;
      const bridge = bridges[state.bridgeIndex];
      if (!bridge) continue;
      for (const actor of actorById.values()) {
        if (!this.actorOverlapsBridgeMask(actor, bridge, blockedMask, tileSize)) continue;
        this.returnActorToBridgeEntry(bridges, tileSize, actor, state.bridgeIndex);
      }
    }
  }

  private actorOverlapsBridgeMask(
    actor: RecordingBridgeActorPose,
    bridge: BridgePlacement,
    mask: number,
    tileSize: number,
  ): boolean {
    const left = actor.x - FEET_HITBOX_W / 2;
    const top = actor.y - FEET_HITBOX_H;
    const right = left + FEET_HITBOX_W - 1;
    const bottom = actor.y - 1;

    for (let row = 0; row < BRIDGE_WALKWAY_ROWS; row++) {
      for (let column = 0; column < BRIDGE_WALKWAY_COLUMNS; column++) {
        if ((mask & getBridgeTileBit(row, column)) === 0) continue;
        const tile = getBridgeWalkwayTileBounds(bridge, row, column, tileSize);
        if (
          left <= tile.right &&
          right >= tile.left &&
          top <= tile.bottom &&
          bottom >= tile.top
        ) {
          return true;
        }
      }
    }
    return false;
  }

  private returnActorToPreviousBridgeRow(
    bridges: readonly BridgePlacement[],
    tileSize: number,
    actor: RecordingBridgeActorPose,
    bridgeIndex: number,
    failedRow: number,
    direction: 'north' | 'south',
  ): void {
    const bridge = bridges[bridgeIndex];
    const returnRow = direction === 'south' ? failedRow - 1 : failedRow + 1;
    const position = bridge
      ? getBridgeSafeRowFeetCenter(bridge, returnRow, actor.x, tileSize)
      : null;
    if (!position) {
      this.returnActorToBridgeEntry(bridges, tileSize, actor, bridgeIndex);
      return;
    }

    this.setActorPosition(actor, position.x, position.y + FEET_HITBOX_H / 2);
    this.traversals.delete(actor.actorId);
    this.repairOccupancy.delete(actor.actorId);
  }

  private returnActorToBridgeEntry(
    bridges: readonly BridgePlacement[],
    tileSize: number,
    actor: RecordingBridgeActorPose,
    bridgeIndex: number,
  ): void {
    const bridge = bridges[bridgeIndex];
    if (!bridge) return;
    const traversal = this.traversals.get(actor.actorId);
    let entrySide = traversal?.bridgeIndex === bridgeIndex ? traversal.entrySide : null;
    if (!entrySide) {
      const first = getBridgeWalkwayTileBounds(bridge, 0, 0, tileSize);
      const last = getBridgeWalkwayTileBounds(
        bridge,
        BRIDGE_WALKWAY_ROWS - 1,
        0,
        tileSize,
      );
      const midpoint = (first.top + last.bottom) / 2;
      entrySide = getFeetCenter(actor).y <= midpoint ? 'north' : 'south';
    }

    const position = getBridgeBankReturnPosition(bridge, entrySide, tileSize);
    this.setActorPosition(actor, position.x, position.y);
    this.traversals.delete(actor.actorId);
    this.repairOccupancy.delete(actor.actorId);
  }

  private setActorPosition(actor: RecordingBridgeActorPose, x: number, y: number): void {
    actor.x = x;
    actor.y = y;
    this.framePositionOverrides.set(actor.actorId, { actorId: actor.actorId, x, y });
  }
}
