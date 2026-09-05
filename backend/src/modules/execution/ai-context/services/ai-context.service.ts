import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { RedisDataCacheService } from '../../../../common/cache/redis-data-cache.service';
import { REDIS_CACHE_KEYS } from '../../../../common/cache/redis-cache.keys';
import type { AuthenticatedUser } from '../../../../common/interfaces/authenticated-request.interface';
import { ProjectsService } from '../../projects/projects.service';
import type { AccessibleRoadmapLightRecord } from '../../roadmaps/repositories/roadmaps.repository.interface';
import type { IRoadmapsRepository } from '../../roadmaps/repositories/roadmaps.repository.interface';
import { RoadmapAuthorizationService } from '../../roadmaps/services/roadmap-authorization.service';
import { ROADMAPS_REPOSITORY } from '../../roadmaps/services/roadmaps.service';
import { TeamsService } from '../../teams/teams.service';
import { WorkspacesService } from '../../workspaces/workspaces.service';
import {
  AI_CONTEXT_NODE_KINDS,
  type AiContextActorResponseDto,
  type AiContextChangesQueryDto,
  type AiContextChangesResponseDto,
  type AiContextLane,
  type AiContextNodeKind,
  type AiContextOverviewProjectDto,
  type AiContextOverviewQueryDto,
  type AiContextOverviewResponseDto,
  type AiContextOverviewRoadmapDto,
  type AiContextOverviewTeamDto,
  type AiContextOverviewWorkspaceDto,
  type AiContextRoadmapCountsDto,
  type AiContextRoadmapListItemDto,
  type AiContextRoadmapsQueryDto,
  type AiContextRoadmapsResponseDto,
  type AiContextSearchKind,
  type AiContextSearchMatchDto,
  type AiContextSearchQueryDto,
  type AiContextSearchResponseDto,
  type AiContextTaskStatusFilter,
  type AiContextTasksQueryDto,
  type AiContextTasksResponseDto,
} from '../dto/ai-context.dto';
import {
  AI_CONTEXT_REPOSITORY,
  type IAiContextRepository,
} from '../repositories/ai-context.repository.interface';

/** Roadmaps beyond this many get zero counts and `counts_truncated: true`. */
export const AI_CONTEXT_OVERVIEW_COUNTS_CAP = 300;
const DEFAULT_ROADMAPS_PAGE = 50;
const DEFAULT_SEARCH_LIMIT = 20;
const DEFAULT_TASKS_LIMIT = 50;
const DEFAULT_CHANGES_LIMIT = 50;
const ROADMAP_DESCRIPTION_MAX_CHARS = 280;

const OPEN_TASK_STATUSES = ['todo', 'in_progress', 'in_review', 'blocked'];

const ZERO_COUNTS: AiContextRoadmapCountsDto = {
  epics: 0,
  features: 0,
  tasks: 0,
  open_tasks: 0,
  overdue_tasks: 0,
};

const NODE_KIND_SET: ReadonlySet<string> = new Set(AI_CONTEXT_NODE_KINDS);

type ScopeFilters = {
  workspaceId?: string;
  projectId?: string;
  roadmapIds?: string[];
};

type KeysetCursor = { updatedAt: string; id: string };

/**
 * Same normalization as `RoadmapsRepositorySupabase.sanitizeLookupQuery`:
 * LIKE wildcards become spaces, whitespace collapses, length is capped. The
 * SQL lane wraps the needle in `%...%` itself, so a stray `%` from the caller
 * must not survive into the pattern.
 */
export function sanitizeAiContextQuery(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[%_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 160)
    .trim();
}

/** `status=open` -> the four non-done statuses; `all` -> no filter. */
export function mapTaskStatusFilter(
  status: AiContextTaskStatusFilter | undefined,
): string[] | null {
  if (status === undefined || status === 'open') return [...OPEN_TASK_STATUSES];
  if (status === 'all') return null;
  return [status];
}

/**
 * Where an item sits relative to the workspace the caller is looking at.
 * Nothing accessible is ever dropped - the workspace is a discovery
 * boundary, not an authorization one - so every item gets a lane:
 *   current          in the requested workspace (or, with no workspace
 *                    requested, in any workspace the caller belongs to)
 *   other_workspace  another workspace the caller belongs to
 *   shared           unhomed, or a workspace the caller is not a member of
 *                    (reachable only through project_access)
 */
