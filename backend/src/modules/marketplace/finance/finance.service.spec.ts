import type { SupabaseClient } from '@supabase/supabase-js';
import { FinanceService } from './finance.service';

function builderResult(data: unknown[]) {
  const builder: Record<string, unknown> = {};
  for (const method of [
    'select',
    'order',
    'range',
    'or',
    'in',
    'is',
    'eq',
    'neq',
    'not',
    'gte',
    'lte',
  ]) {
    builder[method] = jest.fn(() => builder);
  }
  builder.then = (resolve: (value: object) => void) =>
    Promise.resolve({ data, error: null, count: data.length }).then(resolve);
  return builder as Record<string, jest.Mock> & PromiseLike<unknown>;
}

const defaultQuery = {
  page: 1,
  limit: 25,
};

describe('FinanceService severed records', () => {
  it('lists live and caller-seated severed contracts in one filter', async () => {
    const contracts = builderResult([
      {
        id: 'contract-removed',
        project_id: null,
        project_title_snapshot: 'Removed Project',
      },
    ]);
    const positions = builderResult([{ contract_id: 'contract-removed' }]);
    const supabase = {
      from: jest.fn((table: string) =>
        table === 'contract_positions' ? positions : contracts,
      ),
    } as unknown as SupabaseClient;
    const access = {
      listProjects: jest
        .fn()
        .mockResolvedValue([
          { id: '11111111-1111-4111-8111-111111111111', title: 'Live' },
        ]),
    };
    const service = new FinanceService(supabase, access as never);

    const result = await service.listContracts(
      '22222222-2222-4222-8222-222222222222',
      defaultQuery,
    );

    expect(contracts.or).toHaveBeenCalledWith(
      'project_id.in.(11111111-1111-4111-8111-111111111111),id.in.(contract-removed),and(project_id.is.null,consultant_user_id.eq.22222222-2222-4222-8222-222222222222)',
    );
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        project: null,
        project_title_snapshot: 'Removed Project',
      }),
    );
  });

  it('includes severed invoices owned by a contract seat or issuer', async () => {
    const seatedContracts = builderResult([{ id: 'contract-seat-1' }]);
    const invoices = builderResult([
      {
        id: 'invoice-removed',
        project_id: null,
        project_title_snapshot: 'Removed Project',
      },
    ]);
    const supabase = {
      from: jest.fn((table: string) =>
        table === 'contracts' ? seatedContracts : invoices,
      ),
    } as unknown as SupabaseClient;
    const access = { listProjects: jest.fn().mockResolvedValue([]) };
    const service = new FinanceService(supabase, access as never);

    const result = await service.listInvoices('consultant-1', defaultQuery);

    expect(invoices.or).toHaveBeenCalledWith(
      'and(project_id.is.null,issuer_user_id.eq.consultant-1),and(project_id.is.null,contract_id.in.(contract-seat-1))',
    );
    expect(result.items[0]).toEqual(expect.objectContaining({ project: null }));
  });

  it('does not add severed records to a project-filtered request', async () => {
    const contracts = builderResult([]);
    const from = jest.fn(() => contracts);
    const supabase = {
      from,
    } as unknown as SupabaseClient;
    const access = { listProjects: jest.fn().mockResolvedValue([]) };
    const service = new FinanceService(supabase, access as never);

    const result = await service.listContracts('consultant-1', {
      ...defaultQuery,
      project_id: 'project-1',
    });

    expect(result).toEqual({ items: [], total: 0, page: 1, limit: 25 });
    expect(from).not.toHaveBeenCalled();
  });
});

