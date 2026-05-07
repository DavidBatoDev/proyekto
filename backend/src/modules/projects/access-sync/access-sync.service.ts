import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import {
  PROJECT_ROLES,
  type ProjectRole,
} from '../authorization/project-authorization.service';

/**
 * Yoke rule:
 *   For every (project_id, user_id) pair, all `project_access` rows
 *   carry the same `role` and the same `capabilities`. Direct + team-
 *   derived rows are facets of one effective grant; the origin column
 *   is purely "received via" metadata.
 *
 * `project_access` is the single source of truth for both role and
 * capabilities. There are no per-origin natural sources stored
 * elsewhere: `project_team_members` is structural (no role/caps),
 * `project_teams` has no default_role. The role for a new team-derived
 * row is supplied by the application at curation time.
 *
 * `syncedRole = max(row.role)` across all rows for the user, using the
 * standard `viewer < commenter < editor < admin < owner` hierarchy.
 * Capabilities follow the same pick-largest rule. `syncUser` is
 * idempotent and safe to call from any code path that mutates a row:
 * grant/revoke direct rows, attach/detach team, curate/uncurate
 * member, manual permissions edit.
 */

interface ProjectAccessRow {
  id: string;
  project_id: string;
  user_id: string | null;
  role: ProjectRole;
  origin: string | null;
  capabilities: Record<string, unknown>;
}

@Injectable()
export class ProjectAccessSyncService {
  private readonly logger = new Logger(ProjectAccessSyncService.name);

  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
  ) {}

  /**
   * Recompute the synced role for a (project, user) and write it +
   * the existing capabilities to every row. Idempotent. Returns the
   * resulting synced role, or null if the user has no rows.
   */
  async syncUser(
    projectId: string,
    userId: string,
  ): Promise<ProjectRole | null> {
    const rows = await this.loadRows(projectId, userId);
    if (rows.length === 0) return null;

    const syncedRole = this.maxRole(rows.map((r) => r.role));
    const targetCapabilities = this.pickCapabilities(rows);

    await this.writeAllRows(rows, syncedRole, targetCapabilities);
    return syncedRole;
  }

  /**
   * Manual role edit entry point — used by the permissions page.
   * Writes the new role to every row of the user. project_access is
   * the only source of truth, so there's no separate natural source
   * to compute against.
   */
  async setUserRole(
    projectId: string,
    userId: string,
    role: ProjectRole,
  ): Promise<ProjectRole | null> {
    const rows = await this.loadRows(projectId, userId);
    if (rows.length === 0) return null;
    await this.updateRowsRole(rows, role);
    return role;
  }

  /**
   * Manual capability edit entry point. Writes the same capabilities
   * map to every row for the user. No natural-source dance — caps are
   * always applied uniformly.
   */
  async setUserCapabilities(
    projectId: string,
    userId: string,
    capabilities: Record<string, unknown>,
  ): Promise<void> {
    const rows = await this.loadRows(projectId, userId);
    if (rows.length === 0) return;
    await this.writeAllRows(
      rows,
      // Re-use the row's current role (already synced) — we're only
      // touching capabilities here.
      rows[0].role,
      capabilities,
    );
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

  // ─── internals ──────────────────────────────────────────────────────────

  private async loadRows(
    projectId: string,
    userId: string,
  ): Promise<ProjectAccessRow[]> {
    const { data, error } = await this.supabase
      .from('project_access')
      .select('id, project_id, user_id, role, origin, capabilities')
      .eq('project_id', projectId)
      .eq('user_id', userId);
    if (error) throw new Error(error.message);
    return (data ?? []) as ProjectAccessRow[];
  }

  private maxRole(roles: ProjectRole[]): ProjectRole {
    if (roles.length === 0) return 'viewer';
    return roles.reduce<ProjectRole>(
      (best, r) =>
        PROJECT_ROLES.indexOf(r) > PROJECT_ROLES.indexOf(best) ? r : best,
      'viewer',
    );
  }

  private pickCapabilities(
    rows: ProjectAccessRow[],
  ): Record<string, unknown> {
    if (rows.length === 0) return {};
    // Largest non-empty map wins; ties → direct origin first; final
    // tiebreak by row id for determinism.
    const sorted = [...rows].sort((a, b) => {
      const sizeA = Object.keys(a.capabilities ?? {}).length;
      const sizeB = Object.keys(b.capabilities ?? {}).length;
      if (sizeA !== sizeB) return sizeB - sizeA;
      const aTeam = this.isTeamOrigin(a.origin);
      const bTeam = this.isTeamOrigin(b.origin);
      if (aTeam !== bTeam) return aTeam ? 1 : -1;
      return a.id.localeCompare(b.id);
    });
    return sorted[0].capabilities ?? {};
  }

  private async writeAllRows(
    rows: ProjectAccessRow[],
    role: ProjectRole,
    capabilities: Record<string, unknown>,
  ): Promise<void> {
    // Skip rows that are already in sync to keep the noise down on
    // realtime subscribers that watch project_access.
    const drift = rows.filter(
      (r) =>
        r.role !== role ||
        !this.shallowEqual(
          (r.capabilities ?? {}) as Record<string, unknown>,
          capabilities,
        ),
    );
    if (drift.length === 0) return;

    const { error } = await this.supabase
      .from('project_access')
      .update({ role, capabilities })
      .in(
        'id',
        drift.map((r) => r.id),
      );
    if (error) {
      this.logger.error(
        `writeAllRows failed for user ${rows[0].user_id} on project ${rows[0].project_id}: ${error.message}`,
      );
      throw new Error(error.message);
    }
  }

  private async updateRowsRole(
    rows: ProjectAccessRow[],
    role: ProjectRole,
  ): Promise<void> {
    const ids = rows.map((r) => r.id);
    if (ids.length === 0) return;
    const { error } = await this.supabase
      .from('project_access')
      .update({ role })
      .in('id', ids);
    if (error) throw new Error(error.message);
  }

  private isTeamOrigin(origin: string | null): boolean {
    return Boolean(origin && origin.startsWith('team:'));
  }

  private shallowEqual(
    a: Record<string, unknown>,
    b: Record<string, unknown>,
  ): boolean {
    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);
    if (aKeys.length !== bKeys.length) return false;
    for (const k of aKeys) if (a[k] !== b[k]) return false;
    return true;
  }
}
