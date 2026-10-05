// backend/src/modules/execution/time/legacy/team-time-legacy.service.ts
//
// The reads behind /api/team-time (blueprint §4, D04): the old lists and summaries ported onto time_entries, plus
// the Row builder every alias response goes through (CC13: write results are re-read here too, so `status`,
// `reviewed_*`, `reviewer` and `limit_context` are never dropped). Status is derived from column predicates (D03,
// R1), never from time_entries.status. Redaction is the time module's: rows are authorised with ENTRY_AUTH_SELECT
// and hydrated per class by TimeAuthorityService, so a hidden class is never fetched; project routes add no cost
// and no email (R4). Misses are 404; reads are never plan-gated (R6).
import {
  HttpException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../../config/supabase.module';
import { MissingPermissionException } from '../../projects/authorization/missing-permission.exception';
import { ProjectAuthorizationService } from '../../projects/authorization/project-authorization.service';
import {
  getPermission,
  type ProjectPermissions,
  ROLE_DEFAULTS,
} from '../../projects/permissions/project-permissions';
import type { ListLogsQueryDto } from '../dto/legacy-team-time.dto';
import { TimeAuthorityService } from '../time-authority.service';
import { TimeEntriesService } from '../time-entries.service';
import {
  ENTRY_AUTH_SELECT,
  ENTRY_LEGACY_REVIEW_SELECT,
} from '../time-entry.select';
import {
  mapTimeDbError,
  type PgErrorLike,
  TIME_INTERNAL_CODE,
  timeNotFound,
} from '../time-errors';
import { andOfOrGroups } from '../time-reports.service';
import type {
  CapContext,
  EntryAuthRow,
  LegacyEntryStatus,
  ProjectTaskOption,
  TimeEntryView,
} from '../time.types';
import {
  ALIAS_MASKED_MEMBER_NAME,
  applyLegacyStatusFilter,
  type LegacyReviewRow,
  legacySummary,
  type LegacySummaryRow,
  maskedMemberId,
  sheetDecisionApplies,
  toLegacyLog,
} from './team-time-legacy.mapper';
import type {
  LegacyContractStatus,
  LegacyListResult,
  LegacyLogsSummary,
  LegacyMember,
  LegacyProject,
  LegacyReviewerEmbed,
  LegacyTaskTimeLog,
} from './team-time-legacy.types';

/** Old listLogs default page size (team-time.service.ts:2192); the DTO caps `limit` at 200. */
export const ALIAS_LIST_DEFAULT_LIMIT = 50;
export const ALIAS_LIST_MAX_LIMIT = 200;

/** D68 read copy: reads never say "save" and never carry Postgres text. */
const READ_FAILED_MESSAGE = "Proyekto couldn't load this time. Try again.";

/** PostgREST pages at 1000 rows; aggregate reads walk pages of this size. */
const PAGE_ROWS = 1000;
/** The member-list scan stops here (the old query read one page). */
const MAX_SCAN_ROWS = 20_000;
/** `.in()` lists are chunked so a long id list never builds an over-long URL. */
const IN_CHUNK = 100;
const INVALID_TEXT_REPRESENTATION = '22P02';
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** R3: the `task_status` filter needs an inner join on the task (column hint, never an FK name). */
const TASK_STATUS_EMBED = 'task:roadmap_tasks!task_id!inner(status)';
/** R9 base columns (hours and status, D31); cost columns are added only where the viewer may read them. */
const SUMMARY_SELECT =
  'id, member_user_id, duration_seconds, payable_seconds, payout_id, legacy_status';
const SUMMARY_COST_COLUMNS =
  'rate_snapshot, currency_snapshot, amount_snapshot';
const REVIEWER_SELECT = 'id, display_name, avatar_url';
/** The synthetic row id that asks costVisible for a team's verdict. */
const TEAM_COST_PROBE_ID = 'team-cost-probe';

// ── Query plumbing ────────────────────────────────────────────────────────────────────────────────────────────

interface QueryResult {
  data: unknown;
  error: PgErrorLike | null;
  count?: number | null;
}

/** The PostgREST builder methods the alias reads use. */
interface Filterable extends PromiseLike<QueryResult> {
  eq(column: string, value: string): Filterable;
  is(column: string, value: null): Filterable;
  not(column: string, operator: string, value: null): Filterable;
  in(column: string, values: readonly string[]): Filterable;
  or(filters: string): Filterable;
  gte(column: string, value: string): Filterable;
  lte(column: string, value: string): Filterable;
  order(column: string, o: { ascending: boolean }): Filterable;
  range(from: number, to: number): Filterable;
}

/** Which entries a route lists (blueprint §4 rows #15, #19, #24, #26). */
export type LegacyScope =
  | { kind: 'team_mine'; teamId: string; userId: string }
  | { kind: 'team'; teamId: string }
  | { kind: 'project_mine'; projectId: string; userId: string }
  | {
      kind: 'project';
      projectId: string;
      viewerId: string;
      /** F1: assignments of the filtered person the viewer may not name. */
      hiddenAssignmentIds: string[];
    };

interface Filters {
  status?: LegacyEntryStatus;
  project_id?: string;
  member_user_id?: string;
  task_status?: string;
  from?: string;
  to?: string;
}

/** R9 cost of a summary: every row (self, or a team whose cost the viewer reads), own rows only, or none. */
type SummaryCost = 'all' | 'own' | 'none';

function sameId(a: string | null | undefined, b: string | null | undefined) {
  return (a ?? '').toLowerCase() === (b ?? '').toLowerCase();
}

function distinct(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

function chunks<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += IN_CHUNK) {
    out.push(items.slice(i, i + IN_CHUNK));
  }
  return out;
}

