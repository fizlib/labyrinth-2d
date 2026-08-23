import type {
  TutorialDepartureReason,
  TutorialReminderProvider,
  TutorialSource,
} from '@labyrinth/shared';

import { getGameServerUrl } from '../net/GameServerUrl';
import { buildTutorialApiUrl } from './TutorialApiUrl';

const HEARTBEAT_INTERVAL_MS = 30_000;
const PENDING_EVENTS_STORAGE_KEY = 'labyrinth-tutorial-pending-events-v1';
const REMINDER_CREDENTIAL_STORAGE_KEY = 'labyrinth-tutorial-reminder-session-v1';

interface TutorialCredential {
  id: string;
  updateToken: string;
  startedAt: string;
}

interface StoredReminderCredential extends TutorialCredential {
  profileId: string;
}

type TutorialUpdatePayload =
  | { event: 'heartbeat' }
  | { event: 'completed' }
  | {
      event: 'left';
      departureReason: Exclude<TutorialDepartureReason, 'inactivity_timeout'>;
    }
  | { event: 'reminder_opened' }
  | { event: 'reminder_clicked'; provider: TutorialReminderProvider };

interface PendingTutorialEvent {
  credential: TutorialCredential;
  payload: Exclude<TutorialUpdatePayload, { event: 'heartbeat' }>;
}

export interface TutorialTelemetryOptions {
  profileId: string;
  displayName: string;
  isGuest: boolean;
  accessToken: string | null;
  source: TutorialSource;
  persistForReminder: boolean;
}

export interface TutorialReminderReporter {
  onReminderOpened: () => void;
  onReminderClicked: (provider: TutorialReminderProvider) => void;
}

function tutorialApiUrl(path: string): string {
  return buildTutorialApiUrl(
    path,
    getGameServerUrl(),
    window.location.origin,
    import.meta.env.DEV,
  );
}

function isCredential(value: unknown): value is TutorialCredential {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<TutorialCredential>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.updateToken === 'string' &&
    typeof candidate.startedAt === 'string'
  );
}

function loadPendingEvents(): PendingTutorialEvent[] {
  try {
    const value = JSON.parse(
      window.sessionStorage.getItem(PENDING_EVENTS_STORAGE_KEY) ?? '[]',
    ) as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is PendingTutorialEvent => {
      if (!entry || typeof entry !== 'object') return false;
      const candidate = entry as Partial<PendingTutorialEvent>;
      return isCredential(candidate.credential) && Boolean(candidate.payload);
    });
  } catch {
    return [];
  }
}

function pendingEventKey(event: PendingTutorialEvent): string {
  const provider =
    event.payload.event === 'reminder_clicked' ? event.payload.provider : '';
  return `${event.credential.id}:${event.payload.event}:${provider}`;
}

function storePendingEvents(events: PendingTutorialEvent[]): void {
  try {
    if (events.length === 0) {
      window.sessionStorage.removeItem(PENDING_EVENTS_STORAGE_KEY);
    } else {
      window.sessionStorage.setItem(
        PENDING_EVENTS_STORAGE_KEY,
        JSON.stringify(events.slice(-12)),
      );
    }
  } catch {
    // The timeout finalizer still closes abandoned attempts without browser storage.
  }
}

function queuePendingEvent(event: PendingTutorialEvent): void {
  let events = loadPendingEvents();
  if (event.payload.event === 'completed') {
    events = events.filter(
      (candidate) =>
        candidate.credential.id !== event.credential.id ||
        candidate.payload.event !== 'left',
    );
  }
  if (
    event.payload.event === 'left' &&
    events.some(
      (candidate) =>
        candidate.credential.id === event.credential.id &&
        candidate.payload.event === 'completed',
    )
  ) {
    return;
  }
  const key = pendingEventKey(event);
  events = events.filter((candidate) => pendingEventKey(candidate) !== key);
  events.push(event);
  storePendingEvents(events);
}

function clearPendingEvent(event: PendingTutorialEvent): void {
  const key = pendingEventKey(event);
  storePendingEvents(
    loadPendingEvents().filter((candidate) => pendingEventKey(candidate) !== key),
  );
}

async function sendTutorialUpdate(
  credential: TutorialCredential,
  payload: TutorialUpdatePayload,
  persistFailure: boolean,
): Promise<boolean> {
  const pending = payload.event === 'heartbeat' ? null : { credential, payload };
  if (pending && persistFailure) queuePendingEvent(pending);
  try {
    const response = await fetch(
      tutorialApiUrl(`sessions/${encodeURIComponent(credential.id)}`),
      {
        method: 'PATCH',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, updateToken: credential.updateToken }),
      },
    );
    if (!response.ok) return false;
    if (pending) clearPendingEvent(pending);
    return true;
  } catch {
    return false;
  }
}

