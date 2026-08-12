import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ITaskExtrasRepository } from '../repositories/task-extras.repository.interface';
import {
  AddCommentDto,
  UpdateCommentDto,
  AddAttachmentDto,
} from '../dto/roadmaps.dto';
import {
  RoadmapAuthorizationService,
  type RoadmapWriteContext,
} from './roadmap-authorization.service';
import { KnowledgeOutboxService } from '../../../shared/knowledge/knowledge-outbox.service';
import { NotificationsService } from '../../../shared/notifications/notifications.service';
import { htmlToText } from '../../../../common/utils/html-to-text.util';
import {
  extractMentionedEmails,
  extractMentionedUserIds,
} from '../utils/mention-parser';
import { RoadmapMentionInviteService } from './roadmap-mention-invite.service';
import { MENTION_EXCERPT_MAX_CHARS } from '../../../shared/notifications/notification-content';
import { RoadmapWriteEffects } from './roadmap-write-effects.service';
import { RoadmapActivityService } from './roadmap-activity.service';
import { ACTIVITY_ACTIONS } from '../../../shared/audit/activity-actions';

export const TASK_EXTRAS_REPOSITORY = Symbol('TASK_EXTRAS_REPOSITORY');

@Injectable()
export class TaskExtrasService {
  constructor(
    @Inject(TASK_EXTRAS_REPOSITORY)
    private readonly repo: ITaskExtrasRepository,
    private readonly roadmapAuthz: RoadmapAuthorizationService,
    private readonly notificationsService: NotificationsService,
    private readonly mentionInvites: RoadmapMentionInviteService,
    private readonly knowledgeOutbox: KnowledgeOutboxService,
    private readonly effects: RoadmapWriteEffects,
    private readonly activity: RoadmapActivityService,
  ) {}

  async findComments(taskId: string, userId: string) {
    await this.roadmapAuthz.assertViewPermission({ taskId }, userId);
    return this.repo.findComments(taskId);
  }

  async addComment(taskId: string, dto: AddCommentDto, userId: string) {
    const ctx = await this.roadmapAuthz.assertTaskCommentPermission(
      taskId,
      userId,
    );
    const comment = await this.repo.addComment(taskId, dto, userId);

    // Fire in-app notifications for @mentioned users (best-effort, non-blocking)
    const commentId = (comment as { id?: string }).id;
    this.effects.record(ctx, userId, {
      action: ACTIVITY_ACTIONS.TASK_COMMENT_CREATED,
      entityType: 'task_comment',
      entityId: commentId ?? null,
      metadata: {
        ...this.activity.commentMetadata(commentId, dto.content),
        parent: { type: 'task', id: taskId },
      },
    });
    void this.fireMentionNotifications(
      taskId,
      dto.content,
      userId,
      ctx,
      commentId,
    ).catch(() => {});
    if (commentId) {
      this.knowledgeOutbox.enqueue({
        sourceType: 'task_comment',
        sourceId: commentId,
        op: 'upsert',
      });
    }

    return comment;
  }

  /**
   * Batch comment for the roadmap AI agent: the same comment posted to many
   * tasks, reusing addComment per task so authz, sanitization, mention
   * notifications, and knowledge indexing stay identical to the human path.
   * Per-task failures are data the agent reports back — never a batch abort —
   * and a task outside the given roadmap surfaces as NOT_FOUND so a probe
   * cannot distinguish "other roadmap" from "does not exist".
   */
  async addCommentToTasks(
    roadmapId: string,
    taskIds: string[],
    content: string,
    userId: string,
  ) {
    const uniqueIds = [...new Set(taskIds)];
    const results: Array<{
      task_id: string;
      ok: boolean;
      comment_id?: string | null;
      error?: { code: string; message: string };
    }> = [];

    for (const taskId of uniqueIds) {
      try {
        const owner = await this.roadmapAuthz.resolveRoadmapId({ taskId });
        if (!owner || owner !== roadmapId) {
          results.push({
            task_id: taskId,
            ok: false,
            error: {
              code: 'NOT_FOUND',
              message: 'Task not found on this roadmap.',
            },
          });
          continue;
        }
        const comment = await this.addComment(taskId, { content }, userId);
        results.push({
          task_id: taskId,
          ok: true,
          comment_id: (comment as { id?: string }).id ?? null,
        });
      } catch (err) {
        results.push({
          task_id: taskId,
          ok: false,
          error: this.toPerTaskCommentError(err),
        });
      }
    }

    return {
      posted: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    };
  }

