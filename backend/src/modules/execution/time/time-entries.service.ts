// Time entries (backend.md "Endpoints", "Edits and context changes"): the timer, manual time, edits, context
// changes and project moves, deletes, the caller's own reads, comments, preferences and hour-cap context.
// Every write resolves its For context through LoggingContextService.select (uncached, L60), which is also the
// plan gate (D26): entries never call EntitlementsService. The database is the final word on locks (trg_40),
// periods (trg_30) and the context floor (trg_10); this service maps their sentinels and adds the rules that
// live in TypeScript (manual entries, retroactive window, hour caps, warnings).
import {
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  Optional,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import { EngagementsService } from '../../marketplace/engagements/engagements.service';
import { ProjectAuthorizationService } from '../projects/authorization/project-authorization.service';
import {
  getPermission,
  ROLE_DEFAULTS,
} from '../projects/permissions/project-permissions';
import type {
  CreateEntryInput,
  StartEntryInput,
  StopEntryOptions,
  UpdateEntryInput,
} from './dto/entries.dto';
import { LoggingContextService } from './logging-context.service';
import { TimeAuthorityService } from './time-authority.service';
import {
  COMMENT_SELECT,
  COMMENT_SELECT_WITH_EMAIL,
  ENTRY_SELF_SELECT,
  SEGMENT_SELECT,
} from './time-entry.select';
import {
  ALIAS_LOCKED_MESSAGE,
  isDeadlock,
  type MapContext,
  mapTimeDbError,
  type PgErrorLike,
  throwTimeDb,
  TIME_INTERNAL_CODE,
  timeError,
  timeNotFound,
} from './time-errors';
import { TimeNotificationsService } from './time-notifications.service';
import {
  addDays,
  isValidTimezone,
  type LocalRange,
  localDate,
  localRangeToUtc,
  monthWindow,
  retroactiveFloor,
  safeTimezone,
  weekWindow,
} from './time-periods';
import {
  memberCapsFromRate,
  pickMemberRateInForce,
  TEAM_MEMBER_RATE_SELECT,
  type TeamMemberRateRow,
  TimePolicyService,
} from './time-policy.service';
import { TimeRatesService } from './time-rates.service';
import { PRESET_WORK_ITEMS } from './time.types';
import type {
  CapContext,
  CommentRow,
  ContextKind,
  EntryAuthRow,
  EntryMember,
  EntryProject,
  EntrySheetRef,
  EntrySource,
  EntryTask,
  EntryWarning,
  EntryWithWarnings,
  LegacyStatusMarker,
  LoggingForRequest,
  LoggingOption,
  MemberCaps,
  MySummary,
  Paged,
  PresetWorkItem,
  ProjectTaskOption,
  RateType,
  ResolvedTimePolicy,
  SegmentRow,
  SheetScopeResult,
  TimeEntryView,
  TimesheetStatus,
  UserTimePreferences,
  WorkItem,
  WorkItemsResult,
  WorkType,
  WritePurpose,
} from './time.types';

// ── Copy ─────────────────────────────────────────────────────────────────────────────────────────────────────
const RANGE_INVALID_MESSAGE = 'The end time must be after the start time.';
const DATES_INVALID_MESSAGE =
  'The start date must be on or before the end date.';
const SUMMARY_RANGE_MESSAGE = 'Pick a range of a year or less.';
const ENTRY_STALE_MESSAGE =
  'This entry changed. Reload to see the latest version.';
const TASK_NOT_ON_PROJECT_MESSAGE = 'Pick a task from this project.';
const BOTH_WORK_ITEMS_MESSAGE = 'Pick a task or a work item, not both.';
const HIDDEN_PRESET_MESSAGE = "This work item isn't available here.";
const ALREADY_ON_BREAK_MESSAGE = 'This timer is already on break.';
const NOT_ON_BREAK_MESSAGE = 'This timer is not on break.';
const BEFORE_AGREEMENT_MESSAGE =
  "This time is from before the agreement, so it can't move onto it.";
const EMPTY_COMMENT_MESSAGE = 'Comment body cannot be empty.';
const TIMEZONE_INVALID_MESSAGE = "That time zone isn't valid.";
/** Read paths get read copy (D55's fallback says "save"); the code stays TIME_INTERNAL. */
const READ_FAILED_MESSAGE = "Proyekto couldn't load this time. Try again.";

/** PostgREST pages at 1000 rows by default; aggregate reads walk pages of this size. */
const PAGE_ROWS = 1000;
/** Aggregate reads stop here (a member's year of entries is far below it). */
const MAX_AGGREGATE_ROWS = 20_000;
/** `.in()` lists are chunked so a long id list never builds an over-long URL. */
const IN_CHUNK = 100;
/** mySummary fills every day of the range up to this many days. */
const MAX_SUMMARY_DAYS = 400;
/** A cap is reached once the window holds the limit (float tolerance on hours). */
const CAP_EPSILON_HOURS = 1e-6;

const PREFERENCES_SELECT = 'user_id, timezone, week_start, updated_at';
const TIMER_SELECT =
  'id, member_user_id, started_at, ended_at, paused_at, break_seconds';

// ── Rows ─────────────────────────────────────────────────────────────────────────────────────────────────────
/** One own entry as ENTRY_SELF_SELECT returns it: every class (the member sees all of their own entry). */
interface SelfRow {
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
  member_user_id: string | null;
  member_display_name_snapshot: string | null;
  member: EntryMember | null;
  task_id: string | null;
  note: string | null;
  task: EntryTask | null;
  project: EntryProject | null;
  rate_snapshot: number | string | null;
  rate_type_snapshot: RateType | null;
  currency_snapshot: string | null;
  amount_snapshot: number | string | null;
}

interface TimerRow {
  id: string;
  member_user_id: string | null;
  started_at: string;
  ended_at: string | null;
  paused_at: string | null;
  break_seconds: number | null;
}

interface SummaryRow {
  id: string;
  started_at: string;
  duration_seconds: number | null;
  payable_seconds: number | null;
  legacy_status: LegacyStatusMarker | null;
  context_kind: ContextKind;
  context_ref: string | null;
  context_label_snapshot: string | null;
  project_id: string | null;
  project: EntryProject | null;
  timesheet: { status: TimesheetStatus } | null;
}

interface TaskContext {
  project_id: string;
  work_type: WorkType | null;
}

/** The For option a write lands on, with its sheet scope and resolved policy (null for "Just me"). */
interface OptionPolicy {
  option: LoggingOption;
  scope: SheetScopeResult | null;
  policy: ResolvedTimePolicy | null;
  /** The policy timezone; null for "Just me" (no policy applies to personal time). */
  timezone: string | null;
}

interface CapWindow {
  key: 'weekly' | 'monthly';
  limitHours: number;
  range: LocalRange;
}

type RpcResult = { data: unknown; error: PgErrorLike | null };

// ── Pure helpers ─────────────────────────────────────────────────────────────────────────────────────────────
function numberOrNull(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function chunks<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += IN_CHUNK) {
    out.push(items.slice(i, i + IN_CHUNK));
  }
  return out;
}

function sameId(a: string | null | undefined, b: string | null | undefined) {
  return (a ?? '').toLowerCase() === (b ?? '').toLowerCase();
}

/** '' and whitespace mean "no task" (old clients send them); undefined = not sent. */
function normaliseTaskId(
  value: string | null | undefined,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function normaliseNote(
  value: string | null | undefined,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** An ISO instant, or null when it does not parse. */
function parseInstant(value: string | null | undefined): Date | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms);
}

function sameInstant(a: string, b: string): boolean {
  const am = Date.parse(a);
  const bm = Date.parse(b);
  return !Number.isNaN(am) && am === bm;
}

/** Total break as of `asOf`, including an open pause (stopping mid-break never drops that interval). */
function foldPause(
  timer: Pick<TimerRow, 'break_seconds' | 'paused_at'>,
  asOf: Date,
): number {
  const banked = Math.max(0, timer.break_seconds ?? 0);
  if (!timer.paused_at) return banked;
  const pausedAt = Date.parse(timer.paused_at);
  if (Number.isNaN(pausedAt)) return banked;
  return banked + Math.max(0, Math.floor((asOf.getTime() - pausedAt) / 1000));
}

/** The columns a stop writes. The stored break wins; `fallbackBreakMinutes` serves old clients that kept the
 *  break locally. Touches only the timer columns, never the context or the sheet (L60). */
function stoppedTimerPatch(
  timer: Pick<TimerRow, 'started_at' | 'paused_at' | 'break_seconds'>,
  endedAt: string,
  fallbackBreakMinutes = 0,
): Record<string, unknown> {
  const storedBreak = foldPause(timer, new Date(endedAt));
  const breakSeconds =
    storedBreak > 0
      ? storedBreak
      : Math.round(Math.max(0, fallbackBreakMinutes) * 60);
  const grossSeconds = Math.max(
    0,
    Math.floor((Date.parse(endedAt) - Date.parse(timer.started_at)) / 1000),
  );
  return {
    ended_at: endedAt,
    duration_seconds: Math.max(0, grossSeconds - breakSeconds),
    break_seconds: breakSeconds,
    break_minutes: Math.round(breakSeconds / 60),
    paused_at: null,
  };
}

