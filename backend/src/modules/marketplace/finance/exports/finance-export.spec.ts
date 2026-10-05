import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  FinanceBookAccessService,
  FinanceBookRow,
} from '../books/finance-book-access.service';
import {
  type FinanceBookRole,
  resolveBookPermissions,
} from '../books/finance-book-permissions';
import { exportColumns, timeEntryStatus } from './export-columns';
import { buildCsv, csvField } from './export-formats';
import { FinanceExportService } from './finance-export.service';

describe('exportColumns', () => {
  const COST_KEYS = ['rate', 'amount'];

  it('excludes every rate-derived column without view_costs', () => {
    const permissions = resolveBookPermissions('accountant');
    expect(permissions.view_costs).toBe(false);
    const keys = exportColumns('time_logs', permissions).map((c) => c.key);
    for (const key of COST_KEYS) expect(keys).not.toContain(key);
    expect(keys).not.toContain('currency');
  });

  it('includes rate, currency, and amount with view_costs', () => {
    const permissions = resolveBookPermissions('owner');
    const keys = exportColumns('time_logs', permissions).map((c) => c.key);
    expect(keys).toEqual(
      expect.arrayContaining(['rate', 'currency', 'amount']),
    );
  });

  it('viewer_client can never resolve cost columns, even with an override', () => {
    const permissions = resolveBookPermissions('viewer_client', {
      view_costs: true,
    });
    const keys = exportColumns('time_logs', permissions).map((c) => c.key);
    for (const key of COST_KEYS) expect(keys).not.toContain(key);
  });

  it('payout columns never include rate_snapshot-derived fields', () => {
    const keys = exportColumns('payouts', resolveBookPermissions('owner')).map(
      (c) => c.key,
    );
    expect(keys).toContain('total_amount');
    for (const key of COST_KEYS) expect(keys).not.toContain(key);
  });

  it('time columns add For, timesheet, period and approved hours, and never an email', () => {
    for (const role of ['owner', 'accountant'] as FinanceBookRole[]) {
      const keys = exportColumns('time_logs', resolveBookPermissions(role)).map(
        (c) => c.key,
      );
      expect(keys).toEqual(
        expect.arrayContaining([
          'logging_for',
          'timesheet_status',
          'period_start',
          'period_end',
          'payable_hours',
        ]),
      );
      expect(keys.some((key) => key.includes('email'))).toBe(false);
    }
  });
});

describe('timeEntryStatus (CHANGE-5 predicates, D03)', () => {
  const row = (partial: Partial<Parameters<typeof timeEntryStatus>[0]>) => ({
    payable_seconds: null,
    payout_id: null,
    legacy_status: null,
    ...partial,
  });

  it.each([
    [
      'payout recorded',
      row({ payable_seconds: 3600, payout_id: 'p1' }),
      'paid',
    ],
    [
      'paid outside Proyekto',
      row({ payable_seconds: 3600, legacy_status: 'paid_outside' }),
      'paid',
    ],
    [
      'legacy rejected',
      row({ payable_seconds: 0, legacy_status: 'rejected' }),
      'rejected',
    ],
    ['approved and frozen', row({ payable_seconds: 1800 }), 'approved'],
    ['not yet approved', row({}), 'pending'],
  ] as const)('%s → %s', (_label, input, expected) => {
    expect(timeEntryStatus(input)).toBe(expected);
  });
});

