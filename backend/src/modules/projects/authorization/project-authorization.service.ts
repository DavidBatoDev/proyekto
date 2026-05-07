import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import {
  type PermissionPath,
  type ProjectPermissions,
  getPermission,
  resolvePermissions,
} from '../permissions/project-permissions';
import { MissingPermissionException } from './missing-permission.exception';

/**
 * Roles in descending strength order. Higher index = stronger role.
 *
 * The hierarchy is enforced in TypeScript by `compareRoles` rather than by
 * the underlying enum's storage order — the storage order in Postgres is
 * `viewer < commenter < editor < admin < owner` purely because that's the
 * order we added the values, but service code should not rely on it.
 */
export const PROJECT_ROLES = [
  'viewer',
  'commenter',
  'editor',
  'admin',
  'owner',
] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];

export interface ProjectShare {
  id: string;
  project_id: string;
  user_id: string;
  role: ProjectRole;
  origin: string | null;
  has_direct_grant?: boolean;
  capabilities: Record<string, unknown>;
  granted_by: string | null;
  granted_at: string;
}

export type ProjectShareOrigin =
  | 'client'
  | 'consultant'
  | 'invited'
  | 'personal_workspace';

interface GrantParams {
  projectId: string;
  userId: string;
  role: ProjectRole;
  origin: ProjectShareOrigin | null;
  grantedBy: string | null;
  capabilities?: Record<string, unknown>;
}

