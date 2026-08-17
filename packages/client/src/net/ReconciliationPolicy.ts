export const MAX_RECONCILIATION_REPLAY_INPUTS = 12;

/**
 * Returns the exact inputs to replay, or null when an acknowledgement backlog
 * is large enough that replaying collision physics would risk a feedback loop.
 */
export function getReconciliationInputs<T>(
  pendingInputs: readonly T[],
  unsentInputs: readonly T[],
  maxInputs = MAX_RECONCILIATION_REPLAY_INPUTS,
): T[] | null {
  if (pendingInputs.length + unsentInputs.length > maxInputs) return null;
  return [...pendingInputs, ...unsentInputs];
}
