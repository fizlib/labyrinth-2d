import {
  TILE_SIZE,
  CELL_SIZE,
  CELL_STEP_Y,
  CHEST_INTERACTION_RANGE,
  BRIDGE_WALKWAY_ROWS,
  BRIDGE_WALKWAY_COLUMNS,
  BRIDGE_REPAIR_DURATION_MS,
  BRIDGE_FAILURE_FEEDBACK_DURATION_MS,
  FEET_HITBOX_W,
  FEET_HITBOX_H,
  SQUAD_COLORS,
  MAX_WISDOM_ORBS,
  PLAYER_SPEED,
  PLAYER_CHARACTER_COUNT,
  applyInputWithCollision,
  isPositionValid,
  computePortalDistanceField,
  deriveFacingDirection,
  findBridgeWisdomHintTarget,
  findSwampWisdomHintTarget,
  generateTutorialMazeLayout,
  getCentralHubRunestonePlacements,
  getCageInteractionPoint,
  getChestInteractionPoint,
  getChestWisdomOrbReward,
  getBridgeBankReturnPosition,
  getBridgeCollapseMask,
  getBridgeRepairCircleBounds,
  getBridgeRepairCollapsedMask,
  getBridgeSafeRowFeetCenter,
  getBridgeTileBit,
  getBridgeWalkwayTileAtPoint,
  getBridgeWalkwayTileBounds,
  getBridgeWalkwayTileMaskAtFeetCenter,
  getNavigationDirectionForPosition,
  getTrapCellPlacementAtWorldPoint,
  findActivePlayerCage,
  hasPrisonerExitedCage,
  isPlayerInTrapCell,
  isWithinPortalInteractionRange,
  type DebugPlayerAction,
  type DebugPlayerActionMessage,
  type CageState,
  type BridgeEntrySide,
  type GameState,
  type HubDirection,
  type PlayerInfo,
  type PlayerRole,
  type TutorialMazeLayout,
} from '@labyrinth/shared';

import type { NetworkCallbacks } from './NetworkManager';
import type { NetworkDiagnostics } from './NetworkDiagnosticsTracker';

export const TUTORIAL_ROOM_ID = 'TUTORIAL';
export const TUTORIAL_PLAYER_ID = 'tutorial-player';
export const TUTORIAL_WARDEN_PLAYER_ID = 'tutorial-warden';
export const TUTORIAL_RESCUER_PLAYER_ID = 'tutorial-survivor-3';
export const TUTORIAL_MAP_SEED = 0x7475746f;
const TUTORIAL_CAPTIVE_PLAYER_IDS = ['tutorial-captive-1', 'tutorial-captive-2'] as const;
const DEBUG_MAX_MATCH_TIME_MS = 24 * 60 * 60 * 1_000;
const TUTORIAL_INITIAL_WISDOM_ORBS = MAX_WISDOM_ORBS;
const TUTORIAL_WARDEN_CHAT_DURATION_MS = 2_000;
const TUTORIAL_CAPTIVE_WARNING_DELAY_SECONDS = 0.2;
const TUTORIAL_WARDEN_SILENCE_DELAY_SECONDS = 1;
const TUTORIAL_TRAP_CAPTURE_DEPTH_TILES = 2;
const TUTORIAL_CAPTIVE_CAGE_Y_OFFSET_TILES = 4.25;
const TUTORIAL_RESCUE_DELAY_SECONDS = 2;
const TUTORIAL_RESCUER_APPROACH_NORTH_OFFSET = 24;
const TUTORIAL_RESCUE_ORDER = [
  ...TUTORIAL_CAPTIVE_PLAYER_IDS,
  TUTORIAL_PLAYER_ID,
] as const;
const TUTORIAL_NPC_PATH_STEP = 4;
const TUTORIAL_NPC_PATH_MARGIN = TILE_SIZE * 3;

interface TutorialNpcPath {
  targetX: number;
  targetY: number;
  cageSignature: string;
  waypoints: Array<{ x: number; y: number }>;
}

interface TutorialBridgeTraversal {
  bridgeIndex: number;
  entrySide: BridgeEntrySide;
  lastTileMask: number;
  completed: boolean;
}

interface TutorialBridgeRepair {
  activeElapsedMs: number;
  initialCollapsedTileMask: number;
  orderSide: BridgeEntrySide;
  channelSide: BridgeEntrySide;
  repairingPlayerId: string | null;
}

/**
 * A tiny authoritative session that mirrors the multiplayer transport API while
 * keeping the tutorial entirely inside the browser.
 */
export class LocalTutorialSession {
  private readonly layout: TutorialMazeLayout = generateTutorialMazeLayout();
  private state: GameState | null = null;
  private connected = false;
  private isAdmin = false;
  private role: PlayerRole = 'survivor';
  private wisdomOrbs = TUTORIAL_INITIAL_WISDOM_ORBS;
  private readonly revealedWisdomBridges = new Set<number>();
  private readonly revealedWisdomSwamps = new Set<number>();
  private readonly bridgeTraversals = new Map<string, TutorialBridgeTraversal>();
  private readonly bridgeRepairOccupancy = new Map<string, string>();
  private readonly bridgeRepairs = new Map<number, TutorialBridgeRepair>();
  private readonly bridgeFailureFeedbackRemainingMs = new Map<number, number>();
  private wardenEncounterStarted = false;
  private wardenReachedTrapCell = false;
  private wardenReturning = false;
  private wardenDisappeared = false;
  private rescueDelayElapsed = 0;
  private rescuerSpawned = false;
  private rescueTargetIndex = 0;
  private rescuerRoutePhase: 'safe-lane' | 'approach' | 'retreat' = 'safe-lane';
  private rescuerApproachPoint: { x: number; y: number } | null = null;
  private readonly npcPaths = new Map<string, TutorialNpcPath>();
  private trapDialogueStage = 0;
  private trapDialogueElapsed = 0;
  private localPlayerTrapped = false;
  private nextCageId = TUTORIAL_CAPTIVE_PLAYER_IDS.length;

  constructor(private readonly callbacks: NetworkCallbacks) {}

  get gameState(): GameState | null {
    return this.state;
  }

  get playerId(): string | null {
    return this.connected ? TUTORIAL_PLAYER_ID : null;
  }

  get isConnected(): boolean {
    return this.connected;
  }

