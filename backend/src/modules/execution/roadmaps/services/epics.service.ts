import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import type { IEpicsRepository } from '../repositories/epics.repository.interface';
import type { IFeaturesRepository } from '../repositories/features.repository.interface';
import type { ITasksRepository } from '../repositories/tasks.repository.interface';
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
import { NotificationsService } from '../../../shared/notifications/notifications.service';
import { htmlToText } from '../../../../common/utils/html-to-text.util';
import {
  extractMentionedEmails,
  extractMentionedUserIds,
} from '../utils/mention-parser';
import { RoadmapMentionInviteService } from './roadmap-mention-invite.service';
import { MENTION_EXCERPT_MAX_CHARS } from '../../../shared/notifications/notification-content';
import { runNotifyWork } from '../../../shared/notifications/notify-work';
import { RoadmapWriteEffects } from './roadmap-write-effects.service';
import { RoadmapActivityService } from './roadmap-activity.service';
import { ACTIVITY_ACTIONS } from '../../../shared/audit/activity-actions';
import { FEATURES_REPOSITORY } from './features.service';
import { TASKS_REPOSITORY } from './tasks.service';

/**
 * Ceiling on the mention fan-out a comment write will wait for.
 *
 * Longer than the chat default because this path does strictly more work: an
 * actor-name read, a bulk roadmap-visibility probe, N bounded pushes, AND the
 * account-less invite path — which is LIVE (`roadmap_mention_invite` was set
 * email_eligible in 20260804165000) and costs an authz round-trip plus up to
 * MAX_EMAIL_MENTIONS_PER_COMMENT inserts and a mail send.
 */
