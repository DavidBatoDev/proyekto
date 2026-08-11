import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../../config/supabase.module';

type TaskLike = { status?: string | null };

export type DerivedFeatureStatus =
  | 'not_started'
  | 'in_progress'
  | 'in_review'
  | 'completed'
  | 'blocked';

export function deriveFeatureStatus(
  tasks: ReadonlyArray<TaskLike> | null | undefined,
): DerivedFeatureStatus {
  const list = tasks ?? [];
  if (list.length === 0) return 'not_started';
  if (list.some((t) => t.status === 'blocked')) return 'blocked';
  if (list.every((t) => t.status === 'done')) return 'completed';
  if (list.every((t) => t.status === 'todo' || !t.status)) return 'not_started';
  if (
    list.every((t) => t.status === 'in_review' || t.status === 'done') &&
    list.some((t) => t.status === 'in_review')
  ) {
    return 'in_review';
  }
  return 'in_progress';
}

/**
 * Keeps `roadmap_features.status` authoritative. Called after every task
 * mutation that could change a feature's cascade-derived status. A feature
 * with zero tasks is left untouched here — its status is user-set (see
 * FeaturesService), and a task-delete-to-zero shouldn't clobber that value.
 */
@Injectable()
export class FeatureStatusSyncService {
  constructor(@Inject(SUPABASE_ADMIN) private readonly db: SupabaseClient) {}

  async syncAfterTaskChange(
    featureId: string | null | undefined,
  ): Promise<void> {
    if (!featureId) return;

    const { data: tasks, error } = await this.db
      .from('roadmap_tasks')
      .select('status')
      .eq('feature_id', featureId);
    if (error) throw new Error(error.message);
    if (!tasks?.length) return;

    const status = deriveFeatureStatus(tasks);
    const { error: updateError } = await this.db
      .from('roadmap_features')
      .update({ status })
      .eq('id', featureId);
    if (updateError) throw new Error(updateError.message);
  }
}
