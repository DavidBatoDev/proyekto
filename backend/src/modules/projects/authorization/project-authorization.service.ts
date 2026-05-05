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
   * Returns the user's role on a project, or null if no grant exists.
   * Mirrors the SQL function `get_user_project_role(uid, project)` so the
   * TS layer and RLS layer always agree.
   */
  async getUserProjectRole(
    callerId: string,
    projectId: string,
  ): Promise<ProjectRole | null> {
    const { data, error } = await this.supabase
      .from('project_shares')
      .select('role')
      .eq('project_id', projectId)
      .eq('user_id', callerId)
      .maybeSingle();

    if (error) {
      this.logger.error(
        `getUserProjectRole(${callerId}, ${projectId}) failed: ${error.message}`,
      );
      throw new Error(error.message);
    }
    return (data?.role as ProjectRole | undefined) ?? null;
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
      throw new ForbiddenException(
        role
          ? `Insufficient role on project: have '${role}', need '${minRole}' or stronger`
          : 'No access to this project',
      );
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
   * Load the caller's share row and return their resolved fine-grained
   * permissions on the project (role baseline + origin delta + capabilities).
   * Returns null if no share row exists.
   */
  async resolvePermissions(
    callerId: string,
    projectId: string,
  ): Promise<ProjectPermissions | null> {
    const { data, error } = await this.supabase
      .from('project_shares')
      .select('role, origin, capabilities')
      .eq('project_id', projectId)
      .eq('user_id', callerId)
      .maybeSingle();

    if (error) {
      this.logger.error(
        `resolvePermissions(${callerId}, ${projectId}) failed: ${error.message}`,
      );
      throw new Error(error.message);
    }
    if (!data) return null;
    return resolvePermissions(
      data.role as ProjectRole,
      (data.origin as ProjectShareOrigin | null) ?? null,
      (data.capabilities as Record<string, unknown> | null) ?? null,
    );
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
      throw new ForbiddenException(
        `Missing required permission '${path}' on this project`,
      );
    }
    return perms;
  }

  /**
   * Idempotent grant. If a share row exists for (projectId, userId), updates
   * its role + origin + capabilities; otherwise inserts a new row.
   */
  async grant(params: GrantParams): Promise<ProjectShare> {
    const payload = {
      project_id: params.projectId,
      user_id: params.userId,
      role: params.role,
      origin: params.origin,
      capabilities: params.capabilities ?? {},
      granted_by: params.grantedBy,
    };

    const { data, error } = await this.supabase
      .from('project_shares')
      .upsert(payload, { onConflict: 'project_id,user_id' })
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
   * Revoke a user's share on a project. Refuses to delete the row if it
   * would leave the project ownerless (last-owner protection).
   */
  async revoke(projectId: string, userId: string): Promise<void> {
    const { data: targetRow } = await this.supabase
      .from('project_shares')
      .select('role')
      .eq('project_id', projectId)
      .eq('user_id', userId)
      .maybeSingle();

    if (!targetRow) return; // already gone, nothing to do

    if (targetRow.role === 'owner') {
      const ownerCount = await this.countOwners(projectId);
      if (ownerCount <= 1) {
        throw new ForbiddenException(
          'Cannot remove the last owner from a project',
        );
      }
    }

    const { error } = await this.supabase
      .from('project_shares')
      .delete()
      .eq('project_id', projectId)
      .eq('user_id', userId);

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
