// Time reports (backend.md "Endpoints" › reports, ux.md "Reports"). Four scopes, each with the authority query of
// its screen; every miss is a 404. Redaction is the time module's (L21, L22, L45): `hydrate` fetches a class only
// for the rows the viewer may read it on, and the client hirer's "Client hours" view is built from a client-safe
// select that never fetches notes, cost or the decision trail (CHANGE-7, D57).
import {
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import {
  type EngagementKind,
  EngagementsService,
  type EngagementView,
} from '../../marketplace/engagements/engagements.service';
import type { ExportColumn } from '../../marketplace/finance/exports/export-columns';
import {
  buildCsv,
  buildXlsx,
  type ExportRow,
} from '../../marketplace/finance/exports/export-formats';
import type { EntitlementRef } from '../../shared/entitlements/entitlement-keys';
import { EntitlementsService } from '../../shared/entitlements/entitlements.service';
import { ProjectAuthorizationService } from '../projects/authorization/project-authorization.service';
import { getPermission } from '../projects/permissions/project-permissions';
import type { AuditExportQueryDto, ReportQueryDto } from './dto/reports.dto';
import {
  HIDDEN_CONTENT_LABEL,
  MASKED_MEMBER_LABEL,
  TimeAuthorityService,
} from './time-authority.service';
import { ENTRY_AUTH_SELECT, ENTRY_IDENTITY_SELECT } from './time-entry.select';
import {
  mapTimeDbError,
  type PgErrorLike,
  TIME_INTERNAL_CODE,
  timeNotFound,
} from './time-errors';
import {
  addDays,
  localDate,
  localRangeToUtc,
  safeTimezone,
  weekWindow,
} from './time-periods';
import { TimePolicyService } from './time-policy.service';
import type {
  ClientHoursLevel,
  ContextKind,
  EntryAuthRow,
  EntryMember,
  EntryProject,
  EntrySource,
  EntryTask,
  ExportFile,
  Paged,
  ReportScope,
  ReportSummary,
  TimeEntryView,
  TimesheetStatus,
  WorkItem,
  WorkType,
} from './time.types';

// ── Shared helpers (finance readers use them too) ────────────────────────────────────────────────────────────

/** CHANGE-5 Approved, second half: `legacy_status IS DISTINCT FROM 'rejected'`, as one PostgREST or-group. */
export const NOT_LEGACY_REJECTED_OR = [
  'legacy_status.is.null',
  'legacy_status.neq.rejected',
] as const;

/**
 * One `.or()` value that ANDs several or-groups, `and(or(a,b),or(c,d))`, so a query never depends on how
 * PostgREST combines two `or=` parameters. A single group is sent as it is. Null when there is nothing to add.
 */
export function andOfOrGroups(
  groups: ReadonlyArray<readonly string[]>,
): string | null {
  const live = groups.filter((g) => g.length > 0);
  if (live.length === 0) return null;
  if (live.length === 1) return live[0].join(',');
  return `and(${live.map((g) => `or(${g.join(',')})`).join(',')})`;
}

/** Read-path copy for an unmapped database error (D55 forbids Postgres text in a response). */
export const TIME_READ_FAILED_MESSAGE =
  "Proyekto couldn't load this time. Try again.";

/** A mapped time sentinel throws as usual; anything else is logged and becomes a fixed-copy 500 (D55). */
export function failTimeRead(
  logger: Logger,
  operation: string,
  error: PgErrorLike,
  message: string = TIME_READ_FAILED_MESSAGE,
): never {
  const mapped = mapTimeDbError(error);
  if (mapped) throw mapped;
  logger.error(
    `${operation} failed: ${JSON.stringify({
      code: error?.code ?? null,
      message: error?.message ?? null,
      detail: error?.details ?? null,
      hint: error?.hint ?? null,
    })}`,
  );
  throw new InternalServerErrorException({ code: TIME_INTERNAL_CODE, message });
}

// ── Constants ────────────────────────────────────────────────────────────────────────────────────────────────

const SCOPE_PATTERN =
  /^(team|project|workspace|engagement):([0-9a-fA-F-]{36})$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const INVALID_TEXT_REPRESENTATION = '22P02';
/** PostgREST 416: a counted read asked for an offset past the last row. */
const RANGE_NOT_SATISFIABLE = 'PGRST103';

/** Rows per internal page (summary, export, audit export). */
const PAGE_ROWS = 1000;
/** Rows hydrated per call when an export builds its file. */
const HYDRATE_CHUNK = 200;
/** `.in()` lists are chunked so a URL never grows past what PostgREST accepts. */
const IN_CHUNK = 100;
/** An export holds its rows in memory: past this it asks for a shorter range. */
export const EXPORT_MAX_ROWS = 10_000;

/** An unhomed subject: Free limits, never the exempt raw `null` (D26). */
const UNHOMED: EntitlementRef = { workspaceId: null, exempt: false };

const SHEET_FILTER_EMBED =
  'timesheets!timesheet_id!inner(status, policy_workspace_id, engagement_id)';
const SHEET_STATUS_EMBED = 'timesheets!timesheet_id(status)';

const SUMMARY_SELECT =
  ENTRY_AUTH_SELECT +
  ', duration_seconds, payable_seconds, legacy_status, work_item, context_label_snapshot';

/** Content labels for grouping only: no note (column hints only, §0). */
const LABEL_CONTENT_SELECT =
  'id, task_id, task:roadmap_tasks!task_id(id, title), project:projects!project_id(id, title)';
const SUMMARY_COST_SELECT = 'id, currency_snapshot, amount_snapshot';

/** Client hours (ux.md: "date, task and hours per entry. Never notes, identity, cost or rate"). */
const CLIENT_BASE_SELECT =
  'id, context_kind, work_item, started_at, payable_seconds, source, work_type_snapshot, project_id, ' +
  'created_at, updated_at';
const CLIENT_CONTENT_SELECT =
  'id, task_id, task:roadmap_tasks!task_id(id, title, work_type, status), project:projects!project_id(id, title)';

const AUDIT_EVENT_SELECT =
  'id, timesheet_id, actor_user_id, event, from_status, to_status, note, total_seconds, payable_seconds, ' +
  'revision, created_at, timesheets!timesheet_id!inner(policy_workspace_id, scope_kind, engagement_id, ' +
  'member_display_name_snapshot, scope_label_snapshot, period_start, period_end)';
const AUDIT_POLICY_SELECT =
  'id, policy_id, actor_user_id, changes, scope, team_id, workspace_id, created_at';

export const WORK_ITEM_LABEL: Record<WorkItem, string> = {
  task: 'Task',
  meeting: 'Meeting',
  review: 'Review',
  admin: 'Admin',
  other: 'Other',
};

const CONTEXT_KIND_LABEL: Record<ContextKind, string> = {
  team: 'Team',
  workspace: 'Workspace',
  assignment: 'Agreement',
  personal: 'Just me',
};

const SHEET_STATUSES: TimesheetStatus[] = [
  'open',
  'submitted',
  'returned',
  'approved',
];

const CONTENT_TYPES = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
} as const;

// ── Internal types ───────────────────────────────────────────────────────────────────────────────────────────

/** The PostgREST builder methods these queries use (supabase-js returns `this` from each). */
interface Filterable extends PromiseLike<QueryResult> {
  eq(column: string, value: string): Filterable;
  neq(column: string, value: string): Filterable;
  in(column: string, values: readonly string[]): Filterable;
  not(column: string, operator: string, value: null): Filterable;
  or(filters: string): Filterable;
  gte(column: string, value: string): Filterable;
  lt(column: string, value: string): Filterable;
  order(column: string, o: { ascending: boolean }): Filterable;
  range(from: number, to: number): Filterable;
  limit(count: number): Filterable;
}
interface QueryResult {
  data: unknown;
  error: PgErrorLike | null;
  count?: number | null;
}

