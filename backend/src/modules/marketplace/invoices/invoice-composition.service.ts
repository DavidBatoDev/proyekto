import {
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import type { ContractRow } from '../contracts/contracts.service';
import {
  EngagementsService,
  pickRate,
  type EngagementTimeRateRow,
  type EngagementWorkType,
} from '../engagements/engagements.service';
import { TimePolicyService } from '../../execution/time/time-policy.service';
import { localDate, localRangeToUtc } from '../../execution/time/time-periods';
import { roundSeconds } from '../../execution/time/time-freeze';
import {
  throwTimeDb,
  timeError,
  type PgErrorLike,
} from '../../execution/time/time-errors';

export type InvoiceLineSource = 'manual' | 'time_log' | 'retainer' | 'overage';
export type HoursDetailLevel = 'none' | 'summary' | 'detailed';

export interface ComposedLine {
  source_type: InvoiceLineSource;
  source_log_id: string | null;
  description: string;
  quantity: number;
  unit_rate: number;
  amount: number;
  metadata: Record<string, unknown>;
  position: number;
}

export interface BillableHours {
  /** Total billable hours in the period, rounded to 2dp. */
  totalHours: number;
  /** Per-day totals, for `hours_detail_level = 'detailed'`. */
  byDay: Array<{ day: string; hours: number }>;
  /** Per-task totals, for `hours_detail_level = 'detailed'`. */
  byTask: Array<{ task: string; hours: number }>;
}

/** The invoice's billing period, local dates (inclusive). */
export interface BillingPeriod {
  start: string;
  end: string;
}

/**
 * One reserved (or candidate) entry, priced for the client. Internal: no field of it ever reaches a line
 * (lines carry only grouped totals at the client's price).
 */
export interface BillableEntry {
  entry_id: string;
  started_at: string;
  /** Local start date in the contract's policy timezone. */
  local_date: string;
  /** The roadmap task id, or `item:<work_item>` for a preset work item. */
  task_key: string;
  task_title: string;
  /** payable_seconds (re-rounded to the client engagement for two-engagement assignments). */
  bill_seconds: number;
  /** The client's hourly price for this entry (never the member's cost rate). */
  bill_rate: number;
  currency: string;
}

/** What a time-based/hybrid composition was built against; stored on every line it writes (verification). */
export interface TimeLineContext {
  mode: 'time_based' | 'hybrid';
  /** Hybrid allowance for the current period, hours. */
  includedHours: number;
  /** Effective client hours level (engagement: least(invoice, contract settings)). */
  detail: HoursDetailLevel;
  period: BillingPeriod;
  timezone: string;
  serviceLabel: string;
}

/** A stored invoice line as verification reads it. */
export interface VerifiableLine {
  source_type: string;
  quantity: number | string;
  metadata: Record<string, unknown> | null;
}

/** Stored in line metadata (jsonb): the composition context, so issue can verify without re-deriving it. */
interface StoredTimeContext {
  mode: 'time_based' | 'hybrid';
  detail: HoursDetailLevel;
  timezone: string;
  period_start: string;
  period_end: string;
  included_hours: number;
}

type BillingScope =
  | {
      kind: 'engagement';
      engagementId: string;
      assignmentIds: string[];
      providerTeamId: string | null;
    }
  | { kind: 'legacy'; teamId: string };

interface EntryRow {
  id: string;
  project_id: string | null;
  task_id: string | null;
  work_item: string | null;
  context_kind: string;
  team_id: string | null;
  engagement_assignment_id: string | null;
  started_at: string;
  payable_seconds: number | null;
  legacy_status: string | null;
  work_type_snapshot: string | null;
  task: Array<{ title: string | null }> | { title: string | null } | null;
}

interface ReservationRow {
  entry_id: string;
  bill_seconds: number | string;
  bill_rate: number | string;
  bill_amount: number | string;
  currency: string;
}

/** One scope arm of the candidate read (the eligibility filters are applied to every arm). */
interface EntryScopeFilter {
  contextKind: 'team' | 'assignment';
  teamId?: string;
  projectId?: string;
  assignmentIds?: string[];
}

/** Column hints only (§0): never a time-table FK name. */
const ENTRY_SELECT =
  'id, project_id, task_id, work_item, context_kind, team_id, engagement_assignment_id, started_at, ' +
  'payable_seconds, legacy_status, work_type_snapshot, task:roadmap_tasks!task_id(title)';

const HOUR_PRECISION = 2;
const PAGE_SIZE = 1000;
const IN_CHUNK = 100;
const INSERT_CHUNK = 500;
const DETAIL_RANK: Record<HoursDetailLevel, number> = {
  none: 0,
  summary: 1,
  detailed: 2,
};
const WORK_ITEM_LABEL: Record<string, string> = {
  meeting: 'Meetings',
  review: 'Reviews',
  admin: 'Admin',
  other: 'Project work',
};
const EMPTY_HOURS: BillableHours = { totalHours: 0, byDay: [], byTask: [] };

const AMBIGUOUS_CONTRACTS_MESSAGE =
  "Another hourly contract on this project bills the same team's hours. End or amend one of them first.";
const RESERVATION_MISMATCH_MESSAGE =
  'The hours on this invoice no longer match the approved time. Refresh the hours on the draft, then issue it.';

function roundHours(hours: number): number {
  return Math.round(hours * 10 ** HOUR_PRECISION) / 10 ** HOUR_PRECISION;
}

function roundMoney(amount: number): number {
  return Math.round(amount * 100) / 100;
}

function compareText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function chunks<T>(values: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size)
    out.push(values.slice(i, i + size));
  return out;
}

