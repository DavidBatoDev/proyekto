import { Inject, Injectable, Logger } from '@nestjs/common';
import type { IRoadmapsRepository } from '../../roadmaps/repositories/roadmaps.repository.interface';
import {
  RoadmapAuthorizationService,
  type ViewableRoadmapMeta,
} from '../../roadmaps/services/roadmap-authorization.service';
import { ROADMAPS_REPOSITORY } from '../../roadmaps/services/roadmaps.service';
import type {
  AiContextParentChainEntryDto,
  AiContextRefDto,
  AiContextRefErrorCode,
  AiContextRefKind,
  AiContextResolveRefsDto,
  AiContextResolveRefsResponseDto,
  AiContextResolvedRefDto,
} from '../dto/ai-context.dto';
import {
  AI_CONTEXT_REPOSITORY,
  type AiContextChainProjectRow,
  type AiContextRefEpicRow,
  type AiContextRefFeatureRow,
  type AiContextRefMilestoneRow,
  type AiContextRefProjectRow,
  type AiContextRefRoadmapRow,
  type AiContextRefTaskRow,
  type AiContextRefTeamRow,
  type IAiContextRepository,
} from '../repositories/ai-context.repository.interface';

type LoadedRows = {
  task: Map<string, AiContextRefTaskRow>;
  feature: Map<string, AiContextRefFeatureRow>;
  epic: Map<string, AiContextRefEpicRow>;
  milestone: Map<string, AiContextRefMilestoneRow>;
  roadmap: Map<string, AiContextRefRoadmapRow>;
  project: Map<string, AiContextRefProjectRow>;
  team: Map<string, AiContextRefTeamRow>;
};

type ChainContext = {
  viewable: Map<string, ViewableRoadmapMeta>;
  chainProjects: Map<string, AiContextChainProjectRow>;
  workspaceNames: Map<string, string>;
};

const ROADMAP_BOUND_KINDS: ReadonlySet<AiContextRefKind> = new Set([
  'task',
  'feature',
  'epic',
  'milestone',
  'roadmap',
]);

function refKey(ref: { kind: AiContextRefKind; id: string }): string {
  return `${ref.kind}:${ref.id}`;
}

function denied(
  ref: AiContextRefDto,
  errorCode: AiContextRefErrorCode,
): AiContextResolvedRefDto {
  return {
    kind: ref.kind,
    id: ref.id,
    accessible: false,
    error_code: errorCode,
  };
}

/**
 * Hydrates the composer's @-references once per run: one batch load per kind
 * present, ONE `filterViewableRoadmapIds` over the union of roadmap ids
 * (including each referenced project's linked roadmap), one
 * `getAccessibleProjectIds`, one `team_members` probe. Fail-closed per kind -
 * a query error in a kind marks every ref of that kind inaccessible - and
 * per ref for a missing row or an unviewable parent. Never throws for a ref,
 * and never reveals whether a denied id exists (no title on a denial).
 */
@Injectable()
export class AiContextRefsService {
  private readonly logger = new Logger(AiContextRefsService.name);

  constructor(
    @Inject(AI_CONTEXT_REPOSITORY)
    private readonly repo: IAiContextRepository,
    @Inject(ROADMAPS_REPOSITORY)
    private readonly roadmapsRepo: IRoadmapsRepository,
    private readonly roadmapAuth: RoadmapAuthorizationService,
  ) {}

