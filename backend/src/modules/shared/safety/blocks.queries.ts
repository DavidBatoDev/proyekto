import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Of `candidateIds`, the people who have blocked `blockedId`.
 *
 * The one query behind "don't notify someone about a person they blocked",
 * shared by chat (BlocksService) and roadmap comments
 * (RoadmapAuthorizationService.filterUsersWhoCanViewRoadmap). Fails OPEN: a
 * probe error returns no blockers, so a transient failure costs one unwanted
 * notification rather than silencing everyone's.
 */
export async function findBlockerIds(
  db: SupabaseClient,
  blockedId: string,
  candidateIds: string[],
): Promise<Set<string>> {
  const unique = Array.from(new Set(candidateIds)).filter(
    (id) => id && id !== blockedId,
  );
  if (unique.length === 0) return new Set();

  const { data, error } = await db
    .from('user_blocks')
    .select('blocker_id')
    .eq('blocked_id', blockedId)
    .in('blocker_id', unique);
  if (error || !data) return new Set();

  return new Set(
    data
      .map((row) => (row as { blocker_id?: string | null }).blocker_id)
      .filter((id): id is string => Boolean(id)),
  );
}
