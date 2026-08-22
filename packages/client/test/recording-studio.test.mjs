import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deriveRecordingTrapCaptures,
  getRecordingActorDuration,
  getRecordingActorMovementDuration,
  parseRecordingProject,
  sampleRecordingActor,
} from '../dist/systems/RecordingStudio.js';

const ACTOR = {
  id: 'actor-1',
  name: 'Mira',
  spriteIndex: 0,
  teamId: 0,
  role: 'survivor',
  startX: 10,
  startY: 20,
  startFacing: 'down',
  frames: [
    { time: 0, x: 10, y: 20, facing: 'down', isMoving: false },
    { time: 1, x: 30, y: 40, facing: 'right', isMoving: true },
    { time: 2, x: 50, y: 40, facing: 'right', isMoving: true },
  ],
  messages: [{ id: 'cue-1', time: 1.5, duration: 2.5, text: 'This way!' }],
  interactions: [],
};

test('interpolates recording positions on the shared timeline', () => {
  assert.deepEqual(sampleRecordingActor(ACTOR, 0.5), {
    time: 0.5,
    x: 20,
    y: 30,
    facing: 'right',
    isMoving: true,
  });
});

test('holds the final pose without leaving the walk animation running', () => {
  assert.deepEqual(sampleRecordingActor(ACTOR, 8), {
    time: 8,
    x: 50,
    y: 40,
    facing: 'right',
    isMoving: false,
  });
});

test('extends the timeline through the end of scheduled chat bubbles', () => {
  assert.equal(getRecordingActorDuration(ACTOR), 4);
});

test('tracks movement duration separately for resumable takes', () => {
  assert.equal(getRecordingActorMovementDuration(ACTOR), 2);
});

test('uses an actor start pose before a take exists', () => {
  const withoutTake = { ...ACTOR, frames: [], messages: [] };
  assert.deepEqual(sampleRecordingActor(withoutTake, 0), {
    time: 0,
    x: 10,
    y: 20,
    facing: 'down',
    isMoving: false,
  });
});

test('validates recording project files before loading actors', () => {
  assert.deepEqual(parseRecordingProject({ version: 1, actors: [ACTOR] }), [ACTOR]);
  assert.deepEqual(parseRecordingProject({ version: 2, actors: [ACTOR] }), [ACTOR]);
  assert.equal(parseRecordingProject({ version: 1, actors: 'not-an-array' }), null);
});

test('loads older files as Survivor actors without interactions', () => {
  const { role: _role, interactions: _interactions, ...legacyActor } = ACTOR;
  const parsed = parseRecordingProject({ version: 1, actors: [legacyActor] });
  assert.equal(parsed?.[0]?.role, 'survivor');
  assert.deepEqual(parsed?.[0]?.interactions, []);
});

test('replays a Warden E cue and captures Survivors inside trap cells', () => {
  const warden = {
    ...ACTOR,
    id: 'warden-1',
    role: 'warden',
    frames: [
      { time: 0, x: 100, y: 48, facing: 'left', isMoving: false },
      { time: 1, x: 98, y: 48, facing: 'left', isMoving: true },
    ],
    messages: [],
    interactions: [{ id: 'trap-1', time: 1, type: 'activate-trap' }],
  };
  const survivor = {
    ...ACTOR,
    id: 'survivor-1',
    frames: [
      { time: 0, x: 32, y: 32, facing: 'down', isMoving: false },
      { time: 2, x: 60, y: 60, facing: 'right', isMoving: true },
    ],
    messages: [],
  };

  assert.deepEqual(
    deriveRecordingTrapCaptures([warden, survivor], 2, [{ tileX: 0, tileY: 0 }], 16),
    [
      {
        cageId: -1,
        actorId: 'survivor-1',
        wardenActorId: 'warden-1',
        interactionId: 'trap-1',
        trapCellIndex: 0,
        time: 1,
        x: 46,
        y: 46,
      },
    ],
  );
});

test('ignores trap cues before their scheduled timeline time', () => {
  const warden = {
    ...ACTOR,
    role: 'warden',
    interactions: [{ id: 'trap-1', time: 1, type: 'activate-trap' }],
  };
  assert.deepEqual(
    deriveRecordingTrapCaptures([warden, ACTOR], 0.9, [{ tileX: 0, tileY: 0 }], 16),
    [],
  );
});
