import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import { ConsultantFinanceAccessService } from '../finance/consultant-finance-access.service';

interface MonthBucket {
  month: string; // YYYY-MM
  revenue: number;
  cost: number;
}

export interface CurrencyTotals {
  currency: string;
  revenue: number;
  cost: number;
  margin: number;
  margin_percent: number | null;
}

export interface ProjectFinancials {
  project_id: string;
  /** The project's own currency — the headline bucket. */
  currency: string;
  totals: CurrencyTotals & {
    company_share: number;
    team_pool: number;
    team_burn: number;
    pool_remaining: number;
  };
  /** Every currency seen (a project can mix), so nothing is summed across FX. */
  by_currency: CurrencyTotals[];
  /** Monthly revenue vs cost in the project currency, for the charts. */
  months: Array<{
    month: string;
    revenue: number;
    cost: number;
    margin: number;
    margin_percent: number | null;
  }>;
  economics: { company_percent: number; team_percent: number };
}

/**
 * Per-project profitability: revenue (issued/paid invoices) minus cost (billable
 * time-log fees at the member's internal rate), split by the company/team
 * economics.
 *
 * Cost is time-log fees, NOT payouts: payouts group a member's logs team-wide and
 * carry no project_id, so they can't be attributed to one project without
 * double-counting. Time-log fees ARE project-scoped and are the accurate per-
 * project cost — a payout is just the later realization of those same fees.
 *
 * Amounts are bucketed per currency and never summed across FX (the app has no
 * conversion). The headline totals use the project's own currency.
 */
