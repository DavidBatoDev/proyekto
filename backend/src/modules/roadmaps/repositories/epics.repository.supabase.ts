import { Injectable, Inject, ForbiddenException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import { IEpicsRepository } from './epics.repository.interface';
import {
  CreateEpicDto,
  UpdateEpicDto,
  BulkReorderDto,
  AddCommentDto,
  UpdateCommentDto,
} from '../dto/roadmaps.dto';
import { sanitizeCommentHtml } from '../utils/comment-sanitizer';

@Injectable()
export class EpicsRepositorySupabase implements IEpicsRepository {
  constructor(@Inject(SUPABASE_ADMIN) private readonly db: SupabaseClient) {}

  async findByRoadmap(roadmapId: string): Promise<any[]> {
    const { data, error } = await this.db
      .from('roadmap_epics')
      .select('*')
      .eq('roadmap_id', roadmapId)
      .order('position', { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async findById(id: string): Promise<any | null> {
    const { data, error } = await this.db
      .from('roadmap_epics')
      .select('*')
      .eq('id', id)
      .single();
    if (error && error.code !== 'PGRST116') throw new Error(error.message);
    return data ?? null;
  }

  async create(dto: CreateEpicDto, userId: string): Promise<any> {
    const { data: existingEpics, error: existingError } = await this.db
      .from('roadmap_epics')
      .select('id, position')
      .eq('roadmap_id', dto.roadmap_id)
      .order('position', { ascending: true });
    if (existingError) throw new Error(existingError.message);

    const orderedEpics = (existingEpics ?? [])
      .map((epic: any, index: number) => {
        const rawPosition =
          typeof epic?.position === 'number'
            ? epic.position
            : Number(epic?.position);
        return {
          id: String(epic.id),
          position:
            Number.isFinite(rawPosition) && rawPosition >= 0
              ? rawPosition
              : index,
        };
      })
      .sort((a, b) => a.position - b.position);

    const maxPosition =
      orderedEpics.length > 0
        ? orderedEpics.reduce(
            (max, epic) => Math.max(max, Math.floor(epic.position)),
            0,
          )
        : -1;
    const appendPosition = maxPosition + 1;
    const hasRequestedPosition =
      typeof dto.position === 'number' && Number.isFinite(dto.position);
    const requestedPosition = hasRequestedPosition
      ? Math.max(0, Math.floor(dto.position as number))
      : appendPosition;
    const insertPosition = Math.min(requestedPosition, appendPosition);

    const epicsToShift = orderedEpics.filter(
      (epic) => epic.position >= insertPosition,
    );
    if (epicsToShift.length > 0) {
      const tempBase = maxPosition + epicsToShift.length + 1000;

      for (const [index, epic] of epicsToShift.entries()) {
        const { error } = await this.db
          .from('roadmap_epics')
          .update({
            position: tempBase + index,
            updated_at: new Date().toISOString(),
          })
          .eq('id', epic.id)
          .eq('roadmap_id', dto.roadmap_id);
        if (error) throw new Error(error.message);
      }

      for (const epic of epicsToShift) {
        const { error } = await this.db
          .from('roadmap_epics')
          .update({
            position: Math.floor(epic.position) + 1,
            updated_at: new Date().toISOString(),
          })
          .eq('id', epic.id)
          .eq('roadmap_id', dto.roadmap_id);
        if (error) throw new Error(error.message);
      }
    }

    const { data, error } = await this.db
      .from('roadmap_epics')
      .insert({ ...dto, position: insertPosition })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async update(id: string, dto: UpdateEpicDto): Promise<any> {
    // Strip frontend-only fields that have no DB column
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { labels, ...dbFields } = dto as UpdateEpicDto & { labels?: unknown };
    const { data, error } = await this.db
      .from('roadmap_epics')
      .update({ ...dbFields, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async bulkReorder(roadmapId: string, dto: BulkReorderDto): Promise<void> {
    const updates = dto.items.map((item) =>
      this.db
        .from('roadmap_epics')
        .update({
          position: item.position,
          updated_at: new Date().toISOString(),
        })
        .eq('id', item.id)
        .eq('roadmap_id', roadmapId),
    );
    const results = await Promise.all(updates);
    for (const { error } of results) {
      if (error) throw new Error(error.message);
    }
  }

  async findComments(epicId: string): Promise<any[]> {
    const { data, error } = await this.db
      .from('epic_comments')
      .select(
        '*, user:profiles(id, display_name, first_name, last_name, avatar_url, email)',
      )
      .eq('epic_id', epicId)
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async addComment(
    epicId: string,
    dto: AddCommentDto,
    userId: string,
  ): Promise<any> {
    const content = sanitizeCommentHtml(dto.content);
    const { data, error } = await this.db
      .from('epic_comments')
      .insert({ epic_id: epicId, content, user_id: userId })
      .select(
        '*, user:profiles(id, display_name, first_name, last_name, avatar_url, email)',
      )
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async updateComment(
    commentId: string,
    dto: UpdateCommentDto,
    userId: string,
  ): Promise<any> {
    const content = sanitizeCommentHtml(dto.content);
    const { data: existing, error: existingError } = await this.db
      .from('epic_comments')
      .select('user_id')
      .eq('id', commentId)
      .single();
    if (existingError) throw new Error(existingError.message);
    if (existing && existing.user_id !== userId) {
      throw new ForbiddenException('You can only edit your own comments');
    }

    const { data, error } = await this.db
      .from('epic_comments')
      .update({ content, updated_at: new Date().toISOString() })
      .eq('id', commentId)
      .select(
        '*, user:profiles(id, display_name, first_name, last_name, avatar_url, email)',
      )
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async deleteComment(commentId: string, userId: string): Promise<void> {
    const { data: existing, error: existingError } = await this.db
      .from('epic_comments')
      .select('user_id')
      .eq('id', commentId)
      .single();
    if (existingError) throw new Error(existingError.message);
    if (existing && existing.user_id !== userId) {
      throw new ForbiddenException('You can only delete your own comments');
    }

    const { error } = await this.db
      .from('epic_comments')
      .delete()
      .eq('id', commentId);
    if (error) throw new Error(error.message);
  }

  async remove(id: string): Promise<void> {
    const existingEpic = await this.findById(id);

    const { error: deleteError } = await this.db
      .from('roadmap_epics')
      .delete()
      .eq('id', id);
    if (deleteError) throw new Error(deleteError.message);

    const roadmapId =
      typeof existingEpic?.roadmap_id === 'string'
        ? existingEpic.roadmap_id
        : null;
    const rawDeletedPosition =
      typeof existingEpic?.position === 'number'
        ? existingEpic.position
        : Number(existingEpic?.position);
    const deletedPosition =
      Number.isFinite(rawDeletedPosition) && rawDeletedPosition >= 0
        ? Math.floor(rawDeletedPosition)
        : null;

    if (!roadmapId || deletedPosition === null) {
      return;
    }

    const { data: trailingEpics, error: trailingError } = await this.db
      .from('roadmap_epics')
      .select('id, position')
      .eq('roadmap_id', roadmapId)
      .gt('position', deletedPosition)
      .order('position', { ascending: true });
    if (trailingError) throw new Error(trailingError.message);

    const epicsToShift = (trailingEpics ?? []).map((epic: any, index: number) => ({
      id: String(epic.id),
      nextPosition: deletedPosition + index,
    }));
    if (epicsToShift.length === 0) {
      return;
    }

    const maxTrailingPosition = (trailingEpics ?? []).reduce(
      (max: number, epic: any) => {
        const rawPosition =
          typeof epic?.position === 'number'
            ? epic.position
            : Number(epic?.position);
        if (!Number.isFinite(rawPosition)) return max;
        return Math.max(max, Math.floor(rawPosition));
      },
      deletedPosition,
    );
    const tempBase = maxTrailingPosition + epicsToShift.length + 1000;

    for (const [index, epic] of epicsToShift.entries()) {
      const { error } = await this.db
        .from('roadmap_epics')
        .update({
          position: tempBase + index,
          updated_at: new Date().toISOString(),
        })
        .eq('id', epic.id)
        .eq('roadmap_id', roadmapId);
      if (error) throw new Error(error.message);
    }

    for (const epic of epicsToShift) {
      const { error } = await this.db
        .from('roadmap_epics')
        .update({
          position: epic.nextPosition,
          updated_at: new Date().toISOString(),
        })
        .eq('id', epic.id)
        .eq('roadmap_id', roadmapId);
      if (error) throw new Error(error.message);
    }
  }
}
