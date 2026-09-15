import { Injectable, Inject } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../../config/supabase.module';
import { IRoadmapSharesRepository } from './roadmap-shares.repository.interface';
import { CreateShareDto, AddShareCommentDto } from '../dto/roadmap-shares.dto';
import { randomBytes } from 'crypto';

interface PreviewRoadmapRow {
  id: string;
  project_id: string | null;
  name: string;
}

interface PreviewNodeRow {
  id: string;
  title: string;
}

interface QueryResult<T> {
  data: T | null;
  error: { message: string } | null;
}

@Injectable()
export class RoadmapSharesRepositorySupabase implements IRoadmapSharesRepository {
  constructor(@Inject(SUPABASE_ADMIN) private readonly db: SupabaseClient) {}

  async findPreviewMetadata(roadmapId: string, nodeId: string) {
    const { data: roadmap, error: roadmapError } = (await this.db
      .from('roadmaps')
      .select('id, project_id, name')
      .eq('id', roadmapId)
      .maybeSingle()) as QueryResult<PreviewRoadmapRow>;
    if (roadmapError) throw new Error(roadmapError.message);
    if (!roadmap) return null;

    // Epics and features carry a denormalized roadmap_id; tasks do NOT (they
    // hang off a feature), so the task lookup must scope through the parent
    // feature. Covered by the real-DB integration spec
    // (test/integration/roadmap-preview.integration-spec.ts) — a mocked unit
    // test cannot catch a wrong column name.
    const lookups: Array<{
      table: string;
      type: 'epic' | 'feature' | 'task';
      select: string;
      roadmapColumn: string;
    }> = [
      {
        table: 'roadmap_epics',
        type: 'epic',
        select: 'id, title',
        roadmapColumn: 'roadmap_id',
      },
      {
        table: 'roadmap_features',
        type: 'feature',
        select: 'id, title',
        roadmapColumn: 'roadmap_id',
      },
      {
        table: 'roadmap_tasks',
        type: 'task',
        select: 'id, title, feature:roadmap_features!inner(roadmap_id)',
        roadmapColumn: 'feature.roadmap_id',
      },
    ];

    for (const lookup of lookups) {
      const { data: node, error: nodeError } = (await this.db
        .from(lookup.table)
        .select(lookup.select)
        .eq('id', nodeId)
        .eq(lookup.roadmapColumn, roadmapId)
        .maybeSingle()) as QueryResult<PreviewNodeRow>;
      if (nodeError) throw new Error(nodeError.message);
      if (node) {
        return {
          roadmap_id: roadmap.id,
          project_id: roadmap.project_id ?? null,
          roadmap_name: roadmap.name,
          node_id: node.id,
          node_type: lookup.type,
          node_title: node.title,
        };
      }
    }

    return null;
  }

  async findByRoadmap(roadmapId: string): Promise<any | null> {
    const { data, error } = await this.db
      .from('roadmap_shares')
      .select('*')
      .eq('roadmap_id', roadmapId)
      .single();
    if (error && error.code !== 'PGRST116') throw new Error(error.message);
    return data ?? null;
  }

  async findByToken(token: string): Promise<any | null> {
    const { data, error } = await this.db
      .from('roadmap_shares')
      .select('*, roadmap:roadmaps(id, name, status, owner_id)')
      .eq('share_token', token)
      .single();
    if (error && error.code !== 'PGRST116') throw new Error(error.message);
    return data ?? null;
  }

  async findSharedWithMe(userId: string): Promise<any[]> {
    const { data, error } = await this.db
      .from('roadmap_share_access')
      .select('*, share:roadmap_shares(*, roadmap:roadmaps(id, name, status))')
      .eq('user_id', userId);
    if (error) throw new Error(error.message);
    return data ?? [];
  }

  async create(
    roadmapId: string,
    dto: CreateShareDto,
    userId: string,
  ): Promise<any> {
    const token = randomBytes(24).toString('hex');
    const { data, error } = await this.db
      .from('roadmap_shares')
      .upsert({
        roadmap_id: roadmapId,
        created_by: userId,
        share_token: token,
        permission_level: dto.permission_level ?? 'viewer',
        expires_at: dto.expires_at ?? null,
        is_active: true,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async remove(roadmapId: string, userId: string): Promise<void> {
    const { error } = await this.db
      .from('roadmap_shares')
      .update({ is_active: false })
      .eq('roadmap_id', roadmapId)
      .eq('created_by', userId);
    if (error) throw new Error(error.message);
  }

  async addEpicComment(
    epicId: string,
    dto: AddShareCommentDto,
    userId?: string,
  ): Promise<any> {
    const { data, error } = await this.db
      .from('epic_comments')
      .insert({
        epic_id: epicId,
        content: dto.content,
        commenter_name: dto.commenter_name,
        author_id: userId ?? null,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async addFeatureComment(
    featureId: string,
    dto: AddShareCommentDto,
    userId?: string,
  ): Promise<any> {
    const { data, error } = await this.db
      .from('feature_comments')
      .insert({
        feature_id: featureId,
        content: dto.content,
        commenter_name: dto.commenter_name,
        author_id: userId ?? null,
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }
}