export function classifyAiContextLane(
  itemWorkspaceId: string | null | undefined,
  requestedWorkspaceId: string | null,
  memberWorkspaceIds: ReadonlySet<string>,
): AiContextLane {
  if (!itemWorkspaceId || !memberWorkspaceIds.has(itemWorkspaceId)) {
    return 'shared';
  }
  if (requestedWorkspaceId === null) return 'current';
  return itemWorkspaceId === requestedWorkspaceId
    ? 'current'
    : 'other_workspace';
}

export function encodeAiContextCursor(item: {
  updated_at: string | null;
  id: string;
}): string {
  return Buffer.from(`${item.updated_at ?? ''}|${item.id}`, 'utf8').toString(
    'base64url',
  );
}

export function decodeAiContextCursor(cursor: string): KeysetCursor | null {
  let raw: string;
  try {
    raw = Buffer.from(cursor, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const separator = raw.lastIndexOf('|');
  if (separator < 0) return null;
  const id = raw.slice(separator + 1);
  if (!id) return null;
  return { updatedAt: raw.slice(0, separator), id };
}

/** `(updated_at desc nulls last, id asc)` as a total order. */
function compareKeyset(
  a: { updated_at: string | null; id: string },
  b: { updated_at: string | null; id: string },
): number {
  const ta = a.updated_at ?? '';
  const tb = b.updated_at ?? '';
  if (ta !== tb) return ta > tb ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

/** 0 exact, 1 prefix, 2 substring, 3 description-only, null no match. */
function rankTextMatch(
  title: string | null | undefined,
  description: string | null | undefined,
  needle: string,
): number | null {
  const lowerTitle = (title ?? '').toLowerCase();
  if (lowerTitle === needle) return 0;
  if (lowerTitle.startsWith(needle)) return 1;
  if (lowerTitle.includes(needle)) return 2;
  if ((description ?? '').toLowerCase().includes(needle)) return 3;
  return null;
}

function compareMatches(
  a: AiContextSearchMatchDto,
  b: AiContextSearchMatchDto,
): number {
  if (a.rank !== b.rank) return a.rank - b.rank;
  return compareKeyset(a, b);
}

function truncateDescription(value: string | null): string | null {
  if (value === null) return null;
  return value.length > ROADMAP_DESCRIPTION_MAX_CHARS
    ? `${value.slice(0, ROADMAP_DESCRIPTION_MAX_CHARS - 1)}…`
    : value;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * The user-scoped half of the AI context surface: what the caller can reach
 * across every roadmap, project, team and workspace, for the workspace-scope
 * assistant. Every read starts from an already-authorized set
 * (`listAccessibleRoadmapsLight` = owner UNION project_access, the same
 * predicate as `findAll`) and every denial is a 404, so the family never
 * confirms that something exists.
 */
@Injectable()
export class AiContextService {
  private readonly logger = new Logger(AiContextService.name);

  constructor(
    @Inject(AI_CONTEXT_REPOSITORY)
    private readonly repo: IAiContextRepository,
    @Inject(ROADMAPS_REPOSITORY)
    private readonly roadmapsRepo: IRoadmapsRepository,
    private readonly roadmapAuth: RoadmapAuthorizationService,
    private readonly projectsService: ProjectsService,
    private readonly workspacesService: WorkspacesService,
    private readonly teamsService: TeamsService,
    private readonly cache: RedisDataCacheService,
  ) {}

  async getActor(
    userId: string,
    traceId?: string,
  ): Promise<AiContextActorResponseDto> {
    const startedAt = Date.now();
    const displayName = await this.repo.readActorDisplayName(userId);
    this.logTiming('ai_context_actor_timing', traceId, startedAt);
    return {
      actor_id: userId,
      display_name: displayName,
      locale: null,
      timezone: null,
    };
  }

  /**
   * Everything the caller can reach, laned against `workspace_id`. The
   * membership gate runs BEFORE the cache (as the intake context block does)
   * so a non-member never warms, let alone reads, a cached payload.
   */
  async getOverview(
    user: AuthenticatedUser,
    query: AiContextOverviewQueryDto,
    traceId?: string,
  ): Promise<AiContextOverviewResponseDto> {
    const startedAt = Date.now();
    const userId = user.id;
    const workspaceId = query.workspace_id ?? null;
    if (workspaceId) {
      const member = await this.workspacesService.isMember(workspaceId, userId);
      if (!member) throw new NotFoundException('Workspace not found');
    }

    const response = await this.cache.rememberJson(
      REDIS_CACHE_KEYS.aiContextOverviewByUser(userId, workspaceId),
      this.cache.getDashboardTtlSeconds(),
      () => this.loadOverview(user, workspaceId),
      { indexKey: REDIS_CACHE_KEYS.aiContextOverviewIndexByUser(userId) },
    );
    this.logTiming('ai_context_overview_timing', traceId, startedAt, {
      workspace_id: workspaceId ?? 'none',
      roadmaps: response.roadmaps.length,
    });
    return response;
  }

  async listRoadmaps(
    userId: string,
    query: AiContextRoadmapsQueryDto,
    traceId?: string,
  ): Promise<AiContextRoadmapsResponseDto> {
    const startedAt = Date.now();
    const limit = query.limit ?? DEFAULT_ROADMAPS_PAGE;
    const cursor = query.cursor ? decodeAiContextCursor(query.cursor) : null;
    if (query.cursor && !cursor) {
      throw new BadRequestException('Invalid cursor');
    }

    const accessible = await this.loadAccessibleRoadmaps(userId, {
      workspaceId: query.workspace_id,
      projectId: query.project_id,
    });
    const ordered = [...accessible].sort(compareKeyset);
    const after = cursor
      ? ordered.filter(
          (item) =>
            compareKeyset(item, {
              updated_at: cursor.updatedAt,
              id: cursor.id,
            }) > 0,
        )
      : ordered;
    const page = after.slice(0, limit);
    const last = page[page.length - 1];
    const nextCursor =
      after.length > limit && last ? encodeAiContextCursor(last) : null;

    this.logTiming('ai_context_roadmaps_timing', traceId, startedAt, {
      returned: page.length,
    });
    return {
      items: page.map((item) => this.toRoadmapListItem(item)),
      next_cursor: nextCursor,
    };
  }

  /**
   * Cross-roadmap search. Epics/features/tasks go through the
   * `ai_context_search_nodes` RPC over the accessible ids; roadmaps and
   * projects are matched in-process on name/title (substring,
   * case-insensitive - the app-wide convention). `roadmap_ids` intersects the
   * accessible set and can never widen it.
   */
  async search(
    userId: string,
    query: AiContextSearchQueryDto,
    traceId?: string,
  ): Promise<AiContextSearchResponseDto> {
    const startedAt = Date.now();
    const limit = query.limit ?? DEFAULT_SEARCH_LIMIT;
    const kinds = this.resolveSearchKinds(query.kinds);
    const needle = sanitizeAiContextQuery(query.q);
    if (!needle) return { matches: [] };

    const accessible = await this.loadAccessibleRoadmaps(userId, {
      workspaceId: query.workspace_id,
      projectId: query.project_id,
      roadmapIds: query.roadmap_ids,
    });
    const byId = new Map(accessible.map((item) => [item.id, item]));
    const matches: AiContextSearchMatchDto[] = [];

    const nodeKinds = kinds.filter((kind): kind is AiContextNodeKind =>
      NODE_KIND_SET.has(kind),
    );
    if (nodeKinds.length > 0 && accessible.length > 0) {
      const rows = await this.repo.searchNodes({
        roadmapIds: accessible.map((item) => item.id),
        query: needle,
        kinds: nodeKinds,
        limit,
      });
      for (const row of rows) {
        const roadmap = byId.get(row.roadmap_id);
        // The RPC only sees ids we passed, but attribution is joined from the
        // accessible map, so a row we cannot attribute is dropped, not leaked.
        if (!roadmap) continue;
        matches.push({
          id: row.id,
          kind: row.kind,
          title: row.title,
          status: row.status,
          rank: row.rank,
          roadmap_id: roadmap.id,
          roadmap_name: roadmap.name,
          project_id: roadmap.project_id,
          project_title: roadmap.project?.title ?? null,
          workspace_id: roadmap.project?.workspace_id ?? null,
          epic_id: row.epic_id,
          feature_id: row.feature_id,
          parent_title: row.parent_title,
          updated_at: row.updated_at,
        });
      }
    }

    if (kinds.includes('roadmap')) {
      for (const roadmap of accessible) {
        const rank = rankTextMatch(roadmap.name, roadmap.description, needle);
        if (rank === null) continue;
        matches.push({
          id: roadmap.id,
          kind: 'roadmap',
          title: roadmap.name,
          status: roadmap.status,
          rank,
          roadmap_id: roadmap.id,
          roadmap_name: roadmap.name,
          project_id: roadmap.project_id,
          project_title: roadmap.project?.title ?? null,
          workspace_id: roadmap.project?.workspace_id ?? null,
          updated_at: roadmap.updated_at,
        });
      }
    }

    if (kinds.includes('project')) {
      matches.push(
        ...(await this.searchProjects(userId, query, needle, accessible)),
      );
    }

    matches.sort(compareMatches);
    const page = matches.slice(0, limit);
    this.logTiming('ai_context_search_timing', traceId, startedAt, {
      kinds: kinds.join('|'),
      returned: page.length,
    });
    return { matches: page };
  }

  /**
   * Tasks across every accessible roadmap (or the narrowed set). Assignee
   * semantics are the join table OR the legacy `roadmap_tasks.assignee_id` -
   * deliberately wider than the in-roadmap `getContextTasksAssignedToMe`,
   * which reads only the legacy column and is left alone.
   */
  async listTasks(
    userId: string,
    query: AiContextTasksQueryDto,
    traceId?: string,
  ): Promise<AiContextTasksResponseDto> {
    const startedAt = Date.now();
    const accessible = await this.loadAccessibleRoadmaps(userId, {
      workspaceId: query.workspace_id,
      projectId: query.project_id,
      roadmapIds: query.roadmap_ids,
    });
    if (accessible.length === 0) return { tasks: [] };
    const byId = new Map(accessible.map((item) => [item.id, item]));

    const rows = await this.repo.listTasks({
      roadmapIds: accessible.map((item) => item.id),
      assignee: query.assigned_to_me ? userId : null,
      statuses: mapTaskStatusFilter(query.status),
      dueFrom: query.due_after ?? null,
      dueTo: query.due_before ?? null,
      overdueAt: query.overdue ? new Date().toISOString() : null,
      limit: query.limit ?? DEFAULT_TASKS_LIMIT,
    });

    const tasks = rows.flatMap((row) => {
      const roadmap = byId.get(row.roadmap_id);
      if (!roadmap) return [];
      return [
        {
          ...row,
          roadmap_name: roadmap.name,
          project_id: roadmap.project_id,
          project_title: roadmap.project?.title ?? null,
          workspace_id: roadmap.project?.workspace_id ?? null,
        },
      ];
    });
    this.logTiming('ai_context_tasks_timing', traceId, startedAt, {
      returned: tasks.length,
    });
    return { tasks };
  }

  /**
   * The caller's own commits for one run or one session, for the verify
   * phase's "did every planned batch land" check across N roadmaps. Rows on
   * roadmaps the caller can no longer view are dropped (fail closed), not
   * errored.
   */
  async listChanges(
    userId: string,
    query: AiContextChangesQueryDto,
    traceId?: string,
  ): Promise<AiContextChangesResponseDto> {
    const startedAt = Date.now();
    if (!!query.run_id === !!query.session_id) {
      throw new BadRequestException(
        'Provide exactly one of run_id or session_id',
      );
    }
    const rows = await this.repo.listChangeHistory({
      actorId: userId,
      runId: query.run_id,
      sessionId: query.session_id,
      limit: query.limit ?? DEFAULT_CHANGES_LIMIT,
    });
    if (rows.length === 0) return { changes: [] };

    const viewable = await this.roadmapAuth.filterViewableRoadmapIds(
      userId,
      rows.map((row) => row.roadmap_id),
    );
    const changes = rows.filter((row) => viewable.has(row.roadmap_id));
    this.logTiming('ai_context_changes_timing', traceId, startedAt, {
      returned: changes.length,
    });
    return { changes };
  }

  // overview -----------------------------------------------------------------

  private async loadOverview(
    user: AuthenticatedUser,
    workspaceId: string | null,
  ): Promise<AiContextOverviewResponseDto> {
    const userId = user.id;
    const isGuest = !!user.is_guest;
    const [projects, roadmaps, teams, workspaces] = await Promise.all([
      this.projectsService.listDashboardProjects(userId),
      this.roadmapsRepo.listAccessibleRoadmapsLight(userId),
      this.teamsService.listMyTeams(userId),
      // Guests have no auth.users row, so no workspace membership either.
      isGuest
        ? Promise.resolve([])
        : this.workspacesService.listMyWorkspaces(userId),
    ]);

    const memberWorkspaceIds = new Set(workspaces.map((row) => row.id));
    const roadmapIds = roadmaps.map((row) => row.id);
    const countsTruncated = roadmapIds.length > AI_CONTEXT_OVERVIEW_COUNTS_CAP;
    const counts = await this.repo.roadmapCounts(
      roadmapIds.slice(0, AI_CONTEXT_OVERVIEW_COUNTS_CAP),
    );

    let workspace: AiContextOverviewWorkspaceDto | null = null;
    if (workspaceId && !isGuest) {
      const listed = workspaces.find((row) => row.id === workspaceId);
      // Membership was proven before the cache; the list can still miss the
      // row in a race with a membership change, so fall back to the bare row.
      const row =
        listed ??
        (await this.workspacesService.fetchWorkspaceOrThrow(workspaceId));
      workspace = {
        id: row.id,
        name: row.name,
        slug: row.slug,
        my_role: listed?.my_role ?? null,
      };
    }

    const roadmapIdByProject = new Map<string, string>();
    for (const roadmap of roadmaps) {
      if (roadmap.project_id && !roadmapIdByProject.has(roadmap.project_id)) {
        roadmapIdByProject.set(roadmap.project_id, roadmap.id);
      }
    }

    const projectItems: AiContextOverviewProjectDto[] = projects.map(
      (project) => {
        const raw = project as unknown as Record<string, unknown>;
        const projectWorkspaceId = readString(raw.workspace_id);
        const members = Array.isArray(raw.members)
          ? (raw.members as Array<Record<string, unknown>>)
          : [];
        const mine = members.find((member) => member.user_id === userId);
        const ownerId = readString(raw.owner_id);
        return {
          id: project.id,
          title: project.title,
          status: readString(raw.status),
          workspace_id: projectWorkspaceId,
          owner_id: ownerId,
          my_role:
            readString(mine?.role) ?? (ownerId === userId ? 'owner' : null),
          member_count: members.length,
          lane: classifyAiContextLane(
            projectWorkspaceId,
            workspaceId,
            memberWorkspaceIds,
          ),
          roadmap_id: roadmapIdByProject.get(project.id) ?? null,
        };
      },
    );

    const roadmapItems: AiContextOverviewRoadmapDto[] = roadmaps.map(
      (roadmap) => ({
        id: roadmap.id,
        name: roadmap.name,
        status: roadmap.status,
        owner_id: roadmap.owner_id,
        project_id: roadmap.project_id,
        project_title: roadmap.project?.title ?? null,
        workspace_id: roadmap.project?.workspace_id ?? null,
        lane: classifyAiContextLane(
          roadmap.project?.workspace_id,
          workspaceId,
          memberWorkspaceIds,
        ),
        updated_at: roadmap.updated_at,
        counts: counts.get(roadmap.id) ?? { ...ZERO_COUNTS },
      }),
    );

    const teamItems: AiContextOverviewTeamDto[] = teams.map((team) => ({
      id: team.id,
      name: team.name,
      workspace_id: team.workspace_id ?? null,
      my_role: team.viewer_role ?? (team.owner_id === userId ? 'owner' : null),
      status: team.status ?? null,
      lane: classifyAiContextLane(
        team.workspace_id,
        workspaceId,
        memberWorkspaceIds,
      ),
    }));

    return {
      workspace,
      projects: projectItems,
      roadmaps: roadmapItems,
      teams: teamItems,
      counts_truncated: countsTruncated,
      generated_at: new Date().toISOString(),
    };
  }

  // search helpers -----------------------------------------------------------

  private resolveSearchKinds(
    kinds: AiContextSearchKind[] | undefined,
  ): AiContextSearchKind[] {
    const unique = Array.from(new Set(kinds ?? []));
    return unique.length > 0 ? unique : [...AI_CONTEXT_NODE_KINDS];
  }

  private async searchProjects(
    userId: string,
    query: AiContextSearchQueryDto,
    needle: string,
    accessibleRoadmaps: AccessibleRoadmapLightRecord[],
  ): Promise<AiContextSearchMatchDto[]> {
    const projects = await this.projectsService.listDashboardProjects(userId);
    const roadmapByProject = new Map<string, AccessibleRoadmapLightRecord>();
    for (const roadmap of accessibleRoadmaps) {
      if (roadmap.project_id && !roadmapByProject.has(roadmap.project_id)) {
        roadmapByProject.set(roadmap.project_id, roadmap);
      }
    }
    // `roadmap_ids` narrows: with it, only the projects of those roadmaps.
    const allowedProjectIds = query.roadmap_ids?.length
      ? new Set(roadmapByProject.keys())
      : null;

    const matches: AiContextSearchMatchDto[] = [];
    for (const project of projects) {
      const raw = project as unknown as Record<string, unknown>;
      const workspaceId = readString(raw.workspace_id);
      if (query.project_id && project.id !== query.project_id) continue;
      if (query.workspace_id && workspaceId !== query.workspace_id) continue;
      if (allowedProjectIds && !allowedProjectIds.has(project.id)) continue;
      const rank = rankTextMatch(
        project.title,
        readString(raw.description),
        needle,
      );
      if (rank === null) continue;
      const roadmap = roadmapByProject.get(project.id) ?? null;
      matches.push({
        id: project.id,
        kind: 'project',
        title: project.title,
        status: readString(raw.status),
        rank,
        roadmap_id: roadmap?.id ?? null,
        roadmap_name: roadmap?.name ?? null,
        project_id: project.id,
        project_title: project.title,
        workspace_id: workspaceId,
        updated_at: readString(raw.updated_at),
      });
    }
    return matches;
  }

  // shared -------------------------------------------------------------------

  /**
   * The accessible roadmap set (owner UNION project_access) narrowed by the
   * optional scope filters. `roadmapIds` is an intersection: an id the caller
   * cannot see is simply absent from the result, never an error.
   */
  private async loadAccessibleRoadmaps(
    userId: string,
    filters: ScopeFilters,
  ): Promise<AccessibleRoadmapLightRecord[]> {
    const all = await this.roadmapsRepo.listAccessibleRoadmapsLight(userId);
    const requested = filters.roadmapIds?.length
      ? new Set(filters.roadmapIds)
      : null;
    return all.filter((item) => {
      if (filters.projectId && item.project_id !== filters.projectId) {
        return false;
      }
      if (
        filters.workspaceId &&
        (item.project?.workspace_id ?? null) !== filters.workspaceId
      ) {
        return false;
      }
      if (requested && !requested.has(item.id)) return false;
      return true;
    });
  }

  private toRoadmapListItem(
    item: AccessibleRoadmapLightRecord,
  ): AiContextRoadmapListItemDto {
    return {
      id: item.id,
      name: item.name,
      description: truncateDescription(item.description),
      status: item.status,
      owner_id: item.owner_id,
      updated_at: item.updated_at,
      project: item.project
        ? {
            id: item.project.id,
            title: item.project.title,
            workspace_id: item.project.workspace_id,
          }
        : null,
    };
  }

  private logTiming(
    event: string,
    traceId: string | undefined,
    startedAt: number,
    extra: Record<string, string | number> = {},
  ): void {
    const fields = Object.entries(extra)
      .map(([key, value]) => `${key}=${value}`)
      .join(' ');
    this.logger.log(
      `event=${event} trace_id=${traceId ?? 'none'} total_ms=${
        Date.now() - startedAt
      }${fields ? ` ${fields}` : ''}`,
    );
  }
}
