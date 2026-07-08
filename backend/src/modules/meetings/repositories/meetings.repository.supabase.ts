import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import type {
  Meeting,
  MeetingListFilters,
  MeetingParticipant,
  MeetingSeries,
  MeetingsRepository,
  NewParticipant,
  NewParticipantRow,
} from './meetings.repository.interface';
import type { ParticipantResponse } from '../dto/meeting.dto';

const MEETING_COLUMNS =
  'id, project_id, host_id, created_by, title, description, type, ' +
  'scheduled_at, ends_at, duration_minutes, status, video_provider, ' +
  'meeting_url, timezone, location, reminder_minutes, guest_email, ' +
  'guest_name, reschedule_of, series_id, recurrence_id, original_start, ' +
  'is_exception, created_at, updated_at';

const SERIES_COLUMNS =
  'id, project_id, created_by, host_id, title, description, type, ' +
  'duration_minutes, timezone, video_provider, meeting_url, location, ' +
  'reminder_minutes, rrule, dtstart_wall, dtstart, until, count, status, ' +
  'materialized_until, created_at, updated_at';

// Postgres unique_violation — a materialized instance already occupies the slot.
const UNIQUE_VIOLATION = '23505';

const MEETING_WITH_PARTICIPANTS =
  `${MEETING_COLUMNS}, participants:meeting_participants(` +
  'id, user_id, guest_email, guest_name, role, response)';