  start(displayName: string, isAdmin = false): void {
    if (this.connected) return;
    this.isAdmin = isAdmin;
    this.role = 'survivor';
    this.wisdomOrbs = TUTORIAL_INITIAL_WISDOM_ORBS;
    this.revealedWisdomBridges.clear();
    this.revealedWisdomSwamps.clear();
    this.bridgeTraversals.clear();
    this.bridgeRepairOccupancy.clear();
    this.bridgeRepairs.clear();
    this.bridgeFailureFeedbackRemainingMs.clear();
    this.wardenEncounterStarted = false;
    this.wardenReachedTrapCell = false;
    this.wardenReturning = false;
    this.wardenDisappeared = false;
    this.rescueDelayElapsed = 0;
    this.rescuerSpawned = false;
    this.rescueTargetIndex = 0;
    this.rescuerRoutePhase = 'safe-lane';
    this.rescuerApproachPoint = null;
    this.npcPaths.clear();
    this.trapDialogueStage = 0;
    this.trapDialogueElapsed = 0;
    this.localPlayerTrapped = false;
    this.nextCageId = TUTORIAL_CAPTIVE_PLAYER_IDS.length;
    const spawn = this.layout.landmarks.spawnPoint;
    const player: PlayerInfo = {
      id: TUTORIAL_PLAYER_ID,
      displayName,
      teamId: 0,
      spriteIndex: 0,
      x: (spawn.x + 0.5) * TILE_SIZE,
      y: (spawn.y + 0.5) * TILE_SIZE,
      facing: 'up',
      isMoving: false,
      connected: true,
      isDead: false,
      escaped: false,
      lastProcessedInput: 0,
    };
    const trapCell = this.layout.trapCells[0];
    if (!trapCell) throw new Error('Tutorial trap cell is missing');
    const encounterCellTileY = trapCell.tileY - CELL_STEP_Y;
    const encounterCenterX = (trapCell.tileX + CELL_SIZE / 2 + 0.5) * TILE_SIZE;
    const encounterCenterY = (encounterCellTileY + CELL_SIZE / 2 + 0.5) * TILE_SIZE;
    const captiveY = (trapCell.tileY + TUTORIAL_CAPTIVE_CAGE_Y_OFFSET_TILES) * TILE_SIZE;
    const warden: PlayerInfo = {
      id: TUTORIAL_WARDEN_PLAYER_ID,
      displayName: 'Warden',
      teamId: 0,
      spriteIndex: 3,
      x: encounterCenterX,
      y: encounterCenterY,
      facing: 'down',
      isMoving: false,
      connected: true,
      isDead: false,
      escaped: false,
      lastProcessedInput: 0,
    };
    const captivePlayers: PlayerInfo[] = TUTORIAL_CAPTIVE_PLAYER_IDS.map((id, index) => ({
      id,
      displayName: `Survivor ${index + 1}`,
      teamId: index + 1,
      spriteIndex: index,
      x: encounterCenterX + (index === 0 ? -24 : 24),
      y: captiveY,
      facing: 'down',
      isMoving: false,
      connected: true,
      isDead: false,
      escaped: false,
      lastProcessedInput: 0,
    }));
    const portal = this.layout.landmarks.portalPosition;
    this.state = {
      tick: 0,
      match: {
        status: 'running',
        remainingMs: 0,
        escapedCount: 0,
        escapeThreshold: 1,
        winner: null,
        finalRoster: null,
      },
      networkStatsVisible: false,
      players: [player, warden, ...captivePlayers],
      runestones: getCentralHubRunestonePlacements(this.layout.map).map((placement) => ({
        index: placement.index,
        squadColor: SQUAD_COLORS[placement.index],
        tileX: placement.tileX,
        tileY: placement.tileY,
        activated: placement.index !== player.teamId,
      })),
      portal: {
        x: portal.x * TILE_SIZE,
        y: portal.y * TILE_SIZE,
      },
      gateStates: [],
      pressurePlateStates: [],
      bridgeStates: this.layout.bridges.map((_, bridgeIndex) => ({
        bridgeIndex,
        collapsedTileMask: 0,
        wrongTileIndex: null,
        repairingSide: null,
        repairActive: false,
        repairingPlayerId: null,
        repairStartedTick: null,
        repairInitialCollapsedTileMask: 0,
      })),
      chestStates: this.layout.chestDeadEnds.map((_, chestIndex) => ({
        chestIndex,
        opened: false,
      })),
      swordFieldStates: [],
      spikeGateStates: [],
      spikePlateStates: [],
      cageStates: captivePlayers.map((captive, cageId) => ({
        cageId,
        prisonerPlayerId: captive.id,
        x: captive.x,
        y: captive.y,
        opened: false,
        vacated: false,
      })),
      trapCells: this.layout.trapCells.map((placement) => ({ ...placement })),
    };
    this.connected = true;
    this.callbacks.onConnectionState({ status: 'connected' });
    this.callbacks.onRoomJoined(
      TUTORIAL_ROOM_ID,
      TUTORIAL_PLAYER_ID,
      TUTORIAL_MAP_SEED,
      'survivor',
      this.wisdomOrbs,
      structuredClone(this.state),
      this.isAdmin,
      false,
    );
  }

  leaveRoom(): void {
    this.connected = false;
  }

  getNetworkDiagnostics(): NetworkDiagnostics {
    return {
      movementMessagesPerSecond: 0,
      snapshotMessagesPerSecond: 0,
      snapshotApplicationsPerSecond: 0,
      coalescedSnapshotsPerSecond: 0,
      snapshotAgeMs: null,
      bufferedAmount: 0,
    };
  }

