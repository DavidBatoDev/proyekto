import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import { type ProjectRole } from '../authorization/project-authorization.service';

/**
 * Single-row world: project_access has one row per (project_id,
 * user_id). The "yoke" reconciliation that used to span multiple rows
 * is now a no-op — there's nothing to reconcile. This service is a
 * thin wrapper that callers in the codebase still invoke; it exists
 * so we can rip it out in a follow-up commit without touching every
 * call site here.
 *
 * The lifecycle of the access row is:
 *   - Direct grant → has_direct_grant = true.
 *   - Team curation only → has_direct_grant = false; row is sustained
 *     by at least one project_team_members row for the pair.
 *   - When neither holds, the row is deleted (trigger or explicit).
 */
@Injectable()
export class ProjectAccessSyncService {
  private readonly logger = new Logger(ProjectAccessSyncService.name);

  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
  ) {}

  /**
   * Returns the user's current role on the project, or null if they
   * have no row. Compatibility shim for callers that still invoke
   * syncUser after a structural change.
   */
  async syncUser(
    projectId: string,
    userId: string,
  ): Promise<ProjectRole | null> {
    const { data, error } = await this.supabase
      .from('project_access')
      .select('role')
      .eq('project_id', projectId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data?.role ?? null) as ProjectRole | null;
  }

  /** Manual role edit. Writes the role to the single row. */
  async setUserRole(
    projectId: string,
    userId: string,
    role: ProjectRole,
  ): Promise<ProjectRole | null> {
    const { data, error } = await this.supabase
      .from('project_access')
      .update({ role })
      .eq('project_id', projectId)
      .eq('user_id', userId)
      .select('role')
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data?.role ?? null) as ProjectRole | null;
  }

  /** Manual capability edit. Writes the map to the single row. */
  async setUserCapabilities(
    projectId: string,
    userId: string,
    capabilities: Record<string, unknown>,
  ): Promise<void> {
    const { error } = await this.supabase
      .from('project_access')
      .update({ capabilities })
      .eq('project_id', projectId)
      .eq('user_id', userId);
    if (error) throw new Error(error.message);
  }

  /**
   * Convenience wrapper: resolve the user from a single row id, then
   * delegate. Used by `updateMemberPermissions` which still takes a
   * memberId on the wire for backwards compat.
   */
  async setUserCapabilitiesByMemberId(
    projectId: string,
    memberId: string,
    capabilities: Record<string, unknown>,
  ): Promise<string | null> {
    const { data, error } = await this.supabase
      .from('project_access')
      .select('user_id')
      .eq('id', memberId)
      .eq('project_id', projectId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data?.user_id) return null;
    await this.setUserCapabilities(projectId, data.user_id, capabilities);
    return data.user_id as string;
  }
}
