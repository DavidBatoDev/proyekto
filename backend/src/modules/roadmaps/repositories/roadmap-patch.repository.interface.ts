import type { FullRoadmapState } from '../dto/patch-roadmap.dto';

export interface IRoadmapPatchRepository {
  upsertFullRoadmap(params: {
    roadmapId: string;
    ownerId: string;
    fullState: FullRoadmapState;
    createIfMissing?: boolean;
  }): Promise<Date | null>;
}
