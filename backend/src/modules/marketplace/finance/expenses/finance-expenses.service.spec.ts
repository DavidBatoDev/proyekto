import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  FinanceBookAccessService,
  FinanceBookRow,
  ResolvedBookAccess,
} from '../books/finance-book-access.service';
import {
  type FinanceBookRole,
  resolveBookPermissions,
} from '../books/finance-book-permissions';
import { FinanceExpensesService } from './finance-expenses.service';

/**
 * Chainable stub (same pattern as finance-books.service.hub.spec.ts): every
 * filter returns the builder; awaiting resolves the table's next canned result.
 * Inserts/updates are recorded so tests can assert what would be written.
 */
function stubSupabase(
  results: Record<string, Array<{ data?: unknown; count?: number | null }>>,
  writes: Array<{ table: string; op: string; payload: unknown }> = [],
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
        single: () => Promise.resolve(outcome),
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
        'lte',
        'gte',
        'order',
      ]) {
        builder[method] = () => builder;
      }
      for (const op of ['insert', 'update']) {
        builder[op] = (payload: unknown) => {
          writes.push({ table, op, payload });
          return builder;
        };
      }
      return builder;
    },
  } as unknown as SupabaseClient;
}

const teamBook: FinanceBookRow = {
  id: 'b2',
  kind: 'team',
  owner_kind: 'team',
  owner_user_id: null,
  owner_team_id: 't1',
  parent_book_id: null,
  project_id: null,
  currency: 'USD',
  status: 'active',
  created_by: null,
  created_at: '2026-08-01T00:00:00Z',
  updated_at: '2026-08-01T00:00:00Z',
};

function accessAs(role: FinanceBookRole | null): FinanceBookAccessService {
  return {
    resolveAccess: () =>
      Promise.resolve(
        role
          ? ({
              book: teamBook,
              role,
              permissions: resolveBookPermissions(role),
              inherited: false,
            } satisfies ResolvedBookAccess)
          : null,
      ),
  } as unknown as FinanceBookAccessService;
}

const TEAM = { id: 't1', owner_id: 'owner' };

describe('FinanceExpensesService.resolveTeamAccess', () => {
  it('team owner reads and writes even without a team book', async () => {
    const service = new FinanceExpensesService(
      stubSupabase({
        teams: [{ data: TEAM }],
        finance_books: [{ data: null }],
      }),
      accessAs(null),
    );
    const access = await service.resolveTeamAccess('owner', 't1');
    expect(access).toMatchObject({ can_read: true, can_manage: true });
    expect(access?.book).toBeNull();
  });

  it('non-owner with no team book has no access', async () => {
    const service = new FinanceExpensesService(
      stubSupabase({
        teams: [{ data: TEAM }],
        finance_books: [{ data: null }],
      }),
      accessAs('manager'),
    );
    expect(await service.resolveTeamAccess('u2', 't1')).toBeNull();
  });

  it('unknown team resolves to null', async () => {
    const service = new FinanceExpensesService(
      stubSupabase({ teams: [{ data: null }] }),
      accessAs('owner'),
    );
    expect(await service.resolveTeamAccess('u2', 't1')).toBeNull();
  });

  it.each([
    ['manager', true, true],
    ['accountant', true, true],
    ['viewer', null, null],
    ['viewer_client', null, null],
  ] as const)('book role %s -> read %s / manage %s', async (role, r, m) => {
    const service = new FinanceExpensesService(
      stubSupabase({
        teams: [{ data: TEAM }],
        finance_books: [{ data: teamBook }],
      }),
      accessAs(role),
    );
    const access = await service.resolveTeamAccess('u2', 't1');
    if (r === null) {
      expect(access).toBeNull();
    } else {
      expect(access).toMatchObject({ can_read: r, can_manage: m });
    }
  });

  it('an archived team book is read-only, even for the owner', async () => {
    const service = new FinanceExpensesService(
      stubSupabase({
        teams: [{ data: TEAM }],
        finance_books: [{ data: { ...teamBook, status: 'archived' } }],
      }),
      accessAs(null),
    );
    expect(await service.resolveTeamAccess('owner', 't1')).toMatchObject({
      can_read: true,
      can_manage: false,
    });
  });
});

describe('FinanceExpensesService writes', () => {
  const body = {
    category: 'software_subscription' as const,
    description: '  Figma  ',
    amount: 15,
    currency: 'usd',
    incurred_on: '2026-09-01',
  };

  it('a viewer gets NotFound on create', async () => {
    const service = new FinanceExpensesService(
      stubSupabase({
        teams: [{ data: TEAM }],
        finance_books: [{ data: teamBook }],
      }),
      accessAs('viewer'),
    );
    await expect(service.create('u2', 't1', body)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects a project not linked to the team', async () => {
    const service = new FinanceExpensesService(
      stubSupabase({
        teams: [{ data: TEAM }],
        finance_books: [{ data: teamBook }],
        project_teams: [{ count: 0 }],
      }),
      accessAs(null),
    );
    await expect(
      service.create('owner', 't1', { ...body, project_id: 'p9' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an end date on a one-off expense', async () => {
    const service = new FinanceExpensesService(
      stubSupabase({
        teams: [{ data: TEAM }],
        finance_books: [{ data: null }],
      }),
      accessAs(null),
    );
    await expect(
      service.create('owner', 't1', {
        ...body,
        recurrence_ends_on: '2026-12-01',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('normalizes and stamps the insert', async () => {
    const writes: Array<{ table: string; op: string; payload: unknown }> = [];
    const service = new FinanceExpensesService(
      stubSupabase(
        {
          teams: [{ data: TEAM }],
          finance_books: [{ data: teamBook }],
          finance_expenses: [{ data: { id: 'e1', amount: '15.00' } }],
        },
        writes,
      ),
      accessAs(null),
    );
    const created = await service.create('owner', 't1', {
      ...body,
      recurrence: 'monthly',
      recurrence_ends_on: '2027-09-01',
    });
    expect(created.amount).toBe(15);
    expect(writes[0].payload).toMatchObject({
      team_id: 't1',
      book_id: 'b2',
      description: 'Figma',
      currency: 'USD',
      recurrence: 'monthly',
      recurrence_ends_on: '2027-09-01',
      created_by: 'owner',
    });
  });
});
