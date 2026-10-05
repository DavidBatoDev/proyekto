// Who may see, decide and read which part of time (backend.md "Authorization", "Cost and Content Redaction").
// Every authority question is a SQL predicate called by RPC (can_view_timesheet, can_decide_timesheet,
// can_manage_team, can_manage_workspace, time_timesheet_deciders); TypeScript only calls them. Redaction is by
// select class: a class the viewer may not read is never fetched (time-entry.select.ts).
import {
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import {
  AssignmentContext,
  EngagementPosition,
  EngagementsService,
  EngagementView,
} from '../../marketplace/engagements/engagements.service';
import { EntitlementsService } from '../../shared/entitlements/entitlements.service';
import { ProjectAuthorizationService } from '../projects/authorization/project-authorization.service';
import type { ProjectRole } from '../projects/permissions/project-permissions';
import {
  getPermission,
  resolvePermissions,
} from '../projects/permissions/project-permissions';
import { isTeamManager as teamManagerCheck } from '../teams/team-authority';
import {
  ENTRY_AUTH_SELECT,
  ENTRY_BASE_SELECT,
  ENTRY_CONTENT_SELECT,
  ENTRY_COST_SELECT,
  ENTRY_IDENTITY_EMAIL_SELECT,
  ENTRY_IDENTITY_SELECT,
  TIMESHEET_SELECT,
} from './time-entry.select';
import { mapTimeDbError, timeNotFound } from './time-errors';
import type { PgErrorLike } from './time-errors';
import { TimePolicyService } from './time-policy.service';
import type {
  ClientHoursLevel,
  ContextKind,
  EntryAuthRow,
  EntryMember,
  EntryProject,
  EntrySheetRef,
  EntrySource,
  EntryTask,
  LegacyStatusMarker,
  RateType,
  TimeEntryView,
  TimesheetRow,
  WorkItem,
  WorkType,
} from './time.types';

/** D32 copy. */
export const MASKED_MEMBER_LABEL = 'Delivery team';
export const HIDDEN_CONTENT_LABEL = "A project you can't open";

/** `.in()` lists are chunked so a 200-row report page never builds an over-long URL. */
const IN_CHUNK = 100;

/** Postgres `invalid_text_representation`: a non-UUID id reached a uuid column. */
const INVALID_TEXT_REPRESENTATION = '22P02';

const CLIENT_LEVEL_RANK: Record<ClientHoursLevel, number> = {
  none: 0,
  summary: 1,
  detailed: 2,
};

interface BaseRow {
  id: string;
  context_kind: ContextKind;
  context_ref: string | null;
  context_label_snapshot: string | null;
  timesheet_id: string | null;
  work_item: WorkItem;
  started_at: string;
  ended_at: string | null;
  paused_at: string | null;
  duration_seconds: number | null;
  break_seconds: number | null;
  break_minutes: number | null;
  payable_seconds: number | null;
  source: EntrySource;
  work_type_snapshot: WorkType;
  legacy_status: LegacyStatusMarker | null;
  payout_id: string | null;
  flagged_reason: string | null;
  project_id: string | null;
  team_id: string | null;
  workspace_id: string | null;
  engagement_assignment_id: string | null;
  created_at: string;
  updated_at: string;
  timesheet: EntrySheetRef | null;
}

interface IdentityRow {
  id: string;
  member_user_id: string | null;
  member_display_name_snapshot: string | null;
  member: EntryMember | null;
}

interface ContentRow {
  id: string;
  task_id: string | null;
  note: string | null;
  task: EntryTask | null;
  project: EntryProject | null;
}

interface CostRow {
  id: string;
  rate_snapshot: number | string | null;
  rate_type_snapshot: RateType | null;
  currency_snapshot: string | null;
  amount_snapshot: number | string | null;
}

interface TeamCostRow {
  id: string;
  workspace_id: string | null;
  member_rates_enabled: boolean | null;
}

function numberOrNull(value: number | string | null | undefined) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function chunks<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += IN_CHUNK) {
    out.push(items.slice(i, i + IN_CHUNK));
  }
  return out;
}

function distinct(values: Array<string | null | undefined>): string[] {
  return [
    ...new Set(
      values.filter((v): v is string => typeof v === 'string' && v !== ''),
    ),
  ];
}

