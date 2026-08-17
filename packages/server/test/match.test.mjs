import test from 'node:test';
import assert from 'node:assert/strict';

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
}

function createRoom(playerCount = 9) {
  const room = new Room(`test-${Math.random()}`);
  const sockets = [];
  for (let index = 0; index < playerCount; index++) {
    const socket = new FakeSocket(`player-${index}`);
    sockets.push(socket);
    room.addPlayer(socket, `token-${index}`);
  }
  room.startMatch();
  return { room, sockets };
}

function activatePortal(room) {
  for (const runestone of room.runestones) runestone.activated = true;
  room.portalActivated = true;
  assert.ok(room.portalPosition);
}

function escape(room, player) {
  player.x = room.portalPosition.x;
  player.y = room.portalPosition.y;
  room.handleEscapePortal(player.id, { type: 'ESCAPE_PORTAL' });
}

test('only nearby survivors can escape an active portal and the fifth ends a full match', (t) => {
  const { room, sockets } = createRoom();
  t.after(() => room.destroy());
  const survivors = room.state.players.filter((player) => player.role === 'survivor');
  const wardens = room.state.players.filter((player) => player.role === 'warden');
  assert.equal(survivors.length, 7);
  assert.equal(wardens.length, 2);
  assert.equal(room.state.match.escapeThreshold, 5);

  const portal = room.portalPosition;
  assert.ok(portal);
  survivors[0].x = portal.x;
  survivors[0].y = portal.y;
  room.handleEscapePortal(survivors[0].id, { type: 'ESCAPE_PORTAL' });
  assert.equal(survivors[0].escaped, false, 'inactive portals reject escape');

  activatePortal(room);
  wardens[0].x = portal.x;
  wardens[0].y = portal.y;
  room.handleEscapePortal(wardens[0].id, { type: 'ESCAPE_PORTAL' });
  assert.equal(wardens[0].escaped, false, 'wardens cannot escape');

  survivors[0].x = portal.x + 29;
  survivors[0].y = portal.y;
  room.handleEscapePortal(survivors[0].id, { type: 'ESCAPE_PORTAL' });
  assert.equal(survivors[0].escaped, false, 'out-of-range survivors cannot escape');

  for (const survivor of survivors.slice(0, 4)) escape(room, survivor);
  assert.equal(room.state.match.status, 'running');
  assert.equal(room.state.match.escapedCount, 4);

  escape(room, survivors[4]);
  assert.equal(room.state.match.status, 'ended');
  assert.equal(room.state.match.winner, 'survivors');
  assert.equal(room.state.match.escapedCount, 5);
  assert.equal(
    sockets[0].sent.filter((message) => message.type === 'PLAYER_ESCAPED').length,
    5,
  );
  const endedMessage = sockets[0].sent.findLast(
    (message) => message.type === 'MATCH_ENDED',
  );
  assert.ok(endedMessage);
  assert.equal(endedMessage.finalRoster.length, 9);
  assert.equal(
    endedMessage.finalRoster.filter((player) => player.role === 'survivor').length,
    7,
  );
  assert.equal(
    endedMessage.finalRoster.filter((player) => player.role === 'warden').length,
    2,
  );

  room.handleEscapePortal(survivors[5].id, { type: 'ESCAPE_PORTAL' });
  assert.equal(room.state.match.escapedCount, 5, 'ended matches reject later escapes');
});

test('permanently removed survivors recalculate the target and can end the match', (t) => {
  const { room } = createRoom();
  t.after(() => room.destroy());
  activatePortal(room);
  const survivors = room.state.players.filter((player) => player.role === 'survivor');
  for (const survivor of survivors.slice(0, 4)) escape(room, survivor);

  room.removePlayer(survivors[4].id);
  assert.equal(room.state.match.escapeThreshold, 5);
  assert.equal(room.state.match.status, 'running');

  room.removePlayer(survivors[5].id);
  assert.equal(room.state.match.escapeThreshold, 4);
  assert.equal(room.state.match.status, 'ended');
  assert.equal(room.state.match.winner, 'survivors');
});

