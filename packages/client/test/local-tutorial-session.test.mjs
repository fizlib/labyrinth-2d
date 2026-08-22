import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BRIDGE_WALKWAY_COLUMNS,
  FEET_HITBOX_H,
  generateTutorialMazeLayout,
  getBridgeBankReturnPosition,
  getBridgeCollapseMask,
  getBridgeRepairCircleBounds,
  getBridgeTileBit,
  getBridgeWalkwayTileBounds,
  getChestInteractionPoint,
} from '@labyrinth/shared';

import {
  LocalTutorialSession,
  TUTORIAL_RESCUER_PLAYER_ID,
  TUTORIAL_WARDEN_PLAYER_ID,
} from '../dist/net/LocalTutorialSession.js';

function createCallbacks(overrides = {}) {
  const noop = () => {};
  return new Proxy(overrides, {
    get(target, property) {
      return target[property] ?? noop;
    },
  });
}

test('local tutorial runs the complete wisdom, rune, portal, and escape flow', () => {
  let admittedState = null;
  let wisdomHint = null;
  let portalOpened = 0;
  let escaped = 0;
  const session = new LocalTutorialSession(
    createCallbacks({
      onRoomJoined: (_roomId, _playerId, _seed, role, wisdomOrbs, gameState) => {
        assert.equal(role, 'survivor');
        assert.equal(wisdomOrbs, 3);
        admittedState = gameState;
      },
      onWisdomOrbUsed: (hint, remainingWisdomOrbs) => {
        wisdomHint = { hint, remainingWisdomOrbs };
      },
      onAllRunestonesActivated: () => {
        portalOpened += 1;
      },
      onPlayerEscaped: () => {
        escaped += 1;
      },
    }),
  );

  session.start('Tutorial Tester');
  assert.ok(admittedState);
  assert.equal(admittedState.players.length, 4);
  assert.deepEqual(
    admittedState.players
      .filter((player) => player.id !== 'tutorial-player')
      .map(({ displayName, spriteIndex, teamId }) => ({
        displayName,
        spriteIndex,
        teamId,
      })),
    [
      { displayName: 'Warden', spriteIndex: 3, teamId: 0 },
      { displayName: 'Survivor 1', spriteIndex: 0, teamId: 1 },
      { displayName: 'Survivor 2', spriteIndex: 1, teamId: 2 },
    ],
  );
  assert.equal(admittedState.cageStates.length, 2);
  assert.deepEqual(admittedState.chestStates, [{ chestIndex: 0, opened: false }]);
  assert.deepEqual(
    admittedState.runestones.map((runestone) => runestone.activated),
    [false, true, true],
  );

  session.sendUseWisdomOrb();
  assert.deepEqual(wisdomHint, {
    hint: { kind: 'direction', direction: 'east' },
    remainingWisdomOrbs: 2,
  });

  let sequence = 0;
  const move = (count, direction) => {
    const input = {
      U: [true, false, false, false],
      D: [false, true, false, false],
      L: [false, false, true, false],
      R: [false, false, false, true],
    }[direction];
    for (let index = 0; index < count; index++) {
      session.sendInput(++sequence, ...input, 0.05);
    }
  };

  // Spawn → T-junction → hub → the one inactive rune.
  move(64, 'U');
  move(124, 'R');
  move(4, 'U');
  session.sendActivateRunestone(0);
  assert.equal(portalOpened, 1);
  assert.ok(session.gameState.runestones.every((runestone) => runestone.activated));

  session.sendUseWisdomOrb();
  assert.deepEqual(wisdomHint, {
    hint: { kind: 'direction', direction: 'west' },
    remainingWisdomOrbs: 1,
  });

  // Return through the extended left branch, turn north, and cross the bridge.
  move(4, 'D');
  move(124, 'L');
  move(333, 'L');
  // Pass the chest on its open right side, then align with the bridge walkway.
  move(8, 'R');
  move(360, 'U');
  // Follow the tutorial bridge's deterministic safe stones: its south four
  // rows use the east column, then the route turns west on the second row.
  move(6, 'L');
  move(23, 'U');
  move(4, 'L');
  move(100, 'U');
  session.sendEscapePortal();

  assert.equal(escaped, 1);
  assert.equal(session.gameState.players[0].escaped, true);
  assert.equal(session.gameState.match.escapedCount, 1);
});

