import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import { ConsultantFinanceProject } from './consultant-finance-access.service';
import {
  FinanceContractsQueryDto,
  FinanceFiltersDto,
  FinanceInvoicesQueryDto,
} from './dto/finance.dto';
import {
  type Aging,
  BILLED_STATUSES,
  agingBucket,
  collectedByInvoice,
  daysOverdue,
  emptyAging,
  endOfDay,
  round2,
  today,
} from './receivables';
import { TeamFinanceAccessService } from './team-finance-access.service';

interface TeamCurrencyAccumulator {
  revenue: number;
  collected: number;
  outstanding: number;
  invoice_count: number;
  overdue_amount: number;
  overdue_count: number;
  aging: Aging;
  project_ids: Set<string>;
}

interface TeamProjectAccumulator {
  revenue: number;
  collected: number;
  outstanding: number;
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

/**
 * The team administrator's ("HR") view of a team's project finances.
 *
 * Deliberately its own implementation rather than a parameterised
 * `FinanceService`: the consultant portfolio carries flexible/severed contract
 * arms and a delivery-cost side this surface must never have. Team finance is
 * strictly project-scoped and REVENUE-SIDE ONLY — cost and margin are the
 * owner's economics (talent rate snapshots), so the payloads carry `cost`,
 * `margin`, and `margin_percent` as null and never query `task_time_logs`.
 * The receivable arithmetic itself is shared through `receivables.ts` so both
 * surfaces agree to the peso.
 */
@Injectable()
export class TeamFinanceService {
  constructor(
    @Inject(SUPABASE_ADMIN) private readonly supabase: SupabaseClient,
    private readonly access: TeamFinanceAccessService,
  ) {}

  async listTeams(callerId: string) {
    return this.access.listAdministeredTeams(callerId);
  }

