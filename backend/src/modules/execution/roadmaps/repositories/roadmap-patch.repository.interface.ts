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
    /**
     * The user performing the write. Recorded as
     * `roadmap_task_assignees.assigned_by` for every join row the RPC creates;
     * the RPC falls back to the roadmap owner when omitted.
     */
    actorId?: string;
  }): Promise<Date | null>;
}
