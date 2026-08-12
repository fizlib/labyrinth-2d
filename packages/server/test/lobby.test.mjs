import test from 'node:test';
import assert from 'node:assert/strict';

import { Room } from '../dist/Room.js';

class FakeSocket {
  sent = [];

  constructor(id, isAdmin = false) {
    this.data = {
      id,
      displayName: id,
      roomId: null,
      connected: true,
      joinPending: false,
      isAdmin,
    };
  }

  getUserData() {
    return this.data;
  }

  send(payload) {
    this.sent.push(JSON.parse(payload));
  }
}

function createLobby(playerCount) {
  const room = new Room(`lobby-${Math.random()}`);
  const sockets = [];
  for (let index = 0; index < playerCount; index++) {
    const socket = new FakeSocket(`player-${index}`);
    sockets.push(socket);
    room.addPlayer(socket);
  }
  return { room, sockets };
}

test('players remain in an event-driven lobby until a start condition is met', (t) => {
  const { room, sockets } = createLobby(2);
  t.after(() => room.destroy());

  assert.equal(room.state.match.status, 'waiting');
  assert.equal(room.loopHandle, null);
  const joined = sockets[0].sent.find((message) => message.type === 'LOBBY_JOINED');
  assert.equal(joined.lobby.roomId, room.id);
  assert.equal(joined.isAdmin, false);
  assert.equal(joined.lobby.players.length, 1);
  const latest = sockets[0].sent.findLast((message) => message.type === 'LOBBY_UPDATED');
  assert.equal(latest.lobby.players.length, 2);
});

test('only admins can bypass lobby population and voting requirements', (t) => {
  const regularRoom = new Room(`regular-${Math.random()}`);
  const regularSocket = new FakeSocket('regular-player');
  regularRoom.addPlayer(regularSocket);
  t.after(() => regularRoom.destroy());

  regularRoom.handleAdminStartGame('regular-player');
  assert.equal(regularRoom.state.match.status, 'waiting');

  const adminRoom = new Room(`admin-${Math.random()}`);
  const adminSocket = new FakeSocket('admin-player', true);
  adminRoom.addPlayer(adminSocket);
  t.after(() => adminRoom.destroy());

  const joined = adminSocket.sent.find((message) => message.type === 'LOBBY_JOINED');
  assert.equal(joined.isAdmin, true);
  adminRoom.handleAdminStartGame('admin-player');
  assert.equal(adminRoom.state.match.status, 'running');
  assert.ok(adminSocket.sent.some((message) => message.type === 'ROOM_JOINED'));
});

test('six players can vote into a countdown and receive balanced private match seats', (t) => {
  const { room, sockets } = createLobby(6);
  t.after(() => room.destroy());
  room.lobbyVoteAvailableAtMs = Date.now() - 1;

  for (let index = 0; index < 4; index++) {
    room.handleVoteToStart(`player-${index}`, { type: 'VOTE_TO_START', vote: true });
  }

  const countdown = sockets[0].sent.findLast(
    (message) => message.type === 'LOBBY_UPDATED',
  );
  assert.equal(countdown.lobby.phase, 'countdown');
  assert.equal(countdown.lobby.startReason, 'vote');

  room.startMatch();
  assert.equal(room.state.match.status, 'running');
  assert.deepEqual(
    room.state.players.reduce((counts, player) => {
      counts[player.teamId] = (counts[player.teamId] ?? 0) + 1;
      return counts;
    }, {}),
    { 0: 2, 1: 2, 2: 2 },
  );
  assert.equal(room.state.players.filter((player) => player.role === 'warden').length, 1);
  for (const socket of sockets) {
    const joined = socket.sent.find((message) => message.type === 'ROOM_JOINED');
    assert.ok(joined);
    assert.equal(joined.gameState.players.length, 6);
  }
});

test('seven-player starts keep two wardens in different squads', (t) => {
  const { room } = createLobby(7);
  t.after(() => room.destroy());
  room.startMatch();

  const wardens = room.state.players.filter((player) => player.role === 'warden');
  assert.equal(wardens.length, 2);
  assert.notEqual(wardens[0].teamId, wardens[1].teamId);
  assert.deepEqual(
    room.state.players
      .reduce((counts, player) => {
        counts[player.teamId] = (counts[player.teamId] ?? 0) + 1;
        return counts;
      }, [])
      .sort(),
    [2, 2, 3],
  );
});

test('lobby chat is room-wide, normalized, and rate limited', (t) => {
  const { room, sockets } = createLobby(3);
  t.after(() => room.destroy());

  room.handleSendLobbyChatMessage('player-0', {
    type: 'SEND_LOBBY_CHAT',
    text: '  hello\nexplorers  ',
  });
  room.handleSendLobbyChatMessage('player-0', {
    type: 'SEND_LOBBY_CHAT',
    text: 'too soon',
  });

  for (const socket of sockets) {
    const messages = socket.sent.filter((message) => message.type === 'LOBBY_CHAT_MESSAGE');
    assert.equal(messages.length, 1);
    assert.equal(messages[0].text, 'hello explorers');
  }
});