test('all occupied survivors escaping ends an underfilled match', (t) => {
  const { room } = createRoom();
  t.after(() => room.destroy());
  activatePortal(room);
  const survivors = room.state.players.filter((player) => player.role === 'survivor');
  for (const survivor of survivors.slice(2)) room.removePlayer(survivor.id);

  assert.equal(room.state.match.escapeThreshold, 2);
  escape(room, survivors[0]);
  assert.equal(room.state.match.status, 'running');

  escape(room, survivors[1]);
  assert.equal(room.state.match.status, 'ended');
  assert.equal(room.state.match.winner, 'survivors');
  assert.equal(room.state.match.escapedCount, 2);
});

test('an action racing an expired deadline resolves as a warden win', (t) => {
  const { room } = createRoom(1);
  t.after(() => room.destroy());
  room.matchEndsAtMs = Date.now() - 1;

  room.handleInput('player-0', {
    type: 'PLAYER_INPUT',
    sequenceNumber: 1,
    up: true,
    down: false,
    left: false,
    right: false,
    dt: 0.016,
  });

  assert.equal(room.state.match.status, 'ended');
  assert.equal(room.state.match.winner, 'wardens');
  assert.equal(room.state.match.remainingMs, 0);

  const lateSocket = new FakeSocket('late-player');
  room.addPlayer(lateSocket, 'late-token');
  assert.equal(lateSocket.sent.length, 0, 'ended matches reject new room members');
  assert.equal(room.playerCount, 1);
});

test('debug timer changes the authoritative deadline and zero triggers timeout', (t) => {
  const { room, sockets } = createRoom(1);
  t.after(() => room.destroy());

  const originalDeadline = room.matchEndsAtMs;
  room.handleDebugSetMatchTime('player-0', {
    type: 'DEBUG_SET_MATCH_TIME',
    remainingMs: 90_000,
  });
  assert.equal(
    room.matchEndsAtMs,
    originalDeadline,
    'regular players cannot use debug tools',
  );

  sockets[0].data.isAdmin = true;
  room.seats.get('player-0').isAdmin = true;

  room.handleDebugSetMatchTime('player-0', {
    type: 'DEBUG_SET_MATCH_TIME',
    remainingMs: 90_000,
  });

  assert.equal(room.state.match.status, 'running');
  assert.ok(room.state.match.remainingMs > 89_000);
  assert.ok(room.state.match.remainingMs <= 90_000);
  const latestTick = sockets[0].sent.findLast(
    (message) => message.type === 'TICK_UPDATE',
  );
  assert.ok(latestTick);
  assert.ok(latestTick.gameState.match.remainingMs > 89_000);

  const validDeadline = room.matchEndsAtMs;
  room.handleDebugSetMatchTime('player-0', {
    type: 'DEBUG_SET_MATCH_TIME',
    remainingMs: -1,
  });
  assert.equal(room.matchEndsAtMs, validDeadline, 'invalid timer values are ignored');

  room.handleDebugSetMatchTime('player-0', {
    type: 'DEBUG_SET_MATCH_TIME',
    remainingMs: 0,
  });
  assert.equal(room.state.match.status, 'ended');
  assert.equal(room.state.match.winner, 'wardens');
  assert.equal(room.state.match.remainingMs, 0);
});

test('authenticated public starting rosters emit one Elo result', (t) => {
  const records = [];
  const room = new Room(`ranked-${Math.random()}`, true, {
    matchRecordingEnabled: true,
    onMatchEnded: (record) => records.push(record),
  });
  t.after(() => room.destroy());

  for (let index = 0; index < 9; index++) {
    const socket = new FakeSocket(`ranked-player-${index}`);
    socket.data.userId = `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
    socket.data.ratedMatches = 10;
    room.addPlayer(socket, `ranked-token-${index}`);
  }

  room.startMatch();
  room.endMatch('survivors', Date.now());
  room.endMatch('wardens', Date.now());

  assert.equal(records.length, 1);
  assert.equal(records[0].rated, true);
  assert.equal(records[0].participants.length, 9);
  assert.ok(
    records[0].participants.every((participant) => participant.ratedMatchesBefore === 10),
  );
  for (const participant of records[0].participants) {
    assert.equal(participant.ratingDelta, participant.role === 'survivor' ? 12 : -12);
  }
});

test('ranked results retain and mark players who abandoned the starting roster', (t) => {
  const records = [];
  const releasedSeats = [];
  const room = new Room(`ranked-leaver-${Math.random()}`, true, {
    matchRecordingEnabled: true,
    onMatchEnded: (record) => records.push(record),
    onSeatReleased: (...seatIdentity) => releasedSeats.push(seatIdentity),
  });
  t.after(() => room.destroy());

  for (let index = 0; index < 9; index++) {
    const socket = new FakeSocket(`ranked-leaver-${index}`);
    socket.data.userId = `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
    room.addPlayer(socket, `ranked-leaver-token-${index}`);
  }

  room.startMatch();
  const leaver = room.state.players.find((player) => player.role === 'warden');
  assert.ok(leaver);
  const leaverSeat = room.seats.get(leaver.id);
  const leaverProfileId = leaverSeat.userId;
  room.removePlayer(leaver.id);
  assert.deepEqual(releasedSeats, [[leaverSeat.reconnectToken, leaverProfileId]]);
  room.endMatch('survivors', Date.now());

  assert.equal(records.length, 1);
  const recordedLeaver = records[0].participants.find(
    (participant) => participant.profileId === leaverProfileId,
  );
  assert.ok(recordedLeaver);
  assert.equal(recordedLeaver.abandoned, true);
  assert.equal(room.state.match.finalRoster.length, 9);
});