  update(dt: number): void {
    const state = this.state;
    const player = state?.players[0];
    const warden = state?.players.find(
      (candidate) => candidate.id === TUTORIAL_WARDEN_PLAYER_ID,
    );
    let rescuer = state?.players.find(
      (candidate) => candidate.id === TUTORIAL_RESCUER_PLAYER_ID,
    );
    const firstCaptive = state?.players.find(
      (candidate) => candidate.id === TUTORIAL_CAPTIVE_PLAYER_IDS[0],
    );
    const secondCaptive = state?.players.find(
      (candidate) => candidate.id === TUTORIAL_CAPTIVE_PLAYER_IDS[1],
    );
    const trapCell = this.layout.trapCells[0];
    if (
      !this.connected ||
      !state ||
      !player ||
      !trapCell ||
      !Number.isFinite(dt) ||
      dt <= 0
    ) {
      return;
    }
    if (!warden && !this.wardenDisappeared) return;

    let changed = false;
    if (this.advanceBridgeStates(player, dt)) changed = true;
    let wardenDisappearedThisUpdate = false;
    const occupiedCell = getTrapCellPlacementAtWorldPoint(player.x, player.y, TILE_SIZE);
    if (
      warden &&
      !this.wardenEncounterStarted &&
      occupiedCell?.cellX === trapCell.cellX &&
      occupiedCell.cellY === trapCell.cellY - 1
    ) {
      this.wardenEncounterStarted = true;
      this.callbacks.onChatMessage(
        warden.id,
        warden.displayName,
        warden.teamId,
        'this way',
        TUTORIAL_WARDEN_CHAT_DURATION_MS,
      );
    }

    if (warden && this.wardenEncounterStarted && !this.wardenReachedTrapCell) {
      const destinationY = (trapCell.tileY + 1.25) * TILE_SIZE;
      const stepSeconds = Math.min(dt, 0.1);
      const remainingY = destinationY - warden.y;
      if (remainingY <= PLAYER_SPEED * stepSeconds) {
        warden.y = destinationY;
        warden.facing = 'down';
        warden.isMoving = false;
        this.wardenReachedTrapCell = true;
      } else {
        const result = applyInputWithCollision(
          warden.x,
          warden.y,
          { up: false, down: true, left: false, right: false },
          stepSeconds,
          this.layout.map,
          state.portal,
          this.layout.bridges,
          state.bridgeStates,
          this.layout.swamps,
          this.layout.chestDeadEnds,
          this.layout.swordFields,
          state.swordFieldStates,
          state.cageStates,
          warden.id,
          this.layout.tIntersectionDecorations,
          this.layout.decoratedVerticalPassages,
          this.layout.spikeGateObstacles,
          state.spikeGateStates,
        );
        warden.x = result.x;
        warden.y = result.y;
        warden.facing = 'down';
        warden.isMoving = true;
      }
      changed = true;
    }

    const playerInsideTrapCell = isPlayerInTrapCell(
      trapCell,
      player.x,
      player.y,
      TILE_SIZE,
    );
    const trapDialogueStartedThisUpdate =
      this.trapDialogueStage === 0 && playerInsideTrapCell;
    if (trapDialogueStartedThisUpdate) {
      this.trapDialogueStage = 1;
      this.trapDialogueElapsed = 0;
      if (firstCaptive) {
        this.callbacks.onChatMessage(
          firstCaptive.id,
          firstCaptive.displayName,
          firstCaptive.teamId,
          'noo',
        );
      }
    }

    if (this.trapDialogueStage > 0 && !trapDialogueStartedThisUpdate) {
      this.trapDialogueElapsed += dt;
      if (
        this.trapDialogueStage === 1 &&
        this.trapDialogueElapsed >= TUTORIAL_CAPTIVE_WARNING_DELAY_SECONDS
      ) {
        this.trapDialogueStage = 2;
        if (secondCaptive) {
          this.callbacks.onChatMessage(
            secondCaptive.id,
            secondCaptive.displayName,
            secondCaptive.teamId,
            'run away!',
          );
        }
      }
      if (
        this.trapDialogueStage === 2 &&
        this.trapDialogueElapsed >= TUTORIAL_WARDEN_SILENCE_DELAY_SECONDS
      ) {
        this.trapDialogueStage = 3;
        if (warden) {
          this.callbacks.onChatMessage(
            warden.id,
            warden.displayName,
            warden.teamId,
            'be silent!',
          );
        }
      }
    }

    let trappedCageId: number | null = null;
    const captureLineY = (trapCell.tileY + TUTORIAL_TRAP_CAPTURE_DEPTH_TILES) * TILE_SIZE;
    if (
      !this.localPlayerTrapped &&
      playerInsideTrapCell &&
      player.y - 1 >= captureLineY
    ) {
      trappedCageId = this.nextCageId++;
      state.cageStates.push({
        cageId: trappedCageId,
        prisonerPlayerId: player.id,
        x: player.x,
        y: player.y,
        opened: false,
        vacated: false,
      });
      player.isMoving = false;
      this.localPlayerTrapped = true;
      changed = true;
    }

    if (
      this.localPlayerTrapped &&
      this.trapDialogueStage >= 3 &&
      !this.wardenReturning &&
      !this.wardenDisappeared
    ) {
      this.wardenReturning = true;
    }

    if (warden && this.wardenReturning && !this.wardenDisappeared) {
      const stepSeconds = Math.min(dt, 0.1);
      const result = applyInputWithCollision(
        warden.x,
        warden.y,
        { up: true, down: false, left: false, right: false },
        stepSeconds,
        this.layout.map,
        state.portal,
        this.layout.bridges,
        state.bridgeStates,
        this.layout.swamps,
        this.layout.chestDeadEnds,
        this.layout.swordFields,
        state.swordFieldStates,
        state.cageStates,
        warden.id,
        this.layout.tIntersectionDecorations,
        this.layout.decoratedVerticalPassages,
        this.layout.spikeGateObstacles,
        state.spikeGateStates,
      );
      warden.x = result.x;
      warden.y = result.y;
      warden.facing = 'up';
      warden.isMoving = true;
      changed = true;

      const wardenCell = getTrapCellPlacementAtWorldPoint(warden.x, warden.y, TILE_SIZE);
      if (
        wardenCell?.cellX === trapCell.cellX &&
        wardenCell.cellY === trapCell.cellY - 1
      ) {
        state.players = state.players.filter(
          (candidate) => candidate.id !== TUTORIAL_WARDEN_PLAYER_ID,
        );
        this.wardenReturning = false;
        this.wardenDisappeared = true;
        wardenDisappearedThisUpdate = true;
      }
    }

    if (this.wardenDisappeared && !this.rescuerSpawned && !wardenDisappearedThisUpdate) {
      this.rescueDelayElapsed += dt;
      if (this.rescueDelayElapsed >= TUTORIAL_RESCUE_DELAY_SECONDS) {
        const encounterCellTileY = trapCell.tileY - CELL_STEP_Y;
        rescuer = {
          id: TUTORIAL_RESCUER_PLAYER_ID,
          displayName: 'Survivor 3',
          teamId: 0,
          spriteIndex: 2,
          x: (trapCell.tileX + CELL_SIZE / 2 + 0.5) * TILE_SIZE,
          y: (encounterCellTileY + CELL_SIZE / 2 + 0.5) * TILE_SIZE,
          facing: 'down',
          isMoving: true,
          connected: true,
          isDead: false,
          escaped: false,
          lastProcessedInput: 0,
        };
        state.players.push(rescuer);
        this.rescuerSpawned = true;
        changed = true;
      }
    }

    if (rescuer && this.rescueTargetIndex < TUTORIAL_RESCUE_ORDER.length) {
      const prisonerId = TUTORIAL_RESCUE_ORDER[this.rescueTargetIndex];
      const cage = state.cageStates.find(
        (candidate) => candidate.prisonerPlayerId === prisonerId,
      );
      if (cage) {
        const safeLaneY =
          Math.min(...state.cageStates.map((candidate) => candidate.y)) -
          TUTORIAL_RESCUER_APPROACH_NORTH_OFFSET;
        if (this.rescuerRoutePhase === 'approach' && !this.rescuerApproachPoint) {
          this.rescuerApproachPoint = this.findCageApproachPoint(rescuer, cage, state);
        }
        const targetX =
          this.rescuerRoutePhase === 'approach'
            ? (this.rescuerApproachPoint?.x ?? cage.x)
            : rescuer.x;
        const targetY =
          this.rescuerRoutePhase === 'approach'
            ? (this.rescuerApproachPoint?.y ?? cage.y - 20)
            : safeLaneY;
        const reachedTarget = this.moveNpcToward(rescuer, targetX, targetY, dt, state);
        changed = true;
        if (reachedTarget && this.rescuerRoutePhase === 'safe-lane') {
          this.rescuerRoutePhase = 'approach';
        } else if (reachedTarget && this.rescuerRoutePhase === 'retreat') {
          this.rescuerRoutePhase = 'approach';
          this.rescuerApproachPoint = null;
        } else if (reachedTarget) {
          rescuer.isMoving = false;
          cage.opened = true;
          this.rescueTargetIndex += 1;
          this.rescuerApproachPoint = null;
          if (this.rescueTargetIndex < TUTORIAL_RESCUE_ORDER.length) {
            this.rescuerRoutePhase = 'retreat';
          }
        }
      }
    }

    if (this.rescueTargetIndex > 0) {
      for (const captiveId of TUTORIAL_CAPTIVE_PLAYER_IDS) {
        const captive = state.players.find((candidate) => candidate.id === captiveId);
        const cage = state.cageStates.find(
          (candidate) => candidate.prisonerPlayerId === captiveId,
        );
        if (!captive || !cage || !cage.opened) continue;

        const encounterCellTileY = trapCell.tileY - CELL_STEP_Y;
        this.moveNpcToward(
          captive,
          cage.x,
          (encounterCellTileY + CELL_SIZE / 2 + 0.5) * TILE_SIZE,
          dt,
          state,
        );
        if (!cage.vacated && hasPrisonerExitedCage(cage, captive.y)) {
          cage.vacated = true;
        }

        const captiveCell = getTrapCellPlacementAtWorldPoint(
          captive.x,
          captive.y,
          TILE_SIZE,
        );
        if (
          captiveCell?.cellX === trapCell.cellX &&
          captiveCell.cellY === trapCell.cellY - 1
        ) {
          state.players = state.players.filter((candidate) => candidate.id !== captiveId);
          this.npcPaths.delete(captiveId);
        }
        changed = true;
      }
    }

    if (changed) this.emitSnapshot();
    if (trappedCageId !== null) this.callbacks.onPlayerTrapped(trappedCageId);
  }