/** Supabase returns SETOF uuid as a flat array; tolerate the object-per-row shape too. */
function uuidList(data: unknown): string[] {
  if (!Array.isArray(data)) return [];
  const out: string[] = [];
  for (const item of data as unknown[]) {
    if (typeof item === 'string') {
      out.push(item);
    } else if (item && typeof item === 'object') {
      const first = Object.values(item as Record<string, unknown>)[0];
      if (typeof first === 'string') out.push(first);
    }
  }
  return out;
}

/** The assignment an assignment-context entry was logged under. */
function assignmentIdOf(row: EntryAuthRow): string | null {
  if (row.context_kind !== 'assignment') return null;
  return row.engagement_assignment_id ?? row.context_ref;
}

/** trg_time_entries_40_lock's reason order: paid → billed → legacy → frozen → sheet status. */
function lockedReason(base: BaseRow, billed: boolean): string | null {
  if (base.payout_id || base.legacy_status === 'paid_outside') return 'paid';
  if (billed) return 'billed';
  if (base.legacy_status) return 'legacy';
  if (base.payable_seconds !== null && base.payable_seconds !== undefined) {
    return 'frozen';
  }
  const status = base.timesheet?.status;
  if (status === 'submitted' || status === 'approved') return `sheet_${status}`;
  return null;
}

/**
 * Memoised party lookups for one call: an entry list repeats the same few assignments and engagements.
 */
class PartyLookup {
  private readonly seats = new Map<
    string,
    Promise<EngagementPosition | null>
  >();

  constructor(
    private readonly engagements: EngagementsService,
    private readonly viewerId: string,
  ) {}

  seat(engagementId: string): Promise<EngagementPosition | null> {
    let pending = this.seats.get(engagementId);
    if (!pending) {
      pending = this.engagements.isParty(engagementId, this.viewerId);
      this.seats.set(engagementId, pending);
    }
    return pending;
  }

  /** CHANGE-7: the worker, the talent engagement's hirer and provider, the client engagement's provider. */
  async providerSide(a: AssignmentContext): Promise<boolean> {
    if (a.worker_user_id === this.viewerId) return true;
    if (a.talent_engagement_id && (await this.seat(a.talent_engagement_id))) {
      return true;
    }
    return (
      a.client_engagement_id !== null &&
      (await this.seat(a.client_engagement_id)) === 'provider'
    );
  }

  /** L22: hirer money rights cover only the hirer's own talent engagement. */
  async talentHirer(a: AssignmentContext): Promise<boolean> {
    return (
      a.talent_engagement_id !== null &&
      (await this.seat(a.talent_engagement_id)) === 'hirer'
    );
  }
}

@Injectable()
export class TimeAuthorityService {
  private readonly logger = new Logger(TimeAuthorityService.name);

  constructor(
    @Inject(SUPABASE_ADMIN) private readonly sb: SupabaseClient,
    private readonly projectAuth: ProjectAuthorizationService,
    private readonly engagements: EngagementsService,
    private readonly entitlements: EntitlementsService,
    private readonly policy: TimePolicyService,
  ) {}
  // DI graph (acyclic): policy ← {rates, authority, loggingContext}; {loggingContext, rates, authority,
  // notifications} ← entries; {authority, rates, notifications} ← timesheets; {entries, timesheets} ← cron.

  /** rpc can_view_timesheet */
  canViewTimesheet(userId: string, sheetId: string): Promise<boolean> {
    return this.predicate('can_view_timesheet', {
      p_timesheet_id: sheetId,
      p_user_id: userId,
    });
  }

  /** rpc can_decide_timesheet */
  canDecide(userId: string, sheetId: string): Promise<boolean> {
    return this.predicate('can_decide_timesheet', {
      p_timesheet_id: sheetId,
      p_user_id: userId,
    });
  }

  /** 404 TIMESHEET_NOT_FOUND */
  async assertViewTimesheet(
    userId: string,
    sheetId: string,
  ): Promise<TimesheetRow> {
    const { data, error } = await this.sb
      .from('timesheets')
      .select(TIMESHEET_SELECT)
      .eq('id', sheetId)
      .maybeSingle();
    if (error) {
      if (error.code === INVALID_TEXT_REPRESENTATION) {
        throw timeNotFound('timesheet');
      }
      this.fail('assertViewTimesheet', error);
    }
    const sheet = data as TimesheetRow | null;
    if (!sheet) throw timeNotFound('timesheet');
    if (sheet.member_user_id === userId) return sheet;
    if (await this.canViewTimesheet(userId, sheet.id)) return sheet;
    throw timeNotFound('timesheet');
  }

