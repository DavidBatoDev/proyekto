import { InternalServerErrorException, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import { TimeAuthorityService } from './time-authority.service';
import { TimeEntriesService } from './time-entries.service';
import { TIME_INTERNAL_CODE } from './time-errors';
import { TimePolicyService } from './time-policy.service';
import {
  ROSTER_MASKED_LABEL,
  TimeProjectsFacade,
  dashboardStatusOf,
  emptyDashboardTime,
  maskProjectRoster,
  maskRosterMembers,
} from './time-projects.facade';

// ── In-memory PostgREST stand-in ───────────────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;
type DbError = { code?: string; message: string; details?: string | null };

interface Call {
  table: string;
  select: string;
  filters: Array<[op: string, column: string, value: unknown]>;
  order?: string;
  range?: [number, number];
}

function fakeDb(
  tables: Record<string, Row[]>,
  failures: Record<string, DbError> = {},
) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const call: Call = { table, select: '', filters: [] };
    calls.push(call);
    const run = () => {
      if (failures[table]) return { data: null, error: failures[table] };
      let rows = [...(tables[table] ?? [])];
      for (const [op, column, value] of call.filters) {
        if (op === 'in') {
          rows = rows.filter((r) => (value as unknown[]).includes(r[column]));
        } else if (op === 'eq') {
          rows = rows.filter((r) => r[column] === value);
        } else if (op === 'gte') {
          rows = rows.filter((r) => String(r[column]) >= String(value));
        } else if (op === 'lte') {
          rows = rows.filter((r) => String(r[column]) <= String(value));
        }
        // `or` is recorded, not applied: the facade's own TS guard must hold without it.
      }
      if (call.order) {
        const key = call.order;
        rows.sort((a, b) => (String(a[key]) < String(b[key]) ? -1 : 1));
      }
      if (call.range) rows = rows.slice(call.range[0], call.range[1] + 1);
      return { data: rows, error: null };
    };
    const builder: any = {
      select: (s: string) => {
        call.select = s;
        return builder;
      },
      in: (column: string, value: unknown[]) => {
        call.filters.push(['in', column, value]);
        return builder;
      },
      eq: (column: string, value: unknown) => {
        call.filters.push(['eq', column, value]);
        return builder;
      },
      gte: (column: string, value: unknown) => {
        call.filters.push(['gte', column, value]);
        return builder;
      },
      lte: (column: string, value: unknown) => {
        call.filters.push(['lte', column, value]);
        return builder;
      },
      or: (expr: string) => {
        call.filters.push(['or', '', expr]);
        return builder;
      },
      order: (column: string) => {
        call.order = column;
        return builder;
      },
      range: (start: number, end: number) => {
        call.range = [start, end];
        return builder;
      },
      then: (
        resolve: (v: unknown) => unknown,
        reject: (e: unknown) => unknown,
      ) => Promise.resolve(run()).then(resolve, reject),
    };
    return builder;
  };
  return { client: { from } as unknown as SupabaseClient, calls };
}

// ── Fixtures ────────────────────────────────────────────────────────────────────────────────────────────

const VIEWER = '11111111-1111-4111-8111-111111111111';

let seq = 0;
function entry(over: Row = {}): Row {
  seq += 1;
  return {
    id: `e-${String(seq).padStart(4, '0')}`,
    member_user_id: 'member-1',
    project_id: 'p1',
    context_kind: 'team',
    context_ref: 'team-1',
    team_id: 'team-1',
    workspace_id: null,
    engagement_assignment_id: null,
    timesheet_id: 'sheet-1',
    started_at: '2026-09-08T01:00:00.000Z',
    duration_seconds: 3600,
    payable_seconds: null,
    payout_id: null,
    legacy_status: null,
    amount_snapshot: null,
    timesheet: { status: 'open' },
    ...over,
  };
}

function rate(over: Row = {}): Row {
  return {
    id: 'rate-1',
    team_id: 'team-1',
    user_id: 'member-1',
    project_id: 'p1',
    rate_type: 'hourly',
    hourly_rate: 50,
    training_hourly_rate: null,
    currency: 'USD',
    start_date: '2026-01-01',
    end_date: null,
    weekly_limit_hours: 40,
    monthly_limit_hours: null,
    overtime_requires_approval: false,
    ...over,
  };
}