  async getPortfolio(
    callerId: string,
    teamId: string,
    filters: FinanceFiltersDto,
  ) {
    const projects = await this.access.listTeamProjects(
      callerId,
      teamId,
      filters,
    );
    if (projects.length === 0) {
      return { projects: [], totals_by_currency: [], as_of: today() };
    }

    const ids = projects.map((project) => project.id);
    let invoicesQuery = this.supabase
      .from('invoices')
      .select('id, project_id, currency, total, status, due_date')
      .in('project_id', ids)
      .in('status', BILLED_STATUSES);
    if (filters.from) {
      invoicesQuery = invoicesQuery.gte('issue_date', filters.from);
    }
    if (filters.to) {
      invoicesQuery = invoicesQuery.lte('issue_date', filters.to);
    }
    if (filters.currency) {
      invoicesQuery = invoicesQuery.eq(
        'currency',
        filters.currency.toUpperCase(),
      );
    }

    const [invoiceResult, contractResult] = await Promise.all([
      invoicesQuery,
      this.supabase
        .from('contracts')
        .select('id, project_id, status, version, updated_at')
        .in('project_id', ids)
        .eq('relationship_kind', 'client_services')
        .order('version', { ascending: false }),
    ]);
    if (invoiceResult.error) throw new Error(invoiceResult.error.message);
    if (contractResult.error) throw new Error(contractResult.error.message);

    const invoiceRows = (invoiceResult.data ?? []) as BilledInvoiceRow[];
    const paidByInvoice = await collectedByInvoice(this.supabase, invoiceRows);

    const currencies = new Map<string, TeamCurrencyAccumulator>();
    const perProject = new Map<string, TeamProjectAccumulator>();
    const projectById = new Map(
      projects.map((project) => [project.id, project]),
    );

    const ensureCurrency = (currency: string): TeamCurrencyAccumulator => {
      const key = currency.toUpperCase();
      const current = currencies.get(key) ?? {
        revenue: 0,
        collected: 0,
        outstanding: 0,
        invoice_count: 0,
        overdue_amount: 0,
        overdue_count: 0,
        aging: emptyAging(),
        project_ids: new Set<string>(),
      };
      currencies.set(key, current);
      return current;
    };
    const ensureProject = (projectId: string): TeamProjectAccumulator => {
      const current = perProject.get(projectId) ?? {
        revenue: 0,
        collected: 0,
        outstanding: 0,
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
        this.toProjectSummary(project, perProject.get(project.id), latestContract),
      ),
      totals_by_currency: [...currencies.entries()]
        .map(([currency, totals]) => ({
          currency,
          revenue: round2(totals.revenue),
          collected: round2(totals.collected),
          outstanding: round2(totals.outstanding),
          cost: null,
          margin: null,
          margin_percent: null,
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

  async listContracts(
    callerId: string,
    teamId: string,
    query: FinanceContractsQueryDto,
  ) {
    // Scoped by `finance.view_contracts`, not `finance.view`: the capability
    // implies the other but can be denied on its own, and the single-project
    // route (ContractsService.listByProject) has always honoured that deny.
    // Listing by team must not be the way around it.
    const projects = await this.access.listTeamProjects(
      callerId,
      teamId,
      query,
      'finance.view_contracts',
    );
    const projectById = new Map(
      projects.map((project) => [project.id, project]),
    );
    const projectIds = projects.map((project) => project.id);
    // Strictly project-scoped: a team surface has no severed/flexible arms —
    // relationship contracts with no project belong to their holders only.
    if (projectIds.length === 0) {
      return { items: [], total: 0, page: query.page, limit: query.limit };
    }

    const offset = (query.page - 1) * query.limit;
    let contractsQuery = this.supabase
      .from('contracts')
      .select(
        'id, project_id, project_title_snapshot, consultant_user_id, relationship_kind, scope_mode, engagement_id, contract_number, status, version, currency, billing_mode, fixed_fee, recurring_fee, client_hourly_rate, client_name, provider_name, service_start_date, service_end_date, created_at, updated_at',
        { count: 'exact' },
      )
      .in('project_id', projectIds)
      .order('updated_at', { ascending: false })
      .range(offset, offset + query.limit - 1);
    if (query.contract_status) {
      contractsQuery = contractsQuery.eq('status', query.contract_status);
    }
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

  async listInvoices(
    callerId: string,
    teamId: string,
    query: FinanceInvoicesQueryDto,
  ) {
    const projects = await this.access.listTeamProjects(
      callerId,
      teamId,
      query,
    );
    const projectById = new Map(
      projects.map((project) => [project.id, project]),
    );
    const projectIds = projects.map((project) => project.id);
    if (projectIds.length === 0) {
      return { items: [], total: 0, page: query.page, limit: query.limit };
    }

    const offset = (query.page - 1) * query.limit;
    let invoicesQuery = this.supabase
      .from('invoices')
      .select(
        'id, project_id, project_title_snapshot, contract_id, issuer_user_id, number, status, currency, total, origin, issue_date, due_date, period_start, period_end, created_at, updated_at',
        { count: 'exact' },
      )
      .in('project_id', projectIds)
      .order('updated_at', { ascending: false })
      .range(offset, offset + query.limit - 1);
    if (query.invoice_status) {
      invoicesQuery = invoicesQuery.eq('status', query.invoice_status);
    }
    // Drafts carry no issue_date yet, so each bound needs a created_at fallback
    // arm (see FinanceService.listInvoices for the rationale).
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
    totals: TeamProjectAccumulator | undefined,
    contracts: Map<string, { id: string; status: string; version: number }>,
  ) {
    return {
      ...project,
      currency: (project.currency ?? 'USD').toUpperCase(),
      revenue: round2(totals?.revenue ?? 0),
      collected: round2(totals?.collected ?? 0),
      outstanding: round2(totals?.outstanding ?? 0),
      cost: null,
      margin: null,
      margin_percent: null,
      invoice_count: totals?.invoice_count ?? 0,
      overdue_amount: round2(totals?.overdue_amount ?? 0),
      overdue_count: totals?.overdue_count ?? 0,
      latest_contract: contracts.get(project.id) ?? null,
    };
  }
}