function asDetailLevel(value: unknown): HoursDetailLevel {
  return value === 'summary' || value === 'detailed' ? value : 'none';
}

function leastDetail(
  a: HoursDetailLevel,
  b: HoursDetailLevel,
): HoursDetailLevel {
  return DETAIL_RANK[a] <= DETAIL_RANK[b] ? a : b;
}

function taskTitleOf(row: EntryRow): string {
  const node = Array.isArray(row.task) ? row.task[0] : row.task;
  const title = node?.title?.trim();
  if (title) return title;
  return WORK_ITEM_LABEL[row.work_item ?? 'other'] ?? 'Project work';
}

function taskKeyOf(row: Pick<EntryRow, 'task_id' | 'work_item'>): string {
  return row.task_id ?? `item:${row.work_item ?? 'other'}`;
}

/** Approved, billable time (trg_invoice_time_entries_guard's predicate): the Approved predicate, non-personal,
 *  real work. `payable_seconds` comes from the timesheet freeze; never `time_entries.status` (§0). */
function isBillable(row: {
  payable_seconds: number | null;
  legacy_status: string | null;
  context_kind: string;
  work_type_snapshot: string | null;
}): boolean {
  return (
    row.payable_seconds !== null &&
    row.payable_seconds !== undefined &&
    row.legacy_status !== 'rejected' &&
    row.context_kind !== 'personal' &&
    (row.work_type_snapshot ?? 'real_work') === 'real_work'
  );
}

function storedContext(ctx: TimeLineContext): StoredTimeContext {
  return {
    mode: ctx.mode,
    detail: ctx.detail,
    timezone: ctx.timezone,
    period_start: ctx.period.start,
    period_end: ctx.period.end,
    included_hours: Number(ctx.includedHours) || 0,
  };
}

type Segment = 'hours' | 'overage' | 'earlier';
const SEGMENT_RANK: Record<Segment, number> = {
  hours: 0,
  overage: 1,
  earlier: 2,
};

/**
 * The hour lines a set of priced entries bills, and each entry's audit amount (pure; shared by compose and the
 * issue-time verification, so both group the same way).
 *
 * - Current-period entries (`local_date ≥ period.start`): time-based → hour lines; hybrid → the included allowance
 *   is consumed in `started_at`, id order (billed at 0), the rest is overage.
 * - "Earlier hours" (`local_date < period.start`, approved after their own period was invoiced) get their own
 *   lines, never against an allowance (E36).
 * - Grouping: `(task, bill_rate)` at `detailed`, `bill_rate` otherwise. Amount = round(Σ seconds/3600 × rate, 2)
 *   per line (L63, E74); never a person on a line.
 */
