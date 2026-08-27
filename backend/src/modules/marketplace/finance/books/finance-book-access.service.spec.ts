import { NotFoundException } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { FinanceBookAccessService } from './finance-book-access.service';

/**
 * Chainable stub (same pattern as engagement-eligibility.service.spec.ts):
 * every filter method returns the builder; awaiting it (or maybeSingle)
 * resolves with the canned result for its table — queues per table, FIFO.
 */
function stubSupabase(
  results: Record<string, Array<{ data?: unknown; count?: number | null }>>,
): SupabaseClient {
  const queues = new Map(Object.entries(results).map(([k, v]) => [k, [...v]]));
  return {
    from(table: string) {
      const next = queues.get(table)?.shift() ?? { data: null, count: 0 };
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
      for (const method of ['select', 'eq', 'in', 'not', 'is', 'order']) {
        builder[method] = () => builder;
      }
      return builder;
    },
  } as unknown as SupabaseClient;
}

const teamBook = {
  id: 'f2',
  kind: 'team',
  owner_kind: 'team',
  owner_user_id: null,
  owner_team_id: 't1',
  parent_book_id: null,
  project_id: null,
  currency: 'USD',
  status: 'active',
};

const projectBook = {
  ...teamBook,
  id: 'f3',
  kind: 'project',
  parent_book_id: 'f2',
  project_id: 'p1',
};

const personalBook = {
  id: 'f1',
  kind: 'personal',
  owner_kind: 'user',
  owner_user_id: 'u-owner',
  owner_team_id: null,
  parent_book_id: null,
  project_id: null,
  currency: 'USD',
  status: 'active',
};

describe('FinanceBookAccessService', () => {
  it('team owner is implicit owner with no membership row', async () => {
    const service = new FinanceBookAccessService(
      stubSupabase({
        finance_books: [{ data: teamBook }],
        teams: [{ count: 1 }],
      }),
    );
    const access = await service.resolveAccess('u1', 'f2');
    expect(access?.role).toBe('owner');
    expect(access?.inherited).toBe(false);
    expect(access?.permissions.manage_book).toBe(true);
  });

  it('direct accountant on an F3 gets accountant, not inherited', async () => {
    const service = new FinanceBookAccessService(
      stubSupabase({
        finance_books: [{ data: projectBook }],
        teams: [{ count: 0 }],
        finance_book_members: [
          { data: { finance_role: 'accountant', capabilities: null } },
        ],
      }),
    );
    const access = await service.resolveAccess('u1', 'f3');
    expect(access?.role).toBe('accountant');
    expect(access?.inherited).toBe(false);
    expect(access?.permissions.export).toBe(true);
    expect(access?.permissions.view_costs).toBe(false);
    expect(access?.permissions.manage_members).toBe(false);
  });

  it('F2 manager inherits manager onto the child F3', async () => {
    const service = new FinanceBookAccessService(
      stubSupabase({
        finance_books: [{ data: projectBook }],
        teams: [{ count: 0 }],
        finance_book_members: [
          { data: null }, // no direct row on f3
          { data: { finance_role: 'manager', capabilities: null } }, // parent f2
        ],
      }),
    );
    const access = await service.resolveAccess('u1', 'f3');
    expect(access?.role).toBe('manager');
    expect(access?.inherited).toBe(true);
    expect(access?.permissions.manage_money).toBe(true);
  });

  it('F2 accountant does NOT inherit onto the child F3', async () => {
    const service = new FinanceBookAccessService(
      stubSupabase({
        finance_books: [{ data: projectBook }],
        teams: [{ count: 0 }],
        finance_book_members: [
          { data: null },
          { data: { finance_role: 'accountant', capabilities: null } },
        ],
      }),
    );
    expect(await service.resolveAccess('u1', 'f3')).toBeNull();
  });

  it('personal book is private: owner in, everyone else NotFound', async () => {
    const asOwner = new FinanceBookAccessService(
      stubSupabase({ finance_books: [{ data: personalBook }] }),
    );
    const access = await asOwner.resolveAccess('u-owner', 'f1');
    expect(access?.role).toBe('owner');

    const asStranger = new FinanceBookAccessService(
      stubSupabase({ finance_books: [{ data: personalBook }] }),
    );
    expect(await asStranger.resolveAccess('u-stranger', 'f1')).toBeNull();
    await expect(
      asStranger.assertBookCapability('u-stranger', 'f1', 'view'),
    ).rejects.toThrow(NotFoundException);
  });

  it('viewer_client can never resolve view_costs, overrides included', async () => {
    const service = new FinanceBookAccessService(
      stubSupabase({
        finance_books: [{ data: teamBook }],
        teams: [{ count: 0 }],
        finance_book_members: [
          {
            data: {
              finance_role: 'viewer_client',
              capabilities: { view_costs: true },
            },
          },
        ],
      }),
    );
    const access = await service.resolveAccess('u1', 'f2');
    expect(access?.role).toBe('viewer_client');
    expect(access?.permissions.view_costs).toBe(false);
  });
});