test('tutorial Wisdom Orb reveals the safe route across the bridge', () => {
  let wisdomHint = null;
  const session = new LocalTutorialSession(
    createCallbacks({
      onWisdomOrbUsed: (hint, remainingWisdomOrbs) => {
        wisdomHint = { hint, remainingWisdomOrbs };
      },
    }),
  );

  session.start('Bridge Student', true);
  const bridge = generateTutorialMazeLayout().bridges[0];
  const southBank = getBridgeBankReturnPosition(bridge, 'south', 16);
  session.sendDebugTeleport(southBank.x, southBank.y);
  session.sendUseWisdomOrb();

  assert.deepEqual(wisdomHint, {
    hint: {
      kind: 'bridge',
      bridgeIndex: 0,
      entrySide: 'south',
      safeTileMask: bridge.safeTileMask,
    },
    remainingWisdomOrbs: 2,
  });
});

test('tutorial bridge collapses on a cursed stone and repairs from its circle', () => {
  const session = new LocalTutorialSession(createCallbacks());
  session.start('Bridge Repair Student', true);
  const bridge = generateTutorialMazeLayout().bridges[0];
  const failedRow = 5;
  const failedColumn = [0, 1].find(
    (column) => (bridge.safeTileMask & getBridgeTileBit(failedRow, column)) === 0,
  );
  assert.notEqual(failedColumn, undefined);
  const wrongStone = getBridgeWalkwayTileBounds(bridge, failedRow, failedColumn, 16);

  session.sendDebugTeleport(
    (wrongStone.left + wrongStone.right + 1) / 2,
    (wrongStone.top + wrongStone.bottom + 1) / 2 + FEET_HITBOX_H / 2,
  );
  session.sendInput(1, false, false, false, false, 0.01);

  const bridgeState = session.gameState.bridgeStates[0];
  assert.equal(
    bridgeState.wrongTileIndex,
    failedRow * BRIDGE_WALKWAY_COLUMNS + failedColumn,
  );
  assert.equal(bridgeState.collapsedTileMask, getBridgeCollapseMask(5, 'north'));

  session.update(0.2);
  assert.equal(bridgeState.wrongTileIndex, null);

  const southCircle = getBridgeRepairCircleBounds(bridge, 16).find(
    (circle) => circle.side === 'south',
  );
  assert.ok(southCircle);
  const repairPosition = {
    x: (southCircle.left + southCircle.right + 1) / 2,
    y: (southCircle.top + southCircle.bottom + 1) / 2 + FEET_HITBOX_H / 2,
  };
  session.sendDebugTeleport(repairPosition.x, repairPosition.y);
  session.sendInput(2, false, false, false, false, 0.01);
  assert.equal(bridgeState.repairingSide, 'south');
  assert.equal(bridgeState.repairActive, true);

  session.update(1);
  session.sendDebugTeleport(bridge.tileX * 16, bridge.tileY * 16);
  session.update(0.1);
  assert.equal(bridgeState.repairingSide, 'south');
  assert.equal(bridgeState.repairActive, false);

  session.sendDebugTeleport(repairPosition.x, repairPosition.y);
  session.sendInput(3, false, false, false, false, 0.01);
  assert.equal(bridgeState.repairActive, true);
  for (let index = 0; index < 91; index++) session.update(0.1);

  assert.equal(bridgeState.collapsedTileMask, 0);
  assert.equal(bridgeState.repairingSide, null);
  assert.equal(bridgeState.repairActive, false);
  assert.equal(bridgeState.repairingPlayerId, null);
});

