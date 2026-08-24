import assert from 'node:assert/strict';
import test from 'node:test';

import { getSpikeGatePlatePlacements } from '@labyrinth/shared';
import {
  deriveRecordingWorldState,
  getRecordingWorldAudioEvents,
} from '../dist/systems/RecordingPlateSimulation.js';

const SPIKE_GATE = {
  tileX: 10,
  tileY: 10,
  orientation: 'vertical',
  gateCount: 2,
};

const LAYOUT = {
  gates: [],
  pressurePlates: [],
  spikeGateObstacles: [SPIKE_GATE],
};

const SERVER_STATE = {
  bridgeStates: [],
  gateStates: [],
  pressurePlateStates: [],
  spikeGateStates: [
    { spikeGateIndex: 0, open: false },
    { spikeGateIndex: 1, open: false },
  ],
  spikePlateStates: [
    { spikePlateIndex: 0, pressed: false, latched: false },
    { spikePlateIndex: 1, pressed: false, latched: false },
    { spikePlateIndex: 2, pressed: false, latched: false },
    { spikePlateIndex: 3, pressed: false, latched: false },
  ],
};

test('recording actor keeps a spike gate open over a closed server snapshot', () => {
  const plate = getSpikeGatePlatePlacements(SPIKE_GATE, 0)[0];
  const actor = {
    actorId: 'actor-1',
    spriteId: 'recording-actor:actor-1',
    name: 'Mira',
    spriteIndex: 0,
    teamId: 0,
    x: plate.x + plate.width / 2,
    y: plate.y + plate.height,
    facing: 'down',
    isMoving: false,
    chatText: null,
  };

  const effective = deriveRecordingWorldState(LAYOUT, SERVER_STATE, [actor]);

  assert.equal(effective.spikePlateStates[0].pressed, true);
  assert.equal(effective.spikeGateStates[0].open, true);
  assert.equal(effective.spikeGateStates[1].open, false);
});

test('reports recording plate and gate transitions for mechanism audio', () => {
  const before = {
    bridgeStates: [
      {
        bridgeIndex: 0,
        collapsedTileMask: 0,
        wrongTileIndex: null,
        repairingSide: null,
        repairActive: false,
        repairingPlayerId: null,
        repairStartedTick: null,
        repairInitialCollapsedTileMask: 0,
      },
    ],
    gateStates: [{ gateIndex: 0, open: false }],
    pressurePlateStates: [{ plateId: 4, pressed: false, latched: false }],
    spikeGateStates: [{ spikeGateIndex: 0, open: false }],
    spikePlateStates: [{ spikePlateIndex: 0, pressed: false, latched: false }],
  };
  const after = {
    bridgeStates: [
      {
        ...before.bridgeStates[0],
        collapsedTileMask: 4,
      },
    ],
    gateStates: [{ gateIndex: 0, open: true }],
    pressurePlateStates: [{ plateId: 4, pressed: true, latched: false }],
    spikeGateStates: [{ spikeGateIndex: 0, open: true }],
    spikePlateStates: [{ spikePlateIndex: 0, pressed: true, latched: false }],
  };

  assert.deepEqual(getRecordingWorldAudioEvents(before, after), [
    { kind: 'pressure-plate', plateId: 4, state: 'pressed' },
    { kind: 'spike-plate', spikePlateIndex: 0, state: 'pressed' },
    { kind: 'gate', gateIndex: 0, open: true },
    { kind: 'spike-gate', spikeGateIndex: 0, open: true },
    { kind: 'bridge-collapse', bridgeIndex: 0 },
  ]);
});