describe('FinanceExportService time export', () => {
  function book(partial: Partial<FinanceBookRow>): FinanceBookRow {
    return {
      id: 'b0000000-0000-4000-8000-000000000000',
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
      ...partial,
    };
  }

  function entry(partial: Record<string, unknown>): Record<string, unknown> {
    return {
      id: 'e1',
      project_id: 'p1',
      member_user_id: 'u2',
      member_display_name_snapshot: 'Ann',
      context_kind: 'team',
      context_ref: 't1',
      context_label_snapshot: 'Design team',
      team_id: 't1',
      workspace_id: null,
      engagement_assignment_id: null,
      timesheet_id: 's1',
      started_at: '2026-09-01T01:00:00Z',
      ended_at: '2026-09-01T03:00:00Z',
      duration_seconds: 7200,
      payable_seconds: 5400,
      break_seconds: 900,
      break_minutes: 15,
      source: 'timer',
      flagged_reason: null,
      legacy_status: null,
      payout_id: null,
      rate_snapshot: 500,
      currency_snapshot: 'PHP',
      amount_snapshot: 750,
      project: { title: 'Acme site' },
      task: { title: 'Logo' },
      timesheet: {
        status: 'approved',
        period_start: '2026-08-31',
        period_end: '2026-09-06',
      },
      ...partial,
    };
  }

  function harness(
    role: FinanceBookRole,
    resolved: FinanceBookRow,
    rows: unknown[],
    timeAuthority?: unknown,
  ) {
    const selects: Array<{ table: string; columns: string }> = [];
    const filters: Array<[string, string, unknown]> = [];
    const supabase = {
      from(table: string) {
        const builder: Record<string, unknown> = {
          then: (resolve: (v: unknown) => unknown) =>
            Promise.resolve({ data: rows, error: null }).then(resolve),
        };
        builder.select = (columns: string) => {
          selects.push({ table, columns });
          return builder;
        };
        for (const method of ['eq', 'neq', 'gte', 'lte', 'order']) {
          builder[method] = (column: string, value: unknown) => {
            filters.push([method, column, value]);
            return builder;
          };
        }
        return builder;
      },
    } as unknown as SupabaseClient;
    const access = {
      assertBookCapability: jest.fn().mockResolvedValue({
        book: resolved,
        role,
        permissions: resolveBookPermissions(role),
        inherited: false,
      }),
    } as unknown as FinanceBookAccessService;
    const service = new FinanceExportService(
      supabase,
      access,
      timeAuthority as never,
    );
    return { service, selects, filters };
  }

  const csv = (buffer: Buffer) => buffer.subarray(3).toString('utf8');

  it('reads time_entries by column hint, with the frozen amount for view_costs', async () => {
    const { service, selects } = harness('owner', book({}), [entry({})]);
    const file = await service.export('u1', 'b0', {
      kind: 'time_logs',
      format: 'csv',
    });
    const text = csv(file.buffer);
    const [header, line] = text.split('\r\n');
    expect(header).toContain('For');
    expect(header).toContain('Approved hours');
    expect(line).toContain('Design team');
    expect(line).toContain('1.5');
    expect(line).toContain('750');
    expect(line).toContain('2026-08-31');

    const time = selects.find((s) => s.table === 'time_entries');
    expect(time?.columns).toContain('amount_snapshot');
    expect(time?.columns).toContain('roadmap_tasks!task_id(title)');
    expect(time?.columns).not.toMatch(/_fkey/);
    expect(time?.columns).not.toMatch(/(^|[ ,])status([ ,]|$)/);
    // One read, of the time module's table (M3 name), nothing else.
    expect(selects.map((s) => s.table)).toEqual(['time_entries']);
  });

  it('never selects cost columns without view_costs', async () => {
    const { service, selects } = harness('accountant', book({}), [
      entry({ rate_snapshot: undefined, amount_snapshot: undefined }),
    ]);
    await service.export('u1', 'b0', { kind: 'time_logs', format: 'csv' });
    const time = selects.find((s) => s.table === 'time_entries');
    expect(time?.columns).not.toContain('rate_snapshot');
    expect(time?.columns).not.toContain('amount_snapshot');
  });

  it('project books leave personal time out and mask placed talent the caller may not name', async () => {
    const identityVisible = jest.fn().mockResolvedValue(new Set<string>());
    const { service, filters } = harness(
      'accountant',
      book({ kind: 'project', project_id: 'p1' }),
      [
        entry({}),
        entry({
          id: 'e2',
          member_user_id: 'talent-1',
          member_display_name_snapshot: 'Leo Talent',
          context_kind: 'assignment',
          context_ref: 'a1',
          context_label_snapshot: 'Pixel Studio',
          team_id: null,
          engagement_assignment_id: 'a1',
        }),
      ],
      { identityVisible },
    );
    const file = await service.export('u1', 'b0', {
      kind: 'time_logs',
      format: 'csv',
    });
    const text = csv(file.buffer);
    expect(filters).toContainEqual(['neq', 'context_kind', 'personal']);
    expect(identityVisible).toHaveBeenCalledWith('u1', [
      expect.objectContaining({ id: 'e2' }),
    ]);
    expect(text).toContain('Delivery team');
    expect(text).not.toContain('Leo Talent');
    expect(text).not.toContain('talent-1');
    expect(text).toContain('Ann');
  });
});

describe('csv building', () => {
  it('passes plain fields through unquoted', () => {
    expect(csvField('hello')).toBe('hello');
    expect(csvField(42)).toBe('42');
    expect(csvField(null)).toBe('');
  });

  it('quotes fields containing commas, quotes, and newlines', () => {
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('line1\nline2')).toBe('"line1\nline2"');
    expect(csvField('cr\rlf')).toBe('"cr\rlf"');
  });

  it('emits a BOM, header row, and quoted data rows', () => {
    const columns = [
      { key: 'a', header: 'A' },
      { key: 'b', header: 'B, or not' },
    ];
    const buffer = buildCsv(columns, [{ a: 'x"y', b: 1 }]);
    expect([...buffer.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(buffer.subarray(3).toString('utf8')).toBe(
      'A,"B, or not"\r\n"x""y",1',
    );
  });
});
