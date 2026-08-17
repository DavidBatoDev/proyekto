import { CreateFeatureDependencyDto } from '../dto/roadmaps.dto';

export interface FeatureDependencyRow {
  id: string;
  roadmap_id: string;
  blocking_feature_id: string;
  blocked_feature_id: string;
  dependency_type: string;
  lag_days: number;
  created_by: string | null;
  created_at: string;
}

export interface IFeatureDependenciesRepository {
  /** Every edge in a roadmap. The Gantt needs the whole set at once. */
  listForRoadmap(roadmapId: string): Promise<FeatureDependencyRow[]>;
  findById(dependencyId: string): Promise<FeatureDependencyRow | null>;
  /**
   * Ids of the given features that actually belong to the roadmap. The service
   * uses this to reject cross-roadmap edges before the trigger has to.
   */
  findFeatureIdsInRoadmap(
    roadmapId: string,
    featureIds: string[],
  ): Promise<string[]>;
  create(
    roadmapId: string,
    dto: CreateFeatureDependencyDto,
    userId: string,
  ): Promise<FeatureDependencyRow>;
  remove(dependencyId: string): Promise<void>;
}
