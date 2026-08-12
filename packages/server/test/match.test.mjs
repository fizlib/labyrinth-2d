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
    room.addPlayer(socket);
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

test('connected-survivor disconnects recalculate the target and can end the match', (t) => {
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

test('all currently connected survivors escaping ends an underfilled match', (t) => {
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
  room.addPlayer(lateSocket);
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
  assert.equal(room.matchEndsAtMs, originalDeadline, 'regular players cannot use debug tools');

  sockets[0].data.isAdmin = true;

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