  /** Personal: member only. Else can_view_timesheet on its sheet, OR (context_kind='team' AND isTeamManager(team_id))
   *  (D49). Sheetless non-personal (pre-M2 only): member, or team manager for team context. 404 TIME_NOT_FOUND. */
  async assertViewEntry(
    userId: string,
    entryId: string,
  ): Promise<EntryAuthRow> {
    const row = await this.loadAuthRow(entryId);
    if (!row) throw timeNotFound('entry');
    if (row.member_user_id === userId) return row;
    if (row.context_kind === 'personal') throw timeNotFound('entry');
    if (
      row.timesheet_id &&
      (await this.canViewTimesheet(userId, row.timesheet_id))
    ) {
      return row;
    }
    // D49 (critic CC10): a team manager reads every team-context entry, also on workspace-scope sheets.
    if (
      row.context_kind === 'team' &&
      row.team_id &&
      (await this.isTeamManager(row.team_id, userId))
    ) {
      return row;
    }
    throw timeNotFound('entry');
  }

  /** Member of the entry, else 404 (not 403) — writes on someone else's entry. */
  async assertOwnEntry(userId: string, entryId: string): Promise<EntryAuthRow> {
    const row = await this.loadAuthRow(entryId);
    if (!row || row.member_user_id !== userId) throw timeNotFound('entry');
    return row;
  }

  /** rpc time_timesheet_deciders */
  async approversFor(sheetId: string): Promise<string[]> {
    const { data, error } = (await this.sb.rpc('time_timesheet_deciders', {
      p_timesheet_id: sheetId,
    })) as { data: unknown; error: PgErrorLike | null };
    if (error) {
      if (error.code === INVALID_TEXT_REPRESENTATION) return [];
      this.fail('approversFor', error);
    }
    return distinct(uuidList(data));
  }

  /** team-authority.ts (P04) */
  isTeamManager(teamId: string, userId: string): Promise<boolean> {
    return teamManagerCheck(this.sb, teamId, userId);
  }

  /** rpc can_manage_workspace */
  canManageWorkspace(workspaceId: string, userId: string): Promise<boolean> {
    return this.predicate('can_manage_workspace', {
      p_workspace_id: workspaceId,
      p_user_id: userId,
    });
  }

  /**
   * Entry ids whose money (rate, currency, amount) the viewer may read: their own entries; a team entry when the
   * viewer manages the team, the team has member rates on and its plan subject has `time_team_rules`; an
   * assignment entry whose governing talent engagement the viewer hires. Workspace managers never see cost
   * through time (books apply `view_costs` separately).
   */
  async costVisible(
    viewerId: string,
    rows: EntryAuthRow[],
  ): Promise<Set<string>> {
    const visible = new Set<string>();
    const others = rows.filter((r) => {
      if (r.member_user_id === viewerId) {
        visible.add(r.id);
        return false;
      }
      return true;
    });
    if (others.length === 0) return visible;

    const teamRows = others.filter(
      (r) => r.context_kind === 'team' && r.team_id,
    );
    const assignmentRows = others.filter((r) => assignmentIdOf(r) !== null);

    const [teamVerdicts, contexts] = await Promise.all([
      this.teamCostVerdicts(viewerId, distinct(teamRows.map((r) => r.team_id))),
      this.assignmentContexts(assignmentRows),
    ]);
    for (const r of teamRows) {
      if (teamVerdicts.get(r.team_id as string)) visible.add(r.id);
    }

    const parties = new PartyLookup(this.engagements, viewerId);
    await Promise.all(
      assignmentRows.map(async (r) => {
        const a = contexts.get(assignmentIdOf(r) as string);
        if (a && (await parties.talentHirer(a))) visible.add(r.id);
      }),
    );
    return visible;
  }

