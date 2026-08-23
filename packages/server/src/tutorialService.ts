import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type {
  TutorialDepartureReason,
  TutorialReminderProvider,
  TutorialSource,
  TutorialStatus,
} from '@labyrinth/shared';

import {
  getSupabaseAdminClient,
  isSupabaseMatchPersistenceConfigured,
  verifyPlayerAccessToken,
} from './supabaseAdmin.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const GUEST_ID_PATTERN = /^guest:[A-Za-z0-9:-]{1,122}$/;
const UPDATE_TOKEN_BYTES = 32;

interface TutorialSessionRow {
  id: string;
  status: TutorialStatus;
  started_at: string;
  update_token_hash: string;
  reminder_opened_at: string | null;
  discord_reminder_clicked_at: string | null;
  google_calendar_clicked_at: string | null;
}

export interface TutorialSessionCredential {
  id: string;
  updateToken: string;
  startedAt: string;
}

export type TutorialSessionEvent =
  | { event: 'heartbeat'; updateToken: string }
  | { event: 'completed'; updateToken: string }
  | {
      event: 'left';
      updateToken: string;
      departureReason: Exclude<TutorialDepartureReason, 'inactivity_timeout'>;
    }
  | { event: 'reminder_opened'; updateToken: string }
  | {
      event: 'reminder_clicked';
      updateToken: string;
      provider: TutorialReminderProvider;
    };

export class TutorialServiceError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function requireConfiguration(): void {
  if (!isSupabaseMatchPersistenceConfigured) {
    throw new TutorialServiceError(
      503,
      'TUTORIAL_PERSISTENCE_NOT_CONFIGURED',
      'Tutorial analytics persistence is not configured on the game server.',
    );
  }
}

function normalizeDisplayName(value: unknown): string {
  if (typeof value !== 'string') {
    throw new TutorialServiceError(400, 'INVALID_BODY', 'displayName is required.');
  }
  const normalized = value.trim().replace(/\s+/g, ' ');
  const length = Array.from(normalized).length;
  if (length < 1 || length > 32) {
    throw new TutorialServiceError(
      400,
      'INVALID_DISPLAY_NAME',
      'Display name must be between 1 and 32 characters.',
    );
  }
  return normalized;
}

function readSource(value: unknown): TutorialSource {
  if (value === 'main_menu' || value === 'first_time_queue') return value;
  throw new TutorialServiceError(
    400,
    'INVALID_TUTORIAL_SOURCE',
    'Tutorial source must be main_menu or first_time_queue.',
  );
}

function hashUpdateToken(updateToken: string): string {
  return createHash('sha256').update(updateToken, 'utf8').digest('hex');
}