function storeReminderCredential(
  profileId: string,
  credential: TutorialCredential,
): void {
  try {
    const value: StoredReminderCredential = { ...credential, profileId };
    window.sessionStorage.setItem(REMINDER_CREDENTIAL_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Reminder links still work even when analytics storage is unavailable.
  }
}

function loadReminderCredential(profileId: string): TutorialCredential | null {
  try {
    const value = JSON.parse(
      window.sessionStorage.getItem(REMINDER_CREDENTIAL_STORAGE_KEY) ?? 'null',
    ) as Partial<StoredReminderCredential> | null;
    return value?.profileId === profileId && isCredential(value) ? value : null;
  } catch {
    return null;
  }
}

export function flushPendingTutorialTelemetry(): void {
  for (const pending of loadPendingEvents()) {
    void sendTutorialUpdate(pending.credential, pending.payload, false).then(
      (accepted) => {
        if (accepted) clearPendingEvent(pending);
      },
    );
  }
}

export function createTutorialReminderReporter(
  profileId: string,
): TutorialReminderReporter | null {
  const credential = loadReminderCredential(profileId);
  if (!credential) return null;
  return {
    onReminderOpened: () => {
      void sendTutorialUpdate(credential, { event: 'reminder_opened' }, true);
    },
    onReminderClicked: (provider) => {
      void sendTutorialUpdate(
        credential,
        { event: 'reminder_clicked', provider },
        true,
      );
    },
  };
}

export class TutorialTelemetrySession {
  private state: 'idle' | 'active' | 'completed' | 'left' = 'idle';
  private credential: TutorialCredential | null = null;
  private startPromise: Promise<TutorialCredential | null> | null = null;
  private pendingTerminalEvent: Exclude<
    TutorialUpdatePayload,
    { event: 'heartbeat' }
  > | null = null;
  private heartbeatTimer: number | null = null;
  private readonly handlePageHide = () => this.leave('page_unload');

  constructor(private readonly options: TutorialTelemetryOptions) {}

  start(): void {
    if (this.state !== 'idle') return;
    this.state = 'active';
    window.addEventListener('pagehide', this.handlePageHide);
    this.startPromise = this.createSession();
    void this.startPromise.then((credential) => {
      if (!credential) return;
      this.credential = credential;
      if (this.options.persistForReminder) {
        storeReminderCredential(this.options.profileId, credential);
      }
      if (this.pendingTerminalEvent) {
        void sendTutorialUpdate(credential, this.pendingTerminalEvent, true);
        return;
      }
      if (this.state === 'active') {
        this.heartbeatTimer = window.setInterval(() => {
          void sendTutorialUpdate(credential, { event: 'heartbeat' }, false);
        }, HEARTBEAT_INTERVAL_MS);
      }
    });
  }

  complete(): void {
    if (this.state === 'completed') return;
    this.state = 'completed';
    this.finish({ event: 'completed' });
  }

  leave(departureReason: Exclude<TutorialDepartureReason, 'inactivity_timeout'>): void {
    if (this.state !== 'active') return;
    this.state = 'left';
    this.finish({ event: 'left', departureReason });
  }

  private finish(payload: Exclude<TutorialUpdatePayload, { event: 'heartbeat' }>): void {
    this.pendingTerminalEvent = payload;
    if (this.heartbeatTimer !== null) {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    window.removeEventListener('pagehide', this.handlePageHide);
    if (this.credential) {
      void sendTutorialUpdate(this.credential, payload, true);
    }
  }

  private async createSession(): Promise<TutorialCredential | null> {
    try {
      const response = await fetch(tutorialApiUrl('sessions'), {
        method: 'POST',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        keepalive: true,
        headers: {
          'Content-Type': 'application/json',
          ...(this.options.accessToken
            ? { Authorization: `Bearer ${this.options.accessToken}` }
            : {}),
        },
        body: JSON.stringify({
          source: this.options.source,
          displayName: this.options.displayName,
          ...(this.options.isGuest ? { guestId: this.options.profileId } : {}),
        }),
      });
      if (!response.ok) return null;
      const value = (await response.json()) as unknown;
      return isCredential(value) ? value : null;
    } catch {
      return null;
    }
  }
}