/** The context columns of an option: kind, ref and the one matching FK (time_entries_context_check). */
function contextColumns(option: LoggingOption): Record<string, unknown> {
  const id = option.kind === 'personal' ? null : option.id;
  return {
    context_kind: option.kind,
    context_ref: id,
    team_id: option.kind === 'team' ? id : null,
    workspace_id: option.kind === 'workspace' ? id : null,
    engagement_assignment_id: option.kind === 'assignment' ? id : null,
    // trg_10 re-snapshots the label from the context row; this is the same value.
    context_label_snapshot: option.kind === 'personal' ? null : option.label,
  };
}

function sameContext(option: LoggingOption, row: SelfRow): boolean {
  if (option.kind !== row.context_kind) return false;
  return option.kind === 'personal' || sameId(option.id, row.context_ref);
}

/** A `logging_for` request that names the entry's own context (no Change For). */
function requestsCurrentContext(
  requested: { kind: ContextKind; id?: string | null },
  row: SelfRow,
): boolean {
  if (requested.kind !== row.context_kind) return false;
  return (
    row.context_kind === 'personal' ||
    sameId(requested.id ?? null, row.context_ref)
  );
}

/** The entry's current context as a For option (rates.estimate and the policy read take one). */
function currentOption(
  row: SelfRow,
  scope: SheetScopeResult | null,
): LoggingOption {
  return {
    kind: row.context_kind,
    id: row.context_kind === 'personal' ? null : row.context_ref,
    label: row.context_label_snapshot ?? '',
    sheet_scope: scope
      ? { kind: scope.scope_kind, ref: scope.scope_ref }
      : null,
    rate_source: 'none',
    workspace_tag: null,
    approver_hint: null,
  };
}

/** trg_time_entries_40_lock's order: paid → billed → legacy → frozen → sheet state. */
function lockReasonOf(row: SelfRow, billed: boolean): string | null {
  if (row.payout_id || row.legacy_status === 'paid_outside') return 'paid';
  if (billed) return 'billed';
  if (row.legacy_status) return 'legacy';
  if (row.payable_seconds !== null && row.payable_seconds !== undefined) {
    return 'frozen';
  }
  const sheetState = row.timesheet ? row.timesheet.status : null;
  if (sheetState === 'submitted' || sheetState === 'approved') {
    return `sheet_${sheetState}`;
  }
  return null;
}

/** An own entry as a view: every class visible (D32 applies only to other viewers). */
function selfView(row: SelfRow, billed: boolean): TimeEntryView {
  return {
    id: row.id,
    context_kind: row.context_kind,
    context_ref: row.context_ref,
    context_label_snapshot: row.context_label_snapshot,
    timesheet_id: row.timesheet_id,
    work_item: row.work_item,
    started_at: row.started_at,
    ended_at: row.ended_at,
    paused_at: row.paused_at ?? null,
    duration_seconds: row.duration_seconds,
    break_seconds: row.break_seconds ?? 0,
    break_minutes: row.break_minutes ?? 0,
    payable_seconds: row.payable_seconds,
    source: row.source,
    work_type_snapshot: row.work_type_snapshot,
    legacy_status: row.legacy_status,
    payout_id: row.payout_id,
    flagged_reason: row.flagged_reason,
    project_id: row.project_id,
    team_id: row.team_id,
    workspace_id: row.workspace_id,
    engagement_assignment_id: row.engagement_assignment_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    timesheet: row.timesheet ?? null,
    locked_reason: lockReasonOf(row, billed),
    identity: 'visible',
    member_user_id: row.member_user_id,
    member_display_name_snapshot: row.member_display_name_snapshot,
    member: row.member ?? null,
    member_label: null,
    content: 'visible',
    task_id: row.task_id,
    note: row.note,
    task: row.task ?? null,
    project: row.project ?? null,
    content_label: null,
    cost: 'visible',
    rate_snapshot: numberOrNull(row.rate_snapshot) ?? 0,
    rate_type_snapshot: row.rate_type_snapshot ?? 'hourly',
    currency_snapshot: row.currency_snapshot ?? 'USD',
    amount_snapshot: numberOrNull(row.amount_snapshot),
  };
}

/** Old limit-context window choice: an exceeded window beats one that is not; weekly wins a tie. */
function pickWindow<T extends { key: 'weekly' | 'monthly'; over: boolean }>(
  candidates: T[],
): T | null {
  let selected: T | null = null;
  for (const c of candidates) {
    if (!selected) selected = c;
    else if (c.over && !selected.over) selected = c;
    else if (c.over === selected.over && c.key === 'weekly') selected = c;
  }
  return selected;
}

/** The cap windows of `caps` holding local date `d`. */
function capWindows(
  caps: MemberCaps,
  d: string,
  weekStart: number,
): CapWindow[] {
  const out: CapWindow[] = [];
  if (caps.weekly_limit_hours !== null && caps.weekly_limit_hours >= 0) {
    out.push({
      key: 'weekly',
      limitHours: caps.weekly_limit_hours,
      range: weekWindow(d, weekStart),
    });
  }
  if (caps.monthly_limit_hours !== null && caps.monthly_limit_hours >= 0) {
    out.push({
      key: 'monthly',
      limitHours: caps.monthly_limit_hours,
      range: monthWindow(d),
    });
  }
  return out;
}

function memo<K, V>(cache: Map<K, Promise<V>>, key: K, load: () => Promise<V>) {
  let hit = cache.get(key);
  if (!hit) {
    hit = load();
    cache.set(key, hit);
  }
  return hit;
}

@Injectable()
export class TimeEntriesService {
  private readonly logger = new Logger(TimeEntriesService.name);

  constructor(
    @Inject(SUPABASE_ADMIN) private readonly sb: SupabaseClient,
    private readonly projectAuth: ProjectAuthorizationService,
    private readonly loggingContext: LoggingContextService,
    private readonly policy: TimePolicyService,
    private readonly rates: TimeRatesService,
    private readonly authority: TimeAuthorityService,
    private readonly notifications: TimeNotificationsService,
    // Appended and optional (§0): the friendly "into an assignment" pre-check (L58). Without it the database
    // still refuses (trg_10 LOGGING_FOR_INVALID, trg_20 window), mapped to the same 422.
    @Optional() private readonly engagements?: EngagementsService,
  ) {}

  // ── Timer ──────────────────────────────────────────────────────────────────────────────────────────────

  async start(
    userId: string,
    input: StartEntryInput,
    o: { purpose?: 'timer' | 'alias'; native?: boolean } = {},
  ): Promise<EntryWithWarnings> {
    const purpose = o.purpose ?? 'timer';
    const alias = purpose === 'alias' ? { native: o.native === true } : null;
    const taskId = normaliseTaskId(input.task_id) ?? null;
    if (taskId && input.work_item) {
      throw timeError('WORK_ITEM_INVALID', BOTH_WORK_ITEMS_MESSAGE);
    }

    const at = new Date();
    // Uncached resolve (L60); also the plan gate (D26). No access → 404 before any task lookup.
    const option = await this.loggingContext.select(userId, input.project_id, {
      requested: input.logging_for,
      at,
      purpose,
      remember: purpose === 'timer' && input.remember === true,
    });
    const [task, op] = await Promise.all([
      taskId
        ? this.taskInProject(taskId, input.project_id)
        : Promise.resolve(null),
      this.optionPolicy(option, userId, input.project_id, at),
    ]);
    const workItem = this.workItemFor(taskId, input.work_item, op);
    const workType: WorkType =
      task?.work_type ?? input.work_type ?? 'real_work';

    const [estimate, displayName, contract] = await Promise.all([
      this.rates.estimate(option, userId, input.project_id, workType, at),
      this.displayNameSnapshot(userId),
      this.contractWeekWarning(userId, op, at, 0, 'start'),
      // D46: a timer cannot start once a cap that needs approval is full (refuses before the insert).
      this.assertHourCap(userId, op, at, 0, 'start'),
    ]);
    const startedAt = at.toISOString();
    const insert: Record<string, unknown> = {
      ...contextColumns(option),
      project_id: input.project_id,
      task_id: taskId,
      work_item: workItem,
      member_user_id: userId,
      started_at: startedAt,
      source: 'timer',
      rate_snapshot: estimate.rate_snapshot,
      rate_type_snapshot: estimate.rate_type_snapshot,
      currency_snapshot: estimate.currency_snapshot,
      work_type_snapshot: workType,
      member_display_name_snapshot: displayName,
    };
    const note = normaliseNote(input.note);
    if (note !== undefined) insert.note = note;

    // The one-running index (uq_time_entries_one_running_per_member) is the guard: 23505 → 409, alias 400 (D07).
    const { data, error } = await this.sb
      .from('time_entries')
      .insert(insert)
      .select(ENTRY_SELF_SELECT)
      .single();
    if (error || !data) this.writeFail('start', error, alias);
    const row = data as unknown as SelfRow;

    await this.openSegment(row.id, 'work', startedAt);
    return { ...selfView(row, false), warnings: contract ? [contract] : [] };
  }

