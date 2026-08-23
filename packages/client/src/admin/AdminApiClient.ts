import type {
  AdminCompletedRoundDetail,
  AdminCompletedRoundSummary,
  AdminMutationResult,
  AdminOverview,
  AdminPage,
  AdminTutorialReport,
  AdminUserSummary,
  CommunityRoundSchedule,
} from './types';
import type { AdminApiError } from '@labyrinth/shared';
import { getGameServerUrl } from '../net/GameServerUrl';
import { buildAdminApiUrl } from './AdminApiUrl';

export class AdminApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function adminApiUrl(path: string): string {
  return buildAdminApiUrl(
    path,
    getGameServerUrl(),
    window.location.origin,
    import.meta.env.DEV,
  );
}

export class AdminApiClient {
  constructor(private readonly accessToken: () => string | null) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const token = this.accessToken();
    if (!token) {
      throw new AdminApiRequestError(401, 'AUTH_REQUIRED', 'Sign in is required.');
    }
    const response = await fetch(adminApiUrl(path), {
      ...init,
      // Supabase authentication is carried by the explicit bearer token. Omitting
      // unrelated localhost cookies keeps requests below uWebSockets' header limit.
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    });
    const payload = (await response.json().catch(() => null)) as T | AdminApiError | null;
    if (!response.ok) {
      const error = payload as AdminApiError | null;
      throw new AdminApiRequestError(
        response.status,
        error?.error.code ?? 'ADMIN_REQUEST_FAILED',
        error?.error.message ?? `Administrator request failed (${response.status}).`,
      );
    }
    return payload as T;
  }

  getOverview(): Promise<AdminOverview> {
    return this.request('overview');
  }

  getCommunityRoundSchedule(): Promise<CommunityRoundSchedule> {
    return this.request('community-round-schedule');
  }

  updateCommunityRoundSchedule(values: {
    startsAt: string;
    frequency: string;
  }): Promise<CommunityRoundSchedule> {
    return this.request('community-round-schedule', {
      method: 'PATCH',
      body: JSON.stringify(values),
    });
  }

  getUsers(query: URLSearchParams): Promise<AdminPage<AdminUserSummary>> {
    return this.request(`users?${query.toString()}`);
  }

  updateProfile(
    userId: string,
    values: { displayName: string; avatarUrl: string },
  ): Promise<AdminMutationResult> {
    return this.request(`users/${encodeURIComponent(userId)}/profile`, {
      method: 'PATCH',
      body: JSON.stringify(values),
    });
  }

  setAdmin(userId: string, isAdmin: boolean): Promise<AdminMutationResult> {
    return this.request(`users/${encodeURIComponent(userId)}/admin`, {
      method: 'POST',
      body: JSON.stringify({ isAdmin }),
    });
  }

  setSuspension(
    userId: string,
    suspended: boolean,
    reason: string,
  ): Promise<AdminMutationResult> {
    return this.request(`users/${encodeURIComponent(userId)}/suspension`, {
      method: 'POST',
      body: JSON.stringify({ suspended, reason }),
    });
  }

  getRounds(query: URLSearchParams): Promise<AdminPage<AdminCompletedRoundSummary>> {
    return this.request(`rounds?${query.toString()}`);
  }

  getRound(roundId: string): Promise<AdminCompletedRoundDetail> {
    return this.request(`rounds/${encodeURIComponent(roundId)}`);
  }

  getTutorials(query: URLSearchParams): Promise<AdminTutorialReport> {
    return this.request(`tutorials?${query.toString()}`);
  }
}