  async resolve(
    userId: string,
    dto: AiContextResolveRefsDto,
    traceId?: string,
  ): Promise<AiContextResolveRefsResponseDto> {
    const startedAt = Date.now();
    const unique = this.dedupe(dto.refs);
    const idsByKind = new Map<AiContextRefKind, string[]>();
    for (const ref of unique) {
      const ids = idsByKind.get(ref.kind) ?? [];
      ids.push(ref.id);
      idsByKind.set(ref.kind, ids);
    }

    const failedKinds = new Set<AiContextRefKind>();
    const [rows, linkedRoadmapIds] = await Promise.all([
      this.loadRows(idsByKind, failedKinds),
      this.loadLinkedRoadmapIds(idsByKind.get('project') ?? []),
    ]);

    // Every roadmap any loaded row hangs off, authorized in ONE call.
    const roadmapIds = new Set<string>();
    for (const task of rows.task.values()) {
      if (task.feature) roadmapIds.add(task.feature.roadmap_id);
    }
    for (const feature of rows.feature.values())
      roadmapIds.add(feature.roadmap_id);
    for (const epic of rows.epic.values()) roadmapIds.add(epic.roadmap_id);
    for (const milestone of rows.milestone.values()) {
      roadmapIds.add(milestone.roadmap_id);
    }
    for (const roadmap of rows.roadmap.values()) roadmapIds.add(roadmap.id);
    // A project ref carries its linked roadmap only when that roadmap is
    // viewable, so it rides the same probe.
    for (const projectId of rows.project.keys()) {
      const linked = linkedRoadmapIds.get(projectId);
      if (linked) roadmapIds.add(linked);
    }

    let viewable = new Map<string, ViewableRoadmapMeta>();
    if (roadmapIds.size > 0) {
      try {
        viewable = await this.roadmapAuth.filterViewableRoadmapIds(userId, [
          ...roadmapIds,
        ]);
      } catch (error) {
        this.warn('roadmap_authz', error);
        for (const kind of ROADMAP_BOUND_KINDS) failedKinds.add(kind);
      }
    }

    let accessibleProjectIds = new Set<string>();
    const needsProjectAccess =
      rows.project.size > 0 ||
      [...viewable.values()].some((meta) => meta.projectId);
    if (needsProjectAccess) {
      try {
        accessibleProjectIds = new Set(
          await this.roadmapsRepo.getAccessibleProjectIds(userId),
        );
      } catch (error) {
        this.warn('project_access', error);
        failedKinds.add('project');
      }
    }

    let memberTeamIds = new Set<string>();
    if (rows.team.size > 0) {
      try {
        memberTeamIds = await this.repo.loadTeamMembershipIds(userId, [
          ...rows.team.keys(),
        ]);
      } catch (error) {
        this.warn('team_membership', error);
        failedKinds.add('team');
      }
    }

    const chain = await this.loadChainTitles(
      viewable,
      rows,
      accessibleProjectIds,
      userId,
    );

    const refs = unique.map((ref): AiContextResolvedRefDto => {
      if (failedKinds.has(ref.kind)) return denied(ref, 'LOOKUP_FAILED');
      switch (ref.kind) {
        case 'task':
          return this.resolveTask(ref, rows.task.get(ref.id), chain);
        case 'feature':
          return this.resolveFeature(ref, rows.feature.get(ref.id), chain);
        case 'epic':
          return this.resolveEpic(ref, rows.epic.get(ref.id), chain);
        case 'milestone':
          return this.resolveMilestone(ref, rows.milestone.get(ref.id), chain);
        case 'roadmap':
          return this.resolveRoadmap(ref, rows.roadmap.get(ref.id), chain);
        case 'project':
          return this.resolveProject(
            ref,
            rows.project.get(ref.id),
            userId,
            accessibleProjectIds,
            linkedRoadmapIds.get(ref.id) ?? null,
            chain,
          );
        case 'team':
          return this.resolveTeam(
            ref,
            rows.team.get(ref.id),
            userId,
            memberTeamIds,
            chain,
          );
        default:
          return denied(ref, 'NOT_FOUND');
      }
    });

    this.logger.log(
      `event=ai_context_resolve_refs_timing trace_id=${traceId ?? 'none'} total_ms=${
        Date.now() - startedAt
      } refs=${refs.length} accessible=${refs.filter((r) => r.accessible).length} failed_kinds=${
        failedKinds.size
      }`,
    );
    return { refs };
  }

