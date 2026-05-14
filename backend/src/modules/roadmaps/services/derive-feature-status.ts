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
