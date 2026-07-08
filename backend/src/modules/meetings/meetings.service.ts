import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationsService } from '../notifications/notifications.service';
import { ProjectAuthorizationService } from '../projects/authorization/project-authorization.service';
import {
  CreateMeetingDto,
  ListMeetingsQueryDto,
  MeetingEditScope,
  RescheduleMeetingDto,
  RespondMeetingDto,
  UpdateMeetingDto,
  VideoOption,
} from './dto/meeting.dto';
import type {
  Meeting,
  MeetingSeries,
  MeetingsRepository,
  NewParticipant,
  NewParticipantRow,
} from './repositories/meetings.repository.interface';
import {
  expandOccurrences,
  parseUntilCount,
  wallFromUtc,
} from './recurrence';

export const MEETINGS_REPOSITORY = Symbol('MEETINGS_REPOSITORY');

const DEFAULT_DURATION_MINUTES = 30;

// Upper bound for the reminder-scan fetch — matches the max reminder offset
// (4 weeks). No meeting further out can be due for a reminder yet.
const REMINDER_SCAN_AHEAD_MS = 40320 * 60_000;

@Injectable()
export class MeetingsService {
  constructor(
    @Inject(MEETINGS_REPOSITORY)
    private readonly repo: MeetingsRepository,
    private readonly authorization: ProjectAuthorizationService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
  ) {}

  async create(userId: string, dto: CreateMeetingDto): Promise<Meeting> {
    if (dto.recurrence) {
      return this.createSeries(userId, dto);
    }
    const startMs = Date.parse(dto.scheduled_at);
    if (Number.isNaN(startMs)) {
      throw new BadRequestException('Invalid scheduled_at timestamp.');
    }
    const durationMinutes = dto.duration_minutes ?? DEFAULT_DURATION_MINUTES;
    const scheduledAt = new Date(startMs).toISOString();
    const endsAt = new Date(startMs + durationMinutes * 60_000).toISOString();

    // Authorization: a project meeting requires the caller to belong to it.
    if (dto.project_id) {
      await this.authorization.assertRole(userId, dto.project_id, 'viewer');
    }

    const hostId = userId;
    const { videoProvider, meetingUrl } = this.resolveVideo(dto);

    await this.assertHostFree(hostId, scheduledAt, endsAt);

    const meeting = await this.repo.create({
      project_id: dto.project_id ?? null,
      host_id: hostId,
      created_by: userId,
      title: dto.title,
      description: dto.description ?? null,
      type: dto.type,
      scheduled_at: scheduledAt,
      ends_at: endsAt,
      duration_minutes: durationMinutes,
      status: 'scheduled',
      video_provider: videoProvider,
      meeting_url: meetingUrl,
      timezone: dto.timezone ?? null,
      location: dto.location ?? null,
      reminder_minutes: dto.reminder_minutes ?? null,
    });

    const inviteeIds = this.uniqueInvitees(dto.participant_ids, userId);
    const guestEmails = this.uniqueGuestEmails(dto.guest_emails);
    const participants: NewParticipant[] = [
      { user_id: userId, role: 'host', response: 'accepted' },
      ...inviteeIds.map((id) => ({
        user_id: id,
        role: 'attendee',
        response: 'pending' as const,
      })),
      ...guestEmails.map((email) => ({
        user_id: null,
        guest_email: email,
        role: 'attendee',
        response: 'pending' as const,
      })),
    ];
    await this.repo.addParticipants(meeting.id, participants);

    await this.notifyMany(inviteeIds, {
      user_id: '',
      type_name: 'meeting_invited',
      actor_id: userId,
      project_id: meeting.project_id ?? undefined,
      content: this.meetingContent(meeting),
      link_url: this.linkFor(meeting),
    });

    return (await this.repo.findById(meeting.id)) ?? meeting;
  }

  // ── recurring series ────────────────────────────────────────────────────────

