import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import { ProjectAuthorizationService } from '../../execution/projects/authorization/project-authorization.service';
import { ProjectsService } from '../../execution/projects/projects.service';
import { ProjectTeamsService } from '../../execution/teams/project-teams.service';
import { FinanceBooksService } from '../finance/books/finance-books.service';
import type { SetUpEngagementProjectDto } from './dto/engagements.dto';

interface EngagementContext {
  engagementId: string;
  scopeMode: string;
  contract: {
    id: string;
    project_id: string | null;
    project_title_snapshot: string | null;
    currency: string | null;
  } | null;
  /** The team the consultant's seat signed on behalf of, if any. */
  team: { id: string; name: string } | null;
  counterpartyName: string | null;
  activeProjectIds: string[];
}

export interface EngagementProjectDefaults {
  title: string;
  currency: string | null;
  team: { id: string; name: string } | null;
  /** Teams the consultant owns — offered when the seat names none. */
  owned_teams: Array<{ id: string; name: string }>;
  /** Projects already covered by this engagement. */
  linked_project_ids: string[];
  /** Projects the consultant owns that could be linked instead. */
  candidates: Array<{
    id: string;
    title: string;
    team_attached: boolean;
  }>;
}

export interface EngagementProjectResult {
  project_id: string;
  project_title: string;
  team_id: string;
  /** The project's finance book, when the team has a book to open it under. */
  finance_book_id: string | null;
  team_book_exists: boolean;
}

/**
 * The step after signing: put a client engagement to work on a project.
 *
 * The consultant seat either creates a project under the team its contract
 * was signed for, or links one it already owns; the team is attached to the
 * project, the engagement gains an `operational_assignment` link to it, and —
 * when the team keeps finance books — the project's book opens under the team
 * book. Nothing here grants the client (or anyone) project access: that stays
 * advisory, per docs/14-engagement/action-surface.md.
 *
 * Only client-services engagements: a talent engagement is placed on work by
 * assignment, not by creating the project it works on.
 */
