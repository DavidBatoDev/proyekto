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
import { KnowledgeOutboxService } from '../../knowledge/knowledge-outbox.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { extractMentionedUserIds } from '../utils/mention-parser';
import { RoadmapWriteEffects } from './roadmap-write-effects.service';
import { RoadmapActivityService } from './roadmap-activity.service';
import { ACTIVITY_ACTIONS } from '../../audit/activity-actions';

export const TASK_EXTRAS_REPOSITORY = Symbol('TASK_EXTRAS_REPOSITORY');

@Injectable()
export class TaskExtrasService {
  constructor(
    @Inject(TASK_EXTRAS_REPOSITORY)
    private readonly repo: ITaskExtrasRepository,
    private readonly roadmapAuthz: RoadmapAuthorizationService,
    private readonly notificationsService: NotificationsService,
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
    if (!mentionedIds.length) return;

    // Scope comes from the authz walk the caller already paid for.
    const roadmapId = ctx?.roadmapId ?? null;
    const projectId = ctx?.projectId ?? null;
    const linkUrl =
      projectId && roadmapId
        ? `/project/${projectId}/roadmap/${roadmapId}?nodeId=${taskId}${commentId ? `&commentId=${commentId}` : ''}`
        : null;

    await Promise.allSettled(
      mentionedIds.map((userId) =>
        this.notificationsService.createNotification({
          user_id: userId,
          actor_id: authorId,
          type_name: 'task_comment_mention',
          project_id: projectId ?? undefined,
          link_url: linkUrl ?? undefined,
          content: {
            task_id: taskId,
            message: 'You were mentioned in a task comment.',
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