export function isValidTutorialUpdateToken(
  updateToken: unknown,
  expectedHash: string,
): updateToken is string {
  if (
    typeof updateToken !== 'string' ||
    updateToken.length < 32 ||
    updateToken.length > 256 ||
    !/^[0-9a-f]{64}$/.test(expectedHash)
  ) {
    return false;
  }
  const actual = Buffer.from(hashUpdateToken(updateToken), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function createTutorialSession(
  accessToken: string | null,
  body: Record<string, unknown>,
): Promise<TutorialSessionCredential> {
  requireConfiguration();
  const source = readSource(body.source);
  let profileId: string | null = null;
  let participantId: string;
  let displayName: string;
  let isGuest: boolean;

  if (accessToken) {
    const identity = await verifyPlayerAccessToken(accessToken);
    if (!identity) {
      throw new TutorialServiceError(
        401,
        'INVALID_TOKEN',
        'Your session is no longer valid.',
      );
    }
    if (identity.suspendedAt) {
      throw new TutorialServiceError(
        403,
        'ACCOUNT_SUSPENDED',
        'This account is suspended.',
      );
    }
    profileId = identity.userId;
    participantId = identity.userId;
    displayName = identity.displayName;
    isGuest = false;
  } else {
    const guestId = body.guestId;
    if (typeof guestId !== 'string' || !GUEST_ID_PATTERN.test(guestId)) {
      throw new TutorialServiceError(
        400,
        'INVALID_GUEST_ID',
        'A valid guest session ID is required.',
      );
    }
    participantId = guestId;
    displayName = normalizeDisplayName(body.displayName);
    isGuest = true;
  }

  const id = randomUUID();
  const updateToken = randomBytes(UPDATE_TOKEN_BYTES).toString('base64url');
  const now = new Date().toISOString();
  const { error } = await getSupabaseAdminClient()
    .from('tutorial_sessions')
    .insert({
      id,
      profile_id: profileId,
      participant_id: participantId,
      display_name: displayName,
      is_guest: isGuest,
      source,
      status: 'in_progress',
      started_at: now,
      last_activity_at: now,
      update_token_hash: hashUpdateToken(updateToken),
    });
  if (error) {
    throw new TutorialServiceError(502, 'SUPABASE_ERROR', error.message);
  }
  return { id, updateToken, startedAt: now };
}

function readUpdateEvent(body: Record<string, unknown>): TutorialSessionEvent {
  const updateToken = body.updateToken;
  if (typeof updateToken !== 'string') {
    throw new TutorialServiceError(400, 'INVALID_BODY', 'updateToken is required.');
  }
  if (body.event === 'heartbeat' || body.event === 'completed') {
    return { event: body.event, updateToken };
  }
  if (body.event === 'left') {
    const departureReason = body.departureReason;
    if (departureReason !== 'explicit_exit' && departureReason !== 'page_unload') {
      throw new TutorialServiceError(
        400,
        'INVALID_DEPARTURE_REASON',
        'Departure reason must be explicit_exit or page_unload.',
      );
    }
    return { event: 'left', updateToken, departureReason };
  }
  if (body.event === 'reminder_opened') {
    return { event: 'reminder_opened', updateToken };
  }
  if (body.event === 'reminder_clicked') {
    const provider = body.provider;
    if (provider !== 'discord' && provider !== 'google_calendar') {
      throw new TutorialServiceError(
        400,
        'INVALID_REMINDER_PROVIDER',
        'Reminder provider must be discord or google_calendar.',
      );
    }
    return { event: 'reminder_clicked', updateToken, provider };
  }
  throw new TutorialServiceError(400, 'INVALID_TUTORIAL_EVENT', 'Unknown event.');
}

function elapsedMilliseconds(startedAt: string, endedAt: string): number {
  return Math.max(0, Date.parse(endedAt) - Date.parse(startedAt));
}

export async function updateTutorialSession(
  sessionId: string,
  body: Record<string, unknown>,
): Promise<{ id: string; accepted: true }> {
  requireConfiguration();
  if (!UUID_PATTERN.test(sessionId)) {
    throw new TutorialServiceError(
      400,
      'INVALID_TUTORIAL_SESSION_ID',
      'A valid tutorial session ID is required.',
    );
  }
  const event = readUpdateEvent(body);
  const client = getSupabaseAdminClient();
  const { data, error } = await client
    .from('tutorial_sessions')
    .select(
      'id, status, started_at, update_token_hash, reminder_opened_at, discord_reminder_clicked_at, google_calendar_clicked_at',
    )
    .eq('id', sessionId)
    .maybeSingle();
  if (error) throw new TutorialServiceError(502, 'SUPABASE_ERROR', error.message);
  if (!data) {
    throw new TutorialServiceError(
      404,
      'TUTORIAL_SESSION_NOT_FOUND',
      'Tutorial session not found.',
    );
  }
  const row = data as TutorialSessionRow;
  if (!isValidTutorialUpdateToken(event.updateToken, row.update_token_hash)) {
    throw new TutorialServiceError(
      403,
      'INVALID_TUTORIAL_UPDATE_TOKEN',
      'Tutorial update credential is invalid.',
    );
  }

  const now = new Date().toISOString();
  let request = null;
  if (event.event === 'heartbeat') {
    if (row.status === 'in_progress') {
      request = client
        .from('tutorial_sessions')
        .update({ last_activity_at: now })
        .eq('id', sessionId)
        .eq('status', 'in_progress');
    }
  } else if (event.event === 'completed') {
    if (row.status !== 'completed') {
      request = client
        .from('tutorial_sessions')
        .update({
          status: 'completed',
          departure_reason: null,
          last_activity_at: now,
          ended_at: now,
          duration_ms: elapsedMilliseconds(row.started_at, now),
        })
        .eq('id', sessionId);
    }
  } else if (event.event === 'left') {
    if (row.status === 'in_progress') {
      request = client
        .from('tutorial_sessions')
        .update({
          status: 'left',
          departure_reason: event.departureReason,
          last_activity_at: now,
          ended_at: now,
          duration_ms: elapsedMilliseconds(row.started_at, now),
        })
        .eq('id', sessionId)
        .eq('status', 'in_progress');
    }
  } else {
    // A queued player sees the schedule prompt after returning from training,
    // whether they completed it or left early. Reminder telemetry must not
    // rewrite that tutorial outcome.
    if (event.event === 'reminder_opened' && !row.reminder_opened_at) {
      request = client
        .from('tutorial_sessions')
        .update({ reminder_opened_at: now })
        .eq('id', sessionId)
        .is('reminder_opened_at', null);
    }
    if (event.event === 'reminder_clicked') {
      const column =
        event.provider === 'discord'
          ? 'discord_reminder_clicked_at'
          : 'google_calendar_clicked_at';
      const alreadyClicked =
        event.provider === 'discord'
          ? row.discord_reminder_clicked_at
          : row.google_calendar_clicked_at;
      if (!alreadyClicked) {
        request = client
          .from('tutorial_sessions')
          .update({ [column]: now })
          .eq('id', sessionId)
          .is(column, null);
      }
    }
  }

  if (request) {
    const { error: updateError } = await request;
    if (updateError) {
      throw new TutorialServiceError(502, 'SUPABASE_ERROR', updateError.message);
    }
  }
  return { id: sessionId, accepted: true };
}
