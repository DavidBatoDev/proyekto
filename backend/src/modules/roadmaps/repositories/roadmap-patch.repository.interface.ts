import type { FullRoadmapState } from '../dto/patch-roadmap.dto';

export interface IRoadmapPatchRepository {
  upsertFullRoadmap(params: {
    roadmapId: string;
    ownerId: string;
    fullState: FullRoadmapState;
    createIfMissing?: boolean;
    /**
     * Opt-in optimistic-concurrency baseline. When provided, the RPC only
     * updates the roadmap if its `updated_at` still equals this value, else it
     * raises STALE_REVISION (mapped to a 409 ConflictException). Closes the
     * read-then-write race in the AI commit path.
     */
    expectedUpdatedAt?: string;
  }): Promise<Date | null>;
}
