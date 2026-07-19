import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import type { ITaskExtrasRepository } from '../repositories/task-extras.repository.interface';
import {
  AddCommentDto,
  UpdateCommentDto,
  AddAttachmentDto,
} from '../dto/roadmaps.dto';
import { RoadmapAuthorizationService } from './roadmap-authorization.service';
import { KnowledgeOutboxService } from '../../knowledge/knowledge-outbox.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { extractMentionedUserIds } from '../utils/mention-parser';

export const TASK_EXTRAS_REPOSITORY = Symbol('TASK_EXTRAS_REPOSITORY');

@Injectable()
export class TaskExtrasService {
  constructor(
    @Inject(TASK_EXTRAS_REPOSITORY)
    private readonly repo: ITaskExtrasRepository,
    private readonly roadmapAuthz: RoadmapAuthorizationService,
    private readonly notificationsService: NotificationsService,
    private readonly knowledgeOutbox: KnowledgeOutboxService,
  ) {}

  async findComments(taskId: string, userId: string) {
    await this.roadmapAuthz.assertViewPermission({ taskId }, userId);
    return this.repo.findComments(taskId);
  }

  async addComment(taskId: string, dto: AddCommentDto, userId: string) {
    await this.roadmapAuthz.assertTaskCommentPermission(taskId, userId);
    const comment = await this.repo.addComment(taskId, dto, userId);

    // Fire in-app notifications for @mentioned users (best-effort, non-blocking)
    const commentId = (comment as { id?: string }).id;
    void this.fireMentionNotifications(taskId, dto.content, userId, commentId).catch(
      () => {},
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

  private async fireMentionNotifications(
    taskId: string,
    html: string,
    authorId: string,
    commentId?: string,
  ): Promise<void> {
    const mentionedIds = extractMentionedUserIds(html).filter(
      (id) => id !== authorId,
    );
    if (!mentionedIds.length) return;

    const roadmapId = await this.roadmapAuthz.resolveRoadmapId({ taskId });
    const projectId = roadmapId
      ? await this.roadmapAuthz.resolveProjectId(roadmapId)
      : null;
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
    await this.roadmapAuthz.assertTaskPermission(
      taskId,
      userId,
      'roadmap.edit',
    );
    return this.repo.addAttachment(taskId, dto, userId);
  }

  async deleteAttachment(attachmentId: string, userId: string) {
    return this.repo.deleteAttachment(attachmentId, userId);
  }

  async getDependencies(taskId: string, userId: string) {
    await this.roadmapAuthz.assertViewPermission({ taskId }, userId);
    return this.repo.getDependencies(taskId);
  }

  async addDependency(
    taskId: string,
    blockingTaskId: string,
    userId: string,
  ) {
    await this.roadmapAuthz.assertTaskPermission(
      taskId,
      userId,
      'roadmap.edit',
    );
    return this.repo.addDependency(taskId, blockingTaskId, userId);
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
    await this.roadmapAuthz.assertTaskPermission(taskId, userId, 'roadmap.edit');
    return this.repo.removeDependency(dependencyId);
  }
}