interface Built {
  facade: TimeProjectsFacade;
  calls: Call[];
  entries: { stopRunningForProject: jest.Mock };
  authority: {
    costVisible: jest.Mock;
    identityVisible: jest.Mock;
    maskedWorkerIds: jest.Mock;
    clientHoursLevel: jest.Mock;
  };
  policy: { sheetScopeFor: jest.Mock; resolve: jest.Mock };
}

async function build(
  tables: Record<string, Row[]> = {},
  o: {
    failures?: Record<string, DbError>;
    costVisible?: string[];
    timezone?: string;
    weekStart?: number;
    policyFails?: boolean;
  } = {},
): Promise<Built> {
  const db = fakeDb(tables, o.failures);
  const entries = { stopRunningForProject: jest.fn().mockResolvedValue(3) };
  const authority = {
    costVisible: jest.fn().mockResolvedValue(new Set(o.costVisible ?? [])),
    // Default: every row's worker is nameable; L22 cases override it.
    identityVisible: jest.fn((_viewer: string, rows: Row[]) =>
      Promise.resolve(new Set(rows.map((r) => r.id as string))),
    ),
    maskedWorkerIds: jest.fn().mockResolvedValue(new Set<string>()),
    clientHoursLevel: jest.fn().mockResolvedValue('summary'),
  };
  const policy = {
    sheetScopeFor: o.policyFails
      ? jest.fn().mockRejectedValue(new Error('scope boom'))
      : jest.fn().mockResolvedValue({
          scope_kind: 'workspace',
          scope_ref: 'ws-1',
          policy_workspace_id: 'ws-1',
          scope_label: 'Acme',
        }),
    resolve: jest.fn().mockResolvedValue({
      timezone: o.timezone ?? 'UTC',
      week_start: o.weekStart ?? 1,
    }),
  };
  const moduleRef = await Test.createTestingModule({
    providers: [
      TimeProjectsFacade,
      { provide: SUPABASE_ADMIN, useValue: db.client },
      { provide: TimeEntriesService, useValue: entries },
      { provide: TimeAuthorityService, useValue: authority },
      { provide: TimePolicyService, useValue: policy },
    ],
  }).compile();
  return {
    facade: moduleRef.get(TimeProjectsFacade),
    calls: db.calls,
    entries,
    authority,
    policy,
  };
}

const entryCalls = (calls: Call[]) =>
  calls.filter(
    (c) => c.table === 'time_entries' && c.select.includes('duration_seconds'),
  );
const costCalls = (calls: Call[]) =>
  calls.filter(
    (c) => c.table === 'time_entries' && c.select === 'id, amount_snapshot',
  );

