import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BRIDGE_WALKWAY_ROWS,
  FEET_HITBOX_H,
  getBridgeCollapseMask,
  getBridgeRepairCircleBounds,
  getBridgeTileBit,
  getBridgeWalkwayTileBounds,
} from '@labyrinth/shared';
import { RecordingBridgeSimulation } from '../dist/systems/RecordingBridgeSimulation.js';

const BRIDGE = {
  cellX: 0,
  northCellY: 0,
  tileX: 0,
  tileY: 0,
  safeTileMask: Array.from({ length: BRIDGE_WALKWAY_ROWS }, (_, row) =>
    getBridgeTileBit(row, 0),
  ).reduce((mask, bit) => mask | bit, 0),
};

function bridgeState(collapsedTileMask = 0) {
  return {
    bridgeIndex: 0,
    collapsedTileMask,
    wrongTileIndex: null,
    repairingSide: null,
    repairActive: false,
    repairingPlayerId: null,
    repairStartedTick: null,
    repairInitialCollapsedTileMask: 0,
  };
}

function actorAtTile(row, column) {
  const bounds = getBridgeWalkwayTileBounds(BRIDGE, row, column);
  return {
    actorId: 'actor-1',
    x: (bounds.left + bounds.right + 1) / 2,
    y: (bounds.top + bounds.bottom + 1) / 2 + FEET_HITBOX_H / 2,
  };
}

function actorAtNorthBank() {
  const first = getBridgeWalkwayTileBounds(BRIDGE, 0, 0);
  return {
    actorId: 'actor-1',
    x: (first.left + first.right + 1) / 2,
    y: first.top - 2 + FEET_HITBOX_H / 2,
  };
}

test('recording actor collapses the stones ahead after stepping off the safe route', () => {
  const simulation = new RecordingBridgeSimulation();
  simulation.update([BRIDGE], 16, [bridgeState()], [actorAtNorthBank()], 0);

  const result = simulation.update(
    [BRIDGE],
    16,
    [bridgeState()],
    [actorAtTile(1, 1)],
    0.1,
  );

  assert.equal(
    result.bridgeStates[0].collapsedTileMask,
    getBridgeCollapseMask(1, 'south'),
  );
  assert.equal(result.bridgeStates[0].wrongTileIndex, 3);
});

test('terminal wrong stone returns the recording actor to the preceding safe row', () => {
  const simulation = new RecordingBridgeSimulation();
  simulation.update([BRIDGE], 16, [bridgeState()], [actorAtNorthBank()], 0);

  const result = simulation.update(
    [BRIDGE],
    16,
    [bridgeState()],
    [actorAtTile(BRIDGE_WALKWAY_ROWS - 1, 1)],
    0.1,
  );
  const precedingSafeTile = actorAtTile(BRIDGE_WALKWAY_ROWS - 2, 0);

  assert.equal(
    result.bridgeStates[0].collapsedTileMask,
    getBridgeCollapseMask(BRIDGE_WALKWAY_ROWS - 1, 'south'),
  );
  assert.deepEqual(result.actorPositionOverrides, [precedingSafeTile]);
});

test('recording actor repairs a collapsed bridge while holding a treasure circle', () => {
  const simulation = new RecordingBridgeSimulation();
  const circle = getBridgeRepairCircleBounds(BRIDGE).find(
    (candidate) => candidate.side === 'north',
  );
  assert.ok(circle);
  const actor = {
    actorId: 'actor-1',
    x: (circle.left + circle.right) / 2,
    y: (circle.top + circle.bottom) / 2 + FEET_HITBOX_H / 2,
  };
  const collapsed = getBridgeCollapseMask(1, 'south');

  const started = simulation.update([BRIDGE], 16, [bridgeState(collapsed)], [actor], 0);
  assert.equal(started.bridgeStates[0].repairActive, true);

  const repaired = simulation.update(
    [BRIDGE],
    16,
    [bridgeState(collapsed)],
    [actor],
    10.1,
    () => [actor],
  );
  assert.equal(repaired.bridgeStates[0].collapsedTileMask, 0);
  assert.equal(repaired.bridgeStates[0].repairActive, false);
  assert.equal(repaired.bridgeStates[0].repairingSide, null);
});