export function buildTimeLines(
  entries: BillableEntry[],
  ctx: TimeLineContext,
): { lines: ComposedLine[]; amounts: Map<string, number> } {
  const ordered = [...entries].sort(
    (a, b) =>
      compareText(a.started_at, b.started_at) ||
      compareText(a.entry_id, b.entry_id),
  );
  let allowance =
    ctx.mode === 'hybrid'
      ? Math.round(Math.max(0, Number(ctx.includedHours) || 0) * 3600)
      : 0;
  const detailed = ctx.detail === 'detailed';
  const amounts = new Map<string, number>();
  const groups = new Map<
    string,
    {
      segment: Segment;
      title: string;
      rate: number;
      seconds: number;
      order: number;
    }
  >();
  let currentSeconds = 0;

  ordered.forEach((entry, index) => {
    const rate = roundMoney(Number(entry.bill_rate) || 0);
    const seconds = Math.max(0, Math.round(Number(entry.bill_seconds) || 0));
    const earlier = entry.local_date < ctx.period.start;
    let chargeable = seconds;
    let segment: Segment;
    if (earlier) {
      segment = 'earlier';
    } else if (ctx.mode === 'hybrid') {
      currentSeconds += seconds;
      const consumed = Math.min(allowance, seconds);
      allowance -= consumed;
      chargeable = seconds - consumed;
      segment = 'overage';
    } else {
      currentSeconds += seconds;
      segment = 'hours';
    }
    amounts.set(entry.entry_id, roundMoney((chargeable / 3600) * rate));
    if (chargeable <= 0) return;

    const taskPart = detailed ? entry.task_key : '*';
    const key = `${segment}|${taskPart}|${rate.toFixed(2)}`;
    const group = groups.get(key);
    if (group) {
      group.seconds += chargeable;
    } else {
      groups.set(key, {
        segment,
        title: entry.task_title,
        rate,
        seconds: chargeable,
        order: index,
      });
    }
  });

  const periodLabel = `${ctx.period.start} to ${ctx.period.end}`;
  const included = Number(ctx.includedHours) || 0;
  const context = storedContext(ctx);

  const describe = (segment: Segment, title: string): string => {
    if (segment === 'earlier') {
      if (detailed) return `Earlier hours: ${title}`;
      return ctx.detail === 'summary'
        ? `Earlier hours (before ${ctx.period.start})`
        : 'Earlier hours';
    }
    if (segment === 'overage') {
      return detailed
        ? `${title}: additional hours beyond ${included} included (${periodLabel})`
        : `Additional hours beyond ${included} included (${periodLabel})`;
    }
    if (detailed) return `${title} (${periodLabel})`;
    return ctx.detail === 'none'
      ? ctx.serviceLabel
      : `${ctx.serviceLabel} (${periodLabel})`;
  };

  const sorted = [...groups.entries()].sort(
    ([, a], [, b]) =>
      SEGMENT_RANK[a.segment] - SEGMENT_RANK[b.segment] ||
      (detailed ? b.seconds - a.seconds : 0) ||
      a.order - b.order,
  );
  const lines = sorted.map(
    ([key, group], position): ComposedLine => ({
      source_type: group.segment === 'overage' ? 'overage' : 'time_log',
      source_log_id: null,
      description: describe(group.segment, group.title),
      quantity: roundHours(group.seconds / 3600),
      unit_rate: group.rate,
      amount: roundMoney((group.seconds / 3600) * group.rate),
      metadata: {
        grouped_by: detailed ? 'task' : 'period',
        period_start: ctx.period.start,
        period_end: ctx.period.end,
        time_key: key,
        time_context: context,
        ...(group.segment === 'earlier' ? { earlier: true } : {}),
        ...(group.segment === 'overage'
          ? {
              total_hours: roundHours(currentSeconds / 3600),
              included_hours: included,
            }
          : {}),
      },
      position,
    }),
  );
  return { lines, amounts };
}

/**
 * Builds the line items a client is billed for, and reserves the time they bill.
 *
 * The load-bearing rule here: a client line is ALWAYS priced at the client's price (the engagement's billing
 * rate in force, else the contract's `client_hourly_rate`, or `recurring_fee`) — never at an entry's
 * `rate_snapshot`, which is the team member's internal cost rate. Billing a client at team cost both misprices
 * the invoice and leaks what the team is paid. The `assertNoInternalRates` guard below makes that a hard
 * invariant rather than a convention.
 *
 * Reservation (CHANGE-6, L6): every billed entry gets one `invoice_time_entries` row (`UNIQUE(entry_id)`).
 * Compose inserts with ON CONFLICT (entry_id) DO NOTHING, re-reads by `invoice_id` and builds lines only from
 * what it won, so two concurrent drafts never bill the same entry. A reserved entry's sheet cannot be reopened.
 *
 * Time detail reaching the client is governed solely by the hours detail level; member identity never appears
 * on an invoice line. Composition never checks the plan (E59: `time_billable_invoices` is checked only where an
 * hourly contract is created or signed).
 */