type GroupBy = NonNullable<ReportQueryDto['group_by']>;

interface ScopeInfo {
  scope: ReportScope;
  planRef: EntitlementRef;
  /** The scope policy's ISO week start when the scope read already knows it (engagement); else read on demand. */
  weekStart: number | null;
  /** Project scope: the project's workspace, whose policy dates the report (timezone, week start). */
  policyWorkspaceId: string | null;
  engagementKind: EngagementKind | null;
  /** The hirer of a client engagement: approved hours only, no identity (bar D57), no note, no cost. */
  clientView: boolean;
  clientLevel: ClientHoursLevel | null;
  /** Client engagement: (a) assignment ids, (b) provider team on linked projects (backend.md "Invoices"). */
  clientAssignmentIds: string[];
  providerTeamId: string | null;
  linkedProjectIds: string[];
}

interface DateRange {
  from: string;
  to: string;
  fromIso: string;
  toExclusiveIso: string;
}

interface EntryFilters {
  range: DateRange;
  memberUserId: string | null;
  status: TimesheetStatus | null;
  contextKind: Exclude<ContextKind, 'personal'> | null;
  /** Assignment ids whose worker the viewer may not name: excluded when filtering by that member. */
  hiddenAssignmentIds: string[];
  approvedOnly: boolean;
}

interface SheetJoin {
  status?: TimesheetStatus | null;
}

interface SummaryRow extends EntryAuthRow {
  duration_seconds: number | null;
  payable_seconds: number | null;
  legacy_status: string | null;
  work_item: WorkItem;
  context_label_snapshot: string | null;
  timesheets?: SheetJoin | SheetJoin[] | null;
}

interface IdentityRow {
  id: string;
  member_user_id: string | null;
  member_display_name_snapshot: string | null;
  member: EntryMember | null;
}

interface LabelContentRow {
  id: string;
  task_id: string | null;
  task: { id: string; title: string | null } | null;
  project: { id: string; title: string | null } | null;
}

interface CostLabelRow {
  id: string;
  currency_snapshot: string | null;
  amount_snapshot: number | string | null;
}

interface ClientBaseRow {
  id: string;
  context_kind: ContextKind;
  work_item: WorkItem;
  started_at: string;
  payable_seconds: number | null;
  source: EntrySource;
  work_type_snapshot: WorkType;
  project_id: string | null;
  created_at: string;
  updated_at: string;
}

interface ClientContentRow {
  id: string;
  task_id: string | null;
  task: EntryTask | null;
  project: EntryProject | null;
}

interface AuditSheetJoin {
  policy_workspace_id: string | null;
  scope_kind: string;
  engagement_id: string | null;
  member_display_name_snapshot: string | null;
  scope_label_snapshot: string | null;
  period_start: string;
  period_end: string;
}

interface AuditEventRow {
  id: number;
  timesheet_id: string;
  actor_user_id: string | null;
  event: string;
  from_status: string | null;
  to_status: string;
  note: string | null;
  total_seconds: number | null;
  payable_seconds: number | null;
  revision: number;
  created_at: string;
  timesheets: AuditSheetJoin | AuditSheetJoin[] | null;
}

interface AuditPolicyRow {
  id: number;
  policy_id: string | null;
  actor_user_id: string | null;
  changes: unknown;
  scope: string | null;
  team_id: string | null;
  workspace_id: string | null;
  created_at: string;
}

interface GroupAcc {
  key: string;
  label: string;
  total_seconds: number;
  payable_seconds: number;
  amounts: Map<string, number>;
}

// ── Pure helpers ─────────────────────────────────────────────────────────────────────────────────────────────

function distinct(values: Array<string | null | undefined>): string[] {
  return [
    ...new Set(
      values.filter((v): v is string => typeof v === 'string' && v !== ''),
    ),
  ];
}

function chunks<T>(items: T[], size = IN_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size));
  return out;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function hours(seconds: number | null | undefined): number | null {
  if (seconds === null || seconds === undefined) return null;
  return round2(Number(seconds) / 3600);
}

