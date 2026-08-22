import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CELL_SIZE,
  CELL_STEP_X,
  CELL_STEP_Y,
  GRID_CELLS,
  TRAP_CELL_RELEASE_COOLDOWN_MS,
  WALL_HEIGHT,
  WALL_WIDTH,
} from '@labyrinth/shared';
import { Room } from '../dist/Room.js';

class FakeSocket {
  sent = [];

  constructor(id) {
    this.data = {
      id,
      displayName: id,
      roomId: null,
      connected: true,
      joinPending: false,
      supportsSnapshotFlowControl: false,
      isAdmin: false,
      userId: null,
      rating: 1200,
      ratedMatches: 0,
    };
  }

  getUserData() {
    return this.data;
  }

  send(payload) {
    this.sent.push(JSON.parse(payload));
  }

  getBufferedAmount() {
    return 0;
  }
}

function createRunningRoom() {
  const room = new Room(`trap-cell-${Math.random()}`);
  for (let index = 0; index < 6; index++) {
    room.addPlayer(new FakeSocket(`player-${index}`), `token-${index}`);
  }
  room.startMatch();
  for (const player of room.state.players) room.handleGameReady(player.id);
  room.stopLoop();
  return room;
}

function moveToTrapCell(room, player, trapCellIndex) {
  const trapCell = room.trapCells[trapCellIndex];
  assert.ok(trapCell);
  player.x = (trapCell.tileX + 3) * room.map.tileSize;
  player.y = (trapCell.tileY + 3) * room.map.tileSize;
}

function activateTrapNetwork(room, warden, trapCellIndex = 0) {
  moveToTrapCell(room, warden, trapCellIndex);
  room.handleActivateTrapCell(warden.id, {
    type: 'ACTIVATE_TRAP_CELL',
    trapCellIndex,
  });
}

function getLatestTrapResult(room, warden) {
  return room.sockets
    .get(warden.id)
    ?.sent.findLast((message) => message.type === 'TRAP_ACTIVATION_RESULT');
}

test('admin /trap chat command adds and synchronizes an immediately usable trap cell', (t) => {
  const room = createRunningRoom();
  t.after(() => room.destroy());

  const [admin, survivor, regularPlayer] = room.state.players;
  assert.ok(admin && survivor && regularPlayer);
  room.seats.get(admin.id).isAdmin = true;
  room.sockets.get(admin.id).data.isAdmin = true;

  let candidate = null;
  for (let cellY = 0; cellY < GRID_CELLS && !candidate; cellY++) {
    for (let cellX = 0; cellX < GRID_CELLS; cellX++) {
      if (
        !room.trapCells.some(
          (placement) => placement.cellX === cellX && placement.cellY === cellY,
        )
      ) {
        candidate = {
          cellX,
          cellY,
          tileX: WALL_WIDTH + cellX * CELL_STEP_X,
          tileY: WALL_HEIGHT + cellY * CELL_STEP_Y,
        };
        break;
      }
    }
  }
  assert.ok(candidate);

  const centerX = (candidate.tileX + CELL_SIZE / 2) * room.map.tileSize;
  const centerY = (candidate.tileY + CELL_SIZE / 2) * room.map.tileSize;
  admin.x = centerX;
  admin.y = centerY;
  regularPlayer.x = centerX;
  regularPlayer.y = centerY;

  const originalCount = room.trapCells.length;
  room.handleSendChatMessage(regularPlayer.id, {
    type: 'SEND_CHAT_MESSAGE',
    text: '/trap',
  });
  assert.equal(room.trapCells.length, originalCount, 'regular players cannot add traps');

  room.handleSendChatMessage(admin.id, {
    type: 'SEND_CHAT_MESSAGE',
    text: '  /TRAP  ',
  });
  assert.equal(room.trapCells.length, originalCount + 1);
  assert.deepEqual(room.trapCells.at(-1), candidate);
  assert.equal(room.trapCellCooldownEndsAtMs.length, room.trapCells.length);

  room.handleSendChatMessage(admin.id, {
    type: 'SEND_CHAT_MESSAGE',
    text: '/trap',
  });
  assert.equal(room.trapCells.length, originalCount + 1, 'repeating it is idempotent');

  room.tick();
  const snapshot = room.sockets
    .get(admin.id)
    .sent.findLast((message) => message.type === 'TICK_UPDATE');
  assert.deepEqual(snapshot.gameState.trapCells.at(-1), candidate);

  admin.role = 'warden';
  survivor.role = 'survivor';
  survivor.x = centerX;
  survivor.y = centerY;
  room.handleActivateTrapCell(admin.id, {
    type: 'ACTIVATE_TRAP_CELL',
    trapCellIndex: originalCount,
  });
  assert.equal(
    room.cageStates.some(
      (cage) => !cage.vacated && cage.prisonerPlayerId === survivor.id,
    ),
    true,
  );
});