  /** Create a recurring series + materialize its instances within the horizon. */
  private async createSeries(
    userId: string,
    dto: CreateMeetingDto,
  ): Promise<Meeting> {
    const startMs = Date.parse(dto.scheduled_at);
    if (Number.isNaN(startMs)) {
      throw new BadRequestException('Invalid scheduled_at timestamp.');
    }
    if (dto.project_id) {
      await this.authorization.assertRole(userId, dto.project_id, 'viewer');
    }
    const durationMinutes = dto.duration_minutes ?? DEFAULT_DURATION_MINUTES;
    const timezone = dto.timezone ?? 'UTC';
    const dtstart = new Date(startMs).toISOString();
    const dtstartWall = wallFromUtc(dtstart, timezone);
    const rrule = dto.recurrence as string;
    const { videoProvider, meetingUrl } = this.resolveVideo(dto);
    const { until, count } = parseUntilCount(rrule);

    const series = await this.repo.createSeries({
      project_id: dto.project_id ?? null,
      created_by: userId,
      host_id: userId,
      title: dto.title,
      description: dto.description ?? null,
      type: dto.type,
      duration_minutes: durationMinutes,
      timezone,
      video_provider: videoProvider,
      meeting_url: meetingUrl,
      location: dto.location ?? null,
      reminder_minutes: dto.reminder_minutes ?? null,
      rrule,
      dtstart_wall: dtstartWall,
      dtstart,
      until,
      count,
      status: 'active',
    });

    const inviteeIds = this.uniqueInvitees(dto.participant_ids, userId);
    const guestEmails = this.uniqueGuestEmails(dto.guest_emails);
    const first = await this.materializeSeries(series, {
      inviteeIds,
      guestEmails,
      fromWall: dtstartWall,
    });
    if (!first) {
      throw new ConflictException(
        'None of the recurring occurrences could be scheduled — the time slots are taken.',
      );
    }

    await this.notifyMany(inviteeIds, {
      user_id: '',
      type_name: 'meeting_invited',
      actor_id: userId,
      project_id: series.project_id ?? undefined,
      content: this.meetingContent(first),
      link_url: this.linkFor(first),
    });

    return first;
  }

  /**
   * Expand a series and insert its instances (+ participants) with per-slot
   * conflict tolerance, returning the earliest created instance. Occurrences are
   * clamped to the series `until` so a truncated series never over-materializes.
   */
  private async materializeSeries(
    series: MeetingSeries,
    opts: { inviteeIds: string[]; guestEmails: string[]; fromWall?: string },
  ): Promise<Meeting | null> {
    let occurrences = expandOccurrences(
      series.rrule,
      series.dtstart_wall,
      series.timezone,
      { fromWall: opts.fromWall },
    );
    if (series.until) {
      const untilMs = Date.parse(series.until);
      occurrences = occurrences.filter(
        (o) => Date.parse(o.scheduledAt) <= untilMs,
      );
    }
    if (!occurrences.length) return null;

    const participantRows: NewParticipantRow[] = [];
    let earliest: Meeting | null = null;

    for (const occ of occurrences) {
      const endsAt = new Date(
        Date.parse(occ.scheduledAt) + series.duration_minutes * 60_000,
      ).toISOString();
      const instance = await this.repo.insertInstanceIgnoreConflict({
        project_id: series.project_id,
        host_id: series.host_id,
        created_by: series.created_by,
        title: series.title,
        description: series.description,
        type: series.type,
        scheduled_at: occ.scheduledAt,
        ends_at: endsAt,
        duration_minutes: series.duration_minutes,
        status: 'scheduled',
        video_provider: series.video_provider,
        meeting_url: series.meeting_url,
        timezone: series.timezone,
        location: series.location,
        reminder_minutes: series.reminder_minutes,
        series_id: series.id,
        recurrence_id: occ.recurrenceId,
        is_exception: false,
      });
      if (!instance) continue; // slot already taken — skip

      if (!earliest) earliest = instance;
      participantRows.push({
        meeting_id: instance.id,
        user_id: series.host_id,
        role: 'host',
        response: 'accepted',
      });
      for (const uid of opts.inviteeIds) {
        participantRows.push({
          meeting_id: instance.id,
          user_id: uid,
          role: 'attendee',
          response: 'pending',
        });
      }
      for (const email of opts.guestEmails) {
        participantRows.push({
          meeting_id: instance.id,
          user_id: null,
          guest_email: email,
          role: 'attendee',
          response: 'pending',
        });
      }
    }

    await this.repo.insertParticipantRows(participantRows);
    await this.repo.updateSeries(series.id, {
      materialized_until: occurrences[occurrences.length - 1].scheduledAt,
    });
    return earliest;
  }