@Injectable()
export class ProjectAuthorizationService {
  private readonly logger = new Logger(ProjectAuthorizationService.name);

  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
  ) {}

  /**
   * Returns the caller's effective role on a project — the maximum
   * across all share rows (direct + any team-derived). Mirrors the SQL
   * function `get_user_project_role(uid, project)`.
   */
  async getUserProjectRole(
    callerId: string,
    projectId: string,
  ): Promise<ProjectRole | null> {
    const { data, error } = await this.supabase
      .from('project_access')
      .select('role')
      .eq('project_id', projectId)
      .eq('user_id', callerId);

    if (error) {
      this.logger.error(
        `getUserProjectRole(${callerId}, ${projectId}) failed: ${error.message}`,
      );
      throw new Error(error.message);
    }
    if (!data || data.length === 0) return null;
    return data
      .map((r) => r.role as ProjectRole)
      .reduce<ProjectRole>(
        (best, r) => (this.roleSatisfies(r, best) ? r : best),
        'viewer',
      );
  }

  /**
   * Throws ForbiddenException unless the caller has at least the minimum
   * required role on the project. The single canonical authorization check
   * for project-scoped operations.
   */
  async assertRole(
    callerId: string,
    projectId: string,
    minRole: ProjectRole,
  ): Promise<ProjectRole> {
    const role = await this.getUserProjectRole(callerId, projectId);
    if (!role || !this.roleSatisfies(role, minRole)) {
      throw new MissingPermissionException({
        path: null,
        requiredRole: minRole,
        message: role
          ? `Insufficient role on project: have '${role}', need '${minRole}' or stronger.`
          : 'You are not a member of this project.',
      });
    }
    return role;
  }

  /**
   * Pure comparison — true when `actual` is at least as strong as `required`.
   */
  roleSatisfies(actual: ProjectRole, required: ProjectRole): boolean {
    return PROJECT_ROLES.indexOf(actual) >= PROJECT_ROLES.indexOf(required);
  }

  /**
   * Load every share row the caller has on the project (one direct
   * plus any number of team-derived rows) and return the OR-union of
   * their resolved permissions. Returns null if no rows exist.
   *
   * Effective semantics: a user has permission X if any of their share
   * rows grants permission X.
   */
  async resolvePermissions(
    callerId: string,
    projectId: string,
  ): Promise<ProjectPermissions | null> {
    const { data, error } = await this.supabase
      .from('project_access')
      .select('role, origin, capabilities')
      .eq('project_id', projectId)
      .eq('user_id', callerId);

    if (error) {
      this.logger.error(
        `resolvePermissions(${callerId}, ${projectId}) failed: ${error.message}`,
      );
      throw new Error(error.message);
    }
    if (!data || data.length === 0) return null;

    let merged: ProjectPermissions | null = null;
    for (const row of data) {
      const resolved = resolvePermissions(
        row.role as ProjectRole,
        // Team-derived origins look like 'team:<uuid>' and have no
        // delta in ORIGIN_DELTAS — pass null so resolvePermissions
        // treats them as plain role baselines.
        this.normalizeOrigin(row.origin as string | null),
        (row.capabilities as Record<string, unknown> | null) ?? null,
      );
      merged = merged ? this.unionPermissions(merged, resolved) : resolved;
    }
    return merged;
  }

  private normalizeOrigin(origin: string | null): ProjectShareOrigin | null {
    if (!origin) return null;
    if (origin.startsWith('team:')) return null;
    return origin as ProjectShareOrigin;
  }

  private unionPermissions(
    a: ProjectPermissions,
    b: ProjectPermissions,
  ): ProjectPermissions {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const out: any = {};
    for (const section of Object.keys(a) as (keyof ProjectPermissions)[]) {
      const aSec = (a as any)[section] as Record<string, boolean>;
      const bSec = (b as any)[section] as Record<string, boolean>;
      out[section] = {};
      for (const field of Object.keys(aSec)) {
        out[section][field] = Boolean(aSec[field]) || Boolean(bSec[field]);
      }
    }
    return out as ProjectPermissions;
    /* eslint-enable @typescript-eslint/no-explicit-any */
  }

  /**
   * Throws ForbiddenException unless the caller has the given fine-grained
   * permission on the project. Use for capability-style checks
   * (e.g. 'roadmap.edit'); use `assertRole` for coarse role gates.
   */
  async assertPermission(
    callerId: string,
    projectId: string,
    path: PermissionPath,
  ): Promise<ProjectPermissions> {
    const perms = await this.resolvePermissions(callerId, projectId);
    if (!perms || !getPermission(perms, path)) {
      throw new MissingPermissionException({ path });
    }
    return perms;
  }

  /**
   * Peer-rank guard. Composes after the coarse capability check:
   * confirms the caller's authority strictly outranks the target's
   * for the given gate. Owner is always exempt.
   *
   * Rule:
   *   - caller === target            → DENY (defensive; callers also self-guard)
   *   - caller is project owner      → ALLOW
   *   - target also satisfies `gate` → DENY (peer protection)
   *   - otherwise                    → ALLOW
   */
  async assertActionOutranks(
    callerId: string,
    targetUserId: string,
    projectId: string,
    gate: PermissionPath,
  ): Promise<void> {
    if (callerId === targetUserId) {
      throw new ForbiddenException('You cannot target yourself.');
    }
    const callerRole = await this.getUserProjectRole(callerId, projectId);
    if (callerRole === 'owner') return;

    const targetPerms = await this.resolvePermissions(
      targetUserId,
      projectId,
    );
    if (targetPerms && getPermission(targetPerms, gate)) {
      throw new ForbiddenException(
        'This member has equal authority on this project. Only a project owner can edit or remove them.',
      );
    }
  }

  /**
   * Idempotent direct grant. project_access is keyed (project_id,
   * user_id) — one row per user. On conflict we do not demote: the
   * stored role becomes max(existing, new). Capabilities are
   * OR-unioned. `has_direct_grant` is always set true (this is a
   * direct grant). The origin label is preserved on conflict (treat
   * it as the original primary-source label).
   */
  async grant(params: GrantParams): Promise<ProjectShare> {
    const incomingRole = params.role;
    const incomingCaps = params.capabilities ?? {};

    const { data: existing, error: lookupErr } = await this.supabase
      .from('project_access')
      .select('id, role, origin, capabilities')
      .eq('project_id', params.projectId)
      .eq('user_id', params.userId)
      .maybeSingle();
    if (lookupErr) {
      this.logger.error(
        `grant lookup failed for (${params.userId}, ${params.projectId}): ${lookupErr.message}`,
      );
      throw new Error(lookupErr.message);
    }

    if (existing) {
      const stored = existing as Pick<
        ProjectShare,
        'id' | 'role' | 'origin' | 'capabilities'
      >;
      const targetRole: ProjectRole = this.roleSatisfies(
        incomingRole,
        stored.role,
      )
        ? incomingRole
        : stored.role;
      const mergedCaps = this.unionCapabilities(
        (stored.capabilities ?? {}) as Record<string, unknown>,
        incomingCaps,
      );

      const { data, error } = await this.supabase
        .from('project_access')
        .update({
          role: targetRole,
          capabilities: mergedCaps,
          has_direct_grant: true,
          granted_by: params.grantedBy,
        })
        .eq('id', stored.id)
        .select('*')
        .single();
      if (error || !data) {
        this.logger.error(
          `grant update failed for (${params.userId}, ${params.projectId}): ${error?.message}`,
        );
        throw new Error(error?.message ?? 'Failed to grant project share');
      }
      return data as ProjectShare;
    }

    const { data, error } = await this.supabase
      .from('project_access')
      .insert({
        project_id: params.projectId,
        user_id: params.userId,
        role: incomingRole,
        origin: params.origin ?? 'invited',
        capabilities: incomingCaps,
        granted_by: params.grantedBy,
        has_direct_grant: true,
      })
      .select('*')
      .single();
    if (error || !data) {
      this.logger.error(
        `grant insert failed for (${params.userId}, ${params.projectId}): ${error?.message}`,
      );
      throw new Error(error?.message ?? 'Failed to grant project share');
    }
    return data as ProjectShare;
  }

  private unionCapabilities(
    a: Record<string, unknown>,
    b: Record<string, unknown>,
  ): Record<string, unknown> {
    const out: Record<string, unknown> = { ...a };
    for (const [k, v] of Object.entries(b)) {
      if (v === true) out[k] = true;
      else if (!(k in out)) out[k] = v;
    }
    return out;
  }

  /**
   * Revoke a user's access on a project.
   *
   *   origin === undefined  → full removal. Drops project_team_members
   *                            curations and the project_access row.
   *   origin === 'team:<id>' → drop just that team's curation. Trigger
   *                            decides whether to remove the access
   *                            row (only if no other curations and no
   *                            direct grant remain).
   *   origin === <other>     → revoke the direct grant. Sets
   *                            has_direct_grant=false. If the user has
   *                            no remaining team curations, deletes
   *                            project_access.
   *
   * Refuses to delete the last owner row in any branch.
   */
  async revoke(
    projectId: string,
    userId: string,
    origin?: string,
  ): Promise<void> {
    const { data: row } = await this.supabase
      .from('project_access')
      .select('role')
      .eq('project_id', projectId)
      .eq('user_id', userId)
      .maybeSingle();
    if (!row) return;

    if (row.role === 'owner') {
      const ownerCount = await this.countOwners(projectId);
      if (ownerCount <= 1) {
        throw new MissingPermissionException({
          path: null,
          message: 'Cannot remove the last owner from a project.',
          label: 'remove the last owner',
        });
      }
    }

    if (origin && origin.startsWith('team:')) {
      const teamId = origin.slice('team:'.length);
      const { error } = await this.supabase
        .from('project_team_members')
        .delete()
        .eq('project_id', projectId)
        .eq('team_id', teamId)
        .eq('user_id', userId);
      if (error) throw new Error(error.message);
      return;
    }

    if (origin) {
      // Direct-origin revoke: drop the direct grant flag. Keep the
      // access row alive only if team curations sustain it.
      const { count } = await this.supabase
        .from('project_team_members')
        .select('*', { count: 'exact', head: true })
        .eq('project_id', projectId)
        .eq('user_id', userId);
      if ((count ?? 0) > 0) {
        const { error } = await this.supabase
          .from('project_access')
          .update({ has_direct_grant: false })
          .eq('project_id', projectId)
          .eq('user_id', userId);
        if (error) throw new Error(error.message);
        return;
      }
      const { error } = await this.supabase
        .from('project_access')
        .delete()
        .eq('project_id', projectId)
        .eq('user_id', userId);
      if (error) throw new Error(error.message);
      return;
    }

    // Full removal: drop curations + access row.
    const { error: ptmErr } = await this.supabase
      .from('project_team_members')
      .delete()
      .eq('project_id', projectId)
      .eq('user_id', userId);
    if (ptmErr) throw new Error(ptmErr.message);

    const { error } = await this.supabase
      .from('project_access')
      .delete()
      .eq('project_id', projectId)
      .eq('user_id', userId);
    if (error) throw new Error(error.message);
  }

  /**
   * Internal helper — count of owner-role rows on a project.
   */
  private async countOwners(projectId: string): Promise<number> {
    const { count, error } = await this.supabase
      .from('project_access')
      .select('*', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .eq('role', 'owner');

    if (error) {
      throw new Error(error.message);
    }
    return count ?? 0;
  }
}
