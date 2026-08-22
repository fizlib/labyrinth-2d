import type { LobbyState } from '@labyrinth/shared';

const OTHER_PLAYERS_REQUIRED_TO_SKIP_PROMPT = 3;

/** Show the return prompt only while this player is in a sparsely populated lobby. */
export function shouldShowTrainingCompletionPrompt(
  lobby: LobbyState,
  localPlayerId: string,
): boolean {
  if (lobby.phase !== 'waiting') return false;

  const otherWaitingPlayers = lobby.players.filter(
    (player) => player.connected && player.id !== localPlayerId,
  ).length;
  return otherWaitingPlayers < OTHER_PLAYERS_REQUIRED_TO_SKIP_PROMPT;
}
