import { Inject, Injectable, Logger } from '@nestjs/common';
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
      .from('project_shares')
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
      .from('project_shares')
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
   * Idempotent grant. Origin is part of the uniqueness contract — a
   * user can hold one direct row plus any number of team-derived rows
   * (`origin = 'team:<id>'`). Conflicts on (project_id, user_id, origin)
   * update role/capabilities/granted_by in place.
   *
   * Origin is required: callers used to pass null but the column is now
   * NOT NULL. Use 'invited' as the conventional default for direct
   * grants without a more specific source.
   */
  async grant(params: GrantParams): Promise<ProjectShare> {
    const payload = {
      project_id: params.projectId,
      user_id: params.userId,
      role: params.role,
      origin: params.origin ?? 'invited',
      capabilities: params.capabilities ?? {},
      granted_by: params.grantedBy,
    };

    const { data, error } = await this.supabase
      .from('project_shares')
      .upsert(payload, { onConflict: 'project_id,user_id,origin' })
      .select('*')
      .single();

    if (error || !data) {
      this.logger.error(
        `grant(${params.userId} on ${params.projectId}) failed: ${error?.message}`,
      );
      throw new Error(error?.message ?? 'Failed to grant project share');
    }
    return data as ProjectShare;
  }

  /**
   * Revoke a user's share(s) on a project. By default removes ALL rows
   * for that user (direct + team-derived) — matches the existing
   * "remove member from project" semantics. Pass `origin` to remove
   * only one specific row (e.g. just the direct share, leaving
   * team-derived intact). Refuses to delete the last owner row.
   */
  async revoke(
    projectId: string,
    userId: string,
    origin?: string,
  ): Promise<void> {
    const targetQuery = this.supabase
      .from('project_shares')
      .select('role, origin')
      .eq('project_id', projectId)
      .eq('user_id', userId);
    const { data: targetRows } = origin
      ? await targetQuery.eq('origin', origin)
      : await targetQuery;

    if (!targetRows || targetRows.length === 0) return;

    if (targetRows.some((r) => r.role === 'owner')) {
      const ownerCount = await this.countOwners(projectId);
      if (ownerCount <= 1) {
        throw new MissingPermissionException({
          path: null,
          message: 'Cannot remove the last owner from a project.',
          label: 'remove the last owner',
        });
      }
    }

    let delQuery = this.supabase
      .from('project_shares')
      .delete()
      .eq('project_id', projectId)
      .eq('user_id', userId);
    if (origin) delQuery = delQuery.eq('origin', origin);

    const { error } = await delQuery;
    if (error) {
      throw new Error(error.message);
    }
  }

  /**
   * Internal helper — count of owner-role rows on a project.
   */
  private async countOwners(projectId: string): Promise<number> {
    const { count, error } = await this.supabase
      .from('project_shares')
      .select('*', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .eq('role', 'owner');

    if (error) {
      throw new Error(error.message);
    }
    return count ?? 0;
  }
}
