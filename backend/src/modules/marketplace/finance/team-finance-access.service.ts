import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import { ProjectAuthorizationService } from '../../execution/projects/authorization/project-authorization.service';
import {
  getPermission,
  type PermissionPath,
  type ProjectRole,
  resolvePermissions,
} from '../../execution/projects/permissions/project-permissions';
import {
  ConsultantFinanceAccessService,
  ConsultantFinanceProject,
} from './consultant-finance-access.service';

/**
 * The finance capabilities a team surface can be scoped by. Narrower than
 * `PermissionPath` so a caller cannot scope a money listing by, say, a
 * delivery permission.
 */
export type FinanceProjectPermission = Extract<
  PermissionPath,
  'finance.view' | 'finance.view_contracts' | 'finance.manage_invoices'
>;

export interface AdministeredTeam {
  id: string;
  name: string;
  owner_id: string;
  /** Attached projects the caller can see finance for. */
  project_count: number;
}

/**
 * Which projects' money a TEAM administrator may see.
 *
 * The deliberate sibling of `ConsultantFinanceAccessService`, not a widening of
 * it (see the design note there): the consultant service answers "is this the
 * consultant's own book of business" (verified consultant AND project owner),
 * while this one answers "is this caller the team's HR" — team owner or team
 * admin, seeing each attached project only when their own `project_access` row
 * resolves `finance.view`. Neither condition mentions the consultant persona:
 * a project admin runs team finance without ever being a marketplace
 * consultant, which is the whole reason this service exists.
 *
 * It also carries `assertProjectFinanceActor`, the either/or facade the invoice
 * lifecycle uses: the old strict rule OR the `finance.*` capability. Because
 * every finance service runs on the service-role client, whatever these
 * predicates say IS the security boundary — RLS never backstops them.
 */
