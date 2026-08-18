import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import {
  FinanceContractsQueryDto,
  FinanceFiltersDto,
  FinanceInvoicesQueryDto,
} from './dto/finance.dto';
import {
  ConsultantFinanceAccessService,
  ConsultantFinanceProject,
} from './consultant-finance-access.service';
import {
  type Aging,
  BILLED_STATUSES,
  agingBucket,
  collectedByInvoice,
  daysOverdue,
  emptyAging,
  endOfDay,
  marginPercent,
  round2,
  today,
} from './receivables';

interface CurrencyAccumulator {
  revenue: number;
  collected: number;
  outstanding: number;
  cost: number;
  invoice_count: number;
  overdue_amount: number;
  overdue_count: number;
  aging: Aging;
  project_ids: Set<string>;
}

interface ProjectAccumulator {
  revenue: number;
  collected: number;
  outstanding: number;
  cost: number;
  invoice_count: number;
  overdue_amount: number;
  overdue_count: number;
}

interface BilledInvoiceRow {
  id: string;
  project_id: string | null;
  currency: string | null;
  total: string | number;
  status: string;
  due_date: string | null;
}

@Injectable()
export class FinanceService {
  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
    private readonly access: ConsultantFinanceAccessService,
  ) {}

  async getPortfolio(callerId: string, filters: FinanceFiltersDto) {
    // P4a exposes severed contracts and invoices in their dedicated lists.
    // Folding them into portfolio totals needs an engagement-level bucket and
    // remains deferred to P4b.
    const projects = await this.access.listProjects(callerId, filters);
    if (projects.length === 0) {
      return { projects: [], totals_by_currency: [], as_of: today() };
    }

    const ids = projects.map((project) => project.id);
    let invoicesQuery = this.supabase
      .from('invoices')
      .select('id, project_id, currency, total, status, due_date')
      .in('project_id', ids)
      .in('status', BILLED_STATUSES);
    let logsQuery = this.supabase
      .from('task_time_logs')
      .select(
        'project_id, currency_snapshot, duration_seconds, rate_snapshot, started_at',
      )
      .in('project_id', ids)
      .in('status', ['approved', 'paid'])
      .eq('work_type_snapshot', 'real_work');

    // Revenue is dated by when it was BILLED, not by when the row happened to be
    // inserted. Every status in BILLED_STATUSES has been through issue(), which
    // stamps issue_date, so no fallback arm is needed on this query.
    if (filters.from) {
      invoicesQuery = invoicesQuery.gte('issue_date', filters.from);
      logsQuery = logsQuery.gte('started_at', filters.from);
    }
    if (filters.to) {
      invoicesQuery = invoicesQuery.lte('issue_date', filters.to);
      // started_at is a timestamptz: an inclusive end DATE has to reach the end
      // of that day, or every log after midnight on the last day disappears.
      logsQuery = logsQuery.lte('started_at', endOfDay(filters.to));
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
        .eq('relationship_kind', 'client_services')
        .order('version', { ascending: false }),
    ]);
    if (invoiceResult.error) throw new Error(invoiceResult.error.message);
    if (logResult.error) throw new Error(logResult.error.message);
    if (contractResult.error) throw new Error(contractResult.error.message);

    const invoiceRows = (invoiceResult.data ?? []) as BilledInvoiceRow[];
    const paidByInvoice = await collectedByInvoice(this.supabase, invoiceRows);

    const currencies = new Map<string, CurrencyAccumulator>();
    const perProject = new Map<string, ProjectAccumulator>();
    const projectById = new Map(
      projects.map((project) => [project.id, project]),
    );

    const ensureCurrency = (currency: string): CurrencyAccumulator => {
      const key = currency.toUpperCase();
      const current = currencies.get(key) ?? {
        revenue: 0,
        collected: 0,
        outstanding: 0,
        cost: 0,
        invoice_count: 0,
        overdue_amount: 0,
        overdue_count: 0,
        aging: emptyAging(),
        project_ids: new Set<string>(),
      };
      currencies.set(key, current);
      return current;
    };
    const ensureProject = (projectId: string): ProjectAccumulator => {
      const current = perProject.get(projectId) ?? {
        revenue: 0,
        collected: 0,
        outstanding: 0,
        cost: 0,
        invoice_count: 0,
        overdue_amount: 0,
        overdue_count: 0,
      };
      perProject.set(projectId, current);
      return current;
    };

    for (const project of projects) {
      ensureCurrency(project.currency ?? 'USD').project_ids.add(project.id);
      ensureProject(project.id);
    }

    const asOf = today();
    for (const row of invoiceRows) {
      const projectId = String(row.project_id);
      const currency = String(row.currency ?? 'USD').toUpperCase();
      const amount = Number(row.total ?? 0);
      const paid = paidByInvoice.get(row.id) ?? 0;
      const balance = Math.max(0, amount - paid);
      const bucket = agingBucket(row.due_date, asOf, balance);
      const overdue = balance > 0 && bucket !== 'current';

      const currencyTotals = ensureCurrency(currency);
      currencyTotals.revenue += amount;
      currencyTotals.collected += paid;
      currencyTotals.outstanding += balance;
      currencyTotals.invoice_count += 1;
      currencyTotals.aging[bucket] += balance;
      if (overdue) {
        currencyTotals.overdue_amount += balance;
        currencyTotals.overdue_count += 1;
      }
      currencyTotals.project_ids.add(projectId);

      // A project's own row only counts invoices raised in the project's own
      // currency; mixed-currency revenue stays visible in totals_by_currency.
      const project = projectById.get(projectId);
      if ((project?.currency ?? 'USD').toUpperCase() === currency) {
        const totals = ensureProject(projectId);
        totals.revenue += amount;
        totals.collected += paid;
        totals.outstanding += balance;
        totals.invoice_count += 1;
        if (overdue) {
          totals.overdue_amount += balance;
          totals.overdue_count += 1;
        }
      }
    }

    for (const row of (logResult.data ?? []) as Array<{
      project_id: string;
      currency_snapshot: string | null;
      duration_seconds: number | null;
      rate_snapshot: number | null;
    }>) {
      const projectId = String(row.project_id);
      const currency = String(row.currency_snapshot ?? 'USD').toUpperCase();
      const cost =
        (Math.max(0, Number(row.duration_seconds ?? 0)) / 3600) *
        Number(row.rate_snapshot ?? 0);
      const bucket = ensureCurrency(currency);
      bucket.cost += cost;
      bucket.project_ids.add(projectId);
      const project = projectById.get(projectId);
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
          overdue_amount: round2(totals.overdue_amount),
          overdue_count: totals.overdue_count,
          aging: {
            current: round2(totals.aging.current),
            d1_30: round2(totals.aging.d1_30),
            d31_60: round2(totals.aging.d31_60),
            d61_plus: round2(totals.aging.d61_plus),
          },
        }))
        .sort((a, b) => a.currency.localeCompare(b.currency)),
      as_of: asOf,
    };
  }

  async listContracts(callerId: string, query: FinanceContractsQueryDto) {
    const projects = await this.access.listProjects(callerId, query);
    const projectById = new Map(
      projects.map((project) => [project.id, project]),
    );
    const projectIds = projects.map((project) => project.id);
    const includeSevered = !query.project_id && !query.project_status;
    const { data: positionedContracts, error: positionedContractsError } =
      includeSevered
        ? await this.supabase
            .from('contract_positions')
            .select('contract_id')
            .eq('user_id', callerId)
            .eq('capacity', 'consultant')
        : { data: [], error: null };
    if (positionedContractsError) {
      throw new Error(positionedContractsError.message);
    }
    const positionedContractIds = includeSevered
      ? ((positionedContracts ?? []) as Array<{ contract_id: string }>).map(
          (row) => row.contract_id,
        )
      : [];
    // Nothing the caller can reach: return before building a query we would
    // only throw away.
    if (
      projectIds.length === 0 &&
      positionedContractIds.length === 0 &&
      !includeSevered
    ) {
      return { items: [], total: 0, page: query.page, limit: query.limit };
    }
    const offset = (query.page - 1) * query.limit;
    let contractsQuery = this.supabase
      .from('contracts')
      .select(
        'id, project_id, project_title_snapshot, consultant_user_id, relationship_kind, scope_mode, engagement_id, contract_number, status, version, currency, billing_mode, fixed_fee, recurring_fee, client_hourly_rate, client_name, provider_name, service_start_date, service_end_date, created_at, updated_at',
        { count: 'exact' },
      )
      .order('updated_at', { ascending: false })
      .range(offset, offset + query.limit - 1);
    const contractArms = [
      ...(projectIds.length > 0
        ? [`project_id.in.(${projectIds.join(',')})`]
        : []),
      ...(positionedContractIds.length > 0
        ? [`id.in.(${positionedContractIds.join(',')})`]
        : []),
      ...(includeSevered
        ? [`and(project_id.is.null,consultant_user_id.eq.${callerId})`]
        : []),
    ];
    if (contractArms.length === 0) {
      return { items: [], total: 0, page: query.page, limit: query.limit };
    }
    contractsQuery = contractsQuery.or(contractArms.join(','));
    if (query.contract_status) {
      contractsQuery = contractsQuery.eq('status', query.contract_status);
    }
    // Dated by when the agreement was raised. Filtering on updated_at made a
    // contract silently leave the range the moment anyone edited it.
    if (query.from) {
      contractsQuery = contractsQuery.gte('created_at', query.from);
    }
    if (query.to) {
      contractsQuery = contractsQuery.lte('created_at', endOfDay(query.to));
    }
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
      page: query.page,
      limit: query.limit,
    };
  }

  async listInvoices(callerId: string, query: FinanceInvoicesQueryDto) {
    const projects = await this.access.listProjects(callerId, query);
    const projectById = new Map(
      projects.map((project) => [project.id, project]),
    );
    const projectIds = projects.map((project) => project.id);
    const includeSevered = !query.project_id && !query.project_status;
    if (projectIds.length === 0 && !includeSevered) {
      return { items: [], total: 0, page: query.page, limit: query.limit };
    }
    const { data: seatedContracts, error: seatedContractsError } =
      includeSevered
        ? await this.supabase
            .from('contracts')
            .select('id')
            .or(
              `consultant_user_id.eq.${callerId},and(consultant_user_id.is.null,created_by.eq.${callerId})`,
            )
        : { data: [], error: null };
    if (seatedContractsError) {
      throw new Error(seatedContractsError.message);
    }
    const seatedContractIds = (
      (seatedContracts ?? []) as Array<{ id: string }>
    ).map((row) => row.id);
    const offset = (query.page - 1) * query.limit;
    let invoicesQuery = this.supabase
      .from('invoices')
      .select(
        'id, project_id, project_title_snapshot, contract_id, issuer_user_id, number, status, currency, total, origin, issue_date, due_date, period_start, period_end, created_at, updated_at',
        { count: 'exact' },
      )
      .order('updated_at', { ascending: false })
      .range(offset, offset + query.limit - 1);
    const severedArms = [
      `and(project_id.is.null,issuer_user_id.eq.${callerId})`,
      ...(seatedContractIds.length > 0
        ? [
            `and(project_id.is.null,contract_id.in.(${seatedContractIds.join(',')}))`,
          ]
        : []),
    ];
    if (projectIds.length > 0 && includeSevered) {
      invoicesQuery = invoicesQuery.or(
        `project_id.in.(${projectIds.join(',')}),${severedArms.join(',')}`,
      );
    } else if (projectIds.length > 0) {
      invoicesQuery = invoicesQuery.in('project_id', projectIds);
    } else {
      invoicesQuery = invoicesQuery.or(severedArms.join(','));
    }
    if (query.invoice_status) {
      invoicesQuery = invoicesQuery.eq('status', query.invoice_status);
    }
    // Drafts carry no issue_date yet, so each bound needs a created_at fallback
    // arm or every draft would vanish the moment a date is picked. Successive
    // .or() calls are ANDed together by PostgREST, which is what we want.
    if (query.from) {
      invoicesQuery = invoicesQuery.or(
        `issue_date.gte.${query.from},and(issue_date.is.null,created_at.gte.${query.from})`,
      );
    }
    if (query.to) {
      invoicesQuery = invoicesQuery.or(
        `issue_date.lte.${query.to},and(issue_date.is.null,created_at.lte.${endOfDay(query.to)})`,
      );
    }
    if (query.currency) {
      invoicesQuery = invoicesQuery.eq(
        'currency',
        query.currency.toUpperCase(),
      );
    }
    const { data, error, count } = await invoicesQuery;
    if (error) throw new Error(error.message);

    const rows = (data ?? []) as Array<
      BilledInvoiceRow & Record<string, unknown>
    >;
    // The portfolio renders this list, so it has to carry the same receivable
    // facts the detail endpoint does — otherwise nothing outside a single open
    // invoice can show a balance or an overdue flag.
    const paidByInvoice = await collectedByInvoice(
      this.supabase,
      rows.filter((row) => BILLED_STATUSES.includes(String(row.status))),
    );
    const asOf = today();

    return {
      items: rows.map((invoice) => {
        const total = Number(invoice.total ?? 0);
        const amountPaid = paidByInvoice.get(String(invoice.id)) ?? 0;
        const balanceDue =
          String(invoice.status) === 'void'
            ? 0
            : Math.max(0, total - amountPaid);
        return {
          ...invoice,
          total,
          project: projectById.get(String(invoice.project_id)) ?? null,
          amount_paid: round2(amountPaid),
          balance_due: round2(balanceDue),
          is_overdue:
            balanceDue > 0 &&
            agingBucket(invoice.due_date, asOf, balanceDue) !== 'current',
          days_overdue: daysOverdue(invoice.due_date, asOf),
        };
      }),
      total: count ?? 0,
      page: query.page,
      limit: query.limit,
    };
  }

  private toProjectSummary(
    project: ConsultantFinanceProject,
    totals: ProjectAccumulator | undefined,
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
      overdue_amount: round2(totals?.overdue_amount ?? 0),
      overdue_count: totals?.overdue_count ?? 0,
      latest_contract: contracts.get(project.id) ?? null,
    };
  }
}