test('private, guest-containing, guest-only, and underfilled matches record without Elo', (t) => {
  const records = [];
  const options = {
    matchRecordingEnabled: true,
    onMatchEnded: (record) => {
      records.push(record);
    },
  };
  const privateRoom = new Room(`private-${Math.random()}`, false, options);
  const publicRoom = new Room(`guest-public-${Math.random()}`, true, options);
  const guestOnlyRoom = new Room(`guest-only-${Math.random()}`, true, options);
  const underfilledRoom = new Room(`underfilled-public-${Math.random()}`, true, options);
  t.after(() => privateRoom.destroy());
  t.after(() => publicRoom.destroy());
  t.after(() => guestOnlyRoom.destroy());
  t.after(() => underfilledRoom.destroy());

  for (let index = 0; index < 6; index++) {
    const privateSocket = new FakeSocket(`private-player-${index}`);
    privateSocket.data.userId = `20000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
    privateRoom.addPlayer(privateSocket, `private-token-${index}`);

    const publicSocket = new FakeSocket(`public-player-${index}`);
    if (index > 0) {
      publicSocket.data.userId = `30000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
    }
    publicRoom.addPlayer(publicSocket, `public-token-${index}`);

    const underfilledSocket = new FakeSocket(`underfilled-player-${index}`);
    underfilledSocket.data.userId = `40000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
    underfilledRoom.addPlayer(underfilledSocket, `underfilled-token-${index}`);
  }

  guestOnlyRoom.addPlayer(new FakeSocket('guest-only-player'), 'guest-only-token');

  privateRoom.startMatch();
  publicRoom.startMatch();
  guestOnlyRoom.startMatch();
  underfilledRoom.startMatch();
  privateRoom.endMatch('wardens', Date.now());
  publicRoom.endMatch('wardens', Date.now());
  guestOnlyRoom.endMatch('wardens', Date.now());
  underfilledRoom.endMatch('wardens', Date.now());

  assert.equal(records.length, 4);
  const privateRecord = records.find((record) => record.roomId === privateRoom.id);
  const guestRecord = records.find((record) => record.roomId === publicRoom.id);
  const guestOnlyRecord = records.find((record) => record.roomId === guestOnlyRoom.id);
  const underfilledRecord = records.find(
    (record) => record.roomId === underfilledRoom.id,
  );
  assert.ok(privateRecord);
  assert.ok(guestRecord);
  assert.ok(guestOnlyRecord);
  assert.ok(underfilledRecord);
  assert.equal(privateRecord.rated, false);
  assert.equal(privateRecord.playerCount, 6);
  assert.equal(privateRecord.participants.length, 6);
  assert.equal(guestRecord.rated, false);
  assert.equal(guestRecord.playerCount, 6);
  assert.equal(guestRecord.participants.length, 5);
  assert.equal(guestOnlyRecord.rated, false);
  assert.equal(guestOnlyRecord.playerCount, 1);
  assert.equal(guestOnlyRecord.participants.length, 0);
  assert.equal(underfilledRecord.rated, false);
  assert.equal(underfilledRecord.playerCount, 6);
  assert.equal(underfilledRecord.participants.length, 6);
  assert.ok(
    records.every((record) =>
      record.participants.every(
        (participant) =>
          participant.ratingDelta === 0 && participant.ratingAfter === 1200,
      ),
    ),
  );
});