  // loads --------------------------------------------------------------------

  private dedupe(refs: AiContextRefDto[]): AiContextRefDto[] {
    const seen = new Set<string>();
    const unique: AiContextRefDto[] = [];
    for (const ref of refs) {
      const key = refKey(ref);
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(ref);
    }
    return unique;
  }

  private async loadRows(
    idsByKind: Map<AiContextRefKind, string[]>,
    failedKinds: Set<AiContextRefKind>,
  ): Promise<LoadedRows> {
    const rows: LoadedRows = {
      task: new Map(),
      feature: new Map(),
      epic: new Map(),
      milestone: new Map(),
      roadmap: new Map(),
      project: new Map(),
      team: new Map(),
    };
    const load = async <T extends { id: string }>(
      kind: AiContextRefKind,
      target: Map<string, T>,
      loader: (ids: string[]) => Promise<T[]>,
    ): Promise<void> => {
      const ids = idsByKind.get(kind);
      if (!ids?.length) return;
      try {
        for (const row of await loader(ids)) target.set(row.id, row);
      } catch (error) {
        this.warn(`load_${kind}`, error);
        failedKinds.add(kind);
      }
    };
    await Promise.all([
      load('task', rows.task, (ids) => this.repo.loadRefTasks(ids)),
      load('feature', rows.feature, (ids) => this.repo.loadRefFeatures(ids)),
      load('epic', rows.epic, (ids) => this.repo.loadRefEpics(ids)),
      load('milestone', rows.milestone, (ids) =>
        this.repo.loadRefMilestones(ids),
      ),
      load('roadmap', rows.roadmap, (ids) => this.repo.loadRefRoadmaps(ids)),
      load('project', rows.project, (ids) => this.repo.loadRefProjects(ids)),
      load('team', rows.team, (ids) => this.repo.loadRefTeams(ids)),
    ]);
    return rows;
  }

  /**
   * The linked roadmap of every referenced project. Decoration on the project
   * ref (its `roadmap_id`), so a failed lookup omits the roadmap rather than
   * denying the project.
   */
  private async loadLinkedRoadmapIds(
    projectIds: string[],
  ): Promise<Map<string, string>> {
    if (projectIds.length === 0) return new Map();
    try {
      return await this.repo.loadLinkedRoadmapIds(projectIds);
    } catch (error) {
      this.warn('project_roadmaps', error);
      return new Map();
    }
  }

  /**
   * Titles for the project/workspace tail of every chain. These are
   * decoration on already-authorized refs, so a failed lookup shortens the
   * chain rather than denying the ref.
   */
  private async loadChainTitles(
    viewable: Map<string, ViewableRoadmapMeta>,
    rows: LoadedRows,
    accessibleProjectIds: Set<string>,
    userId: string,
  ): Promise<ChainContext> {
    const projectIds = new Set<string>();
    for (const meta of viewable.values()) {
      if (meta.projectId) projectIds.add(meta.projectId);
    }
    const workspaceIds = new Set<string>();
    for (const project of rows.project.values()) {
      if (
        project.workspace_id &&
        (accessibleProjectIds.has(project.id) || project.owner_id === userId)
      ) {
        workspaceIds.add(project.workspace_id);
      }
    }
    for (const team of rows.team.values()) {
      if (team.workspace_id) workspaceIds.add(team.workspace_id);
    }

    let chainProjects = new Map<string, AiContextChainProjectRow>();
    if (projectIds.size > 0) {
      try {
        chainProjects = await this.repo.loadChainProjects([...projectIds]);
        for (const project of chainProjects.values()) {
          if (project.workspace_id) workspaceIds.add(project.workspace_id);
        }
      } catch (error) {
        this.warn('chain_projects', error);
      }
    }

    let workspaceNames = new Map<string, string>();
    if (workspaceIds.size > 0) {
      try {
        workspaceNames = await this.repo.loadWorkspaceNames([...workspaceIds]);
      } catch (error) {
        this.warn('chain_workspaces', error);
      }
    }
    return { viewable, chainProjects, workspaceNames };
  }