@Injectable()
export class InvoiceCompositionService {
  private readonly logger = new Logger(InvoiceCompositionService.name);

  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
    private readonly engagements: EngagementsService,
    private readonly policy: TimePolicyService,
  ) {}

  /**
   * Lines for one invoice of `contract` over `period`, reserving the hours they bill under `invoiceId`.
   * Always starts by releasing the invoice's own reservations, so a recompose never keeps a stale set.
   * Retainer and fixed contracts never reserve (E73).
   */
  async composeForContract(
    contract: ContractRow,
    invoiceId: string,
    period: BillingPeriod,
    hoursDetailLevel: HoursDetailLevel,
  ): Promise<{ lines: ComposedLine[]; hours: BillableHours }> {
    if (!contract.project_id) {
      throw new BadRequestException(
        'A removed project cannot be used to recompose invoice hours.',
      );
    }
    await this.releaseReservations(invoiceId);

    const lines: ComposedLine[] = [];
    const serviceLabel =
      contract.service_description?.trim() || 'Professional services';
    const periodLabel = `${period.start} to ${period.end}`;

    if (
      contract.billing_mode === 'retainer' ||
      contract.billing_mode === 'hybrid'
    ) {
      const fee = Number(contract.recurring_fee ?? 0);
      lines.push({
        source_type: 'retainer',
        source_log_id: null,
        description:
          hoursDetailLevel === 'none'
            ? serviceLabel
            : `${serviceLabel} (${periodLabel})`,
        quantity: 1,
        unit_rate: roundMoney(fee),
        amount: roundMoney(fee),
        metadata: { period_start: period.start, period_end: period.end },
        position: lines.length,
      });
    }

    const mode = contract.billing_mode;
    if (mode !== 'time_based' && mode !== 'hybrid') {
      assertNoInternalRates(lines);
      return { lines, hours: EMPTY_HOURS };
    }

    const scope = await this.resolveScope(contract);
    const timezone = await this.policy.workspaceTimezone(
      contract.workspace_id ??
        (await this.projectWorkspaceId(contract.project_id)),
    );
    const floor = await this.billingFloor(contract.id);
    const detail =
      scope.kind === 'engagement'
        ? leastDetail(
            hoursDetailLevel,
            asDetailLevel(
              (
                await this.engagements.settingsInForceOn(
                  scope.engagementId,
                  period.end,
                )
              )?.client_hours_detail_level,
            ),
          )
        : hoursDetailLevel;
    const ctx: TimeLineContext = {
      mode,
      includedHours: Number(contract.included_hours ?? 0),
      detail,
      period,
      timezone,
      serviceLabel,
    };

    const won = await this.reserve(contract, invoiceId, scope, ctx, floor);
    const { lines: timeLines } = buildTimeLines(won, ctx);
    const context = storedContext(ctx);
    // The time context rides on the retainer line too: a hybrid whose hours all fit the allowance has
    // reservations but no hour line, and issue verification still needs the context.
    for (const line of lines) {
      line.metadata = { ...line.metadata, time_context: context };
    }
    for (const line of timeLines) {
      lines.push({ ...line, position: lines.length });
    }
    if (mode === 'time_based' && timeLines.length === 0) {
      // Nothing billable yet: keep the priced zero line a time-based draft always had. No time_key, so
      // verification ignores it.
      const rate = roundMoney(Number(contract.client_hourly_rate ?? 0));
      lines.push({
        source_type: 'time_log',
        source_log_id: null,
        description:
          detail === 'none' ? serviceLabel : `${serviceLabel} (${periodLabel})`,
        quantity: 0,
        unit_rate: rate,
        amount: 0,
        metadata: {
          grouped_by: 'period',
          period_start: period.start,
          period_end: period.end,
          time_context: context,
        },
        position: lines.length,
      });
    }

    assertNoInternalRates(lines);
    return { lines, hours: summarizeHours(won) };
  }

  /** Deletes the invoice's reservations (recompose, attach_hours off). Refused by the guard once issued. */
  async releaseReservations(invoiceId: string): Promise<void> {
    const { error } = await this.supabase
      .from('invoice_time_entries')
      .delete()
      .eq('invoice_id', invoiceId);
    if (error) throwTimeDb(error as PgErrorLike);
  }

  /** Void and replace: the replacement draft takes over the voided invoice's reservations. Returns the count. */
  async moveReservations(
    fromInvoiceId: string,
    toInvoiceId: string,
  ): Promise<number> {
    const { data, error } = await this.supabase
      .from('invoice_time_entries')
      .update({ invoice_id: toInvoiceId })
      .eq('invoice_id', fromInvoiceId)
      .select('entry_id');
    if (error) throwTimeDb(error as PgErrorLike);
    return ((data ?? []) as unknown[]).length;
  }

  /**
   * Issue-time invariant (E37): every reserved entry is still approved billable time, and the invoice's hour
   * lines are exactly what its reservations bill — per line, round(Σ bill_seconds/3600, 2) = quantity.
   * trg_40 locks approved entries and reopen is refused while reserved, so a mismatch is an invariant failure:
   * it is logged and refused (409), and recomposing the draft repairs it. Hour lines with no `time_key`
   * (composed before reservations existed) are left as they are.
   */
  async verifyReservations(
    invoiceId: string,
    lines: VerifiableLine[],
  ): Promise<void> {
    const { data, error } = await this.supabase
      .from('invoice_time_entries')
      .select('entry_id, bill_seconds, bill_rate, bill_amount, currency')
      .eq('invoice_id', invoiceId);
    if (error) throwTimeDb(error as PgErrorLike);
    const rows = (data ?? []) as ReservationRow[];
    const keyed = lines.filter(
      (line) => typeof line.metadata?.time_key === 'string',
    );
    if (rows.length === 0 && keyed.length === 0) return;

    const stored = lines
      .map((line) => line.metadata?.time_context)
      .find(
        (value): value is StoredTimeContext =>
          value !== null && typeof value === 'object',
      );
    if (!stored) {
      throw this.mismatch(invoiceId, 'no_time_context', {
        reservations: rows.length,
      });
    }

    const entries = await this.entriesById(rows.map((row) => row.entry_id));
    const notBillable = rows
      .filter((row) => {
        const entry = entries.get(row.entry_id);
        return !entry || !isBillable(entry);
      })
      .map((row) => row.entry_id);
    if (notBillable.length > 0) {
      throw this.mismatch(invoiceId, 'entry_not_billable', {
        entry_ids: notBillable,
      });
    }

    const ctx: TimeLineContext = {
      mode: stored.mode === 'hybrid' ? 'hybrid' : 'time_based',
      includedHours: Number(stored.included_hours ?? 0),
      detail: asDetailLevel(stored.detail),
      period: { start: stored.period_start, end: stored.period_end },
      timezone: stored.timezone,
      serviceLabel: '',
    };
    const priced: BillableEntry[] = rows.map((row) => {
      const entry = entries.get(row.entry_id) as EntryRow;
      return {
        entry_id: row.entry_id,
        started_at: entry.started_at,
        local_date: localDate(entry.started_at, ctx.timezone),
        task_key: taskKeyOf(entry),
        task_title: '',
        bill_seconds: Number(row.bill_seconds),
        bill_rate: Number(row.bill_rate),
        currency: row.currency,
      };
    });
    const expected = new Map<string, number>();
    for (const line of buildTimeLines(priced, ctx).lines) {
      expected.set(String(line.metadata.time_key), line.quantity);
    }
    const actual = new Map<string, number>();
    for (const line of keyed) {
      const key = String(line.metadata?.time_key);
      actual.set(
        key,
        roundHours((actual.get(key) ?? 0) + Number(line.quantity)),
      );
    }
    const keys = new Set([...expected.keys(), ...actual.keys()]);
    const differing = [...keys].filter(
      (key) =>
        roundHours(expected.get(key) ?? 0) !== roundHours(actual.get(key) ?? 0),
    );
    if (differing.length > 0) {
      throw this.mismatch(invoiceId, 'line_quantity', { keys: differing });
    }
  }

  // ── reservation ─────────────────────────────────────────────────────────

  /**
   * Inserts the candidates with ON CONFLICT (entry_id) DO NOTHING, then returns only the rows this invoice
   * holds. One retry when the guard refuses a row (an entry reopened between the read and the insert).
   */
  private async reserve(
    contract: ContractRow,
    invoiceId: string,
    scope: BillingScope,
    ctx: TimeLineContext,
    floor: string | null,
  ): Promise<BillableEntry[]> {
    for (let attempt = 0; ; attempt++) {
      const candidates = await this.candidates(contract, scope, ctx, floor);
      if (candidates.length === 0) return [];
      const { amounts } = buildTimeLines(candidates, ctx);
      const rows = candidates.map((entry) => ({
        invoice_id: invoiceId,
        entry_id: entry.entry_id,
        contract_id: contract.id,
        bill_seconds: entry.bill_seconds,
        bill_rate: entry.bill_rate,
        bill_amount: amounts.get(entry.entry_id) ?? 0,
        currency: entry.currency,
      }));

      let failure: PgErrorLike | null = null;
      for (const chunk of chunks(rows, INSERT_CHUNK)) {
        const { error } = await this.supabase
          .from('invoice_time_entries')
          .upsert(chunk, { onConflict: 'entry_id', ignoreDuplicates: true });
        if (error) {
          failure = error as PgErrorLike;
          break;
        }
      }
      if (failure) {
        await this.releaseReservations(invoiceId);
        if (
          attempt === 0 &&
          (failure.message ?? '').startsWith('INVOICE_TIME_ENTRY_NOT_BILLABLE')
        ) {
          continue;
        }
        throwTimeDb(failure);
      }

      const { data, error } = await this.supabase
        .from('invoice_time_entries')
        .select('entry_id, bill_seconds, bill_rate, bill_amount, currency')
        .eq('invoice_id', invoiceId);
      if (error) throwTimeDb(error as PgErrorLike);
      const held = new Map<string, ReservationRow>(
        ((data ?? []) as ReservationRow[]).map(
          (row): [string, ReservationRow] => [row.entry_id, row],
        ),
      );
      const won = candidates
        .filter((entry) => held.has(entry.entry_id))
        .map((entry) => {
          const row = held.get(entry.entry_id) as ReservationRow;
          return {
            ...entry,
            bill_seconds: Number(row.bill_seconds),
            bill_rate: Number(row.bill_rate),
            currency: row.currency,
          };
        });
      if (won.length < candidates.length) {
        await this.syncAmounts(invoiceId, won, ctx, held);
      }
      return won;
    }
  }

  /** After a lost race the hybrid allowance falls differently: keep the audit amounts true to the won set. */
  private async syncAmounts(
    invoiceId: string,
    won: BillableEntry[],
    ctx: TimeLineContext,
    held: Map<string, ReservationRow>,
  ): Promise<void> {
    const { amounts } = buildTimeLines(won, ctx);
    for (const entry of won) {
      const amount = amounts.get(entry.entry_id) ?? 0;
      const row = held.get(entry.entry_id);
      if (!row || roundMoney(Number(row.bill_amount)) === amount) continue;
      const { error } = await this.supabase
        .from('invoice_time_entries')
        .update({ bill_amount: amount })
        .eq('invoice_id', invoiceId)
        .eq('entry_id', entry.entry_id);
      if (error) throwTimeDb(error as PgErrorLike);
    }
  }

  /**
   * Eligible, unreserved, priced entries of the contract's scope (L6, L7, L11): approved, non-personal, real
   * work, local start date (policy timezone) ≤ period end and ≥ the billing floor. Hours = payable_seconds.
   */
  private async candidates(
    contract: ContractRow,
    scope: BillingScope,
    ctx: TimeLineContext,
    floor: string | null,
  ): Promise<BillableEntry[]> {
    const until = localRangeToUtc(
      { start: ctx.period.end, end: ctx.period.end },
      ctx.timezone,
    ).toExclusiveIso;
    const from = floor
      ? localRangeToUtc({ start: floor, end: floor }, ctx.timezone).fromIso
      : null;

    let rows: EntryRow[] = [];
    if (scope.kind === 'legacy') {
      rows = await this.pagedEntries(
        {
          contextKind: 'team',
          teamId: scope.teamId,
          projectId: contract.project_id as string,
        },
        until,
        from,
      );
    } else {
      for (const ids of chunks(scope.assignmentIds, IN_CHUNK)) {
        rows.push(
          ...(await this.pagedEntries(
            { contextKind: 'assignment', assignmentIds: ids },
            until,
            from,
          )),
        );
      }
      if (scope.providerTeamId) {
        const teamRows = await this.pagedEntries(
          { contextKind: 'team', teamId: scope.providerTeamId },
          until,
          from,
        );
        const linked = new Map<string, boolean>();
        for (const projectId of new Set(
          teamRows.map((row) => row.project_id).filter(Boolean) as string[],
        )) {
          linked.set(
            projectId,
            await this.engagements.isLinkedToProject(
              scope.engagementId,
              projectId,
            ),
          );
        }
        rows.push(
          ...teamRows.filter(
            (row) => row.project_id && linked.get(row.project_id) === true,
          ),
        );
      }
    }

    const eligible = rows.filter((row) => {
      if (!isBillable(row) || Number(row.payable_seconds) <= 0) return false;
      const day = localDate(row.started_at, ctx.timezone);
      return day <= ctx.period.end && (!floor || day >= floor);
    });
    const reserved = await this.reservedElsewhere(
      eligible.map((row) => row.id),
    );
    const open = eligible.filter((row) => !reserved.has(row.id));
    return this.price(contract, scope, open, ctx.timezone);
  }

  /** Client price per entry (L9, CHANGE-23). */
  private async price(
    contract: ContractRow,
    scope: BillingScope,
    rows: EntryRow[],
    timezone: string,
  ): Promise<BillableEntry[]> {
    const fallbackRate = roundMoney(Number(contract.client_hourly_rate ?? 0));
    const currency = contract.currency;
    let billingRates: EngagementTimeRateRow[] = [];
    const settingsByDate = new Map<string, Promise<number>>();
    const twoEngagement = new Map<string, Promise<boolean>>();
    if (scope.kind === 'engagement' && rows.length > 0) {
      billingRates = await this.engagements.ratesFor(scope.engagementId, {
        rateKind: 'billing',
      });
    }
    const clientRounding = (day: string): Promise<number> => {
      if (scope.kind !== 'engagement') return Promise.resolve(0);
      let hit = settingsByDate.get(day);
      if (!hit) {
        hit = this.engagements
          .settingsInForceOn(scope.engagementId, day)
          .then((settings) => Number(settings?.rounding_minutes ?? 0));
        settingsByDate.set(day, hit);
      }
      return hit;
    };
    const isTwoEngagement = (assignmentId: string): Promise<boolean> => {
      let hit = twoEngagement.get(assignmentId);
      if (!hit) {
        hit = this.engagements
          .getAssignment(assignmentId)
          .then((a) =>
            Boolean(a?.talent_engagement_id && a?.client_engagement_id),
          );
        twoEngagement.set(assignmentId, hit);
      }
      return hit;
    };

    const priced: BillableEntry[] = [];
    for (const row of rows) {
      const day = localDate(row.started_at, timezone);
      let rate = fallbackRate;
      let rateCurrency = currency;
      let seconds = Math.round(Number(row.payable_seconds));
      if (scope.kind === 'engagement') {
        const pick = pickRate(
          billingRates,
          day,
          (row.work_type_snapshot ?? 'real_work') as EngagementWorkType,
        );
        // A month/fixed price in force: that day is billed by the retainer/fixed lines only (E61).
        if (pick && pick.unit !== 'hour') continue;
        if (pick) {
          rate = roundMoney(Number(pick.amount));
          rateCurrency = pick.currency ?? currency;
        }
        // Two-engagement assignments froze under the talent agreement; bill under the client's rounding.
        if (
          row.context_kind === 'assignment' &&
          row.engagement_assignment_id &&
          (await isTwoEngagement(row.engagement_assignment_id))
        ) {
          seconds = roundSeconds(seconds, await clientRounding(day));
        }
      }
      if (seconds <= 0) continue;
      priced.push({
        entry_id: row.id,
        started_at: row.started_at,
        local_date: day,
        task_key: taskKeyOf(row),
        task_title: taskTitleOf(row),
        bill_seconds: seconds,
        bill_rate: rate,
        currency: rateCurrency,
      });
    }
    return priced;
  }

  // ── scope (L7, L46) ─────────────────────────────────────────────────────

  /**
   * Engagement contract: (a) entries of the client engagement's assignments, (b) team entries of the provider
   * party's team on projects the engagement links. Legacy contract: team entries on the contract's project of
   * the provider seat's team. Never workspace, personal or other teams' time.
   */
  private async resolveScope(contract: ContractRow): Promise<BillingScope> {
    const engagement = await this.engagements.engagementForContract(
      contract.id,
    );
    if (engagement) {
      const [assignmentIds, providerTeamId] = await Promise.all([
        this.engagements.assignmentIdsForClientEngagement(engagement.id),
        this.engagements.providerPartyTeamId(engagement.id),
      ]);
      return {
        kind: 'engagement',
        engagementId: engagement.id,
        assignmentIds,
        providerTeamId,
      };
    }
    const teamId = await this.legacyProviderTeam(contract);
    await this.assertOnlyLegacyHourlyContract(contract);
    return { kind: 'legacy', teamId };
  }

  /**
   * The provider seat's `contract_positions.team_id`; else the one team the provider seat user owns (several
   * owned teams narrow to the ones attached to the project). None or several → LEGACY_CONTRACT_AMBIGUOUS.
   */
  private async legacyProviderTeam(contract: ContractRow): Promise<string> {
    const { data: seats, error: seatsError } = await this.supabase
      .from('contract_positions')
      .select('position, user_id, team_id')
      .eq('contract_id', contract.id);
    if (seatsError) throwTimeDb(seatsError as PgErrorLike);
    const provider = (
      (seats ?? []) as Array<{
        position: string;
        user_id: string;
        team_id: string | null;
      }>
    ).find((seat) => seat.position === 'provider');
    if (provider?.team_id) return provider.team_id;

    const providerUserId =
      provider?.user_id ?? contract.consultant_user_id ?? contract.created_by;
    if (!providerUserId) {
      throw timeError('LEGACY_CONTRACT_AMBIGUOUS', undefined, {
        reason: 'teams',
      });
    }
    const { data: owned, error: ownedError } = await this.supabase
      .from('teams')
      .select('id')
      .eq('owner_id', providerUserId);
    if (ownedError) throwTimeDb(ownedError as PgErrorLike);
    const ownedIds = ((owned ?? []) as Array<{ id: string }>).map(
      (team) => team.id,
    );
    if (ownedIds.length === 1) return ownedIds[0];
    if (ownedIds.length > 1) {
      const { data: attached, error: attachedError } = await this.supabase
        .from('project_teams')
        .select('team_id')
        .eq('project_id', contract.project_id as string)
        .in('team_id', ownedIds);
      if (attachedError) throwTimeDb(attachedError as PgErrorLike);
      const attachedIds = [
        ...new Set(
          ((attached ?? []) as Array<{ team_id: string }>).map(
            (row) => row.team_id,
          ),
        ),
      ];
      if (attachedIds.length === 1) return attachedIds[0];
    }
    throw timeError('LEGACY_CONTRACT_AMBIGUOUS', undefined, {
      reason: 'teams',
    });
  }

  /** Two live hourly (time_based or hybrid) legacy client contracts on one project would bill the same team. */
  private async assertOnlyLegacyHourlyContract(
    contract: ContractRow,
  ): Promise<void> {
    const { data, error } = await this.supabase
      .from('contracts')
      .select('id, contract_family_id')
      .eq('project_id', contract.project_id as string)
      .eq('status', 'signed')
      .eq('relationship_kind', 'client_services')
      .in('billing_mode', ['time_based', 'hybrid'])
      .is('engagement_id', null);
    if (error) throwTimeDb(error as PgErrorLike);
    const family = contract.contract_family_id ?? contract.id;
    const others = (
      (data ?? []) as Array<{ id: string; contract_family_id: string | null }>
    ).filter((row) => (row.contract_family_id ?? row.id) !== family);
    if (others.length === 0) return;
    const engaged = await Promise.all(
      others.map((row) => this.engagements.engagementForContract(row.id)),
    );
    if (engaged.some((engagement) => engagement === null)) {
      throw timeError(
        'LEGACY_CONTRACT_AMBIGUOUS',
        AMBIGUOUS_CONTRACTS_MESSAGE,
        {
          reason: 'contracts',
        },
      );
    }
  }

  // ── reads ───────────────────────────────────────────────────────────────

  /** Approved (payable frozen), real-work entries of one scope arm started before `until` (and from `from`). */
  private async pagedEntries(
    filter: EntryScopeFilter,
    until: string,
    from: string | null,
  ): Promise<EntryRow[]> {
    const out: EntryRow[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      let query = this.supabase
        .from('time_entries')
        .select(ENTRY_SELECT)
        .not('payable_seconds', 'is', null)
        .eq('work_type_snapshot', 'real_work')
        .eq('context_kind', filter.contextKind)
        .lt('started_at', until);
      if (from) query = query.gte('started_at', from);
      if (filter.teamId) query = query.eq('team_id', filter.teamId);
      if (filter.projectId) query = query.eq('project_id', filter.projectId);
      if (filter.assignmentIds) {
        query = query.in('engagement_assignment_id', filter.assignmentIds);
      }
      const { data, error } = await query
        .order('started_at', { ascending: true })
        .order('id', { ascending: true })
        .range(offset, offset + PAGE_SIZE - 1);
      if (error) throwTimeDb(error as PgErrorLike);
      const rows = (data ?? []) as unknown as EntryRow[];
      out.push(...rows);
      if (rows.length < PAGE_SIZE) return out;
    }
  }

  private async entriesById(ids: string[]): Promise<Map<string, EntryRow>> {
    const out = new Map<string, EntryRow>();
    for (const chunk of chunks([...new Set(ids)], IN_CHUNK)) {
      const { data, error } = await this.supabase
        .from('time_entries')
        .select(ENTRY_SELECT)
        .in('id', chunk);
      if (error) throwTimeDb(error as PgErrorLike);
      for (const row of (data ?? []) as unknown as EntryRow[]) {
        out.set(row.id, row);
      }
    }
    return out;
  }

  /** Entries already reserved (by another invoice: this one released its own first). */
  private async reservedElsewhere(ids: string[]): Promise<Set<string>> {
    const out = new Set<string>();
    for (const chunk of chunks(ids, IN_CHUNK)) {
      const { data, error } = await this.supabase
        .from('invoice_time_entries')
        .select('entry_id')
        .in('entry_id', chunk);
      if (error) throwTimeDb(error as PgErrorLike);
      for (const row of (data ?? []) as Array<{ entry_id: string }>) {
        out.add(row.entry_id);
      }
    }
    return out;
  }

  /** `greatest(service_start_date, first legacy_import)`; null = no floor. */
  private async billingFloor(contractId: string): Promise<string | null> {
    const response = await this.supabase.rpc('time_billing_floor', {
      p_contract_id: contractId,
    });
    const data: unknown = response.data;
    if (response.error) throwTimeDb(response.error as PgErrorLike);
    return typeof data === 'string' && data.length >= 10
      ? data.slice(0, 10)
      : null;
  }

  /** E36: a NULL `contracts.workspace_id` dates entries in the contract project's workspace timezone. */
  private async projectWorkspaceId(projectId: string): Promise<string | null> {
    const { data, error } = await this.supabase
      .from('projects')
      .select('workspace_id')
      .eq('id', projectId)
      .maybeSingle();
    if (error) throwTimeDb(error as PgErrorLike);
    return (
      (data as { workspace_id: string | null } | null)?.workspace_id ?? null
    );
  }

  /** Logs the invariant failure and returns the 409 to throw (the reason stays in the log). */
  private mismatch(
    invoiceId: string,
    reason: string,
    detail: Record<string, unknown>,
  ): HttpException {
    this.logger.error(
      `Invoice ${invoiceId} reservation check failed (${reason}): ${JSON.stringify(detail)}`,
    );
    return timeError(
      'INVOICE_TIME_ENTRY_NOT_BILLABLE',
      RESERVATION_MISMATCH_MESSAGE,
      { reason: 'reservation_mismatch' },
    );
  }
}

