import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../config/supabase.module';
import {
  FinanceContractsQueryDto,
  FinanceFiltersDto,
  FinanceInvoicesQueryDto,
} from './dto/finance.dto';
import {
  ConsultantFinanceAccessService,
  ConsultantFinanceProject,
} from './consultant-finance-access.service';

interface CurrencyAccumulator {
  revenue: number;
  collected: number;
  outstanding: number;
  cost: number;
  invoice_count: number;
  project_ids: Set<string>;
}

@Injectable()
export class FinanceService {
  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
    private readonly access: ConsultantFinanceAccessService,
  ) {}

  async getPortfolio(callerId: string, filters: FinanceFiltersDto) {
    const projects = await this.access.listProjects(callerId, filters);
    if (projects.length === 0) {
      return { projects: [], totals_by_currency: [] };
    }

    const ids = projects.map((project) => project.id);
    let invoicesQuery = this.supabase
      .from('invoices')
      .select('id, project_id, currency, total, status, created_at')
      .in('project_id', ids)
      .in('status', ['issued', 'partially_paid', 'paid']);
    let logsQuery = this.supabase
      .from('task_time_logs')
      .select(
        'project_id, currency_snapshot, duration_seconds, rate_snapshot, started_at',
      )
      .in('project_id', ids)
      .in('status', ['approved', 'paid'])
      .eq('work_type_snapshot', 'real_work');

    if (filters.from) {
      invoicesQuery = invoicesQuery.gte('created_at', filters.from);
      logsQuery = logsQuery.gte('started_at', filters.from);
    }
    if (filters.to) {
      invoicesQuery = invoicesQuery.lte('created_at', filters.to);
      logsQuery = logsQuery.lte('started_at', filters.to);
    }
    if (filters.currency) {
      invoicesQuery = invoicesQuery.eq(
        'currency',
        filters.currency.toUpperCase(),
      );
      logsQuery = logsQuery.eq(
        'currency_snapshot',
        filters.currency.toUpperCase(),
      );
    }

    const [invoiceResult, logResult, contractResult] = await Promise.all([
      invoicesQuery,
      logsQuery,
      this.supabase
        .from('contracts')
        .select('id, project_id, status, version, updated_at')
        .in('project_id', ids)
        .order('version', { ascending: false }),
    ]);
    if (invoiceResult.error) throw new Error(invoiceResult.error.message);
    if (logResult.error) throw new Error(logResult.error.message);
    if (contractResult.error) throw new Error(contractResult.error.message);

    const invoiceRows = (invoiceResult.data ?? []) as Array<{
      id: string;
      project_id: string;
      currency: string | null;
      total: string | number;
    }>;
    const invoiceIds = invoiceRows.map((row) => row.id);
    const { data: paymentData, error: paymentError } = invoiceIds.length
      ? await this.supabase
          .from('invoice_payments')
          .select('invoice_id, amount, reverses_payment_id')
          .in('invoice_id', invoiceIds)
      : { data: [], error: null };
    // The receivables migration can be deployed after the API during a staged
    // rollout. Existing portfolio reads must remain available until its table
    // reaches PostgREST's schema cache.
    if (paymentError && !isMissingReceivablesSchema(paymentError)) {
      throw new Error(paymentError.message);
    }
    const paidByInvoice = new Map<string, number>();
    for (const payment of (paymentData ?? []) as Array<{
      invoice_id: string;
      amount: string | number;
      reverses_payment_id: string | null;
    }>) {
      paidByInvoice.set(
        payment.invoice_id,
        (paidByInvoice.get(payment.invoice_id) ?? 0) +
          (payment.reverses_payment_id ? -Number(payment.amount) : Number(payment.amount)),
      );
    }

    const currencies = new Map<string, CurrencyAccumulator>();
    const perProject = new Map<
      string,
      { revenue: number; collected: number; outstanding: number; cost: number; invoice_count: number }
    >();
    const ensureCurrency = (currency: string): CurrencyAccumulator => {
      const key = currency.toUpperCase();
      const current = currencies.get(key) ?? {
        revenue: 0,
        collected: 0,
        outstanding: 0,
        cost: 0,
        invoice_count: 0,
        project_ids: new Set<string>(),
      };
      currencies.set(key, current);
      return current;
    };
    const ensureProject = (projectId: string) => {
      const current = perProject.get(projectId) ?? {
        revenue: 0,
        collected: 0,
        outstanding: 0,
        cost: 0,
        invoice_count: 0,
      };
      perProject.set(projectId, current);
      return current;
    };

    for (const project of projects) {
      ensureCurrency(project.currency ?? 'USD').project_ids.add(project.id);
      ensureProject(project.id);
    }

    for (const row of invoiceRows) {
      const projectId = String(row.project_id);
      const currency = String(row.currency ?? 'USD').toUpperCase();
      const amount = Number(row.total ?? 0);
      const bucket = ensureCurrency(currency);
      bucket.revenue += amount;
      const paid = Math.max(0, paidByInvoice.get(row.id) ?? 0);
      bucket.collected += paid;
      bucket.outstanding += Math.max(0, amount - paid);
      bucket.invoice_count += 1;
      bucket.project_ids.add(projectId);
      const project = projects.find((item) => item.id === projectId);
      if ((project?.currency ?? 'USD').toUpperCase() === currency) {
        const totals = ensureProject(projectId);
        totals.revenue += amount;
        totals.collected += paid;
        totals.outstanding += Math.max(0, amount - paid);
        totals.invoice_count += 1;
      }
    }

    for (const row of logResult.data ?? []) {
      const projectId = String(row.project_id);
      const currency = String(row.currency_snapshot ?? 'USD').toUpperCase();
      const cost =
        (Math.max(0, Number(row.duration_seconds ?? 0)) / 3600) *
        Number(row.rate_snapshot ?? 0);
      const bucket = ensureCurrency(currency);
      bucket.cost += cost;
      bucket.project_ids.add(projectId);
      const project = projects.find((item) => item.id === projectId);
      if ((project?.currency ?? 'USD').toUpperCase() === currency) {
        ensureProject(projectId).cost += cost;
      }
    }

    const latestContract = new Map<
      string,
      { id: string; status: string; version: number }
    >();
    for (const row of contractResult.data ?? []) {
      const projectId = String(row.project_id);
      if (!latestContract.has(projectId)) {
        latestContract.set(projectId, {
          id: String(row.id),
          status: String(row.status),
          version: Number(row.version ?? 1),
        });
      }
    }

    return {
      projects: projects.map((project) =>
        this.toProjectSummary(
          project,
          perProject.get(project.id),
          latestContract,
        ),
      ),
      totals_by_currency: [...currencies.entries()]
        .map(([currency, totals]) => ({
          currency,
          revenue: round2(totals.revenue),
          collected: round2(totals.collected),
          outstanding: round2(totals.outstanding),
          cost: round2(totals.cost),
          margin: round2(totals.revenue - totals.cost),
          margin_percent: marginPercent(
            totals.revenue,
            totals.revenue - totals.cost,
          ),
          invoice_count: totals.invoice_count,
          project_count: totals.project_ids.size,
        }))
        .sort((a, b) => a.currency.localeCompare(b.currency)),
    };
  }

  async listContracts(callerId: string, query: FinanceContractsQueryDto) {
    const projects = await this.access.listProjects(callerId, query);
    if (projects.length === 0) return { items: [], total: 0 };
    const projectById = new Map(
      projects.map((project) => [project.id, project]),
    );
    const offset = (query.page - 1) * query.limit;
    let contractsQuery = this.supabase
      .from('contracts')
      .select(
        'id, project_id, contract_number, status, version, currency, billing_mode, recurring_fee, client_name, service_start_date, service_end_date, created_at, updated_at',
        { count: 'exact' },
      )
      .in(
        'project_id',
        projects.map((project) => project.id),
      )
      .order('updated_at', { ascending: false })
      .range(offset, offset + query.limit - 1);
    if (query.contract_status) {
      contractsQuery = contractsQuery.eq('status', query.contract_status);
    }
    if (query.from)
      contractsQuery = contractsQuery.gte('updated_at', query.from);
    if (query.to) contractsQuery = contractsQuery.lte('updated_at', query.to);
    if (query.currency) {
      contractsQuery = contractsQuery.eq(
        'currency',
        query.currency.toUpperCase(),
      );
    }
    const { data, error, count } = await contractsQuery;
    if (error) throw new Error(error.message);
    return {
      items: (data ?? []).map((contract) => ({
        ...contract,
        project: projectById.get(String(contract.project_id)) ?? null,
      })),
      total: count ?? 0,
    };
  }

  async listInvoices(callerId: string, query: FinanceInvoicesQueryDto) {
    const projects = await this.access.listProjects(callerId, query);
    if (projects.length === 0) return { items: [], total: 0 };
    const projectById = new Map(
      projects.map((project) => [project.id, project]),
    );
    const offset = (query.page - 1) * query.limit;
    let invoicesQuery = this.supabase
      .from('invoices')
      .select(
        'id, project_id, contract_id, number, status, currency, total, origin, issue_date, due_date, period_start, period_end, created_at, updated_at',
        { count: 'exact' },
      )
      .in(
        'project_id',
        projects.map((project) => project.id),
      )
      .order('updated_at', { ascending: false })
      .range(offset, offset + query.limit - 1);
    if (query.invoice_status) {
      invoicesQuery = invoicesQuery.eq('status', query.invoice_status);
    }
    if (query.from) invoicesQuery = invoicesQuery.gte('created_at', query.from);
    if (query.to) invoicesQuery = invoicesQuery.lte('created_at', query.to);
    if (query.currency) {
      invoicesQuery = invoicesQuery.eq(
        'currency',
        query.currency.toUpperCase(),
      );
    }
    const { data, error, count } = await invoicesQuery;
    if (error) throw new Error(error.message);
    return {
      items: (data ?? []).map((invoice) => ({
        ...invoice,
        project: projectById.get(String(invoice.project_id)) ?? null,
      })),
      total: count ?? 0,
    };
  }

  private toProjectSummary(
    project: ConsultantFinanceProject,
    totals:
      | { revenue: number; collected: number; outstanding: number; cost: number; invoice_count: number }
      | undefined,
    contracts: Map<string, { id: string; status: string; version: number }>,
  ) {
    const revenue = totals?.revenue ?? 0;
    const cost = totals?.cost ?? 0;
    return {
      ...project,
      currency: (project.currency ?? 'USD').toUpperCase(),
      revenue: round2(revenue),
      collected: round2(totals?.collected ?? 0),
      outstanding: round2(totals?.outstanding ?? 0),
      cost: round2(cost),
      margin: round2(revenue - cost),
      margin_percent: marginPercent(revenue, revenue - cost),
      invoice_count: totals?.invoice_count ?? 0,
      latest_contract: contracts.get(project.id) ?? null,
    };
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function marginPercent(revenue: number, margin: number): number | null {
  if (!(revenue > 0)) return null;
  return Math.round((margin / revenue) * 1000) / 10;
}

function isMissingReceivablesSchema(error: { code?: string; message?: string }): boolean {
  return (
    error.code === 'PGRST205' ||
    error.message?.includes("Could not find the table 'public.invoice_payments'") === true
  );
}
