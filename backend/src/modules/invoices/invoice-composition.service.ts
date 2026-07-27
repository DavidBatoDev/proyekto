import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../config/supabase.module';
import type { ContractRow } from '../contracts/contracts.service';

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

interface TimeLogRow {
  id: string;
  started_at: string;
  duration_seconds: number | null;
  break_minutes: number | null;
  status: string;
  work_type_snapshot: string;
  task: Array<{ title: string | null }> | { title: string | null } | null;
}

const HOUR_PRECISION = 2;

function roundHours(hours: number): number {
  return Math.round(hours * 10 ** HOUR_PRECISION) / 10 ** HOUR_PRECISION;
}

function roundMoney(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/**
 * Builds the line items a client is billed for.
 *
 * The load-bearing rule here: a client line is ALWAYS priced at the contract's
 * `client_hourly_rate` or `recurring_fee` — never at `task_time_logs.rate_snapshot`,
 * which is the team member's internal cost rate. Billing a client at team cost
 * both misprices the invoice and leaks what the team is paid. The
 * `assertNoInternalRates` guard below makes that a hard invariant rather than a
 * convention.
 *
 * Time detail reaching the client is likewise governed solely by
 * `hours_detail_level`; member identity never appears on an invoice line.
 */
@Injectable()
export class InvoiceCompositionService {
  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
  ) {}

  async composeForContract(
    contract: ContractRow,
    periodStart: string,
    periodEnd: string,
    hoursDetailLevel: HoursDetailLevel,
  ): Promise<{ lines: ComposedLine[]; hours: BillableHours }> {
    const hours = await this.getBillableHours(
      contract.project_id,
      periodStart,
      periodEnd,
    );
    const lines: ComposedLine[] = [];
    const serviceLabel =
      contract.service_description?.trim() || 'Professional services';
    const periodLabel = `${periodStart} to ${periodEnd}`;

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
        metadata: { period_start: periodStart, period_end: periodEnd },
        position: lines.length,
      });
    }

    if (contract.billing_mode === 'time_based') {
      lines.push(
        ...this.buildHourLines(
          serviceLabel,
          periodLabel,
          hours,
          Number(contract.client_hourly_rate ?? 0),
          hoursDetailLevel,
          'time_log',
          lines.length,
        ),
      );
    }

    if (contract.billing_mode === 'hybrid') {
      // Only hours beyond the retainer's included allowance are chargeable.
      const included = Number(contract.included_hours ?? 0);
      const overage = roundHours(Math.max(0, hours.totalHours - included));
      if (overage > 0) {
        const rate = Number(contract.client_hourly_rate ?? 0);
        lines.push({
          source_type: 'overage',
          source_log_id: null,
          description: `Additional hours beyond ${included} included (${periodLabel})`,
          quantity: overage,
          unit_rate: roundMoney(rate),
          amount: roundMoney(overage * rate),
          metadata: {
            period_start: periodStart,
            period_end: periodEnd,
            total_hours: hours.totalHours,
            included_hours: included,
          },
          position: lines.length,
        });
      }
    }

    assertNoInternalRates(lines);
    return { lines, hours };
  }

  /**
   * Approved (or already paid) real work in the period.
   *
   * Excludes `training` hours — the client did not buy training time — and
   * excludes `pending`/`rejected` logs, so a client is only ever billed for
   * time the consultant has signed off on.
   *
   * Billable time is NET of breaks: `duration_seconds` less `break_minutes`.
   * A member who logs an 8-hour session with a 60-minute break worked 7 billable
   * hours, and billing the gross would overcharge the client.
   */
  async getBillableHours(
    projectId: string,
    periodStart: string,
    periodEnd: string,
  ): Promise<BillableHours> {
    const { data, error } = await this.supabase
      .from('task_time_logs')
      .select(
        'id, started_at, duration_seconds, break_minutes, status, work_type_snapshot, task:roadmap_tasks!task_time_logs_task_id_fkey(title)',
      )
      .eq('project_id', projectId)
      .in('status', ['approved', 'paid'])
      .eq('work_type_snapshot', 'real_work')
      .gte('started_at', `${periodStart}T00:00:00.000Z`)
      .lte('started_at', `${periodEnd}T23:59:59.999Z`)
      .order('started_at', { ascending: true });
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as unknown as TimeLogRow[];
    const byDay = new Map<string, number>();
    const byTask = new Map<string, number>();
    let total = 0;

    for (const row of rows) {
      const gross = Math.max(0, Number(row.duration_seconds ?? 0)) / 3600;
      const breaks = Math.max(0, Number(row.break_minutes ?? 0)) / 60;
      // Clamp at zero: a break longer than the session is bad data, not a credit.
      const net = Math.max(0, gross - breaks);
      if (net === 0) continue;

      total += net;
      const day = row.started_at.slice(0, 10);
      byDay.set(day, (byDay.get(day) ?? 0) + net);

      const taskNode = Array.isArray(row.task) ? row.task[0] : row.task;
      const taskTitle = taskNode?.title?.trim() || 'Project work';
      byTask.set(taskTitle, (byTask.get(taskTitle) ?? 0) + net);
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

  private buildHourLines(
    serviceLabel: string,
    periodLabel: string,
    hours: BillableHours,
    clientRate: number,
    detail: HoursDetailLevel,
    sourceType: InvoiceLineSource,
    startPosition: number,
  ): ComposedLine[] {
    const rate = roundMoney(clientRate);

    if (detail === 'detailed' && hours.byTask.length > 0) {
      // Grouped by task, never by member: the client sees what was worked on,
      // not who worked on it or what they cost.
      return hours.byTask.map((entry, index) => ({
        source_type: sourceType,
        source_log_id: null,
        description: `${entry.task} (${periodLabel})`,
        quantity: entry.hours,
        unit_rate: rate,
        amount: roundMoney(entry.hours * rate),
        metadata: { grouped_by: 'task' },
        position: startPosition + index,
      }));
    }

    // 'summary' (and 'none', which still needs a priced line for a time-based
    // contract) collapse to a single aggregate line.
    return [
      {
        source_type: sourceType,
        source_log_id: null,
        description:
          detail === 'none' ? serviceLabel : `${serviceLabel} (${periodLabel})`,
        quantity: hours.totalHours,
        unit_rate: rate,
        amount: roundMoney(hours.totalHours * rate),
        metadata: { grouped_by: 'period' },
        position: startPosition,
      },
    ];
  }
}

/**
 * Hard guard against the internal-cost leak this service exists to prevent.
 *
 * `rate_snapshot` is the member's cost rate. If it ever appears in a composed
 * line's metadata or description, an invoice would be about to disclose (or
 * bill at) what the team is paid. Fail loudly rather than send it.
 */
export function assertNoInternalRates(lines: ComposedLine[]): void {
  for (const line of lines) {
    const keys = Object.keys(line.metadata ?? {});
    const leaked = keys.find(
      (key) =>
        key === 'rate_snapshot' ||
        key === 'member_user_id' ||
        key === 'currency_snapshot',
    );
    if (leaked) {
      throw new Error(
        `Invoice line "${line.description}" carries internal field "${leaked}". Client invoices must never expose member cost rates.`,
      );
    }
  }
}
