// The hourly time cron (backend.md › Cron; POST /api/time/cron/run, Cloud Scheduler). Five idempotent jobs in
// order: (1) 24 h auto-stop, (2) 10 h notice, (3) auto-submit auto/self sheets, (4) finish auto/self sheets
// submitted without a freeze, (5) reminders on manual-route sheets.
//
// D52 budget: the global RequestTimeoutInterceptor aborts the response at 25 s, so the run stops starting new
// work after 20 s and answers `truncated: true`; each job acts on at most 200 rows per run, oldest first; the
// next hourly run continues where this one stopped (every job is idempotent). Each job gets a fair share of the
// time left when it starts, so a slow scan in job 3 can never starve jobs 4 and 5.
import { HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import { TIMESHEET_SELECT } from './time-entry.select';
import type { PgErrorLike } from './time-errors';
import { TimeEntriesService } from './time-entries.service';
import { TimeNotificationsService } from './time-notifications.service';
import {
  addDays,
  localDate,
  localRangeToUtc,
  safeTimezone,
} from './time-periods';
import { TimePolicyService } from './time-policy.service';
import { TimesheetsService, isTransitionRefusal } from './timesheets.service';
import type { ContextKind, TimesheetRow } from './time.types';

/** D52: rows acted on per job per run. */
export const TIME_CRON_BATCH = 200;
/** D52: the run stops starting new work after this much wall time. */
export const TIME_CRON_BUDGET_MS = 20_000;
/** Jobs 3 and 5 scan sheets whose period ended within this many days (reminder_days ≤ 14, plus slack). */
export const TIME_CRON_LOOKBACK_DAYS = 45;
/** L61 auto-stop and the 10 h notice (P08's LONG_TIMER_HOURS). */
const AUTO_STOP_HOURS = 24;
const LONG_TIMER_HOURS = 10;
const HOUR_MS = 3_600_000;
/** reminder_days ranges 0..14 (time_policies CHECK). */
const MAX_REMINDER_DAYS = 14;
/** Keeps the response small; every error is also logged. */
const MAX_ERRORS = 50;

/** A sheet the RPC refused for a reason the cron expects in a race: skipped, never an error (D52). */
const AUTO_SUBMIT_SKIP_REASONS = [
  'not_auto',
  'too_early',
  'running_entry',
  'empty',
  'state',
];
const FINISH_SKIP_REASONS = ['not_auto', 'running_entry', 'state'];

export interface TimeCronResult {
  auto_stopped: number;
  long_notified: number;
  auto_submitted: number;
  finished: number;
  reminders: number;
  errors: string[];
  truncated: boolean;
}

interface RunningRow {
  id: string;
  member_user_id: string | null;
  context_kind: ContextKind;
  team_id: string | null;
  started_at: string;
}

interface SheetStatsRow {
  timesheet_id: string | null;
  ended_at: string | null;
}

type RpcResult = { data: unknown; error: PgErrorLike | null };

/** Per-run state shared by the jobs (memoised lookups, the error list, the budget). */
class RunState {
  readonly result: TimeCronResult = {
    auto_stopped: 0,
    long_notified: 0,
    auto_submitted: 0,
    finished: 0,
    reminders: 0,
    errors: [],
    truncated: false,
  };
  /** time_sheet_routing_preview per sheet id (jobs 3 and 5). */
  readonly routes = new Map<string, Promise<string | null>>();
  /** reminder_days per (scope, policy workspace, period start, timezone). */
  readonly reminderDays = new Map<string, Promise<number>>();
  /** Entry counts per sheet id. */
  readonly stats = new Map<string, { entries: number; running: number }>();
  /** The current job's deadline (ms since epoch). */
  jobDeadline = 0;

  constructor(
    readonly now: Date,
    readonly runDeadline: number,
  ) {}

  /** True when the current job must stop starting new work. */
  outOfTime(): boolean {
    if (Date.now() >= this.jobDeadline) {
      this.result.truncated = true;
      return true;
    }
    return false;
  }

  error(message: string): void {
    if (this.result.errors.length < MAX_ERRORS) {
      this.result.errors.push(message);
    }
  }
}

/** The error code of a thrown error, never its Postgres text. */
function codeOf(error: unknown): string {
  if (error instanceof HttpException) {
    const body = error.getResponse();
    if (body && typeof body === 'object') {
      const b = body as { code?: unknown; reason?: unknown };
      if (typeof b.code === 'string') {
        return typeof b.reason === 'string' ? `${b.code}:${b.reason}` : b.code;
      }
    }
    return `HTTP_${error.getStatus()}`;
  }
  if (error instanceof Error && error.message.startsWith('TIME_CRON_DB:')) {
    return error.message;
  }
  return 'UNEXPECTED';
}

function isCode(error: unknown, code: string): boolean {
  if (!(error instanceof HttpException)) return false;
  const body = error.getResponse();
  return (
    !!body &&
    typeof body === 'object' &&
    (body as { code?: unknown }).code === code
  );
}

@Injectable()
export class TimeCronService {
  private readonly logger = new Logger(TimeCronService.name);

  constructor(
    @Inject(SUPABASE_ADMIN) private readonly sb: SupabaseClient,
    private readonly entries: TimeEntriesService,
    private readonly timesheets: TimesheetsService,
    private readonly policy: TimePolicyService,
    private readonly notifications: TimeNotificationsService,
  ) {}

  /** Five idempotent jobs in order; each catches its own errors and reports a count. D52: batch cap 200 per
   *  job, 20 s soft budget for the run, `truncated: true` when it stopped early. */
  async run(now?: Date): Promise<TimeCronResult> {
    const at = now ?? new Date();
    const state = new RunState(at, Date.now() + TIME_CRON_BUDGET_MS);
    const jobs: Array<[string, (s: RunState) => Promise<void>]> = [
      ['auto_stop', (s) => this.autoStop(s)],
      ['long_notice', (s) => this.longNotice(s)],
      ['auto_submit', (s) => this.autoSubmit(s)],
      ['finish', (s) => this.finish(s)],
      ['reminders', (s) => this.reminders(s)],
    ];
    for (let i = 0; i < jobs.length; i++) {
      const [name, job] = jobs[i];
      const left = state.runDeadline - Date.now();
      if (left <= 0) {
        state.result.truncated = true;
        break;
      }
      // Fair share of what is left: a job that finishes early hands its time to the jobs after it.
      state.jobDeadline = Date.now() + left / (jobs.length - i);
      try {
        await job(state);
      } catch (error) {
        this.logger.error(
          `time_cron_${name}_failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        state.error(`${name}: ${codeOf(error)}`);
      }
    }
    const r = state.result;
    this.logger.log(
      JSON.stringify({
        evt: 'time_cron_run',
        auto_stopped: r.auto_stopped,
        long_notified: r.long_notified,
        auto_submitted: r.auto_submitted,
        finished: r.finished,
        reminders: r.reminders,
        errors: r.errors.length,
        truncated: r.truncated,
      }),
    );
    return r;
  }

  // ── job 1: 24 h auto-stop (L61) ─────────────────────────────────────────────────────────────────────

  private async autoStop(state: RunState): Promise<void> {
    const cutoff = new Date(
      state.now.getTime() - AUTO_STOP_HOURS * HOUR_MS,
    ).toISOString();
    const { data, error } = await this.sb
      .from('time_entries')
      .select('id, member_user_id, context_kind, team_id, started_at')
      .is('ended_at', null)
      .lte('started_at', cutoff)
      .order('started_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(TIME_CRON_BATCH + 1);
    if (error) throw this.dbError('auto_stop', error);
    const rows = this.capped(state, (data ?? []) as unknown as RunningRow[]);

    for (const row of rows) {
      if (state.outOfTime()) return;
      try {
        await this.entries.stop(null, row.id, {
          system: true,
          endedAt: new Date(
            Date.parse(row.started_at) + AUTO_STOP_HOURS * HOUR_MS,
          ).toISOString(),
          flaggedReason: 'auto_stopped_24h',
        });
      } catch (err) {
        // Stopped by its member since the read: nothing to do.
        if (isCode(err, 'TIMER_NOT_RUNNING')) continue;
        this.rowError(state, 'auto_stop', row.id, err);
        continue;
      }
      state.result.auto_stopped += 1;
      // D51: never throws; it also clears the entry's 10 h notice.
      await this.notifications.timerAutoStopped(row, 'auto_stopped_24h');
    }
  }

  // ── job 2: the 10 h notice, once per entry ──────────────────────────────────────────────────────────

  private async longNotice(state: RunState): Promise<void> {
    const t = state.now.getTime();
    const { data, error } = await this.sb
      .from('time_entries')
      .select('id, member_user_id, context_kind, team_id, started_at')
      .is('ended_at', null)
      .lte('started_at', new Date(t - LONG_TIMER_HOURS * HOUR_MS).toISOString())
      .gt('started_at', new Date(t - AUTO_STOP_HOURS * HOUR_MS).toISOString())
      .order('started_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(TIME_CRON_BATCH + 1);
    if (error) throw this.dbError('long_notice', error);
    const rows = this.capped(state, (data ?? []) as unknown as RunningRow[]);

    for (const row of rows) {
      if (state.outOfTime()) return;
      const member = row.member_user_id;
      if (!member) continue;
      try {
        // Redis marker or bell row: a notice the member deleted is not re-sent (W1 review F1).
        if (
          await this.notifications.hasNotified(
            member,
            'timer_running_long',
            'entry_id',
            row.id,
          )
        ) {
          continue;
        }
      } catch (err) {
        this.rowError(state, 'long_notice', row.id, err);
        continue;
      }
      await this.notifications.timerRunningLong(row);
      state.result.long_notified += 1;
    }
  }

  // ── job 3: auto-submit (L33) ────────────────────────────────────────────────────────────────────────

  /** Open sheets with entries and none running whose local date reached period_end + max(reminder_days, 1),
   *  pre-filtered with time_sheet_routing_preview to auto/self routes (D52, CC11): a manual-route sheet is
   *  never frozen. One `auto_submit` per sheet, so one refusal never sinks the others. */
  private async autoSubmit(state: RunState): Promise<void> {
    // A submitted sheet leaves the `open` filter, so the next page's offset skips it.
    await this.scanSheets(state, ['open'], true, async (sheet) => {
      const stats = state.stats.get(sheet.id);
      if (!stats || stats.entries === 0 || stats.running > 0) return false;
      const today = localDate(state.now, safeTimezone(sheet.timezone));
      if (today < addDays(sheet.period_end, 1)) return false;
      if (today < addDays(sheet.period_end, MAX_REMINDER_DAYS)) {
        const days = await this.reminderDaysFor(state, sheet);
        if (today < addDays(sheet.period_end, Math.max(days, 1))) return false;
      }
      const route = await this.routeFor(state, sheet.id);
      if (route !== 'auto' && route !== 'self') return false;

      try {
        await this.timesheets.act(null, 'auto_submit', [sheet.id], null);
      } catch (err) {
        // A race the preview could not see (a decider added, a timer started): skipped, not an error.
        if (isTransitionRefusal(err, AUTO_SUBMIT_SKIP_REASONS)) return false;
        this.rowError(state, 'auto_submit', sheet.id, err);
        return false;
      }
      state.result.auto_submitted += 1;
      return true;
    });
  }

  // ── job 4: finish auto/self sheets submitted without a freeze ───────────────────────────────────────

  /** e.g. `submit_on_deletion` (delete_account cannot compute a TypeScript freeze), or a chained submit whose
   *  freeze was not sent. The RPC accepts a NULL actor only on auto/self sheets (D09). */
  private async finish(state: RunState): Promise<void> {
    const { data, error } = await this.sb
      .from('timesheets')
      .select(TIMESHEET_SELECT)
      .eq('status', 'submitted')
      .in('approver_scope', ['auto', 'self'])
      .is('decided_at', null)
      .order('submitted_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(TIME_CRON_BATCH + 1);
    if (error) throw this.dbError('finish', error);
    const rows = this.capped(state, (data ?? []) as unknown as TimesheetRow[]);

    for (const sheet of rows) {
      if (state.outOfTime()) return;
      try {
        await this.timesheets.act(null, 'approve', [sheet.id], null);
      } catch (err) {
        if (isTransitionRefusal(err, FINISH_SKIP_REASONS)) continue;
        this.rowError(state, 'finish', sheet.id, err);
        continue;
      }
      state.result.finished += 1;
    }
  }

  // ── job 5: reminders ────────────────────────────────────────────────────────────────────────────────

  /** Manual-route open/returned sheets with entries, from period_end + reminder_days (> 0), once per sheet
   *  (`hasNotified`; `sheetSubmitted` clears the marker, so a returned sheet can be reminded again). */
  private async reminders(state: RunState): Promise<void> {
    // A reminded sheet stays open/returned, so it still counts in the next page's offset.
    await this.scanSheets(state, ['open', 'returned'], false, async (sheet) => {
      const member = sheet.member_user_id;
      if (!member) return false;
      const stats = state.stats.get(sheet.id);
      if (!stats || stats.entries === 0) return false;
      const today = localDate(state.now, safeTimezone(sheet.timezone));
      if (today < addDays(sheet.period_end, 1)) return false;
      const days = await this.reminderDaysFor(state, sheet);
      if (days <= 0 || today < addDays(sheet.period_end, days)) return false;
      if (sheet.status === 'open') {
        // auto/self sheets submit themselves (job 3); only manual routes are reminded.
        const route = await this.routeFor(state, sheet.id);
        if (route === null || route === 'auto' || route === 'self') {
          return false;
        }
      }
      try {
        if (
          await this.notifications.hasNotified(
            member,
            'timesheet_reminder',
            'timesheet_id',
            sheet.id,
          )
        ) {
          return false;
        }
      } catch (err) {
        this.rowError(state, 'reminders', sheet.id, err);
        return false;
      }
      await this.notifications.reminder(sheet);
      state.result.reminders += 1;
      return true;
    });
  }

  // ── shared ──────────────────────────────────────────────────────────────────────────────────────────

  /**
   * Pages through `statuses` sheets whose period ended in the lookback window, oldest first, calling `visit` per
   * sheet until the job's time share ends or it acted on TIME_CRON_BATCH sheets. `visit` answers whether it
   * acted; with `actedLeaves`, an acted sheet no longer matches the filter, so the next page's offset excludes it.
   */
  private async scanSheets(
    state: RunState,
    statuses: Array<'open' | 'returned'>,
    actedLeaves: boolean,
    visit: (sheet: TimesheetRow) => Promise<boolean>,
  ): Promise<void> {
    const todayUtc = localDate(state.now, 'UTC');
    // A sheet is due no earlier than period_end + 1 local day, and a local date is at most one day ahead of UTC.
    const latest = todayUtc;
    const earliest = addDays(todayUtc, -TIME_CRON_LOOKBACK_DAYS);
    let offset = 0;
    let acted = 0;
    for (;;) {
      if (state.outOfTime()) return;
      const { data, error } = await this.sb
        .from('timesheets')
        .select(TIMESHEET_SELECT)
        .in('status', statuses)
        .gte('period_end', earliest)
        .lte('period_end', latest)
        .order('period_end', { ascending: true })
        .order('id', { ascending: true })
        .range(offset, offset + TIME_CRON_BATCH - 1);
      if (error) throw this.dbError('scan_sheets', error);
      const page = (data ?? []) as unknown as TimesheetRow[];
      if (page.length === 0) return;
      await this.loadStats(
        state,
        page.map((s) => s.id),
      );

      let actedHere = 0;
      for (const sheet of page) {
        if (acted >= TIME_CRON_BATCH) {
          state.result.truncated = true;
          return;
        }
        if (state.outOfTime()) return;
        try {
          if (await visit(sheet)) {
            acted += 1;
            actedHere += 1;
          }
        } catch (err) {
          this.rowError(state, 'scan', sheet.id, err);
        }
      }
      if (page.length < TIME_CRON_BATCH) return;
      offset += page.length - (actedLeaves ? actedHere : 0);
    }
  }

  /** Entry and running counts for the sheets not counted yet this run. */
  private async loadStats(state: RunState, sheetIds: string[]): Promise<void> {
    const missing = sheetIds.filter((id) => !state.stats.has(id));
    for (let i = 0; i < missing.length; i += 100) {
      const part = missing.slice(i, i + 100);
      for (const id of part) state.stats.set(id, { entries: 0, running: 0 });
      for (let from = 0; ; from += 1000) {
        const { data, error } = await this.sb
          .from('time_entries')
          .select('id, timesheet_id, ended_at')
          .in('timesheet_id', part)
          .order('id', { ascending: true })
          .range(from, from + 999);
        if (error) throw this.dbError('sheet_stats', error);
        const rows = (data ?? []) as unknown as SheetStatsRow[];
        for (const r of rows) {
          const s = r.timesheet_id ? state.stats.get(r.timesheet_id) : null;
          if (!s) continue;
          s.entries += 1;
          if (!r.ended_at) s.running += 1;
        }
        if (rows.length < 1000) break;
      }
    }
  }

  /** reminder_days from the policy at period start (the instant the RPC resolves it at). */
  private reminderDaysFor(
    state: RunState,
    sheet: TimesheetRow,
  ): Promise<number> {
    const key = `${sheet.scope_kind}|${sheet.scope_ref}|${sheet.policy_workspace_id ?? ''}|${sheet.period_start}|${sheet.timezone}`;
    let pending = state.reminderDays.get(key);
    if (!pending) {
      const tz = safeTimezone(sheet.timezone);
      const at = new Date(
        localRangeToUtc(
          { start: sheet.period_start, end: sheet.period_start },
          tz,
        ).fromIso,
      );
      pending = this.policy
        .resolve(
          { kind: sheet.scope_kind, ref: sheet.scope_ref },
          sheet.policy_workspace_id,
          at,
        )
        .then((p) => {
          const n = Number(p.reminder_days);
          return Number.isFinite(n) ? n : 1;
        });
      state.reminderDays.set(key, pending);
    }
    return pending;
  }

  /** The approver scope a submit would route to now (time_sheet_routing_preview, D52), or null. */
  private routeFor(state: RunState, sheetId: string): Promise<string | null> {
    let pending = state.routes.get(sheetId);
    if (!pending) {
      pending = (async () => {
        const { data, error } = (await this.sb.rpc(
          'time_sheet_routing_preview',
          { p_timesheet_id: sheetId, p_action: 'auto_submit' },
        )) as RpcResult;
        if (error) throw this.dbError('routing_preview', error);
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
          return null;
        }
        const scope = (data as { approver_scope?: unknown }).approver_scope;
        return typeof scope === 'string' ? scope : null;
      })();
      state.routes.set(sheetId, pending);
    }
    return pending;
  }

  /** At most TIME_CRON_BATCH rows; one more means the job is truncated. */
  private capped<T>(state: RunState, rows: T[]): T[] {
    if (rows.length > TIME_CRON_BATCH) {
      state.result.truncated = true;
      return rows.slice(0, TIME_CRON_BATCH);
    }
    return rows;
  }

  private rowError(
    state: RunState,
    job: string,
    id: string,
    error: unknown,
  ): void {
    const code = codeOf(error);
    this.logger.warn(
      `time_cron_${job}_row_failed id=${id} code=${code}: ${error instanceof Error ? error.message : String(error)}`,
    );
    state.error(`${job}:${id}: ${code}`);
  }

  /** A logged error with the Postgres code only (the cron answer never carries Postgres text). */
  private dbError(op: string, error: PgErrorLike): Error {
    this.logger.error(
      `time_cron_${op}_db_failed code=${error.code ?? 'none'} message=${error.message ?? ''}`,
    );
    return new Error(`TIME_CRON_DB:${error.code ?? 'unknown'}`);
  }
}
