import {
  AddCommentDto,
  UpdateCommentDto,
  AddAttachmentDto,
} from '../dto/roadmaps.dto';

export interface ITaskExtrasRepository {
  findComments(taskId: string): Promise<any[]>;
  addComment(taskId: string, dto: AddCommentDto, userId: string): Promise<any>;
  /**
   * The comment's parent id, author and CURRENT body, read before an edit.
   *
   * Exists so an edit can notify people newly @mentioned in it — the diff needs
   * the previous body — and so the service can run the roadmap authorization
   * walk that this path never had. Returns null when the comment is gone.
   */
  findCommentContext(commentId: string): Promise<{
    task_id: string;
    author_id: string | null;
    content: string;
  } | null>;
  updateComment(
    commentId: string,
    dto: UpdateCommentDto,
    userId: string,
  ): Promise<any>;
  deleteComment(commentId: string, userId: string): Promise<void>;
  findAttachments(taskId: string): Promise<any[]>;
  addAttachment(
    taskId: string,
    dto: AddAttachmentDto,
    userId: string,
  ): Promise<any>;
  deleteAttachment(attachmentId: string, userId: string): Promise<void>;
  getDependencies(
    taskId: string,
  ): Promise<{ blocking: any[]; blocked_by: any[] }>;
  findDependencyById(
    dependencyId: string,
  ): Promise<{
    id: string;
    blocked_task_id: string;
    blocking_task_id: string;
  } | null>;
  addDependency(
    blockedTaskId: string,
    blockingTaskId: string,
    userId: string,
  ): Promise<any>;
  removeDependency(dependencyId: string): Promise<void>;
}
