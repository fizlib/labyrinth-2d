import test from 'node:test';
import assert from 'node:assert/strict';

import { Room } from '../dist/Room.js';

class FakeSocket {
  sent = [];
  ended = null;

  constructor(id, userId, isAdmin = false) {
    this.data = {
      id,
      displayName: id,
      roomId: null,
      connected: true,
      joinPending: false,
      supportsSnapshotFlowControl: false,
      isAdmin,
      userId,
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

  end(code, message) {
    this.ended = { code, message };
  }
}

test('admin snapshots expose room operations without reconnect tokens', (t) => {
  const room = new Room('ADMIN1', false);
  t.after(() => room.destroy());
  const registered = new FakeSocket('registered', '00000000-0000-4000-8000-000000000001', true);
  const guest = new FakeSocket('guest', null);
  room.addPlayer(registered, 'private-registered-token');
  room.addPlayer(guest, 'private-guest-token');

  const snapshot = room.getAdminSnapshot();
  assert.equal(snapshot.phase, 'waiting');
  assert.equal(snapshot.authenticatedCount, 1);
  assert.equal(snapshot.guestCount, 1);
  assert.equal(snapshot.players[0].role, null);
  assert.equal(JSON.stringify(snapshot).includes('private-registered-token'), false);
});

test('suspension removes a live player, records abandonment, and disables rating', (t) => {
  const room = new Room('ADMIN2', true, { matchRecordingEnabled: true });
  t.after(() => room.destroy());
  const sockets = Array.from({ length: 9 }, (_, index) =>
    new FakeSocket(
      `player-${index}`,
      `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      index === 0,
    ),
  );
  sockets.forEach((socket, index) => room.addPlayer(socket, `token-${index}`));
  room.startMatch();
  for (const player of room.state.players) room.handleGameReady(player.id);

  assert.equal(room.getAdminSnapshot().rated, true);
  const targetUserId = sockets[1].data.userId;
  assert.equal(
    room.removeAuthenticatedUser(targetUserId, 'Your account was suspended.'),
    true,
  );

  const snapshot = room.getAdminSnapshot();
  assert.equal(snapshot.rated, false);
  assert.equal(snapshot.playerCount, 8);
  assert.equal(room.matchRoster.find((player) => player.userId === targetUserId).abandoned, true);
  assert.equal(
    sockets[1].sent.some(
      (message) =>
        message.type === 'LOBBY_KICKED' && message.message === 'Your account was suspended.',
    ),
    true,
  );
  assert.deepEqual(sockets[1].ended, { code: 4003, message: 'Account suspended' });
});

test('live administrator role changes update authoritative room permission', (t) => {
  const room = new Room('ADMIN3', false);
  t.after(() => room.destroy());
  const socket = new FakeSocket(
    'player-admin',
    '00000000-0000-4000-8000-000000000099',
    true,
  );
  room.addPlayer(socket, 'admin-role-token');

  assert.equal(room.getAdminSnapshot().players[0].isAdmin, true);
  assert.equal(room.setAuthenticatedUserAdmin(socket.data.userId, false), true);
  assert.equal(room.getAdminSnapshot().players[0].isAdmin, false);
  assert.equal(socket.data.isAdmin, false);
});
