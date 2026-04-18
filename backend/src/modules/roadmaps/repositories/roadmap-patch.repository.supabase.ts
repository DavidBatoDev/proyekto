import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import type { IRoadmapPatchRepository } from './roadmap-patch.repository.interface';
import type { FullRoadmapState } from '../dto/patch-roadmap.dto';

@Injectable()
export class RoadmapPatchRepositorySupabase implements IRoadmapPatchRepository {
  private readonly logger = new Logger(RoadmapPatchRepositorySupabase.name);

  constructor(@Inject(SUPABASE_ADMIN) private readonly db: SupabaseClient) {}

  async upsertFullRoadmap(params: {
    roadmapId: string;
    ownerId: string;
    fullState: FullRoadmapState;
    createIfMissing?: boolean;
  }): Promise<Date | null> {
    const { roadmapId, ownerId, fullState, createIfMissing = false } = params;

    const { data, error } = await this.db.rpc('upsert_full_roadmap', {
      p_roadmap_id: roadmapId,
      p_owner_id: ownerId,
      p_full_state: fullState,
      p_create_if_missing: createIfMissing,
    });

    if (!error) return data ? new Date(data as string) : null;

    this.logger.error(
      [
        'event=roadmap_patch_upsert_failed',
        `roadmap_id=${roadmapId}`,
        `owner_id=${ownerId}`,
        `create_if_missing=${createIfMissing}`,
        `error_code=${error.code ?? 'unknown'}`,
        `error_message=${error.message ?? 'unknown'}`,
      ].join(' '),
    );

    if (error.code === 'P0001') {
      throw new BadRequestException(error.message);
    }

    throw new InternalServerErrorException(error.message);
  }
}
