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
 * Keeps local prediction frame-rate smooth while limiting movement traffic to
 * a stable 25 Hz. Direction transitions bypass the cadence so quick taps and
 * releases are never hidden inside an input interval.
 */
export class MovementInputScheduler {
  private currentInput: MovementInputState = copyInput(IDLE_INPUT);
  private unsentDt = 0;
  private sendClock = 0;

  update(nextInput: MovementInputState, dt: number): ScheduledMovementInput[] {
    const safeDt = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    const inputChanged = !inputsEqual(nextInput, this.currentInput);
    const commands: ScheduledMovementInput[] = [];

    if (inputChanged) {
      // Preserve any fractional movement that belongs to the old direction.
      this.flushCurrentMovement(commands);
      this.currentInput = copyInput(nextInput);
      this.sendClock = 0;
    }

    if (hasMovement(this.currentInput)) this.unsentDt += safeDt;

    if (inputChanged) {
      // Send starts/turns/stops immediately instead of waiting up to 40 ms.
      commands.push(this.takeCurrentCommand());
    } else if (hasMovement(this.currentInput)) {
      this.sendClock += safeDt;
      if (this.sendClock >= MOVEMENT_INPUT_SEND_INTERVAL_S) {
        this.flushCurrentMovement(commands);
        this.sendClock %= MOVEMENT_INPUT_SEND_INTERVAL_S;
      }
    } else {
      this.sendClock = 0;
    }

    return commands;
  }

  /** Movement predicted locally but not yet represented by a sent command. */
  getUnsentInput(): ScheduledMovementInput | null {
    if (this.unsentDt <= 0 || !hasMovement(this.currentInput)) return null;
    return { ...this.currentInput, dt: this.unsentDt };
  }

  reset(): void {
    this.currentInput = copyInput(IDLE_INPUT);
    this.unsentDt = 0;
    this.sendClock = 0;
  }

  private flushCurrentMovement(commands: ScheduledMovementInput[]): void {
    if (this.unsentDt <= 0 || !hasMovement(this.currentInput)) return;
    commands.push(this.takeCurrentCommand());
  }

  private takeCurrentCommand(): ScheduledMovementInput {
    const command = { ...this.currentInput, dt: this.unsentDt };
    this.unsentDt = 0;
    return command;
  }
}
