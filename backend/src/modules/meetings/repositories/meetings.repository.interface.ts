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
  guest_email: string | null;
  guest_name: string | null;
  reschedule_of: string | null;
  created_at: string;
  updated_at: string;
  participants?: MeetingParticipant[];
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
}