  /** Edit the whole series: update the template + re-materialize future instances. */
  private async updateSeriesAll(
    userId: string,
    meeting: Meeting,
    dto: UpdateMeetingDto,
  ): Promise<Meeting> {
    const seriesId = meeting.series_id as string;
    const series = await this.repo.findSeriesById(seriesId);
    if (!series) throw new NotFoundException('Meeting series not found.');

    const timezone = dto.timezone ?? series.timezone;
    const dtstart = dto.scheduled_at ?? series.dtstart;
    const rrule = dto.recurrence ?? series.rrule;
    const { until, count } = parseUntilCount(rrule);
    const video = this.resolveSeriesVideo(series, dto);

    const updated = await this.repo.updateSeries(series.id, {
      title: dto.title ?? series.title,
      description:
        dto.description !== undefined
          ? (dto.description ?? null)
          : series.description,
      type: dto.type ?? series.type,
      duration_minutes: dto.duration_minutes ?? series.duration_minutes,
      timezone,
      location:
        dto.location !== undefined ? (dto.location ?? null) : series.location,
      reminder_minutes:
        dto.reminder_minutes !== undefined
          ? (dto.reminder_minutes ?? null)
          : series.reminder_minutes,
      video_provider: video.videoProvider,
      meeting_url: video.meetingUrl,
      rrule,
      dtstart,
      dtstart_wall: wallFromUtc(dtstart, timezone),
      until,
      count,
    });

    // Re-materialize from now — never disturb past occurrences or overrides.
    const cutoffIso = new Date(
      Math.max(Date.now(), Date.parse(updated.dtstart)),
    ).toISOString();
    await this.repo.deleteFutureNonExceptionInstances(series.id, cutoffIso);
    const first = await this.materializeSeries(updated, {
      inviteeIds: this.seriesInviteeIds(meeting, dto),
      guestEmails: this.seriesGuestEmails(meeting, dto),
      fromWall: wallFromUtc(cutoffIso, timezone),
    });

    await this.notifySeriesChange(userId, meeting, updated.title);
    return first ?? (await this.repo.findById(meeting.id)) ?? meeting;
  }

  /** Edit this-and-following: truncate the old series and start a new one. */
  private async updateSeriesFollowing(
    userId: string,
    meeting: Meeting,
    dto: UpdateMeetingDto,
  ): Promise<Meeting> {
    const oldSeries = await this.repo.findSeriesById(meeting.series_id as string);
    if (!oldSeries) throw new NotFoundException('Meeting series not found.');
    const splitIso = meeting.scheduled_at;

    // Truncate the old series at the split.
    await this.repo.deleteFutureNonExceptionInstances(oldSeries.id, splitIso);
    await this.repo.updateSeries(oldSeries.id, {
      until: splitIso,
      materialized_until: splitIso,
    });

    // Start a new series from the split occurrence with the edited template.
    const timezone = dto.timezone ?? oldSeries.timezone;
    const dtstart = dto.scheduled_at ?? splitIso;
    const rrule = dto.recurrence ?? oldSeries.rrule;
    const { until, count } = parseUntilCount(rrule);
    const video = this.resolveSeriesVideo(oldSeries, dto);

    const newSeries = await this.repo.createSeries({
      project_id: oldSeries.project_id,
      created_by: userId,
      host_id: oldSeries.host_id,
      title: dto.title ?? oldSeries.title,
      description:
        dto.description !== undefined
          ? (dto.description ?? null)
          : oldSeries.description,
      type: dto.type ?? oldSeries.type,
      duration_minutes: dto.duration_minutes ?? oldSeries.duration_minutes,
      timezone,
      video_provider: video.videoProvider,
      meeting_url: video.meetingUrl,
      location:
        dto.location !== undefined
          ? (dto.location ?? null)
          : oldSeries.location,
      reminder_minutes:
        dto.reminder_minutes !== undefined
          ? (dto.reminder_minutes ?? null)
          : oldSeries.reminder_minutes,
      rrule,
      dtstart_wall: wallFromUtc(dtstart, timezone),
      dtstart,
      until,
      count,
      status: 'active',
    });

    const first = await this.materializeSeries(newSeries, {
      inviteeIds: this.seriesInviteeIds(meeting, dto),
      guestEmails: this.seriesGuestEmails(meeting, dto),
      fromWall: wallFromUtc(dtstart, timezone),
    });

    await this.notifySeriesChange(userId, meeting, newSeries.title);
    return first ?? meeting;
  }

