import { InternalServerErrorException, Logger } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Who manages a team, as plain functions over a Supabase client.
 *
 * The `common/auth/consultant-capability.ts` pattern: one definition of the
 * predicate that services, the time module and payouts share, with no Nest
 * module to import. Pass the service-role client (`SUPABASE_ADMIN`).
 *
 * A manager is the team's `owner_id`, or a `team_members` row with role
 * `owner` or `admin`. `isTeamManager` asks the database (`can_manage_team`,
 * the predicate the team-resource RLS policies and the time SQL use), so the
 * TypeScript and SQL answers cannot drift. `TeamsService.assertCanManageTeam`
 * reaches the same verdict from the same two facts and returns the role.
 *
 * Feature flags (`time_tracking_enabled`, `payouts_enabled`) and plan keys are
 * never part of this predicate; callers check them separately.
 */

const logger = new Logger('TeamAuthority');

/** The team_members roles that manage a team. Mirrors can_manage_team. */
export const TEAM_MANAGER_ROLES = ['owner', 'admin'] as const;

/** Postgres `invalid_text_representation`: a non-UUID id cast to uuid. */
const INVALID_TEXT_REPRESENTATION = '22P02';

interface DbError {
  code?: string | null;
  message: string;
}

/**
 * A lookup failure is a 500 with a fixed message. The Postgres text goes to the
 * log, never to the caller.
 */
function lookupFailed(op: string, teamId: string, error: DbError): never {
  logger.error(
    `team_authority_${op}_failed team=${teamId} code=${error.code ?? 'none'} message=${error.message}`,
  );
  throw new InternalServerErrorException("Couldn't check team access.");
}

/**
 * True when `userId` manages `teamId`: the team owner, or a member with role
 * `owner` or `admin`.
 *
 * An id that is not a UUID (a raw route parameter) is simply not a team the
 * caller manages, so it answers false rather than raising, and the caller's
 * own miss handling (a 404) applies.
 */
export async function isTeamManager(
  sb: SupabaseClient,
  teamId: string,
  userId: string,
): Promise<boolean> {
  if (!teamId || !userId) return false;
  const { data, error } = (await sb.rpc('can_manage_team', {
    p_team_id: teamId,
    p_user_id: userId,
  })) as { data: unknown; error: DbError | null };
  if (error) {
    if (error.code === INVALID_TEXT_REPRESENTATION) return false;
    lookupFailed('check', teamId, error);
  }
  return data === true;
}

/**
 * Everyone who manages `teamId`: `owner_id` plus members with role `owner` or
 * `admin`, each once, owner first. Deleted accounts (`profiles.deleted_at` set)
 * are left out, so notification fan-out never addresses a tombstone. A team
 * that does not exist has no managers.
 */
export async function teamManagerIds(
  sb: SupabaseClient,
  teamId: string,
): Promise<string[]> {
  if (!teamId) return [];
  const [teamRes, membersRes] = await Promise.all([
    sb.from('teams').select('owner_id').eq('id', teamId).maybeSingle(),
    sb
      .from('team_members')
      .select('user_id')
      .eq('team_id', teamId)
      .in('role', [...TEAM_MANAGER_ROLES])
      .order('user_id', { ascending: true }),
  ]);
  for (const res of [teamRes, membersRes]) {
    const error = res.error as DbError | null;
    if (!error) continue;
    if (error.code === INVALID_TEXT_REPRESENTATION) return [];
    lookupFailed('list', teamId, error);
  }

  const ownerId = (teamRes.data as { owner_id?: string | null } | null)
    ?.owner_id;
  const memberIds = (
    (membersRes.data as { user_id?: string | null }[] | null) ?? []
  ).map((row) => row.user_id);
  const candidates = [
    ...new Set(
      [ownerId, ...memberIds].filter(
        (id): id is string => typeof id === 'string' && id.length > 0,
      ),
    ),
  ];
  if (candidates.length === 0) return [];

  const { data: live, error: liveError } = await sb
    .from('profiles')
    .select('id')
    .in('id', candidates)
    .is('deleted_at', null);
  if (liveError) lookupFailed('profiles', teamId, liveError as DbError);

  const liveIds = new Set(
    ((live as { id: string }[] | null) ?? []).map((row) => row.id),
  );
  return candidates.filter((id) => liveIds.has(id));
}
