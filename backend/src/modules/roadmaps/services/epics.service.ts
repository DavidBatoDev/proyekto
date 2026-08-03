import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import type { IEpicsRepository } from '../repositories/epics.repository.interface';
import {
  CreateEpicDto,
  UpdateEpicDto,
  BulkReorderDto,
  AddCommentDto,
  UpdateCommentDto,
} from '../dto/roadmaps.dto';
import {
  RoadmapAuthorizationService,
  type RoadmapWriteContext,
} from './roadmap-authorization.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { htmlToText } from '../../../common/utils/html-to-text.util';
import { extractMentionedUserIds } from '../utils/mention-parser';
import { MENTION_EXCERPT_MAX_CHARS } from '../../notifications/notification-content';
import { RoadmapWriteEffects } from './roadmap-write-effects.service';
import { RoadmapActivityService } from './roadmap-activity.service';
import { ACTIVITY_ACTIONS } from '../../audit/activity-actions';

export const EPICS_REPOSITORY = Symbol('EPICS_REPOSITORY');
const TEMP_EPIC_ID_PREFIX = 'temp-epic-';

/** Fields whose changes are worth showing in the activity feed. */
const EPIC_TRACKED_FIELDS = [
  'title',
  'description',
  'status',
  'priority',
  'start_date',
  'end_date',
  'estimated_hours',
];

@Injectable()
export class EpicsService {
  constructor(
    @Inject(EPICS_REPOSITORY) private readonly repo: IEpicsRepository,
    private readonly roadmapAuthz: RoadmapAuthorizationService,
    private readonly effects: RoadmapWriteEffects,
    private readonly activity: RoadmapActivityService,
    private readonly notificationsService: NotificationsService,
  ) {}

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
    const ctx = await this.roadmapAuthz.assertRoadmapPermission(
      dto.roadmap_id,
      userId,
      'roadmap.edit',
    );
    const epic = await this.repo.create(dto, userId);
    this.effects.emit(ctx, userId, {
      action: ACTIVITY_ACTIONS.EPIC_CREATED,
      entityType: 'epic',
      entityId: (epic as { id?: string })?.id ?? null,
      title: dto.title,
    });
    return epic;
  }

  async update(id: string, dto: UpdateEpicDto, userId: string) {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundException('Epic not found');
    const ctx = await this.roadmapAuthz.assertEpicPermission(
      id,
      userId,
      'roadmap.edit',
    );
    const epic = await this.repo.update(id, dto);

    const changes = this.activity.diff(existing, epic, EPIC_TRACKED_FIELDS);
    this.effects.emit(ctx, userId, {
      action: this.activity.nodeUpdateAction('epic', {
        statusChanged: changes.some((c) => c.field === 'status'),
      }),
      entityType: 'epic',
      entityId: id,
      title: (epic as { title?: string })?.title ?? existing.title,
      metadata: { changes },
    });
    return epic;
  }

  async bulkReorder(roadmapId: string, dto: BulkReorderDto, userId: string) {
    const ctx = await this.roadmapAuthz.assertRoadmapPermission(
      roadmapId,
      userId,
      'roadmap.edit',
    );
    const reordered = await this.repo.bulkReorder(roadmapId, dto);
    // One row for the whole gesture, never one per moved item.
    this.effects.emit(ctx, userId, {
      action: ACTIVITY_ACTIONS.EPIC_REORDERED,
      entityType: 'epic',
      metadata: this.activity.reorderMetadata({
        scopeType: 'roadmap',
        scopeId: roadmapId,
        itemCount: dto.items?.length ?? 0,
        moved: dto.items?.map((i) => ({ id: i.id, position: i.position })),
      }),
    });
    return reordered;
  }

  async findComments(epicId: string, userId: string) {
    await this.roadmapAuthz.assertViewPermission({ epicId }, userId);
    return this.repo.findComments(epicId);
  }

  async addComment(epicId: string, dto: AddCommentDto, userId: string) {
    const ctx = await this.roadmapAuthz.assertEpicCommentPermission(
      epicId,
      userId,
    );
    const comment = await this.repo.addComment(epicId, dto, userId);

    const commentId = (comment as { id?: string }).id;
    // Comments do not move the canvas, so record without a realtime publish.
    this.effects.record(ctx, userId, {
      action: ACTIVITY_ACTIONS.EPIC_COMMENT_CREATED,
      entityType: 'epic_comment',
      entityId: commentId ?? null,
      metadata: {
        ...this.activity.commentMetadata(commentId, dto.content),
        parent: { type: 'epic', id: epicId },
      },
    });

    void this.fireMentionNotifications(
      epicId,
      dto.content,
      userId,
      ctx,
      commentId,
    ).catch(() => {});

    return comment;
  }

  private async fireMentionNotifications(
    epicId: string,
    html: string,
    authorId: string,
    ctx: RoadmapWriteContext,
    commentId?: string,
  ): Promise<void> {
    const mentionedIds = extractMentionedUserIds(html).filter(
      (id) => id !== authorId,
    );
    if (!mentionedIds.length) return;

    // Scope comes from the authz walk the caller already paid for.
    const roadmapId = ctx?.roadmapId ?? null;
    const projectId = ctx?.projectId ?? null;
    const linkUrl =
      projectId && roadmapId
        ? `/project/${projectId}/roadmap/${roadmapId}?nodeId=${epicId}${commentId ? `&commentId=${commentId}` : ''}`
        : null;

    // The ids above are `data-user-id` attributes lifted out of client-supplied
    // HTML, so they are untrusted: notify only people who can actually see this
    // roadmap. Fail closed when the scope is unknown rather than notifying the
    // raw list.
    if (!roadmapId) return;
    const targets = await this.roadmapAuthz.filterUsersWhoCanViewRoadmap(
      roadmapId,
      mentionedIds,
    );
    if (!targets.length) return;

    // Snapshot what a human-facing message needs. The excerpt is captured here
    // rather than re-read later because the comment may be edited or deleted
    // before the notification is acted on. `htmlToText` strips every tag, so
    // nothing renderable survives into a downstream email body.
    const actorName =
      await this.notificationsService.resolveActorName(authorId);
    const excerpt = htmlToText(html, MENTION_EXCERPT_MAX_CHARS);

    await Promise.allSettled(
      targets.map((userId) =>
        this.notificationsService.createNotification({
          user_id: userId,
          actor_id: authorId,
          type_name: 'epic_comment_mention',
          project_id: projectId ?? undefined,
          link_url: linkUrl ?? undefined,
          content: {
            epic_id: epicId,
            message: 'You were mentioned in an epic comment.',
            ...(actorName ? { actor_name: actorName } : {}),
            ...(excerpt ? { excerpt } : {}),
          },
        }),
      ),
    );
  }

  // NOTE: comment edit/delete are deliberately NOT logged. They carry no
  // authorization walk today (only the repo's authorship check), so recording
  // them would mean adding a full scope resolution — two queries — to a path
  // that currently has none, on the rarest events in the feed. Comment
  // CREATION, the event people actually look for, is covered.
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
    // The authz walk already resolved the owning roadmap, and it did so before
    // the delete — no post-delete re-read needed.
    const ctx = await this.roadmapAuthz.assertEpicPermission(
      id,
      userId,
      'roadmap.edit',
    );
    await this.repo.remove(id);
    this.effects.emit(ctx, userId, {
      action: ACTIVITY_ACTIONS.EPIC_DELETED,
      entityType: 'epic',
      entityId: id,
      // Captured before the delete — the row is gone, the name must survive.
      title: (existing as { title?: string })?.title ?? null,
    });
  }
}