  /**
   * Entry ids whose person the viewer may see. Team, workspace and personal entries show their person to
   * whoever can view them; an assignment entry shows its worker only to the worker and the provider-side parties
   * (talent hirer and provider, client provider). Everyone else, the client hirer included, reads
   * "Delivery team" (CHANGE-7, E35).
   */
  async identityVisible(
    viewerId: string,
    rows: EntryAuthRow[],
  ): Promise<Set<string>> {
    const visible = new Set<string>();
    const assignmentRows: EntryAuthRow[] = [];
    for (const r of rows) {
      if (r.member_user_id === viewerId || r.context_kind !== 'assignment') {
        visible.add(r.id);
      } else {
        assignmentRows.push(r);
      }
    }
    if (assignmentRows.length === 0) return visible;

    const contexts = await this.assignmentContexts(assignmentRows);
    const parties = new PartyLookup(this.engagements, viewerId);
    await Promise.all(
      assignmentRows.map(async (r) => {
        const id = assignmentIdOf(r);
        const a = id ? contexts.get(id) : undefined;
        // A severed or unknown assignment fails closed: masked.
        if (a && (await parties.providerSide(a))) visible.add(r.id);
      }),
    );
    return visible;
  }

  /** project ids where viewer has access.time (resolvePermissions). Own entries are always content-visible. */
  async contentVisible(
    viewerId: string,
    projectIds: string[],
  ): Promise<Set<string>> {
    const ids = distinct(projectIds);
    const visible = new Set<string>();
    if (ids.length === 0) return visible;

    // The OR-union of every share row, as ProjectAuthorizationService.resolvePermissions does for one project,
    // batched: one read for every project on the page.
    for (const part of chunks(ids)) {
      const { data, error } = await this.sb
        .from('project_access')
        .select('project_id, role, capabilities')
        .eq('user_id', viewerId)
        .in('project_id', part);
      if (error) this.fail('contentVisible', error);
      for (const row of (data ?? []) as Array<{
        project_id: string;
        role: ProjectRole;
        capabilities: Record<string, unknown> | null;
      }>) {
        const perms = resolvePermissions(row.role, row.capabilities ?? null);
        if (getPermission(perms, 'access.time')) visible.add(row.project_id);
      }
    }

    // An owner with no share row still reads everything on their project.
    const rest = ids.filter((id) => !visible.has(id));
    for (const part of chunks(rest)) {
      const { data, error } = await this.sb
        .from('projects')
        .select('id')
        .eq('owner_id', viewerId)
        .in('id', part);
      if (error) this.fail('contentVisible.owner', error);
      for (const row of (data ?? []) as Array<{ id: string }>) {
        visible.add(row.id);
      }
    }
    return visible;
  }