  /** actorId null only with o.system. Folds an open pause (stoppedTimerPatch semantics), closes the open segment.
   *  Never touches context or sheet (L60). Stopping a stopped entry → 409 TIMER_NOT_RUNNING. */
  async stop(
    actorId: string | null,
    entryId: string,
    o: StopEntryOptions & { alias?: { native: boolean } } = {},
  ): Promise<TimeEntryView> {
    const alias = o.alias ?? null;
    if (!o.system) {
      if (!actorId) throw timeNotFound('entry');
      await this.authority.assertOwnEntry(actorId, entryId);
    }
    const timer = await this.loadTimer(entryId);
    if (!timer) throw timeNotFound('entry');
    if (timer.ended_at) throw timeError('TIMER_NOT_RUNNING');

    const endedAt = this.stopInstant(timer, o.endedAt, o.system === true);
    const patch = stoppedTimerPatch(timer, endedAt, o.breakMinutes ?? 0);
    if (o.flaggedReason) patch.flagged_reason = o.flaggedReason;

    // `ended_at IS NULL` in the filter: a concurrent stop wins once, the loser gets 409.
    const { data, error } = await this.sb
      .from('time_entries')
      .update(patch)
      .eq('id', entryId)
      .is('ended_at', null)
      .select(ENTRY_SELF_SELECT);
    if (error) this.writeFail('stop', error, alias);
    const row = ((data ?? []) as unknown as SelfRow[])[0];
    if (!row) throw timeError('TIMER_NOT_RUNNING');

    await this.closeOpenSegment(entryId, endedAt);
    // D61: a manual stop clears the member's "Timer still running" notice. System stops (cron, assignment end)
    // send timer_auto_stopped, which clears it.
    if (!o.system) {
      await this.notifications.timerStopped({
        id: row.id,
        member_user_id: row.member_user_id,
      });
    }
    return selfView(row, false);
  }

  async pause(userId: string, entryId: string): Promise<TimeEntryView> {
    await this.authority.assertOwnEntry(userId, entryId);
    const timer = await this.loadTimer(entryId);
    if (!timer) throw timeNotFound('entry');
    if (timer.ended_at) throw timeError('TIMER_NOT_RUNNING');
    if (timer.paused_at) {
      throw timeError('TIMER_NOT_RUNNING', ALREADY_ON_BREAK_MESSAGE);
    }

    const now = new Date().toISOString();
    const { data, error } = await this.sb
      .from('time_entries')
      .update({ paused_at: now })
      .eq('id', entryId)
      .is('ended_at', null)
      .is('paused_at', null)
      .select(ENTRY_SELF_SELECT);
    if (error) this.writeFail('pause', error, null);
    const row = ((data ?? []) as unknown as SelfRow[])[0];
    if (!row) throw timeError('TIMER_NOT_RUNNING');

    await this.closeOpenSegment(entryId, now);
    await this.openSegment(entryId, 'break', now);
    return selfView(row, false);
  }

  async resume(userId: string, entryId: string): Promise<TimeEntryView> {
    await this.authority.assertOwnEntry(userId, entryId);
    const timer = await this.loadTimer(entryId);
    if (!timer) throw timeNotFound('entry');
    if (timer.ended_at) throw timeError('TIMER_NOT_RUNNING');
    if (!timer.paused_at) {
      throw timeError('TIMER_NOT_RUNNING', NOT_ON_BREAK_MESSAGE);
    }

    const now = new Date();
    const breakSeconds = foldPause(timer, now);
    const { data, error } = await this.sb
      .from('time_entries')
      .update({
        paused_at: null,
        break_seconds: breakSeconds,
        break_minutes: Math.round(breakSeconds / 60),
      })
      .eq('id', entryId)
      .is('ended_at', null)
      .eq('paused_at', timer.paused_at)
      .select(ENTRY_SELF_SELECT);
    if (error) this.writeFail('resume', error, null);
    const row = ((data ?? []) as unknown as SelfRow[])[0];
    if (!row) throw timeError('TIMER_NOT_RUNNING');

    const nowIso = now.toISOString();
    await this.closeOpenSegment(entryId, nowIso);
    await this.openSegment(entryId, 'work', nowIso);
    return selfView(row, false);
  }

  // ── Manual time ────────────────────────────────────────────────────────────────────────────────────────

  async createManual(
    userId: string,
    input: CreateEntryInput,
    o: { purpose?: 'manual' | 'alias'; native?: boolean } = {},
  ): Promise<EntryWithWarnings> {
    const purpose = o.purpose ?? 'manual';
    const alias = purpose === 'alias' ? { native: o.native === true } : null;
    const taskId = normaliseTaskId(input.task_id) ?? null;
    if (taskId && input.work_item) {
      throw timeError('WORK_ITEM_INVALID', BOTH_WORK_ITEMS_MESSAGE);
    }
    const started = parseInstant(input.started_at);
    const ended = parseInstant(input.ended_at);
    if (!started || !ended || ended.getTime() <= started.getTime()) {
      throw new BadRequestException(RANGE_INVALID_MESSAGE);
    }

    // The resolver runs at the entry's start (an ended assignment whose window holds it still counts).
    const option = await this.loggingContext.select(userId, input.project_id, {
      requested: input.logging_for,
      at: started,
      purpose,
      remember: purpose === 'manual' && input.remember === true,
    });
    const [task, op] = await Promise.all([
      taskId
        ? this.taskInProject(taskId, input.project_id)
        : Promise.resolve(null),
      this.optionPolicy(option, userId, input.project_id, started),
    ]);
    if (op.policy && op.policy.allow_manual_entries === false) {
      throw timeError('MANUAL_ENTRIES_DISABLED');
    }
    this.assertRetroactive(op, started);
    const workItem = this.workItemFor(taskId, input.work_item, op);
    const workType: WorkType =
      task?.work_type ?? input.work_type ?? 'real_work';

    const grossSeconds = Math.floor(
      (ended.getTime() - started.getTime()) / 1000,
    );
    // break_seconds wins; break_minutes is the deprecated mirror (D43). A break never exceeds the interval.
    const requestedBreak =
      input.break_seconds ??
      (input.break_minutes !== undefined
        ? Math.round(input.break_minutes * 60)
        : 0);
    const breakSeconds = Math.min(Math.max(0, requestedBreak), grossSeconds);
    const netSeconds = Math.max(0, grossSeconds - breakSeconds);

    const [estimate, displayName, overlap, contract] = await Promise.all([
      this.rates.estimate(option, userId, input.project_id, workType, started),
      this.displayNameSnapshot(userId),
      this.overlapWarning(userId, started, ended),
      this.contractWeekWarning(userId, op, started, netSeconds, 'manual'),
      // D46 (refuses before the insert).
      this.assertHourCap(userId, op, started, netSeconds, 'manual'),
    ]);

    const insert: Record<string, unknown> = {
      ...contextColumns(option),
      project_id: input.project_id,
      task_id: taskId,
      work_item: workItem,
      member_user_id: userId,
      started_at: started.toISOString(),
      ended_at: ended.toISOString(),
      duration_seconds: netSeconds,
      break_seconds: breakSeconds,
      break_minutes: Math.round(breakSeconds / 60),
      source: 'manual',
      rate_snapshot: estimate.rate_snapshot,
      rate_type_snapshot: estimate.rate_type_snapshot,
      currency_snapshot: estimate.currency_snapshot,
      work_type_snapshot: workType,
      member_display_name_snapshot: displayName,
    };
    const note = normaliseNote(input.note);
    if (note !== undefined) insert.note = note;

    const { data, error } = await this.sb
      .from('time_entries')
      .insert(insert)
      .select(ENTRY_SELF_SELECT)
      .single();
    if (error || !data) this.writeFail('createManual', error, alias);
    const row = data as unknown as SelfRow;

    const warnings: EntryWarning[] = [];
    if (overlap) warnings.push(overlap);
    if (contract) warnings.push(contract);
    return { ...selfView(row, false), warnings };
  }

  // ── Edits, moves and context changes ───────────────────────────────────────────────────────────────────