test('tutorial Wisdom Orb reveals the firm-ground route in the swamp lesson cell', () => {
  let wisdomHint = null;
  const session = new LocalTutorialSession(
    createCallbacks({
      onWisdomOrbUsed: (hint, remainingWisdomOrbs) => {
        wisdomHint = { hint, remainingWisdomOrbs };
      },
    }),
  );

  session.start('Swamp Student', true);
  session.sendDebugTeleport((68 + 3) * 16, (122 + 3) * 16);
  session.sendUseWisdomOrb();

  assert.deepEqual(wisdomHint, {
    hint: { kind: 'swamp', swampIndex: 0 },
    remainingWisdomOrbs: 2,
  });
});

test('tutorial chest uses the normal interaction and grants one Wisdom Orb', () => {
  const opened = [];
  const rewards = [];
  const session = new LocalTutorialSession(
    createCallbacks({
      onChestOpened: (chestIndex, playerId) => {
        opened.push({ chestIndex, playerId });
      },
      onWisdomOrbGranted: (chestIndex, wisdomOrbs) => {
        rewards.push({ chestIndex, wisdomOrbs });
      },
    }),
  );

  session.start('Treasure Student', true);
  session.sendUseWisdomOrb();
  const chest = generateTutorialMazeLayout().chestDeadEnds[0];
  const interaction = getChestInteractionPoint(chest, 16);
  session.sendDebugTeleport(interaction.x, interaction.y);
  session.sendOpenChest(0);

  assert.deepEqual(opened, [{ chestIndex: 0, playerId: 'tutorial-player' }]);
  assert.deepEqual(rewards, [{ chestIndex: 0, wisdomOrbs: 3 }]);
  assert.deepEqual(session.gameState.chestStates, [{ chestIndex: 0, opened: true }]);
});

