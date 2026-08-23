export const ADMIN_DEFAULT_PAGE_SIZE = 25;
export const ADMIN_MAX_PAGE_SIZE = 100;

export const COMMUNITY_ROUND_TIME_ZONE = 'Europe/Vilnius';
export type CommunityRoundFrequency = 'daily' | 'weekly' | 'monthly';

export interface CommunityRoundSchedule {
  startsAt: string;
  frequency: CommunityRoundFrequency;
  timeZone: string;
  updatedAt: string | null;
}

export const DEFAULT_COMMUNITY_ROUND_SCHEDULE: CommunityRoundSchedule = {
  startsAt: '2026-01-01T19:00:00.000Z',
  frequency: 'daily',
  timeZone: COMMUNITY_ROUND_TIME_ZONE,
  updatedAt: null,
};

export type AdminRoomPhase = 'waiting' | 'countdown' | 'loading' | 'running' | 'ended';

export interface AdminRoomPlayer {
  playerId: string;
  profileId: string | null;
  displayName: string;
  isGuest: boolean;
  isAdmin: boolean;
  connected: boolean;
  role: 'survivor' | 'warden' | null;
  escaped: boolean;
  abandoned: boolean;
}

export interface AdminRoomSnapshot {
  roomId: string;
  isPublic: boolean;
  phase: AdminRoomPhase;
  createdAt: string;
  startedAt: string | null;
  matchId: string | null;
  remainingMs: number;
  rated: boolean;
  playerCount: number;
  connectedCount: number;
  authenticatedCount: number;
  guestCount: number;
  players: AdminRoomPlayer[];
}

export interface AdminOverview {
  generatedAt: string;
  registeredUsers: number;
  suspendedUsers: number;
  activeRooms: number;
  runningRounds: number;
  connectedRegisteredPlayers: number;
  connectedGuests: number;
  completedRounds: number;
  ratedRounds: number;
  rooms: AdminRoomSnapshot[];
}

export interface AdminUserSummary {
  id: string;
  email: string | null;
  displayName: string;
  avatarUrl: string | null;
  isAdmin: boolean;
  suspendedAt: string | null;
  authBannedUntil: string | null;
  displayNameChosen: boolean;
  createdAt: string;
  updatedAt: string;
  lastSignInAt: string | null;
  rating: number;
  matchesPlayed: number;
  ratedMatches: number;
  wins: number;
  losses: number;
  currentRoomId: string | null;
}

export interface AdminCompletedRoundSummary {
  id: string;
  roomId: string;
  winner: 'survivors' | 'wardens';
  playerCount: number;
  authenticatedPlayerCount: number;
  rated: boolean;
  startedAt: string;
  endedAt: string;
  createdAt: string;
}

export interface AdminRoundParticipant {
  profileId: string | null;
  isGuest: boolean;
  displayName: string;
  role: 'survivor' | 'warden';
  outcome: 'win' | 'loss';
  escaped: boolean;
  abandoned: boolean;
  ratingBefore: number | null;
  ratingDelta: number | null;
  ratingAfter: number | null;
}

export interface AdminCompletedRoundDetail extends AdminCompletedRoundSummary {
  participants: AdminRoundParticipant[];
}

export type TutorialSource = 'main_menu' | 'first_time_queue';
export type TutorialStatus = 'in_progress' | 'completed' | 'left';
export type TutorialDepartureReason =
  | 'explicit_exit'
  | 'page_unload'
  | 'inactivity_timeout';
export type TutorialReminderProvider = 'discord' | 'google_calendar';

export interface AdminTutorialAttempt {
  id: string;
  profileId: string | null;
  participantId: string;
  displayName: string;
  isGuest: boolean;
  source: TutorialSource;
  status: TutorialStatus;
  departureReason: TutorialDepartureReason | null;
  startedAt: string;
  lastActivityAt: string;
  endedAt: string | null;
  durationMs: number;
  reminderOpenedAt: string | null;
  discordReminderClickedAt: string | null;
  googleCalendarClickedAt: string | null;
}

export interface AdminTutorialStatistics {
  attempts: number;
  uniquePeople: number;
  inProgress: number;
  completed: number;
  left: number;
  completionRate: number;
  averageDurationMs: number;
  reminderOpened: number;
  discordReminderClicked: number;
  googleCalendarClicked: number;
}

export interface AdminTutorialReport {
  generatedAt: string;
  statistics: AdminTutorialStatistics;
  attempts: AdminPage<AdminTutorialAttempt>;
}

export type AdminAuditAction =
  | 'profile_update'
  | 'admin_grant'
  | 'admin_revoke'
  | 'suspend'
  | 'reactivate';

export interface AdminAuditEntry {
  id: number;
  actorId: string;
  actorDisplayName: string;
  targetId: string;
  targetDisplayName: string;
  action: AdminAuditAction;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  reason: string | null;
  createdAt: string;
}

export interface AdminPage<T> {
  items: T[];
  page: number;
  perPage: number;
  total: number;
}

export interface AdminMutationResult {
  user: AdminUserSummary;
  warning?: string;
}

export interface AdminApiError {
  error: {
    code: string;
    message: string;
  };
}