function numberOrNull(value: number | string | null | undefined) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function one<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/** CHANGE-5 Approved. */
export function isApproved(row: {
  payable_seconds: number | null;
  legacy_status: string | null;
}): boolean {
  return (
    row.payable_seconds !== null &&
    row.payable_seconds !== undefined &&
    row.legacy_status !== 'rejected'
  );
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

function normaliseLevel(level: string | null | undefined): ClientHoursLevel {
  return level === 'summary' || level === 'detailed' ? level : 'none';
}

function sanitiseFilePart(value: string): string {
  return value.replace(/[^0-9A-Za-z-]/g, '');
}

/** 1..7, else Monday (the SQL default week start). */
function weekStartOrMonday(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 7 ? n : 1;
}

const MONTH_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/**
 * Pure (A5). The label of the 7-day week starting on local date `start` (ux.md "Formats"): "Sep 22–28" within a
 * month, "Sep 29–Oct 5" across months, and "Dec 29, 2025–Jan 4, 2026" across years (the key carries the year
 * otherwise; the web adds it when it is not the current one).
 */
export function weekLabel(start: string): string {
  const end = addDays(start, 6);
  const [sy, sm, sd] = start.split('-').map(Number);
  const [ey, em, ed] = end.split('-').map(Number);
  const startMonth = MONTH_SHORT[sm - 1];
  const endMonth = MONTH_SHORT[em - 1];
  if (sy !== ey) {
    return `${startMonth} ${sd}, ${sy}–${endMonth} ${ed}, ${ey}`;
  }
  if (sm !== em) return `${startMonth} ${sd}–${endMonth} ${ed}`;
  return `${startMonth} ${sd}–${ed}`;
}

@Injectable()
export class TimeReportsService {
  private readonly logger = new Logger(TimeReportsService.name);

  constructor(
    @Inject(SUPABASE_ADMIN) private readonly sb: SupabaseClient,
    private readonly authority: TimeAuthorityService,
    private readonly policy: TimePolicyService,
    private readonly entitlements: EntitlementsService,
    private readonly engagements: EngagementsService,
    private readonly projectAuth: ProjectAuthorizationService,
  ) {}

  /** 404 on miss */
  async resolveScope(viewerId: string, scope: string): Promise<ReportScope> {
    return (await this.scopeInfo(viewerId, scope)).scope;
  }

  async entries(
    viewerId: string,
    q: ReportQueryDto,
  ): Promise<Paged<TimeEntryView>> {
    const info = await this.scopeInfo(viewerId, q.scope);
    // "Client hours" at summary shows hours by week, never one row per entry.
    if (info.clientView && info.clientLevel !== 'detailed') {
      throw timeNotFound('scope');
    }
    const page = Math.max(1, Math.trunc(q.page ?? 1));
    const limit = Math.min(200, Math.max(1, Math.trunc(q.limit ?? 100)));
    const range = this.range(q, info.scope.timezone);
    const filters = await this.filtersFor(viewerId, info, q, range);
    if (!filters) return { items: [], total: 0, page, limit };

    const select = this.needsSheetJoin(info, filters)
      ? `${ENTRY_AUTH_SELECT}, ${SHEET_FILTER_EMBED}`
      : ENTRY_AUTH_SELECT;
    const offset = (page - 1) * limit;
    const { data, error, count } = await this.applyFilters(
      this.entryQuery(select, true),
      info,
      filters,
    )
      .order('started_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) {
      // A counted read whose offset is past the last row is PostgREST's 416 PGRST103: a page past the end is an
      // empty page with the real total (a count-only read of the same query), never a 500.
      if (error.code === RANGE_NOT_SATISFIABLE) {
        const head = await this.applyFilters(
          this.entryQuery(select, 'head'),
          info,
          filters,
        );
        if (head.error) this.fail('entries.count', head.error);
        return { items: [], total: head.count ?? 0, page, limit };
      }
      this.fail('entries', error);
    }
    const rows = ((data ?? []) as EntryAuthRow[]).map(toAuthRow);
    const items = await this.hydrateFor(viewerId, info, rows);
    return { items, total: count ?? offset + rows.length, page, limit };
  }

  async summary(viewerId: string, q: ReportQueryDto): Promise<ReportSummary> {
    const info = await this.scopeInfo(viewerId, q.scope);
    const range = this.range(q, info.scope.timezone);
    const groupBy = this.groupByFor(info, q.group_by);
    const filters = await this.filtersFor(viewerId, info, q, range);
    // A5: weeks of the scope's policy (its timezone and week start), read only when grouping by week.
    const weekStart = groupBy === 'week' ? await this.weekStartFor(info) : 1;

    const groups = new Map<string, GroupAcc>();
    const sheetsByStatus = new Map<TimesheetStatus, Set<string>>(
      SHEET_STATUSES.map((s) => [s, new Set<string>()]),
    );
    let totalSeconds = 0;
    let payableSeconds = 0;

    if (filters) {
      const embed = this.needsSheetJoin(info, filters)
        ? SHEET_FILTER_EMBED
        : SHEET_STATUS_EMBED;
      for (let offset = 0; ; offset += PAGE_ROWS) {
        const { data, error } = await this.applyFilters(
          this.entryQuery(`${SUMMARY_SELECT}, ${embed}`, false),
          info,
          filters,
        )
          .order('started_at', { ascending: true })
          .order('id', { ascending: true })
          .range(offset, offset + PAGE_ROWS - 1);
        if (error) this.fail('summary', error);
        const rows = (data ?? []) as SummaryRow[];
        const labels = await this.groupLabels(
          viewerId,
          info,
          groupBy,
          rows,
          weekStart,
        );
        for (const row of rows) {
          // E64: a legacy rejected entry never reaches report totals.
          if (row.legacy_status === 'rejected') continue;
          const payable = isApproved(row) ? Number(row.payable_seconds) : 0;
          // The client sees approved hours only, so its "total" is approved time.
          const logged = info.clientView
            ? payable
            : Math.max(0, Number(row.duration_seconds ?? 0));
          totalSeconds += logged;
          payableSeconds += payable;
          const sheetStatus = one(row.timesheets)?.status;
          if (sheetStatus && row.timesheet_id) {
            sheetsByStatus.get(sheetStatus)?.add(row.timesheet_id);
          }

          const { key, label } = labels.groupOf(row);
          const group = groups.get(key) ?? {
            key,
            label,
            total_seconds: 0,
            payable_seconds: 0,
            amounts: new Map<string, number>(),
          };
          group.total_seconds += logged;
          group.payable_seconds += payable;
          const cost = labels.cost.get(row.id);
          const amount = numberOrNull(cost?.amount_snapshot);
          if (cost && amount !== null) {
            const currency = (cost.currency_snapshot ?? 'USD').toUpperCase();
            group.amounts.set(
              currency,
              (group.amounts.get(currency) ?? 0) + amount,
            );
          }
          groups.set(key, group);
        }
        if (rows.length < PAGE_ROWS) break;
      }
    }

    const summary: ReportSummary = {
      scope: { kind: info.scope.kind, id: info.scope.id },
      timezone: info.scope.timezone,
      total_seconds: totalSeconds,
      payable_seconds: payableSeconds,
      groups: this.sortGroups(groupBy, [...groups.values()]).map((g) => {
        const out: ReportSummary['groups'][number] = {
          key: g.key,
          label: g.label,
          total_seconds: g.total_seconds,
          payable_seconds: g.payable_seconds,
        };
        if (g.amounts.size > 0) {
          out.amounts_by_currency = Object.fromEntries(
            [...g.amounts.entries()].map(([c, v]) => [c, round2(v)]),
          );
        }
        return out;
      }),
      sheet_status_counts: Object.fromEntries(
        SHEET_STATUSES.map((s) => [s, sheetsByStatus.get(s)?.size ?? 0]),
      ) as Record<TimesheetStatus, number>,
    };
    if (info.scope.kind === 'team') {
      summary.under_agreements_seconds = await this.underAgreementsSeconds(
        info.scope.id,
        range,
      );
    }
    return summary;
  }

  /** time_reports_export */
  async export(viewerId: string, q: ReportQueryDto): Promise<ExportFile> {
    const info = await this.scopeInfo(viewerId, q.scope);
    if (info.clientView && info.clientLevel !== 'detailed') {
      throw timeNotFound('scope');
    }
    // All exports, on the scope's plan subject (team → planRefForTeam, project → its workspace, engagement →
    // policyWorkspaceFor, workspace → W). PlanLimitException (403) so the web shows its upgrade prompt (D26).
    await this.entitlements.assertFeature(info.planRef, 'time_reports_export');
    const range = this.range(q, info.scope.timezone);
    const filters = await this.filtersFor(viewerId, info, q, range);
    const format = q.format === 'xlsx' ? 'xlsx' : 'csv';

    const authRows: EntryAuthRow[] = [];
    if (filters) {
      const select = this.needsSheetJoin(info, filters)
        ? `${ENTRY_AUTH_SELECT}, ${SHEET_FILTER_EMBED}`
        : ENTRY_AUTH_SELECT;
      for (let offset = 0; ; offset += PAGE_ROWS) {
        const { data, error, count } = await this.applyFilters(
          this.entryQuery(select, offset === 0),
          info,
          filters,
        )
          .order('started_at', { ascending: true })
          .order('id', { ascending: true })
          .range(offset, offset + PAGE_ROWS - 1);
        if (error) this.fail('export', error);
        if (offset === 0 && (count ?? 0) > EXPORT_MAX_ROWS) {
          throw new BadRequestException(
            `This export has more than ${EXPORT_MAX_ROWS.toLocaleString('en-US')} entries. Pick a shorter range.`,
          );
        }
        const rows = ((data ?? []) as EntryAuthRow[]).map(toAuthRow);
        authRows.push(...rows);
        if (rows.length < PAGE_ROWS || authRows.length >= EXPORT_MAX_ROWS) {
          break;
        }
      }
    }

    const views: TimeEntryView[] = [];
    for (const part of chunks(authRows, HYDRATE_CHUNK)) {
      views.push(
        ...(await this.hydrateFor(viewerId, info, part, { forExport: true })),
      );
    }

    const tz = info.scope.timezone;
    const { columns, rows } = info.clientView
      ? this.clientExportRows(views, tz)
      : this.exportRows(views, tz);
    const body =
      format === 'xlsx'
        ? await buildXlsx(columns, rows, 'Time report')
        : buildCsv(columns, rows);
    const filename =
      `proyekto-time-${info.scope.kind}-${info.scope.id.slice(0, 8)}-` +
      `${sanitiseFilePart(range.from)}-${sanitiseFilePart(range.to)}.${format}`;
    return { filename, contentType: CONTENT_TYPES[format], body };
  }

  /** time_audit_export */
  async auditExport(
    viewerId: string,
    q: AuditExportQueryDto,
  ): Promise<ExportFile> {
    const match = /^workspace:([0-9a-fA-F-]{36})$/.exec(q.scope ?? '');
    if (!match) throw timeNotFound('scope');
    const workspaceId = match[1].toLowerCase();
    if (!(await this.authority.canManageWorkspace(workspaceId, viewerId))) {
      throw timeNotFound('scope');
    }
    await this.entitlements.assertFeature(workspaceId, 'time_audit_export');
    const timezone = safeTimezone(
      await this.policy.workspaceTimezone(workspaceId),
    );
    const range = this.range(q, timezone);
    const format = q.format === 'xlsx' ? 'xlsx' : 'csv';

    const sheetEvents: AuditEventRow[] = [];
    for (let offset = 0; ; offset += PAGE_ROWS) {
      const { data, error } = await (
        this.sb
          .from('timesheet_events')
          .select(AUDIT_EVENT_SELECT) as unknown as Filterable
      )
        .eq('timesheets.policy_workspace_id', workspaceId)
        .gte('created_at', range.fromIso)
        .lt('created_at', range.toExclusiveIso)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(offset, offset + PAGE_ROWS - 1);
      if (error) this.fail('auditExport.events', error);
      const rows = (data ?? []) as AuditEventRow[];
      sheetEvents.push(...rows);
      if (rows.length < PAGE_ROWS || sheetEvents.length >= EXPORT_MAX_ROWS) {
        break;
      }
    }

    const { data: teamData, error: teamError } = await this.sb
      .from('teams')
      .select('id, name')
      .eq('workspace_id', workspaceId);
    if (teamError) this.fail('auditExport.teams', teamError);
    const teamNames = new Map(
      ((teamData ?? []) as Array<{ id: string; name: string | null }>).map(
        (t) => [t.id, t.name ?? 'Team'],
      ),
    );
    const owners = [
      `workspace_id.eq.${workspaceId}`,
      ...(teamNames.size > 0
        ? [`team_id.in.(${[...teamNames.keys()].join(',')})`]
        : []),
    ];
    const policyEvents: AuditPolicyRow[] = [];
    for (let offset = 0; ; offset += PAGE_ROWS) {
      const { data, error } = await (
        this.sb
          .from('time_policy_events')
          .select(AUDIT_POLICY_SELECT) as unknown as Filterable
      )
        .or(owners.join(','))
        .gte('created_at', range.fromIso)
        .lt('created_at', range.toExclusiveIso)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(offset, offset + PAGE_ROWS - 1);
      if (error) this.fail('auditExport.policies', error);
      const rows = (data ?? []) as AuditPolicyRow[];
      policyEvents.push(...rows);
      if (rows.length < PAGE_ROWS || policyEvents.length >= EXPORT_MAX_ROWS) {
        break;
      }
    }

    const [actorNames, maskedEngagements] = await Promise.all([
      this.profileNames(
        distinct([
          ...sheetEvents.map((e) => e.actor_user_id),
          ...policyEvents.map((e) => e.actor_user_id),
        ]),
      ),
      this.maskedEngagementIds(
        viewerId,
        distinct(
          sheetEvents.map((e) => {
            const sheet = one(e.timesheets);
            return sheet?.scope_kind === 'engagement'
              ? sheet.engagement_id
              : null;
          }),
        ),
      ),
    ]);

    const columns: ExportColumn[] = [
      { key: 'at', header: 'When (UTC)' },
      { key: 'kind', header: 'Record' },
      { key: 'event', header: 'Event' },
      { key: 'actor', header: 'By' },
      { key: 'member', header: 'Person' },
      { key: 'scope', header: 'Timesheet or policy' },
      { key: 'period_start', header: 'Period start' },
      { key: 'period_end', header: 'Period end' },
      { key: 'from_status', header: 'From' },
      { key: 'to_status', header: 'To' },
      { key: 'total_hours', header: 'Logged hours' },
      { key: 'payable_hours', header: 'Approved hours' },
      { key: 'revision', header: 'Revision' },
      { key: 'note', header: 'Note' },
      { key: 'changes', header: 'Changes' },
    ];
    const actorLabel = (id: string | null) =>
      id ? (actorNames.get(id) ?? 'Unknown') : 'Proyekto';
    const records: Array<{ at: string; row: ExportRow }> = [
      ...sheetEvents.map((e) => {
        const sheet = one(e.timesheets);
        const masked =
          sheet?.engagement_id !== null &&
          sheet?.engagement_id !== undefined &&
          maskedEngagements.has(sheet.engagement_id);
        return {
          at: e.created_at,
          row: {
            at: e.created_at,
            kind: 'Timesheet',
            event: e.event,
            actor: actorLabel(e.actor_user_id),
            member: masked
              ? MASKED_MEMBER_LABEL
              : (sheet?.member_display_name_snapshot ?? null),
            scope: sheet?.scope_label_snapshot ?? null,
            period_start: sheet?.period_start ?? null,
            period_end: sheet?.period_end ?? null,
            from_status: e.from_status,
            to_status: e.to_status,
            total_hours: hours(e.total_seconds),
            payable_hours: hours(e.payable_seconds),
            revision: e.revision,
            note: e.note,
            changes: null,
          } satisfies ExportRow,
        };
      }),
      ...policyEvents.map((p) => ({
        at: p.created_at,
        row: {
          at: p.created_at,
          kind: 'Policy',
          event: this.policyEventLabel(p.changes),
          actor: actorLabel(p.actor_user_id),
          member: null,
          scope:
            p.team_id !== null
              ? `Team policy · ${teamNames.get(p.team_id) ?? 'Deleted team'}`
              : 'Workspace policy',
          period_start: null,
          period_end: null,
          from_status: null,
          to_status: null,
          total_hours: null,
          payable_hours: null,
          revision: null,
          note: null,
          changes: JSON.stringify(p.changes ?? null),
        } satisfies ExportRow,
      })),
    ].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

    const rows = records.map((r) => r.row);
    const body =
      format === 'xlsx'
        ? await buildXlsx(columns, rows, 'Time audit')
        : buildCsv(columns, rows);
    const filename =
      `proyekto-time-audit-${workspaceId.slice(0, 8)}-` +
      `${sanitiseFilePart(range.from)}-${sanitiseFilePart(range.to)}.${format}`;
    return { filename, contentType: CONTENT_TYPES[format], body };
  }

  // ── Scope resolution ─────────────────────────────────────────────────────────────────────────────────────

  private async scopeInfo(viewerId: string, raw: string): Promise<ScopeInfo> {
    const match = SCOPE_PATTERN.exec(raw ?? '');
    if (!match) throw timeNotFound('scope');
    const id = match[2].toLowerCase();
    switch (match[1]) {
      case 'team':
        return this.teamScope(viewerId, id);
      case 'project':
        return this.projectScope(viewerId, id);
      case 'workspace':
        return this.workspaceScope(viewerId, id);
      default:
        return this.engagementScope(viewerId, id);
    }
  }

  private base(scope: ReportScope, planRef: EntitlementRef): ScopeInfo {
    return {
      scope,
      planRef,
      weekStart: null,
      policyWorkspaceId: null,
      engagementKind: null,
      clientView: false,
      clientLevel: null,
      clientAssignmentIds: [],
      providerTeamId: null,
      linkedProjectIds: [],
    };
  }

  /** Team managers (`can_manage_team`); team-context entries of the team. */
  private async teamScope(viewerId: string, id: string): Promise<ScopeInfo> {
    const { data, error } = await this.sb
      .from('teams')
      .select('id, workspace_id')
      .eq('id', id)
      .maybeSingle();
    if (error) this.fail('teamScope', error);
    const team = data as { id: string; workspace_id: string | null } | null;
    if (!team || !(await this.authority.isTeamManager(team.id, viewerId))) {
      throw timeNotFound('scope');
    }
    const [planRef, timezone] = await Promise.all([
      this.policy.planRefForTeam(team),
      this.policy.teamTimezone(team.id),
    ]);
    return this.base(
      { kind: 'team', id, planRef, timezone: safeTimezone(timezone) },
      planRef,
    );
  }

  /** `time.view_team_logs` (or the owner); every governed context on the project, never personal. */
  private async projectScope(viewerId: string, id: string): Promise<ScopeInfo> {
    const { data, error } = await this.sb
      .from('projects')
      .select('id, owner_id, workspace_id')
      .eq('id', id)
      .maybeSingle();
    if (error) this.fail('projectScope', error);
    const project = data as {
      id: string;
      owner_id: string | null;
      workspace_id: string | null;
    } | null;
    if (!project) throw timeNotFound('scope');
    if (project.owner_id !== viewerId) {
      let allowed = false;
      try {
        const perms = await this.projectAuth.resolvePermissions(viewerId, id);
        allowed = perms !== null && getPermission(perms, 'time.view_team_logs');
      } catch (err) {
        this.logger.error(
          `projectScope permissions failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        throw new InternalServerErrorException({
          code: TIME_INTERNAL_CODE,
          message: TIME_READ_FAILED_MESSAGE,
        });
      }
      if (!allowed) throw timeNotFound('scope');
    }
    const planRef: EntitlementRef = project.workspace_id ?? UNHOMED;
    const timezone = safeTimezone(
      await this.policy.workspaceTimezone(project.workspace_id),
    );
    return {
      ...this.base({ kind: 'project', id, planRef, timezone }, planRef),
      policyWorkspaceId: project.workspace_id,
    };
  }

  /** `can_manage_workspace` + `time_reports_export`; sheets whose policy workspace is W. */
  private async workspaceScope(
    viewerId: string,
    id: string,
  ): Promise<ScopeInfo> {
    if (!(await this.authority.canManageWorkspace(id, viewerId))) {
      throw timeNotFound('scope');
    }
    await this.entitlements.assertFeature(id, 'time_reports_export');
    const timezone = safeTimezone(await this.policy.workspaceTimezone(id));
    return this.base({ kind: 'workspace', id, planRef: id, timezone }, id);
  }

  /** Parties only. The client hirer gets "Client hours" at the agreement's level, 404 at `none`. */
  private async engagementScope(
    viewerId: string,
    id: string,
  ): Promise<ScopeInfo> {
    let view: EngagementView;
    try {
      view = await this.engagements.getById(viewerId, id);
    } catch (err) {
      if (err instanceof NotFoundException) throw timeNotFound('scope');
      if (err instanceof HttpException) throw err;
      this.logger.error(
        `engagementScope failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new InternalServerErrorException({
        code: TIME_INTERNAL_CODE,
        message: TIME_READ_FAILED_MESSAGE,
      });
    }
    const kind = view.kind;
    if (kind !== 'talent_services' && kind !== 'client_services') {
      throw timeNotFound('scope');
    }
    const policyWorkspaceId = await this.engagements.policyWorkspaceFor(id);
    const resolved = await this.policy.resolve(
      { kind: 'engagement', ref: id },
      policyWorkspaceId,
      new Date(),
    );
    const timezone = safeTimezone(resolved.timezone);
    const planRef: EntitlementRef = policyWorkspaceId ?? UNHOMED;
    const viewerPosition = view.viewer_position;

    let clientLevel: ClientHoursLevel | null = null;
    let clientView = false;
    if (kind === 'client_services' && viewerPosition === 'hirer') {
      const settings = await this.engagements.settingsInForceOn(
        id,
        localDate(new Date(), timezone),
      );
      clientLevel = normaliseLevel(settings?.client_hours_detail_level);
      if (clientLevel === 'none') throw timeNotFound('scope');
      clientView = true;
    }

    const info: ScopeInfo = {
      ...this.base(
        {
          kind: 'engagement',
          id,
          planRef,
          timezone,
          viewerPosition,
          clientLevel,
        },
        planRef,
      ),
      // The engagement week: contract, else the policy workspace's (the same resolve as the timezone).
      weekStart: weekStartOrMonday(resolved.week_start),
      engagementKind: kind,
      clientView,
      clientLevel,
    };
    if (kind === 'client_services') {
      const [assignmentIds, providerTeamId] = await Promise.all([
        this.engagements.assignmentIdsForClientEngagement(id),
        this.engagements.providerPartyTeamId(id),
      ]);
      info.clientAssignmentIds = distinct(assignmentIds);
      info.providerTeamId = providerTeamId;
      info.linkedProjectIds = distinct(
        view.project_links
          .filter((l) => l.status === 'active')
          .map((l) => l.project_id),
      );
    }
    return info;
  }

  // ── Query building ───────────────────────────────────────────────────────────────────────────────────────

  /** `count`: true adds the exact count to the rows; 'head' is a count-only read (no rows travel). */
  private entryQuery(select: string, count: boolean | 'head'): Filterable {
    return this.sb
      .from('time_entries')
      .select(
        select,
        count === 'head'
          ? { count: 'exact', head: true }
          : count
            ? { count: 'exact' }
            : undefined,
      ) as unknown as Filterable;
  }

  /** Local dates of the scope's policy timezone → [from 00:00, to+1 00:00) as UTC instants. */
  private range(q: { from: string; to: string }, timezone: string): DateRange {
    const from = String(q.from ?? '').slice(0, 10);
    const to = String(q.to ?? '').slice(0, 10);
    if (!DATE_ONLY.test(from) || !DATE_ONLY.test(to)) {
      throw new BadRequestException('Use dates like 2026-10-05.');
    }
    if (from > to) {
      throw new BadRequestException(
        'The start date must be on or before the end date.',
      );
    }
    const utc = localRangeToUtc({ start: from, end: to }, timezone);
    return {
      from,
      to,
      fromIso: utc.fromIso,
      toExclusiveIso: utc.toExclusiveIso,
    };
  }

  /** Null when the scope can match nothing (a client engagement with no assignments and no linked team). */
  private async filtersFor(
    viewerId: string,
    info: ScopeInfo,
    q: ReportQueryDto,
    range: DateRange,
  ): Promise<EntryFilters | null> {
    if (
      info.scope.kind === 'engagement' &&
      info.engagementKind === 'client_services'
    ) {
      const teamPart =
        info.providerTeamId !== null && info.linkedProjectIds.length > 0;
      if (info.clientAssignmentIds.length === 0 && !teamPart) return null;
    }
    const filters: EntryFilters = {
      range,
      // The client never picks a person: identity is not theirs to filter on.
      memberUserId: info.clientView ? null : (q.member_user_id ?? null),
      status: info.clientView ? null : (q.status ?? null),
      contextKind: q.context_kind ?? null,
      hiddenAssignmentIds: [],
      approvedOnly: info.clientView,
    };
    if (filters.memberUserId) {
      filters.hiddenAssignmentIds = await this.hiddenAssignmentsFor(
        viewerId,
        info,
        filters,
      );
    }
    return filters;
  }

  private needsSheetJoin(info: ScopeInfo, f: EntryFilters): boolean {
    return (
      info.scope.kind === 'workspace' ||
      (info.scope.kind === 'engagement' &&
        info.engagementKind === 'talent_services') ||
      f.status !== null
    );
  }

  /** The scope's authority query plus the request's filters. Queries that need it carry SHEET_FILTER_EMBED. */
  private applyFilters(
    query: Filterable,
    info: ScopeInfo,
    f: EntryFilters,
  ): Filterable {
    const orGroups: string[][] = [];
    const s = info.scope;
    if (s.kind === 'team') {
      query = query.eq('context_kind', 'team').eq('team_id', s.id);
    } else if (s.kind === 'project') {
      query = query.eq('project_id', s.id).neq('context_kind', 'personal');
    } else if (s.kind === 'workspace') {
      query = query.eq('timesheets.policy_workspace_id', s.id);
    } else if (info.engagementKind === 'talent_services') {
      query = query
        .eq('context_kind', 'assignment')
        .eq('timesheets.engagement_id', s.id);
    } else {
      const parts: string[] = [];
      if (info.clientAssignmentIds.length > 0) {
        parts.push(
          `engagement_assignment_id.in.(${info.clientAssignmentIds.join(',')})`,
        );
      }
      if (info.providerTeamId !== null && info.linkedProjectIds.length > 0) {
        parts.push(
          `and(context_kind.eq.team,team_id.eq.${info.providerTeamId},` +
            `project_id.in.(${info.linkedProjectIds.join(',')}))`,
        );
      }
      orGroups.push(parts);
    }

    query = query
      .gte('started_at', f.range.fromIso)
      .lt('started_at', f.range.toExclusiveIso);
    if (f.memberUserId) query = query.eq('member_user_id', f.memberUserId);
    if (f.contextKind) query = query.eq('context_kind', f.contextKind);
    if (f.status) query = query.eq('timesheets.status', f.status);
    if (f.hiddenAssignmentIds.length > 0) {
      orGroups.push([
        'engagement_assignment_id.is.null',
        `engagement_assignment_id.not.in.(${f.hiddenAssignmentIds.join(',')})`,
      ]);
    }
    if (f.approvedOnly) {
      query = query.not('payable_seconds', 'is', null);
      orGroups.push([...NOT_LEGACY_REJECTED_OR]);
    }
    const or = andOfOrGroups(orGroups);
    return or ? query.or(or) : query;
  }

  /**
   * L22 under a person filter: the assignments of that member, inside the scope, whose worker the viewer may
   * not name. Their rows are left out, so filtering by a person never reveals masked time. Only the project
   * and workspace scopes can hold such rows (team scope is team context only; engagement parties are provider
   * side; the client view ignores the filter).
   */
  private async hiddenAssignmentsFor(
    viewerId: string,
    info: ScopeInfo,
    filters: EntryFilters,
  ): Promise<string[]> {
    const memberId = filters.memberUserId;
    if (!memberId || memberId === viewerId) return [];
    if (info.scope.kind !== 'project' && info.scope.kind !== 'workspace') {
      return [];
    }
    const probe: EntryFilters = { ...filters, hiddenAssignmentIds: [] };
    const select = this.needsSheetJoin(info, probe)
      ? `engagement_assignment_id, project_id, ${SHEET_FILTER_EMBED}`
      : 'engagement_assignment_id, project_id';
    // Every page (W2 review F5): an assignment whose rows only start past the first max-rows page must still be
    // found, or the person filter would count its masked time.
    const pairs = new Map<string, EntryAuthRow>();
    for (let offset = 0; ; offset += PAGE_ROWS) {
      const { data, error } = await this.applyFilters(
        this.entryQuery(select, false),
        info,
        probe,
      )
        .eq('context_kind', 'assignment')
        .not('engagement_assignment_id', 'is', null)
        .order('engagement_assignment_id', { ascending: true })
        .order('id', { ascending: true })
        .range(offset, offset + PAGE_ROWS - 1);
      if (error) this.fail('hiddenAssignmentsFor', error);
      const rows = (data ?? []) as Array<{
        engagement_assignment_id: string | null;
        project_id: string | null;
      }>;
      for (const row of rows) {
        const aid = row.engagement_assignment_id;
        if (!aid) continue;
        const key = `${aid}|${row.project_id ?? ''}`;
        if (pairs.has(key)) continue;
        pairs.set(key, {
          id: key,
          member_user_id: memberId,
          project_id: row.project_id,
          context_kind: 'assignment',
          context_ref: aid,
          team_id: null,
          workspace_id: null,
          engagement_assignment_id: aid,
          timesheet_id: null,
          started_at: filters.range.fromIso,
        });
      }
      if (rows.length < PAGE_ROWS) break;
    }
    if (pairs.size === 0) return [];
    const visible = await this.authority.identityVisible(viewerId, [
      ...pairs.values(),
    ]);
    return distinct(
      [...pairs.values()]
        .filter((r) => !visible.has(r.id))
        .map((r) => r.engagement_assignment_id),
    );
  }

  // ── Hydration ────────────────────────────────────────────────────────────────────────────────────────────

  private hydrateFor(
    viewerId: string,
    info: ScopeInfo,
    rows: EntryAuthRow[],
    o: { forExport?: boolean } = {},
  ): Promise<TimeEntryView[]> {
    if (info.clientView) return this.hydrateClient(viewerId, rows);
    // Email is a self and team-manager view only (backend.md "Cost and Content Redaction"); a file never
    // carries one, so an export never fetches it.
    return this.authority.hydrate(viewerId, rows, {
      withEmail: info.scope.kind === 'team' && !o.forExport,
    });
  }

  /**
   * "Client hours" at `detailed`: date, task and approved hours per entry. The person is shown only where D57
   * names them to the client (their consultant's own client-only assignment time); team rows and placed talent
   * read "Delivery team". Notes, cost, the sheet and the decision trail are never fetched.
   */
  private async hydrateClient(
    viewerId: string,
    rows: EntryAuthRow[],
  ): Promise<TimeEntryView[]> {
    if (rows.length === 0) return [];
    const ids = distinct(rows.map((r) => r.id));
    const [identityIds, baseRows, contentRows] = await Promise.all([
      this.authority.identityVisible(
        viewerId,
        rows.filter((r) => r.context_kind === 'assignment'),
      ),
      this.selectByIds<ClientBaseRow>(CLIENT_BASE_SELECT, ids),
      this.selectByIds<ClientContentRow>(CLIENT_CONTENT_SELECT, ids),
    ]);
    const identityRows = await this.selectByIds<IdentityRow>(
      ENTRY_IDENTITY_SELECT,
      ids.filter((id) => identityIds.has(id)),
    );
    const base = new Map(baseRows.map((r) => [r.id, r]));
    const identity = new Map(identityRows.map((r) => [r.id, r]));
    const content = new Map(contentRows.map((r) => [r.id, r]));

    const views: TimeEntryView[] = [];
    for (const r of rows) {
      const b = base.get(r.id);
      if (!b) continue;
      const who = identity.get(r.id);
      const c = content.get(r.id);
      views.push({
        id: b.id,
        context_kind: b.context_kind,
        context_ref: null,
        context_label_snapshot: null,
        timesheet_id: null,
        work_item: b.work_item,
        started_at: b.started_at,
        ended_at: null,
        paused_at: null,
        duration_seconds: null,
        break_seconds: 0,
        break_minutes: 0,
        payable_seconds: b.payable_seconds,
        source: b.source,
        work_type_snapshot: b.work_type_snapshot,
        legacy_status: null,
        payout_id: null,
        flagged_reason: null,
        project_id: b.project_id,
        team_id: null,
        workspace_id: null,
        engagement_assignment_id: null,
        created_at: b.created_at,
        updated_at: b.updated_at,
        timesheet: null,
        locked_reason: null,
        ...(who
          ? {
              identity: 'visible' as const,
              member_user_id: who.member_user_id,
              member_display_name_snapshot: who.member_display_name_snapshot,
              member: who.member ?? null,
              member_label: null,
            }
          : {
              identity: 'masked' as const,
              member_user_id: null,
              member_display_name_snapshot: null,
              member: null,
              member_label: MASKED_MEMBER_LABEL,
            }),
        ...(c
          ? {
              content: 'visible' as const,
              task_id: c.task_id,
              note: null,
              task: c.task ?? null,
              project: c.project ?? null,
              content_label: null,
            }
          : {
              content: 'hidden' as const,
              task_id: null,
              note: null,
              task: null,
              project: null,
              content_label: HIDDEN_CONTENT_LABEL,
            }),
        cost: 'hidden',
      });
    }
    return views;
  }

  /** One select per class, chunked; an empty id list issues no query. */
  private async selectByIds<T>(select: string, ids: string[]): Promise<T[]> {
    if (ids.length === 0) return [];
    const out: T[] = [];
    for (const part of chunks(ids)) {
      const { data, error } = await this.entryQuery(select, false).in(
        'id',
        part,
      );
      if (error) this.fail('selectByIds', error);
      out.push(...((data ?? []) as T[]));
    }
    return out;
  }

  // ── Summary grouping ─────────────────────────────────────────────────────────────────────────────────────

  /** The client groups by what its level shows: day or week at `summary` ("hours by week", A5); day, week,
   *  project or task at `detailed`. */
  private groupByFor(info: ScopeInfo, requested?: GroupBy): GroupBy {
    const groupBy = requested ?? 'day';
    if (!info.clientView) return groupBy;
    const allowed: GroupBy[] =
      info.clientLevel === 'detailed'
        ? ['day', 'week', 'project', 'task']
        : ['day', 'week'];
    return allowed.includes(groupBy) ? groupBy : 'day';
  }

  /** A5: the ISO week start of the scope's policy. Team: the team policy; project: its workspace's policy row;
   *  workspace: W's row; engagement: read with the scope. Monday when nothing sets it. */
  private async weekStartFor(info: ScopeInfo): Promise<number> {
    if (info.weekStart !== null) return info.weekStart;
    const s = info.scope;
    switch (s.kind) {
      case 'team':
        return (await this.policy.teamPeriodBasics(s.id)).week_start;
      case 'project':
        return (await this.policy.workspacePeriodBasics(info.policyWorkspaceId))
          .week_start;
      case 'workspace':
        return (await this.policy.workspacePeriodBasics(s.id)).week_start;
      default:
        return 1;
    }
  }

  /** Per page: the labels and cost the viewer may read, fetched by class for the rows that allow it. */
  private async groupLabels(
    viewerId: string,
    info: ScopeInfo,
    groupBy: GroupBy,
    rows: SummaryRow[],
    weekStart: number,
  ): Promise<{
    groupOf: (row: SummaryRow) => { key: string; label: string };
    cost: Map<string, CostLabelRow>;
  }> {
    const authRows = rows.map(toAuthRow);
    const tz = info.scope.timezone;
    const needIdentity = groupBy === 'member';
    const needContent = groupBy === 'project' || groupBy === 'task';
    const others = authRows.filter((r) => r.member_user_id !== viewerId);

    const [identityIds, contentProjects, costIds] = await Promise.all([
      needIdentity
        ? this.authority.identityVisible(
            viewerId,
            info.clientView
              ? authRows.filter((r) => r.context_kind === 'assignment')
              : authRows,
          )
        : Promise.resolve(new Set<string>()),
      needContent && !info.clientView
        ? this.authority.contentVisible(
            viewerId,
            distinct(others.map((r) => r.project_id)),
          )
        : Promise.resolve(new Set<string>()),
      info.clientView
        ? Promise.resolve(new Set<string>())
        : this.authority.costVisible(viewerId, authRows),
    ]);

    const contentIds = needContent
      ? distinct(
          authRows
            .filter(
              (r) =>
                info.clientView ||
                r.member_user_id === viewerId ||
                (r.project_id !== null && contentProjects.has(r.project_id)),
            )
            .map((r) => r.id),
        )
      : [];
    const costCandidates = rows
      .filter((r) => costIds.has(r.id) && isApproved(r))
      .map((r) => r.id);

    const [identityRows, contentRows, costRows] = await Promise.all([
      needIdentity
        ? this.selectByIds<IdentityRow>(
            ENTRY_IDENTITY_SELECT,
            distinct(rows.map((r) => r.id)).filter((id) => identityIds.has(id)),
          )
        : Promise.resolve([] as IdentityRow[]),
      this.selectByIds<LabelContentRow>(LABEL_CONTENT_SELECT, contentIds),
      this.selectByIds<CostLabelRow>(SUMMARY_COST_SELECT, costCandidates),
    ]);
    const identity = new Map(identityRows.map((r) => [r.id, r]));
    const content = new Map(contentRows.map((r) => [r.id, r]));
    const cost = new Map(costRows.map((r) => [r.id, r]));

    const groupOf = (row: SummaryRow): { key: string; label: string } => {
      switch (groupBy) {
        case 'member': {
          const who = identity.get(row.id);
          if (!who) {
            return {
              key: `masked:${row.context_ref ?? row.context_kind}`,
              label: MASKED_MEMBER_LABEL,
            };
          }
          return {
            key: who.member_user_id ?? 'unknown',
            label:
              who.member?.display_name ??
              who.member_display_name_snapshot ??
              'Unknown',
          };
        }
        case 'project': {
          const c = content.get(row.id);
          if (!c) return { key: 'hidden', label: HIDDEN_CONTENT_LABEL };
          if (!c.project) return { key: 'none', label: 'No project' };
          return { key: c.project.id, label: c.project.title ?? 'Untitled' };
        }
        case 'task': {
          const c = content.get(row.id);
          if (!c) return { key: 'hidden', label: HIDDEN_CONTENT_LABEL };
          if (c.task) {
            return { key: c.task.id, label: c.task.title ?? 'Untitled task' };
          }
          const item = row.work_item ?? 'other';
          return {
            key: `item:${item}`,
            label: WORK_ITEM_LABEL[item] ?? 'Other',
          };
        }
        case 'context':
          return {
            key: `${row.context_kind}:${row.context_ref ?? ''}`,
            label:
              row.context_label_snapshot ??
              CONTEXT_KIND_LABEL[row.context_kind] ??
              'Other',
          };
        case 'week': {
          const week = weekWindow(localDate(row.started_at, tz), weekStart);
          return { key: week.start, label: weekLabel(week.start) };
        }
        default: {
          const day = localDate(row.started_at, tz);
          return { key: day, label: day };
        }
      }
    };
    return { groupOf, cost };
  }

  private sortGroups(groupBy: GroupBy, groups: GroupAcc[]): GroupAcc[] {
    if (groupBy === 'day' || groupBy === 'week') {
      return groups.sort((a, b) => a.key.localeCompare(b.key));
    }
    return groups.sort(
      (a, b) =>
        b.total_seconds - a.total_seconds || a.label.localeCompare(b.label),
    );
  }

  /**
   * L35 "Under agreements": hours logged under assignments whose `team_id` is the team, on the team's
   * projects (hours only; no person, no cost). Legacy rejected time is left out (E64).
   */
  private async underAgreementsSeconds(
    teamId: string,
    range: DateRange,
  ): Promise<number> {
    const { data, error } = await this.sb
      .from('project_teams')
      .select('project_id')
      .eq('team_id', teamId);
    if (error) this.fail('underAgreements.projects', error);
    const projectIds = distinct(
      ((data ?? []) as Array<{ project_id: string | null }>).map(
        (r) => r.project_id,
      ),
    );
    if (projectIds.length === 0) return 0;
    const lists = await Promise.all(
      projectIds.map((p) => this.engagements.assignmentsForProject(p)),
    );
    const assignmentIds = distinct(
      lists
        .flat()
        .filter((a) => a.team_id === teamId)
        .map((a) => a.id),
    );
    let seconds = 0;
    for (const part of chunks(assignmentIds)) {
      for (let offset = 0; ; offset += PAGE_ROWS) {
        const { data: rows, error: rowsError } = await this.entryQuery(
          'id, duration_seconds, legacy_status',
          false,
        )
          .eq('context_kind', 'assignment')
          .in('engagement_assignment_id', part)
          .gte('started_at', range.fromIso)
          .lt('started_at', range.toExclusiveIso)
          .order('id', { ascending: true })
          .range(offset, offset + PAGE_ROWS - 1);
        if (rowsError) this.fail('underAgreements.entries', rowsError);
        const batch = (rows ?? []) as Array<{
          duration_seconds: number | null;
          legacy_status: string | null;
        }>;
        for (const row of batch) {
          if (row.legacy_status === 'rejected') continue;
          seconds += Math.max(0, Number(row.duration_seconds ?? 0));
        }
        if (batch.length < PAGE_ROWS) break;
      }
    }
    return seconds;
  }

  // ── Export rows ──────────────────────────────────────────────────────────────────────────────────────────

  /**
   * E68 / L45: base class (person as the viewer may see them, date, start, end, duration, approved, work item,
   * For, sheet), content class (project, task, note; "A project you can't open" where hidden) and, only when the
   * viewer is cost-visible on at least one row, the cost class (blank on the rows they are not). No email.
   */
  private exportRows(
    views: TimeEntryView[],
    tz: string,
  ): { columns: ExportColumn[]; rows: ExportRow[] } {
    const withCost = views.some((v) => v.cost === 'visible');
    const columns: ExportColumn[] = [
      { key: 'date', header: 'Date' },
      { key: 'member', header: 'Person' },
      { key: 'logging_for', header: 'For' },
      { key: 'project', header: 'Project' },
      { key: 'task', header: 'Task' },
      { key: 'work_item', header: 'Work item' },
      { key: 'note', header: 'Note' },
      { key: 'started_at', header: 'Started at' },
      { key: 'ended_at', header: 'Ended at' },
      { key: 'duration_hours', header: 'Hours' },
      { key: 'payable_hours', header: 'Approved hours' },
      { key: 'timesheet_status', header: 'Timesheet' },
      { key: 'period_start', header: 'Period start' },
      { key: 'period_end', header: 'Period end' },
      ...(withCost
        ? [
            { key: 'rate', header: 'Rate' },
            { key: 'currency', header: 'Currency' },
            { key: 'amount', header: 'Amount' },
          ]
        : []),
    ];
    const rows = views.map((v) => {
      const row: ExportRow = {
        date: localDate(v.started_at, tz),
        member:
          v.identity === 'visible'
            ? (v.member?.display_name ?? v.member_display_name_snapshot ?? null)
            : (v.member_label ?? MASKED_MEMBER_LABEL),
        logging_for:
          v.context_label_snapshot ?? CONTEXT_KIND_LABEL[v.context_kind],
        project:
          v.content === 'visible'
            ? (v.project?.title ?? null)
            : (v.content_label ?? HIDDEN_CONTENT_LABEL),
        task: v.content === 'visible' ? (v.task?.title ?? null) : null,
        work_item: WORK_ITEM_LABEL[v.work_item] ?? v.work_item,
        note: v.content === 'visible' ? v.note : null,
        started_at: v.started_at,
        ended_at: v.ended_at,
        duration_hours: hours(v.duration_seconds),
        payable_hours: hours(v.payable_seconds),
        timesheet_status: v.timesheet?.status ?? null,
        period_start: v.timesheet?.period_start ?? null,
        period_end: v.timesheet?.period_end ?? null,
      };
      if (withCost) {
        const visible = v.cost === 'visible';
        row.rate = visible ? (v.rate_snapshot ?? null) : null;
        row.currency = visible ? (v.currency_snapshot ?? null) : null;
        row.amount = visible ? (v.amount_snapshot ?? null) : null;
      }
      return row;
    });
    return { columns, rows };
  }

  /** "Client hours" at `detailed`: date, person as D57 allows, project, task, work item, approved hours. */
  private clientExportRows(
    views: TimeEntryView[],
    tz: string,
  ): { columns: ExportColumn[]; rows: ExportRow[] } {
    const columns: ExportColumn[] = [
      { key: 'date', header: 'Date' },
      { key: 'member', header: 'Person' },
      { key: 'project', header: 'Project' },
      { key: 'task', header: 'Task' },
      { key: 'work_item', header: 'Work item' },
      { key: 'payable_hours', header: 'Approved hours' },
    ];
    const rows = views.map(
      (v): ExportRow => ({
        date: localDate(v.started_at, tz),
        member:
          v.identity === 'visible'
            ? (v.member?.display_name ?? v.member_display_name_snapshot ?? null)
            : MASKED_MEMBER_LABEL,
        project: v.project?.title ?? null,
        task: v.task?.title ?? null,
        work_item: WORK_ITEM_LABEL[v.work_item] ?? v.work_item,
        payable_hours: hours(v.payable_seconds),
      }),
    );
    return { columns, rows };
  }

  // ── Audit helpers ────────────────────────────────────────────────────────────────────────────────────────

  private policyEventLabel(changes: unknown): string {
    if (changes && typeof changes === 'object' && !Array.isArray(changes)) {
      const record = changes as Record<string, unknown>;
      if (record.deleted === true) return 'deleted';
      if ('id' in record && !Array.isArray(record.id)) return 'created';
    }
    return 'changed';
  }

  private async profileNames(ids: string[]): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    for (const part of chunks(ids)) {
      const { data, error } = await this.sb
        .from('profiles')
        .select('id, display_name')
        .in('id', part);
      if (error) this.fail('profileNames', error);
      for (const row of (data ?? []) as Array<{
        id: string;
        display_name: string | null;
      }>) {
        names.set(row.id, row.display_name ?? 'Unknown');
      }
    }
    return names;
  }

  /**
   * L22 on engagement sheets: placed talent (a talent engagement) is masked from a workspace manager who is not
   * a party to it; a consultant's own client-engagement time stays named (D57).
   */
  private async maskedEngagementIds(
    viewerId: string,
    engagementIds: string[],
  ): Promise<Set<string>> {
    const masked = new Set<string>();
    await Promise.all(
      engagementIds.map(async (id) => {
        const [kind, seat] = await Promise.all([
          this.engagements.engagementKind(id),
          this.engagements.isParty(id, viewerId),
        ]);
        if (kind !== 'client_services' && seat === null) masked.add(id);
      }),
    );
    return masked;
  }

  /** A malformed id is a miss; a time sentinel maps as usual; anything else is a logged fixed-copy 500. */
  private fail(operation: string, error: PgErrorLike): never {
    if (error?.code === INVALID_TEXT_REPRESENTATION) {
      throw timeNotFound('scope');
    }
    failTimeRead(this.logger, `TimeReportsService.${operation}`, error);
  }
}