  // per-kind resolution --------------------------------------------------------

  private resolveTask(
    ref: AiContextRefDto,
    row: AiContextRefTaskRow | undefined,
    chain: ChainContext,
  ): AiContextResolvedRefDto {
    if (!row?.feature) return denied(ref, 'NOT_FOUND');
    const meta = chain.viewable.get(row.feature.roadmap_id);
    if (!meta) return denied(ref, 'NOT_FOUND');
    const tail = this.roadmapTail(row.feature.roadmap_id, meta, chain);
    const parents: AiContextParentChainEntryDto[] = [
      { kind: 'feature', id: row.feature.id, title: row.feature.title },
    ];
    if (row.feature.epic) {
      parents.push({
        kind: 'epic',
        id: row.feature.epic.id,
        title: row.feature.epic.title,
      });
    }
    return {
      kind: 'task',
      id: row.id,
      accessible: true,
      title: row.title,
      status: row.status,
      roadmap_id: row.feature.roadmap_id,
      project_id: meta.projectId,
      workspace_id: tail.workspaceId,
      parent_chain: [...parents, ...tail.chain],
    };
  }

  private resolveFeature(
    ref: AiContextRefDto,
    row: AiContextRefFeatureRow | undefined,
    chain: ChainContext,
  ): AiContextResolvedRefDto {
    if (!row) return denied(ref, 'NOT_FOUND');
    const meta = chain.viewable.get(row.roadmap_id);
    if (!meta) return denied(ref, 'NOT_FOUND');
    const tail = this.roadmapTail(row.roadmap_id, meta, chain);
    const parents: AiContextParentChainEntryDto[] = row.epic
      ? [{ kind: 'epic', id: row.epic.id, title: row.epic.title }]
      : [];
    return {
      kind: 'feature',
      id: row.id,
      accessible: true,
      title: row.title,
      status: row.status,
      roadmap_id: row.roadmap_id,
      project_id: meta.projectId,
      workspace_id: tail.workspaceId,
      parent_chain: [...parents, ...tail.chain],
    };
  }

  private resolveEpic(
    ref: AiContextRefDto,
    row: AiContextRefEpicRow | undefined,
    chain: ChainContext,
  ): AiContextResolvedRefDto {
    return this.resolveRoadmapChild('epic', ref, row, chain);
  }

  private resolveMilestone(
    ref: AiContextRefDto,
    row: AiContextRefMilestoneRow | undefined,
    chain: ChainContext,
  ): AiContextResolvedRefDto {
    return this.resolveRoadmapChild('milestone', ref, row, chain);
  }

  private resolveRoadmapChild(
    kind: 'epic' | 'milestone',
    ref: AiContextRefDto,
    row:
      | { id: string; title: string; status: string | null; roadmap_id: string }
      | undefined,
    chain: ChainContext,
  ): AiContextResolvedRefDto {
    if (!row) return denied(ref, 'NOT_FOUND');
    const meta = chain.viewable.get(row.roadmap_id);
    if (!meta) return denied(ref, 'NOT_FOUND');
    const tail = this.roadmapTail(row.roadmap_id, meta, chain);
    return {
      kind,
      id: row.id,
      accessible: true,
      title: row.title,
      status: row.status,
      roadmap_id: row.roadmap_id,
      project_id: meta.projectId,
      workspace_id: tail.workspaceId,
      parent_chain: tail.chain,
    };
  }