  private toPerTaskCommentError(err: unknown): {
    code: string;
    message: string;
  } {
    if (err instanceof HttpException) {
      const status = err.getStatus();
      if (status === HttpStatus.FORBIDDEN) {
        return { code: 'FORBIDDEN', message: err.message };
      }
      if (status === HttpStatus.NOT_FOUND) {
        return { code: 'NOT_FOUND', message: err.message };
      }
      return { code: 'COMMENT_FAILED', message: err.message };
    }
    return { code: 'COMMENT_FAILED', message: 'Failed to add the comment.' };
  }

  private async fireMentionNotifications(
    taskId: string,
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

    // The ids above are `data-user-id` attributes lifted out of client-supplied
    // HTML, so they are untrusted: notify only people who can actually see this
    // roadmap. Fail closed when the scope is unknown rather than notifying the
    // raw list.
    if (!roadmapId) return;

    const linkUrl =
      projectId && roadmapId
        ? `/project/${projectId}/roadmap/${roadmapId}?nodeId=${taskId}${commentId ? `&commentId=${commentId}` : ''}`
        : null;

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
        sourceType: 'task_comment',
        sourceId: commentId ?? null,
        entityId: taskId,
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
          type_name: 'task_comment_mention',
          project_id: projectId ?? undefined,
          link_url: linkUrl ?? undefined,
          content: {
            task_id: taskId,
            message: 'You were mentioned in a task comment.',
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
    const updated = await this.repo.updateComment(commentId, dto, userId);
    this.knowledgeOutbox.enqueue({
      sourceType: 'task_comment',
      sourceId: commentId,
      op: 'upsert',
    });
    return updated;
  }

  async deleteComment(commentId: string, userId: string) {
    const deleted = await this.repo.deleteComment(commentId, userId);
    this.knowledgeOutbox.enqueue({
      sourceType: 'task_comment',
      sourceId: commentId,
      op: 'delete',
    });
    return deleted;
  }

  async findAttachments(taskId: string, userId: string) {
    await this.roadmapAuthz.assertViewPermission({ taskId }, userId);
    return this.repo.findAttachments(taskId);
  }

  async addAttachment(taskId: string, dto: AddAttachmentDto, userId: string) {
    const ctx = await this.roadmapAuthz.assertTaskPermission(
      taskId,
      userId,
      'roadmap.edit',
    );
    const attachment = await this.repo.addAttachment(taskId, dto, userId);
    this.effects.record(ctx, userId, {
      action: ACTIVITY_ACTIONS.TASK_ATTACHMENT_ADDED,
      entityType: 'task_attachment',
      entityId: (attachment as { id?: string })?.id ?? null,
      title: (dto as { file_name?: string }).file_name ?? null,
      metadata: { parent: { type: 'task', id: taskId } },
    });
    return attachment;
  }

  // Not logged: no authorization walk today, so there is no resolved scope to
  // attribute it to without adding queries to a path that has none — same call
  // as the comment edit/delete paths.
  async deleteAttachment(attachmentId: string, userId: string) {
    return this.repo.deleteAttachment(attachmentId, userId);
  }

  async getDependencies(taskId: string, userId: string) {
    await this.roadmapAuthz.assertViewPermission({ taskId }, userId);
    return this.repo.getDependencies(taskId);
  }

  async addDependency(taskId: string, blockingTaskId: string, userId: string) {
    const ctx = await this.roadmapAuthz.assertTaskPermission(
      taskId,
      userId,
      'roadmap.edit',
    );
    const dependency = await this.repo.addDependency(
      taskId,
      blockingTaskId,
      userId,
    );
    this.effects.record(ctx, userId, {
      action: ACTIVITY_ACTIONS.TASK_DEPENDENCY_ADDED,
      entityType: 'task_dependency',
      entityId: (dependency as { id?: string })?.id ?? null,
      metadata: { blocked: { id: taskId }, blocking: { id: blockingTaskId } },
    });
    return dependency;
  }

  async removeDependency(taskId: string, dependencyId: string, userId: string) {
    // Resolve the dependency and confirm it actually belongs to the task in
    // the URL (either endpoint of the edge), then require edit rights on that
    // task's roadmap. 404 (not 403) so we never leak a dependency's existence.
    const dependency = await this.repo.findDependencyById(dependencyId);
    if (
      !dependency ||
      (dependency.blocked_task_id !== taskId &&
        dependency.blocking_task_id !== taskId)
    ) {
      throw new NotFoundException('Dependency not found');
    }
    const ctx = await this.roadmapAuthz.assertTaskPermission(
      taskId,
      userId,
      'roadmap.edit',
    );
    const removed = await this.repo.removeDependency(dependencyId);
    this.effects.record(ctx, userId, {
      action: ACTIVITY_ACTIONS.TASK_DEPENDENCY_REMOVED,
      entityType: 'task_dependency',
      entityId: dependencyId,
      metadata: {
        blocked: { id: dependency.blocked_task_id },
        blocking: { id: dependency.blocking_task_id },
      },
    });
    return removed;
  }
}
