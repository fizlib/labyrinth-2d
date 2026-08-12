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

function createLobby(playerCount, options) {
  const room = new Room(`lobby-${Math.random()}`, false, options);
  const sockets = [];
  for (let index = 0; index < playerCount; index++) {
    const socket = new FakeSocket(`player-${index}`);
    sockets.push(socket);
    room.addPlayer(socket, `token-${index}`);
  }
  return { room, sockets };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  regularRoom.addPlayer(regularSocket, 'regular-token');
  t.after(() => regularRoom.destroy());

  regularRoom.handleAdminStartGame('regular-player');
  assert.equal(regularRoom.state.match.status, 'waiting');

  const adminRoom = new Room(`admin-${Math.random()}`);
  const adminSocket = new FakeSocket('admin-player', true);
  adminRoom.addPlayer(adminSocket, 'admin-token');
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

test('a lobby disconnect reserves the seat, cancels countdown, and resumes the same identity', (t) => {
  const { room, sockets } = createLobby(9);
  t.after(() => room.destroy());
  assert.notEqual(room.countdownHandle, null);
  room.lobbyVotes.add('player-1');

  assert.equal(room.disconnectPlayer('player-0', sockets[0]), true);
  assert.equal(room.playerCount, 9);
  assert.equal(room.connectedPlayerCount, 8);
  assert.equal(room.countdownHandle, null);
  assert.equal(room.lobbyVotes.size, 0);
  assert.equal(room.isFull, true);

  const disconnectedState = sockets[1].sent.findLast(
    (message) => message.type === 'LOBBY_UPDATED',
  ).lobby;
  assert.equal(
    disconnectedState.players.find((player) => player.id === 'player-0').connected,
    false,
  );

  const replacement = new FakeSocket('temporary-id');
  assert.equal(room.reconnectPlayer(replacement, 'token-0'), 'resumed');
  assert.equal(replacement.data.id, 'player-0');
  assert.equal(room.connectedPlayerCount, 9);
  assert.notEqual(room.countdownHandle, null, 'a full connected roster starts a fresh countdown');
  assert.ok(replacement.sent.some((message) => message.type === 'LOBBY_JOINED'));
  assert.equal(room.disconnectPlayer('player-0', sockets[0]), false, 'stale closes are ignored');
  assert.equal(room.connectedPlayerCount, 9);
});

test('reserved seats cannot be replaced and live seats cannot be reclaimed twice', (t) => {
  const { room, sockets } = createLobby(9);
  t.after(() => room.destroy());
  room.disconnectPlayer('player-0', sockets[0]);

  const outsider = new FakeSocket('outsider');
  assert.equal(room.addPlayer(outsider, 'outsider-token'), false);

  const replacement = new FakeSocket('temporary-id');
  assert.equal(room.reconnectPlayer(replacement, 'token-0'), 'resumed');
  assert.equal(room.reconnectPlayer(new FakeSocket('duplicate'), 'token-0'), 'in-use');
  assert.equal(room.reconnectPlayer(new FakeSocket('unknown'), 'missing-token'), 'not-found');
});

test('active-match reconnect preserves private state and victory thresholds', (t) => {
  const { room, sockets } = createLobby(6);
  t.after(() => room.destroy());
  room.startMatch();

  const player = room.state.players.find((candidate) => candidate.id === 'player-0');
  assert.ok(player);
  player.x += 37;
  player.y += 19;
  player.wisdomOrbs = 2;
  const threshold = room.state.match.escapeThreshold;

  room.disconnectPlayer(player.id, sockets[0]);
  assert.equal(room.state.players.includes(player), true);
  assert.equal(player.connected, false);
  assert.equal(player.isMoving, false);
  assert.equal(room.state.match.escapeThreshold, threshold);

  const replacement = new FakeSocket('replacement');
  assert.equal(room.reconnectPlayer(replacement, 'token-0'), 'resumed');
  const joined = replacement.sent.find((message) => message.type === 'ROOM_JOINED');
  assert.ok(joined);
  assert.equal(joined.playerId, player.id);
  assert.equal(joined.role, player.role);
  assert.equal(joined.wisdomOrbs, 2);
  assert.equal(joined.gameState.players.find((candidate) => candidate.id === player.id).x, player.x);
  assert.equal(joined.gameState.players.find((candidate) => candidate.id === player.id).connected, true);
});

test('temporarily disconnected match players are inert in occupancy interactions', (t) => {
  const { room, sockets } = createLobby(6);
  t.after(() => room.destroy());
  room.startMatch();

  const disconnectedSurvivor = room.state.players.find(
    (player) => player.id === 'player-0',
  );
  const connectedWarden = room.state.players.find(
    (player) => player.id === 'player-1',
  );
  assert.ok(disconnectedSurvivor);
  assert.ok(connectedWarden);
  disconnectedSurvivor.role = 'survivor';
  connectedWarden.role = 'warden';

  const trap = room.trapCells[0];
  assert.ok(trap);
  const trapX = (trap.tileX + 3) * room.map.tileSize;
  const trapY = (trap.tileY + 3) * room.map.tileSize;
  disconnectedSurvivor.x = trapX;
  disconnectedSurvivor.y = trapY;
  connectedWarden.x = trapX;
  connectedWarden.y = trapY;

  assert.equal(room.disconnectPlayer(disconnectedSurvivor.id, sockets[0]), true);
  room.handleActivateTrapCell(connectedWarden.id, {
    type: 'ACTIVATE_TRAP_CELL',
    trapCellIndex: 0,
  });
  assert.equal(
    room.cageStates.some((cage) => cage.prisonerPlayerId === disconnectedSurvivor.id),
    false,
  );

  const plate = room.pressurePlates[0];
  assert.ok(plate);
  for (const player of room.state.players) {
    player.x = 0;
    player.y = 0;
  }
  disconnectedSurvivor.x = (plate.tileX + 0.5) * room.map.tileSize;
  disconnectedSurvivor.y = (plate.tileY + 0.5) * room.map.tileSize;
  room.updateGateStates();
  assert.equal(
    room.pressurePlateStates.find((state) => state.plateId === plate.id).pressed,
    false,
  );
});

test('active-match expiry performs the final removal only after grace', async (t) => {
  const { room, sockets } = createLobby(6, { reconnectGraceMs: 15 });
  t.after(() => room.destroy());
  room.startMatch();
  const player = room.state.players.find((candidate) => candidate.id === 'player-0');
  assert.ok(player);
  const originalThreshold = room.state.match.escapeThreshold;

  room.disconnectPlayer(player.id, sockets[0]);
  assert.equal(room.state.players.some((candidate) => candidate.id === player.id), true);
  assert.equal(room.state.match.escapeThreshold, originalThreshold);

  await delay(30);
  assert.equal(room.state.players.some((candidate) => candidate.id === player.id), false);
  assert.ok(sockets[1].sent.some(
    (message) => message.type === 'PLAYER_LEFT' && message.playerId === player.id,
  ));
});

test('grace expiry and explicit leave permanently release seats', async (t) => {
  let emptyNotifications = 0;
  const { room, sockets } = createLobby(1, {
    reconnectGraceMs: 15,
    onEmpty: () => { emptyNotifications++; },
  });
  t.after(() => room.destroy());

  room.disconnectPlayer('player-0', sockets[0]);
  await delay(30);
  assert.equal(room.playerCount, 0);
  assert.equal(emptyNotifications, 1);

  const explicitRoom = new Room(`explicit-${Math.random()}`, false, {
    reconnectGraceMs: 15,
  });
  t.after(() => explicitRoom.destroy());
  const explicitSocket = new FakeSocket('explicit-player');
  explicitRoom.addPlayer(explicitSocket, 'explicit-token');
  assert.equal(explicitRoom.removePlayer('explicit-player'), true);
  assert.equal(explicitRoom.playerCount, 0);
  await delay(25);
  assert.equal(explicitRoom.reconnectPlayer(new FakeSocket('late'), 'explicit-token'), 'not-found');
});

test('ended matches can be reclaimed during the grace window', (t) => {
  const { room, sockets } = createLobby(6);
  t.after(() => room.destroy());
  room.startMatch();
  room.endMatch('wardens', Date.now());
  room.disconnectPlayer('player-0', sockets[0]);

  const replacement = new FakeSocket('replacement');
  assert.equal(room.reconnectPlayer(replacement, 'token-0'), 'resumed');
  const joined = replacement.sent.find((message) => message.type === 'ROOM_JOINED');
  assert.equal(joined.gameState.match.status, 'ended');
  assert.equal(joined.gameState.match.winner, 'wardens');
});