describe('FinanceService receivables', () => {
  const CONSULTANT = '22222222-2222-4222-8222-222222222222';
  const PROJECT = '11111111-1111-4111-8111-111111111111';

  function daysAgo(days: number): string {
    return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  }

  function portfolioSupabase(
    invoices: unknown[],
    payments: unknown[],
    entries: unknown[] = [],
  ): {
    supabase: SupabaseClient;
    builders: Record<string, ReturnType<typeof builderResult>>;
  } {
    const builders = {
      invoices: builderResult(invoices),
      time_entries: builderResult(entries),
      contracts: builderResult([]),
      invoice_payments: builderResult(payments),
    };
    const supabase = {
      from: jest.fn(
        (table: string) =>
          builders[table as keyof typeof builders] ?? builderResult([]),
      ),
    } as unknown as SupabaseClient;
    return { supabase, builders };
  }

  function serviceFor(supabase: SupabaseClient) {
    const access = {
      listProjects: jest
        .fn()
        .mockResolvedValue([
          { id: PROJECT, title: 'Live', status: 'active', currency: 'PHP' },
        ]),
    };
    return new FinanceService(supabase, access as never);
  }

  it('counts a paid invoice with no payment ledger as collected', async () => {
    const { supabase } = portfolioSupabase(
      [
        {
          id: 'inv-1',
          project_id: PROJECT,
          currency: 'PHP',
          total: 15000,
          status: 'paid',
          due_date: daysAgo(90),
        },
      ],
      [],
    );

    const result = await serviceFor(supabase).getPortfolio(CONSULTANT, {});

    const php = result.totals_by_currency.find((t) => t.currency === 'PHP');
    expect(php).toEqual(
      expect.objectContaining({
        revenue: 15000,
        collected: 15000,
        outstanding: 0,
        overdue_amount: 0,
        overdue_count: 0,
      }),
    );
  });

  it('ages an unpaid invoice into the band matching its due date', async () => {
    const { supabase } = portfolioSupabase(
      [
        {
          id: 'inv-current',
          project_id: PROJECT,
          currency: 'PHP',
          total: 1000,
          status: 'issued',
          due_date: null,
        },
        {
          id: 'inv-45',
          project_id: PROJECT,
          currency: 'PHP',
          total: 2000,
          status: 'issued',
          due_date: daysAgo(45),
        },
        {
          id: 'inv-100',
          project_id: PROJECT,
          currency: 'PHP',
          total: 4000,
          status: 'issued',
          due_date: daysAgo(100),
        },
      ],
      [],
    );

    const result = await serviceFor(supabase).getPortfolio(CONSULTANT, {});

    const php = result.totals_by_currency.find((t) => t.currency === 'PHP');
    expect(php?.aging).toEqual({
      current: 1000,
      d1_30: 0,
      d31_60: 2000,
      d61_plus: 4000,
    });
    expect(php?.overdue_amount).toBe(6000);
    expect(php?.overdue_count).toBe(2);
  });

  it('subtracts reversals from the collected total', async () => {
    const { supabase } = portfolioSupabase(
      [
        {
          id: 'inv-1',
          project_id: PROJECT,
          currency: 'PHP',
          total: 10000,
          status: 'partially_paid',
          due_date: null,
        },
      ],
      [
        { invoice_id: 'inv-1', amount: 6000, reverses_payment_id: null },
        { invoice_id: 'inv-1', amount: 2000, reverses_payment_id: 'pay-1' },
      ],
    );

    const result = await serviceFor(supabase).getPortfolio(CONSULTANT, {});

    const php = result.totals_by_currency.find((t) => t.currency === 'PHP');
    expect(php?.collected).toBe(4000);
    expect(php?.outstanding).toBe(6000);
  });

  it('reaches the end of the day for an inclusive timestamptz bound', async () => {
    const { supabase, builders } = portfolioSupabase([], []);

    await serviceFor(supabase).getPortfolio(CONSULTANT, {
      from: '2026-08-01',
      to: '2026-08-18',
    });

    expect(builders.invoices.lte).toHaveBeenCalledWith(
      'issue_date',
      '2026-08-18',
    );
    expect(builders.time_entries.lte).toHaveBeenCalledWith(
      'started_at',
      '2026-08-18T23:59:59.999Z',
    );
  });

  it('prices cost from amount_snapshot of Approved real-work, non-personal time (CHANGE-5)', async () => {
    const { supabase, builders } = portfolioSupabase(
      [],
      [],
      [
        // Frozen at approval: 1.5 h payable × 500 = 750, whatever the logged duration was.
        {
          project_id: PROJECT,
          currency_snapshot: 'PHP',
          amount_snapshot: '750.00',
          started_at: '2026-08-03T01:00:00Z',
        },
        {
          project_id: PROJECT,
          currency_snapshot: 'PHP',
          amount_snapshot: 249.5,
          started_at: '2026-08-04T01:00:00Z',
        },
      ],
    );

    const result = await serviceFor(supabase).getPortfolio(CONSULTANT, {});

    const php = result.totals_by_currency.find((t) => t.currency === 'PHP');
    expect(php?.cost).toBe(999.5);
    const entries = builders.time_entries;
    expect(entries.select).toHaveBeenCalledWith(
      'project_id, currency_snapshot, amount_snapshot, started_at',
    );
    expect(entries.neq).toHaveBeenCalledWith('context_kind', 'personal');
    expect(entries.eq).toHaveBeenCalledWith('work_type_snapshot', 'real_work');
    expect(entries.not).toHaveBeenCalledWith('payable_seconds', 'is', null);
    expect(entries.not).toHaveBeenCalledWith('amount_snapshot', 'is', null);
    expect(entries.or).toHaveBeenCalledWith(
      'legacy_status.is.null,legacy_status.neq.rejected',
    );
    // Never the entry status (it drops in M5).
    expect(entries.in).not.toHaveBeenCalledWith('status', expect.anything());
  });

  it('decorates listed invoices with balance and overdue facts', async () => {
    const invoices = builderResult([
      {
        id: 'inv-1',
        project_id: PROJECT,
        status: 'issued',
        currency: 'PHP',
        total: 15000,
        due_date: daysAgo(10),
      },
      {
        id: 'inv-void',
        project_id: PROJECT,
        status: 'void',
        currency: 'PHP',
        total: 15000,
        due_date: daysAgo(10),
      },
    ]);
    const supabase = {
      from: jest.fn((table: string) =>
        table === 'invoices' ? invoices : builderResult([]),
      ),
    } as unknown as SupabaseClient;

    const result = await serviceFor(supabase).listInvoices(CONSULTANT, {
      ...defaultQuery,
      project_id: PROJECT,
    });

    expect(result.items[0]).toEqual(
      expect.objectContaining({
        balance_due: 15000,
        amount_paid: 0,
        is_overdue: true,
        days_overdue: 10,
      }),
    );
    // A void invoice is not a receivable, however overdue its date looks.
    expect(result.items[1]).toEqual(
      expect.objectContaining({ balance_due: 0, is_overdue: false }),
    );
  });
});
