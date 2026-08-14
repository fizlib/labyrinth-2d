import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FEET_HITBOX_H,
  FEET_HITBOX_W,
  getSpikeGateCollisionBounds,
  getSpikeGatePlatePlacements,
  getSpikeGateStateIndex,
} from '@labyrinth/shared';
import { Room } from '../dist/Room.js';

function testPlayer(id, x, y) {
  return {
    id,
    displayName: id,
    teamId: 0,
    spriteIndex: 0,
    x,
    y,
    facing: 'down',
    isMoving: false,
    connected: true,
    isDead: false,
    escaped: false,
    lastProcessedInput: 0,
    role: 'survivor',
    wisdomOrbs: 1,
  };
}

test('a spike plate opens only its nearest colored gate', () => {
  const room = new Room(`spike-${Math.random()}`);
  try {
    const placement = room.spikeGateObstacles[0];
    assert.ok(placement);
    const plates = getSpikeGatePlatePlacements(placement, 0, room.map.tileSize);
    const redFirstSide = plates.find((plate) => plate.gateIndex === 0);
    const blueSecondSide = plates.findLast((plate) => plate.gateIndex === 1);
    assert.ok(redFirstSide);
    assert.ok(blueSecondSide);

    room.state.players = [
      testPlayer(
        'helper',
        redFirstSide.x + redFirstSide.width / 2,
        redFirstSide.y + redFirstSide.height,
      ),
    ];
    room.updateSpikeGateStates();
    assert.equal(
      room.spikePlateStates[redFirstSide.spikePlateIndex].pressed,
      true,
    );
    assert.equal(room.spikeGateStates[getSpikeGateStateIndex(0, 0)].open, true);
    assert.equal(room.spikeGateStates[getSpikeGateStateIndex(0, 1)].open, false);
    assert.equal(room.spikeGateStates[getSpikeGateStateIndex(0, 2)].open, false);

    room.state.players[0].x = blueSecondSide.x + blueSecondSide.width / 2;
    room.state.players[0].y = blueSecondSide.y + blueSecondSide.height;
    room.updateSpikeGateStates();
    assert.equal(room.spikeGateStates[getSpikeGateStateIndex(0, 0)].open, false);
    assert.equal(room.spikeGateStates[getSpikeGateStateIndex(0, 1)].open, true);
    assert.equal(room.spikeGateStates[getSpikeGateStateIndex(0, 2)].open, false);
  } finally {
    room.destroy();
  }
});

test('a closing spike gate immediately ejects overlapping players backwards', () => {
  const room = new Room(`spike-ejection-${Math.random()}`);
  try {
    const placement = {
      orientation: 'horizontal',
      cellX: 0,
      cellY: 0,
      tileX: 10,
      tileY: 20,
      gateCount: 3,
    };
    room.spikeGateObstacles[0] = placement;
    const bounds = getSpikeGateCollisionBounds(placement, 0, room.map.tileSize);
    const insideX = (bounds.left + bounds.right) / 2;
    const insideY = bounds.top + FEET_HITBOX_H;
    const fromLeft = testPlayer('from-left', insideX, insideY);
    fromLeft.facing = 'right';
    const stuck = testPlayer('stuck', insideX, insideY);
    stuck.facing = 'left';
    room.state.players = [fromLeft, stuck];
    room.spikeGateStates[getSpikeGateStateIndex(0, 0)].open = true;

    const leftOutsideX = bounds.left - FEET_HITBOX_W / 2;
    const rightOutsideX = bounds.right + 1 + FEET_HITBOX_W / 2;
    room.updateSpikeGateStates(
      new Map([
        ['from-left', { x: leftOutsideX, y: insideY }],
        ['stuck', { x: insideX, y: insideY }],
      ]),
    );

    assert.equal(room.spikeGateStates[getSpikeGateStateIndex(0, 0)].open, false);
    assert.equal(fromLeft.x, leftOutsideX);
    assert.equal(stuck.x, rightOutsideX);
  } finally {
    room.destroy();
  }
});

test('a vertical closing spike gate ejects players north or south', () => {
  const room = new Room(`vertical-spike-ejection-${Math.random()}`);
  try {
    const placement = {
      orientation: 'vertical',
      cellX: 0,
      cellY: 0,
      tileX: 10,
      tileY: 20,
      gateCount: 3,
    };
    room.spikeGateObstacles[0] = placement;
    const bounds = getSpikeGateCollisionBounds(placement, 0, room.map.tileSize);
    const insideX = (bounds.left + bounds.right) / 2;
    const insideY = bounds.bottom + 1;
    const fromNorth = testPlayer('from-north', insideX, insideY);
    fromNorth.facing = 'down';
    const stuck = testPlayer('vertical-stuck', insideX, insideY);
    stuck.facing = 'up';
    room.state.players = [fromNorth, stuck];
    room.spikeGateStates[getSpikeGateStateIndex(0, 0)].open = true;

    const northOutsideY = bounds.top;
    const southOutsideY = bounds.bottom + 1 + FEET_HITBOX_H;
    room.updateSpikeGateStates(
      new Map([
        ['from-north', { x: insideX, y: northOutsideY }],
        ['vertical-stuck', { x: insideX, y: insideY }],
      ]),
    );

    assert.equal(room.spikeGateStates[getSpikeGateStateIndex(0, 0)].open, false);
    assert.equal(fromNorth.y, northOutsideY);
    assert.equal(stuck.y, southOutsideY);
  } finally {
    room.destroy();
  }
});