function toAuthRow(row: EntryAuthRow): EntryAuthRow {
  return {
    id: row.id,
    member_user_id: row.member_user_id,
    project_id: row.project_id,
    context_kind: row.context_kind,
    context_ref: row.context_ref,
    team_id: row.team_id,
    workspace_id: row.workspace_id,
    engagement_assignment_id: row.engagement_assignment_id,
    timesheet_id: row.timesheet_id,
    started_at: row.started_at,
  };
}

/** A synthetic assignment row for the identity predicate (the P12 person-filter probe pattern). */
function assignmentProbe(
  assignmentId: string,
  memberId: string,
  projectId: string,
): EntryAuthRow {
  return {
    id: assignmentId,
    member_user_id: memberId,
    project_id: projectId,
    context_kind: 'assignment',
    context_ref: assignmentId,
    team_id: null,
    workspace_id: null,
    engagement_assignment_id: assignmentId,
    timesheet_id: null,
    started_at: new Date(0).toISOString(),
  };
}

/** Personal time is member-only: another person's personal entry is never read on a project route. */
function personalOrGroup(viewerId: string): string[] {
  return UUID_RE.test(viewerId)
    ? ['context_kind.neq.personal', `member_user_id.eq.${viewerId}`]
    : ['context_kind.neq.personal'];
}

function clampPage(q: Pick<ListLogsQueryDto, 'page' | 'limit'>) {
  const page = Math.max(1, Math.trunc(Number(q.page) || 1));
  const limit = Math.min(
    ALIAS_LIST_MAX_LIMIT,
    Math.max(1, Math.trunc(Number(q.limit) || ALIAS_LIST_DEFAULT_LIMIT)),
  );
  return { page, limit };
}

@Injectable()
export class TeamTimeLegacyService {
  private readonly logger = new Logger(TeamTimeLegacyService.name);

  constructor(
    @Inject(SUPABASE_ADMIN) private readonly sb: SupabaseClient,
    private readonly authority: TimeAuthorityService,
    private readonly entries: TimeEntriesService,
    private readonly projectAuth: ProjectAuthorizationService,
  ) {}

  // ── The Row builder (reads and write responses) ────────────────────────────────────────────────────────

