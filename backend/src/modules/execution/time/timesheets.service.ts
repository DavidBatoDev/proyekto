// Timesheets (backend.md "Timesheet State Machine", "Endpoints", CHANGE-4, D10, D33, D51, D63): the read model,
// the freeze builder, the approval queue, the overview, and the only door to time_timesheet_transition.
// TypeScript never writes a timesheet: every status, decision and freeze column changes inside the RPC.
import {
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import type { AuthenticatedUser } from '../../../common/interfaces/authenticated-request.interface';
import {
  EngagementsService,
  type EngagementTimeSettingsRow,
} from '../../marketplace/engagements/engagements.service';
import { EntitlementsService } from '../../shared/entitlements/entitlements.service';
import type { ProjectRole } from '../projects/permissions/project-permissions';
import {
  ROLE_DEFAULTS,
  getPermission,
  resolvePermissions,
} from '../projects/permissions/project-permissions';
import { PERSONAL_LABEL } from './logging-context.service';
import { TimeAuthorityService } from './time-authority.service';
import {
  ENTRY_AUTH_SELECT,
  TIMESHEET_DETAIL_SELECT,
  TIMESHEET_EVENT_SELECT,
  TIMESHEET_SELECT,
} from './time-entry.select';
import {
  type PgErrorLike,
  isDeadlock,
  mapTimeDbError,
  throwTimeDb,
  timeError,
  timeNotFound,
} from './time-errors';
import {
  amountFor,
  capInOrder,
  roundSeconds,
  sumByCurrency,
} from './time-freeze';
import { TimeNotificationsService } from './time-notifications.service';
import {
  addDays,
  isValidTimezone,
  localDate,
  localRangeToUtc,
  monthWindow,
  safeTimezone,
  weekWindow,
} from './time-periods';
import { TimePolicyService } from './time-policy.service';
import { TimeRatesService } from './time-rates.service';
import {
  EMPTY_TIME_OVERVIEW,
  type ApprovalRow,
  type ApproverScope,
  type ContextKind,
  type DeciderName,
  type EntryAuthRow,
  type FreezeEntryValue,
  type FreezePayload,
  type FreezePreview,
  type FreezePreviewEntry,
  type FrozenRate,
  type OverviewContext,
  type Paged,
  type PolicySnapshot,
  type RateType,
  type RoutingPreview,
  type SheetFreeze,
  type SheetRouting,
  type SheetScopeKind,
  type TimeEntryView,
  type TimeOverview,
  type TimesheetAction,
  type TimesheetDetail,
  type TimesheetEventRow,
  type TimesheetRow,
  type TimesheetStatus,
  type TimesheetSummary,
  type WorkType,
  type WorkspaceTimeAdmin,
} from './time.types';

// ── constants ───────────────────────────────────────────────────────────────────────────────────────────

/** `.in()` lists are chunked so a long id list never builds an over-long URL. */
const IN_CHUNK = 100;
/** PostgREST answers at most `max_rows` (1000 on Supabase) per request: page every unbounded read. */
const PAGE = 1000;
/** Safety stop for a paged read (a runaway list never pins the request). */
const MAX_PAGED_ROWS = 20_000;
/** GET /time/me/timesheets: newest first, at most this many sheets. */
const MINE_LIMIT = 200;
/** backend.md me/overview: "entries in 30 days". */
const OVERVIEW_DAYS = 30;
/** Most recent entries the overview reads to find the caller's contexts. */
const OVERVIEW_ENTRY_LIMIT = 1000;
/** A1/A2: names per decider list. */
export const DECIDER_NAMES_MAX = 5;
/** A3 `needs_review`: an entry this long (or carrying a flagged_reason) needs a look (ux.md "Long timers"). */
export const NEEDS_REVIEW_SECONDS = 10 * 3600;
/** A3 `over_cap_seconds`: freeze previews per queue page; later rows read 0 with `flags_partial`. */
export const FLAGS_FREEZE_MAX = 50;
/** A3: no new freeze preview starts once a queue page has spent this long on them; the rest read `flags_partial`,
 *  so the waiting list answers well inside the global request timeout (D52). */
export const FLAGS_BUDGET_MS = 5_000;
/** Concurrent per-sheet calls while decorating `me/timesheets` (A1/A2) and previewing queue flags (A3). */
const DECORATE_CONCURRENCY = 8;

const APPROVER_SCOPES: ReadonlySet<string> = new Set<ApproverScope>([
  'team',
  'workspace',
  'hirer',
  'auto',
  'self',
]);
/** A zero rate for preview-only freezes (the caps never read the rate). */
const NO_RATE: FrozenRate = {
  rate: 0,
  rateType: 'hourly',
  currency: 'USD',
  amountable: false,
};

const ACTIONS: ReadonlySet<TimesheetAction> = new Set<TimesheetAction>([
  'submit',
  'auto_submit',
  'submit_on_deletion',
  'withdraw',
  'approve',
  'return',
  'reopen',
  'request_reopen',
]);
/** p_actor NULL is valid only for these (D09). */
const SYSTEM_ACTIONS: ReadonlySet<TimesheetAction> = new Set<TimesheetAction>([
  'auto_submit',
  'submit_on_deletion',
  'approve',
]);
/** Actions whose transition can end approved, so the RPC needs a freeze (D10). */
const FREEZE_ACTIONS: ReadonlySet<TimesheetAction> = new Set<TimesheetAction>([
  'submit',
  'auto_submit',
  'approve',
]);
const SELF_ROUTES: ReadonlySet<string> = new Set(['auto', 'self']);
const DECIDER_ROUTES: ReadonlySet<string> = new Set([
  'team',
  'workspace',
  'hirer',
]);

/** D33: a note is required before the RPC for these (400, not the RPC's 409). */
export const TIMESHEET_NOTE_REQUIRED_MESSAGE =
  'Add a note so the person knows what to change.';
export const TIMESHEET_REVISIONS_MESSAGE =
  'Send one expected revision for each timesheet.';
const READ_FAILED_MESSAGE = "Proyekto couldn't load timesheets. Try again.";

/** The columns the freeze reads per entry (internal: rates never leave this service except as preview totals). */
const FREEZE_ENTRY_SELECT =
  'id, member_user_id, project_id, context_kind, context_ref, team_id, workspace_id, ' +
  'engagement_assignment_id, timesheet_id, started_at, ended_at, duration_seconds, work_type_snapshot, ' +
  'created_at, rate_snapshot, rate_type_snapshot, currency_snapshot, legacy_status';

const SHEET_STATS_SELECT =
  'id, timesheet_id, ended_at, duration_seconds, flagged_reason';

const TIMESHEET_COLUMNS = TIMESHEET_SELECT.split(',').map((c) => c.trim());

// ── row shapes ──────────────────────────────────────────────────────────────────────────────────────────

interface DetailSheetRow extends TimesheetRow {
  policy_snapshot: Record<string, unknown> | null;
}

interface FreezeEntryRow {
  id: string;
  member_user_id: string | null;
  project_id: string | null;
  context_kind: ContextKind;
  context_ref: string | null;
  team_id: string | null;
  workspace_id: string | null;
  engagement_assignment_id: string | null;
  timesheet_id: string | null;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  work_type_snapshot: WorkType | null;
  created_at: string;
  rate_snapshot: number | string | null;
  rate_type_snapshot: RateType | null;
  currency_snapshot: string | null;
  legacy_status: string | null;
}

interface StatsRow {
  id: string;
  timesheet_id: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  flagged_reason: string | null;
}

interface SheetStats {
  entry_count: number;
  running_count: number;
  logged_seconds: number;
}

/** time_sheet_routing_preview, narrowed to what A1 returns. */
interface RouteResult {
  approver_scope: ApproverScope;
  cost_money: boolean;
}

/** The scope columns time_scope_deciders reads from a sheet. */
type DeciderScopeSheet = Pick<
  TimesheetRow,
  'team_id' | 'policy_workspace_id' | 'engagement_id' | 'member_user_id'
>;

interface OverviewEntryRow {
  id: string;
  context_kind: ContextKind;
  context_ref: string | null;
  context_label_snapshot: string | null;
  timesheet_id: string | null;
  started_at: string;
  duration_seconds: number | null;
}

/** What the freeze reads from the policy layers: only the rounding. The policy `weekly_limit_minutes` never cuts
 *  payable time (D65); it stays in `policy_snapshot` as the review screen's indicator. */
interface PolicyLayers {
  rounding: number;
}

/** One entry while its freeze is computed. `payable` only ever shrinks as caps apply. */
interface FreezeWork {
  e: FreezeEntryRow;
  d: string;
  rounded: number;
  payable: number;
  rate: FrozenRate;
  /** Every cap window key the entry counts in (its payable is added to each once the sheet is done). */
  windows: string[];
}

/** The entries of one cap window on one sheet. */
interface CapGroup {
  cap: number;
  rows: FreezeWork[];
  window: { start: string; end: string };
  teamId: string | null;
}

type RpcResult = { data: unknown; error: PgErrorLike | null };
type PageResult = { data: unknown; error: PgErrorLike | null };

// ── pure helpers ────────────────────────────────────────────────────────────────────────────────────────

function distinct(values: Array<string | null | undefined>): string[] {
  return [
    ...new Set(
      values.filter((v): v is string => typeof v === 'string' && v !== ''),
    ),
  ];
}

function chunks<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += IN_CHUNK) {
    out.push(items.slice(i, i + IN_CHUNK));
  }
  return out;
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

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** A positive limit, else null (no cap). */
function positiveOrNull(value: unknown): number | null {
  const n = toNumber(value);
  return n !== null && n > 0 ? n : null;
}

/** Only the TimesheetRow columns (the RPC returns full rows, policy_snapshot included). */
function toSheetRow(row: Record<string, unknown>): TimesheetRow {
  const out: Record<string, unknown> = {};
  for (const column of TIMESHEET_COLUMNS) out[column] = row[column] ?? null;
  return out as unknown as TimesheetRow;
}

function isSnapshotObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** policy_snapshot minus `routing` (critic CC15), and the routing; both null while the sheet is open. */
function splitSnapshot(
  snapshot: Record<string, unknown> | null,
  status: TimesheetStatus,
): { rules: PolicySnapshot | null; routing: SheetRouting | null } {
  if (status === 'open' || !isSnapshotObject(snapshot)) {
    return { rules: null, routing: null };
  }
  const { routing, ...rest } = snapshot;
  return {
    rules:
      Object.keys(rest).length > 0 ? (rest as unknown as PolicySnapshot) : null,
    routing: isSnapshotObject(routing)
      ? (routing as unknown as SheetRouting)
      : null,
  };
}

/** Rounding from a resolved policy (or a sheet's snapshot of one). */
function layersOf(policy: Record<string, unknown>): PolicyLayers {
  return { rounding: toNumber(policy.rounding_minutes) ?? 0 };
}

/** The instant SQL resolves a sheet's policy at: period_start::timestamp AT TIME ZONE timezone. */
function periodStartInstant(sheet: {
  period_start: string;
  timezone: string;
}): Date {
  const { fromIso } = localRangeToUtc(
    { start: sheet.period_start, end: sheet.period_start },
    safeTimezone(sheet.timezone),
  );
  return new Date(fromIso);
}

function emptyStats(): SheetStats {
  return { entry_count: 0, running_count: 0, logged_seconds: 0 };
}

function errorBody(e: HttpException): Record<string, unknown> {
  const body = e.getResponse();
  return body && typeof body === 'object'
    ? (body as Record<string, unknown>)
    : {};
}

/** True for STALE_REVISION {reason:'entry_set'}: the sheet's entries changed after the freeze was built. */
function isEntrySetStale(err: PgErrorLike | null | undefined): boolean {
  if (!err || !/^\s*STALE_REVISION\b/.test(err.message ?? '')) return false;
  try {
    const detail: unknown = JSON.parse(err.details ?? '');
    return (
      isSnapshotObject(detail) &&
      (detail as { reason?: unknown }).reason === 'entry_set'
    );
  } catch {
    return false;
  }
}

