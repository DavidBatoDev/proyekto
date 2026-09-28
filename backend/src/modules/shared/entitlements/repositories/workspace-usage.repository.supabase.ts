import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../../config/supabase.module';
import type { WorkspaceUsageRepository } from './workspace-usage.repository.interface';

@Injectable()
export class SupabaseWorkspaceUsageRepository implements WorkspaceUsageRepository {
  private readonly logger = new Logger(SupabaseWorkspaceUsageRepository.name);

  constructor(@Inject(SUPABASE_ADMIN) private readonly db: SupabaseClient) {}

  /**
   * One can_view_roadmap call per id. The usage page asks about the five
   * largest roadmaps at most, so this stays a handful of cheap lookups and
   * reuses the exact predicate the roadmap RLS policies use.
   */
  async filterViewableRoadmapIds(
    userId: string,
    roadmapIds: string[],
  ): Promise<Set<string>> {
    const ids = [...new Set(roadmapIds.filter(Boolean))];
    const verdicts = await Promise.all(
      ids.map(async (id) => {
        try {
          const { data, error } = (await this.db.rpc('can_view_roadmap', {
            uid: userId,
            rmp: id,
          })) as { data: unknown; error: { message: string } | null };
          if (error) throw new Error(error.message);
          return data === true ? id : null;
        } catch (error) {
          this.logger.warn(
            `usage_roadmap_visibility_failed roadmap=${id} message=${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          return null;
        }
      }),
    );
    return new Set(verdicts.filter((id): id is string => id !== null));
  }
}
