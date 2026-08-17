export const MOVEMENT_INPUT_SEND_RATE = 25;
export const MOVEMENT_INPUT_SEND_INTERVAL_S = 1 / MOVEMENT_INPUT_SEND_RATE;

export interface MovementInputState {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

export interface ScheduledMovementInput extends MovementInputState {
  /** Total local prediction time represented by this network command. */
  dt: number;
}

const IDLE_INPUT: MovementInputState = {
  up: false,
  down: false,
  left: false,
  right: false,
};

function copyInput(input: MovementInputState): MovementInputState {
  return {
    up: input.up,
    down: input.down,
    left: input.left,
    right: input.right,
  };
}

function inputsEqual(a: MovementInputState, b: MovementInputState): boolean {
  return a.up === b.up && a.down === b.down && a.left === b.left && a.right === b.right;
}

function hasMovement(input: MovementInputState): boolean {
  return input.up || input.down || input.left || input.right;
}

/**
 * Keeps local prediction frame-rate smooth while limiting all movement traffic
 * to a stable 25 Hz. Turns inside one interval are coalesced into one command;
 * their original segments remain available for local reconciliation.
 */
export class MovementInputScheduler {
  private currentInput: MovementInputState = copyInput(IDLE_INPUT);
  private unsentInputs: ScheduledMovementInput[] = [];
  private sendClock = MOVEMENT_INPUT_SEND_INTERVAL_S;

  update(nextInput: MovementInputState, dt: number): ScheduledMovementInput[] {
    const safeDt = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    if (!inputsEqual(nextInput, this.currentInput)) {
      this.currentInput = copyInput(nextInput);
    }

    if (safeDt > 0 && hasMovement(this.currentInput)) {
      const lastInput = this.unsentInputs[this.unsentInputs.length - 1];
      if (lastInput && inputsEqual(lastInput, this.currentInput)) {
        lastInput.dt += safeDt;
      } else {
        this.unsentInputs.push({ ...this.currentInput, dt: safeDt });
      }
    }

    this.sendClock += safeDt;
    if (
      this.unsentInputs.length > 0 &&
      this.sendClock >= MOVEMENT_INPUT_SEND_INTERVAL_S
    ) {
      const command = this.takeCoalescedCommand();
      this.sendClock %= MOVEMENT_INPUT_SEND_INTERVAL_S;
      return [command];
    }

    // Once completely idle, retain a full send credit so the next movement
    // starts without an artificial 40 ms wait.
    if (this.unsentInputs.length === 0 && !hasMovement(this.currentInput)) {
      this.sendClock = Math.min(this.sendClock, MOVEMENT_INPUT_SEND_INTERVAL_S);
    }
    return [];
  }

  /** Movement segments predicted locally but not yet represented by a sent command. */
  getUnsentInputs(): ScheduledMovementInput[] {
    return this.unsentInputs.map((input) => ({ ...input }));
  }

  reset(): void {
    this.currentInput = copyInput(IDLE_INPUT);
    this.unsentInputs = [];
    this.sendClock = MOVEMENT_INPUT_SEND_INTERVAL_S;
  }

  private takeCoalescedCommand(): ScheduledMovementInput {
    const latestInput = this.unsentInputs[this.unsentInputs.length - 1];
    const dt = this.unsentInputs.reduce((total, input) => total + input.dt, 0);
    const command = { ...latestInput, dt };
    this.unsentInputs = [];
    return command;
  }
}