  private resolveSeriesVideo(
    series: MeetingSeries,
    dto: UpdateMeetingDto,
  ): { videoProvider: VideoOption; meetingUrl: string | null } {
    if (dto.video_option === undefined) {
      return {
        videoProvider: series.video_provider as VideoOption,
        meetingUrl: series.meeting_url,
      };
    }
    const keepJitsi =
      dto.video_option === 'jitsi' &&
      series.video_provider === 'jitsi' &&
      !!series.meeting_url;
    if (keepJitsi) {
      return { videoProvider: 'jitsi', meetingUrl: series.meeting_url };
    }
    return this.resolveVideo({
      video_option: dto.video_option,
      meeting_url: dto.meeting_url,
    });
  }

  private seriesInviteeIds(meeting: Meeting, dto: UpdateMeetingDto): string[] {
    if (dto.participant_ids !== undefined) {
      return this.uniqueInvitees(
        dto.participant_ids,
        meeting.host_id ?? meeting.created_by ?? '',
      );
    }
    return (meeting.participants ?? [])
      .filter((p) => p.user_id && p.role !== 'host')
      .map((p) => p.user_id as string);
  }

  private seriesGuestEmails(meeting: Meeting, dto: UpdateMeetingDto): string[] {
    if (dto.guest_emails !== undefined) {
      return this.uniqueGuestEmails(dto.guest_emails);
    }
    return (meeting.participants ?? [])
      .filter((p) => !p.user_id && p.guest_email)
      .map((p) => p.guest_email as string);
  }

  private async notifySeriesChange(
    userId: string,
    meeting: Meeting,
    newTitle: string,
  ): Promise<void> {
    const notifyIds = (meeting.participants ?? [])
      .map((p) => p.user_id)
      .filter((uid): uid is string => !!uid && uid !== userId);
    await this.notifyMany(notifyIds, {
      user_id: '',
      type_name: 'meeting_rescheduled',
      actor_id: userId,
      project_id: meeting.project_id ?? undefined,
      content: this.meetingContent({ ...meeting, title: newTitle }),
      link_url: this.linkFor(meeting),
    });
  }

  async getById(userId: string, id: string): Promise<Meeting> {
    const meeting = await this.repo.findById(id);
    if (!meeting) throw new NotFoundException('Meeting not found.');
    await this.assertCanView(userId, meeting);
    return meeting;
  }

  async list(userId: string, query: ListMeetingsQueryDto): Promise<Meeting[]> {
    return this.repo.listForUser(userId, query);
  }

  async listForProject(
    userId: string,
    projectId: string,
    query: ListMeetingsQueryDto,
  ): Promise<Meeting[]> {
    await this.authorization.assertRole(userId, projectId, 'viewer');
    return this.repo.listForProject(projectId, query);
  }