test('released trap cells cool down without disabling other cells or trapping wardens', (t) => {
  const room = createRunningRoom();
  t.after(() => room.destroy());

  const [warden, releasedSurvivor, otherSurvivor, otherWarden, rescuer, bystander] =
    room.state.players;
  assert.ok(warden && releasedSurvivor && otherSurvivor && otherWarden);
  assert.ok(rescuer && bystander);

  warden.role = 'warden';
  otherWarden.role = 'warden';
  releasedSurvivor.role = 'survivor';
  otherSurvivor.role = 'survivor';
  rescuer.role = 'survivor';
  bystander.role = 'survivor';
  for (const player of room.state.players) {
    player.x = 0;
    player.y = 0;
  }

  moveToTrapCell(room, releasedSurvivor, 0);
  moveToTrapCell(room, otherWarden, 0);
  activateTrapNetwork(room, warden);

  assert.deepEqual(getLatestTrapResult(room, warden), {
    type: 'TRAP_ACTIVATION_RESULT',
    trapCellIndex: 0,
    capturedCount: 1,
    failureReason: null,
  });

  const originalCage = room.cageStates.find(
    (cage) => cage.prisonerPlayerId === releasedSurvivor.id,
  );
  assert.ok(originalCage);
  assert.deepEqual(
    room.sockets
      .get(releasedSurvivor.id)
      ?.sent.findLast((message) => message.type === 'PLAYER_TRAPPED'),
    {
      type: 'PLAYER_TRAPPED',
      cageId: originalCage.cageId,
    },
  );
  assert.equal(
    room.sockets
      .get(otherWarden.id)
      ?.sent.some((message) => message.type === 'PLAYER_TRAPPED'),
    false,
  );
  assert.equal(
    room.cageStates.some((cage) => cage.prisonerPlayerId === otherWarden.id),
    false,
  );

  rescuer.x = originalCage.x;
  rescuer.y = originalCage.y - 8;
  const releaseStartedAt = Date.now();
  room.handleOpenCage(rescuer.id, {
    type: 'OPEN_CAGE',
    cageId: originalCage.cageId,
  });

  assert.equal(originalCage.opened, true);
  assert.ok(
    room.trapCellCooldownEndsAtMs[0] >=
      releaseStartedAt + TRAP_CELL_RELEASE_COOLDOWN_MS,
  );

  // Simulate the released survivor clearing the open cage while remaining in
  // the same 6x6 trap cell.
  originalCage.vacated = true;
  activateTrapNetwork(room, warden);
  assert.equal(getLatestTrapResult(room, warden)?.capturedCount, 0);
  assert.equal(
    getLatestTrapResult(room, warden)?.failureReason,
    'release-cooldown',
  );

  // The cooldown remains local to its cell, so another cell still captures.
  moveToTrapCell(room, otherSurvivor, 1);
  activateTrapNetwork(room, warden);

  assert.equal(
    room.cageStates.some(
      (cage) =>
        !cage.vacated && cage.prisonerPlayerId === releasedSurvivor.id,
    ),
    false,
  );
  assert.equal(
    room.cageStates.some(
      (cage) => !cage.vacated && cage.prisonerPlayerId === otherSurvivor.id,
    ),
    true,
  );
  assert.equal(
    room.cageStates.some((cage) => cage.prisonerPlayerId === otherWarden.id),
    false,
  );
  assert.equal(getLatestTrapResult(room, warden)?.capturedCount, 1);
  assert.equal(getLatestTrapResult(room, warden)?.failureReason, null);

  // A failed activation without an eligible survivor gets the distinct empty
  // network reason even when another warden is standing in a trap cell.
  releasedSurvivor.x = 0;
  releasedSurvivor.y = 0;
  rescuer.x = 0;
  rescuer.y = 0;
  activateTrapNetwork(room, warden);
  assert.equal(getLatestTrapResult(room, warden)?.capturedCount, 0);
  assert.equal(getLatestTrapResult(room, warden)?.failureReason, 'no-survivors');

  room.trapCellCooldownEndsAtMs[0] = Date.now() - 1;
  moveToTrapCell(room, releasedSurvivor, 0);
  activateTrapNetwork(room, warden);
  assert.equal(
    room.cageStates.some(
      (cage) =>
        !cage.vacated && cage.prisonerPlayerId === releasedSurvivor.id,
    ),
    true,
  );
});
