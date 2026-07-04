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

const PROFILE_COLS =
  'id, display_name, avatar_url, email, first_name, last_name';

// The explicit "feature team". Join rows come back as `[{ profile: {...} }]`;
// normalizeAssignees flattens them to `assignees: [{...}]`.
const ASSIGNEES_EMBED = `assignees:roadmap_feature_assignees(profile:profiles(${PROFILE_COLS}))`;

@Injectable()
export class FeaturesRepositorySupabase implements IFeaturesRepository {
  constructor(@Inject(SUPABASE_ADMIN) private readonly db: SupabaseClient) {}

  private normalizeAssignees<T extends { assignees?: any }>(
    row: T | null,
  ): T | null {
    if (!row) return row;
    const raw = Array.isArray(row.assignees) ? row.assignees : [];
    const assignees = raw
      .map((entry: any) => entry?.profile)
      .filter((p: any) => p && typeof p.id === 'string');
    return { ...row, assignees };
  }

  /** Reconciles the feature-team join table to exactly `assigneeIds`. */
  private async syncFeatureAssignees(
    featureId: string,
    assigneeIds: string[],
    userId?: string,
  ): Promise<void> {
    const next = [...new Set(assigneeIds.filter(Boolean))];
    const { data: existingRows, error: readErr } = await this.db
      .from('roadmap_feature_assignees')
      .select('assignee_id')
      .eq('feature_id', featureId);
    if (readErr) throw new Error(readErr.message);

    const existing = new Set(
      (existingRows ?? []).map((r: any) => r.assignee_id as string),
    );
    const added = next.filter((id) => !existing.has(id));
    const removed = [...existing].filter((id) => !next.includes(id));

    if (removed.length) {
      const { error } = await this.db
        .from('roadmap_feature_assignees')
        .delete()
        .eq('feature_id', featureId)
        .in('assignee_id', removed);
      if (error) throw new Error(error.message);
    }
    if (added.length) {
      const { error } = await this.db.from('roadmap_feature_assignees').insert(
        added.map((assignee_id) => ({
          feature_id: featureId,
          assignee_id,
          assigned_by: userId ?? null,
        })),
      );
      if (error) throw new Error(error.message);
    }
  }

  async findByEpic(epicId: string): Promise<any[]> {
    const { data, error } = await this.db
      .from('roadmap_features')
      .select(
        `*, milestone_features(milestone_id, milestone:roadmap_milestones(id, title, status, target_date)), ${ASSIGNEES_EMBED}`,
      )
      .eq('epic_id', epicId)
      .order('position', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => this.normalizeAssignees(row));
  }

  async findByRoadmap(roadmapId: string): Promise<any[]> {
    const { data, error } = await this.db
      .from('roadmap_features')
      .select(`*, epic:roadmap_epics(id, title), ${ASSIGNEES_EMBED}`)
      .eq('roadmap_id', roadmapId)
      .order('position', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []).map((row) => this.normalizeAssignees(row));
  }

  async findById(id: string): Promise<any | null> {
    const { data, error } = await this.db
      .from('roadmap_features')
      .select(
        `*, milestone_features(milestone_id, milestone:roadmap_milestones(id, title)), ${ASSIGNEES_EMBED}`,
      )
      .eq('id', id)
      .single();
    if (error && error.code !== 'PGRST116') throw new Error(error.message);
    return this.normalizeAssignees(data ?? null);
  }

  async create(dto: CreateFeatureDto, userId: string): Promise<any> {
    // assignee_ids is not a column on roadmap_features — split it out.
    const { assignee_ids, ...featureCols } = dto;
    const { data, error } = await this.db
      .from('roadmap_features')
      .insert({ ...featureCols })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    if (assignee_ids?.length) {
      await this.syncFeatureAssignees(data.id, assignee_ids, userId);
    }
    return this.findById(data.id);
  }

  async update(id: string, dto: UpdateFeatureDto): Promise<any> {
    const { assignee_ids, ...featureCols } = dto;
    const { error } = await this.db
      .from('roadmap_features')
      .update({ ...featureCols, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw new Error(error.message);
    if (assignee_ids !== undefined) {
      await this.syncFeatureAssignees(id, assignee_ids);
    }
    return this.findById(id);
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