  private resolveRoadmap(
    ref: AiContextRefDto,
    row: AiContextRefRoadmapRow | undefined,
    chain: ChainContext,
  ): AiContextResolvedRefDto {
    if (!row) return denied(ref, 'NOT_FOUND');
    const meta = chain.viewable.get(row.id);
    if (!meta) return denied(ref, 'NOT_FOUND');
    const tail = this.roadmapTail(row.id, meta, chain);
    return {
      kind: 'roadmap',
      id: row.id,
      accessible: true,
      title: row.name,
      status: row.status,
      roadmap_id: row.id,
      project_id: meta.projectId,
      workspace_id: tail.workspaceId,
      // The roadmap itself is the ref, so its chain starts at the project.
      parent_chain: tail.chain.slice(1),
    };
  }

  private resolveProject(
    ref: AiContextRefDto,
    row: AiContextRefProjectRow | undefined,
    userId: string,
    accessibleProjectIds: Set<string>,
    linkedRoadmapId: string | null,
    chain: ChainContext,
  ): AiContextResolvedRefDto {
    if (!row) return denied(ref, 'NOT_FOUND');
    if (!accessibleProjectIds.has(row.id) && row.owner_id !== userId) {
      return denied(ref, 'NOT_FOUND');
    }
    const parentChain: AiContextParentChainEntryDto[] = [];
    if (row.workspace_id) {
      parentChain.push({
        kind: 'workspace',
        id: row.workspace_id,
        title: chain.workspaceNames.get(row.workspace_id) ?? '',
      });
    }
    return {
      kind: 'project',
      id: row.id,
      accessible: true,
      title: row.title,
      status: row.status,
      // The linked roadmap rides along only when the caller can view it, so
      // the agent can render the project with its roadmap in focus.
      roadmap_id:
        linkedRoadmapId && chain.viewable.has(linkedRoadmapId)
          ? linkedRoadmapId
          : null,
      project_id: row.id,
      workspace_id: row.workspace_id,
      parent_chain: parentChain,
    };
  }

  private resolveTeam(
    ref: AiContextRefDto,
    row: AiContextRefTeamRow | undefined,
    userId: string,
    memberTeamIds: Set<string>,
    chain: ChainContext,
  ): AiContextResolvedRefDto {
    if (!row) return denied(ref, 'NOT_FOUND');
    // Owner or member, mirroring `TeamsService.resolveViewerRole`.
    if (row.owner_id !== userId && !memberTeamIds.has(row.id)) {
      return denied(ref, 'NOT_FOUND');
    }
    const parentChain: AiContextParentChainEntryDto[] = [];
    if (row.workspace_id) {
      parentChain.push({
        kind: 'workspace',
        id: row.workspace_id,
        title: chain.workspaceNames.get(row.workspace_id) ?? '',
      });
    }
    return {
      kind: 'team',
      id: row.id,
      accessible: true,
      title: row.name,
      status: null,
      roadmap_id: null,
      project_id: null,
      workspace_id: row.workspace_id,
      parent_chain: parentChain,
    };
  }

  /** roadmap -> project -> workspace, nearest-first. */
  private roadmapTail(
    roadmapId: string,
    meta: ViewableRoadmapMeta,
    chain: ChainContext,
  ): { chain: AiContextParentChainEntryDto[]; workspaceId: string | null } {
    const entries: AiContextParentChainEntryDto[] = [
      { kind: 'roadmap', id: roadmapId, title: meta.name },
    ];
    let workspaceId: string | null = null;
    if (meta.projectId) {
      const project = chain.chainProjects.get(meta.projectId);
      entries.push({
        kind: 'project',
        id: meta.projectId,
        title: project?.title ?? '',
      });
      if (project?.workspace_id) {
        workspaceId = project.workspace_id;
        entries.push({
          kind: 'workspace',
          id: project.workspace_id,
          title: chain.workspaceNames.get(project.workspace_id) ?? '',
        });
      }
    }
    return { chain: entries, workspaceId };
  }

  private warn(step: string, error: unknown): void {
    this.logger.warn(
      `event=ai_context_resolve_refs_step_failed step=${step} message=${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
