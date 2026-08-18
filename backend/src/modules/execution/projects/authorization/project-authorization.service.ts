import { ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../../config/supabase.module';
import {
  type PermissionPath,
  type ProjectPermissions,
  getPermission,
  resolvePermissions,
} from '../permissions/project-permissions';
import { isActiveConsultantEnrollment } from '../../../../common/auth/consultant-capability';
import { MissingPermissionException } from './missing-permission.exception';
import { AuditService } from '../../../shared/audit/audit.service';

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

export function roleSatisfies(
  actual: ProjectRole,
  required: ProjectRole,
): boolean {
  return PROJECT_ROLES.indexOf(actual) >= PROJECT_ROLES.indexOf(required);
}

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

/**
 * How a member came to be on a project — provenance, not a role. What they can
 * do is `role` plus `capabilities`; origin never affects that.
 *
 * `client` and `consultant` used to live here and were folded into `direct`:
 * they named positions the execution layer does not have, and a project's
 * parties belong on a contract. Rows written before that still exist as
 * `legacy`, and team-derived rows carry a `team:<id>` prefix, so readers must
 * tolerate values outside this union.
 */
export type ProjectShareOrigin = 'direct' | 'invited' | 'personal_workspace';

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
    private readonly audit: AuditService,
  ) {}

  /**
   * Whether the user currently holds the verified-consultant capability.
   *
   * Lives here rather than in ProjectsService so execution asks its own
   * authorization surface a question, instead of reaching for a marketplace
   * capability helper directly. The underlying predicate is the shared one, so
   * this and the SQL `is_active_consultant` cannot drift.
   */
  async isActiveConsultant(userId: string): Promise<boolean> {
    return isActiveConsultantEnrollment(this.supabase, userId);
  }

  /*
   * There is deliberately no `getProjectConsultantId` here.
   *
   * It read `project_access.origin = 'consultant'`, tie-breaking on
   * `has_direct_grant` then `granted_at`, and let execution-layer code ask "who is
   * the consultant on this project?". A project is the execution layer: it has
   * MEMBERS with a permissions catalog, and no notion of a client or a consultant.
   *
   * Its callers were replaced according to what they actually needed:
   *   - guards ("the consultant cannot be removed / cannot leave") — deleted; the
   *     role ladder's last-owner check protects every owner equally;
   *   - notification audiences — `listUsersWithPermission(projectId, path)`;
   *   - the invoice and contract flows, which genuinely need the delivery lead —
   *     `contracts.consultant_user_id`, which is the marketplace's own record and
   *     always exists where those flows do.
   */

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
    return roleSatisfies(actual, required);
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
        (row.capabilities as Record<string, unknown> | null) ?? null,
      );
      merged = merged ? this.unionPermissions(merged, resolved) : resolved;
    }
    return merged;
  }

  /**
   * Every user on the project who holds `path`, for fan-out — "who should be
   * told this needs a decision?".
   *
   * One query for all rows, then the pure resolution per user in process. The
   * naive alternative (list members, then `resolvePermissions` per member) is a
   * round trip per member on a surface that fans out on every write.
   *
   * Ordering is not meaningful; callers treat the result as a set.
   */
  async listUsersWithPermission(
    projectId: string,
    path: PermissionPath,
  ): Promise<string[]> {
    const { data, error } = await this.supabase
      .from('project_access')
      .select('user_id, role, origin, capabilities')
      .eq('project_id', projectId);

    if (error) {
      this.logger.error(
        `listUsersWithPermission(${projectId}, ${path}) failed: ${error.message}`,
      );
      throw new Error(error.message);
    }
    if (!data || data.length === 0) return [];

    // Union per user first, exactly as resolvePermissions does for one caller:
    // a user with several rows (a direct grant plus team-derived rows) holds a
    // permission if ANY row grants it, so testing rows individually would miss
    // whoever is only granted it through their weaker row.
    const byUser = new Map<string, ProjectPermissions>();
    for (const row of data) {
      const userId = row.user_id as string | null;
      if (!userId) continue;

      const resolved = resolvePermissions(
        row.role as ProjectRole,
        (row.capabilities as Record<string, unknown> | null) ?? null,
      );
      const existing = byUser.get(userId);
      byUser.set(
        userId,
        existing ? this.unionPermissions(existing, resolved) : resolved,
      );
    }

    const holders: string[] = [];
    for (const [userId, perms] of byUser) {
      if (getPermission(perms, path)) holders.push(userId);
    }
    return holders;
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

    const targetPerms = await this.resolvePermissions(targetUserId, projectId);
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
   * direct grant). The origin label is preserved on conflict except
   * when a consultant assignment promotes it to `consultant`.
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

      const updatePayload: Record<string, unknown> = {
        role: targetRole,
        capabilities: mergedCaps,
        has_direct_grant: true,
        granted_by: params.grantedBy,
      };
      // A re-grant deliberately leaves `origin` alone. It used to overwrite the
      // stored value when the incoming one was 'consultant' — the mechanism that
      // made that designation sticky, and the only path that rewrote provenance
      // after the fact. How somebody first joined does not change because they
      // were re-granted later.

      const { data, error } = await this.supabase
        .from('project_access')
        .update(updatePayload)
        .eq('id', stored.id)
        .select('*')
        .single();
      if (error || !data) {
        this.logger.error(
          `grant update failed for (${params.userId}, ${params.projectId}): ${error?.message}`,
        );
        throw new Error(error?.message ?? 'Failed to grant project share');
      }
      this.audit.log({
        projectId: params.projectId,
        actorId: params.grantedBy,
        action: 'access.granted',
        entityType: 'project_access',
        entityId: (data as ProjectShare).id,
        metadata: {
          target_user_id: params.userId,
          role: targetRole,
          origin: params.origin ?? null,
        },
      });
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
    this.audit.log({
      projectId: params.projectId,
      actorId: params.grantedBy,
      action: 'access.granted',
      entityType: 'project_access',
      entityId: (data as ProjectShare).id,
      metadata: {
        target_user_id: params.userId,
        role: incomingRole,
        origin: params.origin ?? null,
      },
    });
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
   * Refuses to delete the last owner row in any branch. That is the only
   * protection: there is no separate "the consultant is unremovable" rule, so an
   * owner is an owner whoever they are.
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

    // There used to be a guard here refusing to remove "the consultant", found by
    // reading project_access.origin. A project is the execution layer: it has
    // members with permissions, so it cannot know who the consultant is. The rung
    // is what protects the project — the last-owner check below — and it protects
    // every owner equally rather than one labelled person.
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

    // Past both guards the revoke will proceed; record it for the audit trail.
    this.audit.log({
      projectId,
      actorId: null,
      action: 'access.revoked',
      entityType: 'project_access',
      entityId: null,
      metadata: {
        target_user_id: userId,
        origin: origin ?? 'direct',
        role: row.role,
      },
    });

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