const ROADMAP_NOTIFY_DEADLINE_MS = 4_000;

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
    @Inject(FEATURES_REPOSITORY)
    private readonly featuresRepo: IFeaturesRepository,
    @Inject(TASKS_REPOSITORY) private readonly tasksRepo: ITasksRepository,
    private readonly roadmapAuthz: RoadmapAuthorizationService,
    private readonly effects: RoadmapWriteEffects,
    private readonly activity: RoadmapActivityService,
    private readonly notificationsService: NotificationsService,
    private readonly mentionInvites: RoadmapMentionInviteService,
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

  /**
   * Deep-clones the epic plus its features and their tasks. Children are
   * created straight through the sibling repositories (not FeaturesService/
   * TasksService) so the gesture logs a single activity row instead of one
   * per cloned child — the same "one row for the whole gesture" rule as
   * bulkReorder. Assignees are intentionally not copied to a fresh clone.
   */
  async duplicate(id: string, userId: string) {
    const existing = await this.repo.findById(id);
    if (!existing) throw new NotFoundException('Epic not found');
    const ctx = await this.roadmapAuthz.assertEpicPermission(
      id,
      userId,
      'roadmap.edit',
    );

    const clonedEpic = await this.repo.create(
      {
        roadmap_id: existing.roadmap_id,
        title: `${existing.title} (Copy)`,
        description: existing.description ?? undefined,
        priority: existing.priority ?? undefined,
        status: existing.status ?? undefined,
        position: (existing.position ?? 0) + 1,
        color: existing.color ?? undefined,
        estimated_hours: existing.estimated_hours ?? undefined,
        start_date: existing.start_date ?? undefined,
        end_date: existing.end_date ?? undefined,
        tags: existing.tags ?? undefined,
      },
      userId,
    );

    const sourceFeatures = await this.featuresRepo.findByEpic(id);
    const newFeatures: unknown[] = [];
    for (const [index, feature] of sourceFeatures.entries()) {
      const clonedFeature = await this.featuresRepo.create(
        {
          roadmap_id: existing.roadmap_id,
          epic_id: (clonedEpic as { id: string }).id,
          title: feature.title,
          description: feature.description ?? undefined,
          position: index,
          is_deliverable: feature.is_deliverable ?? undefined,
          estimated_hours: feature.estimated_hours ?? undefined,
          start_date: feature.start_date ?? undefined,
          end_date: feature.end_date ?? undefined,
        },
        userId,
      );

      const sourceTasks = await this.tasksRepo.findByFeature(feature.id);
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
      newFeatures.push({ ...clonedFeature, tasks: newTasks });
    }

    this.effects.emit(ctx, userId, {
      action: ACTIVITY_ACTIONS.EPIC_DUPLICATED,
      entityType: 'epic',
      entityId: (clonedEpic as { id?: string })?.id ?? null,
      title: (clonedEpic as { title?: string })?.title ?? null,
      metadata: { source_epic_id: id },
    });

    return { ...clonedEpic, features: newFeatures };
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
    // `emit`, not `record`: a comment now DOES change the canvas — the count
    // badge and hover preview on the card read from the comment-summary query,
    // and without a realtime publish a peer's comment leaves them stale.
    this.effects.emit(ctx, userId, {
      action: ACTIVITY_ACTIONS.EPIC_COMMENT_CREATED,
      entityType: 'epic_comment',
      entityId: commentId ?? null,
      metadata: {
        ...this.activity.commentMetadata(commentId, dto.content),
        parent: { type: 'epic', id: epicId },
      },
    });

    await runNotifyWork(
      this.fireMentionNotifications(
        epicId,
        dto.content,
        userId,
        ctx,
        commentId,
      ),
      ROADMAP_NOTIFY_DEADLINE_MS,
    );

    return comment;
  }

  /**
   * Everyone named in a body, minus the author. Split out so an EDIT can diff
   * against the previous body and notify only the people newly added — a typo
   * fix must not re-ping the whole thread.
   */
  private extractMentionTargets(
    html: string,
    authorId: string,
  ): { ids: string[]; emails: string[] } {
    return {
      ids: extractMentionedUserIds(html).filter((id) => id !== authorId),
      emails: extractMentionedEmails(html),
    };
  }

  private async fireMentionNotifications(
    epicId: string,
    html: string,
    authorId: string,
    ctx: RoadmapWriteContext,
    commentId?: string,
    /** Defaults to everything in `html`; an edit passes only the additions. */
    targetsOverride?: { ids: string[]; emails: string[] },
  ): Promise<void> {
    const targetSet =
      targetsOverride ?? this.extractMentionTargets(html, authorId);
    const mentionedIds = targetSet.ids;
    // NOT `!mentionedIds.length` alone: a comment that names only an email
    // address has zero user ids, and that is the commonest case here.
    const mentionedEmails = targetSet.emails;
    if (!mentionedIds.length && !mentionedEmails.length) return;

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
    // Snapshot what a human-facing message needs. The excerpt is captured here
    // rather than re-read later because the comment may be edited or deleted
    // before the notification is acted on. `htmlToText` strips every tag, so
    // nothing renderable survives into a downstream email body.
    const actorName =
      await this.notificationsService.resolveActorName(authorId);
    const excerpt = htmlToText(html, MENTION_EXCERPT_MAX_CHARS);
    // Free from the authz walk the caller already paid for. Without it every
    // bell row and email subject reads "in a epic comment" and never says WHICH.
    const entityTitle = ctx?.entityTitle ?? null;

    // Fired BEFORE the `targets` check below on purpose: a comment that names
    // only an email address resolves to zero user targets, and that is exactly
    // the case this feature exists for.
    const invitePromise = this.mentionInvites
      .inviteMentionedEmails({
        html,
        // Narrowed on an edit, so previously-invited addresses are not re-invited.
        onlyEmails: mentionedEmails,
        authorId,
        projectId,
        roadmapId,
        sourceType: 'epic_comment',
        sourceId: commentId ?? null,
        entityId: epicId,
        linkUrl,
        entityTitle,
        actorName,
        excerpt,
      })
      .catch(() => {});

    const targets = await this.roadmapAuthz.filterUsersWhoCanViewRoadmap(
      roadmapId,
      mentionedIds,
    );

    // The invite is awaited HERE rather than early-returned around: a comment
    // naming only an email address has zero user targets, which is precisely
    // the case the invite path exists for. Returning on `!targets.length`
    // would detach it again and reintroduce the bug this method just fixed.
    await Promise.allSettled([
      invitePromise,
      ...targets.map((userId) =>
        this.notificationsService.createNotification({
          user_id: userId,
          actor_id: authorId,
          type_name: 'epic_comment_mention',
          project_id: projectId ?? undefined,
          link_url: linkUrl ?? undefined,
          content: {
            epic_id: epicId,
            message: entityTitle
              ? `${actorName ?? 'Someone'} mentioned you in "${entityTitle}".`
              : 'You were mentioned in an epic comment.',
            ...(actorName ? { actor_name: actorName } : {}),
            ...(entityTitle ? { context_title: entityTitle } : {}),
            ...(excerpt ? { excerpt } : {}),
          },
        }),
      ),
    ]);
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
    // Resolve scope BEFORE the write. This path previously had no
    // authorization walk at all — only the repository's authorship check — so
    // someone who had lost roadmap access could still edit an old comment.
    // The same read supplies the previous body, which the mention diff needs.
    const before = await this.repo.findCommentContext(commentId);
    if (!before) throw new NotFoundException('Comment not found');
    const epicId = before.epic_id;
    const ctx = await this.roadmapAuthz.assertEpicCommentPermission(
      epicId,
      userId,
    );

    const updated = await this.repo.updateComment(commentId, dto, userId);

    // Notify ONLY people newly named. Re-pinging everyone on a typo fix is how
    // a mention stops meaning anything.
    const previous = this.extractMentionTargets(before.content, userId);
    const next = this.extractMentionTargets(dto.content, userId);
    const seenIds = new Set(previous.ids);
    const seenEmails = new Set(previous.emails.map((e) => e.toLowerCase()));
    const added = {
      ids: next.ids.filter((id) => !seenIds.has(id)),
      emails: next.emails.filter((e) => !seenEmails.has(e.toLowerCase())),
    };

    if (added.ids.length || added.emails.length) {
      await runNotifyWork(
        this.fireMentionNotifications(
          epicId,
          dto.content,
          userId,
          ctx,
          commentId,
          added,
        ),
        ROADMAP_NOTIFY_DEADLINE_MS,
      );
    }

    return updated;
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