@Injectable()
export class FinancialsService {
  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
    private readonly financeAccess: ConsultantFinanceAccessService,
  ) {}

  async getProjectFinancials(
    callerId: string,
    projectId: string,
    range?: { from?: string; to?: string },
  ): Promise<ProjectFinancials> {
    await this.financeAccess.assertProject(callerId, projectId);

    const [project, economics, invoices, logs] = await Promise.all([
      this.getProject(projectId),
      this.getEconomics(projectId),
      this.getRevenueRows(projectId, range),
      this.getCostRows(projectId, range),
    ]);

    const projectCurrency = (project?.currency ?? 'USD').toUpperCase();

    // Per-currency revenue/cost.
    const byCurrency = new Map<string, { revenue: number; cost: number }>();
    const ensure = (c: string) => {
      const key = c.toUpperCase();
      if (!byCurrency.has(key)) byCurrency.set(key, { revenue: 0, cost: 0 });
      return byCurrency.get(key)!;
    };
    for (const inv of invoices) ensure(inv.currency).revenue += inv.amount;
    for (const log of logs) ensure(log.currency).cost += log.fee;

    const by_currency: CurrencyTotals[] = [...byCurrency.entries()]
      .map(([currency, v]) => this.toTotals(currency, v.revenue, v.cost))
      .sort((a, b) => b.revenue - a.revenue);

    // Monthly buckets in the project currency only (the chart is single-currency).
    const monthly = new Map<string, MonthBucket>();
    const bucket = (month: string) => {
      if (!monthly.has(month))
        monthly.set(month, { month, revenue: 0, cost: 0 });
      return monthly.get(month)!;
    };
    for (const inv of invoices) {
      if (inv.currency.toUpperCase() === projectCurrency && inv.month) {
        bucket(inv.month).revenue += inv.amount;
      }
    }
    for (const log of logs) {
      if (log.currency.toUpperCase() === projectCurrency && log.month) {
        bucket(log.month).cost += log.fee;
      }
    }
    const months = [...monthly.values()]
      .sort((a, b) => a.month.localeCompare(b.month))
      .map((m) => ({
        month: m.month,
        revenue: round2(m.revenue),
        cost: round2(m.cost),
        margin: round2(m.revenue - m.cost),
        margin_percent: marginPercent(m.revenue, m.revenue - m.cost),
      }));

    const head =
      by_currency.find((c) => c.currency === projectCurrency) ??
      this.toTotals(projectCurrency, 0, 0);
    const teamPercent = economics?.team_percent ?? 0;
    const companyPercent = economics?.company_percent ?? 0;
    const teamPool = round2((head.revenue * teamPercent) / 100);

    return {
      project_id: projectId,
      currency: projectCurrency,
      totals: {
        ...head,
        company_share: round2((head.revenue * companyPercent) / 100),
        team_pool: teamPool,
        team_burn: head.cost,
        pool_remaining: round2(teamPool - head.cost),
      },
      by_currency,
      months,
      economics: {
        company_percent: companyPercent,
        team_percent: teamPercent,
      },
    };
  }

  private toTotals(
    currency: string,
    revenue: number,
    cost: number,
  ): CurrencyTotals {
    const margin = revenue - cost;
    return {
      currency,
      revenue: round2(revenue),
      cost: round2(cost),
      margin: round2(margin),
      margin_percent: marginPercent(revenue, margin),
    };
  }

  private async getProject(
    projectId: string,
  ): Promise<{ currency: string | null } | null> {
    const { data } = await this.supabase
      .from('projects')
      .select('currency')
      .eq('id', projectId)
      .maybeSingle();
    return (data as { currency: string | null } | null) ?? null;
  }

  private async getEconomics(
    projectId: string,
  ): Promise<{ company_percent: number; team_percent: number } | null> {
    const { data } = await this.supabase
      .from('finance_project_settings')
      .select('company_percent, team_percent')
      .eq('project_id', projectId)
      .maybeSingle();
    if (!data) return null;
    const row = data as { company_percent: number; team_percent: number };
    return {
      company_percent: Number(row.company_percent ?? 0),
      team_percent: Number(row.team_percent ?? 0),
    };
  }

  /** Issued/sent/paid invoices — draft and void don't count as revenue. */
  private async getRevenueRows(
    projectId: string,
    range?: { from?: string; to?: string },
  ): Promise<
    Array<{ currency: string; amount: number; month: string | null }>
  > {
    let q = this.supabase
      .from('invoices')
      .select(
        'currency, total, period_start, period_end, issue_date, created_at',
      )
      .eq('project_id', projectId)
      .in('status', ['issued', 'sent', 'paid']);
    if (range?.from) q = q.gte('created_at', range.from);
    if (range?.to) q = q.lte('created_at', range.to);
    const { data, error } = await q;
    if (error) throw new Error(error.message);

    return (
      (data ?? []) as Array<{
        currency: string;
        total: string | number;
        period_start: string | null;
        issue_date: string | null;
        created_at: string;
      }>
    ).map((row) => ({
      currency: row.currency ?? 'USD',
      amount: Number(row.total ?? 0),
      // Attribute revenue to the covered period, else the issue/creation month.
      month: monthOf(row.period_start ?? row.issue_date ?? row.created_at),
    }));
  }

  /** Approved/paid real-work time logs, priced at the member's internal rate. */
  private async getCostRows(
    projectId: string,
    range?: { from?: string; to?: string },
  ): Promise<Array<{ currency: string; fee: number; month: string | null }>> {
    const rows: Array<{ currency: string; fee: number; month: string | null }> =
      [];
    const pageSize = 1000;
    let page = 0;
    // Page through — a busy project can exceed a single 1000-row window.
    for (;;) {
      let q = this.supabase
        .from('task_time_logs')
        .select(
          'currency_snapshot, duration_seconds, rate_snapshot, started_at',
        )
        .eq('project_id', projectId)
        .in('status', ['approved', 'paid'])
        .eq('work_type_snapshot', 'real_work')
        .order('started_at', { ascending: true })
        .range(page * pageSize, page * pageSize + pageSize - 1);
      if (range?.from) q = q.gte('started_at', range.from);
      if (range?.to) q = q.lte('started_at', range.to);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      const batch = (data ?? []) as Array<{
        currency_snapshot: string;
        duration_seconds: number | null;
        rate_snapshot: number | null;
        started_at: string;
      }>;
      for (const row of batch) {
        const hours = Math.max(0, Number(row.duration_seconds ?? 0)) / 3600;
        rows.push({
          currency: row.currency_snapshot ?? 'USD',
          fee: hours * Number(row.rate_snapshot ?? 0),
          month: monthOf(row.started_at),
        });
      }
      if (batch.length < pageSize) break;
      page += 1;
    }
    return rows;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function marginPercent(revenue: number, margin: number): number | null {
  if (!(revenue > 0)) return null;
  return Math.round((margin / revenue) * 1000) / 10; // one decimal
}

function monthOf(value: string | null): string | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})/.exec(value);
  return m ? `${m[1]}-${m[2]}` : null;
}