  async update(
    userId: string,
    entryId: string,
    input: UpdateEntryInput,
    o: { purpose?: 'edit' | 'alias'; native?: boolean } = {},
  ): Promise<TimeEntryView> {
    const purpose: WritePurpose = o.purpose ?? 'edit';
    const alias = purpose === 'alias' ? { native: o.native === true } : null;
    await this.authority.assertOwnEntry(userId, entryId);
    const row = await this.loadSelf(entryId);
    if (!row) throw timeNotFound('entry');

    // D42: the client's copy must be current (the alias never sends one).
    if (
      input.expected_updated_at !== undefined &&
      !sameInstant(input.expected_updated_at, row.updated_at)
    ) {
      throw timeError('STALE_REVISION', ENTRY_STALE_MESSAGE, {
        entry_id: row.id,
        updated_at: row.updated_at,
      });
    }
    // trg_40 is the final word; refusing here first spares the resolver and gives the same 409.
    const billed = await this.isBilled(row);
    const lock = lockReasonOf(row, billed);
    if (lock) throw this.lockedError(row.id, lock, alias);

    const requestedTask = normaliseTaskId(input.task_id);
    if (requestedTask && input.work_item) {
      throw timeError('WORK_ITEM_INVALID', BOTH_WORK_ITEMS_MESSAGE);
    }

    const patch: Record<string, unknown> = {};
    // ── Task / work item (L49: work_item follows task_id). `taskWorkType` undefined = task unchanged.
    let targetProject = row.project_id;
    let taskWorkType: WorkType | null | undefined;
    if (requestedTask !== undefined && requestedTask !== row.task_id) {
      if (requestedTask) {
        const ctx = await this.taskContext(requestedTask);
        if (!ctx)
          throw timeError('WORK_ITEM_INVALID', TASK_NOT_ON_PROJECT_MESSAGE);
        targetProject = ctx.project_id;
        taskWorkType = ctx.work_type;
        patch.task_id = requestedTask;
        patch.work_item = 'task';
      } else {
        patch.task_id = null;
        patch.work_item = input.work_item ?? 'other';
        taskWorkType = null;
      }
    } else if (
      input.work_item !== undefined &&
      input.work_item !== row.work_item
    ) {
      patch.task_id = null;
      patch.work_item = input.work_item;
      if (row.task_id) taskWorkType = null;
    }

    const startedIso =
      input.started_at !== undefined
        ? this.isoOrBadRequest(input.started_at)
        : row.started_at;
    const startedAt = new Date(startedIso);

    // ── Project move (task in another project) or Change For (backend.md "Edits and context changes").
    const isMove = !sameId(targetProject, row.project_id);
    let option: LoggingOption | null = null;
    if (isMove && targetProject) {
      option = await this.loggingContext.select(userId, targetProject, {
        requested: input.logging_for,
        at: startedAt,
        purpose,
      });
      patch.project_id = targetProject;
    } else if (
      input.logging_for &&
      !requestsCurrentContext(input.logging_for, row)
    ) {
      // Only a real Change For is gated (backend.md "on context change"): a client that round-trips the
      // entry's current context must still edit it after the context turned unavailable for new entries (E11,
      // a plan downgrade) or the member lost time.log (W2 review F2).
      if (!row.project_id) throw timeError('LOGGING_FOR_INVALID');
      const chosen = await this.loggingContext.select(userId, row.project_id, {
        requested: input.logging_for,
        at: startedAt,
        purpose,
      });
      if (!sameContext(chosen, row)) option = chosen;
    }
    if (option) {
      if (option.kind === 'assignment' && option.id) {
        await this.assertAssignmentAdoptable(
          option.id,
          row.created_at,
          startedIso,
        );
      }
      Object.assign(patch, contextColumns(option));
    }

    // ── Policy of the context the entry ends up in: retroactive window and hidden presets.
    const presetChanged =
      input.work_item !== undefined && patch.work_item === input.work_item;
    const needsPolicy =
      option !== null || input.started_at !== undefined || presetChanged;
    const op = needsPolicy
      ? await this.optionPolicy(
          option ?? currentOption(row, null),
          userId,
          targetProject,
          startedAt,
        )
      : null;
    if (op) {
      if (input.started_at !== undefined || option !== null) {
        this.assertRetroactive(op, startedAt);
      }
      if (
        presetChanged &&
        input.work_item &&
        op.policy?.hidden_presets.includes(input.work_item)
      ) {
        throw timeError('WORK_ITEM_INVALID', HIDDEN_PRESET_MESSAGE);
      }
    }

    // ── Times and breaks.
    const breakGiven =
      input.break_seconds !== undefined || input.break_minutes !== undefined;
    const endsTimer = !row.ended_at && input.ended_at !== undefined;
    const endedIso =
      input.ended_at !== undefined
        ? this.isoOrBadRequest(input.ended_at)
        : row.ended_at;
    if (input.started_at !== undefined) patch.started_at = startedIso;
    if (input.ended_at !== undefined) patch.ended_at = endedIso;
    let breakSeconds = Math.max(0, row.break_seconds ?? 0);
    if (input.break_seconds !== undefined) {
      breakSeconds = Math.max(0, input.break_seconds);
    } else if (input.break_minutes !== undefined) {
      breakSeconds = Math.max(0, Math.round(input.break_minutes * 60)); // D43
    } else if (endsTimer && endedIso) {
      // Ending a running timer by edit folds an open pause, as a stop does.
      breakSeconds = foldPause(row, new Date(endedIso));
    }
    if (breakGiven || endsTimer) {
      patch.break_seconds = breakSeconds;
      patch.break_minutes = Math.round(breakSeconds / 60);
    }
    if (endsTimer) patch.paused_at = null;
    const timesChanged =
      input.started_at !== undefined ||
      input.ended_at !== undefined ||
      breakGiven;
    if (endedIso && timesChanged) {
      const startMs = Date.parse(startedIso);
      const endMs = Date.parse(endedIso);
      if (!(endMs > startMs)) {
        throw new BadRequestException(RANGE_INVALID_MESSAGE);
      }
      patch.duration_seconds = Math.max(
        0,
        Math.floor((endMs - startMs) / 1000) - breakSeconds,
      );
    }

    // ── Note and work type.
    const note = normaliseNote(input.note);
    if (note !== undefined && note !== row.note) patch.note = note;
    let workType: WorkType = row.work_type_snapshot;
    if (taskWorkType !== undefined) {
      workType = taskWorkType ?? input.work_type ?? 'real_work';
    } else if (input.work_type !== undefined && !row.task?.work_type) {
      // A task's own work type wins over the request (the task decides).
      workType = input.work_type;
    }
    if (workType !== row.work_type_snapshot) {
      patch.work_type_snapshot = workType;
    }

    // ── Rate estimate: re-snapshot on any context change, move or work-type change (L10, L2).
    if (
      (option || isMove || workType !== row.work_type_snapshot) &&
      targetProject
    ) {
      const rateOption = option ?? currentOption(row, op?.scope ?? null);
      const estimate = await this.rates.estimate(
        rateOption,
        userId,
        targetProject,
        workType,
        startedAt,
      );
      patch.rate_snapshot = estimate.rate_snapshot;
      patch.rate_type_snapshot = estimate.rate_type_snapshot;
      patch.currency_snapshot = estimate.currency_snapshot;
    }

    if (Object.keys(patch).length === 0) return selfView(row, billed);

    // One UPDATE for every changed column, compare-and-swap on the row read above; a deadlock is retried once
    // (D20: trg_40 takes FOR SHARE on the sheet).
    const write = () =>
      this.sb
        .from('time_entries')
        .update(patch)
        .eq('id', entryId)
        .eq('updated_at', row.updated_at)
        .select(ENTRY_SELF_SELECT);
    let result = await write();
    if (result.error && isDeadlock(result.error)) result = await write();
    if (result.error) this.writeFail('update', result.error, alias);
    const updated = ((result.data ?? []) as unknown as SelfRow[])[0];
    if (!updated) {
      throw timeError('STALE_REVISION', ENTRY_STALE_MESSAGE, {
        entry_id: row.id,
      });
    }

    // New boundaries invalidate the recorded work/break timeline; drop it rather than show stale segments.
    if (timesChanged) await this.clearSegments(entryId);
    // D61: ending a running timer by edit is a stop, so it clears "Timer still running" too (W2 review F3).
    if (endsTimer) {
      await this.notifications.timerStopped({
        id: updated.id,
        member_user_id: updated.member_user_id,
      });
    }
    return selfView(updated, false);
  }

  async remove(
    userId: string,
    entryId: string,
    o: { native?: boolean; alias?: boolean } = {},
  ): Promise<void> {
    const alias = o.alias ? { native: o.native === true } : null;
    await this.authority.assertOwnEntry(userId, entryId);
    // trg_40 refuses a locked entry (TIME_ENTRY_LOCKED → 409 TIMESHEET_LOCKED). Ungated (D27).
    const { data, error } = await this.sb
      .from('time_entries')
      .delete()
      .eq('id', entryId)
      .select('id, member_user_id, ended_at');
    if (error) this.writeFail('remove', error, alias);
    // D61: deleting a running timer ends it, so its "Timer still running" notice goes too (W2 review F3).
    const deleted = (
      (data ?? []) as Array<{
        id: string;
        member_user_id: string | null;
        ended_at: string | null;
      }>
    )[0];
    if (deleted && !deleted.ended_at) {
      await this.notifications.timerStopped({
        id: deleted.id,
        member_user_id: deleted.member_user_id,
      });
    }
  }

  // ── Reads ──────────────────────────────────────────────────────────────────────────────────────────────

  async getRunning(userId: string): Promise<TimeEntryView | null> {
    const { data, error } = await this.sb
      .from('time_entries')
      .select(ENTRY_SELF_SELECT)
      .eq('member_user_id', userId)
      .is('ended_at', null)
      .order('started_at', { ascending: false })
      .limit(1);
    if (error) this.readFail('getRunning', error);
    const row = ((data ?? []) as unknown as SelfRow[])[0];
    return row ? selfView(row, false) : null;
  }