@Injectable()
export class EngagementProjectService {
  private readonly logger = new Logger(EngagementProjectService.name);

  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
    private readonly projects: ProjectsService,
    private readonly projectTeams: ProjectTeamsService,
    private readonly projectAuth: ProjectAuthorizationService,
    private readonly financeBooks: FinanceBooksService,
  ) {}

  async defaults(
    callerId: string,
    engagementId: string,
  ): Promise<EngagementProjectDefaults> {
    const context = await this.context(callerId, engagementId);
    const owned = await this.ownedTeams(callerId);

    const { data, error } = await this.supabase
      .from('project_access')
      .select('project:projects(id, title)')
      .eq('user_id', callerId)
      .eq('role', 'owner');
    if (error) throw new Error(error.message);
    const projects = ((data ?? []) as unknown as Array<{
      project: { id: string; title: string } | null;
    }>)
      .map((row) => row.project)
      .filter((project): project is { id: string; title: string } =>
        Boolean(project),
      )
      .filter((project) => !context.activeProjectIds.includes(project.id));

    let attached = new Set<string>();
    if (context.team && projects.length > 0) {
      const { data: links } = await this.supabase
        .from('project_teams')
        .select('project_id')
        .eq('team_id', context.team.id)
        .in(
          'project_id',
          projects.map((project) => project.id),
        );
      attached = new Set(
        ((links ?? []) as Array<{ project_id: string }>).map(
          (link) => link.project_id,
        ),
      );
    }

    return {
      title:
        context.contract?.project_title_snapshot ??
        (context.counterpartyName
          ? `${context.counterpartyName} — project`
          : 'New project'),
      currency: context.contract?.currency ?? null,
      team: context.team,
      owned_teams: owned,
      linked_project_ids: context.activeProjectIds,
      candidates: projects
        .map((project) => ({
          ...project,
          team_attached: attached.has(project.id),
        }))
        // The team's own projects first: linking one is the common case.
        .sort((a, b) => Number(b.team_attached) - Number(a.team_attached)),
    };
  }

  async setUp(
    callerId: string,
    engagementId: string,
    dto: SetUpEngagementProjectDto,
  ): Promise<EngagementProjectResult> {
    const context = await this.context(callerId, engagementId);
    if (context.scopeMode === 'project_specific') {
      throw new BadRequestException(
        'This engagement is already scoped to its contract’s project.',
      );
    }

    const team = await this.resolveTeam(callerId, context, dto.team_id);

    let projectId: string;
    let projectTitle: string;
    if (dto.mode === 'create') {
      const title = dto.title?.trim();
      if (!title) throw new BadRequestException('Name the project.');
      const created = await this.projects.createProject(callerId, {
        title,
        creation_mode: 'consultant',
        currency: dto.currency ?? context.contract?.currency ?? undefined,
        workspace_id: dto.workspace_id,
        primary_team_id: team.id,
      } as never);
      projectId = created.project.id;
      projectTitle = created.project.title;
    } else {
      if (!dto.project_id) throw new BadRequestException('Choose a project.');
      const role = await this.projectAuth.getUserProjectRole(
        callerId,
        dto.project_id,
      );
      if (role !== 'owner') throw new NotFoundException('Project not found');
      const { data: project, error } = await this.supabase
        .from('projects')
        .select('id, title')
        .eq('id', dto.project_id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!project) throw new NotFoundException('Project not found');
      projectId = (project as { id: string }).id;
      projectTitle = (project as { title: string }).title;
    }

    // createProject treats a failed team attach as non-fatal; here the team
    // IS the point, so make sure it landed (and attach it when linking).
    await this.ensureTeamAttached(callerId, projectId, team.id);
    await this.linkEngagement(callerId, engagementId, projectId, projectTitle);
    const books = await this.openFinanceBook(callerId, team.id, projectId);

    return {
      project_id: projectId,
      project_title: projectTitle,
      team_id: team.id,
      ...books,
    };
  }

  /**
   * The caller's consultant seat on an active client engagement, with what
   * the project step needs. Not a party (or the wrong seat): 404, so the
   * endpoint cannot probe engagement ids.
   */
  private async context(
    callerId: string,
    engagementId: string,
  ): Promise<EngagementContext> {
    const { data: seat, error: seatError } = await this.supabase
      .from('engagement_parties')
      .select('position, capacity, team_id, team_name_snapshot')
      .eq('engagement_id', engagementId)
      .eq('user_id', callerId)
      .maybeSingle();
    if (seatError) throw new Error(seatError.message);
    const party = seat as {
      position: string;
      capacity: string;
      team_id: string | null;
      team_name_snapshot: string | null;
    } | null;
    if (!party || party.capacity !== 'consultant') {
      throw new NotFoundException('Engagement not found');
    }

    const { data: engagement, error } = await this.supabase
      .from('engagements')
      .select('id, kind, scope_mode, status, activated_by_contract_id')
      .eq('id', engagementId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const row = engagement as {
      id: string;
      kind: string;
      scope_mode: string;
      status: string;
      activated_by_contract_id: string | null;
    } | null;
    if (!row) throw new NotFoundException('Engagement not found');
    if (row.kind !== 'client_services') {
      throw new BadRequestException(
        'Only a client engagement sets up a project.',
      );
    }
    if (row.status !== 'active') {
      throw new BadRequestException('This engagement is no longer active.');
    }

    const [{ data: contract }, { data: counterparty }, { data: links }] =
      await Promise.all([
        row.activated_by_contract_id
          ? this.supabase
              .from('contracts')
              .select('id, project_id, project_title_snapshot, currency')
              .eq('id', row.activated_by_contract_id)
              .maybeSingle()
          : Promise.resolve({ data: null }),
        this.supabase
          .from('engagement_parties')
          .select('display_name_snapshot')
          .eq('engagement_id', engagementId)
          .neq('user_id', callerId)
          .maybeSingle(),
        this.supabase
          .from('engagement_project_links')
          .select('project_id')
          .eq('engagement_id', engagementId)
          .eq('status', 'active'),
      ]);

    return {
      engagementId,
      scopeMode: row.scope_mode,
      contract: (contract as EngagementContext['contract']) ?? null,
      team:
        party.team_id && party.team_name_snapshot
          ? { id: party.team_id, name: party.team_name_snapshot }
          : null,
      counterpartyName:
        (counterparty as { display_name_snapshot: string | null } | null)
          ?.display_name_snapshot ?? null,
      activeProjectIds: ((links ?? []) as Array<{ project_id: string | null }>)
        .map((link) => link.project_id)
        .filter((id): id is string => Boolean(id)),
    };
  }

  private async ownedTeams(
    callerId: string,
  ): Promise<Array<{ id: string; name: string }>> {
    const { data, error } = await this.supabase
      .from('teams')
      .select('id, name')
      .eq('owner_id', callerId)
      .order('name');
    if (error) throw new Error(error.message);
    return (data ?? []) as Array<{ id: string; name: string }>;
  }

  /**
   * The team the project lands under: the one the contract was signed for.
   * Contracts signed before seats carried a team have none — then the
   * consultant names one of their own, and their only team is taken as read.
   */
  private async resolveTeam(
    callerId: string,
    context: EngagementContext,
    requested: string | undefined,
  ): Promise<{ id: string; name: string }> {
    if (context.team) return context.team;
    const owned = await this.ownedTeams(callerId);
    if (requested) {
      const team = owned.find((entry) => entry.id === requested);
      if (!team) {
        throw new BadRequestException(
          'Choose one of your own teams for this project.',
        );
      }
      return team;
    }
    if (owned.length === 1) return owned[0];
    throw new BadRequestException(
      'Choose the team this contract bills as before setting up its project.',
    );
  }

  private async ensureTeamAttached(
    callerId: string,
    projectId: string,
    teamId: string,
  ): Promise<void> {
    const { data } = await this.supabase
      .from('project_teams')
      .select('team_id, is_primary')
      .eq('project_id', projectId);
    const attached = (data ?? []) as Array<{
      team_id: string;
      is_primary: boolean;
    }>;
    if (attached.some((row) => row.team_id === teamId)) return;
    await this.projectTeams.attach(projectId, callerId, {
      team_id: teamId,
      is_primary: !attached.some((row) => row.is_primary),
      members: [{ user_id: callerId, role: 'editor' }],
    } as never);
  }

  private async linkEngagement(
    callerId: string,
    engagementId: string,
    projectId: string,
    projectTitle: string,
  ): Promise<void> {
    const { error } = await this.supabase
      .from('engagement_project_links')
      .insert({
        engagement_id: engagementId,
        project_id: projectId,
        project_title_snapshot: projectTitle,
        basis: 'operational_assignment',
        linked_by: callerId,
      });
    // Already linked (unique active link): the call is idempotent.
    if (error && error.code !== '23505') {
      throw new BadRequestException(error.message);
    }
  }

  /**
   * Open the project's finance book under the team book. Best-effort by
   * design: the project and the link are the commitment; a team that has no
   * book yet simply gets one offered by the UI instead.
   */
  private async openFinanceBook(
    callerId: string,
    teamId: string,
    projectId: string,
  ): Promise<{ finance_book_id: string | null; team_book_exists: boolean }> {
    const { data: teamBook } = await this.supabase
      .from('finance_books')
      .select('id')
      .eq('kind', 'team')
      .eq('owner_team_id', teamId)
      .maybeSingle();
    const teamBookId = (teamBook as { id: string } | null)?.id;
    if (!teamBookId) return { finance_book_id: null, team_book_exists: false };

    try {
      const book = await this.financeBooks.addProjectBook(
        callerId,
        teamBookId,
        projectId,
      );
      return { finance_book_id: book.id, team_book_exists: true };
    } catch (error) {
      if (error instanceof ConflictException) {
        const { data: existing } = await this.supabase
          .from('finance_books')
          .select('id')
          .eq('kind', 'project')
          .eq('project_id', projectId)
          .maybeSingle();
        return {
          finance_book_id: (existing as { id: string } | null)?.id ?? null,
          team_book_exists: true,
        };
      }
      this.logger.warn(
        `Project finance book not opened for ${projectId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return { finance_book_id: null, team_book_exists: true };
    }
  }
}
