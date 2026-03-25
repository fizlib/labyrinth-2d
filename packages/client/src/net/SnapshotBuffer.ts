// packages/client/src/net/SnapshotBuffer.ts
// ─────────────────────────────────────────────────────────────────────────────
// SnapshotBuffer — Stores timestamped server state snapshots for interpolation.
//
// Remote players are rendered at a position interpolated between two server
// snapshots, using a fixed INTERPOLATION_DELAY (100ms = 2 server ticks).
// This hides the 20-tps update rate and produces smooth 60-fps visuals.
//
// The local player is NOT affected — it uses client-side prediction.
// ─────────────────────────────────────────────────────────────────────────────

import type { GameState } from '@labyrinth/shared';

/** A GameState snapshot tagged with the local timestamp of when it was received. */
export interface TimestampedSnapshot {
  /** Local time (performance.now()) when this snapshot was received. */
  receivedAt: number;
  /** The server game state. */
  state: GameState;
}

/**
 * How far back in time (ms) we render remote entities.
 * 100ms = 2 server ticks at 20 TPS.
 * This gives us a guaranteed pair of snapshots to interpolate between,
 * even if one tick is slightly delayed.
 */
export const INTERPOLATION_DELAY = 100;

/** Maximum age (ms) before a snapshot is pruned from the buffer. */
const MAX_SNAPSHOT_AGE = 1000;

export class SnapshotBuffer {
  private buffer: TimestampedSnapshot[] = [];

  /** Number of snapshots currently in the buffer. */
  get length(): number {
    return this.buffer.length;
  }

  /**
   * Add a new snapshot to the buffer.
   * Called every time a TickUpdate arrives from the server.
   */
  push(state: GameState): void {
    this.buffer.push({
      receivedAt: performance.now(),
      state,
    });

    // Prune old snapshots to prevent unbounded growth
    this.prune();
  }

  /**
   * Remove snapshots older than MAX_SNAPSHOT_AGE.
   */
  private prune(): void {
    const cutoff = performance.now() - MAX_SNAPSHOT_AGE;
    // Find first snapshot that's not too old
    let firstValid = 0;
    while (firstValid < this.buffer.length && this.buffer[firstValid].receivedAt < cutoff) {
      firstValid++;
    }
    // Keep one snapshot before the cutoff for interpolation continuity
    if (firstValid > 1) {
      this.buffer.splice(0, firstValid - 1);
    }
  }

  /**
   * Find the two snapshots bracketing a given render time.
   *
   * @param renderTime  The target time to interpolate at (performance.now() - INTERPOLATION_DELAY)
   * @returns           { past, future, t } where t is the interpolation factor [0..1],
   *                    or null if not enough snapshots exist.
   */
  getInterpolationPair(renderTime: number): {
    past: TimestampedSnapshot;
    future: TimestampedSnapshot;
    t: number;
  } | null {
    if (this.buffer.length < 2) return null;

    // Find the two snapshots that bracket renderTime:
    // past.receivedAt <= renderTime <= future.receivedAt
    for (let i = 0; i < this.buffer.length - 1; i++) {
      const past = this.buffer[i];
      const future = this.buffer[i + 1];

      if (past.receivedAt <= renderTime && renderTime <= future.receivedAt) {
        const range = future.receivedAt - past.receivedAt;
        const t = range > 0 ? (renderTime - past.receivedAt) / range : 0;
        return { past, future, t: Math.max(0, Math.min(1, t)) };
      }
    }

    // Edge case: renderTime is past all snapshots (network lag spike).
    // Clamp to the latest snapshot.
    return null;
  }

  /**
   * Get the latest snapshot in the buffer.
   * Used as fallback when interpolation pair is not available.
   */
  getLatest(): TimestampedSnapshot | null {
    return this.buffer.length > 0 ? this.buffer[this.buffer.length - 1] : null;
  }

  /** Clear all snapshots. */
  clear(): void {
    this.buffer.length = 0;
  }
}
