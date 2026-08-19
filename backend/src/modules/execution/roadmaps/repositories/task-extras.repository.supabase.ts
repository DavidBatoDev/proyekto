import { Injectable, Inject, ForbiddenException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../../config/supabase.module';
import { ITaskExtrasRepository } from './task-extras.repository.interface';
import {
  AddCommentDto,
  UpdateCommentDto,
  AddAttachmentDto,
} from '../dto/roadmaps.dto';
import { sanitizeCommentHtml } from '../utils/comment-sanitizer';
import { rethrowCommentThreadError } from '../utils/comment-thread-errors';

const COMMENT_PROFILE_COLS = 'id, display_name, avatar_url';

/**
 * Every profiles embed on task_comments MUST carry an FK hint.
 *
 * The table has two foreign keys to profiles — author_id and resolved_by — and
 * PostgREST refuses a bare `profiles(...)` embed once more than one
 * relationship exists ("Could not embed because more than one relationship was
 * found"). Same reason as the ASSIGNEES_EMBED hint in
 * features.repository.supabase.ts. Adding a third FK to profiles here would not
 * break anything as long as the hints stay.
 */

@Injectable()
export class TaskExtrasRepositorySupabase implements ITaskExtrasRepository {
  constructor(@Inject(SUPABASE_ADMIN) private readonly db: SupabaseClient) {}

  async findComments(taskId: string): Promise<any[]> {
    const { data, error } = await this.db
      .from('task_comments')
      .select(`*, author:profiles!author_id(${COMMENT_PROFILE_COLS})`)
      .eq('task_id', taskId)
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async addComment(
    taskId: string,
    dto: AddCommentDto,
    userId: string,
  ): Promise<any> {
    const content = sanitizeCommentHtml(dto.content);
    const { data, error } = await this.db
      .from('task_comments')
      .insert({
        task_id: taskId,
        content,
        author_id: userId,
        parent_id: dto.parent_id ?? null,
      })
      .select(`*, author:profiles!author_id(${COMMENT_PROFILE_COLS})`)
      .single();
    if (error) rethrowCommentThreadError(error.message);
    return data;
  }

  /**
   * Resolve or reopen a thread.
   *
   * Writes resolved_by alongside resolved_at, and clears BOTH on reopen — the
   * task_comments_resolver_needs_resolution CHECK rejects a resolver left
   * behind on an open thread, so clearing one without the other is a 500.
   */
  async resolveComment(
    commentId: string,
    resolved: boolean,
    userId: string,
  ): Promise<any> {
    const { data, error } = await this.db
      .from('task_comments')
      .update(
        resolved
          ? { resolved_at: new Date().toISOString(), resolved_by: userId }
          : { resolved_at: null, resolved_by: null },
      )
      .eq('id', commentId)
      .select(
        `*, author:profiles!author_id(${COMMENT_PROFILE_COLS}), resolver:profiles!resolved_by(${COMMENT_PROFILE_COLS})`,
      )
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async findCommentContext(commentId: string): Promise<{
    task_id: string;
    author_id: string | null;
    content: string;
  } | null> {
    const { data, error } = await this.db
      .from('task_comments')
      .select('task_id, author_id, content')
      .eq('id', commentId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    return {
      task_id: String(data.task_id),
      author_id: (data.author_id as string | null) ?? null,
      content: String(data.content ?? ''),
    };
  }

  async updateComment(
    commentId: string,
    dto: UpdateCommentDto,
    userId: string,
  ): Promise<any> {
    const content = sanitizeCommentHtml(dto.content);
    // Verify ownership
    const { data: existing } = await this.db
      .from('task_comments')
      .select('author_id')
      .eq('id', commentId)
      .single();
    if (existing && existing.author_id !== userId) {
      throw new ForbiddenException('You can only edit your own comments');
    }

    const { data, error } = await this.db
      .from('task_comments')
      .update({
        content,
        edited_at: new Date().toISOString(),
      })
      .eq('id', commentId)
      .select(`*, author:profiles!author_id(${COMMENT_PROFILE_COLS})`)
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async deleteComment(commentId: string, userId: string): Promise<void> {
    const { data: existing } = await this.db
      .from('task_comments')
      .select('author_id')
      .eq('id', commentId)
      .single();
    if (existing && existing.author_id !== userId) {
      throw new ForbiddenException('You can only delete your own comments');
    }
    const { error } = await this.db
      .from('task_comments')
      .delete()
      .eq('id', commentId);
    if (error) throw new Error(error.message);
  }

  async findAttachments(taskId: string): Promise<any[]> {
    const { data, error } = await this.db
      .from('task_attachments')
      .select('*')
      .eq('task_id', taskId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async addAttachment(
    taskId: string,
    dto: AddAttachmentDto,
    userId: string,
  ): Promise<any> {
    const { data, error } = await this.db
      .from('task_attachments')
      .insert({ task_id: taskId, ...dto, uploaded_by: userId })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async deleteAttachment(attachmentId: string, userId: string): Promise<void> {
    const { data: existing } = await this.db
      .from('task_attachments')
      .select('uploaded_by')
      .eq('id', attachmentId)
      .single();
    if (existing && existing.uploaded_by !== userId) {
      throw new ForbiddenException('You can only delete your own attachments');
    }
    const { error } = await this.db
      .from('task_attachments')
      .delete()
      .eq('id', attachmentId);
    if (error) throw new Error(error.message);
  }

  async getDependencies(
    taskId: string,
  ): Promise<{ blocking: any[]; blocked_by: any[] }> {
    const [blockingRes, blockedByRes] = await Promise.all([
      this.db
        .from('task_dependencies')
        .select(
          '*, blocking_task:roadmap_tasks!blocking_task_id(id, title, status)',
        )
        .eq('blocked_task_id', taskId),
      this.db
        .from('task_dependencies')
        .select(
          '*, blocked_task:roadmap_tasks!blocked_task_id(id, title, status)',
        )
        .eq('blocking_task_id', taskId),
    ]);
    if (blockingRes.error) throw new Error(blockingRes.error.message);
    if (blockedByRes.error) throw new Error(blockedByRes.error.message);
    return {
      blocked_by: blockingRes.data ?? [],
      blocking: blockedByRes.data ?? [],
    };
  }

  async addDependency(
    blockedTaskId: string,
    blockingTaskId: string,
    userId: string,
  ): Promise<any> {
    const { data, error } = await this.db
      .from('task_dependencies')
      .insert({
        blocking_task_id: blockingTaskId,
        blocked_task_id: blockedTaskId,
        created_by: userId,
      })
      .select(
        '*, blocking_task:roadmap_tasks!blocking_task_id(id, title, status)',
      )
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async findDependencyById(
    dependencyId: string,
  ): Promise<{
    id: string;
    blocked_task_id: string;
    blocking_task_id: string;
  } | null> {
    const { data, error } = await this.db
      .from('task_dependencies')
      .select('id, blocked_task_id, blocking_task_id')
      .eq('id', dependencyId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (
      (data as {
        id: string;
        blocked_task_id: string;
        blocking_task_id: string;
      } | null) ?? null
    );
  }

  async removeDependency(dependencyId: string): Promise<void> {
    const { error } = await this.db
      .from('task_dependencies')
      .delete()
      .eq('id', dependencyId);
    if (error) throw new Error(error.message);
  }
}
