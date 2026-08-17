const RATE_WINDOW_MS = 1_000;

export interface NetworkDiagnostics {
  movementMessagesPerSecond: number;
  snapshotMessagesPerSecond: number;
  snapshotAgeMs: number | null;
  bufferedAmount: number;
}

export class NetworkDiagnosticsTracker {
  private movementSendTimes: number[] = [];
  private snapshotReceiveTimes: number[] = [];
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

  getDiagnostics(now: number, bufferedAmount: number): NetworkDiagnostics {
    this.prune(this.movementSendTimes, now);
    this.prune(this.snapshotReceiveTimes, now);
    return {
      movementMessagesPerSecond: this.movementSendTimes.length,
      snapshotMessagesPerSecond: this.snapshotReceiveTimes.length,
      snapshotAgeMs:
        this.lastSnapshotAt === null ? null : Math.max(0, now - this.lastSnapshotAt),
      bufferedAmount: Math.max(0, bufferedAmount),
    };
  }

  reset(): void {
    this.movementSendTimes = [];
    this.snapshotReceiveTimes = [];
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
