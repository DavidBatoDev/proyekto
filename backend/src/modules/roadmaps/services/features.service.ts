import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import type { IFeaturesRepository } from '../repositories/features.repository.interface';
import type { ITasksRepository } from '../repositories/tasks.repository.interface';
import {
  CreateFeatureDto,
  UpdateFeatureDto,
  BulkReorderDto,
  LinkMilestoneDto,
  UnlinkMilestoneDto,
  AddCommentDto,
  UpdateCommentDto,
} from '../dto/roadmaps.dto';
import {
  RoadmapAuthorizationService,
  type RoadmapWriteContext,
} from './roadmap-authorization.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { htmlToText } from '../../../common/utils/html-to-text.util';
import {
  extractMentionedEmails,
  extractMentionedUserIds,
} from '../utils/mention-parser';
import { RoadmapMentionInviteService } from './roadmap-mention-invite.service';
import { MENTION_EXCERPT_MAX_CHARS } from '../../notifications/notification-content';
import { RoadmapWriteEffects } from './roadmap-write-effects.service';
import { RoadmapActivityService } from './roadmap-activity.service';
import { ACTIVITY_ACTIONS } from '../../audit/activity-actions';
import { TASKS_REPOSITORY } from './tasks.service';

export const FEATURES_REPOSITORY = Symbol('FEATURES_REPOSITORY');

const FEATURE_TRACKED_FIELDS = [
  'title',
  'description',
  'status',
  'epic_id',
  'is_deliverable',
  'start_date',
  'end_date',
  'estimated_hours',
];

@Injectable()
export class FeaturesService {
  constructor(
    @Inject(FEATURES_REPOSITORY) private readonly repo: IFeaturesRepository,
    @Inject(TASKS_REPOSITORY) private readonly tasksRepo: ITasksRepository,
    private readonly roadmapAuthz: RoadmapAuthorizationService,
    private readonly effects: RoadmapWriteEffects,
    private readonly activity: RoadmapActivityService,
    private readonly notificationsService: NotificationsService,
    private readonly mentionInvites: RoadmapMentionInviteService,
  ) {}

  async findByEpic(epicId: string, userId: string) {
    await this.roadmapAuthz.assertViewPermission({ epicId }, userId);
    return this.repo.findByEpic(epicId);
  }

  async findByRoadmap(roadmapId: string, userId: string) {
    await this.roadmapAuthz.assertCanViewRoadmap(roadmapId, userId);
    return this.repo.findByRoadmap(roadmapId);
  }

  async findById(id: string, userId: string) {
    await this.roadmapAuthz.assertViewPermission({ featureId: id }, userId);
    const feature = await this.repo.findById(id);
    if (!feature) throw new NotFoundException('Feature not found');
    return feature;
  }

  async create(dto: CreateFeatureDto, userId: string) {
    const ctx = await this.roadmapAuthz.assertEpicPermission(
      dto.epic_id,
      userId,
      'roadmap.edit',
    );
    const feature = await this.repo.create(dto, userId);
    this.effects.emit(ctx, userId, {
      action: ACTIVITY_ACTIONS.FEATURE_CREATED,
      entityType: 'feature',
      entityId: (feature as { id?: string })?.id ?? null,
      title: dto.title,
      metadata: { parent: { type: 'epic', id: dto.epic_id } },
    });
    return feature;
  }

  async update(id: string, dto: UpdateFeatureDto, userId: string) {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundException('Feature not found');
    const ctx = await this.roadmapAuthz.assertFeaturePermission(
      id,
      userId,
      'roadmap.edit',
    );
    if (dto.epic_id && dto.epic_id !== existing.epic_id) {
      await this.roadmapAuthz.assertEpicPermission(
        dto.epic_id,
        userId,
        'roadmap.edit',
      );
    }

    // Status is only user-settable when the feature currently has zero
    // tasks — otherwise TasksService/FeatureStatusSyncService keeps it
    // cascade-derived. Never trust the client's word for "has no tasks";
    // check server-side and silently drop the field rather than reject the
    // whole update.
    let effectiveDto = dto;
    if (dto.status !== undefined) {
      const tasks = await this.tasksRepo.findByFeature(id);
      if (tasks.length > 0) {
        effectiveDto = { ...dto };
        delete effectiveDto.status;
      }
    }

    const feature = await this.repo.update(id, effectiveDto);

    const changes = this.activity.diff(
      existing,
      feature,
      FEATURE_TRACKED_FIELDS,
    );
    this.effects.emit(ctx, userId, {
      action: this.activity.nodeUpdateAction('feature', {
        statusChanged: changes.some((c) => c.field === 'status'),
        parentChanged: changes.some((c) => c.field === 'epic_id'),
      }),
      entityType: 'feature',
      entityId: id,
      title: (feature as { title?: string })?.title ?? existing.title,
      metadata: { changes },
    });
    return feature;
  }

