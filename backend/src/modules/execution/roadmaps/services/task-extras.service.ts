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
import { runNotifyWork } from '../../../shared/notifications/notify-work';
import { RoadmapWriteEffects } from './roadmap-write-effects.service';
import { RoadmapActivityService } from './roadmap-activity.service';
import { ACTIVITY_ACTIONS } from '../../../shared/audit/activity-actions';

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
    // `emit`, not `record`: a comment now DOES change the canvas — the count
    // badge and hover preview on the card read from the comment-summary query,
    // and without a realtime publish a peer's comment leaves them stale.
    this.effects.emit(ctx, userId, {
      action: ACTIVITY_ACTIONS.TASK_COMMENT_CREATED,
      entityType: 'task_comment',
      entityId: commentId ?? null,
      metadata: {
        ...this.activity.commentMetadata(commentId, dto.content),
        parent: { type: 'task', id: taskId },
      },
    });
    await runNotifyWork(
      this.fireMentionNotifications(
        taskId,
        dto.content,
        userId,
        ctx,
        commentId,
      ),
      ROADMAP_NOTIFY_DEADLINE_MS,
    );
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
    taskId: string,
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
    // Free from the authz walk the caller already paid for. Without it every
    // bell row and email subject reads "in a task comment" and never says WHICH.
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
        sourceType: 'task_comment',
        sourceId: commentId ?? null,
        entityId: taskId,
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
          type_name: 'task_comment_mention',
          project_id: projectId ?? undefined,
          link_url: linkUrl ?? undefined,
          content: {
            task_id: taskId,
            message: entityTitle
              ? `${actorName ?? 'Someone'} mentioned you in "${entityTitle}".`
              : 'You were mentioned in a task comment.',
            ...(actorName ? { actor_name: actorName } : {}),
            ...(entityTitle ? { context_title: entityTitle } : {}),
            ...(excerpt ? { excerpt } : {}),
          },
        }),
      ),
    ]);
  }

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
    const taskId = before.task_id;
    const ctx = await this.roadmapAuthz.assertTaskCommentPermission(
      taskId,
      userId,
    );

    const updated = await this.repo.updateComment(commentId, dto, userId);
    this.knowledgeOutbox.enqueue({
      sourceType: 'task_comment',
      sourceId: commentId,
      op: 'upsert',
    });
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
          taskId,
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
