import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import type { IEpicsRepository } from '../repositories/epics.repository.interface';
import {
  CreateEpicDto,
  UpdateEpicDto,
  BulkReorderDto,
  AddCommentDto,
  UpdateCommentDto,
} from '../dto/roadmaps.dto';
import { RoadmapAuthorizationService } from './roadmap-authorization.service';
import { RealtimePublisher } from '../../realtime/realtime-publisher.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { extractMentionedUserIds } from '../utils/mention-parser';

export const EPICS_REPOSITORY = Symbol('EPICS_REPOSITORY');
const TEMP_EPIC_ID_PREFIX = 'temp-epic-';

@Injectable()
export class EpicsService {
  constructor(
    @Inject(EPICS_REPOSITORY) private readonly repo: IEpicsRepository,
    private readonly roadmapAuthz: RoadmapAuthorizationService,
    private readonly realtime: RealtimePublisher,
    private readonly notificationsService: NotificationsService,
  ) {}

  private notify(roadmapId: string | null, userId: string): void {
    if (roadmapId) this.realtime.publishRoadmapChange(roadmapId, userId);
  }

  async findByRoadmap(roadmapId: string, userId: string) {
    await this.roadmapAuthz.assertCanViewRoadmap(roadmapId, userId);
    return this.repo.findByRoadmap(roadmapId);
  }

  async findById(id: string, userId: string) {
    await this.roadmapAuthz.assertViewPermission({ epicId: id }, userId);
    const epic = await this.repo.findById(id);
    if (!epic) throw new NotFoundException('Epic not found');
    return epic;
  }

  async create(dto: CreateEpicDto, userId: string) {
    await this.roadmapAuthz.assertRoadmapPermission(
      dto.roadmap_id,
      userId,
      'roadmap.edit',
    );
    const epic = await this.repo.create(dto, userId);
    this.notify(dto.roadmap_id, userId);
    return epic;
  }

  async update(id: string, dto: UpdateEpicDto, userId: string) {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundException('Epic not found');
    await this.roadmapAuthz.assertEpicPermission(id, userId, 'roadmap.edit');
    const epic = await this.repo.update(id, dto);
    this.notify(await this.roadmapAuthz.resolveRoadmapId({ epicId: id }), userId);
    return epic;
  }

  async bulkReorder(roadmapId: string, dto: BulkReorderDto, userId: string) {
    await this.roadmapAuthz.assertRoadmapPermission(
      roadmapId,
      userId,
      'roadmap.edit',
    );
    const reordered = await this.repo.bulkReorder(roadmapId, dto);
    this.notify(roadmapId, userId);
    return reordered;
  }

  async findComments(epicId: string, userId: string) {
    await this.roadmapAuthz.assertViewPermission({ epicId }, userId);
    return this.repo.findComments(epicId);
  }

  async addComment(epicId: string, dto: AddCommentDto, userId: string) {
    await this.roadmapAuthz.assertEpicCommentPermission(epicId, userId);
    const comment = await this.repo.addComment(epicId, dto, userId);

    const commentId = (comment as { id?: string }).id;
    void this.fireMentionNotifications(epicId, dto.content, userId, commentId).catch(
      () => {},
    );

    return comment;
  }

  private async fireMentionNotifications(
    epicId: string,
    html: string,
    authorId: string,
    commentId?: string,
  ): Promise<void> {
    const mentionedIds = extractMentionedUserIds(html).filter(
      (id) => id !== authorId,
    );
    if (!mentionedIds.length) return;

    const roadmapId = await this.roadmapAuthz.resolveRoadmapId({ epicId });
    const projectId = roadmapId
      ? await this.roadmapAuthz.resolveProjectId(roadmapId)
      : null;
    const linkUrl =
      projectId && roadmapId
        ? `/project/${projectId}/roadmap/${roadmapId}?nodeId=${epicId}${commentId ? `&commentId=${commentId}` : ''}`
        : null;

    await Promise.allSettled(
      mentionedIds.map((userId) =>
        this.notificationsService.createNotification({
          user_id: userId,
          actor_id: authorId,
          type_name: 'epic_comment_mention',
          project_id: projectId ?? undefined,
          link_url: linkUrl ?? undefined,
          content: {
            epic_id: epicId,
            message: 'You were mentioned in an epic comment.',
          },
        }),
      ),
    );
  }

  async updateComment(
    commentId: string,
    dto: UpdateCommentDto,
    userId: string,
  ) {
    return this.repo.updateComment(commentId, dto, userId);
  }

  async deleteComment(commentId: string, userId: string) {
    return this.repo.deleteComment(commentId, userId);
  }

  async remove(id: string, userId: string) {
    // Optimistic UI rows may issue a delete before a real UUID exists.
    // Treat client temp IDs as already-removed to keep delete idempotent.
    if (id.startsWith(TEMP_EPIC_ID_PREFIX)) {
      return;
    }

    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundException('Epic not found');
    await this.roadmapAuthz.assertEpicPermission(id, userId, 'roadmap.edit');
    // Resolve before deletion — the row is gone once removed.
    const roadmapId = await this.roadmapAuthz.resolveRoadmapId({ epicId: id });
    await this.repo.remove(id);
    this.notify(roadmapId, userId);
  }
}