  async bulkReorder(epicId: string, dto: BulkReorderDto, userId: string) {
    const ctx = await this.roadmapAuthz.assertEpicPermission(
      epicId,
      userId,
      'roadmap.edit',
    );
    const reordered = await this.repo.bulkReorder(epicId, dto);
    this.effects.emit(ctx, userId, {
      action: ACTIVITY_ACTIONS.FEATURE_REORDERED,
      entityType: 'feature',
      metadata: this.activity.reorderMetadata({
        scopeType: 'epic',
        scopeId: epicId,
        itemCount: dto.items?.length ?? 0,
        moved: dto.items?.map((i) => ({ id: i.id, position: i.position })),
      }),
    });
    return reordered;
  }

  /**
   * Deep-clones the feature plus its tasks, inserted immediately after the
   * source in the same epic. Features aren't shifted automatically on insert
   * (unlike epics), so trailing siblings are bumped via the same bulkReorder
   * path the drag-reorder UI uses before the clone is created at the freed
   * position. Tasks are cloned through the repository directly (not
   * TasksService) so only one activity row is logged for the whole gesture.
   */
  async duplicate(id: string, userId: string) {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundException('Feature not found');
    const ctx = await this.roadmapAuthz.assertFeaturePermission(
      id,
      userId,
      'roadmap.edit',
    );

    const insertPosition = (existing.position ?? 0) + 1;
    const siblings = await this.repo.findByEpic(existing.epic_id);
    const toShift = siblings.filter(
      (feature) => (feature.position ?? 0) >= insertPosition,
    );
    if (toShift.length) {
      await this.repo.bulkReorder(existing.epic_id, {
        items: toShift.map((feature) => ({
          id: feature.id,
          position: (feature.position as number) + 1,
        })),
      });
    }

    const clonedFeature = await this.repo.create(
      {
        roadmap_id: existing.roadmap_id,
        epic_id: existing.epic_id,
        title: `${existing.title} (Copy)`,
        description: existing.description ?? undefined,
        position: insertPosition,
        is_deliverable: existing.is_deliverable ?? undefined,
        estimated_hours: existing.estimated_hours ?? undefined,
        start_date: existing.start_date ?? undefined,
        end_date: existing.end_date ?? undefined,
      },
      userId,
    );

    const sourceTasks = await this.tasksRepo.findByFeature(id);
    const newTasks: unknown[] = [];
    for (const [taskIndex, task] of sourceTasks.entries()) {
      const clonedTask = await this.tasksRepo.create(
        {
          feature_id: (clonedFeature as { id: string }).id,
          title: task.title,
          description: task.description ?? undefined,
          priority: task.priority ?? undefined,
          status: task.status ?? undefined,
          due_date: task.due_date ?? undefined,
          position: taskIndex,
          work_type: task.work_type ?? undefined,
          checklist: task.checklist ?? undefined,
        },
        userId,
      );
      newTasks.push(clonedTask);
    }

    this.effects.emit(ctx, userId, {
      action: ACTIVITY_ACTIONS.FEATURE_DUPLICATED,
      entityType: 'feature',
      entityId: (clonedFeature as { id?: string })?.id ?? null,
      title: (clonedFeature as { title?: string })?.title ?? null,
      metadata: {
        parent: { type: 'epic', id: existing.epic_id },
        source_feature_id: id,
      },
    });

    return { ...clonedFeature, tasks: newTasks };
  }

  async findComments(featureId: string, userId: string) {
    await this.roadmapAuthz.assertViewPermission({ featureId }, userId);
    return this.repo.findComments(featureId);
  }

  async addComment(featureId: string, dto: AddCommentDto, userId: string) {
    const ctx = await this.roadmapAuthz.assertFeatureCommentPermission(
      featureId,
      userId,
    );
    const comment = await this.repo.addComment(featureId, dto, userId);

    const commentId = (comment as { id?: string }).id;
    this.effects.record(ctx, userId, {
      action: ACTIVITY_ACTIONS.FEATURE_COMMENT_CREATED,
      entityType: 'feature_comment',
      entityId: commentId ?? null,
      metadata: {
        ...this.activity.commentMetadata(commentId, dto.content),
        parent: { type: 'feature', id: featureId },
      },
    });

    void this.fireMentionNotifications(
      featureId,
      dto.content,
      userId,
      ctx,
      commentId,
    ).catch(() => {});

    return comment;
  }

