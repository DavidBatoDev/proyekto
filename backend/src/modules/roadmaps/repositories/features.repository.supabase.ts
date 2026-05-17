import { Injectable, Inject, ForbiddenException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import { IFeaturesRepository } from './features.repository.interface';
import {
  CreateFeatureDto,
  UpdateFeatureDto,
  BulkReorderDto,
  LinkMilestoneDto,
  UnlinkMilestoneDto,
  AddCommentDto,
  UpdateCommentDto,
} from '../dto/roadmaps.dto';
import { sanitizeCommentHtml } from '../utils/comment-sanitizer';

@Injectable()
export class FeaturesRepositorySupabase implements IFeaturesRepository {
  constructor(@Inject(SUPABASE_ADMIN) private readonly db: SupabaseClient) {}

  async findByEpic(epicId: string): Promise<any[]> {
    const { data, error } = await this.db
      .from('roadmap_features')
      .select(
        '*, milestone_features(milestone_id, milestone:roadmap_milestones(id, title, status, target_date))',
      )
      .eq('epic_id', epicId)
      .order('position', { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async findByRoadmap(roadmapId: string): Promise<any[]> {
    const { data, error } = await this.db
      .from('roadmap_features')
      .select('*, epic:roadmap_epics(id, title)')
      .eq('roadmap_id', roadmapId)
      .order('position', { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async findById(id: string): Promise<any | null> {
    const { data, error } = await this.db
      .from('roadmap_features')
      .select(
        '*, milestone_features(milestone_id, milestone:roadmap_milestones(id, title))',
      )
      .eq('id', id)
      .single();
    if (error && error.code !== 'PGRST116') throw new Error(error.message);
    return data ?? null;
  }

  async create(dto: CreateFeatureDto, userId: string): Promise<any> {
    const { data, error } = await this.db
      .from('roadmap_features')
      .insert({ ...dto })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async update(id: string, dto: UpdateFeatureDto): Promise<any> {
    const { data, error } = await this.db
      .from('roadmap_features')
      .update({ ...dto, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async bulkReorder(epicId: string, dto: BulkReorderDto): Promise<void> {
    const now = new Date().toISOString();
    const TEMP_OFFSET = 1_000_000;

    // Phase 1: shift all rows to unique temp positions to break transient conflicts
    const phase1 = dto.items.map((item, idx) =>
      this.db
        .from('roadmap_features')
        .update({ position: TEMP_OFFSET + idx, updated_at: now })
        .eq('id', item.id)
        .eq('epic_id', epicId),
    );
    for (const { error } of await Promise.all(phase1)) {
      if (error) throw new Error(error.message);
    }

    // Phase 2: set final positions (all unique, no conflicts)
    const phase2 = dto.items.map((item) =>
      this.db
        .from('roadmap_features')
        .update({ position: item.position })
        .eq('id', item.id)
        .eq('epic_id', epicId),
    );
    for (const { error } of await Promise.all(phase2)) {
      if (error) throw new Error(error.message);
    }
  }

  async findComments(featureId: string): Promise<any[]> {
    const { data, error } = await this.db
      .from('feature_comments')
      .select(
        '*, user:profiles(id, display_name, first_name, last_name, avatar_url, email)',
      )
      .eq('feature_id', featureId)
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async addComment(
    featureId: string,
    dto: AddCommentDto,
    userId: string,
  ): Promise<any> {
    const content = sanitizeCommentHtml(dto.content);
    const { data, error } = await this.db
      .from('feature_comments')
      .insert({ feature_id: featureId, content, user_id: userId })
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
      .from('feature_comments')
      .select('user_id')
      .eq('id', commentId)
      .single();
    if (existingError) throw new Error(existingError.message);
    if (existing && existing.user_id !== userId) {
      throw new ForbiddenException('You can only edit your own comments');
    }

    const { data, error } = await this.db
      .from('feature_comments')
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
      .from('feature_comments')
      .select('user_id')
      .eq('id', commentId)
      .single();
    if (existingError) throw new Error(existingError.message);
    if (existing && existing.user_id !== userId) {
      throw new ForbiddenException('You can only delete your own comments');
    }

    const { error } = await this.db
      .from('feature_comments')
      .delete()
      .eq('id', commentId);
    if (error) throw new Error(error.message);
  }

  async linkMilestone(dto: LinkMilestoneDto): Promise<any> {
    const { data, error } = await this.db
      .from('milestone_features')
      .insert({ feature_id: dto.feature_id, milestone_id: dto.milestone_id })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async unlinkMilestone(dto: UnlinkMilestoneDto): Promise<void> {
    const { error } = await this.db
      .from('milestone_features')
      .delete()
      .eq('feature_id', dto.feature_id)
      .eq('milestone_id', dto.milestone_id);
    if (error) throw new Error(error.message);
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.db
      .from('roadmap_features')
      .delete()
      .eq('id', id);
    if (error) throw new Error(error.message);
  }
}
