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
  RescheduleMeetingDto,
  RespondMeetingDto,
  VideoOption,
} from './dto/meeting.dto';
import type {
  Meeting,
  MeetingsRepository,
  NewParticipant,
} from './repositories/meetings.repository.interface';

export const MEETINGS_REPOSITORY = Symbol('MEETINGS_REPOSITORY');

const DEFAULT_DURATION_MINUTES = 30;

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
    });

    const inviteeIds = this.uniqueInvitees(dto.participant_ids, userId);
    const participants: NewParticipant[] = [
      { user_id: userId, role: 'host', response: 'accepted' },
      ...inviteeIds.map((id) => ({
        user_id: id,
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

  async cancel(userId: string, id: string): Promise<Meeting> {
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

    const updated = await this.repo.update(id, { status: 'cancelled' });

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

    return updated;
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

  // ── helpers ────────────────────────────────────────────────────────────────

  private resolveVideo(dto: CreateMeetingDto): {
    videoProvider: VideoOption;
    meetingUrl: string | null;
  } {
    const option: VideoOption =
      dto.video_option ?? (dto.meeting_url ? 'external_link' : 'jitsi');

    if (option === 'external_link') {
      if (!dto.meeting_url) {
        throw new BadRequestException(
          'A meeting link is required when using an external video link.',
        );
      }
      return { videoProvider: 'external_link', meetingUrl: dto.meeting_url };
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
