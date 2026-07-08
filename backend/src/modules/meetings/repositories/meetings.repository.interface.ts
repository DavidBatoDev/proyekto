import type {
  MeetingStatus,
  MeetingType,
  ParticipantResponse,
  VideoOption,
} from '../dto/meeting.dto';

export interface MeetingParticipant {
  id: string;
  meeting_id?: string;
  user_id: string | null;
  guest_email: string | null;
  guest_name: string | null;
  role: string;
  response: ParticipantResponse | 'pending';
}

export interface Meeting {
  id: string;
  project_id: string | null;
  host_id: string | null;
  created_by: string | null;
  title: string;
  description: string | null;
  type: MeetingType;
  scheduled_at: string;
  ends_at: string | null;
  duration_minutes: number | null;
  status: MeetingStatus;
  video_provider: VideoOption | 'google_meet';
  meeting_url: string | null;
  timezone: string | null;
  location: string | null;
  reminder_minutes: number | null;
  reminder_sent_at: string | null;
  guest_email: string | null;
  guest_name: string | null;
  reschedule_of: string | null;
  series_id: string | null;
  recurrence_id: string | null;
  original_start: string | null;
  is_exception: boolean;
  created_at: string;
  updated_at: string;
  participants?: MeetingParticipant[];
}

// Template for a recurring series; child rows live in `meetings` (series_id).
export interface MeetingSeries {
  id: string;
  project_id: string | null;
  created_by: string | null;
  host_id: string | null;
  title: string;
  description: string | null;
  type: MeetingType;
  duration_minutes: number;
  timezone: string;
  video_provider: VideoOption | 'google_meet';
  meeting_url: string | null;
  location: string | null;
  reminder_minutes: number | null;
  rrule: string;
  dtstart_wall: string;
  dtstart: string;
  until: string | null;
  count: number | null;
  status: string;
  materialized_until: string | null;
  created_at: string;
  updated_at: string;
}

// A participant row destined for a specific instance (bulk series materialization).
export interface NewParticipantRow extends NewParticipant {
  meeting_id: string;
}

export interface MeetingListFilters {
  from?: string;
  to?: string;
  status?: MeetingStatus;
  project_id?: string;
}

export interface NewParticipant {
  user_id: string | null;
  guest_email?: string | null;
  guest_name?: string | null;
  role: string;
  response?: ParticipantResponse | 'pending';
}

export interface MeetingsRepository {
  create(row: Partial<Meeting>): Promise<Meeting>;
  findById(id: string): Promise<Meeting | null>;
  listForUser(userId: string, filters: MeetingListFilters): Promise<Meeting[]>;
  listForProject(
    projectId: string,
    filters: MeetingListFilters,
  ): Promise<Meeting[]>;
  update(id: string, patch: Partial<Meeting>): Promise<Meeting>;
  addParticipants(
    meetingId: string,
    participants: NewParticipant[],
  ): Promise<void>;
  // Remove attendee participants by user id (never the host row).
  removeParticipants(meetingId: string, userIds: string[]): Promise<void>;
  getParticipants(meetingId: string): Promise<MeetingParticipant[]>;
  setParticipantResponse(
    meetingId: string,
    userId: string,
    response: ParticipantResponse,
  ): Promise<MeetingParticipant | null>;
  // Scheduled meetings for a host that overlap [start, end) — double-book guard.
  findOverlappingForHost(
    hostId: string,
    startIso: string,
    endIso: string,
    excludeMeetingId?: string,
  ): Promise<Meeting[]>;
  // Project ids the user participates in (project_access ∪ client/consultant).
  getUserProjectIds(userId: string): Promise<string[]>;

  // ── recurring series ──────────────────────────────────────────────────────
  createSeries(row: Partial<MeetingSeries>): Promise<MeetingSeries>;
  findSeriesById(id: string): Promise<MeetingSeries | null>;
  updateSeries(
    id: string,
    patch: Partial<MeetingSeries>,
  ): Promise<MeetingSeries>;
  // Insert one materialized instance, returning null on a unique-slot / host-slot
  // collision instead of throwing (idempotent, conflict-tolerant materialization).
  insertInstanceIgnoreConflict(row: Partial<Meeting>): Promise<Meeting | null>;
  // Bulk-insert participant rows across many instances in one call.
  insertParticipantRows(rows: NewParticipantRow[]): Promise<void>;
  // Cancel scheduled instances of a series (optionally only those at/after fromIso).
  cancelSeriesInstances(seriesId: string, fromIso?: string): Promise<void>;
  // Delete future non-exception scheduled instances (for re-materialization).
  deleteFutureNonExceptionInstances(
    seriesId: string,
    fromIso: string,
  ): Promise<void>;
  // Apply a patch to future non-exception scheduled instances of a series.
  updateFutureNonExceptionInstances(
    seriesId: string,
    fromIso: string,
    patch: Partial<Meeting>,
  ): Promise<void>;

  // ── reminders ─────────────────────────────────────────────────────────────
  // Upcoming, not-yet-reminded scheduled meetings (with participants) whose
  // scheduled_at falls in (nowIso, maxAheadIso]; the caller narrows to those
  // actually due by reminder_minutes.
  findReminderCandidates(nowIso: string, maxAheadIso: string): Promise<Meeting[]>;
  // Atomically claim reminders: stamp reminder_sent_at for the given ids that are
  // still unsent, returning the ids this call won (race-safe against overlapping
  // cron runs).
  claimReminders(ids: string[], sentAtIso: string): Promise<string[]>;
}
