import {
  DEFAULT_COMMUNITY_ROUND_SCHEDULE,
  type CommunityRoundSchedule,
} from '@labyrinth/shared';
import { buildAdminApiUrl } from '../admin/AdminApiUrl';
import { getGameServerUrl } from '../net/GameServerUrl';

let cachedSchedule: CommunityRoundSchedule = DEFAULT_COMMUNITY_ROUND_SCHEDULE;
let pendingSchedule: Promise<CommunityRoundSchedule> | null = null;
let hasLoadedSchedule = false;

function scheduleApiUrl(): string {
  return buildAdminApiUrl(
    'community-round-schedule',
    getGameServerUrl(),
    window.location.origin,
    import.meta.env.DEV,
  );
}

function isCommunityRoundSchedule(value: unknown): value is CommunityRoundSchedule {
  if (!value || typeof value !== 'object') return false;
  const schedule = value as Partial<CommunityRoundSchedule>;
  return (
    typeof schedule.startsAt === 'string' &&
    !Number.isNaN(new Date(schedule.startsAt).getTime()) &&
    ['daily', 'weekly', 'monthly'].includes(schedule.frequency ?? '') &&
    typeof schedule.timeZone === 'string'
  );
}

export function getCachedCommunityRoundSchedule(): CommunityRoundSchedule {
  return cachedSchedule;
}

export function cacheCommunityRoundSchedule(
  schedule: CommunityRoundSchedule,
): CommunityRoundSchedule {
  cachedSchedule = schedule;
  hasLoadedSchedule = true;
  return schedule;
}

export function loadCommunityRoundSchedule(
  force = false,
): Promise<CommunityRoundSchedule> {
  if (pendingSchedule) return pendingSchedule;
  if (!force && hasLoadedSchedule) return Promise.resolve(cachedSchedule);
  pendingSchedule = fetch(scheduleApiUrl(), {
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    headers: { Accept: 'application/json' },
  })
    .then(async (response) => {
      if (!response.ok) throw new Error(`Schedule request failed (${response.status}).`);
      const payload: unknown = await response.json();
      if (!isCommunityRoundSchedule(payload)) {
        throw new Error('The game server returned an invalid community round schedule.');
      }
      return cacheCommunityRoundSchedule(payload);
    })
    .finally(() => {
      pendingSchedule = null;
    });
  return pendingSchedule;
}
