import type { SupabaseClient } from '@supabase/supabase-js';
import type { ConsultantFinanceAccessService } from '../finance/consultant-finance-access.service';
import type { EngagementsService } from '../engagements/engagements.service';
import { FinancialsService } from './financials.service';

/**
 * Cost and the uncosted marker read time_entries with the CHANGE-5 predicates
 * (E64, L11): Approved = payable_seconds IS NOT NULL and not legacy rejected;
 * hours = Σ payable_seconds; cost = Σ amount_snapshot.
 */

type Op = [string, ...unknown[]];
interface Call {
  table: string;
  select: string;
  ops: Op[];
}

function fakeDb(answers: Record<string, (call: Call) => unknown[]>) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const call: Call = { table, select: '', ops: [] };
      calls.push(call);
      const result = () => ({
        data: answers[table]?.(call) ?? [],
        error: null,
      });
      const builder: Record<string, unknown> = {};
      builder.select = (columns: string) => {
        call.select = columns;
        return builder;
      };
      for (const m of [
        'eq',
        'neq',
        'in',
        'not',
        'or',
        'gte',
        'lte',
        'order',
        'range',
      ]) {
        builder[m] = (...args: unknown[]) => {
          call.ops.push([m, ...args]);
          return builder;
        };
      }
      builder.maybeSingle = () =>
        Promise.resolve({
          data: answers[table]?.(call)[0] ?? null,
          error: null,
        });
      builder.then = (resolve: (v: unknown) => unknown) =>
        Promise.resolve(result()).then(resolve);
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

const PROJECT = 'p1';
const access = {
  assertProject: jest.fn().mockResolvedValue(undefined),
} as unknown as ConsultantFinanceAccessService;

/** First page only: every query in these specs fits one page. */
const firstPage = (rows: unknown[]) => (call: Call) => {
  const range = call.ops.find((o) => o[0] === 'range');
  return !range || range[1] === 0 ? rows : [];
};

function build(
  entries: { uncosted?: unknown[]; cost?: unknown[] },
  teams: unknown[] = [],
  engagements?: Partial<EngagementsService>,
) {
  const db = fakeDb({
    projects: () => [{ currency: 'PHP' }],
    time_entries: (call) =>
      call.select.startsWith('context_kind')
        ? firstPage(entries.uncosted ?? [])(call)
        : firstPage(entries.cost ?? [])(call),
    teams: () => teams,
  });
  const service = new FinancialsService(
    db.client,
    access,
    engagements as EngagementsService | undefined,
  );
  return { service, db };
}

const uncostedCall = (calls: Call[]) =>
  calls.find(
    (c) => c.table === 'time_entries' && c.select.startsWith('context_kind'),
  ) as Call;
const costCall = (calls: Call[]) =>
  calls.find(
    (c) => c.table === 'time_entries' && c.select.startsWith('currency'),
  ) as Call;

describe('FinancialsService uncosted hours (CHANGE-5)', () => {
  it('asks only for approved, real-work, rate-0 team or NULL-amount assignment time, never legacy rejected (E64)', async () => {
    const { service, db } = build({});
    await service.getProjectFinancials('u1', PROJECT);
    const call = uncostedCall(db.calls);
    expect(call.ops).toEqual(
      expect.arrayContaining([
        ['eq', 'project_id', PROJECT],
        ['eq', 'work_type_snapshot', 'real_work'],
        ['not', 'payable_seconds', 'is', null],
        [
          'or',
          'and(or(legacy_status.is.null,legacy_status.neq.rejected),' +
            'or(and(context_kind.eq.team,rate_snapshot.eq.0),' +
            'and(context_kind.eq.assignment,amount_snapshot.is.null)))',
        ],
      ]),
    );
    // No inner join on teams any more, and never the entry status.
    expect(call.select).not.toContain('teams');
    expect(call.ops.some((o) => o[1] === 'status')).toBe(false);
  });

  it('counts rate-0 team time only for teams with member rates on, in payable hours', async () => {
    const { service } = build(
      {
        uncosted: [
          // Rates on, no rate for the member: uncosted.
          {
            context_kind: 'team',
            team_id: 'rates-on',
            engagement_assignment_id: null,
            payable_seconds: 5400,
          },
          // Rates off: hours-only by design, not "incomplete".
          {
            context_kind: 'team',
            team_id: 'rates-off',
            engagement_assignment_id: null,
            payable_seconds: 7200,
          },
        ],
      },
      [
        { id: 'rates-on', member_rates_enabled: true },
        { id: 'rates-off', member_rates_enabled: false },
      ],
    );
    const result = await service.getProjectFinancials('u1', PROJECT);
    expect(result.uncosted).toEqual({ hours: 1.5, cost_incomplete: true });
  });

  it('counts placed talent with a NULL amount, never a consultant’s own client-only time', async () => {
    const assignmentsForProject = jest.fn().mockResolvedValue([
      { id: 'a-talent', talent_engagement_id: 'te1' },
      { id: 'a-client', talent_engagement_id: null },
    ]);
    const { service } = build(
      {
        uncosted: [
          {
            context_kind: 'assignment',
            team_id: null,
            engagement_assignment_id: 'a-talent',
            payable_seconds: 3600,
          },
          {
            context_kind: 'assignment',
            team_id: null,
            engagement_assignment_id: 'a-client',
            payable_seconds: 9000,
          },
        ],
      },
      [],
      { assignmentsForProject } as Partial<EngagementsService>,
    );
    const result = await service.getProjectFinancials('u1', PROJECT);
    expect(assignmentsForProject).toHaveBeenCalledWith(PROJECT);
    expect(result.uncosted).toEqual({ hours: 1, cost_incomplete: true });
  });

  it('without the engagement reads, assignment rows are not counted', async () => {
    const { service } = build({
      uncosted: [
        {
          context_kind: 'assignment',
          team_id: null,
          engagement_assignment_id: 'a-talent',
          payable_seconds: 3600,
        },
      ],
    });
    const result = await service.getProjectFinancials('u1', PROJECT);
    expect(result.uncosted).toEqual({ hours: 0, cost_incomplete: false });
  });
});

describe('FinancialsService cost rows (CHANGE-5)', () => {
  it('sums amount_snapshot of approved, real-work, non-personal time', async () => {
    const { service, db } = build({
      cost: [
        {
          currency_snapshot: 'PHP',
          amount_snapshot: '750.00',
          started_at: '2026-08-03T01:00:00Z',
        },
        {
          currency_snapshot: 'PHP',
          amount_snapshot: 250.5,
          started_at: '2026-09-03T01:00:00Z',
        },
      ],
    });
    const result = await service.getProjectFinancials('u1', PROJECT);
    expect(result.totals.cost).toBe(1000.5);
    expect(result.months.map((m) => [m.month, m.cost])).toEqual([
      ['2026-08', 750],
      ['2026-09', 250.5],
    ]);
    const call = costCall(db.calls);
    expect(call.select).toBe('currency_snapshot, amount_snapshot, started_at');
    expect(call.ops).toEqual(
      expect.arrayContaining([
        ['neq', 'context_kind', 'personal'],
        ['eq', 'work_type_snapshot', 'real_work'],
        ['not', 'payable_seconds', 'is', null],
        ['not', 'amount_snapshot', 'is', null],
        ['or', 'legacy_status.is.null,legacy_status.neq.rejected'],
      ]),
    );
    expect(call.ops.some((o) => o[1] === 'status')).toBe(false);
  });
});
