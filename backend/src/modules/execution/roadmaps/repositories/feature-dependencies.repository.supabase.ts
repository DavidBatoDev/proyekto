import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../../config/supabase.module';
import { CreateFeatureDependencyDto } from '../dto/roadmaps.dto';
import {
  FeatureDependencyRow,
  IFeatureDependenciesRepository,
} from './feature-dependencies.repository.interface';

/** Shape of an untyped supabase-js response, so results can be destructured safely. */
interface SupabaseResult<T> {
  data: T;
  error: { message: string } | null;
}

const EDGE_SELECT =
  '*, blocking_feature:roadmap_features!blocking_feature_id(id, title, start_date, end_date), blocked_feature:roadmap_features!blocked_feature_id(id, title, start_date, end_date)';

/**
 * Postgres surfaces the table's invariants as error codes. Translate them here,
 * where the raw error still exists, into exceptions the client can act on —
 * otherwise a duplicate link or a cycle reaches the user as an opaque 500.
 * The messages mirror the RAISE strings in
 * 20260817022000_feature_dependencies_roadmap_scope.sql.
 */
function translateWriteError(message: string): Error {
  if (message.includes('feature_dependency_cycle')) {
    return new ConflictException(
      'That link would create a circular dependency',
    );
  }
  if (message.includes('feature_dependency_cross_roadmap')) {
    return new BadRequestException(
      'Both features must belong to the same roadmap',
    );
  }
  if (
    message.includes('feature_dependencies_unique') ||
    message.includes('duplicate key')
  ) {
    return new ConflictException('These features are already linked');
  }
  if (message.includes('feature_dependencies_lag_bounds')) {
    return new BadRequestException('Lag must be between -365 and 365 days');
  }
  // The table's own self-link CHECK has no name in the message, so it lands here.
  if (message.includes('violates check constraint')) {
    return new BadRequestException('A feature cannot depend on itself');
  }
  return new Error(message);
}

@Injectable()
export class FeatureDependenciesRepositorySupabase implements IFeatureDependenciesRepository {
  constructor(@Inject(SUPABASE_ADMIN) private readonly db: SupabaseClient) {}

  async listForRoadmap(roadmapId: string): Promise<FeatureDependencyRow[]> {
    const { data, error } = await this.db
      .from('feature_dependencies')
      .select(EDGE_SELECT)
      .eq('roadmap_id', roadmapId)
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as FeatureDependencyRow[];
  }

  async findById(dependencyId: string): Promise<FeatureDependencyRow | null> {
    // Typed at the boundary: the untyped Supabase client hands back `any`, and
    // destructuring it directly is an unsafe-assignment lint error.
    const { data, error } = (await this.db
      .from('feature_dependencies')
      .select('*')
      .eq('id', dependencyId)
      .maybeSingle()) as SupabaseResult<FeatureDependencyRow | null>;
    if (error) throw new Error(error.message);
    return data ?? null;
  }

  async findFeatureIdsInRoadmap(
    roadmapId: string,
    featureIds: string[],
  ): Promise<string[]> {
    const { data, error } = await this.db
      .from('roadmap_features')
      .select('id')
      .eq('roadmap_id', roadmapId)
      .in('id', featureIds);
    if (error) throw new Error(error.message);
    return ((data ?? []) as { id: string }[]).map((row) => row.id);
  }

  async create(
    roadmapId: string,
    dto: CreateFeatureDependencyDto,
    userId: string,
  ): Promise<FeatureDependencyRow> {
    const { data, error } = (await this.db
      .from('feature_dependencies')
      .insert({
        roadmap_id: roadmapId,
        blocking_feature_id: dto.blocking_feature_id,
        blocked_feature_id: dto.blocked_feature_id,
        dependency_type: dto.dependency_type ?? 'FS',
        lag_days: dto.lag_days ?? 0,
        created_by: userId,
      })
      .select(EDGE_SELECT)
      .single()) as SupabaseResult<FeatureDependencyRow>;
    if (error) throw translateWriteError(error.message);
    return data;
  }

  async remove(dependencyId: string): Promise<void> {
    const { error } = await this.db
      .from('feature_dependencies')
      .delete()
      .eq('id', dependencyId);
    if (error) throw new Error(error.message);
  }
}