  private moveNpcToward(
    npc: PlayerInfo,
    targetX: number,
    targetY: number,
    dt: number,
    state: GameState,
  ): boolean {
    if (Math.abs(targetX - npc.x) < 0.01 && Math.abs(targetY - npc.y) < 0.01) {
      npc.x = targetX;
      npc.y = targetY;
      npc.isMoving = false;
      this.npcPaths.delete(npc.id);
      return true;
    }

    const cageSignature = state.cageStates
      .map(
        (cage) =>
          `${cage.cageId}:${cage.x}:${cage.y}:${Number(cage.opened)}:${Number(cage.vacated)}`,
      )
      .join('|');
    let path = this.npcPaths.get(npc.id);
    if (
      !path ||
      path.targetX !== targetX ||
      path.targetY !== targetY ||
      path.cageSignature !== cageSignature
    ) {
      path = {
        targetX,
        targetY,
        cageSignature,
        waypoints: this.findNpcPath(npc, targetX, targetY, state),
      };
      this.npcPaths.set(npc.id, path);
    }

    while (
      path.waypoints[0] &&
      Math.abs(path.waypoints[0].x - npc.x) < 0.01 &&
      Math.abs(path.waypoints[0].y - npc.y) < 0.01
    ) {
      path.waypoints.shift();
    }
    const waypoint = path.waypoints[0];
    if (!waypoint) {
      npc.isMoving = false;
      return false;
    }

    const deltaX = waypoint.x - npc.x;
    const deltaY = waypoint.y - npc.y;
    const movingHorizontally = Math.abs(deltaX) >= 0.01;
    const distance = movingHorizontally ? Math.abs(deltaX) : Math.abs(deltaY);
    const stepSeconds = Math.min(dt, 0.1, distance / PLAYER_SPEED);
    const input = {
      up: !movingHorizontally && deltaY < 0,
      down: !movingHorizontally && deltaY > 0,
      left: movingHorizontally && deltaX < 0,
      right: movingHorizontally && deltaX > 0,
    };
    const movementDistance = PLAYER_SPEED * stepSeconds;
    const candidateX =
      npc.x + (input.left ? -movementDistance : input.right ? movementDistance : 0);
    const candidateY =
      npc.y + (input.up ? -movementDistance : input.down ? movementDistance : 0);
    // Scripted tutorial NPCs may sidestep immediately after their gate opens.
    // The regular player physics intentionally restricts an opened prisoner to
    // north/south movement, which can deadlock an NPC when another cage sits
    // directly outside that gate.
    const result = this.isNpcPositionValid(candidateX, candidateY, npc.id, state)
      ? { x: candidateX, y: candidateY }
      : { x: npc.x, y: npc.y };
    const moved = result.x !== npc.x || result.y !== npc.y;
    npc.x = result.x;
    npc.y = result.y;
    npc.facing = deriveFacingDirection(input, npc.facing);
    npc.isMoving = moved;
    if (!moved) {
      this.npcPaths.delete(npc.id);
      return false;
    }
    if (Math.abs(waypoint.x - npc.x) < 0.01 && Math.abs(waypoint.y - npc.y) < 0.01) {
      path.waypoints.shift();
    }
    const reachedTarget =
      Math.abs(targetX - npc.x) < 0.01 && Math.abs(targetY - npc.y) < 0.01;
    if (reachedTarget) {
      npc.isMoving = false;
      this.npcPaths.delete(npc.id);
    }
    return reachedTarget;
  }

  private findCageApproachPoint(
    npc: PlayerInfo,
    cage: CageState,
    state: GameState,
  ): { x: number; y: number } {
    const interaction = getCageInteractionPoint(cage);
    const candidates = [
      { x: cage.x, y: cage.y - 20 },
      { x: cage.x - 18, y: interaction.y },
      { x: cage.x + 18, y: interaction.y },
      { x: cage.x, y: cage.y + TILE_SIZE },
    ];
    const validCandidates = candidates.filter((candidate) =>
      this.isNpcPositionValid(candidate.x, candidate.y, npc.id, state),
    );
    const reachableCandidates = validCandidates.filter(
      (candidate) =>
        (Math.abs(candidate.x - npc.x) < 0.01 && Math.abs(candidate.y - npc.y) < 0.01) ||
        this.findNpcPath(npc, candidate.x, candidate.y, state).length > 0,
    );
    const available =
      reachableCandidates.length > 0
        ? reachableCandidates
        : validCandidates.length > 0
          ? validCandidates
          : candidates;
    return available.reduce((nearest, candidate) => {
      const nearestDistance =
        (nearest.x - npc.x) * (nearest.x - npc.x) +
        (nearest.y - npc.y) * (nearest.y - npc.y);
      const candidateDistance =
        (candidate.x - npc.x) * (candidate.x - npc.x) +
        (candidate.y - npc.y) * (candidate.y - npc.y);
      return candidateDistance < nearestDistance ? candidate : nearest;
    });
  }