beforeEach(() => {
  seq = 0;
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

// ── Delegation ──────────────────────────────────────────────────────────────────────────────────────────

describe('TimeProjectsFacade delegation', () => {
  it('stops running timers through TimeEntriesService (E9)', async () => {
    const { facade, entries } = await build();
    await expect(facade.stopRunningForProject('p1')).resolves.toBe(3);
    expect(entries.stopRunningForProject).toHaveBeenCalledWith('p1');
  });

  it('reads the client-hours level and the roster mask from TimeAuthorityService', async () => {
    const { facade, authority } = await build();
    authority.maskedWorkerIds.mockResolvedValue(new Set(['talent-1']));

    await expect(facade.clientHoursLevel('u1', 'p1')).resolves.toBe('summary');
    await expect(facade.maskedWorkerIds('p1', 'u1')).resolves.toEqual(
      new Set(['talent-1']),
    );
    expect(authority.clientHoursLevel).toHaveBeenCalledWith('u1', 'p1');
    expect(authority.maskedWorkerIds).toHaveBeenCalledWith('p1', 'u1');
  });
});

// ── Dashboard: counts, hours, sheet status ──────────────────────────────────────────────────────────────

describe('TimeProjectsFacade.dashboardTime counts', () => {
  it('returns the zero shape without a query when there are no projects', async () => {
    const { facade, calls } = await build();
    await expect(facade.dashboardTime(VIEWER, [], {})).resolves.toEqual(
      emptyDashboardTime(),
    );
    expect(calls).toHaveLength(0);
  });

  it('counts by the D03 column predicates and by sheet status, and sums payable hours of approved entries only', async () => {
    const rows = [
      entry({
        payout_id: 'po-1',
        payable_seconds: 3600,
        timesheet: { status: 'approved' },
      }),
      entry({
        legacy_status: 'paid_outside',
        payable_seconds: 3600,
        timesheet: { status: 'approved' },
      }),
      // E64: a legacy rejected week keeps payable_seconds, but never reaches a total.
      entry({
        legacy_status: 'rejected',
        payable_seconds: 7200,
        timesheet: { status: 'approved' },
      }),
      entry({ payable_seconds: 1800, timesheet: { status: 'approved' } }),
      entry({ timesheet: { status: 'submitted' } }),
      // Embeds can come back as a one-element array.
      entry({ timesheet: [{ status: 'returned' }] }),
      // Sheetless non-personal (pre-M2 only) counts as open.
      entry({ timesheet_id: null, timesheet: null }),
      // The caller's own personal entry.
      entry({
        member_user_id: VIEWER,
        context_kind: 'personal',
        context_ref: null,
        team_id: null,
        timesheet_id: null,
        timesheet: null,
      }),
      // Someone else's personal entry: member-only, never counted.
      entry({
        member_user_id: 'someone-else',
        context_kind: 'personal',
        context_ref: null,
        team_id: null,
        timesheet_id: null,
        timesheet: null,
        payable_seconds: 99999,
      }),
    ];
    const { facade } = await build({ time_entries: rows });

    const out = await facade.dashboardTime(VIEWER, ['p1'], {});

    expect(out.time.total_logs).toBe(8);
    expect(out.time.status_counts).toEqual({
      paid: 2,
      rejected: 1,
      approved: 1,
      pending: 4,
    });
    expect(out.time.sheet_status_counts).toEqual({
      open: 1,
      submitted: 1,
      returned: 1,
      approved: 4,
      personal: 1,
    });
    expect(out.time.total_seconds).toBe(9000);
    expect(out.time.total_hours).toBe(2.5);
  });

  it('filters out other people’s personal entries in the query itself', async () => {
    const { facade, calls } = await build({ time_entries: [entry()] });

    await facade.dashboardTime(VIEWER, ['p1'], {});

    const [call] = entryCalls(calls);
    expect(call.filters).toContainEqual([
      'or',
      '',
      `context_kind.neq.personal,member_user_id.eq.${VIEWER}`,
    ]);
    expect(call.filters).toContainEqual(['in', 'project_id', ['p1']]);
    // Never the per-entry status column (drops in M5); the sheet is embedded by column hint.
    expect(call.select).not.toMatch(/(^|[ ,])status/);
    expect(call.select).toContain('timesheet:timesheets!timesheet_id(status)');
    expect(call.select).not.toContain('_fkey');
    // Money is never in the base read.
    expect(call.select).not.toContain('amount_snapshot');
    expect(call.select).not.toContain('rate_snapshot');
  });

  it('never interpolates a non-UUID caller id into the or() filter', async () => {
    const { facade, calls } = await build({ time_entries: [] });

    await facade.dashboardTime('guest:abc,member_user_id.neq.x', ['p1'], {});

    const [call] = entryCalls(calls);
    expect(call.filters).toContainEqual([
      'or',
      '',
      'context_kind.neq.personal',
    ]);
  });

  it('applies the dashboard filters', async () => {
    const { facade, calls } = await build({ time_entries: [] });

    await facade.dashboardTime(VIEWER, ['p1'], {
      from: '2026-09-01',
      to: '2026-09-30',
      team_id: 'team-1',
      member_user_id: 'member-1',
    });

    const [call] = entryCalls(calls);
    expect(call.filters).toEqual(
      expect.arrayContaining([
        ['gte', 'started_at', '2026-09-01'],
        ['lte', 'started_at', '2026-09-30'],
        ['eq', 'team_id', 'team-1'],
        ['eq', 'member_user_id', 'member-1'],
      ]),
    );
  });

  it('L22 under a person filter: rows whose worker the caller may not name never count (W2 review F1)', async () => {
    const TALENT = '22222222-2222-4222-8222-222222222222';
    const placed = entry({
      id: 'placed',
      member_user_id: TALENT,
      context_kind: 'assignment',
      context_ref: 'asg-1',
      team_id: null,
      engagement_assignment_id: 'asg-1',
      payable_seconds: 3600,
      timesheet: { status: 'approved' },
    });
    const team = entry({ id: 'team-row', member_user_id: TALENT });
    const { facade, authority } = await build({
      time_entries: [placed, team],
    });
    authority.identityVisible.mockImplementation(
      (_viewer: string, rows: Row[]) =>
        Promise.resolve(
          new Set(rows.filter((r) => r.id !== 'placed').map((r) => r.id)),
        ),
    );

    const out = await facade.dashboardTime(VIEWER, ['p1'], {
      member_user_id: TALENT,
    });

    expect(authority.identityVisible).toHaveBeenCalledWith(
      VIEWER,
      expect.arrayContaining([expect.objectContaining({ id: 'placed' })]),
    );
    expect(out.time.total_logs).toBe(1);
    expect(out.time.total_seconds).toBe(0);
    expect(out.time.status_counts).toEqual({
      pending: 1,
      approved: 0,
      paid: 0,
      rejected: 0,
    });
    expect(out.time.sheet_status_counts.approved).toBe(0);

    // Only masked time for that person: every count is zero.
    const onlyPlaced = await build({ time_entries: [placed] });
    onlyPlaced.authority.identityVisible.mockResolvedValue(new Set<string>());
    const none = await onlyPlaced.facade.dashboardTime(VIEWER, ['p1'], {
      member_user_id: TALENT,
    });
    expect(none).toEqual(emptyDashboardTime());
  });

  it('never probes identity without a person filter, for your own person, or without assignment rows', async () => {
    const placed = entry({
      member_user_id: VIEWER,
      context_kind: 'assignment',
      context_ref: 'asg-1',
      team_id: null,
      engagement_assignment_id: 'asg-1',
    });
    const { facade, authority } = await build({
      time_entries: [placed, entry()],
    });

    await facade.dashboardTime(VIEWER, ['p1'], {});
    await facade.dashboardTime(VIEWER, ['p1'], { member_user_id: VIEWER });
    await facade.dashboardTime(VIEWER, ['p1'], { member_user_id: 'member-1' });

    expect(authority.identityVisible).not.toHaveBeenCalled();
  });

  it('pages past PostgREST max-rows and chunks long project lists', async () => {
    const many = Array.from({ length: 1001 }, () => entry());
    const projectIds = Array.from({ length: 150 }, (_, i) =>
      i === 0 ? 'p1' : `px-${i}`,
    );
    const { facade, calls } = await build({ time_entries: many });

    const out = await facade.dashboardTime(VIEWER, projectIds, {});

    expect(out.time.total_logs).toBe(1001);
    const reads = entryCalls(calls);
    // Chunk 1 (100 ids incl. p1): two pages; chunk 2 (50 ids): one page.
    expect(reads).toHaveLength(3);
    expect(reads[0].range).toEqual([0, 999]);
    expect(reads[1].range).toEqual([1000, 1999]);
    expect((reads[2].filters[0][2] as string[]).length).toBe(50);
  });
});

// ── Dashboard: fees ─────────────────────────────────────────────────────────────────────────────────────

describe('TimeProjectsFacade.dashboardTime fees', () => {
  it('sums amount_snapshot over costVisible approved entries only, reading cost only for them', async () => {
    const visible = entry({
      id: 'visible',
      payable_seconds: 3600,
      amount_snapshot: 50.123,
    });
    const hidden = entry({
      id: 'hidden',
      member_user_id: 'member-2',
      payable_seconds: 3600,
      amount_snapshot: 100,
    });
    const rejected = entry({
      id: 'rejected',
      legacy_status: 'rejected',
      payable_seconds: 3600,
      amount_snapshot: 999,
    });
    const pending = entry({ id: 'pending', amount_snapshot: null });
    const { facade, calls, authority } = await build(
      { time_entries: [visible, hidden, rejected, pending] },
      { costVisible: ['visible'] },
    );

    const out = await facade.dashboardTime(VIEWER, ['p1'], {});

    expect(out.time.total_fees).toBe(50.12);
    // Only approved entries are offered to costVisible.
    const offered = (authority.costVisible.mock.calls[0][1] as Row[]).map(
      (r) => r.id,
    );
    expect(offered).toEqual(['hidden', 'visible']);
    expect(authority.costVisible.mock.calls[0][0]).toBe(VIEWER);
    // The cost class is fetched for the visible ids and nothing else.
    const cost = costCalls(calls);
    expect(cost).toHaveLength(1);
    expect(cost[0].filters).toEqual([['in', 'id', ['visible']]]);
  });

  it('reads no cost at all when nothing is costVisible', async () => {
    const { facade, calls } = await build(
      {
        time_entries: [entry({ payable_seconds: 3600, amount_snapshot: 75 })],
      },
      { costVisible: [] },
    );

    const out = await facade.dashboardTime(VIEWER, ['p1'], {});

    expect(out.time.total_fees).toBe(0);
    expect(costCalls(calls)).toHaveLength(0);
  });

  it('never asks costVisible when nothing is approved', async () => {
    const { facade, authority } = await build({ time_entries: [entry()] });
    const out = await facade.dashboardTime(VIEWER, ['p1'], {});
    expect(out.time.total_fees).toBe(0);
    expect(authority.costVisible).not.toHaveBeenCalled();
  });
});

// ── Dashboard: overtime windows ─────────────────────────────────────────────────────────────────────────

describe('TimeProjectsFacade.dashboardTime overtime', () => {
  // 2026-09-06T18:00Z is Sunday in UTC but Monday 02:00 in Manila: the team timezone puts both entries
  // in the week of 2026-09-07, 45 h against a 40 h cap.
  const sundayUtc = () =>
    entry({ started_at: '2026-09-06T18:00:00.000Z', duration_seconds: 36000 });
  const tuesday = () =>
    entry({
      started_at: '2026-09-08T01:00:00.000Z',
      duration_seconds: 126000,
    });

  it('windows per (member, team) in the team policy timezone and week start (D46)', async () => {
    const { facade, policy } = await build(
      { time_entries: [sundayUtc(), tuesday()], team_member_rates: [rate()] },
      { timezone: 'Asia/Manila', weekStart: 1 },
    );

    const out = await facade.dashboardTime(VIEWER, ['p1'], {});

    expect(out.overtime).toEqual({
      over_limit_windows: 1,
      overage_hours_total: 5,
    });
    expect(policy.sheetScopeFor).toHaveBeenCalledWith('team', 'team-1', 'p1');
    expect(policy.resolve).toHaveBeenCalledWith(
      { kind: 'workspace', ref: 'ws-1' },
      'ws-1',
      expect.any(Date),
    );
  });

  it('the same entries in UTC fall in two weeks and stay under the cap', async () => {
    const { facade } = await build(
      { time_entries: [sundayUtc(), tuesday()], team_member_rates: [rate()] },
      { timezone: 'UTC' },
    );
    const out = await facade.dashboardTime(VIEWER, ['p1'], {});
    expect(out.overtime.over_limit_windows).toBe(0);
  });

  it('falls back to UTC weeks when a team policy cannot be read', async () => {
    const { facade } = await build(
      { time_entries: [sundayUtc(), tuesday()], team_member_rates: [rate()] },
      { timezone: 'Asia/Manila', policyFails: true },
    );
    const out = await facade.dashboardTime(VIEWER, ['p1'], {});
    expect(out.overtime.over_limit_windows).toBe(0);
  });

  it('counts weekly and monthly windows separately', async () => {
    const { facade } = await build(
      {
        time_entries: [sundayUtc(), tuesday()],
        team_member_rates: [rate({ monthly_limit_hours: 44 })],
      },
      { timezone: 'Asia/Manila' },
    );
    const out = await facade.dashboardTime(VIEWER, ['p1'], {});
    expect(out.overtime).toEqual({
      over_limit_windows: 2,
      overage_hours_total: 6,
    });
  });

  it('uses the caps in force on the window’s latest entry, never an ended or other-project row', async () => {
    const ended = rate({ id: 'ended', end_date: '2026-08-31' });
    const otherProject = rate({ id: 'other', project_id: 'p2' });
    const { facade } = await build(
      {
        time_entries: [sundayUtc(), tuesday()],
        team_member_rates: [ended, otherProject],
      },
      { timezone: 'Asia/Manila' },
    );
    const out = await facade.dashboardTime(VIEWER, ['p1'], {});
    expect(out.overtime.over_limit_windows).toBe(0);
  });

  it('leaves legacy rejected time and non-team entries out of the windows', async () => {
    const { facade } = await build(
      {
        time_entries: [
          sundayUtc(),
          entry({
            started_at: '2026-09-08T01:00:00.000Z',
            duration_seconds: 126000,
            legacy_status: 'rejected',
          }),
          entry({
            started_at: '2026-09-08T02:00:00.000Z',
            duration_seconds: 126000,
            context_kind: 'workspace',
            context_ref: 'ws-1',
            team_id: null,
            workspace_id: 'ws-1',
          }),
        ],
        team_member_rates: [rate()],
      },
      { timezone: 'Asia/Manila' },
    );
    const out = await facade.dashboardTime(VIEWER, ['p1'], {});
    expect(out.overtime.over_limit_windows).toBe(0);
  });

  it('reads no rates and no policy without team entries', async () => {
    const { facade, calls, policy } = await build({
      time_entries: [
        entry({
          context_kind: 'workspace',
          context_ref: 'ws-1',
          team_id: null,
        }),
      ],
    });
    await facade.dashboardTime(VIEWER, ['p1'], {});
    expect(calls.some((c) => c.table === 'team_member_rates')).toBe(false);
    expect(policy.resolve).not.toHaveBeenCalled();
  });
});

// ── Errors ──────────────────────────────────────────────────────────────────────────────────────────────

describe('TimeProjectsFacade errors', () => {
  it('answers a fixed-copy 500 with no Postgres text (D55)', async () => {
    const { facade } = await build(
      {},
      {
        failures: {
          time_entries: {
            code: '42703',
            message: 'column time_entries.secret does not exist',
          },
        },
      },
    );

    const failure = facade.dashboardTime(VIEWER, ['p1'], {});
    await expect(failure).rejects.toBeInstanceOf(InternalServerErrorException);
    const error = (await failure.catch((e: unknown) => e)) as {
      getResponse(): unknown;
    };
    const body = JSON.stringify(error.getResponse());
    expect(body).toContain(TIME_INTERNAL_CODE);
    expect(body).not.toContain('secret');
  });
});

// ── Roster masking ──────────────────────────────────────────────────────────────────────────────────────

describe('TimeProjectsFacade.maskedWorkerIdsByProject', () => {
  it('asks the authority only for projects that have an assignment and drops empty masks', async () => {
    const { facade, authority, calls } = await build({
      engagement_assignments: [
        { project_id: 'p1' },
        { project_id: 'p1' },
        { project_id: 'p2' },
      ],
    });
    authority.maskedWorkerIds.mockImplementation((projectId: string) =>
      Promise.resolve(
        projectId === 'p1' ? new Set(['talent-1']) : new Set<string>(),
      ),
    );

    const out = await facade.maskedWorkerIdsByProject(
      ['p1', 'p2', 'p3', 'p1'],
      VIEWER,
    );

    expect([...out.keys()]).toEqual(['p1']);
    expect(out.get('p1')).toEqual(new Set(['talent-1']));
    expect(authority.maskedWorkerIds).toHaveBeenCalledTimes(2);
    expect(authority.maskedWorkerIds).toHaveBeenCalledWith('p1', VIEWER);
    expect(authority.maskedWorkerIds).toHaveBeenCalledWith('p2', VIEWER);
    const probe = calls.filter((c) => c.table === 'engagement_assignments');
    expect(probe).toHaveLength(1);
    expect(probe[0].select).toBe('project_id');
  });

  it('issues no query for an empty list', async () => {
    const { facade, calls } = await build();
    await expect(facade.maskedWorkerIdsByProject([], VIEWER)).resolves.toEqual(
      new Map(),
    );
    expect(calls).toHaveLength(0);
  });
});

describe('maskRosterMembers / maskProjectRoster', () => {
  const talent = {
    id: 'row-talent',
    project_id: 'p1',
    user_id: 'talent-1',
    role: 'editor',
    origin: 'engagement',
    position: 'Designer',
    capabilities: { 'time.log': true },
    user: {
      id: 'talent-1',
      display_name: 'Rico Talent',
      avatar_url: 'https://cdn/rico.png',
      email: 'rico@example.com',
      first_name: 'Rico',
      last_name: 'Talent',
    },
  };
  const client = {
    id: 'row-client',
    project_id: 'p1',
    user_id: 'client-1',
    role: 'owner',
    user: { id: 'client-1', display_name: 'Client', email: 'c@example.com' },
  };

  it('reads "Delivery team member" with no avatar, email, name or real id', () => {
    const [maskedRow, clientRow] = maskRosterMembers(
      'p1',
      [talent, client],
      new Set(['talent-1']),
    );

    expect(maskedRow).toEqual({
      ...talent,
      user_id: 'masked:row-talent',
      user: {
        id: 'masked:row-talent',
        display_name: ROSTER_MASKED_LABEL,
        avatar_url: null,
        email: null,
        first_name: null,
        last_name: null,
      },
    });
    expect(JSON.stringify(maskedRow)).not.toMatch(/talent-1|Rico|rico@/);
    // The row id, role and capabilities stay, so a manager can still act on it.
    expect(maskedRow.id).toBe('row-talent');
    expect(maskedRow.role).toBe('editor');
    expect(clientRow).toBe(client);
    expect(ROSTER_MASKED_LABEL).toBe('Delivery team member');
  });

  it('falls back to a per-project position token when the row has no id (list payloads)', () => {
    const listRow = {
      user_id: 'talent-1',
      role: 'editor',
      user: { id: 'talent-1', display_name: 'Rico', headline: 'Designer' },
    };
    const [unmasked, masked] = maskRosterMembers(
      'p1',
      [client, listRow],
      new Set(['talent-1']),
    );
    expect(unmasked).toBe(client);
    expect(masked.user_id).toBe('masked:p1:1');
    expect(masked.user).toEqual({
      id: 'masked:p1:1',
      display_name: ROSTER_MASKED_LABEL,
      avatar_url: null,
      headline: null,
    });
  });

  it('returns the same array for an empty mask and the same project when there is no members list', () => {
    const members = [talent];
    expect(maskRosterMembers('p1', members, new Set())).toBe(members);
    const project = { id: 'p1', title: 'No roster' };
    expect(maskProjectRoster(project, new Set(['talent-1']))).toBe(project);
  });

  it('masks a project payload’s members and keeps everything else', () => {
    const project = {
      id: 'p1',
      title: 'Client project',
      owner: { id: 'client-1', display_name: 'Client' },
      members: [client, talent],
    };
    const out = maskProjectRoster(project, new Set(['talent-1']));
    expect(out.title).toBe('Client project');
    expect(out.owner).toBe(project.owner);
    expect(out.members[0]).toBe(client);
    expect(out.members[1].user.display_name).toBe(ROSTER_MASKED_LABEL);
    // The input is not mutated.
    expect(project.members[1].user.display_name).toBe('Rico Talent');
  });
});

describe('dashboardStatusOf (D03)', () => {
  it.each([
    [{ payout_id: 'po', legacy_status: null, payable_seconds: 3600 }, 'paid'],
    [
      { payout_id: 'po', legacy_status: 'rejected', payable_seconds: 1 },
      'paid',
    ],
    [
      { payout_id: null, legacy_status: 'paid_outside', payable_seconds: null },
      'paid',
    ],
    [
      { payout_id: null, legacy_status: 'rejected', payable_seconds: 3600 },
      'rejected',
    ],
    [{ payout_id: null, legacy_status: null, payable_seconds: 0 }, 'approved'],
    [
      { payout_id: null, legacy_status: null, payable_seconds: '90' },
      'approved',
    ],
    [
      { payout_id: null, legacy_status: null, payable_seconds: null },
      'pending',
    ],
  ] as const)('%j → %s', (row, expected) => {
    expect(dashboardStatusOf(row as never)).toBe(expected);
  });
});
