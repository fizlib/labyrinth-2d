/** Duration of one match after the lobby countdown completes. */
export const MATCH_DURATION_MS = 10 * 60 * 1_000;

/** Initial competitive rating for a newly authenticated player. */
export const INITIAL_ELO_RATING = 1200;

/** Ratings never fall below this display and matchmaking floor. */
export const MIN_ELO_RATING = 100;

/** Standard Elo divisor used to convert rating gaps into expected scores. */
export const ELO_RATING_SCALE = 400;

/** Number of completed rated matches that use the faster provisional K-factor. */
export const ELO_PROVISIONAL_MATCHES = 10;

export const ELO_PROVISIONAL_K_FACTOR = 40;
export const ELO_ESTABLISHED_K_FACTOR = 24;

export type EloRole = 'survivor' | 'warden';
export type EloWinner = 'survivors' | 'wardens';

export interface TeamEloParticipant {
  playerId: string;
  role: EloRole;
  rating: number;
  matchesPlayed: number;
}

export interface TeamEloResult extends TeamEloParticipant {
  expectedScore: number;
  actualScore: 0 | 1;
  kFactor: number;
  ratingDelta: number;
  ratingAfter: number;
}

function averageRating(participants: TeamEloParticipant[]): number {
  return (
    participants.reduce((total, participant) => total + participant.rating, 0) /
    participants.length
  );
}

function roundSymmetrically(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value));
}

/**
 * Calculate one team-result Elo update for an asymmetric survivor/warden match.
 * Team averages are compared so the seven-versus-two role split does not make
 * the larger side appear stronger merely because it has more players.
 */
export function calculateTeamEloRatings(
  participants: readonly TeamEloParticipant[],
  winner: EloWinner,
): TeamEloResult[] {
  const normalized = participants.map((participant) => ({
    ...participant,
    rating: Math.max(MIN_ELO_RATING, Math.round(participant.rating)),
    matchesPlayed: Math.max(0, Math.floor(participant.matchesPlayed)),
  }));
  const survivors = normalized.filter((participant) => participant.role === 'survivor');
  const wardens = normalized.filter((participant) => participant.role === 'warden');
  if (survivors.length === 0 || wardens.length === 0) {
    throw new Error('Team Elo requires at least one survivor and one warden.');
  }

  const survivorAverage = averageRating(survivors);
  const wardenAverage = averageRating(wardens);
  const expectedSurvivors =
    1 / (1 + 10 ** ((wardenAverage - survivorAverage) / ELO_RATING_SCALE));

  return normalized.map((participant) => {
    const isSurvivor = participant.role === 'survivor';
    const expectedScore = isSurvivor ? expectedSurvivors : 1 - expectedSurvivors;
    const actualScore: 0 | 1 =
      (isSurvivor && winner === 'survivors') || (!isSurvivor && winner === 'wardens')
        ? 1
        : 0;
    const kFactor =
      participant.matchesPlayed < ELO_PROVISIONAL_MATCHES
        ? ELO_PROVISIONAL_K_FACTOR
        : ELO_ESTABLISHED_K_FACTOR;
    const requestedDelta = roundSymmetrically(kFactor * (actualScore - expectedScore));
    const ratingAfter = Math.max(MIN_ELO_RATING, participant.rating + requestedDelta);

    return {
      ...participant,
      expectedScore,
      actualScore,
      kFactor,
      ratingDelta: ratingAfter - participant.rating,
      ratingAfter,
    };
  });
}

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