  private findNpcPath(
    npc: PlayerInfo,
    targetX: number,
    targetY: number,
    state: GameState,
  ): Array<{ x: number; y: number }> {
    const step = TUTORIAL_NPC_PATH_STEP;
    const targetGridX = Math.round((targetX - npc.x) / step);
    const targetGridY = Math.round((targetY - npc.y) / step);
    const marginSteps = Math.ceil(TUTORIAL_NPC_PATH_MARGIN / step);
    const minGridX = Math.min(0, targetGridX) - marginSteps;
    const maxGridX = Math.max(0, targetGridX) + marginSteps;
    const minGridY = Math.min(0, targetGridY) - marginSteps;
    const maxGridY = Math.max(0, targetGridY) + marginSteps;
    const startKey = '0,0';
    let goalGridX = targetGridX;
    let goalGridY = targetGridY;

    if (
      !this.isNpcPositionValid(
        npc.x + goalGridX * step,
        npc.y + goalGridY * step,
        npc.id,
        state,
      )
    ) {
      const nearbyGoals: Array<{ x: number; y: number; distance: number }> = [];
      for (let radius = 1; radius <= 3; radius++) {
        for (let offsetY = -radius; offsetY <= radius; offsetY++) {
          for (let offsetX = -radius; offsetX <= radius; offsetX++) {
            const gridX = targetGridX + offsetX;
            const gridY = targetGridY + offsetY;
            const worldX = npc.x + gridX * step;
            const worldY = npc.y + gridY * step;
            if (!this.isNpcPositionValid(worldX, worldY, npc.id, state)) continue;
            const distance = (worldX - targetX) ** 2 + (worldY - targetY) ** 2;
            nearbyGoals.push({ x: gridX, y: gridY, distance });
          }
        }
        if (nearbyGoals.length > 0) break;
      }
      const nearestGoal = nearbyGoals.sort((a, b) => a.distance - b.distance)[0];
      if (!nearestGoal) return [];
      goalGridX = nearestGoal.x;
      goalGridY = nearestGoal.y;
    }

    const goalKey = `${goalGridX},${goalGridY}`;
    const queue: Array<{ x: number; y: number }> = [{ x: 0, y: 0 }];
    const cameFrom = new Map<string, string | null>([[startKey, null]]);
    const directions = [
      { x: 0, y: -1 },
      { x: -1, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ];

    for (let queueIndex = 0; queueIndex < queue.length; queueIndex++) {
      const current = queue[queueIndex];
      const currentKey = `${current.x},${current.y}`;
      if (currentKey === goalKey) break;

      for (const direction of directions) {
        const nextX = current.x + direction.x;
        const nextY = current.y + direction.y;
        if (
          nextX < minGridX ||
          nextX > maxGridX ||
          nextY < minGridY ||
          nextY > maxGridY
        ) {
          continue;
        }
        const nextKey = `${nextX},${nextY}`;
        if (cameFrom.has(nextKey)) continue;
        if (
          !this.isNpcPositionValid(
            npc.x + nextX * step,
            npc.y + nextY * step,
            npc.id,
            state,
          )
        ) {
          continue;
        }
        cameFrom.set(nextKey, currentKey);
        queue.push({ x: nextX, y: nextY });
      }
    }

    if (!cameFrom.has(goalKey)) return [];
    const reversed: Array<{ x: number; y: number }> = [];
    let cursor: string | null = goalKey;
    while (cursor && cursor !== startKey) {
      const [gridX, gridY] = cursor.split(',').map(Number);
      reversed.push({ x: npc.x + gridX * step, y: npc.y + gridY * step });
      cursor = cameFrom.get(cursor) ?? null;
    }
    reversed.reverse();

    const finalPoint = reversed[reversed.length - 1];
    if (
      (!finalPoint ||
        Math.abs(finalPoint.x - targetX) >= 0.01 ||
        Math.abs(finalPoint.y - targetY) >= 0.01) &&
      this.isNpcPositionValid(targetX, targetY, npc.id, state)
    ) {
      reversed.push({ x: targetX, y: targetY });
    }

    const compressed: Array<{ x: number; y: number }> = [];
    for (const point of reversed) {
      const previous = compressed[compressed.length - 1];
      const beforePrevious = compressed[compressed.length - 2];
      if (
        previous &&
        beforePrevious &&
        ((beforePrevious.x === previous.x && previous.x === point.x) ||
          (beforePrevious.y === previous.y && previous.y === point.y))
      ) {
        compressed[compressed.length - 1] = point;
      } else {
        compressed.push(point);
      }
    }
    return compressed;
  }

  private isNpcPositionValid(
    x: number,
    y: number,
    npcId: string,
    state: GameState,
  ): boolean {
    return isPositionValid(
      x,
      y,
      this.layout.map,
      state.portal,
      this.layout.bridges,
      state.bridgeStates,
      this.layout.chestDeadEnds,
      this.layout.swordFields,
      state.swordFieldStates,
      state.cageStates,
      npcId,
      this.layout.tIntersectionDecorations,
      this.layout.decoratedVerticalPassages,
      this.layout.spikeGateObstacles,
      state.spikeGateStates,
    );
  }

  private getPlayerFeetCenter(player: Pick<PlayerInfo, 'x' | 'y'>): {
    x: number;
    y: number;
  } {
    return { x: player.x, y: player.y - FEET_HITBOX_H / 2 };
  }

  private updateBridgeInteractions(
    player: PlayerInfo,
    previousX: number,
    previousY: number,
  ): void {
    const state = this.state;
    if (!state) return;

    const feet = this.getPlayerFeetCenter(player);
    let repairKey: string | null = null;

    for (let bridgeIndex = 0; bridgeIndex < this.layout.bridges.length; bridgeIndex++) {
      const bridge = this.layout.bridges[bridgeIndex];
      const circle = getBridgeRepairCircleBounds(bridge, this.layout.map.tileSize).find(
        (bounds) =>
          feet.x >= bounds.left &&
          feet.x <= bounds.right &&
          feet.y >= bounds.top &&
          feet.y <= bounds.bottom,
      );
      if (!circle) continue;

      repairKey = `${bridgeIndex}:${circle.side}`;
      if (this.bridgeRepairOccupancy.get(player.id) !== repairKey) {
        const bridgeState = state.bridgeStates[bridgeIndex];
        if (bridgeState.repairingSide === null && bridgeState.collapsedTileMask !== 0) {
          this.startBridgeRepair(bridgeIndex, circle.side, player.id);
        } else if (bridgeState.repairingSide !== null && !bridgeState.repairActive) {
          this.resumeBridgeRepair(bridgeIndex, circle.side, player.id);
        }
      }
      break;
    }

    if (repairKey === null) {
      this.bridgeRepairOccupancy.delete(player.id);
    } else {
      this.bridgeRepairOccupancy.set(player.id, repairKey);
    }

    let currentBridgeIndex = -1;
    let currentTile: ReturnType<typeof getBridgeWalkwayTileAtPoint> = null;
    for (let bridgeIndex = 0; bridgeIndex < this.layout.bridges.length; bridgeIndex++) {
      const tile = getBridgeWalkwayTileAtPoint(
        this.layout.bridges[bridgeIndex],
        feet.x,
        feet.y,
        this.layout.map.tileSize,
      );
      if (!tile) continue;
      currentBridgeIndex = bridgeIndex;
      currentTile = tile;
      break;
    }

    if (currentBridgeIndex < 0 || !currentTile) {
      this.bridgeTraversals.delete(player.id);
      return;
    }

    if (state.bridgeStates[currentBridgeIndex].repairingSide !== null) {
      this.bridgeTraversals.delete(player.id);
      return;
    }

    const bridge = this.layout.bridges[currentBridgeIndex];
    let traversal = this.bridgeTraversals.get(player.id);
    if (!traversal || traversal.bridgeIndex !== currentBridgeIndex) {
      const firstRow = getBridgeWalkwayTileBounds(bridge, 0, 0, this.layout.map.tileSize);
      const lastRow = getBridgeWalkwayTileBounds(
        bridge,
        BRIDGE_WALKWAY_ROWS - 1,
        0,
        this.layout.map.tileSize,
      );
      const previousFeetY = previousY - FEET_HITBOX_H / 2;
      let entrySide: BridgeEntrySide;
      if (previousFeetY < firstRow.top) {
        entrySide = 'north';
      } else if (previousFeetY > lastRow.bottom) {
        entrySide = 'south';
      } else if (player.y < previousY) {
        entrySide = 'south';
      } else if (player.y > previousY) {
        entrySide = 'north';
      } else {
        entrySide = currentTile.row < BRIDGE_WALKWAY_ROWS / 2 ? 'north' : 'south';
      }
      traversal = {
        bridgeIndex: currentBridgeIndex,
        entrySide,
        lastTileMask: 0,
        completed: false,
      };
      this.bridgeTraversals.set(player.id, traversal);
    }

    const tileMask = getBridgeWalkwayTileMaskAtFeetCenter(
      bridge,
      feet.x,
      feet.y,
      FEET_HITBOX_W,
      this.layout.map.tileSize,
    );
    if (tileMask === 0 || tileMask === traversal.lastTileMask) return;

    const safe = (tileMask & ~bridge.safeTileMask) === 0;
    const destinationRow = traversal.entrySide === 'north' ? BRIDGE_WALKWAY_ROWS - 1 : 0;
    if (safe && currentTile.row === destinationRow) {
      traversal.completed = true;
    } else if (
      !safe &&
      !traversal.completed &&
      state.bridgeStates[currentBridgeIndex].collapsedTileMask === 0
    ) {
      const direction = traversal.entrySide === 'north' ? 'south' : 'north';
      const wrongTileMask = tileMask & ~bridge.safeTileMask;
      let wrongColumn = currentTile.column;
      if ((wrongTileMask & getBridgeTileBit(currentTile.row, wrongColumn)) === 0) {
        wrongColumn =
          Array.from({ length: BRIDGE_WALKWAY_COLUMNS }, (_, column) => column).find(
            (column) => (wrongTileMask & getBridgeTileBit(currentTile.row, column)) !== 0,
          ) ?? wrongColumn;
      }
      this.triggerBridgeFailure(
        currentBridgeIndex,
        currentTile.row,
        wrongColumn,
        direction,
        player.id,
      );
    }
    traversal.lastTileMask = tileMask;
  }

  private triggerBridgeFailure(
    bridgeIndex: number,
    failedRow: number,
    failedColumn: number,
    direction: 'north' | 'south',
    triggeringPlayerId: string,
  ): void {
    const state = this.state;
    const bridgeState = state?.bridgeStates[bridgeIndex];
    if (!state || !bridgeState || bridgeState.collapsedTileMask !== 0) return;

    bridgeState.wrongTileIndex = failedRow * BRIDGE_WALKWAY_COLUMNS + failedColumn;
    this.bridgeFailureFeedbackRemainingMs.set(
      bridgeIndex,
      BRIDGE_FAILURE_FEEDBACK_DURATION_MS,
    );

    const collapsedTileMask = getBridgeCollapseMask(failedRow, direction);
    if (collapsedTileMask === 0) return;
    const terminalFailure =
      (direction === 'north' && failedRow === 0) ||
      (direction === 'south' && failedRow === BRIDGE_WALKWAY_ROWS - 1);
    bridgeState.collapsedTileMask = collapsedTileMask;
    bridgeState.repairingSide = null;
    bridgeState.repairActive = false;
    bridgeState.repairingPlayerId = null;
    bridgeState.repairStartedTick = null;
    bridgeState.repairInitialCollapsedTileMask = 0;
    this.bridgeRepairs.delete(bridgeIndex);

    const bridge = this.layout.bridges[bridgeIndex];
    let triggeringPlayerReturned = false;
    for (const candidate of state.players) {
      if (!this.playerOverlapsBridgeMask(candidate, bridge, collapsedTileMask)) continue;
      if (terminalFailure && candidate.id === triggeringPlayerId) {
        this.returnPlayerToPreviousBridgeRow(
          candidate,
          bridgeIndex,
          failedRow,
          direction,
        );
      } else {
        this.returnPlayerToBridgeEntry(candidate, bridgeIndex);
      }
      if (candidate.id === triggeringPlayerId) triggeringPlayerReturned = true;
    }

    if (terminalFailure && !triggeringPlayerReturned) {
      const triggeringPlayer = state.players.find(
        (candidate) => candidate.id === triggeringPlayerId,
      );
      if (triggeringPlayer) {
        this.returnPlayerToPreviousBridgeRow(
          triggeringPlayer,
          bridgeIndex,
          failedRow,
          direction,
        );
      }
    }
  }

  private startBridgeRepair(
    bridgeIndex: number,
    side: BridgeEntrySide,
    repairingPlayerId: string,
  ): void {
    const state = this.state;
    const bridgeState = state?.bridgeStates[bridgeIndex];
    if (
      !state ||
      !bridgeState ||
      bridgeState.collapsedTileMask === 0 ||
      bridgeState.repairingSide !== null
    ) {
      return;
    }

    const repair: TutorialBridgeRepair = {
      activeElapsedMs: 0,
      initialCollapsedTileMask: bridgeState.collapsedTileMask,
      orderSide: side,
      channelSide: side,
      repairingPlayerId,
    };
    this.bridgeRepairs.set(bridgeIndex, repair);
    bridgeState.repairingSide = side;
    bridgeState.repairActive = true;
    bridgeState.repairingPlayerId = repairingPlayerId;
    bridgeState.repairStartedTick = state.tick;
    bridgeState.repairInitialCollapsedTileMask = repair.initialCollapsedTileMask;
    bridgeState.collapsedTileMask = getBridgeRepairCollapsedMask(
      repair.initialCollapsedTileMask,
      repair.orderSide,
      0,
    );

    const bridge = this.layout.bridges[bridgeIndex];
    for (const candidate of state.players) {
      const feet = this.getPlayerFeetCenter(candidate);
      if (getBridgeWalkwayTileAtPoint(bridge, feet.x, feet.y, this.layout.map.tileSize)) {
        this.returnPlayerToBridgeEntry(candidate, bridgeIndex);
      }
    }
    for (const [playerId, traversal] of this.bridgeTraversals) {
      if (traversal.bridgeIndex === bridgeIndex) this.bridgeTraversals.delete(playerId);
    }
  }

  private resumeBridgeRepair(
    bridgeIndex: number,
    side: BridgeEntrySide,
    repairingPlayerId: string,
  ): void {
    const bridgeState = this.state?.bridgeStates[bridgeIndex];
    const repair = this.bridgeRepairs.get(bridgeIndex);
    if (!bridgeState || !repair || bridgeState.repairActive) return;

    repair.repairingPlayerId = repairingPlayerId;
    repair.channelSide = side;
    bridgeState.repairingSide = side;
    bridgeState.repairActive = true;
    bridgeState.repairingPlayerId = repairingPlayerId;
  }

  private advanceBridgeStates(player: PlayerInfo, dt: number): boolean {
    const state = this.state;
    if (!state) return false;
    let changed = false;
    const elapsedMs = dt * 1_000;

    for (const [bridgeIndex, remainingMs] of this.bridgeFailureFeedbackRemainingMs) {
      const nextRemainingMs = remainingMs - elapsedMs;
      if (nextRemainingMs > 0) {
        this.bridgeFailureFeedbackRemainingMs.set(bridgeIndex, nextRemainingMs);
        continue;
      }
      this.bridgeFailureFeedbackRemainingMs.delete(bridgeIndex);
      const bridgeState = state.bridgeStates[bridgeIndex];
      if (bridgeState?.wrongTileIndex !== null) {
        bridgeState.wrongTileIndex = null;
        changed = true;
      }
    }

    for (const [bridgeIndex, repair] of this.bridgeRepairs) {
      const bridgeState = state.bridgeStates[bridgeIndex];
      if (!bridgeState) {
        this.bridgeRepairs.delete(bridgeIndex);
        continue;
      }

      if (
        bridgeState.repairActive &&
        (!repair.repairingPlayerId ||
          !this.isPlayerOnBridgeRepairCircle(player, bridgeIndex, repair.channelSide))
      ) {
        bridgeState.repairActive = false;
        bridgeState.repairingPlayerId = null;
        repair.repairingPlayerId = null;
        changed = true;
      } else if (bridgeState.repairActive) {
        repair.activeElapsedMs += elapsedMs;
      }

      const collapsedTileMask = getBridgeRepairCollapsedMask(
        repair.initialCollapsedTileMask,
        repair.orderSide,
        repair.activeElapsedMs,
      );
      if (collapsedTileMask !== bridgeState.collapsedTileMask) {
        bridgeState.collapsedTileMask = collapsedTileMask;
        changed = true;
      }
      if (repair.activeElapsedMs < BRIDGE_REPAIR_DURATION_MS) continue;

      bridgeState.collapsedTileMask = 0;
      bridgeState.repairingSide = null;
      bridgeState.repairActive = false;
      bridgeState.repairingPlayerId = null;
      bridgeState.repairStartedTick = null;
      bridgeState.repairInitialCollapsedTileMask = 0;
      this.bridgeRepairs.delete(bridgeIndex);
      this.bridgeTraversals.delete(player.id);
      changed = true;
    }

    return changed;
  }

  private isPlayerOnBridgeRepairCircle(
    player: PlayerInfo,
    bridgeIndex: number,
    side: BridgeEntrySide,
  ): boolean {
    const bridge = this.layout.bridges[bridgeIndex];
    if (!bridge) return false;
    const bounds = getBridgeRepairCircleBounds(bridge, this.layout.map.tileSize).find(
      (circle) => circle.side === side,
    );
    if (!bounds) return false;

    const feet = this.getPlayerFeetCenter(player);
    return (
      feet.x >= bounds.left &&
      feet.x <= bounds.right &&
      feet.y >= bounds.top &&
      feet.y <= bounds.bottom
    );
  }

  private returnPlayerToPreviousBridgeRow(
    player: PlayerInfo,
    bridgeIndex: number,
    failedRow: number,
    direction: 'north' | 'south',
  ): void {
    const bridge = this.layout.bridges[bridgeIndex];
    const returnRow = direction === 'south' ? failedRow - 1 : failedRow + 1;
    const returnPosition = bridge
      ? getBridgeSafeRowFeetCenter(bridge, returnRow, player.x, this.layout.map.tileSize)
      : null;
    if (!returnPosition) {
      this.returnPlayerToBridgeEntry(player, bridgeIndex);
      return;
    }

    player.x = returnPosition.x;
    player.y = returnPosition.y + FEET_HITBOX_H / 2;
    player.isMoving = false;
    this.bridgeTraversals.delete(player.id);
    this.bridgeRepairOccupancy.delete(player.id);
  }

  private playerOverlapsBridgeMask(
    player: PlayerInfo,
    bridge: TutorialMazeLayout['bridges'][number],
    mask: number,
  ): boolean {
    const left = player.x - FEET_HITBOX_W / 2;
    const top = player.y - FEET_HITBOX_H;
    const right = left + FEET_HITBOX_W - 1;
    const bottom = player.y - 1;

    for (let row = 0; row < BRIDGE_WALKWAY_ROWS; row++) {
      for (let column = 0; column < BRIDGE_WALKWAY_COLUMNS; column++) {
        if ((mask & getBridgeTileBit(row, column)) === 0) continue;
        const tile = getBridgeWalkwayTileBounds(
          bridge,
          row,
          column,
          this.layout.map.tileSize,
        );
        if (
          left <= tile.right &&
          right >= tile.left &&
          top <= tile.bottom &&
          bottom >= tile.top
        ) {
          return true;
        }
      }
    }
    return false;
  }

  private returnPlayerToBridgeEntry(player: PlayerInfo, bridgeIndex: number): void {
    const bridge = this.layout.bridges[bridgeIndex];
    const traversal = this.bridgeTraversals.get(player.id);
    let entrySide = traversal?.bridgeIndex === bridgeIndex ? traversal.entrySide : null;
    if (!entrySide) {
      const first = getBridgeWalkwayTileBounds(bridge, 0, 0, this.layout.map.tileSize);
      const last = getBridgeWalkwayTileBounds(
        bridge,
        BRIDGE_WALKWAY_ROWS - 1,
        0,
        this.layout.map.tileSize,
      );
      const midpoint = (first.top + last.bottom) / 2;
      entrySide = this.getPlayerFeetCenter(player).y <= midpoint ? 'north' : 'south';
    }

    const returnPosition = getBridgeBankReturnPosition(
      bridge,
      entrySide,
      this.layout.map.tileSize,
    );
    player.x = returnPosition.x;
    player.y = returnPosition.y;
    player.isMoving = false;
    this.bridgeTraversals.delete(player.id);
    this.bridgeRepairOccupancy.delete(player.id);
  }

  sendInput(
    sequenceNumber: number,
    up: boolean,
    down: boolean,
    left: boolean,
    right: boolean,
    dt: number,
  ): boolean {
    const state = this.state;
    const player = state?.players[0];
    if (!this.connected || !state || !player || player.escaped) return false;

    const input = { up, down, left, right };
    const previousX = player.x;
    const previousY = player.y;
    const result = applyInputWithCollision(
      player.x,
      player.y,
      input,
      dt,
      this.layout.map,
      state.portal,
      this.layout.bridges,
      state.bridgeStates,
      this.layout.swamps,
      this.layout.chestDeadEnds,
      this.layout.swordFields,
      state.swordFieldStates,
      state.cageStates,
      player.id,
      this.layout.tIntersectionDecorations,
      this.layout.decoratedVerticalPassages,
      this.layout.spikeGateObstacles,
      state.spikeGateStates,
    );
    player.x = result.x;
    player.y = result.y;
    const activeCage = findActivePlayerCage(state.cageStates, player.id);
    if (activeCage?.opened && hasPrisonerExitedCage(activeCage, player.y)) {
      activeCage.vacated = true;
    }
    player.facing = deriveFacingDirection(input, player.facing);
    player.isMoving = up || down || left || right;
    player.lastProcessedInput = sequenceNumber;
    this.updateBridgeInteractions(player, previousX, previousY);
    this.emitSnapshot();
    return true;
  }

  sendUseWisdomOrb(): void {
    const state = this.state;
    const player = state?.players[0];
    if (
      !this.connected ||
      !state ||
      !player ||
      this.role !== 'survivor' ||
      this.wisdomOrbs <= 0
    ) {
      return;
    }

    const bridgeHintTarget = findBridgeWisdomHintTarget(
      this.layout.bridges,
      player.x,
      player.y,
      this.layout.map.tileSize,
    );
    if (bridgeHintTarget) {
      if (!this.revealedWisdomBridges.has(bridgeHintTarget.bridgeIndex)) {
        const bridge = this.layout.bridges[bridgeHintTarget.bridgeIndex];
        this.revealedWisdomBridges.add(bridgeHintTarget.bridgeIndex);
        this.wisdomOrbs -= 1;
        this.callbacks.onWisdomOrbUsed(
          {
            kind: 'bridge',
            bridgeIndex: bridgeHintTarget.bridgeIndex,
            entrySide: bridgeHintTarget.entrySide,
            safeTileMask: bridge.safeTileMask,
          },
          this.wisdomOrbs,
        );
        return;
      }
    } else {
      const swampHintTarget = findSwampWisdomHintTarget(
        this.layout.swamps,
        player.x,
        player.y,
        this.layout.map.tileSize,
      );
      if (swampHintTarget && !this.revealedWisdomSwamps.has(swampHintTarget.swampIndex)) {
        this.revealedWisdomSwamps.add(swampHintTarget.swampIndex);
        this.wisdomOrbs -= 1;
        this.callbacks.onWisdomOrbUsed(
          { kind: 'swamp', swampIndex: swampHintTarget.swampIndex },
          this.wisdomOrbs,
        );
        return;
      }
    }

    let direction: HubDirection = 'east';
    if (state.runestones.every((runestone) => runestone.activated) && state.portal) {
      const portalDistanceField = computePortalDistanceField(
        this.layout.map,
        state.portal,
      );
      const portalDirection = portalDistanceField
        ? getNavigationDirectionForPosition(
            player.x,
            player.y,
            this.layout.map,
            portalDistanceField,
          )
        : null;
      if (!portalDirection) return;
      direction = portalDirection;
    }

    this.wisdomOrbs -= 1;
    this.callbacks.onWisdomOrbUsed({ kind: 'direction', direction }, this.wisdomOrbs);
  }

  sendActivateRunestone(runestoneIndex: number): void {
    const state = this.state;
    const player = state?.players[0];
    const runestone = state?.runestones.find(
      (candidate) => candidate.index === runestoneIndex,
    );
    if (
      !this.connected ||
      !state ||
      !player ||
      !runestone ||
      runestone.activated ||
      runestone.index !== player.teamId
    ) {
      return;
    }

    const targetX = (runestone.tileX + 0.5) * TILE_SIZE;
    const targetY = (runestone.tileY + 1) * TILE_SIZE;
    const dx = player.x - targetX;
    const dy = player.y - targetY;
    if (dx * dx + dy * dy >= 28 * 28) return;

    runestone.activated = true;
    this.emitSnapshot();
    this.callbacks.onRunestoneActivated(runestone.index);
    if (state.runestones.every((candidate) => candidate.activated) && state.portal) {
      this.callbacks.onAllRunestonesActivated(state.portal.x, state.portal.y);
    }
  }

  sendEscapePortal(): void {
    const state = this.state;
    const player = state?.players[0];
    if (
      !this.connected ||
      !state ||
      !player ||
      !state.portal ||
      player.escaped ||
      !state.runestones.every((runestone) => runestone.activated) ||
      !isWithinPortalInteractionRange(player, state.portal)
    ) {
      return;
    }

    player.escaped = true;
    player.isMoving = false;
    state.match.escapedCount = 1;
    this.emitSnapshot();
    this.callbacks.onPlayerEscaped(
      player.id,
      player.displayName,
      state.portal.x,
      state.portal.y,
      1,
      1,
      0,
    );
  }

  sendLobbyVote(_vote: boolean): void {}
  sendLobbyChatMessage(_text: string): void {}
  sendAdminStartGame(): void {}
  sendAdminKickPlayer(_playerId: string): void {}
  sendGameReady(): void {}
  sendOpenChest(chestIndex: number): void {
    const state = this.state;
    const player = state?.players[0];
    const placement = this.layout.chestDeadEnds[chestIndex];
    const chestState = state?.chestStates[chestIndex];
    if (
      !this.connected ||
      !state ||
      !player ||
      !Number.isInteger(chestIndex) ||
      !placement ||
      !chestState ||
      chestState.opened
    ) {
      return;
    }

    const rewardedWisdomOrbs = getChestWisdomOrbReward(this.wisdomOrbs);
    if (rewardedWisdomOrbs === null) return;
    const interaction = getChestInteractionPoint(placement, this.layout.map.tileSize);
    const dx = player.x - interaction.x;
    const dy = player.y - interaction.y;
    if (dx * dx + dy * dy > CHEST_INTERACTION_RANGE * CHEST_INTERACTION_RANGE) return;

    chestState.opened = true;
    this.wisdomOrbs = rewardedWisdomOrbs;
    this.callbacks.onChestOpened(chestIndex, player.id);
    this.callbacks.onWisdomOrbGranted(chestIndex, this.wisdomOrbs);
    this.emitSnapshot();
  }
  sendPressPressurePlate(_plateId: number): void {}
  sendPressSpikePlate(_spikePlateIndex: number): void {}
  sendActivateTrapCell(_trapCellIndex: number): void {}
  sendOpenCage(_cageId: number): void {}
  sendChatMessage(_text: string): void {}
  sendDebugTeleport(x: number, y: number): void {
    const player = this.getAdminPlayer();
    if (!player || !Number.isFinite(x) || !Number.isFinite(y)) return;
    player.x = x;
    player.y = y;
    player.isMoving = false;
    this.bridgeTraversals.delete(player.id);
    this.bridgeRepairOccupancy.delete(player.id);
    this.emitSnapshot();
  }

  sendDebugSetMatchTime(remainingMs: number): void {
    if (
      !this.isAdmin ||
      !this.state ||
      this.state.match.status !== 'running' ||
      !Number.isInteger(remainingMs) ||
      remainingMs < 0 ||
      remainingMs > DEBUG_MAX_MATCH_TIME_MS
    ) {
      return;
    }
    // Tutorials deliberately do not count down, but the admin control still
    // updates its authoritative value and can be inspected in the admin panel.
    this.state.match.remainingMs = remainingMs;
    this.emitSnapshot();
  }

  sendDebugSetNetworkStats(enabled: boolean): void {
    if (!this.isAdmin || !this.state || typeof enabled !== 'boolean') return;
    this.state.networkStatsVisible = enabled;
    this.emitSnapshot();
  }

  sendDebugSetToolsEnabled(_enabled: boolean): void {}
  sendDebugPlayerAction(
    targetPlayerId: string,
    action: DebugPlayerAction,
    options: Pick<
      DebugPlayerActionMessage,
      'spriteIndex' | 'teamId' | 'dead' | 'role'
    > = {},
  ): void {
    const player = this.getAdminPlayer();
    if (!player || targetPlayerId !== player.id) return;

    switch (action) {
      case 'teleport-to':
      case 'teleport-here':
        break;
      case 'get-role':
        this.callbacks.onDebugPlayerRole(player.id, this.role);
        return;
      case 'set-skin':
        if (
          options.spriteIndex === undefined ||
          !Number.isInteger(options.spriteIndex) ||
          options.spriteIndex < 0 ||
          options.spriteIndex >= PLAYER_CHARACTER_COUNT
        ) {
          return;
        }
        player.spriteIndex = options.spriteIndex;
        break;
      case 'set-squad':
        if (
          options.teamId === undefined ||
          !Number.isInteger(options.teamId) ||
          options.teamId < 0 ||
          options.teamId >= SQUAD_COLORS.length
        ) {
          return;
        }
        player.teamId = options.teamId;
        break;
      case 'set-dead':
        if (typeof options.dead !== 'boolean') return;
        player.isDead = options.dead;
        break;
      case 'set-role':
        if (options.role !== 'survivor' && options.role !== 'warden') return;
        this.role = options.role;
        this.wisdomOrbs = this.role === 'survivor' ? TUTORIAL_INITIAL_WISDOM_ORBS : 0;
        this.callbacks.onPlayerRoleChanged(this.role, this.wisdomOrbs);
        this.callbacks.onDebugPlayerRole(player.id, this.role);
        break;
    }

    this.emitSnapshot();
  }

  private getAdminPlayer(): PlayerInfo | null {
    if (
      !this.isAdmin ||
      !this.connected ||
      !this.state ||
      this.state.match.status !== 'running'
    ) {
      return null;
    }
    const player = this.state.players[0];
    return player && !player.escaped ? player : null;
  }

  private emitSnapshot(): void {
    if (!this.state) return;
    this.state.tick += 1;
    // Match the network transport's immutable parsed snapshots. Besides making
    // interpolation meaningful, this lets normal transition effects (including
    // cage materialization) compare the new tutorial state with the prior one.
    this.callbacks.onTickUpdate(structuredClone(this.state));
  }
}