  async get(viewerId: string, entryId: string): Promise<TimeEntryView> {
    const auth = await this.authority.assertViewEntry(viewerId, entryId);
    if (auth.member_user_id === viewerId) {
      const row = await this.loadSelf(entryId);
      if (!row) throw timeNotFound('entry');
      return selfView(row, await this.isBilled(row));
    }
    const withEmail = await this.isManagerView(viewerId, auth);
    const [view] = await this.authority.hydrate(viewerId, [auth], {
      withEmail,
    });
    if (!view) throw timeNotFound('entry');
    return view;
  }

  async listSegments(viewerId: string, entryId: string): Promise<SegmentRow[]> {
    await this.authority.assertViewEntry(viewerId, entryId);
    const { data, error } = await this.sb
      .from('time_entry_segments')
      .select(SEGMENT_SELECT)
      .eq('entry_id', entryId)
      .order('started_at', { ascending: true });
    if (error) this.readFail('listSegments', error);
    return (data ?? []) as unknown as SegmentRow[];
  }

  async listComments(viewerId: string, entryId: string): Promise<CommentRow[]> {
    const auth = await this.authority.assertViewEntry(viewerId, entryId);
    const own = auth.member_user_id === viewerId;
    const withEmail = own || (await this.isManagerView(viewerId, auth));
    const { data, error } = await this.sb
      .from('time_entry_comments')
      .select(withEmail ? COMMENT_SELECT_WITH_EMAIL : COMMENT_SELECT)
      .eq('entry_id', entryId)
      .order('created_at', { ascending: true });
    if (error) this.readFail('listComments', error);
    const comments = (data ?? []) as unknown as CommentRow[];
    if (own || !auth.member_user_id) return comments;

    // D32: a viewer who sees the entry's worker masked must not learn them from a comment byline.
    const visible = await this.authority.identityVisible(viewerId, [auth]);
    if (visible.has(auth.id)) return comments;
    return comments.map((c) =>
      c.author_user_id === auth.member_user_id
        ? { ...c, author_user_id: null, author: null }
        : c,
    );
  }

  async addComment(
    viewerId: string,
    entryId: string,
    body: string,
  ): Promise<CommentRow> {
    const auth = await this.authority.assertViewEntry(viewerId, entryId);
    const text = (body ?? '').trim();
    if (!text) throw new BadRequestException(EMPTY_COMMENT_MESSAGE);

    const { data, error } = await this.sb
      .from('time_entry_comments')
      .insert({ entry_id: entryId, author_user_id: viewerId, body: text })
      // The author is the caller, so their own email is fine to return.
      .select(COMMENT_SELECT_WITH_EMAIL)
      .single();
    if (error || !data) this.writeFail('addComment', error, null);
    const comment = data as unknown as CommentRow;
    // Awaited, never throws (D51); recipients are computed inside.
    await this.notifications.commentAdded(auth, comment, viewerId);
    return comment;
  }

  async listMine(
    userId: string,
    q: {
      from: string;
      to: string;
      project_id?: string;
      for?: LoggingForRequest | null;
      page: number;
      limit: number;
    },
  ): Promise<Paged<TimeEntryView>> {
    if (q.from > q.to) throw new BadRequestException(DATES_INVALID_MESSAGE);
    const page = Math.max(1, Math.trunc(q.page || 1));
    const limit = Math.min(200, Math.max(1, Math.trunc(q.limit || 100)));
    const tz = q.for
      ? await this.contextTimezone(userId, q.for, q.project_id ?? null)
      : await this.userTimezone(userId);
    const range = localRangeToUtc({ start: q.from, end: q.to }, tz);

    let query = this.sb
      .from('time_entries')
      .select(ENTRY_SELF_SELECT, { count: 'exact' })
      .eq('member_user_id', userId)
      .gte('started_at', range.fromIso)
      .lt('started_at', range.toExclusiveIso);
    if (q.project_id) query = query.eq('project_id', q.project_id);
    if (q.for) {
      query = query.eq('context_kind', q.for.kind);
      if (q.for.kind !== 'personal' && q.for.id) {
        query = query.eq('context_ref', q.for.id);
      }
    }
    const offset = (page - 1) * limit;
    const { data, error, count } = await query
      .order('started_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) this.readFail('listMine', error);
    const rows = (data ?? []) as unknown as SelfRow[];
    const billed = await this.billedIds(rows);
    return {
      items: rows.map((r) => selfView(r, billed.has(r.id))),
      total: typeof count === 'number' ? count : rows.length,
      page,
      limit,
    };
  }

  async mySummary(
    userId: string,
    q: { from: string; to: string },
  ): Promise<MySummary> {
    if (q.from > q.to) throw new BadRequestException(DATES_INVALID_MESSAGE);
    if (addDays(q.from, 366) < q.to) {
      throw new BadRequestException(SUMMARY_RANGE_MESSAGE);
    }
    const tz = await this.userTimezone(userId);
    const range = localRangeToUtc({ start: q.from, end: q.to }, tz);
    const rows = await this.summaryRows(userId, range);

    const byDay = new Map<string, number>();
    for (
      let d = q.from, n = 0;
      d <= q.to && n < MAX_SUMMARY_DAYS;
      d = addDays(d, 1), n++
    ) {
      byDay.set(d, 0);
    }
    const byContext = new Map<string, MySummary['by_context'][number]>();
    const byProject = new Map<string, MySummary['by_project'][number]>();
    const bySheet: MySummary['by_sheet_status'] = {
      open: 0,
      submitted: 0,
      returned: 0,
      approved: 0,
      personal: 0,
    };
    let total = 0;
    let payable = 0;

    for (const r of rows) {
      const seconds = Math.max(0, r.duration_seconds ?? 0);
      total += seconds;
      // Approved (CHANGE-5): frozen payable, never a rejected legacy row.
      if (
        r.payable_seconds !== null &&
        r.payable_seconds !== undefined &&
        r.legacy_status !== 'rejected'
      ) {
        payable += Math.max(0, r.payable_seconds);
      }
      const day = localDate(r.started_at, tz);
      byDay.set(day, (byDay.get(day) ?? 0) + seconds);

      const ctxKey = `${r.context_kind}|${(r.context_ref ?? '').toLowerCase()}`;
      const ctx = byContext.get(ctxKey) ?? {
        kind: r.context_kind,
        ref: r.context_kind === 'personal' ? null : r.context_ref,
        label:
          r.context_kind === 'personal'
            ? 'Just me'
            : (r.context_label_snapshot ?? 'Unknown'),
        total_seconds: 0,
      };
      ctx.total_seconds += seconds;
      byContext.set(ctxKey, ctx);

      const projKey = r.project_id ?? '';
      const proj = byProject.get(projKey) ?? {
        project_id: r.project_id,
        title: r.project?.title ?? null,
        total_seconds: 0,
      };
      proj.total_seconds += seconds;
      byProject.set(projKey, proj);

      const bucket: keyof MySummary['by_sheet_status'] =
        r.context_kind === 'personal'
          ? 'personal'
          : (r.timesheet?.status ?? 'open');
      bySheet[bucket] += seconds;
    }

    return {
      timezone: tz,
      from: q.from,
      to: q.to,
      total_seconds: total,
      payable_seconds: payable,
      by_day: [...byDay.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([date, total_seconds]) => ({ date, total_seconds })),
      by_context: [...byContext.values()].sort(
        (a, b) => b.total_seconds - a.total_seconds,
      ),
      by_project: [...byProject.values()].sort(
        (a, b) => b.total_seconds - a.total_seconds,
      ),
      by_sheet_status: bySheet,
    };
  }

  /** access.roadmap else 404 */
  async workItems(userId: string, projectId: string): Promise<WorkItemsResult> {
    const { data: project, error } = await this.sb
      .from('projects')
      .select('id, owner_id, workspace_id')
      .eq('id', projectId)
      .maybeSingle();
    if (error) {
      if (error.code === '22P02') throw timeNotFound('scope');
      this.readFail('workItems.project', error);
    }
    const p = project as {
      id: string;
      owner_id: string | null;
      workspace_id: string | null;
    } | null;
    if (!p) throw timeNotFound('scope');
    const perms =
      (await this.permissionsFor(userId, projectId)) ??
      (p.owner_id && p.owner_id === userId ? ROLE_DEFAULTS.owner : null);
    if (!perms || !getPermission(perms, 'access.roadmap')) {
      throw timeNotFound('scope');
    }

    const [tasks, hidden] = await Promise.all([
      this.projectTasks(projectId),
      this.hiddenPresets(p.workspace_id),
    ]);
    return {
      tasks,
      presets: PRESET_WORK_ITEMS.filter((preset) => !hidden.includes(preset)),
    };
  }

  // ── Preferences ────────────────────────────────────────────────────────────────────────────────────────

  async getPreferences(userId: string): Promise<UserTimePreferences | null> {
    const { data, error } = await this.sb
      .from('user_time_preferences')
      .select(PREFERENCES_SELECT)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) this.readFail('getPreferences', error);
    return (data as UserTimePreferences | null) ?? null;
  }

