const RATE_WINDOW_MS = 1_000;

export interface NetworkDiagnostics {
  movementMessagesPerSecond: number;
  snapshotMessagesPerSecond: number;
  snapshotApplicationsPerSecond: number;
  coalescedSnapshotsPerSecond: number;
  snapshotAgeMs: number | null;
  bufferedAmount: number;
}

export class NetworkDiagnosticsTracker {
  private movementSendTimes: number[] = [];
  private snapshotReceiveTimes: number[] = [];
  private snapshotApplyTimes: number[] = [];
  private snapshotCoalesceTimes: number[] = [];
  private lastSnapshotAt: number | null = null;

  recordMovementSent(now: number): void {
    this.movementSendTimes.push(now);
    this.prune(this.movementSendTimes, now);
  }

  recordSnapshotReceived(now: number): void {
    this.snapshotReceiveTimes.push(now);
    this.lastSnapshotAt = now;
    this.prune(this.snapshotReceiveTimes, now);
  }

  recordSnapshotApplied(now: number): void {
    this.snapshotApplyTimes.push(now);
    this.prune(this.snapshotApplyTimes, now);
  }

  recordSnapshotCoalesced(now: number): void {
    this.snapshotCoalesceTimes.push(now);
    this.prune(this.snapshotCoalesceTimes, now);
  }

  getDiagnostics(now: number, bufferedAmount: number): NetworkDiagnostics {
    this.prune(this.movementSendTimes, now);
    this.prune(this.snapshotReceiveTimes, now);
    this.prune(this.snapshotApplyTimes, now);
    this.prune(this.snapshotCoalesceTimes, now);
    return {
      movementMessagesPerSecond: this.movementSendTimes.length,
      snapshotMessagesPerSecond: this.snapshotReceiveTimes.length,
      snapshotApplicationsPerSecond: this.snapshotApplyTimes.length,
      coalescedSnapshotsPerSecond: this.snapshotCoalesceTimes.length,
      snapshotAgeMs:
        this.lastSnapshotAt === null ? null : Math.max(0, now - this.lastSnapshotAt),
      bufferedAmount: Math.max(0, bufferedAmount),
    };
  }

  reset(): void {
    this.movementSendTimes = [];
    this.snapshotReceiveTimes = [];
    this.snapshotApplyTimes = [];
    this.snapshotCoalesceTimes = [];
    this.lastSnapshotAt = null;
  }

  private prune(timestamps: number[], now: number): void {
    const cutoff = now - RATE_WINDOW_MS;
    let expiredCount = 0;
    while (expiredCount < timestamps.length && timestamps[expiredCount] <= cutoff) {
      expiredCount++;
    }
    if (expiredCount > 0) timestamps.splice(0, expiredCount);
  }
}
