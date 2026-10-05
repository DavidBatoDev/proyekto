import type { SupabaseClient } from '@supabase/supabase-js';
import type { FinanceExpensesService } from '../expenses/finance-expenses.service';
import type {
  FinanceBookAccessService,
  FinanceBookRow,
  ResolvedBookAccess,
} from './finance-book-access.service';
import { resolveBookPermissions } from './finance-book-permissions';
import { FinanceBooksService } from './finance-books.service';

/**
 * Chainable stub: every filter method returns the builder; awaiting it
 * resolves with the canned result for its table (queues per table, FIFO).
 * Same pattern as engagement-eligibility.service.spec.ts. `selects` records
 * each table's select string so redaction can be asserted on the query.
 */
function stubSupabase(
  results: Record<string, Array<{ data?: unknown; count?: number | null }>>,
  selects: Array<{ table: string; columns: string }> = [],
): SupabaseClient {
  const queues = new Map(Object.entries(results).map(([k, v]) => [k, [...v]]));
  return {
    from(table: string) {
      const next = queues.get(table)?.shift() ?? { data: [], count: 0 };
      const outcome = {
        data: next.data ?? null,
        count: next.count ?? null,
        error: null,
      };
      const builder: Record<string, unknown> = {
        maybeSingle: () => Promise.resolve(outcome),
        then: (
          resolve: (value: typeof outcome) => unknown,
          reject?: (reason: unknown) => unknown,
        ) => Promise.resolve(outcome).then(resolve, reject),
      };
      for (const method of [
        'eq',
        'neq',
        'in',
        'not',
        'is',
        'lt',
        'gt',
        'or',
        'order',
      ]) {
        builder[method] = () => builder;
      }
      builder.select = (columns: string) => {
        selects.push({ table, columns });
        return builder;
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

function book(partial: Partial<FinanceBookRow>): FinanceBookRow {
  return {
    id: 'b0',
    kind: 'team',
    owner_kind: 'team',
    owner_user_id: null,
    owner_team_id: null,
    parent_book_id: null,
    project_id: null,
    currency: 'USD',
    status: 'active',
    created_by: null,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
    ...partial,
  };
}

const noAccess = {} as unknown as FinanceBookAccessService;
const noExpenses = {} as unknown as FinanceExpensesService;

describe('FinanceBooksService.getHub', () => {
  it('team owner sees the F2 with its child project books', async () => {
    const f2 = book({ id: 'b2', kind: 'team', owner_team_id: 't1' });
    const f3 = book({
      id: 'b3',
      kind: 'project',
      owner_team_id: 't1',
      parent_book_id: 'b2',
      project_id: 'p1',
    });
    const service = new FinanceBooksService(
      stubSupabase({
        finance_books: [{ data: null }, { data: [f2, f3] }],
        teams: [
          {
            data: [
              { id: 't1', name: 'Team One', avatar_url: null, owner_id: 'u1' },
            ],
          },
        ],
        team_members: [{ data: [] }],
        finance_book_members: [{ data: [] }],
        projects: [{ data: [{ id: 'p1', title: 'Proj One' }] }],
        contracts: [{ data: [{ project_id: 'p1', status: 'signed' }] }],
      }),
      noAccess,
      noExpenses,
    );

    const hub = await service.getHub('u1');
    expect(hub.personal).toBeNull();
    expect(hub.shared).toEqual([]);
    expect(hub.teams).toHaveLength(1);
    const entry = hub.teams[0];
    expect(entry.team_id).toBe('t1');
    expect(entry.my_team_role).toBe('owner');
    expect(entry.book?.id).toBe('b2');
    expect(entry.book_role).toBe('owner');
    expect(entry.can_create).toBe(false);
    expect(entry.project_books).toEqual([
      { book: f3, project_title: 'Proj One', contract_status: 'signed' },
    ]);
  });

  it('team member without book access gets a null book and cannot create', async () => {
    const f2 = book({ id: 'b2', kind: 'team', owner_team_id: 't2' });
    const service = new FinanceBooksService(
      stubSupabase({
        finance_books: [{ data: null }, { data: [f2] }],
        teams: [
          { data: [] },
          {
            data: [
              { id: 't2', name: 'Team Two', avatar_url: null, owner_id: 'u9' },
            ],
          },
        ],
        team_members: [{ data: [{ team_id: 't2', role: 'member' }] }],
        finance_book_members: [{ data: [] }],
      }),
      noAccess,
      noExpenses,
    );

    const hub = await service.getHub('u1');
    expect(hub.teams).toHaveLength(1);
    const entry = hub.teams[0];
    expect(entry.my_team_role).toBe('member');
    expect(entry.book).toBeNull();
    expect(entry.book_role).toBeNull();
    // An F2 exists but the caller has no access — still cannot create.
    expect(entry.can_create).toBe(false);
    expect(entry.project_books).toEqual([]);
  });

  it('external accountant surfaces in shared with resolved names', async () => {
    const shared = book({
      id: 'b5',
      kind: 'project',
      owner_team_id: 't9',
      parent_book_id: 'b4',
      project_id: 'p9',
    });
    const service = new FinanceBooksService(
      stubSupabase({
        finance_books: [{ data: null }, { data: [shared] }],
        teams: [{ data: [] }, { data: [{ id: 't9', name: 'Ext Team' }] }],
        team_members: [{ data: [] }],
        finance_book_members: [
          { data: [{ book_id: 'b5', finance_role: 'accountant' }] },
        ],
        projects: [{ data: [{ id: 'p9', title: 'Ext Proj' }] }],
        contracts: [{ data: [] }],
      }),
      noAccess,
      noExpenses,
    );

    const hub = await service.getHub('u1');
    expect(hub.teams).toEqual([]);
    expect(hub.shared).toEqual([
      {
        book: shared,
        role: 'accountant',
        team_name: 'Ext Team',
        project_title: 'Ext Proj',
      },
    ]);
  });
});

describe('FinanceBooksService.getBookOverview', () => {
  const teamBook = book({ id: 'b2', kind: 'team', owner_team_id: 't1' });
  const projectBook = book({
    id: 'b3',
    kind: 'project',
    owner_team_id: 't1',
    parent_book_id: 'b2',
    project_id: 'p1',
  });

  /** One time_entries row as the books read it (M3 names, CHANGE-5 columns). */
  function entry(partial: Record<string, unknown>): Record<string, unknown> {
    return {
      id: 'e1',
      member_user_id: 'u2',
      member_display_name_snapshot: 'Ann',
      project_id: 'p1',
      context_kind: 'team',
      context_ref: 't1',
      team_id: 't1',
      workspace_id: null,
      engagement_assignment_id: null,
      timesheet_id: 's1',
      started_at: '2026-09-01T01:00:00Z',
      duration_seconds: 3600,
      payable_seconds: 3600,
      legacy_status: null,
      timesheet: { status: 'approved' },
      currency_snapshot: 'USD',
      amount_snapshot: 100,
      ...partial,
    };
  }

  const assignmentRow = () =>
    entry({
      id: 'e2',
      member_user_id: 'talent-1',
      member_display_name_snapshot: 'Leo Talent',
      context_kind: 'assignment',
      context_ref: 'a1',
      team_id: null,
      engagement_assignment_id: 'a1',
    });

  function accessStub(
    role: 'owner' | 'accountant',
    resolvedBook: FinanceBookRow = teamBook,
  ): FinanceBookAccessService {
    const resolved: ResolvedBookAccess = {
      book: resolvedBook,
      role,
      permissions: resolveBookPermissions(role),
      inherited: false,
    };
    return {
      assertBookCapability: jest.fn().mockResolvedValue(resolved),
    } as unknown as FinanceBookAccessService;
  }

  it('owner sees per-member amounts from amount_snapshot (view_costs)', async () => {
    const selects: Array<{ table: string; columns: string }> = [];
    const service = new FinanceBooksService(
      stubSupabase(
        {
          teams: [{ data: { id: 't1', name: 'Team One' } }],
          time_entries: [{ data: [entry({})] }],
          payouts: [
            {
              data: [{ currency: 'USD', total_amount: 50, status: 'recorded' }],
            },
          ],
          // bookProjectIds for contracts, then for invoices.
          finance_books: [{ data: [] }, { data: [] }],
        },
        selects,
      ),
      accessStub('owner'),
      noExpenses,
    );

    const overview = await service.getBookOverview('u1', 'b2');
    expect(overview.team_name).toBe('Team One');
    expect(overview.time?.total_seconds).toBe(3600);
    expect(overview.time?.approved_seconds).toBe(3600);
    expect(overview.time?.by_member).toEqual([
      {
        user_id: 'u2',
        display_name: 'Ann',
        seconds: 3600,
        amount: 100,
        currency: 'USD',
        uncosted_seconds: 0,
      },
    ]);
    expect(overview.payouts).toEqual([
      { currency: 'USD', total: 50, count: 1 },
    ]);
    expect(overview.contracts).toEqual([]);
    expect(overview.invoices).toEqual([]);
    // The time module's table; the sheet by column hint; never the entry status.
    const time = selects.find((s) => s.table === 'time_entries');
    expect(time?.columns).toContain('amount_snapshot');
    expect(time?.columns).toContain(
      'timesheet:timesheets!timesheet_id(status)',
    );
    expect(time?.columns).not.toMatch(/(^|[ ,])status([ ,]|$)/);
  });

  it('accountant sees time, contracts, and invoices but never cost amounts', async () => {
    const selects: Array<{ table: string; columns: string }> = [];
    const service = new FinanceBooksService(
      stubSupabase(
        {
          teams: [{ data: { id: 't1', name: 'Team One' } }],
          // Cost columns are not selected without view_costs; simulate their
          // absence in the returned rows too.
          time_entries: [
            {
              data: [
                entry({
                  payable_seconds: null,
                  timesheet: { status: 'open' },
                  currency_snapshot: undefined,
                  amount_snapshot: undefined,
                }),
              ],
            },
          ],
          payouts: [{ data: [] }],
        },
        selects,
      ),
      accessStub('accountant'),
      noExpenses,
    );

    const overview = await service.getBookOverview('u1', 'b2');
    expect(overview.time?.pending_seconds).toBe(3600);
    expect(overview.time?.approved_seconds).toBe(0);
    const member = overview.time?.by_member[0];
    expect(member?.seconds).toBe(3600);
    expect(member).not.toHaveProperty('amount');
    expect(member).not.toHaveProperty('currency');
    expect(member).not.toHaveProperty('uncosted_seconds');
    const time = selects.find((s) => s.table === 'time_entries');
    expect(time?.columns).not.toContain('amount_snapshot');
    expect(time?.columns).not.toContain('rate_snapshot');
    // Accountants read money in (contracts + invoices) since 2026-09-30.
    expect(overview.contracts).toEqual([]);
    expect(overview.invoices).toEqual([]);
  });

  it('CHANGE-5: pending by sheet status, approved from payable_seconds, legacy rejected left out, NULL amount uncosted', async () => {
    const service = new FinanceBooksService(
      stubSupabase({
        teams: [{ data: { id: 't1', name: 'Team One' } }],
        time_entries: [
          {
            data: [
              // Approved and frozen: 1.5 h logged, 1 h payable (capped), 80.
              entry({
                id: 'e1',
                duration_seconds: 5400,
                payable_seconds: 3600,
                amount_snapshot: 80,
              }),
              // Approved fixed-rate time: no amount, listed uncosted.
              entry({ id: 'e2', payable_seconds: 1800, amount_snapshot: null }),
              // Submitted and returned sheets are pending.
              entry({
                id: 'e3',
                payable_seconds: null,
                amount_snapshot: null,
                timesheet: { status: 'submitted' },
              }),
              entry({
                id: 'e4',
                payable_seconds: null,
                amount_snapshot: null,
                timesheet: { status: 'returned' },
              }),
              // Legacy rejected (E64): never counted.
              entry({
                id: 'e5',
                duration_seconds: 2_678_400,
                payable_seconds: 0,
                legacy_status: 'rejected',
                amount_snapshot: 0,
              }),
            ],
          },
        ],
        payouts: [{ data: [] }],
        finance_books: [{ data: [] }, { data: [] }],
      }),
      accessStub('owner'),
      noExpenses,
    );

    const overview = await service.getBookOverview('u1', 'b2');
    expect(overview.time?.total_seconds).toBe(5400 + 3600 * 3);
    expect(overview.time?.pending_seconds).toBe(7200);
    expect(overview.time?.approved_seconds).toBe(3600 + 1800);
    expect(overview.time?.by_member).toEqual([
      {
        user_id: 'u2',
        display_name: 'Ann',
        seconds: 5400 + 3600 * 3,
        amount: 80,
        currency: 'USD',
        uncosted_seconds: 1800,
      },
    ]);
  });

  it('project book masks placed talent the viewer may not name (L22) and keeps team rows named', async () => {
    const identityVisible = jest.fn().mockResolvedValue(new Set<string>());
    const service = new FinanceBooksService(
      stubSupabase({
        projects: [{ data: { id: 'p1', title: 'Proj One' } }],
        teams: [{ data: { id: 't1', name: 'Team One' } }],
        time_entries: [{ data: [entry({ id: 'e1' }), assignmentRow()] }],
        payouts: [{ data: [] }],
        finance_books: [{ data: [] }, { data: [] }],
      }),
      accessStub('accountant', projectBook),
      noExpenses,
      { identityVisible } as never,
    );

    const overview = await service.getBookOverview('u1', 'b3');
    // Only someone else's assignment row is asked about.
    expect(identityVisible).toHaveBeenCalledWith('u1', [
      expect.objectContaining({ id: 'e2' }),
    ]);
    expect(overview.time?.by_member).toEqual([
      { user_id: 'u2', display_name: 'Ann', seconds: 3600 },
      { user_id: 'masked:a1', display_name: 'Delivery team', seconds: 3600 },
    ]);
    expect(JSON.stringify(overview.time)).not.toContain('Leo Talent');
    expect(JSON.stringify(overview.time)).not.toContain('talent-1');
  });

  it('project book names talent for a provider-side viewer', async () => {
    const identityVisible = jest.fn().mockResolvedValue(new Set(['e2']));
    const service = new FinanceBooksService(
      stubSupabase({
        projects: [{ data: { id: 'p1', title: 'Proj One' } }],
        teams: [{ data: { id: 't1', name: 'Team One' } }],
        time_entries: [{ data: [assignmentRow()] }],
        payouts: [{ data: [] }],
        finance_books: [{ data: [] }, { data: [] }],
      }),
      accessStub('accountant', projectBook),
      noExpenses,
      { identityVisible } as never,
    );

    const overview = await service.getBookOverview('u1', 'b3');
    expect(overview.time?.by_member).toEqual([
      { user_id: 'talent-1', display_name: 'Leo Talent', seconds: 3600 },
    ]);
  });

  it('project book without the time module masks every other assignment row (fail closed)', async () => {
    const service = new FinanceBooksService(
      stubSupabase({
        projects: [{ data: { id: 'p1', title: 'Proj One' } }],
        teams: [{ data: { id: 't1', name: 'Team One' } }],
        time_entries: [{ data: [assignmentRow()] }],
        payouts: [{ data: [] }],
        finance_books: [{ data: [] }, { data: [] }],
      }),
      accessStub('accountant', projectBook),
      noExpenses,
    );

    const overview = await service.getBookOverview('u1', 'b3');
    expect(overview.time?.by_member).toEqual([
      { user_id: 'masked:a1', display_name: 'Delivery team', seconds: 3600 },
    ]);
  });
});

describe('FinanceBooksService hours (CHANGE-5)', () => {
  const own = (partial: Record<string, unknown>) => ({
    team_id: null,
    duration_seconds: 3600,
    payable_seconds: null,
    legacy_status: null,
    payout_id: null,
    started_at: '2026-01-05T01:00:00Z',
    timesheet: null,
    ...partial,
  });

  it('getMySummary: pending by sheet, approved and paid from payable_seconds, personal time counted, rejected out', async () => {
    const service = new FinanceBooksService(
      stubSupabase({
        teams: [{ data: [] }],
        team_members: [{ data: [] }],
        time_entries: [
          {
            data: [
              // Personal ("Just me"): no sheet, never pending or approved.
              own({}),
              // Team, open sheet: pending.
              own({ team_id: 't1', timesheet: { status: 'open' } }),
              // Team, approved, unpaid: 0.5 h payable.
              own({
                team_id: 't1',
                duration_seconds: 2000,
                payable_seconds: 1800,
                timesheet: { status: 'approved' },
              }),
              // Paid by payout, and paid outside Proyekto (legacy).
              own({
                team_id: 't1',
                payable_seconds: 3600,
                payout_id: 'po1',
                timesheet: { status: 'approved' },
              }),
              own({
                payable_seconds: 900,
                legacy_status: 'paid_outside',
                timesheet: { status: 'approved' },
              }),
              // Legacy rejected: excluded everywhere.
              own({
                team_id: 't1',
                duration_seconds: 99_999,
                payable_seconds: 0,
                legacy_status: 'rejected',
                timesheet: { status: 'approved' },
              }),
            ],
          },
        ],
      }),
      noAccess,
      {
        summarizeTeams: jest.fn().mockResolvedValue(new Map()),
      } as unknown as FinanceExpensesService,
    );

    const summary = await service.getMySummary('u1');
    expect(summary.hours).toEqual({
      total_seconds: 3600 + 3600 + 2000 + 3600 + 3600,
      month_seconds: expect.any(Number),
      pending_seconds: 3600,
      approved_seconds: 1800,
      paid_seconds: 3600 + 900,
    });
  });

  it('getPersonalDashboard: pending by sheet status, rejected out', async () => {
    const personal = book({
      id: 'b1',
      kind: 'personal',
      owner_kind: 'user',
      owner_user_id: 'u1',
    });
    const service = new FinanceBooksService(
      stubSupabase({
        finance_books: [{ data: personal }],
        time_entries: [
          {
            data: [
              own({ timesheet: { status: 'submitted' } }),
              own({ timesheet: { status: 'approved' }, payable_seconds: 3600 }),
              own({}),
              own({ duration_seconds: 50_000, legacy_status: 'rejected' }),
            ],
          },
        ],
        payouts: [{ data: [] }],
      }),
      noAccess,
      noExpenses,
    );

    const dashboard = await service.getPersonalDashboard('u1');
    expect(dashboard.hours.total_seconds).toBe(3 * 3600);
    expect(dashboard.hours.pending_seconds).toBe(3600);
  });
});
