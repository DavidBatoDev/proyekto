import type { SupabaseClient } from '@supabase/supabase-js';
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
 * Same pattern as engagement-eligibility.service.spec.ts.
 */
function stubSupabase(
  results: Record<string, Array<{ data?: unknown; count?: number | null }>>,
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
        'select',
        'eq',
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
  const log = {
    member_user_id: 'u2',
    member_display_name_snapshot: 'Ann',
    duration_seconds: 3600,
    status: 'approved',
    rate_snapshot: 100,
    currency_snapshot: 'USD',
  };

  function accessStub(role: 'owner' | 'accountant'): FinanceBookAccessService {
    const resolved: ResolvedBookAccess = {
      book: teamBook,
      role,
      permissions: resolveBookPermissions(role),
      inherited: false,
    };
    return {
      assertBookCapability: jest.fn().mockResolvedValue(resolved),
    } as unknown as FinanceBookAccessService;
  }

  it('owner sees per-member amounts (view_costs)', async () => {
    const service = new FinanceBooksService(
      stubSupabase({
        teams: [{ data: { id: 't1', name: 'Team One' } }],
        task_time_logs: [{ data: [log] }],
        payouts: [
          { data: [{ currency: 'USD', total_amount: 50, status: 'recorded' }] },
        ],
        // bookProjectIds for contracts, then for invoices.
        finance_books: [{ data: [] }, { data: [] }],
      }),
      accessStub('owner'),
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
      },
    ]);
    expect(overview.payouts).toEqual([
      { currency: 'USD', total: 50, count: 1 },
    ]);
    expect(overview.contracts).toEqual([]);
    expect(overview.invoices).toEqual([]);
  });

  it('accountant sees time but never amounts, contracts, or invoices', async () => {
    const service = new FinanceBooksService(
      stubSupabase({
        teams: [{ data: { id: 't1', name: 'Team One' } }],
        // Cost columns are not selected without view_costs; simulate their
        // absence in the returned rows too.
        task_time_logs: [
          {
            data: [
              {
                member_user_id: 'u2',
                member_display_name_snapshot: 'Ann',
                duration_seconds: 3600,
                status: 'pending',
              },
            ],
          },
        ],
        payouts: [{ data: [] }],
      }),
      accessStub('accountant'),
    );

    const overview = await service.getBookOverview('u1', 'b2');
    expect(overview.time?.pending_seconds).toBe(3600);
    const member = overview.time?.by_member[0];
    expect(member?.seconds).toBe(3600);
    expect(member).not.toHaveProperty('amount');
    expect(member).not.toHaveProperty('currency');
    expect(overview.contracts).toBeUndefined();
    expect(overview.invoices).toBeUndefined();
  });
});