  private async fireMentionNotifications(
    featureId: string,
    html: string,
    authorId: string,
    ctx: RoadmapWriteContext,
    commentId?: string,
  ): Promise<void> {
    const mentionedIds = extractMentionedUserIds(html).filter(
      (id) => id !== authorId,
    );
    // NOT `!mentionedIds.length` alone: a comment that names only an email
    // address has zero user ids, and that is the commonest case here.
    const mentionedEmails = extractMentionedEmails(html);
    if (!mentionedIds.length && !mentionedEmails.length) return;

    // Scope comes from the authz walk the caller already paid for.
    const roadmapId = ctx?.roadmapId ?? null;
    const projectId = ctx?.projectId ?? null;
    const linkUrl =
      projectId && roadmapId
        ? `/project/${projectId}/roadmap/${roadmapId}?nodeId=${featureId}${commentId ? `&commentId=${commentId}` : ''}`
        : null;

    // The ids above are `data-user-id` attributes lifted out of client-supplied
    // HTML, so they are untrusted: notify only people who can actually see this
    // roadmap. Fail closed when the scope is unknown rather than notifying the
    // raw list.
    if (!roadmapId) return;
    // Snapshot what a human-facing message needs. The excerpt is captured here
    // rather than re-read later because the comment may be edited or deleted
    // before the notification is acted on. `htmlToText` strips every tag, so
    // nothing renderable survives into a downstream email body.
    const actorName =
      await this.notificationsService.resolveActorName(authorId);
    const excerpt = htmlToText(html, MENTION_EXCERPT_MAX_CHARS);

    // Fired BEFORE the `targets` check below on purpose: a comment that names
    // only an email address resolves to zero user targets, and that is exactly
    // the case this feature exists for.
    void this.mentionInvites
      .inviteMentionedEmails({
        html,
        authorId,
        projectId,
        roadmapId,
        sourceType: 'feature_comment',
        sourceId: commentId ?? null,
        entityId: featureId,
        linkUrl,
        entityTitle: null,
        actorName,
        excerpt,
      })
      .catch(() => {});

    const targets = await this.roadmapAuthz.filterUsersWhoCanViewRoadmap(
      roadmapId,
      mentionedIds,
    );
    if (!targets.length) return;

    await Promise.allSettled(
      targets.map((userId) =>
        this.notificationsService.createNotification({
          user_id: userId,
          actor_id: authorId,
          type_name: 'feature_comment_mention',
          project_id: projectId ?? undefined,
          link_url: linkUrl ?? undefined,
          content: {
            feature_id: featureId,
            message: 'You were mentioned in a feature comment.',
            ...(actorName ? { actor_name: actorName } : {}),
            ...(excerpt ? { excerpt } : {}),
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

  async linkMilestone(dto: LinkMilestoneDto, userId: string) {
    const ctx = await this.roadmapAuthz.assertFeaturePermission(
      dto.feature_id,
      userId,
      'roadmap.edit',
    );
    const linked = await this.repo.linkMilestone(dto);
    this.effects.emit(ctx, userId, {
      action: ACTIVITY_ACTIONS.FEATURE_MILESTONE_LINKED,
      entityType: 'feature',
      entityId: dto.feature_id,
      metadata: { milestone_id: dto.milestone_id },
    });
    return linked;
  }

  async unlinkMilestone(dto: UnlinkMilestoneDto, userId: string) {
    const ctx = await this.roadmapAuthz.assertFeaturePermission(
      dto.feature_id,
      userId,
      'roadmap.edit',
    );
    const unlinked = await this.repo.unlinkMilestone(dto);
    this.effects.emit(ctx, userId, {
      action: ACTIVITY_ACTIONS.FEATURE_MILESTONE_UNLINKED,
      entityType: 'feature',
      entityId: dto.feature_id,
      metadata: { milestone_id: dto.milestone_id },
    });
    return unlinked;
  }

  async remove(id: string, userId: string) {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundException('Feature not found');
    // The authz walk already resolved the owning roadmap, and it did so before
    // the delete — no post-delete re-read needed.
    const ctx = await this.roadmapAuthz.assertFeaturePermission(
      id,
      userId,
      'roadmap.edit',
    );
    await this.repo.remove(id);
    this.effects.emit(ctx, userId, {
      action: ACTIVITY_ACTIONS.FEATURE_DELETED,
      entityType: 'feature',
      entityId: id,
      title: (existing as { title?: string })?.title ?? null,
    });
  }
}
