export const CLIENT_SNAPSHOT_APPLY_RATE = 10;
export const CLIENT_SNAPSHOT_APPLY_INTERVAL_MS = 1_000 / CLIENT_SNAPSHOT_APPLY_RATE;
export const CLIENT_SNAPSHOT_COALESCE_WINDOW_MS = 16;

export interface LatestSnapshotSchedulerOptions<T> {
  apply: (snapshot: T) => void;
  now?: () => number;
  schedule?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  cancel?: (handle: ReturnType<typeof setTimeout>) => void;
  intervalMs?: number;
  coalesceWindowMs?: number;
}

/**
 * Limits expensive snapshot application while retaining only the newest state.
 * Network messages can arrive in a burst after a mobile main-thread stall; old
 * snapshots are superseded instead of forcing chat and input acknowledgements
 * to wait behind every intermediate state update.
 */
export class LatestSnapshotScheduler<T> {
  private readonly apply: (snapshot: T) => void;
  private readonly now: () => number;
  private readonly schedule: (
    callback: () => void,
    delayMs: number,
  ) => ReturnType<typeof setTimeout>;
  private readonly cancel: (handle: ReturnType<typeof setTimeout>) => void;
  private readonly intervalMs: number;
  private readonly coalesceWindowMs: number;
  private pendingSnapshot: T | null = null;
  private scheduledHandle: ReturnType<typeof setTimeout> | null = null;
  private lastAppliedAt = -Infinity;

  constructor(options: LatestSnapshotSchedulerOptions<T>) {
    this.apply = options.apply;
    this.now = options.now ?? (() => performance.now());
    this.schedule = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.cancel = options.cancel ?? ((handle) => clearTimeout(handle));
    this.intervalMs = Math.max(0, options.intervalMs ?? CLIENT_SNAPSHOT_APPLY_INTERVAL_MS);
    this.coalesceWindowMs = Math.max(
      0,
      options.coalesceWindowMs ?? CLIENT_SNAPSHOT_COALESCE_WINDOW_MS,
    );
  }

  /** Returns true when an older, not-yet-applied snapshot was superseded. */
  enqueue(snapshot: T): boolean {
    const superseded = this.pendingSnapshot !== null;
    this.pendingSnapshot = snapshot;
    if (this.scheduledHandle !== null) return superseded;

    const elapsed = this.now() - this.lastAppliedAt;
    // Always leave one short event-loop window for already-buffered WebSocket
    // messages to arrive and replace stale snapshots before doing heavy work.
    const delayMs = Math.max(this.coalesceWindowMs, this.intervalMs - elapsed);
    this.scheduledHandle = this.schedule(() => this.flush(), delayMs);
    return superseded;
  }

  reset(): void {
    if (this.scheduledHandle !== null) this.cancel(this.scheduledHandle);
    this.scheduledHandle = null;
    this.pendingSnapshot = null;
    this.lastAppliedAt = -Infinity;
  }

  private flush(): void {
    this.scheduledHandle = null;
    const snapshot = this.pendingSnapshot;
    this.pendingSnapshot = null;
    if (snapshot === null) return;

    this.lastAppliedAt = this.now();
    this.apply(snapshot);
  }
}
