import {
  AddCommentDto,
  UpdateCommentDto,
  AddAttachmentDto,
} from '../dto/roadmaps.dto';

export interface ITaskExtrasRepository {
  findComments(taskId: string): Promise<any[]>;
  addComment(taskId: string, dto: AddCommentDto, userId: string): Promise<any>;
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
  getDependencies(taskId: string): Promise<{ blocking: any[]; blocked_by: any[] }>;
  findDependencyById(
    dependencyId: string,
  ): Promise<{ id: string; blocked_task_id: string; blocking_task_id: string } | null>;
  addDependency(blockedTaskId: string, blockingTaskId: string, userId: string): Promise<any>;
  removeDependency(dependencyId: string): Promise<void>;
}
