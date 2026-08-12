/** Duration of one match after the lobby countdown completes. */
export const MATCH_DURATION_MS = 10 * 60 * 1_000;

/** Maximum feet-to-portal distance for an escape interaction. */
export const PORTAL_INTERACTION_RANGE = 28;

/** Full-room survivor victory ratio: five of seven survivors. */
export const SURVIVOR_ESCAPE_RATIO_NUMERATOR = 5;
export const SURVIVOR_ESCAPE_RATIO_DENOMINATOR = 7;

/**
 * Preserve the five-of-seven victory ratio for the connected survivor count.
 * A room with no connected survivors still requires one escape, preventing an
 * empty survivor side from winning automatically.
 */
export function getSurvivorEscapeThreshold(connectedSurvivors: number): number {
  const survivorCount = Number.isFinite(connectedSurvivors)
    ? Math.max(0, Math.floor(connectedSurvivors))
    : 0;
  return Math.max(
    1,
    Math.ceil(
      (survivorCount * SURVIVOR_ESCAPE_RATIO_NUMERATOR) /
        SURVIVOR_ESCAPE_RATIO_DENOMINATOR,
    ),
  );
}

/** Return the non-negative number of additional escapes needed for victory. */
export function getRemainingSurvivorsToEscape(
  escapedSurvivors: number,
  connectedSurvivors: number,
): number {
  const escapedCount = Number.isFinite(escapedSurvivors)
    ? Math.max(0, Math.floor(escapedSurvivors))
    : 0;
  return Math.max(0, getSurvivorEscapeThreshold(connectedSurvivors) - escapedCount);
}

/** Shared client/server portal proximity check. */
export function isWithinPortalInteractionRange(
  player: { x: number; y: number },
  portal: { x: number; y: number },
): boolean {
  const dx = player.x - portal.x;
  const dy = player.y - portal.y;
  return dx * dx + dy * dy <= PORTAL_INTERACTION_RANGE * PORTAL_INTERACTION_RANGE;
}