function byStart(
  a: { id: string; started_at: string },
  b: { id: string; started_at: string },
): number {
  const at = Date.parse(a.started_at);
  const bt = Date.parse(b.started_at);
  if (at !== bt) return at - bt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Adds an entry to its cap window; entries under different caps in one window keep the strictest. */
function addToGroup(
  groups: Map<string, CapGroup>,
  key: string,
  w: FreezeWork,
  capSeconds: number,
  window: { start: string; end: string },
  teamId: string | null,
): void {
  const group = groups.get(key);
  if (group) {
    group.cap = Math.min(group.cap, capSeconds);
    group.rows.push(w);
  } else {
    groups.set(key, { cap: capSeconds, rows: [w], window, teamId });
  }
  w.windows.push(key);
}

/** At most `limit` calls in flight; results in input order. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return out;
}

/** The ids' names in display order (name, then id), capped; ids without a live profile are skipped. */
function pickNames(
  ids: string[],
  names: Map<string, DeciderName>,
): DeciderName[] {
  return distinct(ids)
    .map((id) => names.get(id))
    .filter((n): n is DeciderName => n !== undefined)
    .sort((a, b) => {
      const an = a.display_name ?? '';
      const bn = b.display_name ?? '';
      // Unnamed profiles last.
      if ((an === '') !== (bn === '')) return an === '' ? 1 : -1;
      const byName = an.localeCompare(bn);
      if (byName !== 0) return byName;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })
    .slice(0, DECIDER_NAMES_MAX);
}

/** Per-call memo of async lookups (one freeze build, one overview). */
class Memo<T> {
  private readonly values = new Map<string, Promise<T>>();
  get(key: string, load: () => Promise<T>): Promise<T> {
    let pending = this.values.get(key);
    if (!pending) {
      pending = load();
      this.values.set(key, pending);
    }
    return pending;
  }
}

@Injectable()
export class TimesheetsService {
  private readonly logger = new Logger(TimesheetsService.name);

  constructor(
    @Inject(SUPABASE_ADMIN) private readonly sb: SupabaseClient,
    private readonly authority: TimeAuthorityService,
    private readonly policy: TimePolicyService,
    private readonly rates: TimeRatesService,
    private readonly notifications: TimeNotificationsService,
    private readonly engagements: EngagementsService,
    private readonly entitlements: EntitlementsService,
  ) {}

  // ── reads ───────────────────────────────────────────────────────────────────────────────────────────

  /** can_view_timesheet else 404. Entries redacted by class (hydrate); deciders get the freeze preview. The
   *  member gets where a submit would go (A1, open/returned) or who it waits on (A2, submitted). */
  async get(viewerId: string, id: string): Promise<TimesheetDetail> {
    const sheet = await this.authority.assertViewTimesheet(viewerId, id);
    const isMember = sheet.member_user_id === viewerId;
    const memberEditable =
      isMember && (sheet.status === 'open' || sheet.status === 'returned');
    const memberSubmitted = isMember && sheet.status === 'submitted';

    const [snapshot, authRows, events, canDecide, route] = await Promise.all([
      this.policySnapshot(sheet.id),
      this.entryAuthRows(sheet.id),
      this.events(sheet.id),
      // The member never decides their own sheet (time_can_decide_scope excludes them, `self` included).
      isMember
        ? Promise.resolve(false)
        : this.authority.canDecide(viewerId, sheet.id),
      // A1 (and canSubmitNow): read once, best effort.
      memberEditable
        ? this.routingPreviewSoft(sheet.id)
        : Promise.resolve(null),
    ]);
    // Email only in self and team-manager views (backend.md "Cost and Content Redaction").
    const withEmail =
      isMember ||
      (sheet.scope_kind === 'team' && sheet.team_id
        ? await this.authority.isTeamManager(sheet.team_id, viewerId)
        : false);
    const entries = await this.authority.hydrate(viewerId, authRows, {
      withEmail,
    });

    const stats = emptyStats();
    for (const e of entries) {
      stats.entry_count += 1;
      if (!e.ended_at) stats.running_count += 1;
      stats.logged_seconds += Math.max(0, e.duration_seconds ?? 0);
    }
    const { rules, routing } = splitSnapshot(snapshot, sheet.status);
    const actions = this.viewerActions(
      sheet,
      isMember,
      canDecide,
      entries,
      stats,
      route,
    );

    const detail: TimesheetDetail = {
      sheet: { ...sheet, ...stats },
      entries,
      events,
      rules,
      routing,
      viewer: { is_member: isMember, can_decide: canDecide, actions },
    };

    if (canDecide && sheet.status === 'submitted') {
      const { payload, preview } = await this.buildFreeze([sheet.id], {
        approveOvertime: false,
        mode: 'approve',
      });
      const sheetPreview: FreezePreview = preview[sheet.id] ?? {
        timesheet_id: sheet.id,
        entries: [],
        over_cap_seconds: 0,
      };
      // L64 amounts only when the decider may read the money of every entry on the sheet.
      const costIds = await this.authority.costVisible(viewerId, authRows);
      if (authRows.every((r) => costIds.has(r.id))) {
        sheetPreview.amounts_by_currency = sumByCurrency(
          Object.values(payload[sheet.id] ?? {}),
        );
      }
      detail.freeze_preview = sheetPreview;
    }
    // deciders_count = 0 drives "No one else can approve this. Add a workspace admin." (ux.md), which the member
    // reads on their submitted sheet, so the member gets it while submitted too.
    if (canDecide || memberSubmitted) {
      const ids = await this.deciders(sheet.id);
      detail.deciders_count = ids.length;
      // A2: "Waiting on Ana Reyes". Best effort: a failed name read only omits the list.
      if (memberSubmitted) {
        const names = await this.profileNamesSoft(ids);
        if (names) detail.deciders = pickNames(ids, names);
      }
    }
    // A1: "Goes to …" on the Submit sheet. Omitted when the preview (or a name read) failed.
    if (memberEditable && route) {
      const ids = await this.scopeDecidersSoft(sheet, route.approver_scope);
      const names = ids ? await this.profileNamesSoft(ids) : null;
      if (ids && names) {
        detail.routing_preview = { ...route, deciders: pickNames(ids, names) };
      }
    }
    return detail;
  }

  /** The caller's own sheets (every workspace, by member id), newest first; `origin` and `submission_kind` kept.
   *  Open/returned sheets carry `routing_preview` (A1), submitted ones `deciders` (A2). */
  async listMine(
    userId: string,
    q: { from?: string; to?: string },
  ): Promise<TimesheetSummary[]> {
    let query = this.sb
      .from('timesheets')
      .select(TIMESHEET_SELECT)
      .eq('member_user_id', userId);
    if (q.from) query = query.gte('period_end', q.from.slice(0, 10));
    if (q.to) query = query.lte('period_start', q.to.slice(0, 10));
    const { data, error } = await query
      .order('period_start', { ascending: false })
      .order('id', { ascending: true })
      .limit(MINE_LIMIT);
    if (error) this.fail('list_mine', error);
    const items = await this.summaries(
      (data ?? []) as unknown as TimesheetRow[],
    );
    await this.decorateMine(items);
    return items;
  }

  // ── transitions ─────────────────────────────────────────────────────────────────────────────────────

  /** The only path to time_timesheet_transition. Builds p_freeze for submit/auto_submit/approve,
   *  maps errors, retries once on 40P01 and (system actor only) once on STALE_REVISION{reason:'entry_set'},
   *  then sends one notification per transition. expectedRevisions null only for a NULL actor. */
  async act(
    actorId: string | null,
    action: TimesheetAction,
    ids: string[],
    expectedRevisions: number[] | null,
    o: { note?: string; approveOvertime?: boolean } = {},
  ): Promise<TimesheetRow[]> {
    if (!ACTIONS.has(action)) {
      throw new BadRequestException("That timesheet action doesn't exist.");
    }
    const sheetIds = Array.isArray(ids) ? ids : [];
    if (sheetIds.length === 0) {
      throw new BadRequestException('Choose at least one timesheet.');
    }
    if (new Set(sheetIds).size !== sheetIds.length) {
      throw new BadRequestException('Each timesheet can be listed only once.');
    }
    if (actorId === null) {
      if (!SYSTEM_ACTIONS.has(action)) {
        throw new BadRequestException('This timesheet action needs a person.');
      }
    } else if (!Array.isArray(expectedRevisions)) {
      throw new BadRequestException(TIMESHEET_REVISIONS_MESSAGE);
    }
    if (expectedRevisions && expectedRevisions.length !== sheetIds.length) {
      throw new BadRequestException(TIMESHEET_REVISIONS_MESSAGE);
    }
    const note =
      typeof o.note === 'string' && o.note.trim() !== '' ? o.note.trim() : null;

    // D33: `return` always needs a note; checked before anything is read, so it reveals nothing.
    if (action === 'return' && note === null) {
      throw new BadRequestException(TIMESHEET_NOTE_REQUIRED_MESSAGE);
    }

    const before = await this.loadSheets(sheetIds, TIMESHEET_SELECT);
    const beforeById = new Map(before.map((s) => [s.id, s]));
    // A missing id is the RPC's TIMESHEET_NOT_FOUND too; answer it here, without echoing the id.
    if (sheetIds.some((id) => !beforeById.has(id))) {
      throw timeNotFound('timesheet');
    }

    // D33: the decider path of `reopen` needs a note. 404 first for a sheet the actor cannot open, so the 400
    // never confirms that the sheet exists.
    if (action === 'reopen' && note === null && actorId !== null) {
      for (const sheet of before) {
        if (sheet.member_user_id === actorId) continue;
        if (!(await this.authority.canViewTimesheet(actorId, sheet.id))) {
          throw timeNotFound('timesheet');
        }
        throw new BadRequestException(TIMESHEET_NOTE_REQUIRED_MESSAGE);
      }
    }

    // P08: pass the deciders as they were BEFORE the transition (an `open` sheet has none).
    const decidersBefore = new Map<string, string[]>();
    if (
      action === 'approve' ||
      action === 'return' ||
      action === 'withdraw' ||
      action === 'reopen'
    ) {
      await Promise.all(
        sheetIds.map(async (id) => {
          decidersBefore.set(id, await this.decidersSoft(id));
        }),
      );
    }

    const needsFreeze = FREEZE_ACTIONS.has(action);
    // Overtime is a decider's call: a submit that chains to auto/self never approves overtime.
    const approveOvertime = action === 'approve' && o.approveOvertime === true;
    const mode = action === 'approve' ? 'approve' : 'submit';
    const build = async (): Promise<FreezePayload | null> =>
      needsFreeze
        ? (await this.buildFreeze(sheetIds, { approveOvertime, mode })).payload
        : null;

    let freeze = await build();
    const call = (p: FreezePayload | null) =>
      this.sb.rpc('time_timesheet_transition', {
        p_ids: sheetIds,
        p_actor: actorId,
        p_action: action,
        p_expected_revisions: expectedRevisions ?? null,
        p_note: note,
        p_approve_overtime: approveOvertime,
        p_freeze: p,
      }) as unknown as Promise<RpcResult>;

    let res = await call(freeze);
    // D20: a deadlock between two transitions (or a transition and trg_40) is retried once.
    if (res.error && isDeadlock(res.error)) res = await call(freeze);
    // A system actor races nobody's revision, only the entry set (an entry stopped or moved meanwhile).
    if (
      res.error &&
      actorId === null &&
      needsFreeze &&
      isEntrySetStale(res.error)
    ) {
      freeze = await build();
      res = await call(freeze);
    }
    if (res.error) {
      // A12: name the payout or invoice that blocks a reopen (best effort, after the RPC refused). D80: the
      // invoice only for a caller who may see it.
      const mapped = mapTimeDbError(res.error);
      if (
        mapped &&
        errorBody(mapped).code === 'TIMESHEET_HAS_SETTLED_ENTRIES'
      ) {
        throw await this.withSettlement(mapped, actorId, beforeById);
      }
      // A10: STALE_REVISION keeps the RPC's `timesheet_id` (and expected/actual or reason) as extras.
      throwTimeDb(res.error);
    }

    const after = (Array.isArray(res.data) ? res.data : [])
      .filter(isSnapshotObject)
      .map(toSheetRow);

    // D51: notifications never fail a committed transition; each method catches its own errors.
    await Promise.all(
      after.map((sheet) =>
        this.notify(
          action,
          actorId,
          beforeById.get(sheet.id) ?? null,
          sheet,
          decidersBefore.get(sheet.id) ?? [],
        ),
      ),
    );
    return after;
  }

  /** One RPC call for the batch: all or none (backend.md: approve-bulk fails the batch). */
  async approveBulk(
    userId: string,
    input: {
      ids: string[];
      expected_revisions: number[];
      note?: string;
      approve_overtime?: boolean;
    },
  ): Promise<TimesheetRow[]> {
    const ids = Array.isArray(input?.ids) ? input.ids : [];
    const revisions = Array.isArray(input?.expected_revisions)
      ? input.expected_revisions
      : [];
    if (ids.length !== revisions.length) {
      throw new BadRequestException(TIMESHEET_REVISIONS_MESSAGE);
    }
    return this.act(userId, 'approve', ids, revisions, {
      note: input.note,
      approveOvertime: input.approve_overtime === true,
    });
  }

  // ── the freeze (CHANGE-4) ───────────────────────────────────────────────────────────────────────────

  /**
   * p_freeze keyed by sheet id, then entry id (D10), plus a preview per sheet. Per entry, in started_at order:
   * the local start date d in the sheet timezone; the rate re-resolved for d (TimeRatesService.freezeRate; legacy
   * entries keep their snapshot); rounding (contract settings in force on d for engagement sheets, else the
   * policy: `policy_snapshot` on approve, a fresh resolve at period start on submit); the caps in order (D65):
   * on engagement sheets only, the contract's `weekly_limit_minutes` in force on d per (member, engagement) over
   * the sheet week; then the team member caps per (member, team) over the sheet-tz week and calendar month;
   * finally the amount. The workspace/team policy `weekly_limit_minutes` never cuts payable time (it is a review
   * indicator and a write-time warning). Already-approved payable time in each window counts against the cap.
   * The preview carries no money; the caller adds per-currency totals only for a cost-visible viewer.
   * `previewOnly` (A3 queue flags) skips the rate lookups, which no cap reads, and returns an empty `payload`:
   * its result must never reach the RPC.
   */
  async buildFreeze(
    sheetIds: string[],
    o: {
      approveOvertime: boolean;
      mode: 'approve' | 'submit';
      previewOnly?: boolean;
    },
  ): Promise<{
    payload: FreezePayload;
    preview: Record<string, FreezePreview>;
  }> {
    const payload: FreezePayload = {};
    const preview: Record<string, FreezePreview> = {};
    const ids = distinct(sheetIds);
    if (ids.length === 0) return { payload, preview };

    const sheets = await this.loadSheets<DetailSheetRow>(
      ids,
      TIMESHEET_DETAIL_SELECT,
    );
    if (sheets.length === 0) return { payload, preview };
    // Earlier periods first, so a later sheet of the same batch sees their payable time in a shared window.
    sheets.sort((a, b) =>
      a.period_start !== b.period_start
        ? a.period_start < b.period_start
          ? -1
          : 1
        : a.id < b.id
          ? -1
          : a.id > b.id
            ? 1
            : 0,
    );
    const batch = new Set(sheets.map((s) => s.id));

    const entries = await this.readPaged<FreezeEntryRow>(
      'freeze_entries',
      sheets.map((s) => s.id),
      (part, from, to) =>
        this.sb
          .from('time_entries')
          .select(FREEZE_ENTRY_SELECT)
          .in('timesheet_id', part)
          .order('id', { ascending: true })
          .range(from, to),
    );
    const bySheet = new Map<string, FreezeEntryRow[]>();
    for (const e of entries) {
      if (!e.timesheet_id) continue;
      const list = bySheet.get(e.timesheet_id) ?? [];
      list.push(e);
      bySheet.set(e.timesheet_id, list);
    }

    const previewOnly = o.previewOnly === true;
    const cutoff = previewOnly ? null : await this.rates.legacyCutoff();
    const rateMemo = new Memo<FrozenRate>();
    const settingsMemo = new Memo<EngagementTimeSettingsRow | null>();
    const capsMemo = new Memo<{
      weekly: number | null;
      monthly: number | null;
    }>();
    const layersMemo = new Memo<PolicyLayers>();
    /** Payable seconds already approved per window key, then what this build approves on top. */
    const consumed = new Map<string, number>();
    const approvedMemo = new Memo<number>();

    for (const sheet of sheets) {
      const tz = safeTimezone(sheet.timezone);
      const list = [...(bySheet.get(sheet.id) ?? [])].sort(byStart);
      const layers = await this.freezeLayers(sheet, o.mode, layersMemo);
      const engagementId =
        sheet.scope_kind === 'engagement'
          ? (sheet.engagement_id ?? sheet.scope_ref)
          : null;
      const settingsOn = (d: string) =>
        engagementId
          ? settingsMemo.get(`${engagementId}|${d}`, () =>
              this.engagements.settingsInForceOn(engagementId, d),
            )
          : Promise.resolve(null);

      const work: FreezeWork[] = [];
      for (const e of list) {
        const d = localDate(e.started_at, tz);
        const settings = await settingsOn(d);
        // Contract rounding in force on d wins for engagement sheets (L10); else the policy layers.
        const rounding =
          toNumber(settings?.rounding_minutes) ?? layers.rounding;
        // A legacy 'rejected' entry counts 0 payable (the RPC forces 0; the preview agrees).
        const rounded =
          e.legacy_status === 'rejected'
            ? 0
            : roundSeconds(
                Math.max(0, Math.floor(e.duration_seconds ?? 0)),
                rounding,
              );
        const rate = previewOnly
          ? NO_RATE
          : await this.freezeRateFor(e, sheet, d, cutoff, rateMemo);
        work.push({ e, d, rounded, payable: rounded, rate, windows: [] });
      }

      const member = sheet.member_user_id;
      // Cap 1 (D65, L12): engagement sheets only. The contract's weekly_limit_minutes in force on each entry's
      // date, per (member, engagement) over the sheet week, summed across every linked project (the sheet is the
      // governing engagement's). Only a contract-set value caps: a date whose settings row leaves the limit NULL
      // (or has no row) is uncapped, never filled from the workspace/team policy layers.
      const scopeGroups = new Map<string, CapGroup>();
      if (engagementId) {
        for (const w of work) {
          const settings = await settingsOn(w.d);
          const limitMinutes = positiveOrNull(settings?.weekly_limit_minutes);
          if (limitMinutes === null) continue;
          const week = weekWindow(w.d, sheet.week_start);
          addToGroup(
            scopeGroups,
            `contract|${member ?? ''}|${sheet.scope_ref}|${week.start}`,
            w,
            limitMinutes * 60,
            week,
            null,
          );
        }
      }
      for (const [key, group] of scopeGroups) {
        const already = await this.approvedBefore(
          key,
          consumed,
          approvedMemo,
          () =>
            member
              ? this.approvedInScopeWindow(
                  member,
                  sheet,
                  group.window,
                  tz,
                  batch,
                )
              : Promise.resolve(0),
        );
        this.applyCap(group.rows, group.cap, already);
      }

      // Cap 2 (D46, L12): team member caps per (member, team) over the sheet-tz week, then the calendar month.
      const weekGroups = new Map<string, CapGroup>();
      const monthGroups = new Map<string, CapGroup>();
      if (member) {
        for (const w of work) {
          if (w.e.context_kind !== 'team') continue;
          const teamId = w.e.team_id ?? w.e.context_ref;
          if (!teamId) continue;
          const caps = await capsMemo.get(
            `${teamId}|${member}|${w.e.project_id ?? ''}|${w.d}`,
            async () => {
              const c = await this.rates.memberCaps(
                teamId,
                member,
                w.e.project_id,
                w.d,
              );
              return {
                weekly: positiveOrNull(c?.weekly_limit_hours),
                monthly: positiveOrNull(c?.monthly_limit_hours),
              };
            },
          );
          if (caps.weekly !== null) {
            const week = weekWindow(w.d, sheet.week_start);
            addToGroup(
              weekGroups,
              `team|${member}|${teamId}|week|${week.start}`,
              w,
              Math.round(caps.weekly * 3600),
              week,
              teamId,
            );
          }
          if (caps.monthly !== null) {
            const month = monthWindow(w.d);
            addToGroup(
              monthGroups,
              `team|${member}|${teamId}|month|${month.start}`,
              w,
              Math.round(caps.monthly * 3600),
              month,
              teamId,
            );
          }
        }
      }
      // Weekly windows before monthly ones: each cap cuts what the previous one left.
      for (const groups of [weekGroups, monthGroups]) {
        for (const [key, group] of groups) {
          const teamId = group.teamId;
          if (!member || !teamId) continue;
          const already = await this.approvedBefore(
            key,
            consumed,
            approvedMemo,
            () =>
              this.approvedInTeamWindow(
                member,
                teamId,
                group.window,
                tz,
                batch,
              ),
          );
          this.applyCap(group.rows, group.cap, already);
        }
      }

      // Values and preview.
      const sheetFreeze: SheetFreeze = {};
      const previewEntries: FreezePreviewEntry[] = [];
      let overTotal = 0;
      for (const w of work) {
        const capped = Math.max(0, Math.min(w.rounded, w.payable));
        const over = w.rounded - capped;
        const payable = o.approveOvertime ? w.rounded : capped;
        overTotal += over;
        for (const key of w.windows) {
          consumed.set(key, (consumed.get(key) ?? 0) + payable);
        }
        const value: FreezeEntryValue = {
          payable_seconds: payable,
          rate_snapshot: Math.max(0, w.rate.rate),
          rate_type_snapshot: w.rate.rateType,
          currency_snapshot: w.rate.currency || 'USD',
          amount_snapshot: amountFor(
            payable,
            Math.max(0, w.rate.rate),
            w.rate.rateType,
            w.rate.amountable,
          ),
        };
        sheetFreeze[w.e.id] = value;
        previewEntries.push({
          entry_id: w.e.id,
          rounded_seconds: w.rounded,
          payable_seconds: payable,
          over_cap_seconds: over,
        });
      }
      if (!previewOnly) payload[sheet.id] = sheetFreeze;
      preview[sheet.id] = {
        timesheet_id: sheet.id,
        entries: previewEntries,
        over_cap_seconds: overTotal,
      };
    }
    return { payload, preview };
  }

  // ── approvals ───────────────────────────────────────────────────────────────────────────────────────

  /** Cross-workspace queue (time_approval_queue_ids), paged in TS; each row carries the member and, when it
   *  differs from the viewer's current workspace (or always, when none is known), the policy workspace (E27). */
  async queue(
    userId: string,
    q: {
      status: 'submitted' | 'decided';
      since?: string;
      scope_kind?: SheetScopeKind;
      page: number;
      limit: number;
      currentWorkspaceId?: string | null;
    },
  ): Promise<Paged<ApprovalRow>> {
    const status = q.status === 'decided' ? 'decided' : 'submitted';
    const page = Math.max(1, Math.floor(q.page || 1));
    const limit = Math.max(1, Math.floor(q.limit || 50));
    const ids = await this.queueIds(userId, status, q.since);

    let sheets = await this.loadSheets(ids, TIMESHEET_SELECT);
    if (q.scope_kind) {
      sheets = sheets.filter((s) => s.scope_kind === q.scope_kind);
    }
    sheets.sort((a, b) => {
      // Waiting: oldest submission first. Decided: most recent decision first.
      const [ak, bk] =
        status === 'submitted'
          ? [a.submitted_at ?? '', b.submitted_at ?? '']
          : [b.decided_at ?? '', a.decided_at ?? ''];
      if (ak !== bk) return ak < bk ? -1 : 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    const total = sheets.length;
    const slice = sheets.slice((page - 1) * limit, page * limit);
    if (slice.length === 0) return { items: [], total, page, limit };

    const waiting = status === 'submitted';
    const [{ items: summaries, needsReview }, members, workspaces, overCap] =
      await Promise.all([
        this.summariesWithReview(slice),
        this.memberProfiles(distinct(slice.map((s) => s.member_user_id))),
        this.workspaceNames(distinct(slice.map((s) => s.policy_workspace_id))),
        waiting ? this.overCapFor(slice) : Promise.resolve(null),
      ]);
    const current = q.currentWorkspaceId ?? null;
    const items: ApprovalRow[] = summaries.map((s) => {
      const wsId = s.policy_workspace_id;
      const name = wsId ? workspaces.get(wsId) : undefined;
      const row: ApprovalRow = {
        ...s,
        member: s.member_user_id
          ? (members.get(s.member_user_id) ?? null)
          : null,
        policy_workspace:
          wsId && name !== undefined && wsId !== current
            ? { id: wsId, name }
            : null,
      };
      // A3: the waiting queue only (a decided sheet has nothing left to decide).
      if (overCap) {
        row.flags = {
          needs_review: needsReview.get(s.id) ?? 0,
          over_cap_seconds: overCap.seconds.get(s.id) ?? 0,
          running: s.running_count,
        };
        if (overCap.partial.has(s.id)) row.flags_partial = true;
      }
      return row;
    });
    return { items, total, page, limit };
  }

  async queueCount(userId: string): Promise<{ waiting: number }> {
    return { waiting: (await this.queueIds(userId, 'submitted')).length };
  }

  // ── overview ────────────────────────────────────────────────────────────────────────────────────────

  /** backend.md me/overview. Guests → EMPTY_TIME_OVERVIEW. `?tz=` seeds user_time_preferences (never overwrites)
   *  and is the materialisation hint for workspaces the caller manages. */
  async overview(user: AuthenticatedUser, tz?: string): Promise<TimeOverview> {
    if (!user?.id || user.is_guest) {
      return {
        ...EMPTY_TIME_OVERVIEW,
        contexts: [],
        workspace_time_admin: [],
      };
    }
    const userId = user.id;
    const hint = typeof tz === 'string' && isValidTimezone(tz) ? tz : null;
    if (hint) await this.seedPreferences(userId, hint);

    const now = new Date();
    const [canLog, ctx, waiting, admin] = await Promise.all([
      this.canLogAnywhere(userId),
      this.overviewContexts(userId, now),
      this.queueIds(userId, 'submitted').then((ids) => ids.length),
      this.workspaceAdmin(userId, hint),
    ]);
    // L36: deciders (or anyone with waiting approvals) who logged nothing in 30 days.
    const approverMode =
      !ctx.hasRecentEntries &&
      (waiting > 0 || (await this.isDeciderAnywhere(userId, admin)));
    return {
      can_log: canLog,
      approver_mode: approverMode,
      contexts: ctx.contexts,
      approvals_waiting: waiting,
      workspace_time_admin: admin,
    };
  }

  // ── internals: transitions ──────────────────────────────────────────────────────────────────────────

  /** One notification per transition (backend.md state table, D51, D63). */
  private async notify(
    action: TimesheetAction,
    actorId: string | null,
    before: TimesheetRow | null,
    sheet: TimesheetRow,
    decidersBefore: string[],
  ): Promise<void> {
    switch (action) {
      case 'submit':
      case 'auto_submit':
      case 'submit_on_deletion': {
        if (sheet.approver_scope && SELF_ROUTES.has(sheet.approver_scope)) {
          // D63: no recipients, but it clears the member's reminder row and marker.
          await this.notifications.sheetSubmitted(sheet, [], actorId);
          if (sheet.status === 'approved') {
            // `self` is skipped inside; an `auto` confirmation tells the member.
            await this.notifications.sheetDecided(
              sheet,
              'approve',
              actorId,
              [],
            );
          }
        } else {
          await this.notifications.sheetSubmitted(
            sheet,
            await this.decidersSoft(sheet.id),
            actorId,
          );
        }
        return;
      }
      case 'withdraw':
        await this.notifications.sheetDecided(
          sheet,
          'withdraw',
          actorId,
          decidersBefore,
        );
        return;
      case 'approve':
        await this.notifications.sheetDecided(
          sheet,
          'approve',
          actorId,
          decidersBefore,
        );
        return;
      case 'return':
        await this.notifications.sheetDecided(
          sheet,
          'return',
          actorId,
          decidersBefore,
        );
        return;
      case 'reopen':
        // The member's own reopen (auto/self → open) tells nobody: they are the actor and nobody decided it.
        if (before && actorId !== null && before.member_user_id === actorId) {
          return;
        }
        await this.notifications.sheetDecided(
          sheet,
          'reopen',
          actorId,
          decidersBefore,
        );
        return;
      case 'request_reopen':
        if (actorId === null) return;
        await this.notifications.reopenRequested(
          sheet,
          await this.decidersSoft(sheet.id),
          actorId,
        );
        return;
      default:
        return;
    }
  }

  /** time_timesheet_deciders; a failed lookup degrades to no recipients (never fails a committed transition). */
  private async decidersSoft(sheetId: string): Promise<string[]> {
    try {
      return await this.deciders(sheetId);
    } catch (error) {
      this.logger.warn(
        `timesheet_deciders_failed sheet=${sheetId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  private deciders(sheetId: string): Promise<string[]> {
    return this.authority.approversFor(sheetId);
  }

  /** What the viewer may do now (the RPC still decides; this only drives the buttons). `route` is the member's
   *  routing preview of an open/returned sheet (null when not read or failed). */
  private viewerActions(
    sheet: TimesheetRow,
    isMember: boolean,
    canDecide: boolean,
    entries: TimeEntryView[],
    stats: SheetStats,
    route: RouteResult | null,
  ): TimesheetAction[] {
    const actions: TimesheetAction[] = [];
    const locks = new Set(entries.map((e) => e.locked_reason));
    if (isMember) {
      switch (sheet.status) {
        case 'open':
        case 'returned':
          if (
            stats.entry_count > 0 &&
            stats.running_count === 0 &&
            this.canSubmitNow(sheet, route)
          ) {
            actions.push('submit');
          }
          break;
        case 'submitted':
          actions.push('withdraw');
          break;
        case 'approved':
          if (
            sheet.decision_kind === 'auto' ||
            sheet.decision_kind === 'self'
          ) {
            // L33: until any entry is reserved, paid or carries a legacy marker.
            if (
              !locks.has('paid') &&
              !locks.has('billed') &&
              !locks.has('legacy')
            ) {
              actions.push('reopen');
            }
          } else if (
            sheet.decision_kind === 'manual' ||
            sheet.decision_kind === 'legacy'
          ) {
            actions.push('request_reopen');
          }
          break;
      }
      return actions;
    }
    if (!canDecide) return actions;
    if (sheet.status === 'submitted') {
      actions.push('approve', 'return');
    } else if (
      sheet.status === 'approved' &&
      sheet.approver_scope &&
      DECIDER_ROUTES.has(sheet.approver_scope) &&
      !locks.has('paid') &&
      !locks.has('billed')
    ) {
      actions.push('reopen');
    }
    return actions;
  }

  /** D13: a manual-route sheet submits from the period's last local day; auto/self and resubmits any time.
   *  An unknown route (preview failed) never offers an early submit. */
  private canSubmitNow(
    sheet: TimesheetRow,
    route: RouteResult | null,
  ): boolean {
    if (sheet.status === 'returned') return true;
    const today = localDate(new Date(), safeTimezone(sheet.timezone));
    if (today >= sheet.period_end) return true;
    return route !== null && SELF_ROUTES.has(route.approver_scope);
  }

  // ── internals: routing and decider names (A1, A2) ───────────────────────────────────────────────────

  /** time_sheet_routing_preview(id, 'submit'); null when the sheet is gone, the answer is malformed, or the
   *  call fails (logged at warn: it only decorates a read). */
  private async routingPreviewSoft(
    sheetId: string,
  ): Promise<RouteResult | null> {
    try {
      const { data, error } = (await this.sb.rpc('time_sheet_routing_preview', {
        p_timesheet_id: sheetId,
        p_action: 'submit',
      })) as RpcResult;
      if (error) {
        this.logger.warn(
          `timesheet_routing_preview_failed sheet=${sheetId} code=${error.code ?? 'none'}`,
        );
        return null;
      }
      if (!isSnapshotObject(data)) return null;
      const scope = (data as { approver_scope?: unknown }).approver_scope;
      if (typeof scope !== 'string' || !APPROVER_SCOPES.has(scope)) {
        return null;
      }
      const routing = (data as { routing?: unknown }).routing;
      return {
        approver_scope: scope as ApproverScope,
        cost_money:
          isSnapshotObject(routing) &&
          (routing as { cost_money?: unknown }).cost_money === true,
      };
    } catch (error) {
      this.logger.warn(
        `timesheet_routing_preview_failed sheet=${sheetId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  /** time_scope_deciders for a routed scope on this sheet's frozen columns; `auto`/`self` have none (no call).
   *  Null on failure. */
  private scopeDecidersSoft(
    sheet: DeciderScopeSheet,
    scope: ApproverScope,
    memo?: Memo<string[] | null>,
  ): Promise<string[] | null> {
    if (!DECIDER_ROUTES.has(scope)) return Promise.resolve([]);
    const load = async (): Promise<string[] | null> => {
      try {
        const { data, error } = (await this.sb.rpc('time_scope_deciders', {
          p_approver_scope: scope,
          p_team_id: sheet.team_id,
          p_policy_workspace_id: sheet.policy_workspace_id,
          p_engagement_id: sheet.engagement_id,
          p_member_user_id: sheet.member_user_id,
        })) as RpcResult;
        if (error) {
          this.logger.warn(
            `time_scope_deciders_failed scope=${scope} code=${error.code ?? 'none'}`,
          );
          return null;
        }
        return distinct(uuidList(data));
      } catch (error) {
        this.logger.warn(
          `time_scope_deciders_failed scope=${scope}: ${error instanceof Error ? error.message : String(error)}`,
        );
        return null;
      }
    };
    if (!memo) return load();
    const key = [
      scope,
      sheet.team_id ?? '',
      sheet.policy_workspace_id ?? '',
      sheet.engagement_id ?? '',
      sheet.member_user_id ?? '',
    ].join('|');
    return memo.get(key, load);
  }

  /** time_timesheet_deciders; null on failure (unlike decidersSoft, an empty list would read "no one"). */
  private async decidersOrNull(sheetId: string): Promise<string[] | null> {
    try {
      return await this.deciders(sheetId);
    } catch (error) {
      this.logger.warn(
        `timesheet_deciders_failed sheet=${sheetId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  /** id → {id, display_name} for live profiles (deleted ones are absent); null when a read fails. */
  private async profileNamesSoft(
    ids: string[],
  ): Promise<Map<string, DeciderName> | null> {
    const out = new Map<string, DeciderName>();
    for (const part of chunks(distinct(ids))) {
      const { data, error } = await this.sb
        .from('profiles')
        .select('id, display_name, deleted_at')
        .in('id', part);
      if (error) {
        this.logger.warn(
          `timesheet_decider_names_failed code=${error.code ?? 'none'}`,
        );
        return null;
      }
      for (const p of (data ?? []) as Array<{
        id: string;
        display_name: string | null;
        deleted_at: string | null;
      }>) {
        if (p.deleted_at) continue;
        out.set(p.id, { id: p.id, display_name: p.display_name ?? null });
      }
    }
    return out;
  }

  /**
   * A1 + A2 on `me/timesheets` (at most MINE_LIMIT rows): one routing preview per open/returned sheet, one
   * time_scope_deciders per distinct scope, one time_timesheet_deciders per submitted sheet (at most
   * DECORATE_CONCURRENCY calls in flight), then one batched profile read for every name. Best effort per sheet;
   * a failed name read leaves every sheet undecorated.
   */
  private async decorateMine(items: TimesheetSummary[]): Promise<void> {
    const editable = items.filter(
      (s) => s.status === 'open' || s.status === 'returned',
    );
    const submitted = items.filter((s) => s.status === 'submitted');
    if (editable.length === 0 && submitted.length === 0) return;

    const scopeMemo = new Memo<string[] | null>();
    const [routes, deciderLists] = await Promise.all([
      mapLimit(editable, DECORATE_CONCURRENCY, async (s) => {
        const route = await this.routingPreviewSoft(s.id);
        if (!route) return null;
        const ids = await this.scopeDecidersSoft(
          s,
          route.approver_scope,
          scopeMemo,
        );
        return ids ? { route, ids } : null;
      }),
      mapLimit(submitted, DECORATE_CONCURRENCY, (s) =>
        this.decidersOrNull(s.id),
      ),
    ]);
    const names = await this.profileNamesSoft([
      ...routes.flatMap((r) => r?.ids ?? []),
      ...deciderLists.flatMap((l) => l ?? []),
    ]);
    if (!names) return;
    editable.forEach((s, i) => {
      const r = routes[i];
      if (r) {
        const preview: RoutingPreview = {
          ...r.route,
          deciders: pickNames(r.ids, names),
        };
        s.routing_preview = preview;
      }
    });
    submitted.forEach((s, i) => {
      const ids = deciderLists[i];
      if (ids) s.deciders = pickNames(ids, names);
    });
  }

  // ── internals: queue flags (A3) and settled extras (A12) ────────────────────────────────────────────

  /**
   * Over-cap seconds per waiting sheet of a queue page: the detail's freeze preview (approve mode, overtime not
   * approved), rate lookups skipped. The first FLAGS_FREEZE_MAX submitted rows are previewed one sheet per build,
   * exactly as each detail shows them, with at most DECORATE_CONCURRENCY builds in flight (a build reads its
   * caps and windows one after another, so one batch for the whole page would serialise every read). No build
   * starts once FLAGS_BUDGET_MS has passed. Rows past the cap or the budget, and rows whose build failed, are
   * `partial` (read 0).
   */
  private async overCapFor(
    sheets: TimesheetRow[],
  ): Promise<{ seconds: Map<string, number>; partial: Set<string> }> {
    const seconds = new Map<string, number>();
    const eligible = sheets.filter((s) => s.status === 'submitted');
    const computed = eligible.slice(0, FLAGS_FREEZE_MAX);
    const partial = new Set(eligible.slice(FLAGS_FREEZE_MAX).map((s) => s.id));
    const deadline = Date.now() + FLAGS_BUDGET_MS;
    let skipped = 0;
    await mapLimit(computed, DECORATE_CONCURRENCY, async (s) => {
      if (Date.now() > deadline) {
        partial.add(s.id);
        skipped += 1;
        return;
      }
      try {
        const { preview } = await this.buildFreeze([s.id], {
          approveOvertime: false,
          mode: 'approve',
          previewOnly: true,
        });
        seconds.set(s.id, preview[s.id]?.over_cap_seconds ?? 0);
      } catch (error) {
        this.logger.warn(
          `timesheet_queue_flags_failed sheet=${s.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
        partial.add(s.id);
      }
    });
    if (skipped > 0) {
      this.logger.warn(
        `timesheet_queue_flags_budget skipped=${skipped} budget_ms=${FLAGS_BUDGET_MS}`,
      );
    }
    return { seconds, partial };
  }

  /** TIMESHEET_HAS_SETTLED_ENTRIES plus what settled it (A12, D80); any lookup failure keeps the original error. */
  private async withSettlement(
    mapped: HttpException,
    actorId: string | null,
    sheetsById: Map<string, TimesheetRow>,
  ): Promise<HttpException> {
    const body = errorBody(mapped);
    const sheetId =
      typeof body.timesheet_id === 'string' ? body.timesheet_id : null;
    if (!sheetId) return mapped;
    try {
      const extras = await this.settlementExtras(sheetId, body.reason, () =>
        this.mayReadInvoice(actorId, sheetsById.get(sheetId)),
      );
      if (!extras) return mapped;
      // timeError drops the reserved keys (code, message, …) from the extras.
      return timeError(
        'TIMESHEET_HAS_SETTLED_ENTRIES',
        typeof body.message === 'string' ? body.message : undefined,
        { ...body, ...extras },
      );
    } catch (error) {
      this.logger.warn(
        `timesheet_settlement_lookup_failed sheet=${sheetId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return mapped;
    }
  }

  /**
   * D80: the client invoice (id, number, status) is the provider's billing, so only a caller who can see cost on
   * the sheet reads it: a decider. The RPC's non-member reopen path is already gated on can_decide_timesheet; it
   * is re-checked here so no other path can leak it. The member reopening their own auto/self sheet (a worker)
   * never learns the client invoice; they get the reason, plus `payout_id` / `paid_outside` (their own pay).
   */
  private async mayReadInvoice(
    actorId: string | null,
    sheet: TimesheetRow | undefined,
  ): Promise<boolean> {
    if (!actorId || !sheet || sheet.member_user_id === actorId) return false;
    return this.authority.canDecide(actorId, sheet.id);
  }

  /**
   * reason 'paid': the payout of the earliest paid entry, else `paid_outside` for a legacy paid-outside entry.
   * reason 'billed': the invoice (id, number, status) of the sheet's earliest reservation, only when
   * `mayReadInvoice` says so (D80; otherwise nothing is read). 'legacy': nothing.
   * Throws on a read error (the caller keeps the original refusal).
   */
  private async settlementExtras(
    sheetId: string,
    reason: unknown,
    mayReadInvoice: () => Promise<boolean>,
  ): Promise<Record<string, unknown> | null> {
    const check = (op: string, error: PgErrorLike | null): void => {
      if (error) throw new Error(`${op} code=${error.code ?? 'none'}`);
    };
    if (reason === 'paid') {
      const paid = await this.sb
        .from('time_entries')
        .select('id, payout_id')
        .eq('timesheet_id', sheetId)
        .not('payout_id', 'is', null)
        .order('started_at', { ascending: true })
        .order('id', { ascending: true })
        .limit(1);
      check('settled_payout', paid.error);
      const payoutId = (
        (paid.data ?? []) as Array<{ payout_id: string | null }>
      )[0]?.payout_id;
      if (payoutId) return { payout_id: payoutId };
      const outside = await this.sb
        .from('time_entries')
        .select('id')
        .eq('timesheet_id', sheetId)
        .eq('legacy_status', 'paid_outside')
        .limit(1);
      check('settled_paid_outside', outside.error);
      return ((outside.data ?? []) as unknown[]).length > 0
        ? { paid_outside: true }
        : null;
    }
    if (reason !== 'billed') return null;
    if (!(await mayReadInvoice())) return null;

    let first: { invoice_id: string; created_at: string } | null = null;
    for (let from = 0; ; from += PAGE) {
      const ids = await this.sb
        .from('time_entries')
        .select('id')
        .eq('timesheet_id', sheetId)
        .order('id', { ascending: true })
        .range(from, from + PAGE - 1);
      check('settled_entries', ids.error);
      const entryIds = ((ids.data ?? []) as Array<{ id: string }>).map(
        (r) => r.id,
      );
      for (const part of chunks(entryIds)) {
        const res = await this.sb
          .from('invoice_time_entries')
          .select('invoice_id, entry_id, created_at')
          .in('entry_id', part)
          .order('created_at', { ascending: true })
          .order('invoice_id', { ascending: true })
          .limit(1);
        check('settled_reservation', res.error);
        const row = (
          (res.data ?? []) as Array<{ invoice_id: string; created_at: string }>
        )[0];
        if (
          row &&
          (!first ||
            row.created_at < first.created_at ||
            (row.created_at === first.created_at &&
              row.invoice_id < first.invoice_id))
        ) {
          first = row;
        }
      }
      if (entryIds.length < PAGE || from + PAGE >= MAX_PAGED_ROWS) break;
    }
    if (!first) return null;
    const invoice = await this.sb
      .from('invoices')
      .select('id, number, status')
      .eq('id', first.invoice_id)
      .maybeSingle();
    check('settled_invoice', invoice.error);
    const inv = invoice.data as {
      id: string;
      number: string | null;
      status: string | null;
    } | null;
    return inv
      ? {
          invoice_id: inv.id,
          ...(inv.number ? { invoice_number: inv.number } : {}),
          ...(inv.status ? { invoice_status: inv.status } : {}),
        }
      : { invoice_id: first.invoice_id };
  }

  // ── internals: the freeze ───────────────────────────────────────────────────────────────────────────

  /** The policy rounding: `policy_snapshot` on approve (L40), a resolve at period start on submit (what the
   *  RPC is about to snapshot). */
  private async freezeLayers(
    sheet: DetailSheetRow,
    mode: 'approve' | 'submit',
    memo: Memo<PolicyLayers>,
  ): Promise<PolicyLayers> {
    const snapshot = sheet.policy_snapshot;
    if (
      mode === 'approve' &&
      isSnapshotObject(snapshot) &&
      Object.hasOwn(snapshot, 'rounding_minutes')
    ) {
      return layersOf(snapshot);
    }
    const key = `${sheet.scope_kind}|${sheet.scope_ref}|${sheet.policy_workspace_id ?? ''}|${sheet.period_start}|${sheet.timezone}`;
    return memo.get(key, async () => {
      const resolved = await this.policy.resolve(
        { kind: sheet.scope_kind, ref: sheet.scope_ref },
        sheet.policy_workspace_id,
        periodStartInstant(sheet),
      );
      return layersOf(resolved as unknown as Record<string, unknown>);
    });
  }

  /** TimeRatesService.freezeRate, memoised by everything it reads (legacy entries need no I/O). */
  private freezeRateFor(
    e: FreezeEntryRow,
    sheet: TimesheetRow,
    d: string,
    cutoff: string | null,
    memo: Memo<FrozenRate>,
  ): Promise<FrozenRate> {
    const member = e.member_user_id ?? sheet.member_user_id;
    const stored = {
      rate: Math.max(0, toNumber(e.rate_snapshot) ?? 0),
      rateType: (e.rate_type_snapshot === 'fixed'
        ? 'fixed'
        : 'hourly') as RateType,
      currency: e.currency_snapshot || 'USD',
    };
    // A sheet whose member account is gone: nothing to re-resolve against; keep what was logged.
    if (!member) {
      return Promise.resolve({
        ...stored,
        amountable: stored.rateType === 'hourly',
      });
    }
    const input = {
      context_kind: e.context_kind,
      context_ref: e.context_ref,
      team_id: e.team_id,
      engagement_assignment_id: e.engagement_assignment_id,
      member_user_id: member,
      project_id: e.project_id,
      work_type_snapshot: e.work_type_snapshot ?? 'real_work',
      created_at: e.created_at,
      rate_snapshot: stored.rate,
      rate_type_snapshot: stored.rateType,
      currency_snapshot: stored.currency,
    };
    const legacy =
      cutoff !== null &&
      Number.isFinite(Date.parse(e.created_at)) &&
      Date.parse(e.created_at) < Date.parse(cutoff);
    if (legacy) return this.rates.freezeRate(input, d, cutoff);
    const key = [
      e.context_kind,
      e.team_id ?? '',
      e.context_ref ?? '',
      e.engagement_assignment_id ?? '',
      member,
      e.project_id ?? '',
      input.work_type_snapshot,
      stored.currency,
      d,
    ].join('|');
    return memo.get(key, () => this.rates.freezeRate(input, d, cutoff));
  }

  /** capInOrder over a window group; each entry keeps the smallest payable any of its caps allows. */
  private applyCap(
    rows: Array<{
      e: { id: string; started_at: string };
      payable: number;
    }>,
    capSeconds: number | null,
    alreadySeconds: number,
  ): void {
    if (capSeconds === null || rows.length === 0) return;
    const result = capInOrder(
      rows.map((r) => ({
        id: r.e.id,
        started_at: r.e.started_at,
        seconds: r.payable,
      })),
      capSeconds,
      alreadySeconds,
      false,
    );
    for (const r of rows) {
      const capped = result.get(r.e.id);
      if (capped) r.payable = Math.min(r.payable, capped.payable);
    }
  }

  /** Already-approved payable seconds in a window: the DB's (outside this batch, read once per key) plus what
   *  earlier sheets of this build approved. */
  private async approvedBefore(
    key: string,
    consumed: Map<string, number>,
    memo: Memo<number>,
    load: () => Promise<number>,
  ): Promise<number> {
    const db = await memo.get(key, load);
    return db + (consumed.get(key) ?? 0);
  }

  /** Σ payable of the member's entries on other sheets of the same scope (the contract cap: the same engagement),
   *  started inside the window. */
  private async approvedInScopeWindow(
    member: string,
    sheet: TimesheetRow,
    window: { start: string; end: string },
    tz: string,
    batch: Set<string>,
  ): Promise<number> {
    const { data, error } = await this.sb
      .from('timesheets')
      .select('id')
      .eq('member_user_id', member)
      .eq('scope_kind', sheet.scope_kind)
      .eq('scope_ref', sheet.scope_ref)
      .lte('period_start', window.end)
      .gte('period_end', window.start);
    if (error) this.fail('freeze_scope_window', error);
    const sheetIds = distinct(
      ((data ?? []) as Array<{ id: string }>).map((r) => r.id),
    ).filter((id) => !batch.has(id));
    if (sheetIds.length === 0) return 0;
    const range = localRangeToUtc(window, tz);
    let total = 0;
    for (const part of chunks(sheetIds)) {
      const { data: rows, error: err } = await this.sb
        .from('time_entries')
        .select('id, payable_seconds, legacy_status')
        .in('timesheet_id', part)
        .not('payable_seconds', 'is', null)
        .gte('started_at', range.fromIso)
        .lt('started_at', range.toExclusiveIso);
      if (err) this.fail('freeze_scope_window', err);
      for (const r of (rows ?? []) as Array<{
        payable_seconds: number | null;
        legacy_status: string | null;
      }>) {
        if (r.legacy_status === 'rejected') continue;
        total += Math.max(0, toNumber(r.payable_seconds) ?? 0);
      }
    }
    return total;
  }

  /** Σ payable of the member's team entries for the team, started inside the window, on sheets outside the batch. */
  private async approvedInTeamWindow(
    member: string,
    teamId: string,
    window: { start: string; end: string },
    tz: string,
    batch: Set<string>,
  ): Promise<number> {
    const range = localRangeToUtc(window, tz);
    const { data, error } = await this.sb
      .from('time_entries')
      .select('id, timesheet_id, payable_seconds, legacy_status')
      .eq('member_user_id', member)
      .eq('context_kind', 'team')
      .eq('team_id', teamId)
      .not('payable_seconds', 'is', null)
      .gte('started_at', range.fromIso)
      .lt('started_at', range.toExclusiveIso);
    if (error) this.fail('freeze_team_window', error);
    let total = 0;
    for (const r of (data ?? []) as Array<{
      timesheet_id: string | null;
      payable_seconds: number | null;
      legacy_status: string | null;
    }>) {
      if (r.timesheet_id && batch.has(r.timesheet_id)) continue;
      if (r.legacy_status === 'rejected') continue;
      total += Math.max(0, toNumber(r.payable_seconds) ?? 0);
    }
    return total;
  }

  // ── internals: reads ────────────────────────────────────────────────────────────────────────────────

  private async loadSheets<T extends TimesheetRow = TimesheetRow>(
    ids: string[],
    select: string,
  ): Promise<T[]> {
    const wanted = distinct(ids);
    const out: T[] = [];
    for (const part of chunks(wanted)) {
      const { data, error } = await this.sb
        .from('timesheets')
        .select(select)
        .in('id', part);
      if (error) {
        // A raw id that is not a UUID is simply not a sheet anyone can open.
        if (error.code === '22P02') return [];
        this.fail('load_sheets', error);
      }
      out.push(...((data ?? []) as unknown as T[]));
    }
    return out;
  }

  private async policySnapshot(
    sheetId: string,
  ): Promise<Record<string, unknown> | null> {
    const { data, error } = await this.sb
      .from('timesheets')
      .select('id, policy_snapshot')
      .eq('id', sheetId)
      .maybeSingle();
    if (error) this.fail('policy_snapshot', error);
    const snapshot = (data as { policy_snapshot?: unknown } | null)
      ?.policy_snapshot;
    return isSnapshotObject(snapshot) ? snapshot : null;
  }

  private async entryAuthRows(sheetId: string): Promise<EntryAuthRow[]> {
    const rows = await this.readPaged<EntryAuthRow>(
      'sheet_entries',
      [sheetId],
      (part, from, to) =>
        this.sb
          .from('time_entries')
          .select(ENTRY_AUTH_SELECT)
          .in('timesheet_id', part)
          .order('id', { ascending: true })
          .range(from, to),
    );
    return rows.sort((a, b) => {
      const at = Date.parse(a.started_at);
      const bt = Date.parse(b.started_at);
      if (at !== bt) return at - bt;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
  }

  private async events(sheetId: string): Promise<TimesheetEventRow[]> {
    const { data, error } = await this.sb
      .from('timesheet_events')
      .select(TIMESHEET_EVENT_SELECT)
      .eq('timesheet_id', sheetId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true });
    if (error) this.fail('events', error);
    return (data ?? []) as unknown as TimesheetEventRow[];
  }

  /** TimesheetSummary = the row + entry_count, running_count, logged_seconds of its entries now. */
  private async summaries(sheets: TimesheetRow[]): Promise<TimesheetSummary[]> {
    return (await this.summariesWithReview(sheets)).items;
  }

  /** summaries plus, from the same entry read, each sheet's Needs-review count (A3). */
  private async summariesWithReview(sheets: TimesheetRow[]): Promise<{
    items: TimesheetSummary[];
    needsReview: Map<string, number>;
  }> {
    if (sheets.length === 0) return { items: [], needsReview: new Map() };
    const { stats, needsReview } = await this.sheetStats(
      sheets.map((s) => s.id),
    );
    return {
      items: sheets.map((s) => ({
        ...s,
        ...(stats.get(s.id) ?? emptyStats()),
      })),
      needsReview,
    };
  }

  private async sheetStats(sheetIds: string[]): Promise<{
    stats: Map<string, SheetStats>;
    needsReview: Map<string, number>;
  }> {
    const out = new Map<string, SheetStats>();
    const needsReview = new Map<string, number>();
    const rows = await this.readPaged<StatsRow>(
      'sheet_stats',
      sheetIds,
      (part, from, to) =>
        this.sb
          .from('time_entries')
          .select(SHEET_STATS_SELECT)
          .in('timesheet_id', part)
          .order('id', { ascending: true })
          .range(from, to),
    );
    for (const r of rows) {
      if (!r.timesheet_id) continue;
      const s = out.get(r.timesheet_id) ?? emptyStats();
      const seconds = Math.max(0, toNumber(r.duration_seconds) ?? 0);
      s.entry_count += 1;
      if (!r.ended_at) s.running_count += 1;
      s.logged_seconds += seconds;
      out.set(r.timesheet_id, s);
      if (seconds >= NEEDS_REVIEW_SECONDS || r.flagged_reason) {
        needsReview.set(
          r.timesheet_id,
          (needsReview.get(r.timesheet_id) ?? 0) + 1,
        );
      }
    }
    return { stats: out, needsReview };
  }

  /** Every row for the ids, chunked by id list and paged past PostgREST's row cap. */
  private async readPaged<T>(
    op: string,
    ids: string[],
    query: (
      part: string[],
      from: number,
      to: number,
    ) => PromiseLike<PageResult>,
  ): Promise<T[]> {
    const out: T[] = [];
    for (const part of chunks(distinct(ids))) {
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await query(part, from, from + PAGE - 1);
        if (error) this.fail(op, error);
        const rows = (Array.isArray(data) ? data : []) as T[];
        out.push(...rows);
        if (rows.length < PAGE || out.length >= MAX_PAGED_ROWS) break;
      }
      if (out.length >= MAX_PAGED_ROWS) {
        this.logger.warn(`timesheets_${op}_truncated rows=${out.length}`);
        break;
      }
    }
    return out;
  }

  private async queueIds(
    userId: string,
    status: 'submitted' | 'decided',
    since?: string,
  ): Promise<string[]> {
    const { data, error } = (await this.sb.rpc('time_approval_queue_ids', {
      p_user_id: userId,
      p_status: status,
      p_since: since ? since.slice(0, 10) : null,
    })) as RpcResult;
    if (error) this.fail('approval_queue', error);
    return distinct(uuidList(data));
  }

  private async memberProfiles(
    ids: string[],
  ): Promise<
    Map<
      string,
      { id: string; display_name: string | null; avatar_url: string | null }
    >
  > {
    const out = new Map<
      string,
      { id: string; display_name: string | null; avatar_url: string | null }
    >();
    for (const part of chunks(ids)) {
      const { data, error } = await this.sb
        .from('profiles')
        .select('id, display_name, avatar_url')
        .in('id', part);
      if (error) this.fail('member_profiles', error);
      for (const p of (data ?? []) as Array<{
        id: string;
        display_name: string | null;
        avatar_url: string | null;
      }>) {
        out.set(p.id, {
          id: p.id,
          display_name: p.display_name ?? null,
          avatar_url: p.avatar_url ?? null,
        });
      }
    }
    return out;
  }

  private async workspaceNames(ids: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (const part of chunks(ids)) {
      const { data, error } = await this.sb
        .from('workspaces')
        .select('id, name')
        .in('id', part);
      if (error) this.fail('workspace_names', error);
      for (const w of (data ?? []) as Array<{
        id: string;
        name: string | null;
      }>) {
        out.set(w.id, w.name ?? '');
      }
    }
    return out;
  }

  // ── internals: overview ─────────────────────────────────────────────────────────────────────────────

  /** Insert-only (never overwrites an explicit choice); a failure only warns. */
  private async seedPreferences(userId: string, tz: string): Promise<void> {
    const { error } = await this.sb
      .from('user_time_preferences')
      .upsert(
        { user_id: userId, timezone: tz },
        { onConflict: 'user_id', ignoreDuplicates: true },
      );
    if (error) {
      this.logger.warn(
        `time_preferences_seed_failed user=${userId} code=${error.code ?? 'none'}`,
      );
    }
  }

  /** `time.log` on any project: an owned project, or a share row whose role and capabilities grant it. */
  private async canLogAnywhere(userId: string): Promise<boolean> {
    const owned = await this.sb
      .from('projects')
      .select('id')
      .eq('owner_id', userId)
      .limit(1);
    if (owned.error) this.fail('can_log_owned', owned.error);
    if (((owned.data ?? []) as unknown[]).length > 0) return true;

    const { data, error } = await this.sb
      .from('project_access')
      .select('project_id, role, capabilities')
      .eq('user_id', userId)
      .limit(PAGE);
    if (error) this.fail('can_log_access', error);
    for (const row of (data ?? []) as Array<{
      role: ProjectRole;
      capabilities: Record<string, unknown> | null;
    }>) {
      if (!Object.hasOwn(ROLE_DEFAULTS, row.role)) continue;
      const perms = resolvePermissions(row.role, row.capabilities ?? null);
      if (getPermission(perms, 'time.log')) return true;
    }
    return false;
  }

  /**
   * contexts[] (backend.md me/overview): every logging context with an own entry in the last 30 days or an
   * entry on an `open`/`returned` sheet, newest activity first. Each carries the scope of its latest entry's
   * sheet and that scope's current sheet (the one holding today, else the newest open/returned one).
   */
  private async overviewContexts(
    userId: string,
    now: Date,
  ): Promise<{ contexts: OverviewContext[]; hasRecentEntries: boolean }> {
    const sinceIso = new Date(
      now.getTime() - OVERVIEW_DAYS * 86_400_000,
    ).toISOString();
    const sinceDate = addDays(localDate(now, 'UTC'), -(OVERVIEW_DAYS + 1));

    const recentRes = await this.sb
      .from('time_entries')
      .select(
        'id, context_kind, context_ref, context_label_snapshot, timesheet_id, started_at, duration_seconds',
      )
      .eq('member_user_id', userId)
      .gte('started_at', sinceIso)
      .order('started_at', { ascending: false })
      .limit(OVERVIEW_ENTRY_LIMIT);
    if (recentRes.error) this.fail('overview_entries', recentRes.error);
    const recent = (recentRes.data ?? []) as unknown as OverviewEntryRow[];

    const [liveRes, currentRes] = await Promise.all([
      this.sb
        .from('timesheets')
        .select(TIMESHEET_SELECT)
        .eq('member_user_id', userId)
        .in('status', ['open', 'returned'])
        .order('period_start', { ascending: false })
        .limit(MINE_LIMIT),
      this.sb
        .from('timesheets')
        .select(TIMESHEET_SELECT)
        .eq('member_user_id', userId)
        .gte('period_end', sinceDate)
        .order('period_start', { ascending: false })
        .limit(MINE_LIMIT),
    ]);
    if (liveRes.error) this.fail('overview_sheets', liveRes.error);
    if (currentRes.error) this.fail('overview_sheets', currentRes.error);
    const sheets = new Map<string, TimesheetRow>();
    for (const s of [
      ...((liveRes.data ?? []) as unknown as TimesheetRow[]),
      ...((currentRes.data ?? []) as unknown as TimesheetRow[]),
    ]) {
      sheets.set(s.id, s);
    }

    // Entries on those sheets: their contexts (an open sheet with no recent entry) and each sheet's total.
    const sheetEntries = await this.readPaged<OverviewEntryRow>(
      'overview_sheet_entries',
      [...sheets.keys()],
      (part, from, to) =>
        this.sb
          .from('time_entries')
          .select(
            'id, context_kind, context_ref, context_label_snapshot, timesheet_id, started_at, duration_seconds',
          )
          .in('timesheet_id', part)
          .order('id', { ascending: true })
          .range(from, to),
    );
    const totals = new Map<string, number>();
    for (const e of sheetEntries) {
      if (!e.timesheet_id) continue;
      totals.set(
        e.timesheet_id,
        (totals.get(e.timesheet_id) ?? 0) +
          Math.max(0, toNumber(e.duration_seconds) ?? 0),
      );
    }

    const liveEntries = sheetEntries.filter((e) => {
      const s = e.timesheet_id ? sheets.get(e.timesheet_id) : undefined;
      return (
        s !== undefined && (s.status === 'open' || s.status === 'returned')
      );
    });
    const all = [...recent, ...liveEntries].sort((a, b) =>
      a.started_at < b.started_at ? 1 : a.started_at > b.started_at ? -1 : 0,
    );

    const contexts = new Map<string, OverviewContext>();
    for (const e of all) {
      const key = `${e.context_kind}|${e.context_ref ?? ''}`;
      if (contexts.has(key)) continue;
      const sheet = e.timesheet_id ? sheets.get(e.timesheet_id) : undefined;
      const scope = sheet
        ? { kind: sheet.scope_kind, ref: sheet.scope_ref }
        : null;
      contexts.set(key, {
        kind: e.context_kind,
        id: e.context_kind === 'personal' ? null : e.context_ref,
        label:
          e.context_kind === 'personal'
            ? PERSONAL_LABEL
            : (e.context_label_snapshot ?? sheet?.scope_label_snapshot ?? ''),
        sheet_scope: e.context_kind === 'personal' ? null : scope,
        current_sheet: null,
      });
    }

    for (const ctx of contexts.values()) {
      if (!ctx.sheet_scope) continue;
      const scope = ctx.sheet_scope;
      const candidates = [...sheets.values()].filter(
        (s) => s.scope_kind === scope.kind && s.scope_ref === scope.ref,
      );
      const current =
        candidates.find((s) => {
          const today = localDate(now, safeTimezone(s.timezone));
          return s.period_start <= today && today <= s.period_end;
        }) ??
        candidates
          .filter((s) => s.status === 'open' || s.status === 'returned')
          .sort((a, b) => (a.period_start < b.period_start ? 1 : -1))[0];
      if (current) {
        ctx.current_sheet = {
          id: current.id,
          status: current.status,
          period_start: current.period_start,
          period_end: current.period_end,
          total_seconds: totals.get(current.id) ?? 0,
        };
      }
    }
    return {
      contexts: [...contexts.values()],
      hasRecentEntries: recent.length > 0,
    };
  }

  /** workspace_time_admin[]: workspaces the caller owns or administers (can_manage_workspace's rule). */
  private async workspaceAdmin(
    userId: string,
    hint: string | null,
  ): Promise<WorkspaceTimeAdmin[]> {
    const { data: memberships, error } = await this.sb
      .from('workspace_members')
      .select('workspace_id, role')
      .eq('user_id', userId)
      .in('role', ['owner', 'admin']);
    if (error) this.fail('overview_workspaces', error);
    const ids = distinct(
      ((memberships ?? []) as Array<{ workspace_id: string }>).map(
        (m) => m.workspace_id,
      ),
    );
    if (ids.length === 0) return [];

    const [wsRes, policyRes] = await Promise.all([
      this.sb.from('workspaces').select('id, name, slug').in('id', ids),
      this.sb
        .from('time_policies')
        .select('id, workspace_id, updated_by')
        .eq('scope', 'workspace')
        .in('workspace_id', ids),
    ]);
    if (wsRes.error) this.fail('overview_workspaces', wsRes.error);
    if (policyRes.error) this.fail('overview_policies', policyRes.error);
    const policies = new Map(
      (
        (policyRes.data ?? []) as Array<{
          workspace_id: string;
          updated_by: string | null;
        }>
      ).map((p) => [p.workspace_id, p]),
    );

    const out = await Promise.all(
      (
        (wsRes.data ?? []) as Array<{
          id: string;
          name: string | null;
          slug: string | null;
        }>
      ).map(async (w) => {
        const hasTracking = await this.entitlements.hasFeature(
          w.id,
          'time_tracking',
        );
        const policyRow = policies.get(w.id);
        // CHANGE-11: a manager's browser timezone materialises the missing row (the confirm card follows).
        if (!policyRow && hint && hasTracking) {
          await this.policy.ensureWorkspacePolicy(w.id, hint, userId);
        }
        return {
          workspace_id: w.id,
          name: w.name ?? '',
          slug: w.slug ?? null,
          has_time_tracking: hasTracking,
          policy_unconfirmed: !policyRow || !policyRow.updated_by,
        };
      }),
    );
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** L36 "decider anywhere": a time-tracking workspace they manage, a team they manage whose override routes
   *  to the team, or an active talent engagement they hire on. */
  private async isDeciderAnywhere(
    userId: string,
    admin: WorkspaceTimeAdmin[],
  ): Promise<boolean> {
    if (admin.some((w) => w.has_time_tracking)) return true;

    const [ownedRes, memberRes] = await Promise.all([
      this.sb.from('teams').select('id').eq('owner_id', userId),
      this.sb
        .from('team_members')
        .select('team_id, role')
        .eq('user_id', userId)
        .in('role', ['owner', 'admin']),
    ]);
    if (ownedRes.error) this.fail('overview_teams', ownedRes.error);
    if (memberRes.error) this.fail('overview_teams', memberRes.error);
    const teamIds = distinct([
      ...((ownedRes.data ?? []) as Array<{ id: string }>).map((t) => t.id),
      ...((memberRes.data ?? []) as Array<{ team_id: string }>).map(
        (m) => m.team_id,
      ),
    ]);
    for (const part of chunks(teamIds)) {
      const { data, error } = await this.sb
        .from('time_policies')
        .select('id')
        .eq('scope', 'team')
        .eq('approver_scope', 'team')
        .in('team_id', part)
        .limit(1);
      if (error) this.fail('overview_team_policies', error);
      if (((data ?? []) as unknown[]).length > 0) return true;
    }

    const { data: seats, error: seatError } = await this.sb
      .from('engagement_parties')
      .select('engagement_id')
      .eq('user_id', userId)
      .eq('position', 'hirer');
    if (seatError) this.fail('overview_hirer', seatError);
    const engagementIds = distinct(
      ((seats ?? []) as Array<{ engagement_id: string }>).map(
        (s) => s.engagement_id,
      ),
    );
    for (const part of chunks(engagementIds)) {
      const { data, error } = await this.sb
        .from('engagements')
        .select('id')
        .in('id', part)
        .eq('kind', 'talent_services')
        .eq('status', 'active')
        .limit(1);
      if (error) this.fail('overview_hirer', error);
      if (((data ?? []) as unknown[]).length > 0) return true;
    }
    return false;
  }

  /** A time sentinel maps as usual; anything else is a logged 500 with fixed copy (D55: never Postgres text). */
  private fail(op: string, error: PgErrorLike): never {
    const mapped = mapTimeDbError(error);
    if (mapped) throw mapped;
    this.logger.error(
      `timesheets_${op}_failed code=${error.code ?? 'none'} message=${error.message ?? ''}`,
    );
    throw new InternalServerErrorException({
      code: 'TIME_INTERNAL',
      message: READ_FAILED_MESSAGE,
    });
  }
}

/** Exported for the cron: is this HttpException a transition refusal for one of `reasons`? */
export function isTransitionRefusal(
  error: unknown,
  reasons: readonly string[],
): boolean {
  if (!(error instanceof HttpException)) return false;
  const body = errorBody(error);
  return (
    body.code === 'TIMESHEET_TRANSITION_INVALID' &&
    typeof body.reason === 'string' &&
    reasons.includes(body.reason)
  );
}