test('tutorial Warden lures the player into the occupied trap dead end', () => {
  const chatMessages = [];
  const openedPrisoners = [];
  const seenOpenedCages = new Set();
  let trappedCageId = null;
  const session = new LocalTutorialSession(
    createCallbacks({
      onChatMessage: (playerId, displayName, teamId, text, durationMs) => {
        chatMessages.push({ playerId, displayName, teamId, text, durationMs });
      },
      onPlayerTrapped: (cageId) => {
        trappedCageId = cageId;
      },
      onTickUpdate: (gameState) => {
        for (const cage of gameState.cageStates) {
          if (!cage.opened || seenOpenedCages.has(cage.cageId)) continue;
          seenOpenedCages.add(cage.cageId);
          openedPrisoners.push(cage.prisonerPlayerId);
        }
      },
    }),
  );

  session.start('Curious Survivor', true);
  const trapCell = session.gameState.trapCells[0];
  const player = session.gameState.players[0];
  const warden = session.gameState.players.find(
    (candidate) => candidate.id === TUTORIAL_WARDEN_PLAYER_ID,
  );
  const initialWardenY = warden.y;
  assert.deepEqual(
    session.gameState.cageStates.map((cage) => cage.y),
    [(trapCell.tileY + 4.25) * 16, (trapCell.tileY + 4.25) * 16],
  );

  // Enter the empty cell immediately west of the T-junction.
  session.sendDebugTeleport(
    (trapCell.tileX + 3.5) * 16,
    (trapCell.tileY - 16 + 3.5) * 16,
  );
  session.update(0.05);
  assert.deepEqual(chatMessages, [
    {
      playerId: TUTORIAL_WARDEN_PLAYER_ID,
      displayName: 'Warden',
      teamId: 0,
      text: 'this way',
      durationMs: 2_000,
    },
  ]);

  for (let index = 0; index < 80; index++) session.update(0.05);
  assert.ok(warden.y > initialWardenY);
  assert.equal(warden.isMoving, false);

  // Entering the trap starts the captives' warning before the capture line.
  session.sendDebugTeleport((trapCell.tileX + 3.5) * 16, (trapCell.tileY + 1.5) * 16);
  session.update(0.05);
  assert.equal(trappedCageId, null);
  assert.equal(session.gameState.cageStates.length, 2);
  assert.deepEqual(chatMessages.at(-1), {
    playerId: 'tutorial-captive-1',
    displayName: 'Survivor 1',
    teamId: 1,
    text: 'noo',
    durationMs: undefined,
  });

  session.update(0.19);
  assert.equal(chatMessages.length, 2);
  session.update(0.02);
  assert.deepEqual(chatMessages.at(-1), {
    playerId: 'tutorial-captive-2',
    displayName: 'Survivor 2',
    teamId: 2,
    text: 'run away!',
    durationMs: undefined,
  });

  for (let index = 0; index < 7; index++) session.update(0.1);
  assert.equal(chatMessages.length, 3);
  session.update(0.1);
  assert.deepEqual(chatMessages.at(-1), {
    playerId: TUTORIAL_WARDEN_PLAYER_ID,
    displayName: 'Warden',
    teamId: 0,
    text: 'be silent!',
    durationMs: undefined,
  });

  // The player remains free until their feet are at least two tiles deep.
  session.sendDebugTeleport((trapCell.tileX + 2) * 16, (trapCell.tileY + 1.9) * 16);
  session.update(0.05);
  assert.equal(trappedCageId, null);

  // Crossing the deeper line springs the same closed-cage state used in a round.
  session.sendDebugTeleport((trapCell.tileX + 2) * 16, (trapCell.tileY + 2.25) * 16);
  session.update(0.05);
  assert.equal(trappedCageId, 2);
  assert.equal(session.gameState.cageStates.length, 3);
  assert.deepEqual(
    session.gameState.cageStates.find((cage) => cage.prisonerPlayerId === player.id),
    {
      cageId: 2,
      prisonerPlayerId: 'tutorial-player',
      x: player.x,
      y: player.y,
      opened: false,
      vacated: false,
    },
  );

  const trappedPosition = { x: player.x, y: player.y };
  const wardenTrapY = warden.y;
  session.sendInput(1, false, true, false, false, 0.1);
  assert.deepEqual({ x: player.x, y: player.y }, trappedPosition);

  let returnSteps = 0;
  while (
    session.gameState.players.some(
      (candidate) => candidate.id === TUTORIAL_WARDEN_PLAYER_ID,
    ) &&
    returnSteps < 100
  ) {
    session.update(0.05);
    returnSteps += 1;
  }
  assert.ok(warden.y < wardenTrapY);
  assert.equal(warden.facing, 'up');
  assert.equal(
    session.gameState.players.some(
      (candidate) => candidate.id === TUTORIAL_WARDEN_PLAYER_ID,
    ),
    false,
  );

  for (let index = 0; index < 39; index++) session.update(0.05);
  assert.equal(
    session.gameState.players.some(
      (candidate) => candidate.id === TUTORIAL_RESCUER_PLAYER_ID,
    ),
    false,
  );
  session.update(0.05);
  session.update(0.05);
  const rescuer = session.gameState.players.find(
    (candidate) => candidate.id === TUTORIAL_RESCUER_PLAYER_ID,
  );
  assert.ok(rescuer);
  assert.equal(rescuer.displayName, 'Survivor 3');
  const rescuerStartY = rescuer.y;
  const captiveActors = new Map(
    session.gameState.players
      .filter((candidate) => candidate.id.startsWith('tutorial-captive-'))
      .map((candidate) => [candidate.id, candidate]),
  );
  const playerCage = session.gameState.cageStates.find(
    (cage) => cage.prisonerPlayerId === player.id,
  );

  let rescueSteps = 0;
  while (!playerCage.opened && rescueSteps < 160) {
    session.update(0.05);
    rescueSteps += 1;
  }
  assert.ok(rescuer.y > rescuerStartY);
  assert.equal(rescuer.isMoving, false);
  assert.deepEqual(openedPrisoners, [
    'tutorial-captive-1',
    'tutorial-captive-2',
    'tutorial-player',
  ]);
  assert.ok(session.gameState.cageStates.every((cage) => cage.opened));
  assert.equal(playerCage.vacated, false);

  for (const captiveId of ['tutorial-captive-1', 'tutorial-captive-2']) {
    const captive = captiveActors.get(captiveId);
    const cage = session.gameState.cageStates.find(
      (candidate) => candidate.prisonerPlayerId === captiveId,
    );
    assert.ok(captive.y < cage.y);
  }

  let captiveExitSteps = 0;
  while (
    session.gameState.players.some((candidate) =>
      candidate.id.startsWith('tutorial-captive-'),
    ) &&
    captiveExitSteps < 120
  ) {
    session.update(0.05);
    captiveExitSteps += 1;
  }
  assert.equal(
    session.gameState.players.some((candidate) =>
      candidate.id.startsWith('tutorial-captive-'),
    ),
    false,
  );
  for (const captive of captiveActors.values()) {
    assert.equal(captive.facing, 'up');
  }
  for (const captiveId of ['tutorial-captive-1', 'tutorial-captive-2']) {
    assert.equal(
      session.gameState.cageStates.find(
        (candidate) => candidate.prisonerPlayerId === captiveId,
      ).vacated,
      true,
    );
  }

  for (let index = 0; index < 6; index++) {
    session.sendInput(index + 2, true, false, false, false, 0.05);
  }
  assert.ok(player.y < trappedPosition.y);
  assert.equal(playerCage.vacated, true);
});