@Injectable()
export class SupabaseMeetingsRepository implements MeetingsRepository {
  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
  ) {}

  async create(row: Partial<Meeting>): Promise<Meeting> {
    const { data, error } = await this.supabase
      .from('meetings')
      .insert(row)
      .select(MEETING_COLUMNS)
      .single();
    if (error || !data) {
      throw new Error(error?.message || 'Failed to create meeting.');
    }
    return data as unknown as Meeting;
  }

  async findById(id: string): Promise<Meeting | null> {
    const { data } = await this.supabase
      .from('meetings')
      .select(MEETING_WITH_PARTICIPANTS)
      .eq('id', id)
      .maybeSingle();
    return (data as unknown as Meeting) || null;
  }

  async listForUser(
    userId: string,
    filters: MeetingListFilters,
  ): Promise<Meeting[]> {
    const [projectIds, participantMeetingIds] = await Promise.all([
      this.getUserProjectIds(userId),
      this.getParticipantMeetingIds(userId),
    ]);

    const orParts = [`created_by.eq.${userId}`, `host_id.eq.${userId}`];
    if (projectIds.length) {
      orParts.push(`project_id.in.(${projectIds.join(',')})`);
    }
    if (participantMeetingIds.length) {
      orParts.push(`id.in.(${participantMeetingIds.join(',')})`);
    }

    let query = this.supabase
      .from('meetings')
      .select(MEETING_WITH_PARTICIPANTS)
      .or(orParts.join(','));

    if (filters.from) query = query.gte('scheduled_at', filters.from);
    if (filters.to) query = query.lte('scheduled_at', filters.to);
    if (filters.status) query = query.eq('status', filters.status);

    const { data, error } = await query.order('scheduled_at', {
      ascending: true,
    });
    if (error) throw new Error(error.message);
    return (data as unknown as Meeting[]) || [];
  }

  async listForProject(
    projectId: string,
    filters: MeetingListFilters,
  ): Promise<Meeting[]> {
    let query = this.supabase
      .from('meetings')
      .select(MEETING_WITH_PARTICIPANTS)
      .eq('project_id', projectId);

    if (filters.from) query = query.gte('scheduled_at', filters.from);
    if (filters.to) query = query.lte('scheduled_at', filters.to);
    if (filters.status) query = query.eq('status', filters.status);

    const { data, error } = await query.order('scheduled_at', {
      ascending: true,
    });
    if (error) throw new Error(error.message);
    return (data as unknown as Meeting[]) || [];
  }

  async update(id: string, patch: Partial<Meeting>): Promise<Meeting> {
    const { data, error } = await this.supabase
      .from('meetings')
      .update(patch)
      .eq('id', id)
      .select(MEETING_COLUMNS)
      .single();
    if (error || !data) {
      throw new Error(error?.message || 'Failed to update meeting.');
    }
    return data as unknown as Meeting;
  }

  async addParticipants(
    meetingId: string,
    participants: NewParticipant[],
  ): Promise<void> {
    if (!participants.length) return;
    const rows = participants.map((p) => ({
      meeting_id: meetingId,
      user_id: p.user_id,
      guest_email: p.guest_email ?? null,
      guest_name: p.guest_name ?? null,
      role: p.role,
      response: p.response ?? 'pending',
    }));
    // Plain insert: participants are only ever added to a freshly created
    // meeting (create + reschedule-copy), so there are no rows to conflict with.
    // The (meeting_id, user_id) uniqueness index is a partial one, which does
    // not support ON CONFLICT inference cleanly.
    const { error } = await this.supabase
      .from('meeting_participants')
      .insert(rows);
    if (error) throw new Error(error.message);
  }

  async removeParticipants(
    meetingId: string,
    userIds: string[],
  ): Promise<void> {
    if (!userIds.length) return;
    const { error } = await this.supabase
      .from('meeting_participants')
      .delete()
      .eq('meeting_id', meetingId)
      .in('user_id', userIds)
      .neq('role', 'host');
    if (error) throw new Error(error.message);
  }

  async getParticipants(meetingId: string): Promise<MeetingParticipant[]> {
    const { data, error } = await this.supabase
      .from('meeting_participants')
      .select('id, meeting_id, user_id, guest_email, guest_name, role, response')
      .eq('meeting_id', meetingId);
    if (error) throw new Error(error.message);
    return (data as unknown as MeetingParticipant[]) || [];
  }

  async setParticipantResponse(
    meetingId: string,
    userId: string,
    response: ParticipantResponse,
  ): Promise<MeetingParticipant | null> {
    const { data, error } = await this.supabase
      .from('meeting_participants')
      .update({ response })
      .eq('meeting_id', meetingId)
      .eq('user_id', userId)
      .select('id, meeting_id, user_id, guest_email, guest_name, role, response')
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as unknown as MeetingParticipant) || null;
  }

  async findOverlappingForHost(
    hostId: string,
    startIso: string,
    endIso: string,
    excludeMeetingId?: string,
  ): Promise<Meeting[]> {
    // Overlap when an existing scheduled meeting starts before our end AND
    // ends after our start. Rows with a null ends_at are matched on start only.
    let query = this.supabase
      .from('meetings')
      .select(MEETING_COLUMNS)
      .eq('host_id', hostId)
      .eq('status', 'scheduled')
      .lt('scheduled_at', endIso)
      .or(`ends_at.gt.${startIso},ends_at.is.null`);
    if (excludeMeetingId) {
      query = query.neq('id', excludeMeetingId);
    }
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return (data as unknown as Meeting[]) || [];
  }

  async getUserProjectIds(userId: string): Promise<string[]> {
    const [accessRes, projectsRes] = await Promise.all([
      this.supabase
        .from('project_access')
        .select('project_id')
        .eq('user_id', userId),
      this.supabase
        .from('projects')
        .select('id')
        .or(`client_id.eq.${userId},consultant_id.eq.${userId}`),
    ]);
    const ids = new Set<string>();
    for (const row of accessRes.data || []) {
      if (row.project_id) ids.add(row.project_id as string);
    }
    for (const row of projectsRes.data || []) {
      if (row.id) ids.add(row.id as string);
    }
    return [...ids];
  }

  // ── recurring series ──────────────────────────────────────────────────────

  async createSeries(row: Partial<MeetingSeries>): Promise<MeetingSeries> {
    const { data, error } = await this.supabase
      .from('meeting_series')
      .insert(row)
      .select(SERIES_COLUMNS)
      .single();
    if (error || !data) {
      throw new Error(error?.message || 'Failed to create meeting series.');
    }
    return data as unknown as MeetingSeries;
  }

  async findSeriesById(id: string): Promise<MeetingSeries | null> {
    const { data } = await this.supabase
      .from('meeting_series')
      .select(SERIES_COLUMNS)
      .eq('id', id)
      .maybeSingle();
    return (data as unknown as MeetingSeries) || null;
  }

  async updateSeries(
    id: string,
    patch: Partial<MeetingSeries>,
  ): Promise<MeetingSeries> {
    const { data, error } = await this.supabase
      .from('meeting_series')
      .update(patch)
      .eq('id', id)
      .select(SERIES_COLUMNS)
      .single();
    if (error || !data) {
      throw new Error(error?.message || 'Failed to update meeting series.');
    }
    return data as unknown as MeetingSeries;
  }

  async insertInstanceIgnoreConflict(
    row: Partial<Meeting>,
  ): Promise<Meeting | null> {
    const { data, error } = await this.supabase
      .from('meetings')
      .insert(row)
      .select(MEETING_COLUMNS)
      .single();
    if (error) {
      if (error.code === UNIQUE_VIOLATION) return null;
      throw new Error(error.message);
    }
    return (data as unknown as Meeting) || null;
  }

  async insertParticipantRows(rows: NewParticipantRow[]): Promise<void> {
    if (!rows.length) return;
    const payload = rows.map((p) => ({
      meeting_id: p.meeting_id,
      user_id: p.user_id,
      guest_email: p.guest_email ?? null,
      guest_name: p.guest_name ?? null,
      role: p.role,
      response: p.response ?? 'pending',
    }));
    const { error } = await this.supabase
      .from('meeting_participants')
      .insert(payload);
    if (error) throw new Error(error.message);
  }

  async cancelSeriesInstances(
    seriesId: string,
    fromIso?: string,
  ): Promise<void> {
    let query = this.supabase
      .from('meetings')
      .update({ status: 'cancelled' })
      .eq('series_id', seriesId)
      .eq('status', 'scheduled');
    if (fromIso) query = query.gte('scheduled_at', fromIso);
    const { error } = await query;
    if (error) throw new Error(error.message);
  }

  async deleteFutureNonExceptionInstances(
    seriesId: string,
    fromIso: string,
  ): Promise<void> {
    const { error } = await this.supabase
      .from('meetings')
      .delete()
      .eq('series_id', seriesId)
      .eq('is_exception', false)
      .eq('status', 'scheduled')
      .gte('scheduled_at', fromIso);
    if (error) throw new Error(error.message);
  }

  async updateFutureNonExceptionInstances(
    seriesId: string,
    fromIso: string,
    patch: Partial<Meeting>,
  ): Promise<void> {
    const { error } = await this.supabase
      .from('meetings')
      .update(patch)
      .eq('series_id', seriesId)
      .eq('is_exception', false)
      .eq('status', 'scheduled')
      .gte('scheduled_at', fromIso);
    if (error) throw new Error(error.message);
  }

  private async getParticipantMeetingIds(userId: string): Promise<string[]> {
    const { data } = await this.supabase
      .from('meeting_participants')
      .select('meeting_id')
      .eq('user_id', userId);
    return (data || [])
      .map((row) => row.meeting_id as string)
      .filter(Boolean);
  }
}
