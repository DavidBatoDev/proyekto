import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../../config/supabase.module';
import {
  IRoadmapCommentSummaryRepository,
  RoadmapCommentSummaryRow,
} from './roadmap-comment-summary.repository.interface';

/**
 * Thin wrapper over `get_roadmap_comment_summary`. The aggregation lives in SQL
 * (20260819140000_roadmap_comment_summary.sql) because it is three UNION ALL
 * branches with a lateral each — expressing that through PostgREST embeds would
 * be both slower and unreadable.
 */
@Injectable()
export class RoadmapCommentSummaryRepositorySupabase implements IRoadmapCommentSummaryRepository {
  constructor(@Inject(SUPABASE_ADMIN) private readonly db: SupabaseClient) {}

  async listForRoadmap(roadmapId: string): Promise<RoadmapCommentSummaryRow[]> {
    const { data, error } = (await this.db.rpc('get_roadmap_comment_summary', {
      p_roadmap_id: roadmapId,
    })) as {
      data: RoadmapCommentSummaryRow[] | null;
      error: { message: string } | null;
    };

    if (error) throw new Error(error.message);
    return data ?? [];
  }
}