  async reschedule(
    userId: string,
    id: string,
    dto: RescheduleMeetingDto,
  ): Promise<Meeting> {
    const old = await this.repo.findById(id);
    if (!old) throw new NotFoundException('Meeting not found.');
    if (old.created_by !== userId && old.host_id !== userId) {
      throw new ForbiddenException(
        'Only the organizer or host can reschedule this meeting.',
      );
    }
    if (old.status !== 'scheduled') {
      throw new BadRequestException(
        `Cannot reschedule a ${old.status} meeting.`,
      );
    }

    const startMs = Date.parse(dto.scheduled_at);
    if (Number.isNaN(startMs)) {
      throw new BadRequestException('Invalid scheduled_at timestamp.');
    }
    const durationMinutes =
      dto.duration_minutes ?? old.duration_minutes ?? DEFAULT_DURATION_MINUTES;
    const scheduledAt = new Date(startMs).toISOString();
    const endsAt = new Date(startMs + durationMinutes * 60_000).toISOString();

    if (old.host_id) {
      await this.assertHostFree(old.host_id, scheduledAt, endsAt, old.id);
    }

    // Retire the old row FIRST so the new row can occupy the same time slot if
    // needed — the (host_id, scheduled_at) partial unique index only counts
    // status='scheduled' rows, so a same-time reschedule would otherwise
    // collide with the still-scheduled original.
    const participants =
      old.participants ?? (await this.repo.getParticipants(old.id));
    await this.repo.update(old.id, { status: 'rescheduled' });

    // The new row preserves the audit chain via reschedule_of; the video link
    // carries over unchanged.
    const created = await this.repo.create({
      project_id: old.project_id,
      host_id: old.host_id,
      created_by: old.created_by,
      title: old.title,
      description: old.description,
      type: old.type,
      scheduled_at: scheduledAt,
      ends_at: endsAt,
      duration_minutes: durationMinutes,
      status: 'scheduled',
      video_provider: old.video_provider,
      meeting_url: old.meeting_url,
      timezone: dto.timezone ?? old.timezone,
      reschedule_of: old.id,
    });

    await this.repo.addParticipants(
      created.id,
      participants.map((p) => ({
        user_id: p.user_id,
        guest_email: p.guest_email,
        guest_name: p.guest_name,
        role: p.role,
        response: p.role === 'host' ? 'accepted' : 'pending',
      })),
    );

    const notifyIds = participants
      .map((p) => p.user_id)
      .filter((uid): uid is string => !!uid && uid !== userId);
    await this.notifyMany(notifyIds, {
      user_id: '',
      type_name: 'meeting_rescheduled',
      actor_id: userId,
      project_id: created.project_id ?? undefined,
      content: {
        ...this.meetingContent(created),
        previous_meeting_id: old.id,
      },
      link_url: this.linkFor(created),
    });

    return (await this.repo.findById(created.id)) ?? created;
  }

  async cancel(
    userId: string,
    id: string,
    scope?: MeetingEditScope,
  ): Promise<Meeting> {
    const meeting = await this.repo.findById(id);
    if (!meeting) throw new NotFoundException('Meeting not found.');

    const canManage =
      meeting.created_by === userId ||
      meeting.host_id === userId ||
      (await this.hasProjectAdmin(userId, meeting.project_id));
    if (!canManage) {
      throw new ForbiddenException(
        'Only the organizer, host, or a project admin can cancel this meeting.',
      );
    }
    if (meeting.status === 'cancelled') return meeting;

    // Series-wide cancellation. 'all' retires the template + every scheduled
    // instance; 'following' cancels this occurrence onward and truncates the
    // series so it won't re-materialize past the split.
    if (meeting.series_id && scope && scope !== 'this') {
      if (scope === 'all') {
        await this.repo.updateSeries(meeting.series_id, { status: 'cancelled' });
        await this.repo.cancelSeriesInstances(meeting.series_id);
      } else {
        await this.repo.cancelSeriesInstances(
          meeting.series_id,
          meeting.scheduled_at,
        );
        await this.repo.updateSeries(meeting.series_id, {
          until: meeting.scheduled_at,
          materialized_until: meeting.scheduled_at,
        });
      }
    } else {
      await this.repo.update(id, { status: 'cancelled' });
    }

    const notifyIds = (meeting.participants ?? [])
      .map((p) => p.user_id)
      .filter((uid): uid is string => !!uid && uid !== userId);
    await this.notifyMany(notifyIds, {
      user_id: '',
      type_name: 'meeting_cancelled',
      actor_id: userId,
      project_id: meeting.project_id ?? undefined,
      content: this.meetingContent(meeting),
      link_url: this.linkFor(meeting),
    });

    return (await this.repo.findById(id)) ?? meeting;
  }

  async respond(userId: string, id: string, dto: RespondMeetingDto) {
    const meeting = await this.repo.findById(id);
    if (!meeting) throw new NotFoundException('Meeting not found.');

    const participant = (meeting.participants ?? []).find(
      (p) => p.user_id === userId,
    );
    if (!participant) {
      throw new ForbiddenException('You are not a participant of this meeting.');
    }

    const updated = await this.repo.setParticipantResponse(
      id,
      userId,
      dto.response,
    );

    const notifyId = meeting.host_id ?? meeting.created_by;
    if (notifyId && notifyId !== userId) {
      await this.notifyMany([notifyId], {
        user_id: '',
        type_name: 'meeting_response',
        actor_id: userId,
        project_id: meeting.project_id ?? undefined,
        content: { ...this.meetingContent(meeting), response: dto.response },
        link_url: this.linkFor(meeting),
      });
    }

    return updated;
  }

