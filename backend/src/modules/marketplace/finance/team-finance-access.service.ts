import {
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import { ProjectAuthorizationService } from '../../execution/projects/authorization/project-authorization.service';
import {
  getPermission,
  type PermissionPath,
  type ProjectRole,
  resolvePermissions,
} from '../../execution/projects/permissions/project-permissions';
import { FinanceBookAccessService } from './books/finance-book-access.service';
import type { FinanceBookPermissions } from './books/finance-book-permissions';
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

/**
 * One attached project whose finance the caller may read under the
 * PROJECT-level gate (`assertProjectFinanceActor`): the gate every
 * project-scoped money surface uses — imports, the project invoice
 * workspace, invoice issuing and payments.
 */
export interface TeamProjectFinanceAccess {
  id: string;
  title: string | null;
  status: string | null;
  currency: string | null;
  /** `finance.manage_invoices`: upload/record imports, issue invoices. */
  can_manage_invoices: boolean;
}

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
    @Optional()
    private readonly bookAccess?: FinanceBookAccessService,
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
    // Two ways in: execution-team administration (owner/admin, then filtered
    // per project by `project_access`), or a finance role on the team's book
    // (owner/manager/accountant added through finance invites). A book grant
    // covers every project attached to the team, because the team book is the
    // scope that role was granted on; it never needs execution access.
    const isAdministrator = await this.isTeamAdministrator(callerId, teamId);
    const bookGranted = isAdministrator
      ? false
      : await this.hasTeamBookCapability(callerId, teamId, permission);
    if (!isAdministrator && !bookGranted) {
      throw new NotFoundException('Team finance not found');
    }

    const { data: links, error: linksError } = await this.supabase
      .from('project_teams')
      .select('project_id')
      .eq('team_id', teamId);
    if (linksError) throw new Error(linksError.message);
    const attachedIds = (links ?? []).map(
      (row: { project_id: string }) => row.project_id,
    );
    if (attachedIds.length === 0) return [];

    const visible = bookGranted
      ? new Set(attachedIds)
      : await this.financeVisibleProjectIds(callerId, attachedIds, permission);
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
   * The team's attached projects the caller passes the project-level finance
   * read gate on — exactly the set `assertProjectFinanceActor(..., 'read')`
   * admits, so a web picker built from it never offers a project whose
   * project-scoped money endpoints would then refuse.
   *
   * Deliberately NOT `listTeamProjects`: that list also admits every attached
   * project to a team finance-book role (the team book's grant), which the
   * project-scoped endpoints do not honour. A team admin who is only an
   * editor on a project therefore sees it in neither list, and a book manager
   * sees it in the team rollup but not here.
   *
   * Never refuses: for a stranger, or a team id that does not exist, the
   * answer is simply the empty list — it names only projects the caller can
   * already read, so it confirms nothing about the team.
   */
  async listProjectFinanceAccess(
    callerId: string,
    teamId: string,
  ): Promise<TeamProjectFinanceAccess[]> {
    const { data: links, error: linksError } = await this.supabase
      .from('project_teams')
      .select('project_id')
      .eq('team_id', teamId);
    if (linksError) throw new Error(linksError.message);
    const attachedIds = [
      ...new Set(
        (links ?? []).map((row: { project_id: string }) => row.project_id),
      ),
    ].filter(Boolean);
    if (attachedIds.length === 0) return [];

    const { data: accessRows, error: accessError } = await this.supabase
      .from('project_access')
      .select('project_id, role, capabilities')
      .eq('user_id', callerId)
      .in('project_id', attachedIds);
    if (accessError) throw new Error(accessError.message);

    // A caller can hold several access rows on one project (one per origin);
    // `ProjectAuthorizationService.resolvePermissions` unions them, so each
    // capability here is "any row grants it".
    const manageById = new Map<string, boolean>();
    for (const row of (accessRows ?? []) as Array<{
      project_id: string;
      role: ProjectRole;
      capabilities: Record<string, unknown> | null;
    }>) {
      const permissions = resolvePermissions(row.role, row.capabilities);
      if (!getPermission(permissions, 'finance.view')) continue;
      manageById.set(
        row.project_id,
        manageById.get(row.project_id) === true ||
          getPermission(permissions, 'finance.manage_invoices'),
      );
    }
    if (manageById.size === 0) return [];

    const { data: projects, error } = await this.supabase
      .from('projects')
      .select('id, title, status, currency')
      .in('id', [...manageById.keys()])
      .order('updated_at', { ascending: false });
    if (error) throw new Error(error.message);

    return (
      (projects ?? []) as Array<{
        id: string;
        title: string | null;
        status: string | null;
        currency: string | null;
      }>
    )
      .filter((project) => manageById.has(project.id))
      .map((project) => ({
        id: project.id,
        title: project.title,
        status: project.status,
        currency: project.currency,
        can_manage_invoices: manageById.get(project.id) === true,
      }));
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

  /**
   * Whether the caller's role on the team's finance book (kind `team`) grants
   * the book capability equivalent to `permission`. Money-in figures and
   * contracts both sit behind `view_contracts`; invoice management behind
   * `manage_money`.
   */
  private async hasTeamBookCapability(
    callerId: string,
    teamId: string,
    permission: FinanceProjectPermission,
  ): Promise<boolean> {
    if (!this.bookAccess) return false;
    const { data, error } = await this.supabase
      .from('finance_books')
      .select('id')
      .eq('kind', 'team')
      .eq('owner_team_id', teamId)
      .eq('status', 'active')
      .maybeSingle();
    if (error) throw new Error(error.message);
    const bookId = (data as { id: string } | null)?.id;
    if (!bookId) return false;

    const access = await this.bookAccess.resolveAccess(callerId, bookId);
    // Only the team-running roles. A client viewer seated on the team book
    // holds `view_contracts` for their own engagement, never the whole team's.
    if (!access || !['owner', 'manager', 'accountant'].includes(access.role)) {
      return false;
    }
    const capability: keyof FinanceBookPermissions =
      permission === 'finance.manage_invoices'
        ? 'manage_money'
        : 'view_contracts';
    return access.permissions[capability] === true;
  }

  private async isTeamAdministrator(
    callerId: string,
    teamId: string,
  ): Promise<boolean> {
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
    return Boolean(ownerResult.count || memberResult.count);
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

    const byId = new Map<
      string,
      { id: string; name: string; owner_id: string }
    >();
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