  /** Base select for all ids, then identity/content/cost selects with .in('id', allowed) per class.
   *  Never fetches a hidden class. Preserves input order. withEmail: self and team-manager views only. */
  async hydrate(
    viewerId: string,
    rows: EntryAuthRow[],
    o?: { withEmail?: boolean },
  ): Promise<TimeEntryView[]> {
    if (rows.length === 0) return [];
    const ids = distinct(rows.map((r) => r.id));
    const others = rows.filter((r) => r.member_user_id !== viewerId);

    const [costIds, identityIds, contentProjects, baseRows] = await Promise.all(
      [
        this.costVisible(viewerId, rows),
        this.identityVisible(viewerId, rows),
        this.contentVisible(
          viewerId,
          distinct(others.map((r) => r.project_id)),
        ),
        this.selectByIds<BaseRow>(ENTRY_BASE_SELECT, ids),
      ],
    );

    // Own entries are always content-visible; others follow access.time on their project (L21, CHANGE-8).
    const contentIds = distinct(
      rows
        .filter(
          (r) =>
            r.member_user_id === viewerId ||
            (r.project_id !== null && contentProjects.has(r.project_id)),
        )
        .map((r) => r.id),
    );
    const base = new Map(baseRows.map((r) => [r.id, r]));
    const unpaid = ids.filter((id) => {
      const b = base.get(id);
      return (
        b !== undefined && !b.payout_id && b.legacy_status !== 'paid_outside'
      );
    });

    const [identityRows, contentRows, costRows, billed] = await Promise.all([
      this.selectByIds<IdentityRow>(
        o?.withEmail ? ENTRY_IDENTITY_EMAIL_SELECT : ENTRY_IDENTITY_SELECT,
        ids.filter((id) => identityIds.has(id)),
      ),
      this.selectByIds<ContentRow>(ENTRY_CONTENT_SELECT, contentIds),
      this.selectByIds<CostRow>(
        ENTRY_COST_SELECT,
        ids.filter((id) => costIds.has(id)),
      ),
      this.billedIds(unpaid),
    ]);
    const identity = new Map(identityRows.map((r) => [r.id, r]));
    const content = new Map(contentRows.map((r) => [r.id, r]));
    const cost = new Map(costRows.map((r) => [r.id, r]));

    const views: TimeEntryView[] = [];
    for (const r of rows) {
      const b = base.get(r.id);
      // Deleted between authorisation and hydration: skip, never invent a row.
      if (!b) continue;
      const id = identity.get(r.id);
      const c = content.get(r.id);
      const k = cost.get(r.id);
      const view: TimeEntryView = {
        id: b.id,
        context_kind: b.context_kind,
        context_ref: b.context_ref,
        context_label_snapshot: b.context_label_snapshot,
        timesheet_id: b.timesheet_id,
        work_item: b.work_item,
        started_at: b.started_at,
        ended_at: b.ended_at,
        paused_at: b.paused_at,
        duration_seconds: b.duration_seconds,
        break_seconds: b.break_seconds ?? 0,
        break_minutes: b.break_minutes ?? 0,
        payable_seconds: b.payable_seconds,
        source: b.source,
        work_type_snapshot: b.work_type_snapshot,
        legacy_status: b.legacy_status,
        payout_id: b.payout_id,
        flagged_reason: b.flagged_reason,
        project_id: b.project_id,
        team_id: b.team_id,
        workspace_id: b.workspace_id,
        engagement_assignment_id: b.engagement_assignment_id,
        created_at: b.created_at,
        updated_at: b.updated_at,
        timesheet: b.timesheet ?? null,
        locked_reason: lockedReason(b, billed.has(r.id)),
        ...(id
          ? {
              identity: 'visible' as const,
              member_user_id: id.member_user_id,
              member_display_name_snapshot: id.member_display_name_snapshot,
              member: id.member ?? null,
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
              note: c.note,
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
        cost: k ? 'visible' : 'hidden',
      };
      if (k) {
        view.rate_snapshot = numberOrNull(k.rate_snapshot) ?? 0;
        view.rate_type_snapshot = k.rate_type_snapshot ?? 'hourly';
        view.currency_snapshot = k.currency_snapshot ?? 'USD';
        view.amount_snapshot = numberOrNull(k.amount_snapshot);
      }
      views.push(view);
    }
    return views;
  }

  /** least(invoice-independent client_hours_detail_level) over the caller's active client-engagement
   *  hirer seats linked to the project; legacy contracts and none → 'none'. */
  async clientHoursLevel(
    userId: string,
    projectId: string,
  ): Promise<ClientHoursLevel> {
    let views: EngagementView[];
    try {
      views = await this.engagements.list(userId, {
        kind: 'client_services',
        status: 'active',
        project_id: projectId,
      });
    } catch (error) {
      // A display level: fail closed (no client hours) rather than break the project page.
      this.logger.warn(
        `TimeAuthorityService.clientHoursLevel failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 'none';
    }
    const levels = views
      .filter(
        (v) =>
          v.viewer_position === 'hirer' &&
          v.project_links.some(
            (l) => l.project_id === projectId && l.status === 'active',
          ),
      )
      .map((v) => {
        const level = v.current_settings?.client_hours_detail_level;
        return level === 'summary' || level === 'detailed' ? level : 'none';
      });
    if (levels.length === 0) return 'none';
    return levels.reduce<ClientHoursLevel>(
      (least, level) =>
        CLIENT_LEVEL_RANK[level] < CLIENT_LEVEL_RANK[least] ? level : least,
      'detailed',
    );
  }

  /** Workers of assignments on the project under an engagement where the viewer is not a provider-side party. */
  async maskedWorkerIds(
    projectId: string,
    viewerId: string,
  ): Promise<Set<string>> {
    const assignments = await this.engagements.assignmentsForProject(projectId);
    const parties = new PartyLookup(this.engagements, viewerId);
    const masked = new Set<string>();
    const known = new Set<string>();
    await Promise.all(
      assignments.map(async (a) => {
        if (await parties.providerSide(a)) known.add(a.worker_user_id);
        else masked.add(a.worker_user_id);
      }),
    );
    // A person the viewer may already name through another assignment on this project is not masked.
    for (const id of known) masked.delete(id);
    masked.delete(viewerId);
    return masked;
  }

  // ── Internals ───────────────────────────────────────────────────────────────

  private async predicate(
    fn: string,
    args: Record<string, string>,
  ): Promise<boolean> {
    if (Object.values(args).some((v) => !v)) return false;
    const { data, error } = (await this.sb.rpc(fn, args)) as {
      data: unknown;
      error: PgErrorLike | null;
    };
    if (error) {
      // A raw id that is not a UUID is simply not something the caller can open.
      if (error.code === INVALID_TEXT_REPRESENTATION) return false;
      this.fail(fn, error);
    }
    return data === true;
  }

  private async loadAuthRow(entryId: string): Promise<EntryAuthRow | null> {
    const { data, error } = await this.sb
      .from('time_entries')
      .select(ENTRY_AUTH_SELECT)
      .eq('id', entryId)
      .maybeSingle();
    if (error) {
      if (error.code === INVALID_TEXT_REPRESENTATION) return null;
      this.fail('loadAuthRow', error);
    }
    return (data as EntryAuthRow | null) ?? null;
  }

  /** One select per class, chunked; an empty id list issues no query. */
  private async selectByIds<T>(select: string, ids: string[]): Promise<T[]> {
    if (ids.length === 0) return [];
    const out: T[] = [];
    for (const part of chunks(ids)) {
      const { data, error } = await this.sb
        .from('time_entries')
        .select(select)
        .in('id', part);
      if (error) this.fail('hydrate', error);
      out.push(...((data ?? []) as unknown as T[]));
    }
    return out;
  }

  /** Entries reserved on an invoice (CHANGE-6: billed). */
  private async billedIds(ids: string[]): Promise<Set<string>> {
    const billed = new Set<string>();
    for (const part of chunks(ids)) {
      const { data, error } = await this.sb
        .from('invoice_time_entries')
        .select('entry_id')
        .in('entry_id', part);
      if (error) this.fail('billedIds', error);
      for (const row of (data ?? []) as Array<{ entry_id: string }>) {
        billed.add(row.entry_id);
      }
    }
    return billed;
  }

  /** Per team: does the viewer see its members' money? Manager + member rates on + time_team_rules (D26). */
  private async teamCostVerdicts(
    viewerId: string,
    teamIds: string[],
  ): Promise<Map<string, boolean>> {
    const verdicts = new Map<string, boolean>();
    if (teamIds.length === 0) return verdicts;
    const { data, error } = await this.sb
      .from('teams')
      .select('id, workspace_id, member_rates_enabled')
      .in('id', teamIds);
    if (error) this.fail('teamCostVerdicts', error);
    await Promise.all(
      ((data ?? []) as TeamCostRow[]).map(async (team) => {
        if (team.member_rates_enabled !== true) {
          verdicts.set(team.id, false);
          return;
        }
        if (!(await this.isTeamManager(team.id, viewerId))) {
          verdicts.set(team.id, false);
          return;
        }
        const planRef = await this.policy.planRefForTeam({
          id: team.id,
          workspace_id: team.workspace_id,
        });
        verdicts.set(
          team.id,
          await this.entitlements.hasFeature(planRef, 'time_team_rules'),
        );
      }),
    );
    return verdicts;
  }

  /**
   * The assignments behind assignment-context rows: one project-wide read per project (three queries, whatever
   * the number of entries), then a direct read for any id the project list did not hold.
   */
  private async assignmentContexts(
    rows: EntryAuthRow[],
  ): Promise<Map<string, AssignmentContext>> {
    const out = new Map<string, AssignmentContext>();
    const wanted = new Set(distinct(rows.map(assignmentIdOf)));
    if (wanted.size === 0) return out;

    const lists = await Promise.all(
      distinct(rows.map((r) => r.project_id)).map((projectId) =>
        this.engagements.assignmentsForProject(projectId),
      ),
    );
    for (const list of lists) {
      for (const a of list) if (wanted.has(a.id)) out.set(a.id, a);
    }
    const missing = [...wanted].filter((id) => !out.has(id));
    const direct = await Promise.all(
      missing.map((id) => this.engagements.getAssignment(id)),
    );
    for (const a of direct) if (a) out.set(a.id, a);
    return out;
  }

  /** A time sentinel maps as usual; anything else is a logged 500 with no Postgres text in the body. */
  private fail(operation: string, error: PgErrorLike): never {
    const mapped = mapTimeDbError(error);
    if (mapped) throw mapped;
    this.logger.error(
      `TimeAuthorityService.${operation} failed: ${error.message ?? 'unknown error'}`,
    );
    throw new InternalServerErrorException(
      "Proyekto couldn't check access to this time. Try again.",
    );
  }
}