@Injectable()
export class TeamFinanceAccessService {
  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
    private readonly projectAuth: ProjectAuthorizationService,
    private readonly consultantAccess: ConsultantFinanceAccessService,
  ) {}

  /** Teams where the caller is the owner or a team admin, for the sidebar. */
  async listAdministeredTeams(callerId: string): Promise<AdministeredTeam[]> {
    const teams = await this.fetchAdministeredTeams(callerId);
    if (teams.length === 0) return [];

    const { data: links, error: linksError } = await this.supabase
      .from('project_teams')
      .select('team_id, project_id')
      .in(
        'team_id',
        teams.map((team) => team.id),
      );
    if (linksError) throw new Error(linksError.message);
    const linkRows = (links ?? []) as Array<{
      team_id: string;
      project_id: string;
    }>;

    const visible = await this.financeVisibleProjectIds(
      callerId,
      linkRows.map((row) => row.project_id),
    );

    return teams.map((team) => ({
      ...team,
      project_count: linkRows.filter(
        (row) => row.team_id === team.id && visible.has(row.project_id),
      ).length,
    }));
  }

  /**
   * The team's attached projects whose finance the caller may see. Throws
   * NotFound when the caller does not administer the team at all — the same
   * shape a wrong team id produces, so the response does not confirm the
   * team exists.
   */
  async listTeamProjects(
    callerId: string,
    teamId: string,
    filters: {
      q?: string;
      project_id?: string;
      project_status?: string;
      currency?: string;
    } = {},
    permission: FinanceProjectPermission = 'finance.view',
  ): Promise<ConsultantFinanceProject[]> {
    await this.assertTeamAdministrator(callerId, teamId);

    const { data: links, error: linksError } = await this.supabase
      .from('project_teams')
      .select('project_id')
      .eq('team_id', teamId);
    if (linksError) throw new Error(linksError.message);
    const attachedIds = (links ?? []).map(
      (row: { project_id: string }) => row.project_id,
    );
    if (attachedIds.length === 0) return [];

    const visible = await this.financeVisibleProjectIds(
      callerId,
      attachedIds,
      permission,
    );
    if (visible.size === 0) return [];

    let query = this.supabase
      .from('projects')
      .select('id, title, status, currency, owner_id, created_at')
      .in('id', [...visible])
      .order('updated_at', { ascending: false });

    if (filters.project_id) query = query.eq('id', filters.project_id);
    if (filters.project_status) {
      query = query.eq('status', filters.project_status);
    }
    if (filters.currency) {
      query = query.eq('currency', filters.currency.toUpperCase());
    }
    if (filters.q?.trim()) {
      const term = filters.q.trim().replace(/[%_]/g, '');
      query = query.ilike('title', `%${term}%`);
    }

    const { data: projects, error } = await query;
    if (error) throw new Error(error.message);
    return (projects ?? []) as ConsultantFinanceProject[];
  }

  /**
   * The invoice lifecycle's gate: the strict consultant+owner rule OR the
   * project `finance.*` capability. Reads require `finance.view`, mutations
   * `finance.manage_invoices` (granted at the admin rung by default).
   */
  async assertProjectFinanceActor(
    callerId: string,
    projectId: string,
    action: 'read' | 'manage',
  ): Promise<ConsultantFinanceProject> {
    try {
      return await this.consultantAccess.assertProject(callerId, projectId);
    } catch {
      // Fall through to the capability branch.
    }

    const path: PermissionPath =
      action === 'read' ? 'finance.view' : 'finance.manage_invoices';
    await this.projectAuth.assertPermission(callerId, projectId, path);

    const { data: project, error } = await this.supabase
      .from('projects')
      .select('id, title, status, currency, owner_id, created_at')
      .eq('id', projectId)
      .maybeSingle();
    if (error || !project) {
      throw new NotFoundException('Finance project not found');
    }
    return project as ConsultantFinanceProject;
  }

  private async assertTeamAdministrator(
    callerId: string,
    teamId: string,
  ): Promise<void> {
    const [ownerResult, memberResult] = await Promise.all([
      this.supabase
        .from('teams')
        .select('id', { count: 'exact', head: true })
        .eq('id', teamId)
        .eq('owner_id', callerId),
      this.supabase
        .from('team_members')
        .select('id', { count: 'exact', head: true })
        .eq('team_id', teamId)
        .eq('user_id', callerId)
        .eq('role', 'admin'),
    ]);
    if (ownerResult.error) throw new Error(ownerResult.error.message);
    if (memberResult.error) throw new Error(memberResult.error.message);
    if (!ownerResult.count && !memberResult.count) {
      throw new NotFoundException('Team finance not found');
    }
  }

  private async fetchAdministeredTeams(
    callerId: string,
  ): Promise<Array<{ id: string; name: string; owner_id: string }>> {
    const [ownedResult, adminResult] = await Promise.all([
      this.supabase
        .from('teams')
        .select('id, name, owner_id')
        .eq('owner_id', callerId),
      this.supabase
        .from('team_members')
        .select('team:teams(id, name, owner_id)')
        .eq('user_id', callerId)
        .eq('role', 'admin'),
    ]);
    if (ownedResult.error) throw new Error(ownedResult.error.message);
    if (adminResult.error) throw new Error(adminResult.error.message);

    const byId = new Map<string, { id: string; name: string; owner_id: string }>();
    for (const team of (ownedResult.data ?? []) as Array<{
      id: string;
      name: string;
      owner_id: string;
    }>) {
      byId.set(team.id, team);
    }
    for (const row of (adminResult.data ?? []) as unknown as Array<{
      team: { id: string; name: string; owner_id: string } | null;
    }>) {
      if (row.team) byId.set(row.team.id, row.team);
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Of `projectIds`, the ones whose caller-side `project_access` row resolves
   * `permission`. One query and the pure resolver — never a per-project assert
   * loop.
   *
   * Parameterised rather than fixed on `finance.view` because the contract
   * surface has its own capability: `finance.view_contracts` implies
   * `finance.view` but can be denied on its own, and a team-wide listing that
   * only asked for `finance.view` handed contract fees and counterparty names
   * to a member that deny was meant to stop — while the single-project route
   * (`ContractsService.listByProject`) refused them.
   */
  private async financeVisibleProjectIds(
    callerId: string,
    projectIds: string[],
    permission: FinanceProjectPermission = 'finance.view',
  ): Promise<Set<string>> {
    const unique = [...new Set(projectIds)].filter(Boolean);
    if (unique.length === 0) return new Set();

    const { data, error } = await this.supabase
      .from('project_access')
      .select('project_id, role, capabilities')
      .eq('user_id', callerId)
      .in('project_id', unique);
    if (error) throw new Error(error.message);

    const visible = new Set<string>();
    for (const row of (data ?? []) as Array<{
      project_id: string;
      role: ProjectRole;
      capabilities: Record<string, unknown> | null;
    }>) {
      const permissions = resolvePermissions(row.role, row.capabilities);
      if (getPermission(permissions, permission)) {
        visible.add(row.project_id);
      }
    }
    return visible;
  }
}