test('local tutorial exposes authoritative debug actions only to admins', () => {
  let admittedAsAdmin = false;
  let changedRole = null;
  let inspectedRole = null;
  const session = new LocalTutorialSession(
    createCallbacks({
      onRoomJoined: (
        _roomId,
        _playerId,
        _seed,
        _role,
        _wisdomOrbs,
        _gameState,
        isAdmin,
      ) => {
        admittedAsAdmin = isAdmin;
      },
      onPlayerRoleChanged: (role, wisdomOrbs) => {
        changedRole = { role, wisdomOrbs };
      },
      onDebugPlayerRole: (_playerId, role) => {
        inspectedRole = role;
      },
    }),
  );

  session.start('Tutorial Admin', true);
  assert.equal(admittedAsAdmin, true);

  session.sendDebugTeleport(123, 456);
  session.sendDebugSetMatchTime(90_000);
  session.sendDebugSetNetworkStats(true);
  session.sendDebugPlayerAction('tutorial-player', 'set-skin', { spriteIndex: 2 });
  session.sendDebugPlayerAction('tutorial-player', 'set-squad', { teamId: 1 });
  session.sendDebugPlayerAction('tutorial-player', 'set-dead', { dead: true });
  session.sendDebugPlayerAction('tutorial-player', 'set-role', { role: 'warden' });
  session.sendDebugPlayerAction('tutorial-player', 'get-role');

  assert.equal(session.gameState.players[0].x, 123);
  assert.equal(session.gameState.players[0].y, 456);
  assert.equal(session.gameState.players[0].spriteIndex, 2);
  assert.equal(session.gameState.players[0].teamId, 1);
  assert.equal(session.gameState.players[0].isDead, true);
  assert.equal(session.gameState.match.remainingMs, 90_000);
  assert.equal(session.gameState.networkStatsVisible, true);
  assert.deepEqual(changedRole, { role: 'warden', wisdomOrbs: 0 });
  assert.equal(inspectedRole, 'warden');
});

test('local tutorial rejects debug state changes for non-admin players', () => {
  const session = new LocalTutorialSession(createCallbacks());
  session.start('Tutorial Player');
  const initialPlayer = { ...session.gameState.players[0] };

  session.sendDebugTeleport(123, 456);
  session.sendDebugSetNetworkStats(true);
  session.sendDebugPlayerAction('tutorial-player', 'set-dead', { dead: true });

  assert.equal(session.gameState.players[0].x, initialPlayer.x);
  assert.equal(session.gameState.players[0].y, initialPlayer.y);
  assert.equal(session.gameState.players[0].isDead, false);
  assert.equal(session.gameState.networkStatsVisible, false);
});