function summarizeHours(entries: BillableEntry[]): BillableHours {
  const byDay = new Map<string, number>();
  const byTask = new Map<string, number>();
  let total = 0;
  for (const entry of entries) {
    const hours = entry.bill_seconds / 3600;
    total += hours;
    byDay.set(entry.local_date, (byDay.get(entry.local_date) ?? 0) + hours);
    byTask.set(entry.task_title, (byTask.get(entry.task_title) ?? 0) + hours);
  }
  return {
    totalHours: roundHours(total),
    byDay: [...byDay.entries()]
      .map(([day, hours]) => ({ day, hours: roundHours(hours) }))
      .sort((a, b) => a.day.localeCompare(b.day)),
    byTask: [...byTask.entries()]
      .map(([task, hours]) => ({ task, hours: roundHours(hours) }))
      .sort((a, b) => b.hours - a.hours),
  };
}

/**
 * Field names that must never ride along on a client-facing invoice line.
 *
 * Two families: what a member COSTS (`rate_snapshot`, `member_user_id`), and
 * how the revenue is divided internally (`monthly_allocation`, `allocation`,
 * `team_pool`). Both would disclose margin to the client if they escaped.
 */
const INTERNAL_LINE_FIELDS = new Set([
  'rate_snapshot',
  'member_user_id',
  'currency_snapshot',
  'monthly_allocation',
  'allocation',
  'team_pool',
]);

/**
 * Hard guard against the internal-cost leak this service exists to prevent.
 *
 * If any of the fields above appears in a composed line's metadata, an invoice
 * would be about to disclose (or bill at) what the team is paid, or how the
 * budget splits. Fail loudly rather than send it.
 */
export function assertNoInternalRates(lines: ComposedLine[]): void {
  for (const line of lines) {
    const keys = Object.keys(line.metadata ?? {});
    const leaked = keys.find((key) => INTERNAL_LINE_FIELDS.has(key));
    if (leaked) {
      throw new Error(
        `Invoice line "${line.description}" carries internal field "${leaked}". Client invoices must never expose member cost rates.`,
      );
    }
  }
}
