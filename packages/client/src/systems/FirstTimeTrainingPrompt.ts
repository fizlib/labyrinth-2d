const FIRST_TIME_TRAINING_PROMPT_STORAGE_PREFIX =
  'labyrinth-first-time-training-prompt-v1';

export function getFirstTimeTrainingPromptStorageKey(profileId: string): string {
  return `${FIRST_TIME_TRAINING_PROMPT_STORAGE_PREFIX}:${profileId}`;
}

/**
 * Existing competitors should not receive a newly introduced onboarding prompt.
 * Guests have no persisted match record, so the per-profile seen flag is their
 * source of truth.
 */
export function shouldOfferFirstTimeTrainingPrompt(
  matchesPlayed: number | null,
  hasSeenPrompt: boolean,
): boolean {
  return !hasSeenPrompt && (matchesPlayed === null || matchesPlayed === 0);
}