  /**
   * General field edit (title/type/time/guests/location/reminder/video). Only
   * the organizer, host, or a project admin may edit, and only while the meeting
   * is still scheduled. Time changes recompute ends_at and re-check the host's
   * availability. The `scope` on the DTO is reserved for recurring series.
   */
  async updateDetails(
    userId: string,
    id: string,
    dto: UpdateMeetingDto,
  ): Promise<Meeting> {
    const meeting = await this.repo.findById(id);
    if (!meeting) throw new NotFoundException('Meeting not found.');

    const canManage =
      meeting.created_by === userId ||
      meeting.host_id === userId ||
      (await this.hasProjectAdmin(userId, meeting.project_id));
    if (!canManage) {
      throw new ForbiddenException(
        'Only the organizer, host, or a project admin can edit this meeting.',
      );
    }
    if (meeting.status !== 'scheduled') {
      throw new BadRequestException(`Cannot edit a ${meeting.status} meeting.`);
    }

    // Series-wide / this-and-following edits fan out to the template.
    if (meeting.series_id && dto.scope === 'all') {
      return this.updateSeriesAll(userId, meeting, dto);
    }
    if (meeting.series_id && dto.scope === 'following') {
      return this.updateSeriesFollowing(userId, meeting, dto);
    }

    const patch: Partial<Meeting> = {};
    if (dto.title !== undefined) patch.title = dto.title;
    if (dto.description !== undefined) patch.description = dto.description ?? null;
    if (dto.type !== undefined) patch.type = dto.type;
    if (dto.timezone !== undefined) patch.timezone = dto.timezone ?? null;
    if (dto.location !== undefined) patch.location = dto.location ?? null;
    if (dto.reminder_minutes !== undefined) {
      patch.reminder_minutes = dto.reminder_minutes ?? null;
    }

    // A time or duration change recomputes ends_at and re-checks host availability.
    let timeChanged = false;
    if (dto.scheduled_at !== undefined || dto.duration_minutes !== undefined) {
      const startMs =
        dto.scheduled_at !== undefined
          ? Date.parse(dto.scheduled_at)
          : Date.parse(meeting.scheduled_at);
      if (Number.isNaN(startMs)) {
        throw new BadRequestException('Invalid scheduled_at timestamp.');
      }
      const durationMinutes =
        dto.duration_minutes ??
        meeting.duration_minutes ??
        DEFAULT_DURATION_MINUTES;
      const scheduledAt = new Date(startMs).toISOString();
      const endsAt = new Date(startMs + durationMinutes * 60_000).toISOString();
      if (meeting.host_id) {
        await this.assertHostFree(
          meeting.host_id,
          scheduledAt,
          endsAt,
          meeting.id,
        );
      }
      patch.scheduled_at = scheduledAt;
      patch.ends_at = endsAt;
      patch.duration_minutes = durationMinutes;
      timeChanged = true;
    }

    // Video option change. Keep an existing Jitsi room when the provider is
    // unchanged; otherwise resolve fresh (a new Jitsi room / pasted link).
    if (dto.video_option !== undefined) {
      const keepJitsi =
        dto.video_option === 'jitsi' &&
        meeting.video_provider === 'jitsi' &&
        !!meeting.meeting_url;
      if (!keepJitsi) {
        const { videoProvider, meetingUrl } = this.resolveVideo({
          video_option: dto.video_option,
          meeting_url: dto.meeting_url,
        });
        patch.video_provider = videoProvider;
        patch.meeting_url = meetingUrl;
      }
    } else if (
      dto.meeting_url !== undefined &&
      meeting.video_provider === 'external_link'
    ) {
      patch.meeting_url = dto.meeting_url;
    }

    // Editing a single occurrence of a series detaches it as an override so a
    // later series-wide re-materialization won't clobber it.
    if (meeting.series_id) {
      patch.is_exception = true;
      if (timeChanged && meeting.recurrence_id && !meeting.original_start) {
        patch.original_start = meeting.recurrence_id;
      }
    }

    if (Object.keys(patch).length) {
      await this.repo.update(id, patch);
    }

    await this.syncParticipants(meeting, dto, userId);

    const updated = (await this.repo.findById(id)) ?? meeting;

    if (timeChanged) {
      const notifyIds = (meeting.participants ?? [])
        .map((p) => p.user_id)
        .filter((uid): uid is string => !!uid && uid !== userId);
      await this.notifyMany(notifyIds, {
        user_id: '',
        type_name: 'meeting_rescheduled',
        actor_id: userId,
        project_id: updated.project_id ?? undefined,
        content: this.meetingContent(updated),
        link_url: this.linkFor(updated),
      });
    }

    return updated;
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private resolveVideo(input: {
    video_option?: VideoOption;
    meeting_url?: string;
  }): {
    videoProvider: VideoOption;
    meetingUrl: string | null;
  } {
    const option: VideoOption =
      input.video_option ?? (input.meeting_url ? 'external_link' : 'jitsi');

    if (option === 'external_link') {
      if (!input.meeting_url) {
        throw new BadRequestException(
          'A meeting link is required when using an external video link.',
        );
      }
      return { videoProvider: 'external_link', meetingUrl: input.meeting_url };
    }
    if (option === 'none') {
      return { videoProvider: 'none', meetingUrl: null };
    }
    return { videoProvider: 'jitsi', meetingUrl: this.generateJitsiRoom() };
  }

  private generateJitsiRoom(): string {
    const base = this.config
      .get<string>('JITSI_BASE_URL', 'https://meet.jit.si')
      .replace(/\/+$/, '');
    return `${base}/proyekto-${randomUUID()}`;
  }

  private async assertHostFree(
    hostId: string,
    startIso: string,
    endIso: string,
    excludeMeetingId?: string,
  ): Promise<void> {
    const overlaps = await this.repo.findOverlappingForHost(
      hostId,
      startIso,
      endIso,
      excludeMeetingId,
    );
    if (overlaps.length) {
      throw new ConflictException(
        'There is already a meeting scheduled in that time range.',
      );
    }
  }

  private async assertCanView(userId: string, meeting: Meeting): Promise<void> {
    if (meeting.created_by === userId || meeting.host_id === userId) return;
    if ((meeting.participants ?? []).some((p) => p.user_id === userId)) return;
    if (meeting.project_id) {
      const role = await this.authorization.getUserProjectRole(
        userId,
        meeting.project_id,
      );
      if (role) return;
    }
    throw new ForbiddenException('You do not have access to this meeting.');
  }

  private async hasProjectAdmin(
    userId: string,
    projectId: string | null,
  ): Promise<boolean> {
    if (!projectId) return false;
    const role = await this.authorization.getUserProjectRole(userId, projectId);
    return !!role && this.authorization.roleSatisfies(role, 'admin');
  }

  private uniqueInvitees(
    participantIds: string[] | undefined,
    creatorId: string,
  ): string[] {
    return [
      ...new Set(
        (participantIds ?? []).filter((id) => !!id && id !== creatorId),
      ),
    ];
  }

  private uniqueGuestEmails(emails: string[] | undefined): string[] {
    return [
      ...new Set(
        (emails ?? [])
          .map((e) => e.trim().toLowerCase())
          .filter((e) => e.length > 0),
      ),
    ];
  }

  /**
   * Reconcile the attendee set on edit. User attendees are diffed (added +
   * removed, new ones notified); guest emails are add-only in this phase (never
   * the host row is touched).
   */
  private async syncParticipants(
    meeting: Meeting,
    dto: UpdateMeetingDto,
    actorId: string,
  ): Promise<void> {
    const existing =
      meeting.participants ?? (await this.repo.getParticipants(meeting.id));

    if (dto.participant_ids !== undefined) {
      const anchor = meeting.host_id ?? actorId;
      const desired = new Set(this.uniqueInvitees(dto.participant_ids, anchor));
      const currentIds = new Set(
        existing
          .filter((p) => p.user_id && p.role !== 'host')
          .map((p) => p.user_id as string),
      );
      const toRemove = [...currentIds].filter((id) => !desired.has(id));
      const toAdd = [...desired].filter((id) => !currentIds.has(id));

      if (toRemove.length) {
        await this.repo.removeParticipants(meeting.id, toRemove);
      }
      if (toAdd.length) {
        await this.repo.addParticipants(
          meeting.id,
          toAdd.map((id) => ({
            user_id: id,
            role: 'attendee',
            response: 'pending' as const,
          })),
        );
        await this.notifyMany(
          toAdd.filter((id) => id !== actorId),
          {
            user_id: '',
            type_name: 'meeting_invited',
            actor_id: actorId,
            project_id: meeting.project_id ?? undefined,
            content: this.meetingContent(meeting),
            link_url: this.linkFor(meeting),
          },
        );
      }
    }

    if (dto.guest_emails !== undefined) {
      const desired = new Set(this.uniqueGuestEmails(dto.guest_emails));
      const currentEmails = new Set(
        existing
          .filter((p) => !p.user_id && p.guest_email)
          .map((p) => (p.guest_email as string).toLowerCase()),
      );
      const toAdd = [...desired].filter((e) => !currentEmails.has(e));
      if (toAdd.length) {
        await this.repo.addParticipants(
          meeting.id,
          toAdd.map((email) => ({
            user_id: null,
            guest_email: email,
            role: 'attendee',
            response: 'pending' as const,
          })),
        );
      }
    }
  }

  // ── reminders ─────────────────────────────────────────────────────────────

  /**
   * Scan for meetings whose reminder is now due and emit a `meeting_reminder`
   * notification to each participant, exactly once. Meant to be polled by an
   * external scheduler (Cloud Scheduler / pg_cron) via the guarded cron endpoint.
   *
   * Idempotent + race-safe: candidates are claimed with an atomic
   * `reminder_sent_at` stamp, and only the rows this run wins are notified, so
   * overlapping ticks never double-send.
   */
  async dispatchReminders(): Promise<{ due: number; notified: number }> {
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const maxAheadIso = new Date(now + REMINDER_SCAN_AHEAD_MS).toISOString();

    const candidates = await this.repo.findReminderCandidates(
      nowIso,
      maxAheadIso,
    );
    // A meeting is due when its reminder lead time has been reached.
    const due = candidates.filter(
      (m) =>
        m.reminder_minutes != null &&
        Date.parse(m.scheduled_at) - m.reminder_minutes * 60_000 <= now,
    );
    if (!due.length) return { due: 0, notified: 0 };

    const claimed = new Set(
      await this.repo.claimReminders(
        due.map((m) => m.id),
        nowIso,
      ),
    );

    let notified = 0;
    for (const meeting of due) {
      if (!claimed.has(meeting.id)) continue; // another run got it
      const recipientIds = Array.from(
        new Set(
          (meeting.participants ?? [])
            .map((p) => p.user_id)
            .filter((id): id is string => !!id),
        ),
      );
      if (!recipientIds.length) continue;
      await this.notifyMany(recipientIds, {
        user_id: '',
        type_name: 'meeting_reminder',
        actor_id: meeting.host_id ?? undefined,
        project_id: meeting.project_id ?? undefined,
        content: {
          ...this.meetingContent(meeting),
          reminder_minutes: meeting.reminder_minutes,
        },
        link_url: this.linkFor(meeting),
      });
      notified += recipientIds.length;
    }

    return { due: claimed.size, notified };
  }

  private meetingContent(meeting: Meeting): Record<string, unknown> {
    return {
      meeting_id: meeting.id,
      title: meeting.title,
      scheduled_at: meeting.scheduled_at,
      meeting_url: meeting.meeting_url,
    };
  }

  private linkFor(meeting: Meeting): string {
    return meeting.project_id
      ? `/project/${meeting.project_id}/overview`
      : '/meetings';
  }

  // Emit one notification per recipient id (best-effort — a failed notification
  // never blocks the scheduling action that triggered it).
  private async notifyMany(
    userIds: string[],
    base: Parameters<NotificationsService['createNotification']>[0],
  ): Promise<void> {
    await Promise.all(
      userIds.map(async (uid) => {
        try {
          await this.notifications.createNotification({ ...base, user_id: uid });
        } catch {
          /* swallow — notification delivery is best-effort */
        }
      }),
    );
  }
}
