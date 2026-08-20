import assert from 'node:assert/strict';
import test from 'node:test';

import {
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
  startX: 10,
  startY: 20,
  startFacing: 'down',
  frames: [
    { time: 0, x: 10, y: 20, facing: 'down', isMoving: false },
    { time: 1, x: 30, y: 40, facing: 'right', isMoving: true },
    { time: 2, x: 50, y: 40, facing: 'right', isMoving: true },
  ],
  messages: [{ id: 'cue-1', time: 1.5, duration: 2.5, text: 'This way!' }],
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
  assert.equal(parseRecordingProject({ version: 2, actors: [ACTOR] }), null);
  assert.equal(parseRecordingProject({ version: 1, actors: 'not-an-array' }), null);
});