  /**
   * R1–R4 rows for views the caller already holds (hydrated reads, or a write result). Adds the legacy review
   * fields (ENTRY_LEGACY_REVIEW_SELECT), the sheet decider's profile (one profiles query for the page, CC13) and
   * `limit_context` (capContext, D36). `cost: false` strips cost even where the view carries it (project routes).
   * `write: true` makes the extras best effort: the write has committed, so a failed extras read is logged and the
   * row goes out without them instead of turning a saved change into a 500.
   */
  async rows(
    views: TimeEntryView[],
    o: { cost: boolean; write?: boolean },
  ): Promise<LegacyTaskTimeLog[]> {
    if (views.length === 0) return [];
    let reviews = new Map<string, LegacyReviewRow>();
    let caps = new Map<string, CapContext>();
    let deciders = new Map<string, LegacyReviewerEmbed>();
    try {
      [reviews, caps] = await Promise.all([
        this.legacyReviews(distinct(views.map((v) => v.id))),
        this.entries.capContext(views),
      ]);
      const deciderIds = distinct(
        views
          .filter((v) => sheetDecisionApplies(v))
          .map((v) => v.timesheet?.decided_by ?? null),
      );
      deciders = await this.profiles(deciderIds);
    } catch (error) {
      if (!o.write) throw error;
      this.logger.warn(
        `team-time alias row extras failed after a write: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return views.map((v) =>
      toLegacyLog(v, {
        review: reviews.get(v.id.toLowerCase()) ?? null,
        deciders,
        limitContext: caps.get(v.id) ?? null,
        cost: o.cost,
      }),
    );
  }

  // ── Team routes (#15, #16, #18–#22) ────────────────────────────────────────────────────────────────────

  /** #15: the caller's own team-context entries of the team (team owner or member, else 404). */
  async listTeamMine(
    userId: string,
    teamId: string,
    q: ListLogsQueryDto,
  ): Promise<LegacyListResult> {
    await this.assertTeamMember(userId, teamId);
    return this.list(userId, { kind: 'team_mine', teamId, userId }, q, {
      withEmail: true,
      cost: true,
    });
  }

  /** #16: R9 over the same set; cost visible (self). Like the old route, `status`/`task_status` are ignored. */
  async teamMineSummary(
    userId: string,
    teamId: string,
    q: ListLogsQueryDto,
  ): Promise<LegacyLogsSummary> {
    await this.assertTeamMember(userId, teamId);
    return this.summary(
      userId,
      { kind: 'team_mine', teamId, userId },
      q,
      'all',
    );
  }

  /** #18 (D35): tasks only, the old flat shape; team owner or member, then `access.roadmap` (workItems). */
  async teamTasks(
    userId: string,
    teamId: string,
    projectId: string,
  ): Promise<ProjectTaskOption[]> {
    await this.assertTeamMember(userId, teamId);
    return (await this.entries.workItems(userId, projectId)).tasks;
  }

  /** #19: every team-context entry of the team, for a team manager (else 404); cost per row, emails. */
  async listTeam(
    userId: string,
    teamId: string,
    q: ListLogsQueryDto,
  ): Promise<LegacyListResult> {
    await this.assertTeamManager(userId, teamId);
    return this.list(userId, { kind: 'team', teamId }, q, {
      withEmail: true,
      cost: true,
    });
  }

  /** #20: R9 over #19's set (`project_id`, `member_user_id`, `from`, `to`). Fees over cost-visible rows: every
   *  row when the viewer reads the team's cost, else only their own. */
  async teamSummary(
    userId: string,
    teamId: string,
    q: ListLogsQueryDto,
  ): Promise<LegacyLogsSummary> {
    await this.assertTeamManager(userId, teamId);
    const verdict = await this.teamCostVisible(userId, teamId);
    return this.summary(
      userId,
      { kind: 'team', teamId },
      q,
      verdict ? 'all' : 'own',
    );
  }

  /** #21: today's query (team-time.service.ts:1200-1218), team owner or member. */
  async teamProjects(userId: string, teamId: string): Promise<LegacyProject[]> {
    await this.assertTeamMember(userId, teamId);
    const { data, error } = await this.sb
      .from('project_teams')
      .select('project:projects!project_teams_project_id_fkey(id, title)')
      .eq('team_id', teamId);
    if (error) this.readFail('teamProjects', error);
    const seen = new Map<string, LegacyProject>();
    for (const row of (data ?? []) as unknown as Array<{
      project: { id: string; title: string | null } | null;
    }>) {
      if (row.project && !seen.has(row.project.id)) {
        seen.set(row.project.id, {
          id: row.project.id,
          title: row.project.title ?? '',
        });
      }
    }
    return [...seen.values()];
  }

  /** #22: today's query (team-time.service.ts:1219-1253); the email is selected only for a team manager. */
  async teamMembers(userId: string, teamId: string): Promise<LegacyMember[]> {
    await this.assertTeamMember(userId, teamId);
    const manager = await this.authority.isTeamManager(teamId, userId);
    const { data, error } = await this.sb
      .from('team_members')
      .select(
        manager
          ? 'user:profiles!team_members_user_id_fkey(id, display_name, avatar_url, email)'
          : 'user:profiles!team_members_user_id_fkey(id, display_name, avatar_url)',
      )
      .eq('team_id', teamId);
    if (error) this.readFail('teamMembers', error);
    const out: LegacyMember[] = [];
    for (const row of (data ?? []) as unknown as Array<{
      user: {
        id: string;
        display_name: string | null;
        avatar_url?: string | null;
        email?: string | null;
      } | null;
    }>) {
      if (!row.user) continue;
      const member: LegacyMember = {
        id: row.user.id,
        display_name: row.user.display_name ?? null,
        avatar_url: row.user.avatar_url ?? null,
      };
      if (manager) member.email = row.user.email ?? null;
      out.push(member);
    }
    return out;
  }

  // ── Project routes (#23–#28) ───────────────────────────────────────────────────────────────────────────

  /** #23 (D01): project access (404), then today's typed shape with nothing to enforce. */
  async contractStatus(
    userId: string,
    projectId: string,
  ): Promise<LegacyContractStatus> {
    await this.projectPermissions(userId, projectId);
    return { enforcement: 'off', engagement_status: 'engaged' };
  }

  /** #24: the caller's own entries on the project, personal included; project access (404). */
  async listProjectMine(
    userId: string,
    projectId: string,
    q: ListLogsQueryDto,
  ): Promise<LegacyListResult> {
    await this.projectPermissions(userId, projectId);
    return this.list(userId, { kind: 'project_mine', projectId, userId }, q, {
      withEmail: true,
      cost: true,
    });
  }

  /** #25: R9 over #24's set; cost visible (self). */
  async projectMineSummary(
    userId: string,
    projectId: string,
    q: ListLogsQueryDto,
  ): Promise<LegacyLogsSummary> {
    await this.projectPermissions(userId, projectId);
    return this.summary(
      userId,
      { kind: 'project_mine', projectId, userId },
      q,
      'all',
    );
  }

  /** #26: `time.view_team_logs` (403 missing_permission; no access 404). Non-personal entries plus the caller's
   *  own personal ones; no cost, no email; masked rows (D32). A person filter never reveals masked time (F1). */
  async listProject(
    userId: string,
    projectId: string,
    q: ListLogsQueryDto,
  ): Promise<LegacyListResult> {
    await this.assertProjectTeamLogs(userId, projectId);
    const scope = await this.projectScope(userId, projectId, q.member_user_id);
    return this.list(userId, scope, q, { withEmail: false, cost: false });
  }

  /** #27: R9 over #26's set, never with cost (`buckets: {}`, `currencies: []`). */
  async projectSummary(
    userId: string,
    projectId: string,
    q: ListLogsQueryDto,
  ): Promise<LegacyLogsSummary> {
    await this.assertProjectTeamLogs(userId, projectId);
    const scope = await this.projectScope(userId, projectId, q.member_user_id);
    return this.summary(userId, scope, q, 'none');
  }

  /**
   * #28: today's query (team-time.service.ts:1155-1199) under #26's gate and visibility: the people who logged
   * non-personal time on the project (plus the caller's own personal time), without email. A worker the caller
   * may not name appears once per assignment as "Delivery team member" with the row's `masked:` id (D32).
   */
  async projectMembers(
    userId: string,
    projectId: string,
  ): Promise<LegacyMember[]> {
    await this.assertProjectTeamLogs(userId, projectId);
    const visibleIds: string[] = [];
    const pairs = new Map<string, { assignmentId: string; memberId: string }>();
    for (let offset = 0; offset < MAX_SCAN_ROWS; offset += PAGE_ROWS) {
      const { data, error } = await this.entryQuery(
        'id, member_user_id, context_kind, engagement_assignment_id',
        false,
      )
        .eq('project_id', projectId)
        .not('member_user_id', 'is', null)
        .or(personalOrGroup(userId).join(','))
        .order('id', { ascending: true })
        .range(offset, offset + PAGE_ROWS - 1);
      if (error) this.readFail('projectMembers', error);
      const page = (data ?? []) as Array<{
        member_user_id: string | null;
        context_kind: string;
        engagement_assignment_id: string | null;
      }>;
      for (const row of page) {
        if (!row.member_user_id) continue;
        if (row.context_kind === 'assignment' && row.engagement_assignment_id) {
          const key =
            `${row.engagement_assignment_id}|${row.member_user_id}`.toLowerCase();
          if (!pairs.has(key)) {
            pairs.set(key, {
              assignmentId: row.engagement_assignment_id,
              memberId: row.member_user_id,
            });
          }
        } else {
          visibleIds.push(row.member_user_id);
        }
      }
      if (page.length < PAGE_ROWS) break;
    }

    const masked: string[] = [];
    if (pairs.size > 0) {
      const probes = [...pairs.entries()].map(([key, p]) => ({
        ...assignmentProbe(p.assignmentId, p.memberId, projectId),
        id: key,
      }));
      const visible = await this.authority.identityVisible(userId, probes);
      for (const [key, p] of pairs) {
        if (visible.has(key)) visibleIds.push(p.memberId);
        else masked.push(p.assignmentId);
      }
    }

    const ids = distinct(visibleIds);
    const profiles = new Map<
      string,
      { id: string; display_name: string | null; avatar_url?: string | null }
    >();
    for (const part of chunks(ids)) {
      const { data, error } = await this.sb
        .from('profiles')
        .select('id, display_name, avatar_url')
        .in('id', part);
      if (error) this.readFail('projectMembers.profiles', error);
      for (const p of (data ?? []) as Array<{
        id: string;
        display_name: string | null;
        avatar_url?: string | null;
      }>) {
        profiles.set(p.id.toLowerCase(), p);
      }
    }
    const out: LegacyMember[] = [];
    for (const id of ids) {
      const p = profiles.get(id.toLowerCase());
      if (p) {
        out.push({
          id: p.id,
          display_name: p.display_name ?? null,
          avatar_url: p.avatar_url ?? null,
        });
      }
    }
    for (const assignmentId of distinct(masked)) {
      out.push({
        id: maskedMemberId(assignmentId),
        display_name: ALIAS_MASKED_MEMBER_NAME,
        avatar_url: null,
      });
    }
    return out;
  }

  // ── Lists and summaries ────────────────────────────────────────────────────────────────────────────────

  /** R9 `listLogs` on time_entries: R1 status, page/limit (default 50, max 200), count 'exact', newest first. */
  private async list(
    viewerId: string,
    scope: LegacyScope,
    q: ListLogsQueryDto,
    o: { withEmail: boolean; cost: boolean },
  ): Promise<LegacyListResult> {
    const { page, limit } = clampPage(q);
    const select = q.task_status
      ? `${ENTRY_AUTH_SELECT}, ${TASK_STATUS_EMBED}`
      : ENTRY_AUTH_SELECT;
    const offset = (page - 1) * limit;
    const { data, error, count } = await this.applyScope(
      this.entryQuery(select, true),
      scope,
      {
        status: q.status,
        project_id: q.project_id,
        member_user_id: q.member_user_id,
        task_status: q.task_status,
        from: q.from,
        to: q.to,
      },
    )
      .order('started_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) this.readFail('list', error);
    const authRows = ((data ?? []) as EntryAuthRow[]).map(toAuthRow);
    const views = await this.authority.hydrate(viewerId, authRows, {
      withEmail: o.withEmail,
    });
    const items = await this.rows(views, { cost: o.cost });
    return {
      items,
      total: typeof count === 'number' ? count : items.length,
    };
  }

  /** R9 `logsSummary` on time_entries (`project_id`, `member_user_id`, `from`, `to`, as the old summaries). */
  private async summary(
    viewerId: string,
    scope: LegacyScope,
    q: ListLogsQueryDto,
    cost: SummaryCost,
  ): Promise<LegacyLogsSummary> {
    const filters: Filters = {
      project_id: q.project_id,
      member_user_id: q.member_user_id,
      from: q.from,
      to: q.to,
    };
    const rows = await this.summaryRows(
      cost === 'all'
        ? `${SUMMARY_SELECT}, ${SUMMARY_COST_COLUMNS}`
        : SUMMARY_SELECT,
      scope,
      filters,
    );
    if (cost !== 'own') return legacySummary(rows);
    // A team whose cost the viewer may not read: fees from the viewer's own rows only (R4).
    const own =
      filters.member_user_id && !sameId(filters.member_user_id, viewerId)
        ? []
        : await this.summaryRows(
            `${SUMMARY_SELECT}, ${SUMMARY_COST_COLUMNS}`,
            scope,
            { ...filters, member_user_id: viewerId },
          );
    return legacySummary(rows, own);
  }

  private async summaryRows(
    select: string,
    scope: LegacyScope,
    filters: Filters,
  ): Promise<LegacySummaryRow[]> {
    const out: LegacySummaryRow[] = [];
    for (let offset = 0; ; offset += PAGE_ROWS) {
      const { data, error } = await this.applyScope(
        this.entryQuery(select, false),
        scope,
        filters,
      )
        .order('id', { ascending: true })
        .range(offset, offset + PAGE_ROWS - 1);
      if (error) this.readFail('summary', error);
      const page = (data ?? []) as LegacySummaryRow[];
      out.push(...page);
      if (page.length < PAGE_ROWS) break;
    }
    return out;
  }

  /** The route's scope, then the request's filters (old listLogs semantics: raw `from`/`to` on started_at). */
  private applyScope(
    query: Filterable,
    scope: LegacyScope,
    f: Filters,
  ): Filterable {
    const orGroups: string[][] = [];
    let q = query;
    switch (scope.kind) {
      case 'team_mine':
        q = q
          .eq('context_kind', 'team')
          .eq('team_id', scope.teamId)
          .eq('member_user_id', scope.userId);
        if (f.project_id) q = q.eq('project_id', f.project_id);
        break;
      case 'team':
        q = q.eq('context_kind', 'team').eq('team_id', scope.teamId);
        if (f.project_id) q = q.eq('project_id', f.project_id);
        if (f.member_user_id) q = q.eq('member_user_id', f.member_user_id);
        break;
      case 'project_mine':
        q = q
          .eq('project_id', scope.projectId)
          .eq('member_user_id', scope.userId);
        break;
      case 'project':
        q = q.eq('project_id', scope.projectId);
        orGroups.push(personalOrGroup(scope.viewerId));
        if (f.member_user_id) q = q.eq('member_user_id', f.member_user_id);
        if (scope.hiddenAssignmentIds.length > 0) {
          orGroups.push([
            'engagement_assignment_id.is.null',
            `engagement_assignment_id.not.in.(${scope.hiddenAssignmentIds.join(',')})`,
          ]);
        }
        break;
    }
    if (f.status) q = applyLegacyStatusFilter(q, f.status, orGroups);
    if (f.task_status) q = q.eq('task.status', f.task_status);
    if (f.from) q = q.gte('started_at', f.from);
    if (f.to) q = q.lte('started_at', f.to);
    const or = andOfOrGroups(orGroups);
    return or ? q.or(or) : q;
  }

  /** #26/#27 scope; F1: a person filter naming someone else drops their assignments the caller may not name. */
  private async projectScope(
    viewerId: string,
    projectId: string,
    memberId: string | undefined,
  ): Promise<LegacyScope> {
    const hiddenAssignmentIds =
      memberId && !sameId(memberId, viewerId)
        ? await this.hiddenAssignments(viewerId, projectId, memberId)
        : [];
    return { kind: 'project', projectId, viewerId, hiddenAssignmentIds };
  }

  /** Every assignment of `memberId` on the project (all pages), then the identity predicate per assignment. */
  private async hiddenAssignments(
    viewerId: string,
    projectId: string,
    memberId: string,
  ): Promise<string[]> {
    const ids: string[] = [];
    for (let offset = 0; ; offset += PAGE_ROWS) {
      const { data, error } = await this.entryQuery(
        'id, engagement_assignment_id',
        false,
      )
        .eq('project_id', projectId)
        .eq('member_user_id', memberId)
        .eq('context_kind', 'assignment')
        .not('engagement_assignment_id', 'is', null)
        .order('engagement_assignment_id', { ascending: true })
        .order('id', { ascending: true })
        .range(offset, offset + PAGE_ROWS - 1);
      if (error) this.readFail('hiddenAssignments', error);
      const page = (data ?? []) as Array<{
        engagement_assignment_id: string | null;
      }>;
      for (const row of page) ids.push(row.engagement_assignment_id ?? '');
      if (page.length < PAGE_ROWS) break;
    }
    const assignments = distinct(ids);
    if (assignments.length === 0) return [];
    const visible = await this.authority.identityVisible(
      viewerId,
      assignments.map((a) => assignmentProbe(a, memberId, projectId)),
    );
    return assignments.filter((a) => !visible.has(a));
  }

  /** costVisible's team verdict (manager, member rates on, `time_team_rules`), asked with one synthetic row. */
  private async teamCostVisible(
    viewerId: string,
    teamId: string,
  ): Promise<boolean> {
    const probe: EntryAuthRow = {
      id: TEAM_COST_PROBE_ID,
      member_user_id: null,
      project_id: null,
      context_kind: 'team',
      context_ref: teamId,
      team_id: teamId,
      workspace_id: null,
      engagement_assignment_id: null,
      timesheet_id: null,
      started_at: new Date(0).toISOString(),
    };
    const visible = await this.authority.costVisible(viewerId, [probe]);
    return visible.has(TEAM_COST_PROBE_ID);
  }

  // ── Row extras ─────────────────────────────────────────────────────────────────────────────────────────

  /** ENTRY_LEGACY_REVIEW_SELECT per id, keyed by lower-case id. */
  private async legacyReviews(
    ids: string[],
  ): Promise<Map<string, LegacyReviewRow>> {
    const out = new Map<string, LegacyReviewRow>();
    for (const part of chunks(ids)) {
      const { data, error } = await this.sb
        .from('time_entries')
        .select(ENTRY_LEGACY_REVIEW_SELECT)
        .in('id', part);
      if (error) this.readFail('legacyReviews', error);
      for (const row of (data ?? []) as unknown as LegacyReviewRow[]) {
        out.set(row.id.toLowerCase(), row);
      }
    }
    return out;
  }

  /** `{id, display_name, avatar_url}` per profile, keyed by lower-case id. */
  private async profiles(
    ids: string[],
  ): Promise<Map<string, LegacyReviewerEmbed>> {
    const out = new Map<string, LegacyReviewerEmbed>();
    for (const part of chunks(ids)) {
      const { data, error } = await this.sb
        .from('profiles')
        .select(REVIEWER_SELECT)
        .in('id', part);
      if (error) this.readFail('profiles', error);
      for (const p of (data ?? []) as LegacyReviewerEmbed[]) {
        out.set(p.id.toLowerCase(), {
          id: p.id,
          display_name: p.display_name ?? null,
          avatar_url: p.avatar_url ?? null,
        });
      }
    }
    return out;
  }

  // ── Authority ──────────────────────────────────────────────────────────────────────────────────────────

  /** The team owner or a team_members row, else 404 (old assertTeamMember answered 403). Never feature-gated. */
  private async assertTeamMember(
    userId: string,
    teamId: string,
  ): Promise<void> {
    const { data, error } = await this.sb
      .from('teams')
      .select('id, owner_id')
      .eq('id', teamId)
      .maybeSingle();
    if (error) {
      if (error.code === INVALID_TEXT_REPRESENTATION) {
        throw timeNotFound('scope');
      }
      this.readFail('team', error);
    }
    const team = data as { id: string; owner_id: string | null } | null;
    if (!team) throw timeNotFound('scope');
    if (sameId(team.owner_id, userId)) return;
    const { count, error: memberError } = await this.sb
      .from('team_members')
      .select('user_id', { count: 'exact', head: true })
      .eq('team_id', teamId)
      .eq('user_id', userId);
    if (memberError) this.readFail('teamMember', memberError);
    if (!count) throw timeNotFound('scope');
  }

  /** The same set as the old assertTeamApprover (owner, or member role owner/admin), else 404. */
  private async assertTeamManager(
    userId: string,
    teamId: string,
  ): Promise<void> {
    if (!(await this.authority.isTeamManager(teamId, userId))) {
      throw timeNotFound('scope');
    }
  }

  /** The caller's permissions on the project: their share rows, or owner defaults for `projects.owner_id`;
   *  neither (or no project) is a 404. */
  private async projectPermissions(
    userId: string,
    projectId: string,
  ): Promise<ProjectPermissions> {
    const { data, error } = await this.sb
      .from('projects')
      .select('id, owner_id')
      .eq('id', projectId)
      .maybeSingle();
    if (error) {
      if (error.code === INVALID_TEXT_REPRESENTATION) {
        throw timeNotFound('scope');
      }
      this.readFail('project', error);
    }
    const project = data as { id: string; owner_id: string | null } | null;
    if (!project) throw timeNotFound('scope');
    let perms: ProjectPermissions | null;
    try {
      perms = await this.projectAuth.resolvePermissions(userId, projectId);
    } catch (e) {
      if (e instanceof HttpException) throw e;
      // resolvePermissions throws the raw Postgres message; never send it (D55, D68).
      this.logger.error(
        `resolvePermissions failed project=${projectId}: ${e instanceof Error ? e.message : String(e)}`,
      );
      throw new InternalServerErrorException({
        code: TIME_INTERNAL_CODE,
        message: READ_FAILED_MESSAGE,
      });
    }
    const resolved =
      perms ?? (sameId(project.owner_id, userId) ? ROLE_DEFAULTS.owner : null);
    if (!resolved) throw timeNotFound('scope');
    return resolved;
  }

  /** #26–#28: project access (404), then today's 403 `missing_permission` without `time.view_team_logs`. */
  private async assertProjectTeamLogs(
    userId: string,
    projectId: string,
  ): Promise<void> {
    const perms = await this.projectPermissions(userId, projectId);
    if (!getPermission(perms, 'time.view_team_logs')) {
      throw new MissingPermissionException({ path: 'time.view_team_logs' });
    }
  }

  // ── Plumbing ───────────────────────────────────────────────────────────────────────────────────────────

  private entryQuery(select: string, count: boolean): Filterable {
    return this.sb
      .from('time_entries')
      .select(
        select,
        count ? { count: 'exact' } : undefined,
      ) as unknown as Filterable;
  }

  /** D68: a mapped time sentinel throws as usual; anything else is a logged 500 with read copy. */
  private readFail(operation: string, error: PgErrorLike): never {
    const mapped = mapTimeDbError(error);
    if (mapped) throw mapped;
    this.logger.error(
      `TeamTimeLegacyService.${operation} failed: ${JSON.stringify({
        code: error?.code ?? null,
        message: error?.message ?? null,
        detail: error?.details ?? null,
        hint: error?.hint ?? null,
      })}`,
    );
    throw new InternalServerErrorException({
      code: TIME_INTERNAL_CODE,
      message: READ_FAILED_MESSAGE,
    });
  }
}