  async setPreferences(
    userId: string,
    input: { timezone: string; week_start?: number | null },
  ): Promise<UserTimePreferences> {
    if (!isValidTimezone(input.timezone)) {
      throw timeError('TIME_POLICY_INVALID', TIMEZONE_INVALID_MESSAGE);
    }
    const payload: Record<string, unknown> = {
      user_id: userId,
      timezone: input.timezone,
      updated_at: new Date().toISOString(),
    };
    // Omitted week_start keeps the stored one (merge on conflict); null clears it.
    if (input.week_start !== undefined) payload.week_start = input.week_start;
    const { data, error } = await this.sb
      .from('user_time_preferences')
      .upsert(payload, { onConflict: 'user_id' })
      .select(PREFERENCES_SELECT)
      .single();
    if (error || !data) this.writeFail('setPreferences', error, null);
    return data as UserTimePreferences;
  }

  /** insert only, never overwrites */
  async seedPreferences(userId: string, tz: string): Promise<void> {
    if (!userId || !isValidTimezone(tz)) return;
    // Best effort: a seed is a hint for later materialisation; it must never fail the read that carries it.
    try {
      const { error } = await this.sb
        .from('user_time_preferences')
        .upsert(
          { user_id: userId, timezone: tz },
          { onConflict: 'user_id', ignoreDuplicates: true },
        );
      if (error) {
        this.logger.warn(
          `seedPreferences(${userId}) failed: code=${error.code ?? 'none'}`,
        );
      }
    } catch (e) {
      this.logger.warn(
        `seedPreferences(${userId}) failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // ── Integration ────────────────────────────────────────────────────────────────────────────────────────

  /** rpc time_stop_running_entries */
  async stopRunningForProject(projectId: string): Promise<number> {
    const { data, error } = await this.sb
      .from('time_entries')
      .select('id, member_user_id')
      .eq('project_id', projectId)
      .is('ended_at', null);
    if (error) this.writeFail('stopRunningForProject.read', error, null);
    const running = (data ?? []) as Array<{
      id: string;
      member_user_id: string | null;
    }>;
    if (running.length === 0) return 0;

    const result = (await this.sb.rpc('time_stop_running_entries', {
      p_ids: running.map((r) => r.id),
      p_at: new Date().toISOString(),
    })) as RpcResult;
    if (result.error)
      this.writeFail('stopRunningForProject', result.error, null);
    // The stopped timers' "still running" notices go (D51: awaited, never throws).
    await Promise.all(
      running.map((r) =>
        this.notifications.timerStopped({
          id: r.id,
          member_user_id: r.member_user_id,
        }),
      ),
    );
    const stopped = numberOrNull(result.data as number | string | null);
    return stopped ?? running.length;
  }

  /**
   * D36/D46: per (member, team), the team_member_rates caps in force on each entry's local date in the team
   * policy timezone, and the member's team hours in that week (the policy's week start) or month, rejected
   * legacy rows excluded. Rows without a team cap are omitted from the map.
   */
  async capContext(
    rows: Array<
      Pick<
        TimeEntryView,
        | 'id'
        | 'member_user_id'
        | 'team_id'
        | 'project_id'
        | 'started_at'
        | 'context_kind'
      >
    >,
  ): Promise<Map<string, CapContext>> {
    const out = new Map<string, CapContext>();
    const teamRows = rows.filter(
      (r) => r.context_kind === 'team' && r.team_id && r.member_user_id,
    );
    if (teamRows.length === 0) return out;

    const teamPolicies = new Map<
      string,
      Promise<{ tz: string; weekStart: number }>
    >();
    const rateRows = new Map<string, Promise<TeamMemberRateRow[]>>();
    const sums = new Map<string, Promise<number>>();

    await Promise.all(
      teamRows.map(async (r) => {
        const teamId = r.team_id as string;
        const memberId = r.member_user_id as string;
        const basics = await memo(teamPolicies, teamId.toLowerCase(), () =>
          this.teamPolicyBasics(teamId, r.project_id),
        );
        const d = localDate(r.started_at, basics.tz);
        const memberRates = await memo(
          rateRows,
          `${teamId}|${memberId}`.toLowerCase(),
          () => this.memberRateRows(teamId, memberId),
        );
        const rate = pickMemberRateInForce(memberRates, r.project_id, d);
        if (!rate) return;
        const caps = memberCapsFromRate(rate);
        const windows = capWindows(caps, d, basics.weekStart);
        if (windows.length === 0) return;

        const scored = await Promise.all(
          windows.map(async (w) => {
            const seconds = await memo(
              sums,
              `${memberId}|${teamId}|${w.key}|${w.range.start}`.toLowerCase(),
              () =>
                this.teamWindowSeconds(memberId, teamId, w.range, basics.tz),
            );
            const hours = seconds / 3600;
            return { ...w, hours, over: hours > w.limitHours };
          }),
        );
        const chosen = pickWindow(scored);
        if (!chosen) return;
        out.set(r.id, {
          over_limit: chosen.over,
          limit_window: chosen.key,
          limit_hours: chosen.limitHours,
          logged_hours_in_window: round2(chosen.hours),
          overtime_requires_approval: caps.overtime_requires_approval,
          window_start: chosen.range.start,
          window_end: chosen.range.end,
        });
      }),
    );
    return out;
  }

  // ── Private: policy, caps and warnings ─────────────────────────────────────────────────────────────────

  /** The sheet scope and policy of the option a write lands on, resolved at `at` (with the team member layer). */
  private async optionPolicy(
    option: LoggingOption,
    memberId: string,
    projectId: string | null,
    at: Date,
  ): Promise<OptionPolicy> {
    if (option.kind === 'personal' || !option.id) {
      return { option, scope: null, policy: null, timezone: null };
    }
    // time_sheet_scope_for does not read the project for any kind; a severed entry passes null.
    const scope = await this.policy.sheetScopeFor(
      option.kind,
      option.id,
      projectId as string,
    );
    if (!scope) throw timeError('LOGGING_FOR_INVALID');
    const policy = await this.policy.resolve(
      { kind: scope.scope_kind, ref: scope.scope_ref },
      scope.policy_workspace_id,
      at,
      {
        memberUserId: memberId,
        ...(projectId ? { projectId } : {}),
        ...(option.kind === 'team' ? { teamId: option.id } : {}),
      },
    );
    return {
      option,
      scope,
      policy,
      timezone: safeTimezone(policy.timezone),
    };
  }

  /** 422 RETROACTIVE_WINDOW when the local start date is older than the policy allows (in the policy tz). */
  private assertRetroactive(op: OptionPolicy, startedAt: Date): void {
    if (!op.policy || !op.timezone) return;
    const floor = retroactiveFloor(
      new Date(),
      op.timezone,
      op.policy.retroactive_days,
    );
    if (floor && localDate(startedAt, op.timezone) < floor) {
      throw timeError('RETROACTIVE_WINDOW', undefined, {
        earliest_date: floor,
      });
    }
  }

  /** 'task' with a task; else the preset (hidden presets refused, L49); no preset and no task → 'other'. */
  private workItemFor(
    taskId: string | null,
    preset: PresetWorkItem | undefined,
    op: OptionPolicy,
  ): WorkItem {
    if (taskId) return 'task';
    if (!preset) return 'other';
    if (op.policy?.hidden_presets.includes(preset)) {
      throw timeError('WORK_ITEM_INVALID', HIDDEN_PRESET_MESSAGE);
    }
    return preset;
  }

  /**
   * D46: HOUR_CAP_EXCEEDED blocks only when the team member rate in force has overtime_requires_approval.
   * Windows per (member, team) in the team policy timezone and week start. A timer may not start once a window
   * is full; manual time may not push a window past its limit.
   */
  private async assertHourCap(
    memberId: string,
    op: OptionPolicy,
    at: Date,
    addSeconds: number,
    mode: 'start' | 'manual',
  ): Promise<void> {
    const caps = op.policy?.member;
    if (
      op.option.kind !== 'team' ||
      !op.option.id ||
      !op.policy ||
      !op.timezone ||
      !caps?.overtime_requires_approval
    ) {
      return;
    }
    const windows = capWindows(
      caps,
      localDate(at, op.timezone),
      op.policy.week_start,
    );
    for (const w of windows) {
      const logged =
        (await this.teamWindowSeconds(
          memberId,
          op.option.id,
          w.range,
          op.timezone,
        )) / 3600;
      const after = logged + Math.max(0, addSeconds) / 3600;
      const exceeded =
        mode === 'start'
          ? logged >= w.limitHours - CAP_EPSILON_HOURS
          : after > w.limitHours + CAP_EPSILON_HOURS;
      if (exceeded) {
        throw timeError('HOUR_CAP_EXCEEDED', undefined, {
          limit_window: w.key,
          limit_hours: w.limitHours,
          logged_hours: round2(logged),
          window_start: w.range.start,
          window_end: w.range.end,
        });
      }
    }
  }

  /** The contract weekly limit only warns (D46, L12): per (worker, governing engagement), engagement week. */
  private async contractWeekWarning(
    memberId: string,
    op: OptionPolicy,
    at: Date,
    addSeconds: number,
    mode: 'start' | 'manual',
  ): Promise<EntryWarning | null> {
    const limit = op.policy?.weekly_limit_minutes ?? null;
    if (
      op.option.kind !== 'assignment' ||
      !op.scope ||
      !op.policy ||
      !op.timezone ||
      limit === null ||
      limit <= 0
    ) {
      return null;
    }
    const week = weekWindow(localDate(at, op.timezone), op.policy.week_start);
    const range = localRangeToUtc(week, op.timezone);
    // The engagement's sheets of this member that touch the week; their entries are the engagement's time.
    const { data: sheets, error: sheetError } = await this.sb
      .from('timesheets')
      .select('id')
      .eq('member_user_id', memberId)
      .eq('scope_kind', 'engagement')
      .eq('scope_ref', op.scope.scope_ref)
      .lte('period_start', week.end)
      .gte('period_end', week.start);
    if (sheetError) this.readFail('contractWeek.sheets', sheetError);
    const sheetIds = ((sheets ?? []) as Array<{ id: string }>).map((s) => s.id);

    let loggedSeconds = 0;
    for (const part of chunks(sheetIds)) {
      const { data, error } = await this.sb
        .from('time_entries')
        .select('id, duration_seconds')
        .in('timesheet_id', part)
        .gte('started_at', range.fromIso)
        .lt('started_at', range.toExclusiveIso)
        .or('legacy_status.is.null,legacy_status.neq.rejected');
      if (error) this.readFail('contractWeek.entries', error);
      for (const r of (data ?? []) as Array<{
        duration_seconds: number | null;
      }>) {
        loggedSeconds += Math.max(0, r.duration_seconds ?? 0);
      }
    }
    const loggedMinutes = Math.round(
      (loggedSeconds + Math.max(0, addSeconds)) / 60,
    );
    const warn =
      mode === 'start' ? loggedMinutes >= limit : loggedMinutes > limit;
    return warn
      ? {
          code: 'CONTRACT_WEEKLY_LIMIT',
          limit_minutes: limit,
          logged_minutes: loggedMinutes,
        }
      : null;
  }

  /** E28: overlap is allowed and only warns. */
  private async overlapWarning(
    memberId: string,
    started: Date,
    ended: Date,
  ): Promise<EntryWarning | null> {
    const { data, error } = await this.sb
      .from('time_entries')
      .select('id')
      .eq('member_user_id', memberId)
      .lt('started_at', ended.toISOString())
      .or(`ended_at.is.null,ended_at.gt."${started.toISOString()}"`)
      .order('started_at', { ascending: true })
      .limit(20);
    if (error) this.readFail('overlap', error);
    const ids = ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
    return ids.length > 0 ? { code: 'OVERLAP', entry_ids: ids } : null;
  }

  /** Σ duration of the member's team-context entries for `teamId` started in the local window, not rejected. */
  private async teamWindowSeconds(
    memberId: string,
    teamId: string,
    window: LocalRange,
    tz: string,
  ): Promise<number> {
    const range = localRangeToUtc(window, tz);
    let total = 0;
    for (let offset = 0; offset < MAX_AGGREGATE_ROWS; offset += PAGE_ROWS) {
      const { data, error } = await this.sb
        .from('time_entries')
        .select('id, duration_seconds')
        .eq('member_user_id', memberId)
        .eq('context_kind', 'team')
        .eq('context_ref', teamId)
        .gte('started_at', range.fromIso)
        .lt('started_at', range.toExclusiveIso)
        .or('legacy_status.is.null,legacy_status.neq.rejected')
        .order('id', { ascending: true })
        .range(offset, offset + PAGE_ROWS - 1);
      if (error) this.readFail('teamWindow', error);
      const page = (data ?? []) as Array<{ duration_seconds: number | null }>;
      for (const r of page) total += Math.max(0, r.duration_seconds ?? 0);
      if (page.length < PAGE_ROWS) break;
    }
    return total;
  }

  /** The team policy's timezone and week start (capContext). */
  private async teamPolicyBasics(
    teamId: string,
    projectId: string | null,
  ): Promise<{ tz: string; weekStart: number }> {
    const scope = await this.policy.sheetScopeFor(
      'team',
      teamId,
      projectId as string,
    );
    const policy = await this.policy.resolve(
      scope
        ? { kind: scope.scope_kind, ref: scope.scope_ref }
        : { kind: 'team', ref: teamId },
      scope?.policy_workspace_id ?? null,
      new Date(),
    );
    return {
      tz: safeTimezone(policy.timezone),
      weekStart: policy.week_start || 1,
    };
  }

  /** Every team_member_rates row of (team, member); the in-force pick is the shared pure rule. */
  private async memberRateRows(
    teamId: string,
    memberId: string,
  ): Promise<TeamMemberRateRow[]> {
    const { data, error } = await this.sb
      .from('team_member_rates')
      .select(TEAM_MEMBER_RATE_SELECT)
      .eq('team_id', teamId)
      .eq('user_id', memberId);
    if (error) this.readFail('memberRates', error);
    return (data ?? []) as unknown as TeamMemberRateRow[];
  }

  /** The timezone a `for` filter reads dates in: its context's policy, else the caller's preference. */
  private async contextTimezone(
    userId: string,
    ref: LoggingForRequest,
    projectId: string | null,
  ): Promise<string> {
    if (ref.kind === 'personal' || !ref.id) return this.userTimezone(userId);
    if (ref.kind === 'team') return this.policy.teamTimezone(ref.id);
    if (ref.kind === 'workspace') return this.policy.workspaceTimezone(ref.id);
    try {
      const scope = await this.policy.sheetScopeFor(
        'assignment',
        ref.id,
        projectId as string,
      );
      if (!scope) return this.userTimezone(userId);
      const policy = await this.policy.resolve(
        { kind: scope.scope_kind, ref: scope.scope_ref },
        scope.policy_workspace_id,
        new Date(),
      );
      return safeTimezone(policy.timezone);
    } catch (e) {
      // An unknown assignment id is a filter that matches nothing; never a 422 that confirms the id.
      if (e instanceof HttpException && e.getStatus() === 422) {
        return this.userTimezone(userId);
      }
      throw e;
    }
  }

  private async userTimezone(userId: string): Promise<string> {
    const prefs = await this.getPreferences(userId);
    return safeTimezone(prefs?.timezone);
  }

  /** Workspace policy hidden presets (only the workspace layer has them). */
  private async hiddenPresets(
    workspaceId: string | null,
  ): Promise<PresetWorkItem[]> {
    if (!workspaceId) return [];
    const policy = await this.policy.resolve(
      { kind: 'workspace', ref: workspaceId },
      workspaceId,
      new Date(),
    );
    return policy.hidden_presets ?? [];
  }

  // ── Private: rows ──────────────────────────────────────────────────────────────────────────────────────

  private async loadSelf(entryId: string): Promise<SelfRow | null> {
    const { data, error } = await this.sb
      .from('time_entries')
      .select(ENTRY_SELF_SELECT)
      .eq('id', entryId)
      .maybeSingle();
    if (error) {
      if (error.code === '22P02') return null;
      this.readFail('loadSelf', error);
    }
    return (data as unknown as SelfRow | null) ?? null;
  }

  private async loadTimer(entryId: string): Promise<TimerRow | null> {
    const { data, error } = await this.sb
      .from('time_entries')
      .select(TIMER_SELECT)
      .eq('id', entryId)
      .maybeSingle();
    if (error) {
      if (error.code === '22P02') return null;
      this.readFail('loadTimer', error);
    }
    return (data as TimerRow | null) ?? null;
  }

  private async summaryRows(
    userId: string,
    range: { fromIso: string; toExclusiveIso: string },
  ): Promise<SummaryRow[]> {
    const out: SummaryRow[] = [];
    for (let offset = 0; offset < MAX_AGGREGATE_ROWS; offset += PAGE_ROWS) {
      const { data, error } = await this.sb
        .from('time_entries')
        .select(
          'id, started_at, duration_seconds, payable_seconds, legacy_status, context_kind, context_ref, ' +
            'context_label_snapshot, project_id, project:projects!project_id(id, title), ' +
            'timesheet:timesheets!timesheet_id(status)',
        )
        .eq('member_user_id', userId)
        .gte('started_at', range.fromIso)
        .lt('started_at', range.toExclusiveIso)
        .order('started_at', { ascending: true })
        .order('id', { ascending: true })
        .range(offset, offset + PAGE_ROWS - 1);
      if (error) this.readFail('mySummary', error);
      const page = (data ?? []) as unknown as SummaryRow[];
      out.push(...page);
      if (page.length < PAGE_ROWS) break;
    }
    return out;
  }

  /** Reserved on an invoice (CHANGE-6). Paid and running rows never need the lookup. */
  private async isBilled(row: SelfRow): Promise<boolean> {
    const billed = await this.billedIds([row]);
    return billed.has(row.id);
  }

  private async billedIds(rows: SelfRow[]): Promise<Set<string>> {
    const ids = rows
      .filter(
        (r) => r.ended_at && !r.payout_id && r.legacy_status !== 'paid_outside',
      )
      .map((r) => r.id);
    const billed = new Set<string>();
    for (const part of chunks(ids)) {
      const { data, error } = await this.sb
        .from('invoice_time_entries')
        .select('entry_id')
        .in('entry_id', part);
      if (error) this.readFail('billed', error);
      for (const r of (data ?? []) as Array<{ entry_id: string }>) {
        billed.add(r.entry_id);
      }
    }
    return billed;
  }

  /** A team manager's view of a team-context entry carries emails (self and team-manager views only). */
  private async isManagerView(
    viewerId: string,
    auth: EntryAuthRow,
  ): Promise<boolean> {
    if (auth.context_kind !== 'team' || !auth.team_id) return false;
    return this.authority.isTeamManager(auth.team_id, viewerId);
  }

  /** The task's project and work type; null when the task (or its roadmap chain) does not exist. */
  private async taskContext(taskId: string): Promise<TaskContext | null> {
    const { data, error } = await this.sb
      .from('roadmap_tasks')
      .select(
        `work_type,
         feature:roadmap_features!roadmap_tasks_feature_id_fkey(
           epic:roadmap_epics!roadmap_features_epic_id_fkey(
             roadmap:roadmaps!roadmap_epics_roadmap_id_fkey(project_id)
           )
         )`,
      )
      .eq('id', taskId)
      .maybeSingle();
    if (error) {
      if (error.code === '22P02') return null;
      this.readFail('taskContext', error);
    }
    const row = data as unknown as {
      work_type: WorkType | null;
      feature: {
        epic: { roadmap: { project_id: string | null } | null } | null;
      } | null;
    } | null;
    const projectId = row?.feature?.epic?.roadmap?.project_id;
    if (!projectId) return null;
    return { project_id: projectId, work_type: row?.work_type ?? null };
  }

  /** The task must be on the entry's project (422 otherwise; its existence is never confirmed). */
  private async taskInProject(
    taskId: string,
    projectId: string,
  ): Promise<TaskContext> {
    const ctx = await this.taskContext(taskId);
    if (!ctx || !sameId(ctx.project_id, projectId)) {
      throw timeError('WORK_ITEM_INVALID', TASK_NOT_ON_PROJECT_MESSAGE);
    }
    return ctx;
  }

  /** The project's tasks, flat with their epic and feature titles (the picker). */
  private async projectTasks(projectId: string): Promise<ProjectTaskOption[]> {
    const { data, error } = await this.sb
      .from('roadmap_tasks')
      .select(
        `id, title, work_type, feature_id,
         feature:roadmap_features!roadmap_tasks_feature_id_fkey!inner(
           id, title, epic_id,
           epic:roadmap_epics!roadmap_features_epic_id_fkey!inner(
             id, title,
             roadmap:roadmaps!roadmap_epics_roadmap_id_fkey!inner(project_id)
           )
         )`,
      )
      .eq('feature.epic.roadmap.project_id', projectId);
    if (error) this.readFail('projectTasks', error);
    const rows = (data ?? []) as unknown as Array<{
      id: string;
      title: string;
      work_type: WorkType | null;
      feature_id: string | null;
      feature: {
        id: string;
        title: string | null;
        epic_id: string | null;
        epic: {
          id: string;
          title: string | null;
          roadmap: { project_id: string | null } | null;
        } | null;
      } | null;
    }>;
    return rows
      .filter((r) => sameId(r.feature?.epic?.roadmap?.project_id, projectId))
      .map((r) => ({
        id: r.id,
        title: r.title,
        work_type: r.work_type ?? 'real_work',
        feature_id: r.feature_id,
        feature_title: r.feature?.title ?? null,
        epic_id: r.feature?.epic?.id ?? null,
        epic_title: r.feature?.epic?.title ?? null,
      }));
  }

  private async displayNameSnapshot(userId: string): Promise<string | null> {
    const { data, error } = await this.sb
      .from('profiles')
      .select('display_name, first_name, last_name, email')
      .eq('id', userId)
      .maybeSingle();
    if (error) this.readFail('displayName', error);
    const p = data as {
      display_name: string | null;
      first_name: string | null;
      last_name: string | null;
      email: string | null;
    } | null;
    if (!p) return null;
    const composed = [p.first_name, p.last_name]
      .filter(Boolean)
      .join(' ')
      .trim();
    return p.display_name?.trim() || composed || p.email || null;
  }

  /** L58: an entry moves into an assignment only if it is not older than the assignment (no backfill). */
  private async assertAssignmentAdoptable(
    assignmentId: string,
    entryCreatedAt: string,
    startedIso: string,
  ): Promise<void> {
    if (!this.engagements) return;
    const assignment = await this.engagements.getAssignment(assignmentId);
    if (!assignment) throw timeError('LOGGING_FOR_INVALID');
    if (
      Date.parse(entryCreatedAt) < Date.parse(assignment.created_at) ||
      Date.parse(startedIso) < Date.parse(assignment.started_at)
    ) {
      throw timeError('LOGGING_FOR_INVALID', BEFORE_AGREEMENT_MESSAGE);
    }
  }

  // ── Private: segments (display only, best effort) ──────────────────────────────────────────────────────

  private async openSegment(
    entryId: string,
    kind: 'work' | 'break',
    startedAt: string,
  ): Promise<void> {
    const { error } = await this.sb
      .from('time_entry_segments')
      .insert({ entry_id: entryId, kind, started_at: startedAt });
    if (error) {
      this.logger.warn(
        `open ${kind} segment failed entry=${entryId} code=${error.code ?? 'none'}`,
      );
    }
  }

  private async closeOpenSegment(
    entryId: string,
    endedAt: string,
  ): Promise<void> {
    const { error } = await this.sb
      .from('time_entry_segments')
      .update({ ended_at: endedAt })
      .eq('entry_id', entryId)
      .is('ended_at', null);
    if (error) {
      this.logger.warn(
        `close segment failed entry=${entryId} code=${error.code ?? 'none'}`,
      );
    }
  }

  private async clearSegments(entryId: string): Promise<void> {
    const { error } = await this.sb
      .from('time_entry_segments')
      .delete()
      .eq('entry_id', entryId);
    if (error) {
      this.logger.warn(
        `clear segments failed entry=${entryId} code=${error.code ?? 'none'}`,
      );
    }
  }

  // ── Private: errors and inputs ─────────────────────────────────────────────────────────────────────────

  /** The stop instant: the client's (validated) or now. A system stop never ends before its start. */
  private stopInstant(
    timer: TimerRow,
    requested: string | undefined,
    system: boolean,
  ): string {
    const startMs = Date.parse(timer.started_at);
    const parsed = requested !== undefined ? parseInstant(requested) : null;
    if (requested !== undefined && !parsed) {
      throw new BadRequestException(RANGE_INVALID_MESSAGE);
    }
    const end = parsed ?? new Date();
    if (end.getTime() <= startMs) {
      // time_entries_end_after_start: a cron or assignment-end stop clamps, a person is told.
      if (system) return new Date(startMs + 1000).toISOString();
      throw new BadRequestException(RANGE_INVALID_MESSAGE);
    }
    return end.toISOString();
  }

  private isoOrBadRequest(value: string): string {
    const parsed = parseInstant(value);
    if (!parsed) throw new BadRequestException(RANGE_INVALID_MESSAGE);
    return parsed.toISOString();
  }

  /** The 409 trg_40 would raise, raised before any write (same body as mapTimeDbError's TIME_ENTRY_LOCKED). */
  private lockedError(
    entryId: string,
    lock: string,
    alias: { native: boolean } | null,
  ): HttpException {
    return timeError(
      'TIMESHEET_LOCKED',
      alias ? ALIAS_LOCKED_MESSAGE(alias.native) : undefined,
      { reason: 'entry', lock, entry_id: entryId },
    );
  }

  private async permissionsFor(userId: string, projectId: string) {
    try {
      return await this.projectAuth.resolvePermissions(userId, projectId);
    } catch (e) {
      if (e instanceof HttpException) throw e;
      // resolvePermissions throws the raw Postgres message; never send it (D55).
      this.logger.error(
        `resolvePermissions failed project=${projectId}: ${e instanceof Error ? e.message : String(e)}`,
      );
      throw new InternalServerErrorException({
        code: TIME_INTERNAL_CODE,
        message: READ_FAILED_MESSAGE,
      });
    }
  }

  /** Writes: time sentinels map (D50, D07), anything else is TIME_INTERNAL (D55). */
  private writeFail(
    operation: string,
    error: PgErrorLike | null | undefined,
    alias: { native: boolean } | null,
  ): never {
    const ctx: MapContext | undefined = alias ? { alias } : undefined;
    if (!error) {
      this.logger.error(`TimeEntriesService.${operation}: no row returned`);
      throw new InternalServerErrorException({
        code: TIME_INTERNAL_CODE,
        message: "Proyekto couldn't save this time. Try again.",
      });
    }
    throwTimeDb(error, ctx);
  }

  /** Reads: a sentinel maps as usual; anything else is a logged 500 with read copy and no Postgres text. */
  private readFail(operation: string, error: PgErrorLike): never {
    const mapped = mapTimeDbError(error);
    if (mapped) throw mapped;
    this.logger.error(
      `TimeEntriesService.${operation} failed: ${JSON.stringify({
        code: error.code ?? null,
        message: error.message ?? null,
        detail: error.details ?? null,
      })}`,
    );
    throw new InternalServerErrorException({
      code: TIME_INTERNAL_CODE,
      message: READ_FAILED_MESSAGE,
    });
  }
}
