import {
  BadRequestException,
  ConflictException,
  HttpException,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import { EngagementsService } from '../../marketplace/engagements/engagements.service';
import { EntitlementsService } from '../../shared/entitlements/entitlements.service';
import { TimeAuthorityService } from './time-authority.service';
import { TimeNotificationsService } from './time-notifications.service';
import { TimePolicyService } from './time-policy.service';
import { TimeRatesService } from './time-rates.service';
import {
  FLAGS_BUDGET_MS,
  NO_CONTEXT_POLICY,
  TIMESHEET_NOTE_REQUIRED_MESSAGE,
  TimesheetsService,
  contextPolicyFields,
  isTransitionRefusal,
  reminderDaysOf,
} from './timesheets.service';
import type { EntryAuthRow, TimeEntryView, TimesheetRow } from './time.types';

// ── ids ─────────────────────────────────────────────────────────────────────
const uid = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const MEMBER = uid(1);
const DECIDER = uid(2);
const OUTSIDER = uid(3);
const MANAGER = uid(4);
const WS = uid(10);
const WS_OTHER = uid(11);
const TEAM = uid(20);
const ENG = uid(30);
const ASSIGN = uid(31);
const PROJECT = uid(40);
const S1 = uid(100);
const S2 = uid(101);
const S3 = uid(102);
const E1 = uid(200);
const E2 = uid(201);
const E3 = uid(202);
const E4 = uid(203);

type Row = Record<string, unknown>;

// ── a PostgREST stand-in: filters, order, range/limit, recorded writes ──────
interface Mutation {
  table: string;
  op: 'insert' | 'update' | 'upsert' | 'delete';
  value?: unknown;
  opts?: unknown;
}

/** Top-level columns of a select string (embeds become their alias, if the row carries it). */
function project(row: Row, select: string | null): Row {
  if (!select || select.trim() === '*') return { ...row };
  const out: Row = {};
  let depth = 0;
  let cur = '';
  const tokens: string[] = [];
  for (const ch of select) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      tokens.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) tokens.push(cur.trim());
  for (const token of tokens) {
    // A JSON path (`alias:column->key`), as PostgREST answers it: the key's value under the alias (else the key).
    const path = /^(?:(\w+):)?(\w+)->>?(\w+)$/.exec(token);
    if (path) {
      const [, alias, column, field] = path;
      const value = row[column];
      out[alias ?? field] =
        value && typeof value === 'object' && !Array.isArray(value)
          ? ((value as Row)[field] ?? null)
          : null;
      continue;
    }
    const key = token.split('(')[0].split(':')[0].split('!')[0].trim();
    out[key] = row[key] ?? null;
  }
  return out;
}

function fakeDb(
  tables: Record<string, Row[]>,
  rpcs: Record<string, (args: Row) => { data?: unknown; error?: unknown }>,
) {
  const mutations: Mutation[] = [];
  const failures: Record<string, unknown> = {};
  const from = jest.fn((table: string) => {
    const preds: Array<(r: Row) => boolean> = [];
    const orders: Array<{ col: string; asc: boolean }> = [];
    let lim: number | null = null;
    let rng: [number, number] | null = null;
    let single = false;
    let selected: string | null = null;
    let op: 'select' | Mutation['op'] = 'select';
    const str = (v: unknown): string | null =>
      v === null || v === undefined
        ? null
        : typeof v === 'object'
          ? JSON.stringify(v)
          : String(v as string | number | boolean);
    const chain: any = {
      select: (sel?: string) => {
        if (op === 'select') selected = sel ?? null;
        return chain;
      },
      eq: (c: string, v: unknown) => {
        preds.push((r) => r[c] === v);
        return chain;
      },
      neq: (c: string, v: unknown) => {
        preds.push((r) => r[c] !== v);
        return chain;
      },
      in: (c: string, vs: unknown[]) => {
        preds.push((r) => vs.includes(r[c]));
        return chain;
      },
      is: (c: string, v: unknown) => {
        preds.push((r) =>
          v === null ? r[c] === null || r[c] === undefined : r[c] === v,
        );
        return chain;
      },
      not: (c: string, o: string, v: unknown) => {
        if (o === 'is' && v === null) {
          preds.push((r) => r[c] !== null && r[c] !== undefined);
        }
        return chain;
      },
      gte: (c: string, v: unknown) => {
        preds.push((r) => str(r[c]) !== null && str(r[c])! >= String(v));
        return chain;
      },
      gt: (c: string, v: unknown) => {
        preds.push((r) => str(r[c]) !== null && str(r[c])! > String(v));
        return chain;
      },
      lte: (c: string, v: unknown) => {
        preds.push((r) => str(r[c]) !== null && str(r[c])! <= String(v));
        return chain;
      },
      lt: (c: string, v: unknown) => {
        preds.push((r) => str(r[c]) !== null && str(r[c])! < String(v));
        return chain;
      },
      order: (c: string, o?: { ascending?: boolean }) => {
        orders.push({ col: c, asc: o?.ascending !== false });
        return chain;
      },
      limit: (n: number) => {
        lim = n;
        return chain;
      },
      range: (a: number, b: number) => {
        rng = [a, b];
        return chain;
      },
      maybeSingle: () => {
        single = true;
        return chain;
      },
      insert: (value: unknown) => {
        op = 'insert';
        mutations.push({ table, op, value });
        return chain;
      },
      update: (value: unknown) => {
        op = 'update';
        mutations.push({ table, op, value });
        return chain;
      },
      upsert: (value: unknown, opts?: unknown) => {
        op = 'upsert';
        mutations.push({ table, op, value, opts });
        return chain;
      },
      delete: () => {
        op = 'delete';
        mutations.push({ table, op });
        return chain;
      },
    };
    const exec = () => {
      if (failures[table]) return { data: null, error: failures[table] };
      if (op !== 'select') return { data: null, error: null };
      let rows = (tables[table] ?? []).filter((r) => preds.every((p) => p(r)));
      rows = [...rows].sort((a, b) => {
        for (const o of orders) {
          const av = str(a[o.col]) ?? '';
          const bv = str(b[o.col]) ?? '';
          if (av !== bv) return (av < bv ? -1 : 1) * (o.asc ? 1 : -1);
        }
        return 0;
      });
      if (rng) rows = rows.slice(rng[0], rng[1] + 1);
      if (lim !== null) rows = rows.slice(0, lim);
      rows = rows.map((r) => project(r, selected));
      if (single) return { data: rows[0] ?? null, error: null };
      return { data: rows, error: null };
    };
    chain.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
      Promise.resolve(exec()).then(ok, ko);
    return chain;
  });
  const rpc = jest.fn((name: string, args: Row) => {
    const handler = rpcs[name];
    const out = handler ? handler(args) : { data: null };
    return Promise.resolve({
      data: out.data ?? null,
      error: out.error ?? null,
    });
  });
  return {
    client: { from, rpc } as unknown as SupabaseClient,
    from,
    rpc,
    mutations,
    failures,
    tables,
  };
}

// ── fixtures ────────────────────────────────────────────────────────────────
function sheet(
  over: Partial<TimesheetRow> & { policy_snapshot?: unknown },
): Row {
  return {
    id: S1,
    member_user_id: MEMBER,
    member_display_name_snapshot: 'Maria',
    scope_kind: 'workspace',
    scope_ref: WS,
    team_id: null,
    workspace_id: WS,
    engagement_id: null,
    scope_label_snapshot: 'Acme',
    policy_workspace_id: WS,
    period_kind: 'weekly',
    period_start: '2026-09-14',
    period_end: '2026-09-20',
    timezone: 'UTC',
    week_start: 1,
    status: 'submitted',
    approver_scope: 'workspace',
    revision: 3,
    submitted_at: '2026-09-21T01:00:00.000Z',
    submitted_by: MEMBER,
    submission_kind: 'manual',
    decided_at: null,
    decided_by: null,
    decision_kind: null,
    decision_note: null,
    overtime_approved: false,
    total_seconds: 7200,
    payable_seconds: null,
    origin: 'app',
    created_at: '2026-09-14T01:00:00.000Z',
    updated_at: '2026-09-21T01:00:00.000Z',
    policy_snapshot: {
      rounding_minutes: 0,
      weekly_limit_minutes: null,
      sources: {},
      routing: {
        base: 'workspace',
        cost_money: false,
        deciders_count: 1,
        fallback: 'none',
      },
    },
    ...over,
  };
}

function entry(over: Row): Row {
  return {
    id: E1,
    member_user_id: MEMBER,
    project_id: PROJECT,
    context_kind: 'workspace',
    context_ref: WS,
    team_id: null,
    workspace_id: WS,
    engagement_assignment_id: null,
    timesheet_id: S1,
    started_at: '2026-09-15T09:00:00.000Z',
    ended_at: '2026-09-15T10:00:00.000Z',
    duration_seconds: 3600,
    work_type_snapshot: 'real_work',
    created_at: '2026-09-15T09:00:00.000Z',
    rate_snapshot: 0,
    rate_type_snapshot: 'hourly',
    currency_snapshot: 'USD',
    legacy_status: null,
    payable_seconds: null,
    ...over,
  };
}

const HOUR = 3600;

interface Mocks {
  authority: Record<string, jest.Mock>;
  policy: Record<string, jest.Mock>;
  rates: Record<string, jest.Mock>;
  notifications: Record<string, jest.Mock>;
  engagements: Record<string, jest.Mock>;
  entitlements: Record<string, jest.Mock>;
}

function defaultMocks(): Mocks {
  return {
    authority: {
      assertViewTimesheet: jest.fn(),
      canViewTimesheet: jest.fn(() => Promise.resolve(true)),
      canDecide: jest.fn(() => Promise.resolve(false)),
      isTeamManager: jest.fn(() => Promise.resolve(false)),
      approversFor: jest.fn(() => Promise.resolve([DECIDER])),
      costVisible: jest.fn(() => Promise.resolve(new Set<string>())),
      hydrate: jest.fn((_v: string, rows: EntryAuthRow[]) =>
        Promise.resolve(rows.map((r) => view(r))),
      ),
    },
    policy: {
      resolve: jest.fn(() =>
        Promise.resolve({
          rounding_minutes: 0,
          weekly_limit_minutes: null,
          reminder_days: 1,
          sources: {},
        }),
      ),
      ensureWorkspacePolicy: jest.fn(() => Promise.resolve(uid(999))),
      sheetScopeFor: jest.fn(() => Promise.resolve(null)),
    },
    rates: {
      legacyCutoff: jest.fn(() => Promise.resolve(null)),
      freezeRate: jest.fn(() =>
        Promise.resolve({
          rate: 0,
          rateType: 'hourly',
          currency: 'USD',
          amountable: true,
        }),
      ),
      memberCaps: jest.fn(() => Promise.resolve(null)),
    },
    notifications: {
      sheetSubmitted: jest.fn(() => Promise.resolve(undefined)),
      sheetDecided: jest.fn(() => Promise.resolve(undefined)),
      reopenRequested: jest.fn(() => Promise.resolve(undefined)),
    },
    engagements: {
      settingsInForceOn: jest.fn(() => Promise.resolve(null)),
    },
    entitlements: {
      hasFeature: jest.fn(() => Promise.resolve(true)),
    },
  };
}

function view(
  r: EntryAuthRow,
  over: Partial<TimeEntryView> = {},
): TimeEntryView {
  return {
    id: r.id,
    context_kind: r.context_kind,
    context_ref: r.context_ref,
    context_label_snapshot: null,
    timesheet_id: r.timesheet_id,
    work_item: 'task',
    started_at: r.started_at,
    ended_at: '2026-09-15T10:00:00.000Z',
    paused_at: null,
    duration_seconds: 3600,
    break_seconds: 0,
    break_minutes: 0,
    payable_seconds: null,
    source: 'manual',
    work_type_snapshot: 'real_work',
    legacy_status: null,
    payout_id: null,
    flagged_reason: null,
    project_id: r.project_id,
    team_id: r.team_id,
    workspace_id: r.workspace_id,
    engagement_assignment_id: r.engagement_assignment_id,
    created_at: r.started_at,
    updated_at: r.started_at,
    timesheet: null,
    locked_reason: null,
    identity: 'visible',
    member_user_id: r.member_user_id,
    member_display_name_snapshot: null,
    member: null,
    member_label: null,
    content: 'visible',
    task_id: null,
    note: null,
    task: null,
    project: null,
    content_label: null,
    cost: 'hidden',
    ...over,
  };
}

async function build(
  tables: Record<string, Row[]>,
  rpcs: Record<string, (args: Row) => { data?: unknown; error?: unknown }> = {},
  mocks: Mocks = defaultMocks(),
) {
  const db = fakeDb(tables, rpcs);
  const moduleRef = await Test.createTestingModule({
    providers: [
      TimesheetsService,
      { provide: SUPABASE_ADMIN, useValue: db.client },
      { provide: TimeAuthorityService, useValue: mocks.authority },
      { provide: TimePolicyService, useValue: mocks.policy },
      { provide: TimeRatesService, useValue: mocks.rates },
      { provide: TimeNotificationsService, useValue: mocks.notifications },
      { provide: EngagementsService, useValue: mocks.engagements },
      { provide: EntitlementsService, useValue: mocks.entitlements },
    ],
  }).compile();
  return { service: moduleRef.get(TimesheetsService), db, ...mocks };
}

/** The transition RPC answering with the given sheet rows (or an error). */
function transitionReturning(
  rows: Row[] | ((args: Row) => { data?: unknown; error?: unknown }),
) {
  return {
    time_timesheet_transition:
      typeof rows === 'function' ? rows : () => ({ data: rows }),
  };
}

function transitionCalls(db: ReturnType<typeof fakeDb>): Row[] {
  return db.rpc.mock.calls
    .filter((c) => c[0] === 'time_timesheet_transition')
    .map((c) => c[1]);
}

function codeOf(e: unknown): unknown {
  return e instanceof HttpException ? (e.getResponse() as Row).code : undefined;
}

beforeAll(() => {
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});

// Every test: TypeScript never writes a timesheet (status, decision, freeze columns change only in the RPC).
let lastDb: ReturnType<typeof fakeDb> | null = null;
afterEach(() => {
  if (lastDb) {
    expect(lastDb.mutations.filter((m) => m.table === 'timesheets')).toEqual(
      [],
    );
  }
  lastDb = null;
});

async function setup(
  tables: Record<string, Row[]>,
  rpcs: Record<string, (args: Row) => { data?: unknown; error?: unknown }> = {},
  mocks: Mocks = defaultMocks(),
) {
  const built = await build(tables, rpcs, mocks);
  lastDb = built.db;
  return built;
}

// ── act ─────────────────────────────────────────────────────────────────────
describe('TimesheetsService.act', () => {
  it('calls the transition with exactly the §2.10 keys and a p_freeze keyed by sheet then entry', async () => {
    const open = sheet({
      status: 'open',
      approver_scope: null,
      revision: 3,
      policy_snapshot: {},
    });
    const after = sheet({ status: 'submitted', revision: 4 });
    const { service, db, policy } = await setup(
      {
        timesheets: [open],
        time_entries: [
          entry({
            id: E2,
            started_at: '2026-09-16T09:00:00.000Z',
            duration_seconds: 1800,
          }),
          entry({ id: E1 }),
        ],
      },
      transitionReturning([after]),
    );

    const rows = await service.act(MEMBER, 'submit', [S1], [3]);

    const [args] = transitionCalls(db);
    expect(Object.keys(args).sort()).toEqual(
      [
        'p_action',
        'p_actor',
        'p_approve_overtime',
        'p_expected_revisions',
        'p_freeze',
        'p_ids',
        'p_note',
      ].sort(),
    );
    expect(args).toMatchObject({
      p_ids: [S1],
      p_actor: MEMBER,
      p_action: 'submit',
      p_expected_revisions: [3],
      p_note: null,
      p_approve_overtime: false,
    });
    expect(args.p_freeze).toEqual({
      [S1]: {
        [E1]: {
          payable_seconds: 3600,
          rate_snapshot: 0,
          rate_type_snapshot: 'hourly',
          currency_snapshot: 'USD',
          amount_snapshot: 0,
        },
        [E2]: {
          payable_seconds: 1800,
          rate_snapshot: 0,
          rate_type_snapshot: 'hourly',
          currency_snapshot: 'USD',
          amount_snapshot: 0,
        },
      },
    });
    // Submit freezes with the policy as the RPC is about to snapshot it: resolved at period start.
    expect(policy.resolve).toHaveBeenCalledWith(
      { kind: 'workspace', ref: WS },
      WS,
      new Date('2026-09-14T00:00:00.000Z'),
    );
    // The RPC's full row is narrowed to TimesheetRow (no policy_snapshot).
    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toHaveProperty('policy_snapshot');
    expect(rows[0]).toMatchObject({ id: S1, status: 'submitted', revision: 4 });
  });

  it('sends no freeze for actions that cannot end approved', async () => {
    const { service, db } = await setup(
      { timesheets: [sheet({})] },
      transitionReturning([sheet({ status: 'open', approver_scope: null })]),
    );
    await service.act(MEMBER, 'withdraw', [S1], [3]);
    expect(transitionCalls(db)[0]).toMatchObject({
      p_action: 'withdraw',
      p_freeze: null,
    });
  });

  it.each(['return'] as const)(
    '%s without a note is a 400 before any read or RPC',
    async (action) => {
      const { service, db } = await setup({ timesheets: [sheet({})] });
      for (const note of [undefined, '', '   ']) {
        await expect(
          service.act(DECIDER, action, [S1], [3], { note }),
        ).rejects.toThrow(
          new BadRequestException(TIMESHEET_NOTE_REQUIRED_MESSAGE),
        );
      }
      expect(db.rpc).not.toHaveBeenCalled();
      expect(db.from).not.toHaveBeenCalled();
    },
  );

  it('decider reopen without a note is a 400 before the RPC; the member path needs none', async () => {
    const approved = sheet({ status: 'approved', decision_kind: 'manual' });
    const { service, db } = await setup(
      { timesheets: [approved] },
      transitionReturning([sheet({ status: 'returned' })]),
    );
    await expect(
      service.act(DECIDER, 'reopen', [S1], [3]),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(transitionCalls(db)).toHaveLength(0);

    await service.act(MEMBER, 'reopen', [S1], [3]);
    expect(transitionCalls(db)).toHaveLength(1);
  });

  it('a note-less reopen on a sheet the actor cannot open is a 404, never the 400', async () => {
    const mocks = defaultMocks();
    mocks.authority.canViewTimesheet.mockResolvedValue(false);
    const { service, db } = await setup(
      { timesheets: [sheet({ status: 'approved' })] },
      {},
      mocks,
    );
    await expect(
      service.act(OUTSIDER, 'reopen', [S1], [3]),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('rejects mismatched or missing expected revisions with a 400', async () => {
    const { service, db } = await setup({ timesheets: [sheet({})] });
    await expect(
      service.act(DECIDER, 'approve', [S1], [3, 4]),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.act(DECIDER, 'approve', [S1], null),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.act(DECIDER, 'approve', [], []),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.act(DECIDER, 'approve', [S1, S1], [3, 3]),
    ).rejects.toBeInstanceOf(BadRequestException);
    // A NULL actor only for auto_submit, submit_on_deletion and approve (D09).
    await expect(
      service.act(null, 'return', [S1], null, { note: 'x' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('a missing sheet is a 404 before the RPC', async () => {
    const { service, db } = await setup({ timesheets: [] });
    await expect(
      service.act(MEMBER, 'withdraw', [S1], [1]),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('maps STALE_REVISION to 409 with its detail as extras', async () => {
    const { service } = await setup(
      { timesheets: [sheet({})] },
      transitionReturning(() => ({
        error: {
          message: 'STALE_REVISION',
          details: JSON.stringify({ timesheet_id: S1, expected: 2, actual: 3 }),
        },
      })),
    );
    const err = await service
      .act(DECIDER, 'withdraw', [S1], [2])
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as HttpException).getResponse()).toMatchObject({
      code: 'STALE_REVISION',
      timesheet_id: S1,
      expected: 2,
      actual: 3,
    });
  });

  it('maps TIMESHEET_TRANSITION_INVALID to 409 with its reason', async () => {
    const { service } = await setup(
      { timesheets: [sheet({ status: 'open' })] },
      transitionReturning(() => ({
        error: {
          message: 'TIMESHEET_TRANSITION_INVALID',
          details: JSON.stringify({ reason: 'too_early', timesheet_id: S1 }),
        },
      })),
    );
    const err = await service
      .act(MEMBER, 'submit', [S1], [3])
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(isTransitionRefusal(err, ['too_early'])).toBe(true);
    expect(isTransitionRefusal(err, ['not_auto'])).toBe(false);
  });

  it('retries a deadlock once', async () => {
    let n = 0;
    const { service, db } = await setup(
      { timesheets: [sheet({})] },
      transitionReturning(() =>
        ++n === 1
          ? { error: { code: '40P01', message: 'deadlock detected' } }
          : { data: [sheet({ status: 'returned' })] },
      ),
    );
    const rows = await service.act(DECIDER, 'return', [S1], [3], {
      note: 'Fix Tuesday',
    });
    expect(rows[0].status).toBe('returned');
    expect(transitionCalls(db)).toHaveLength(2);
    expect(transitionCalls(db)[1].p_note).toBe('Fix Tuesday');
  });

  it('a second deadlock is a fixed-copy 500 (no Postgres text)', async () => {
    const { service, db } = await setup(
      { timesheets: [sheet({})] },
      transitionReturning(() => ({
        error: { code: '40P01', message: 'deadlock detected on relation 123' },
      })),
    );
    const err = await service
      .act(DECIDER, 'return', [S1], [3], { note: 'x' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InternalServerErrorException);
    expect(JSON.stringify((err as HttpException).getResponse())).not.toContain(
      'deadlock',
    );
    expect(transitionCalls(db)).toHaveLength(2);
  });

  it('a system actor rebuilds the freeze and retries once on STALE_REVISION entry_set', async () => {
    let n = 0;
    const tables = {
      timesheets: [
        sheet({ status: 'open', approver_scope: null, policy_snapshot: {} }),
      ],
      time_entries: [entry({})],
    };
    const { service, db } = await setup(
      tables,
      transitionReturning(() => {
        n += 1;
        if (n === 1) {
          // An entry landed meanwhile; the second build must include it.
          tables.time_entries.push(
            entry({ id: E2, started_at: '2026-09-16T09:00:00.000Z' }),
          );
          return {
            error: {
              message: 'STALE_REVISION',
              details: JSON.stringify({
                reason: 'entry_set',
                timesheet_id: S1,
              }),
            },
          };
        }
        return {
          data: [
            sheet({
              status: 'approved',
              approver_scope: 'self',
              decision_kind: 'self',
            }),
          ],
        };
      }),
    );
    await service.act(null, 'auto_submit', [S1], null);
    const calls = transitionCalls(db);
    expect(calls).toHaveLength(2);
    expect(Object.keys((calls[0].p_freeze as Row)[S1] as Row)).toEqual([E1]);
    expect(Object.keys((calls[1].p_freeze as Row)[S1] as Row).sort()).toEqual(
      [E1, E2].sort(),
    );
    expect(calls[1]).toMatchObject({
      p_actor: null,
      p_expected_revisions: null,
    });
  });

  it('a person never auto-retries an entry_set refusal (409)', async () => {
    const { service, db } = await setup(
      { timesheets: [sheet({ status: 'open' })], time_entries: [entry({})] },
      transitionReturning(() => ({
        error: {
          message: 'STALE_REVISION',
          details: JSON.stringify({ reason: 'entry_set', timesheet_id: S1 }),
        },
      })),
    );
    const err = await service
      .act(MEMBER, 'submit', [S1], [3])
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect((err as HttpException).getResponse()).toMatchObject({
      reason: 'entry_set',
    });
    expect(transitionCalls(db)).toHaveLength(1);
  });

  it('only approve forwards approve_overtime; a chained submit never approves overtime', async () => {
    const { service, db } = await setup(
      { timesheets: [sheet({ status: 'open' })], time_entries: [entry({})] },
      transitionReturning([sheet({ status: 'submitted' })]),
    );
    await service.act(MEMBER, 'submit', [S1], [3], { approveOvertime: true });
    expect(transitionCalls(db)[0].p_approve_overtime).toBe(false);
  });
});

describe('TimesheetsService notifications (one per transition)', () => {
  it('a manual-route submit notifies the deciders it routed to', async () => {
    const after = sheet({ status: 'submitted', approver_scope: 'workspace' });
    const { service, notifications, authority } = await setup(
      {
        timesheets: [sheet({ status: 'open', approver_scope: null })],
        time_entries: [entry({})],
      },
      transitionReturning([after]),
    );
    await service.act(MEMBER, 'submit', [S1], [3]);
    expect(authority.approversFor).toHaveBeenCalledWith(S1);
    expect(notifications.sheetSubmitted).toHaveBeenCalledTimes(1);
    expect(notifications.sheetSubmitted.mock.calls[0][0]).toMatchObject({
      id: S1,
      status: 'submitted',
    });
    expect(notifications.sheetSubmitted.mock.calls[0].slice(1)).toEqual([
      [DECIDER],
      MEMBER,
    ]);
    expect(notifications.sheetDecided).not.toHaveBeenCalled();
  });

  it('D63: an auto/self route calls sheetSubmitted with no recipients, then the approval once', async () => {
    const after = sheet({
      status: 'approved',
      approver_scope: 'self',
      decision_kind: 'self',
    });
    const { service, notifications } = await setup(
      {
        timesheets: [sheet({ status: 'open', approver_scope: null })],
        time_entries: [entry({})],
      },
      transitionReturning([after]),
    );
    await service.act(MEMBER, 'submit', [S1], [3]);
    expect(notifications.sheetSubmitted).toHaveBeenCalledTimes(1);
    expect(notifications.sheetSubmitted.mock.calls[0].slice(1)).toEqual([
      [],
      MEMBER,
    ]);
    expect(notifications.sheetDecided).toHaveBeenCalledTimes(1);
    expect(notifications.sheetDecided.mock.calls[0].slice(1)).toEqual([
      'approve',
      MEMBER,
      [],
    ]);
  });

  it('approve, return and withdraw pass the deciders read BEFORE the RPC', async () => {
    for (const [action, to, note] of [
      ['approve', 'approved', undefined],
      ['return', 'returned', 'Fix Tuesday'],
      ['withdraw', 'open', undefined],
    ] as const) {
      const order: string[] = [];
      const mocks = defaultMocks();
      mocks.authority.approversFor.mockImplementation(() => {
        order.push('deciders');
        return Promise.resolve([DECIDER]);
      });
      const { service, notifications } = await setup(
        { timesheets: [sheet({})], time_entries: [entry({})] },
        transitionReturning(() => {
          order.push('rpc');
          return { data: [sheet({ status: to })] };
        }),
        mocks,
      );
      const actor = action === 'withdraw' ? MEMBER : DECIDER;
      await service.act(actor, action, [S1], [3], { note });
      expect(order).toEqual(['deciders', 'rpc']);
      expect(notifications.sheetDecided).toHaveBeenCalledTimes(1);
      expect(notifications.sheetDecided.mock.calls[0].slice(1)).toEqual([
        action,
        actor,
        [DECIDER],
      ]);
      expect(notifications.sheetSubmitted).not.toHaveBeenCalled();
    }
  });

  it('a decider reopen notifies; the member reopening their own auto/self sheet does not', async () => {
    const approved = sheet({
      status: 'approved',
      approver_scope: 'workspace',
      decision_kind: 'manual',
    });
    const a = await setup(
      { timesheets: [approved] },
      transitionReturning([sheet({ status: 'returned' })]),
    );
    await a.service.act(DECIDER, 'reopen', [S1], [3], { note: 'Wrong week' });
    expect(a.notifications.sheetDecided).toHaveBeenCalledTimes(1);
    expect(a.notifications.sheetDecided.mock.calls[0][1]).toBe('reopen');

    const own = sheet({
      status: 'approved',
      approver_scope: 'self',
      decision_kind: 'self',
    });
    const b = await setup(
      { timesheets: [own] },
      transitionReturning([sheet({ status: 'open', approver_scope: null })]),
    );
    await b.service.act(MEMBER, 'reopen', [S1], [3]);
    expect(b.notifications.sheetDecided).not.toHaveBeenCalled();
  });

  it('request_reopen tells the deciders', async () => {
    const { service, notifications } = await setup(
      { timesheets: [sheet({ status: 'approved', decision_kind: 'manual' })] },
      transitionReturning([
        sheet({ status: 'approved', decision_kind: 'manual', revision: 4 }),
      ]),
    );
    await service.act(MEMBER, 'request_reopen', [S1], [3], {
      note: 'Forgot Friday',
    });
    expect(notifications.reopenRequested).toHaveBeenCalledTimes(1);
    expect(notifications.reopenRequested.mock.calls[0].slice(1)).toEqual([
      [DECIDER],
      MEMBER,
    ]);
  });

  it('a failed decider lookup after the RPC never fails the committed transition', async () => {
    const mocks = defaultMocks();
    mocks.authority.approversFor.mockRejectedValue(new Error('boom'));
    const { service, notifications } = await setup(
      { timesheets: [sheet({ status: 'open' })], time_entries: [entry({})] },
      transitionReturning([sheet({ status: 'submitted' })]),
      mocks,
    );
    await expect(
      service.act(MEMBER, 'submit', [S1], [3]),
    ).resolves.toHaveLength(1);
    expect(notifications.sheetSubmitted.mock.calls[0][1]).toEqual([]);
  });
});

describe('TimesheetsService.approveBulk', () => {
  it('sends one RPC call for the whole batch and notifies once per sheet', async () => {
    const sheets = [sheet({ id: S1 }), sheet({ id: S2, revision: 7 })];
    const { service, db, notifications } = await setup(
      {
        timesheets: sheets,
        time_entries: [
          entry({ id: E1, timesheet_id: S1 }),
          entry({ id: E2, timesheet_id: S2 }),
        ],
      },
      transitionReturning([
        sheet({ id: S1, status: 'approved' }),
        sheet({ id: S2, status: 'approved' }),
      ]),
    );
    const rows = await service.approveBulk(DECIDER, {
      ids: [S2, S1],
      expected_revisions: [7, 3],
      note: 'Thanks',
      approve_overtime: true,
    });
    const calls = transitionCalls(db);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      p_ids: [S2, S1],
      p_expected_revisions: [7, 3],
      p_action: 'approve',
      p_note: 'Thanks',
      p_approve_overtime: true,
    });
    expect(Object.keys(calls[0].p_freeze as Row).sort()).toEqual(
      [S1, S2].sort(),
    );
    expect(rows).toHaveLength(2);
    expect(notifications.sheetDecided).toHaveBeenCalledTimes(2);
  });

  it('decisions never consult the plan, so a downgraded workspace can still approve, return and bulk-approve (E11)', async () => {
    const mocks = defaultMocks();
    mocks.entitlements.hasFeature.mockImplementation(() =>
      Promise.resolve(false),
    );
    const { service, db } = await setup(
      {
        timesheets: [sheet({ id: S1 }), sheet({ id: S2, revision: 7 })],
        time_entries: [
          entry({ id: E1, timesheet_id: S1 }),
          entry({ id: E2, timesheet_id: S2 }),
        ],
      },
      transitionReturning([sheet({ id: S1, status: 'approved' })]),
      mocks,
    );

    await service.act(DECIDER, 'approve', [S1], [3]);
    await service.act(DECIDER, 'return', [S1], [3], { note: 'Fix Tuesday' });
    await service.approveBulk(DECIDER, {
      ids: [S1, S2],
      expected_revisions: [3, 7],
    });

    expect(transitionCalls(db).map((c) => c.p_action)).toEqual([
      'approve',
      'return',
      'approve',
    ]);
    expect(mocks.entitlements.hasFeature).not.toHaveBeenCalled();
  });

  it('ids and revisions of different lengths are a 400', async () => {
    const { service, db } = await setup({ timesheets: [] });
    await expect(
      service.approveBulk(DECIDER, { ids: [S1, S2], expected_revisions: [1] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.rpc).not.toHaveBeenCalled();
  });
});

// ── the freeze ──────────────────────────────────────────────────────────────
describe('TimesheetsService.buildFreeze', () => {
  it('approve rounds from policy_snapshot (nearest, ties up) and prices from the re-resolved rate', async () => {
    const mocks = defaultMocks();
    mocks.rates.freezeRate.mockResolvedValue({
      rate: 500,
      rateType: 'hourly',
      currency: 'PHP',
      amountable: true,
    });
    const { service, policy, rates } = await setup(
      {
        timesheets: [
          sheet({
            policy_snapshot: {
              rounding_minutes: 15,
              weekly_limit_minutes: null,
              sources: {},
            },
          }),
        ],
        time_entries: [
          // 52m30s → ties up to 60m; 7m → 0; 1h05m → 1h
          entry({ id: E1, duration_seconds: 3150 }),
          entry({
            id: E2,
            started_at: '2026-09-15T11:00:00.000Z',
            duration_seconds: 420,
          }),
          entry({
            id: E3,
            started_at: '2026-09-15T12:00:00.000Z',
            duration_seconds: 3900,
          }),
        ],
      },
      {},
      mocks,
    );
    const { payload, preview } = await service.buildFreeze([S1], {
      approveOvertime: false,
      mode: 'approve',
    });
    expect(policy.resolve).not.toHaveBeenCalled();
    expect(payload[S1][E1]).toEqual({
      payable_seconds: 3600,
      rate_snapshot: 500,
      rate_type_snapshot: 'hourly',
      currency_snapshot: 'PHP',
      amount_snapshot: 500,
    });
    expect(payload[S1][E2].payable_seconds).toBe(0);
    expect(payload[S1][E3]).toMatchObject({
      payable_seconds: 3600,
      amount_snapshot: 500,
    });
    expect(preview[S1].entries.map((p) => p.entry_id)).toEqual([E1, E2, E3]);
    expect(preview[S1]).not.toHaveProperty('amounts_by_currency');
    // The local date of each entry in the sheet timezone, with the legacy cut-off.
    expect(rates.freezeRate.mock.calls[0].slice(1)).toEqual([
      '2026-09-15',
      null,
    ]);
  });

  it('a fixed rate and a non-amountable rate freeze with amount NULL; a legacy rejected entry pays 0', async () => {
    const mocks = defaultMocks();
    mocks.rates.freezeRate.mockImplementation((e: Row) =>
      Promise.resolve(
        e.context_kind === 'team'
          ? {
              rate: 8000,
              rateType: 'fixed',
              currency: 'PHP',
              amountable: false,
            }
          : { rate: 0, rateType: 'hourly', currency: 'USD', amountable: false },
      ),
    );
    const { service } = await setup(
      {
        timesheets: [sheet({})],
        time_entries: [
          entry({
            id: E1,
            context_kind: 'team',
            context_ref: TEAM,
            team_id: TEAM,
            workspace_id: null,
          }),
          entry({ id: E2, started_at: '2026-09-15T11:00:00.000Z' }),
          entry({
            id: E3,
            started_at: '2026-09-15T12:00:00.000Z',
            legacy_status: 'rejected',
          }),
        ],
      },
      {},
      mocks,
    );
    const { payload } = await service.buildFreeze([S1], {
      approveOvertime: false,
      mode: 'approve',
    });
    expect(payload[S1][E1]).toMatchObject({
      rate_type_snapshot: 'fixed',
      amount_snapshot: null,
      payable_seconds: 3600,
    });
    expect(payload[S1][E2].amount_snapshot).toBeNull();
    expect(payload[S1][E3].payable_seconds).toBe(0);
  });

  it('team member caps: weekly limit cuts the latest entry; approve_overtime keeps rounded and still reports over', async () => {
    const mocks = defaultMocks();
    mocks.rates.memberCaps.mockResolvedValue({
      weekly_limit_hours: 10,
      monthly_limit_hours: null,
      overtime_requires_approval: true,
    });
    const tables = {
      timesheets: [
        sheet({
          scope_kind: 'team',
          scope_ref: TEAM,
          team_id: TEAM,
          workspace_id: null,
          approver_scope: 'team',
        }),
      ],
      time_entries: [
        entry({
          id: E2,
          context_kind: 'team',
          context_ref: TEAM,
          team_id: TEAM,
          started_at: '2026-09-16T09:00:00.000Z',
          duration_seconds: 6 * HOUR,
        }),
        entry({
          id: E1,
          context_kind: 'team',
          context_ref: TEAM,
          team_id: TEAM,
          started_at: '2026-09-15T09:00:00.000Z',
          duration_seconds: 6 * HOUR,
        }),
      ],
    };
    const { service, rates } = await setup(tables, {}, mocks);
    const capped = await service.buildFreeze([S1], {
      approveOvertime: false,
      mode: 'approve',
    });
    expect(capped.payload[S1][E1].payable_seconds).toBe(6 * HOUR);
    expect(capped.payload[S1][E2].payable_seconds).toBe(4 * HOUR);
    expect(capped.preview[S1].over_cap_seconds).toBe(2 * HOUR);
    expect(rates.memberCaps).toHaveBeenCalledWith(
      TEAM,
      MEMBER,
      PROJECT,
      '2026-09-15',
    );

    const overtime = await service.buildFreeze([S1], {
      approveOvertime: true,
      mode: 'approve',
    });
    expect(overtime.payload[S1][E2].payable_seconds).toBe(6 * HOUR);
    expect(
      overtime.preview[S1].entries.find((p) => p.entry_id === E2),
    ).toMatchObject({
      rounded_seconds: 6 * HOUR,
      payable_seconds: 6 * HOUR,
      over_cap_seconds: 2 * HOUR,
    });
  });

  it('already-approved payable time in the window (other sheets) counts against the cap', async () => {
    const mocks = defaultMocks();
    mocks.rates.memberCaps.mockResolvedValue({
      weekly_limit_hours: 8,
      monthly_limit_hours: null,
      overtime_requires_approval: false,
    });
    const { service } = await setup(
      {
        timesheets: [
          sheet({
            scope_kind: 'team',
            scope_ref: TEAM,
            team_id: TEAM,
            workspace_id: null,
          }),
        ],
        time_entries: [
          entry({
            id: E1,
            context_kind: 'team',
            context_ref: TEAM,
            team_id: TEAM,
            duration_seconds: 4 * HOUR,
          }),
          // On another (workspace-scope) sheet of the same week, approved: 5h payable.
          entry({
            id: E3,
            context_kind: 'team',
            context_ref: TEAM,
            team_id: TEAM,
            timesheet_id: S3,
            started_at: '2026-09-14T09:00:00.000Z',
            duration_seconds: 5 * HOUR,
            payable_seconds: 5 * HOUR,
          }),
          // Rejected legacy time never counts.
          entry({
            id: E4,
            context_kind: 'team',
            context_ref: TEAM,
            team_id: TEAM,
            timesheet_id: S3,
            started_at: '2026-09-14T15:00:00.000Z',
            payable_seconds: 0,
            legacy_status: 'rejected',
          }),
        ],
      },
      {},
      mocks,
    );
    const { payload } = await service.buildFreeze([S1], {
      approveOvertime: false,
      mode: 'approve',
    });
    expect(payload[S1][E1].payable_seconds).toBe(3 * HOUR);
  });

  it('a monthly cap spanning two sheets of one batch: the later sheet sees the earlier one', async () => {
    const mocks = defaultMocks();
    mocks.rates.memberCaps.mockResolvedValue({
      weekly_limit_hours: null,
      monthly_limit_hours: 10,
      overtime_requires_approval: false,
    });
    const team = {
      scope_kind: 'team',
      scope_ref: TEAM,
      team_id: TEAM,
      workspace_id: null,
    } as const;
    const { service } = await setup(
      {
        timesheets: [
          sheet({
            id: S2,
            ...team,
            period_start: '2026-09-21',
            period_end: '2026-09-27',
          }),
          sheet({ id: S1, ...team }),
        ],
        time_entries: [
          entry({
            id: E1,
            context_kind: 'team',
            context_ref: TEAM,
            team_id: TEAM,
            timesheet_id: S1,
            duration_seconds: 7 * HOUR,
          }),
          entry({
            id: E2,
            context_kind: 'team',
            context_ref: TEAM,
            team_id: TEAM,
            timesheet_id: S2,
            started_at: '2026-09-22T09:00:00.000Z',
            duration_seconds: 7 * HOUR,
          }),
        ],
      },
      {},
      mocks,
    );
    const { payload } = await service.buildFreeze([S2, S1], {
      approveOvertime: false,
      mode: 'approve',
    });
    expect(payload[S1][E1].payable_seconds).toBe(7 * HOUR);
    expect(payload[S2][E2].payable_seconds).toBe(3 * HOUR);
  });

  it('engagement sheets: rounding and the weekly limit come from the contract settings in force on each date', async () => {
    const mocks = defaultMocks();
    mocks.engagements.settingsInForceOn.mockImplementation(
      (_e: string, d: string) =>
        Promise.resolve(
          d < '2026-09-17'
            ? { rounding_minutes: 30, weekly_limit_minutes: 120 }
            : { rounding_minutes: 0, weekly_limit_minutes: null },
        ),
    );
    const eng = {
      scope_kind: 'engagement',
      scope_ref: ENG,
      engagement_id: ENG,
      workspace_id: null,
      approver_scope: 'hirer',
      policy_snapshot: {
        rounding_minutes: 5,
        weekly_limit_minutes: 60,
        sources: { weekly_limit_minutes: 'contract' },
      },
    } as const;
    const a = {
      context_kind: 'assignment',
      context_ref: ASSIGN,
      engagement_assignment_id: ASSIGN,
      workspace_id: null,
    } as const;
    const { service, engagements } = await setup(
      {
        timesheets: [sheet({ ...eng })],
        time_entries: [
          entry({ id: E1, ...a, duration_seconds: 80 * 60 }), // 1h20 → 1h30 (30-min rounding)
          entry({
            id: E2,
            ...a,
            started_at: '2026-09-16T09:00:00.000Z',
            duration_seconds: 50 * 60,
          }), // → 1h, capped
          entry({
            id: E3,
            ...a,
            started_at: '2026-09-18T09:00:00.000Z',
            duration_seconds: 50 * 60,
          }), // no rounding, no limit
        ],
      },
      {},
      mocks,
    );
    const { payload } = await service.buildFreeze([S1], {
      approveOvertime: false,
      mode: 'approve',
    });
    expect(engagements.settingsInForceOn).toHaveBeenCalledWith(
      ENG,
      '2026-09-15',
    );
    expect(payload[S1][E1].payable_seconds).toBe(90 * 60);
    expect(payload[S1][E2].payable_seconds).toBe(30 * 60);
    // Settings in force with no limit: the snapshot's contract-set limit no longer applies.
    expect(payload[S1][E3].payable_seconds).toBe(50 * 60);
  });

  it('engagement sheets: over the contract limit is cut; approve_overtime keeps rounded and still reports over', async () => {
    const mocks = defaultMocks();
    mocks.engagements.settingsInForceOn.mockResolvedValue({
      rounding_minutes: 0,
      weekly_limit_minutes: 180,
    });
    const a = {
      context_kind: 'assignment',
      context_ref: ASSIGN,
      engagement_assignment_id: ASSIGN,
      workspace_id: null,
    } as const;
    const { service } = await setup(
      {
        timesheets: [
          sheet({
            scope_kind: 'engagement',
            scope_ref: ENG,
            engagement_id: ENG,
            workspace_id: null,
            approver_scope: 'hirer',
            policy_snapshot: {
              rounding_minutes: 0,
              weekly_limit_minutes: 180,
              sources: { weekly_limit_minutes: 'contract' },
            },
          }),
        ],
        time_entries: [
          entry({ id: E1, ...a, duration_seconds: 2 * HOUR }),
          entry({
            id: E2,
            ...a,
            started_at: '2026-09-16T09:00:00.000Z',
            duration_seconds: 2 * HOUR,
          }),
        ],
      },
      {},
      mocks,
    );
    const capped = await service.buildFreeze([S1], {
      approveOvertime: false,
      mode: 'approve',
    });
    expect(capped.payload[S1][E1].payable_seconds).toBe(2 * HOUR);
    expect(capped.payload[S1][E2].payable_seconds).toBe(HOUR);
    expect(capped.preview[S1].over_cap_seconds).toBe(HOUR);

    const overtime = await service.buildFreeze([S1], {
      approveOvertime: true,
      mode: 'approve',
    });
    expect(overtime.payload[S1][E2].payable_seconds).toBe(2 * HOUR);
    expect(overtime.preview[S1].over_cap_seconds).toBe(HOUR);
  });

  it('engagement sheets with no contract limit never fall back to the workspace policy limit (D65)', async () => {
    const a = {
      context_kind: 'assignment',
      context_ref: ASSIGN,
      engagement_assignment_id: ASSIGN,
      workspace_id: null,
    } as const;
    const tables = {
      timesheets: [
        sheet({
          scope_kind: 'engagement',
          scope_ref: ENG,
          engagement_id: ENG,
          workspace_id: null,
          approver_scope: 'hirer',
          policy_snapshot: {
            rounding_minutes: 0,
            weekly_limit_minutes: 60,
            sources: { weekly_limit_minutes: 'workspace' },
          },
        }),
      ],
      time_entries: [
        entry({ id: E1, ...a, duration_seconds: 2 * HOUR }),
        entry({
          id: E2,
          ...a,
          started_at: '2026-09-16T09:00:00.000Z',
          duration_seconds: 2 * HOUR,
        }),
      ],
    };

    // A settings row in force that leaves the limit NULL.
    const withRow = defaultMocks();
    withRow.engagements.settingsInForceOn.mockResolvedValue({
      rounding_minutes: 0,
      weekly_limit_minutes: null,
    });
    const one = await setup(tables, {}, withRow);
    const approved = await one.service.buildFreeze([S1], {
      approveOvertime: false,
      mode: 'approve',
    });
    expect(approved.payload[S1][E1].payable_seconds).toBe(2 * HOUR);
    expect(approved.payload[S1][E2].payable_seconds).toBe(2 * HOUR);
    expect(approved.preview[S1].over_cap_seconds).toBe(0);

    // No settings row at all, and the submit path (a fresh resolve that carries the workspace limit).
    const noRow = defaultMocks();
    noRow.policy.resolve.mockResolvedValue({
      rounding_minutes: 0,
      weekly_limit_minutes: 60,
      reminder_days: 1,
      sources: { weekly_limit_minutes: 'workspace' },
    });
    const two = await setup(tables, {}, noRow);
    const submitted = await two.service.buildFreeze([S1], {
      approveOvertime: false,
      mode: 'submit',
    });
    expect(two.policy.resolve).toHaveBeenCalled();
    expect(submitted.payload[S1][E2].payable_seconds).toBe(2 * HOUR);
    expect(submitted.preview[S1].over_cap_seconds).toBe(0);
  });

  it('a workspace sheet over the policy weekly limit: payable is not cut (D65)', async () => {
    const tables = {
      timesheets: [
        sheet({
          policy_snapshot: {
            rounding_minutes: 0,
            weekly_limit_minutes: 90,
            sources: { weekly_limit_minutes: 'workspace' },
          },
        }),
      ],
      time_entries: [
        entry({ id: E1, duration_seconds: HOUR }),
        entry({
          id: E2,
          started_at: '2026-09-16T09:00:00.000Z',
          duration_seconds: HOUR,
        }),
      ],
    };
    const { service } = await setup(tables);
    const { payload, preview } = await service.buildFreeze([S1], {
      approveOvertime: false,
      mode: 'approve',
    });
    expect(payload[S1][E1].payable_seconds).toBe(HOUR);
    expect(payload[S1][E2].payable_seconds).toBe(HOUR);
    expect(preview[S1].over_cap_seconds).toBe(0);

    // Submit resolves the policy fresh: the same limit still never cuts.
    const mocks = defaultMocks();
    mocks.policy.resolve.mockResolvedValue({
      rounding_minutes: 0,
      weekly_limit_minutes: 30,
      reminder_days: 1,
      sources: { weekly_limit_minutes: 'workspace' },
    });
    const fresh = await setup(tables, {}, mocks);
    const submitted = await fresh.service.buildFreeze([S1], {
      approveOvertime: false,
      mode: 'submit',
    });
    expect(fresh.policy.resolve).toHaveBeenCalled();
    expect(submitted.payload[S1][E2].payable_seconds).toBe(HOUR);
    expect(submitted.preview[S1].over_cap_seconds).toBe(0);
  });

  it('a team sheet over the team policy weekly limit is cut only by the team member cap (D65)', async () => {
    const team = {
      context_kind: 'team',
      context_ref: TEAM,
      team_id: TEAM,
      workspace_id: null,
    } as const;
    const tables = {
      timesheets: [
        sheet({
          scope_kind: 'team',
          scope_ref: TEAM,
          team_id: TEAM,
          workspace_id: null,
          approver_scope: 'team',
          policy_snapshot: {
            rounding_minutes: 0,
            weekly_limit_minutes: 60,
            sources: { weekly_limit_minutes: 'team' },
          },
        }),
      ],
      time_entries: [
        entry({ id: E1, ...team, duration_seconds: 3 * HOUR }),
        entry({
          id: E2,
          ...team,
          started_at: '2026-09-16T09:00:00.000Z',
          duration_seconds: 3 * HOUR,
        }),
      ],
    };

    // Over the 1h policy limit, under the 10h member cap: nothing is cut.
    const under = defaultMocks();
    under.rates.memberCaps.mockResolvedValue({
      weekly_limit_hours: 10,
      monthly_limit_hours: null,
      overtime_requires_approval: true,
    });
    const a = await setup(tables, {}, under);
    const notCut = await a.service.buildFreeze([S1], {
      approveOvertime: false,
      mode: 'approve',
    });
    expect(notCut.payload[S1][E1].payable_seconds).toBe(3 * HOUR);
    expect(notCut.payload[S1][E2].payable_seconds).toBe(3 * HOUR);
    expect(notCut.preview[S1].over_cap_seconds).toBe(0);

    // Over the 5h member cap: the latest entry is cut, unless overtime is approved.
    const over = defaultMocks();
    over.rates.memberCaps.mockResolvedValue({
      weekly_limit_hours: 5,
      monthly_limit_hours: null,
      overtime_requires_approval: true,
    });
    const b = await setup(tables, {}, over);
    const cut = await b.service.buildFreeze([S1], {
      approveOvertime: false,
      mode: 'approve',
    });
    expect(cut.payload[S1][E1].payable_seconds).toBe(3 * HOUR);
    expect(cut.payload[S1][E2].payable_seconds).toBe(2 * HOUR);
    expect(cut.preview[S1].over_cap_seconds).toBe(HOUR);
    const overtime = await b.service.buildFreeze([S1], {
      approveOvertime: true,
      mode: 'approve',
    });
    expect(overtime.payload[S1][E2].payable_seconds).toBe(3 * HOUR);
    expect(overtime.preview[S1].over_cap_seconds).toBe(HOUR);
  });

  it('memoises rate lookups for entries sharing a rate key', async () => {
    const { service, rates } = await setup({
      timesheets: [sheet({})],
      time_entries: [
        entry({ id: E1 }),
        entry({ id: E2, started_at: '2026-09-15T11:00:00.000Z' }),
        entry({ id: E3, started_at: '2026-09-16T11:00:00.000Z' }),
      ],
    });
    await service.buildFreeze([S1], {
      approveOvertime: false,
      mode: 'approve',
    });
    expect(rates.freezeRate).toHaveBeenCalledTimes(2);
    expect(rates.legacyCutoff).toHaveBeenCalledTimes(1);
  });
});

// ── get ─────────────────────────────────────────────────────────────────────
describe('TimesheetsService.get', () => {
  function authRow(id: string, over: Partial<EntryAuthRow> = {}): EntryAuthRow {
    return {
      id,
      member_user_id: MEMBER,
      project_id: PROJECT,
      context_kind: 'workspace',
      context_ref: WS,
      team_id: null,
      workspace_id: WS,
      engagement_assignment_id: null,
      timesheet_id: S1,
      started_at: '2026-09-15T09:00:00.000Z',
      ...over,
    };
  }

  it('a decider gets the freeze preview, deciders_count, actions, rules without routing', async () => {
    const mocks = defaultMocks();
    const row = sheet({
      policy_snapshot: {
        rounding_minutes: 0,
        weekly_limit_minutes: 30,
        sources: {},
        routing: {
          base: 'workspace',
          cost_money: false,
          deciders_count: 1,
          fallback: 'none',
        },
      },
    });
    mocks.authority.assertViewTimesheet.mockResolvedValue(row);
    mocks.authority.canDecide.mockResolvedValue(true);
    const { service, authority } = await setup(
      {
        timesheets: [row],
        time_entries: [entry({ id: E1 })],
        timesheet_events: [
          {
            id: 1,
            timesheet_id: S1,
            actor_user_id: MEMBER,
            event: 'submitted',
            from_status: 'open',
            to_status: 'submitted',
            note: null,
            total_seconds: 3600,
            payable_seconds: null,
            revision: 3,
            created_at: '2026-09-21T01:00:00.000Z',
          },
        ],
      },
      {},
      mocks,
    );
    const detail = await service.get(DECIDER, S1);
    expect(detail.viewer).toEqual({
      is_member: false,
      can_decide: true,
      actions: ['approve', 'return'],
    });
    // The policy weekly limit stays visible as the review indicator (rules + logged seconds) ...
    expect(detail.rules).toEqual({
      rounding_minutes: 0,
      weekly_limit_minutes: 30,
      sources: {},
    });
    expect(detail.routing).toMatchObject({
      base: 'workspace',
      deciders_count: 1,
    });
    // ... but never reduces payable time on a workspace sheet (D65).
    expect(detail.freeze_preview).toEqual({
      timesheet_id: S1,
      entries: [
        {
          entry_id: E1,
          rounded_seconds: 3600,
          payable_seconds: 3600,
          over_cap_seconds: 0,
        },
      ],
      over_cap_seconds: 0,
    });
    expect(detail.deciders_count).toBe(1);
    expect(detail.events).toHaveLength(1);
    expect(detail.sheet).toMatchObject({
      entry_count: 1,
      running_count: 0,
      logged_seconds: 3600,
    });
    // Email only for self and team-manager views.
    expect(authority.hydrate.mock.calls[0][2]).toEqual({ withEmail: false });
  });

  it('per-currency amounts only when every entry is cost-visible to the decider', async () => {
    const mocks = defaultMocks();
    const row = sheet({});
    mocks.authority.assertViewTimesheet.mockResolvedValue(row);
    mocks.authority.canDecide.mockResolvedValue(true);
    mocks.rates.freezeRate.mockResolvedValue({
      rate: 500,
      rateType: 'hourly',
      currency: 'PHP',
      amountable: true,
    });
    mocks.authority.costVisible.mockResolvedValue(new Set([E1, E2]));
    const tables = {
      timesheets: [row],
      time_entries: [
        entry({ id: E1 }),
        entry({
          id: E2,
          started_at: '2026-09-15T11:00:00.000Z',
          duration_seconds: 5400,
        }),
      ],
    };
    const a = await setup(tables, {}, mocks);
    expect(
      (await a.service.get(DECIDER, S1)).freeze_preview?.amounts_by_currency,
    ).toEqual({ PHP: 1250 });

    mocks.authority.costVisible.mockResolvedValue(new Set([E1]));
    const b = await setup(tables, {}, mocks);
    expect(
      (await b.service.get(DECIDER, S1)).freeze_preview,
    ).not.toHaveProperty('amounts_by_currency');
  });

  it('reports deciders_count = 0 to the member of a submitted sheet nobody else can approve', async () => {
    const mocks = defaultMocks();
    const row = sheet({});
    mocks.authority.assertViewTimesheet.mockResolvedValue(row);
    mocks.authority.approversFor.mockResolvedValue([]);
    const { service, authority } = await setup(
      { timesheets: [row], time_entries: [entry({})] },
      {},
      mocks,
    );
    const detail = await service.get(MEMBER, S1);
    expect(detail.deciders_count).toBe(0);
    expect(detail.viewer).toEqual({
      is_member: true,
      can_decide: false,
      actions: ['withdraw'],
    });
    expect(detail).not.toHaveProperty('freeze_preview');
    expect(authority.canDecide).not.toHaveBeenCalled();
    expect(authority.hydrate.mock.calls[0][2]).toEqual({ withEmail: true });
  });

  it('a viewer who neither owns nor decides gets no actions, preview or count', async () => {
    const mocks = defaultMocks();
    const row = sheet({
      scope_kind: 'team',
      scope_ref: TEAM,
      team_id: TEAM,
      workspace_id: null,
    });
    mocks.authority.assertViewTimesheet.mockResolvedValue(row);
    mocks.authority.isTeamManager.mockResolvedValue(true);
    const { service, authority } = await setup(
      { timesheets: [row], time_entries: [entry({})] },
      {},
      mocks,
    );
    const detail = await service.get(MANAGER, S1);
    expect(detail.viewer.actions).toEqual([]);
    expect(detail).not.toHaveProperty('freeze_preview');
    expect(detail).not.toHaveProperty('deciders_count');
    expect(authority.hydrate.mock.calls[0][2]).toEqual({ withEmail: true });
  });

  it('an open sheet has no rules or routing; submit shows from the last day, or early on an auto/self route', async () => {
    const mocks = defaultMocks();
    const row = sheet({
      status: 'open',
      approver_scope: null,
      policy_snapshot: {},
      period_start: '2999-01-04',
      period_end: '2999-01-10',
    });
    mocks.authority.assertViewTimesheet.mockResolvedValue(row);
    let route = 'workspace';
    const { service } = await setup(
      { timesheets: [row], time_entries: [entry({})] },
      {
        time_sheet_routing_preview: () => ({
          data: { approver_scope: route, routing: {} },
        }),
      },
      mocks,
    );
    const manual = await service.get(MEMBER, S1);
    expect(manual.rules).toBeNull();
    expect(manual.routing).toBeNull();
    expect(manual.viewer.actions).toEqual([]);
    route = 'self';
    expect((await service.get(MEMBER, S1)).viewer.actions).toEqual(['submit']);
  });

  it('approved: the member reopens their own auto/self sheet unless settled; a manual one asks', async () => {
    for (const [kind, lock, expected] of [
      ['self', null, ['reopen']],
      ['auto', 'paid', []],
      ['self', 'legacy', []],
      ['manual', null, ['request_reopen']],
      ['legacy', null, ['request_reopen']],
    ] as const) {
      const mocks = defaultMocks();
      const row = sheet({
        status: 'approved',
        decision_kind: kind,
        approver_scope:
          kind === 'manual' || kind === 'legacy' ? 'workspace' : kind,
      });
      mocks.authority.assertViewTimesheet.mockResolvedValue(row);
      mocks.authority.hydrate.mockImplementation(
        (_v: string, rows: EntryAuthRow[]) =>
          Promise.resolve(
            rows.map((r) => view(r, { locked_reason: lock ?? 'frozen' })),
          ),
      );
      const { service } = await setup(
        { timesheets: [row], time_entries: [entry({})] },
        {},
        mocks,
      );
      expect((await service.get(MEMBER, S1)).viewer.actions).toEqual(expected);
    }
  });

  it('approved: a decider may reopen unless an entry is paid or billed', async () => {
    for (const [lock, expected] of [
      ['frozen', ['reopen']],
      ['legacy', ['reopen']],
      ['billed', []],
    ] as const) {
      const mocks = defaultMocks();
      const row = sheet({ status: 'approved', decision_kind: 'manual' });
      mocks.authority.assertViewTimesheet.mockResolvedValue(row);
      mocks.authority.canDecide.mockResolvedValue(true);
      mocks.authority.hydrate.mockImplementation(
        (_v: string, rows: EntryAuthRow[]) =>
          Promise.resolve(rows.map((r) => view(r, { locked_reason: lock }))),
      );
      const { service } = await setup(
        { timesheets: [row], time_entries: [entry({})] },
        {},
        mocks,
      );
      const detail = await service.get(DECIDER, S1);
      expect(detail.viewer.actions).toEqual(expected);
      expect(detail).not.toHaveProperty('freeze_preview');
    }
  });

  it('passes the sheet entries to hydrate in started_at order', async () => {
    const mocks = defaultMocks();
    const row = sheet({});
    mocks.authority.assertViewTimesheet.mockResolvedValue(row);
    const { service, authority } = await setup(
      {
        timesheets: [row],
        time_entries: [
          entry({ id: E1, started_at: '2026-09-16T09:00:00.000Z' }),
          entry({ id: E2, started_at: '2026-09-15T09:00:00.000Z' }),
        ],
      },
      {},
      mocks,
    );
    await service.get(MEMBER, S1);
    const rows = authority.hydrate.mock.calls[0][1] as EntryAuthRow[];
    expect(rows.map((r) => r.id)).toEqual([E2, E1]);
    expect(rows[0]).toEqual(
      authRow(E2, { started_at: '2026-09-15T09:00:00.000Z' }),
    );
  });

  it('propagates the 404 of a sheet the viewer cannot open', async () => {
    const mocks = defaultMocks();
    mocks.authority.assertViewTimesheet.mockRejectedValue(
      new NotFoundException(),
    );
    const { service } = await setup({ timesheets: [] }, {}, mocks);
    await expect(service.get(OUTSIDER, S1)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

// ── lists ───────────────────────────────────────────────────────────────────
describe('TimesheetsService lists', () => {
  it('listMine: own sheets newest first with entry counts, filtered by from/to', async () => {
    const { service } = await setup({
      timesheets: [
        sheet({
          id: S1,
          status: 'approved',
          submission_kind: 'legacy',
          origin: 'legacy_migration',
        }),
        sheet({
          id: S2,
          status: 'open',
          period_start: '2026-09-21',
          period_end: '2026-09-27',
        }),
        sheet({ id: S3, member_user_id: OUTSIDER }),
      ],
      time_entries: [
        entry({
          id: E1,
          timesheet_id: S2,
          ended_at: null,
          duration_seconds: null,
        }),
        entry({ id: E2, timesheet_id: S2, duration_seconds: 1800 }),
        entry({ id: E3, timesheet_id: S1 }),
      ],
    });
    const all = await service.listMine(MEMBER, {});
    expect(all.map((s) => s.id)).toEqual([S2, S1]);
    expect(all[0]).toMatchObject({
      entry_count: 2,
      running_count: 1,
      logged_seconds: 1800,
    });
    expect(all[1]).toMatchObject({
      origin: 'legacy_migration',
      submission_kind: 'legacy',
      entry_count: 1,
    });
    expect(
      (await service.listMine(MEMBER, { from: '2026-09-21' })).map((s) => s.id),
    ).toEqual([S2]);
    expect(
      (await service.listMine(MEMBER, { to: '2026-09-20' })).map((s) => s.id),
    ).toEqual([S1]);
  });

  it('queue: ids from time_approval_queue_ids, paged, filtered, with member and policy-workspace tag', async () => {
    const { service, db } = await setup(
      {
        timesheets: [
          sheet({ id: S1, submitted_at: '2026-09-21T03:00:00.000Z' }),
          sheet({
            id: S2,
            submitted_at: '2026-09-21T01:00:00.000Z',
            policy_workspace_id: WS_OTHER,
          }),
          sheet({
            id: S3,
            scope_kind: 'team',
            scope_ref: TEAM,
            team_id: TEAM,
            workspace_id: null,
          }),
        ],
        time_entries: [entry({ timesheet_id: S2 })],
        profiles: [
          {
            id: MEMBER,
            display_name: 'Maria',
            avatar_url: null,
            email: 'm@x.test',
          },
        ],
        workspaces: [
          { id: WS, name: 'Acme' },
          { id: WS_OTHER, name: 'Beta' },
        ],
      },
      { time_approval_queue_ids: () => ({ data: [S1, S2, S3] }) },
    );
    const page = await service.queue(DECIDER, {
      status: 'submitted',
      scope_kind: 'workspace',
      page: 1,
      limit: 1,
      currentWorkspaceId: WS,
    });
    expect(db.rpc).toHaveBeenCalledWith('time_approval_queue_ids', {
      p_user_id: DECIDER,
      p_status: 'submitted',
      p_since: null,
    });
    expect(page.total).toBe(2);
    expect(page.items).toHaveLength(1);
    // Oldest submission first; a different policy workspace carries its tag (E27).
    expect(page.items[0]).toMatchObject({
      id: S2,
      entry_count: 1,
      member: { id: MEMBER, display_name: 'Maria', avatar_url: null },
      policy_workspace: { id: WS_OTHER, name: 'Beta' },
    });
    expect(page.items[0].member).not.toHaveProperty('email');

    const second = await service.queue(DECIDER, {
      status: 'submitted',
      scope_kind: 'workspace',
      page: 2,
      limit: 1,
      currentWorkspaceId: WS,
    });
    expect(second.items[0]).toMatchObject({ id: S1, policy_workspace: null });
  });

  it('queue decided: passes since as a date; queueCount counts the waiting ids', async () => {
    const { service, db } = await setup(
      { timesheets: [] },
      {
        time_approval_queue_ids: (args) => ({
          data: args.p_status === 'submitted' ? [S1, S2] : [],
        }),
      },
    );
    await service.queue(DECIDER, {
      status: 'decided',
      since: '2026-09-01T00:00:00Z',
      page: 1,
      limit: 50,
    });
    expect(db.rpc).toHaveBeenCalledWith('time_approval_queue_ids', {
      p_user_id: DECIDER,
      p_status: 'decided',
      p_since: '2026-09-01',
    });
    expect(await service.queueCount(DECIDER)).toEqual({ waiting: 2 });
  });
});

// ── overview ────────────────────────────────────────────────────────────────
describe('TimesheetsService.overview', () => {
  const recentIso = (daysAgo: number) =>
    new Date(Date.now() - daysAgo * 86_400_000).toISOString();

  it('guests get the empty shape without a database call', async () => {
    const { service, db } = await setup({});
    expect(
      await service.overview({ id: uid(77), is_guest: true }, 'Asia/Manila'),
    ).toEqual({
      can_log: false,
      approver_mode: false,
      contexts: [],
      approvals_waiting: 0,
      workspace_time_admin: [],
    });
    expect(db.from).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('seeds user_time_preferences from a valid ?tz= without overwriting; an invalid one is ignored', async () => {
    const a = await setup({});
    await a.service.overview({ id: MEMBER }, 'Asia/Manila');
    expect(a.db.mutations).toEqual([
      {
        table: 'user_time_preferences',
        op: 'upsert',
        value: { user_id: MEMBER, timezone: 'Asia/Manila' },
        opts: { onConflict: 'user_id', ignoreDuplicates: true },
      },
    ]);
    const b = await setup({});
    await b.service.overview({ id: MEMBER }, 'Mars/Olympus');
    expect(b.db.mutations).toEqual([]);
  });

  it('contexts with their current sheet and period rules; can_log from the share role; no approver mode while logging', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const mocks = defaultMocks();
    mocks.policy.resolve.mockResolvedValue({
      timezone: 'Asia/Manila',
      week_start: 7,
      period_kind: 'biweekly',
      period_anchor: '2026-01-04',
      reminder_days: 3,
      rounding_minutes: 0,
      sources: {},
    });
    const { service, policy } = await setup(
      {
        project_access: [
          {
            user_id: MEMBER,
            project_id: PROJECT,
            role: 'editor',
            capabilities: null,
          },
        ],
        time_entries: [
          entry({
            id: E1,
            timesheet_id: S1,
            started_at: recentIso(1),
            context_label_snapshot: 'Acme',
            duration_seconds: 1800,
          }),
          entry({
            id: E2,
            context_kind: 'personal',
            context_ref: null,
            workspace_id: null,
            timesheet_id: null,
            started_at: recentIso(2),
          }),
        ],
        timesheets: [
          sheet({
            id: S1,
            status: 'open',
            period_start: today,
            period_end: today,
          }),
        ],
      },
      { time_approval_queue_ids: () => ({ data: [S2] }) },
      mocks,
    );
    const o = await service.overview({ id: MEMBER });
    expect(o.can_log).toBe(true);
    expect(o.approvals_waiting).toBe(1);
    expect(o.approver_mode).toBe(false);
    expect(o.contexts).toEqual([
      {
        kind: 'workspace',
        id: WS,
        label: 'Acme',
        sheet_scope: { kind: 'workspace', ref: WS },
        current_sheet: {
          id: S1,
          status: 'open',
          period_start: today,
          period_end: today,
          total_seconds: 1800,
        },
        // D85: the workspace's own scope, resolved now.
        timezone: 'Asia/Manila',
        week_start: 7,
        period_kind: 'biweekly',
        period_anchor: '2026-01-04',
        reminder_days: 3,
      },
      {
        kind: 'personal',
        id: null,
        label: 'Just me',
        sheet_scope: null,
        current_sheet: null,
        timezone: null,
        week_start: null,
        period_kind: null,
        period_anchor: null,
        reminder_days: null,
      },
    ]);
    // A workspace context is its own scope: no scope call; personal resolves nothing.
    expect(policy.sheetScopeFor).not.toHaveBeenCalled();
    expect(policy.resolve).toHaveBeenCalledTimes(1);
    expect(policy.resolve).toHaveBeenCalledWith(
      { kind: 'workspace', ref: WS },
      WS,
      expect.any(Date),
    );
  });

  it('approver mode: waiting approvals and nothing logged in 30 days; a viewer cannot log', async () => {
    const { service } = await setup(
      {
        project_access: [
          {
            user_id: MEMBER,
            project_id: PROJECT,
            role: 'viewer',
            capabilities: null,
          },
        ],
        time_entries: [entry({ started_at: recentIso(40) })],
      },
      { time_approval_queue_ids: () => ({ data: [S1] }) },
    );
    const o = await service.overview({ id: MEMBER });
    expect(o.can_log).toBe(false);
    expect(o.approver_mode).toBe(true);
    expect(o.contexts).toEqual([]);
  });

  it('approver mode for an active talent hirer with nothing waiting', async () => {
    const { service } = await setup(
      {
        engagement_parties: [
          { engagement_id: ENG, user_id: MEMBER, position: 'hirer' },
        ],
        engagements: [{ id: ENG, kind: 'talent_services', status: 'active' }],
      },
      { time_approval_queue_ids: () => ({ data: [] }) },
    );
    expect((await service.overview({ id: MEMBER })).approver_mode).toBe(true);
  });

  it('approver mode for a manager of a team whose override routes to the team', async () => {
    const { service } = await setup(
      {
        team_members: [{ team_id: TEAM, user_id: MEMBER, role: 'admin' }],
        time_policies: [
          {
            id: uid(500),
            scope: 'team',
            team_id: TEAM,
            approver_scope: 'team',
          },
        ],
      },
      { time_approval_queue_ids: () => ({ data: [] }) },
    );
    expect((await service.overview({ id: MEMBER })).approver_mode).toBe(true);
  });

  it('workspace_time_admin: managed workspaces, policy_unconfirmed, and ?tz= materialisation on time-tracking plans', async () => {
    const mocks = defaultMocks();
    mocks.entitlements.hasFeature.mockImplementation((ref: string) =>
      Promise.resolve(ref === WS),
    );
    const { service, policy } = await setup(
      {
        workspace_members: [
          { workspace_id: WS, user_id: MEMBER, role: 'owner' },
          { workspace_id: WS_OTHER, user_id: MEMBER, role: 'admin' },
          { workspace_id: uid(12), user_id: MEMBER, role: 'member' },
        ],
        workspaces: [
          { id: WS, name: 'Acme', slug: 'acme' },
          { id: WS_OTHER, name: 'Beta', slug: 'beta' },
        ],
        time_policies: [
          {
            id: uid(501),
            scope: 'workspace',
            workspace_id: WS_OTHER,
            updated_by: MEMBER,
          },
        ],
      },
      { time_approval_queue_ids: () => ({ data: [] }) },
      mocks,
    );
    const o = await service.overview({ id: MEMBER }, 'Asia/Manila');
    expect(o.workspace_time_admin).toEqual([
      {
        workspace_id: WS,
        name: 'Acme',
        slug: 'acme',
        has_time_tracking: true,
        policy_unconfirmed: true,
      },
      {
        workspace_id: WS_OTHER,
        name: 'Beta',
        slug: 'beta',
        has_time_tracking: false,
        policy_unconfirmed: false,
      },
    ]);
    expect(policy.ensureWorkspacePolicy).toHaveBeenCalledTimes(1);
    expect(policy.ensureWorkspacePolicy).toHaveBeenCalledWith(
      WS,
      'Asia/Manila',
      MEMBER,
    );
    // A workspace admin with time tracking is a decider: approver mode without entries.
    expect(o.approver_mode).toBe(true);
  });

  it('read failures are a fixed-copy 500', async () => {
    const { service, db } = await setup({});
    db.failures.project_access = {
      code: 'XX000',
      message: 'relation exploded',
    };
    const err = await service.overview({ id: MEMBER }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InternalServerErrorException);
    expect(codeOf(err)).toBe('TIME_INTERNAL');
    expect(JSON.stringify((err as HttpException).getResponse())).not.toContain(
      'exploded',
    );
  });
});

// ── web PR additions (A1, A2, A3, A10, A12) ─────────────────────────────────
const P_ANA = uid(4); // MANAGER
const P_BEA = uid(5);
const P_CARL = uid(7);
const P_DINA = uid(8);
const P_EVE = uid(9);
const P_ZED = uid(2); // DECIDER
const P_NONAME = uid(6);

function profile(id: string, name: string | null, deleted = false): Row {
  return {
    id,
    display_name: name,
    avatar_url: null,
    deleted_at: deleted ? '2026-09-01T00:00:00.000Z' : null,
  };
}

const PEOPLE = [
  profile(P_ZED, 'Zed'),
  profile(P_ANA, 'Ana'),
  profile(P_BEA, 'Bea'),
  profile(P_NONAME, null),
  profile(P_CARL, 'Carl', true),
  profile(P_DINA, 'Dina'),
  profile(P_EVE, 'Eve'),
];

function rpcCalls(db: ReturnType<typeof fakeDb>, name: string): Row[] {
  return db.rpc.mock.calls.filter((c) => c[0] === name).map((c) => c[1]);
}

describe('A1 routing_preview (member, open/returned)', () => {
  const future = {
    status: 'open' as const,
    approver_scope: null,
    policy_snapshot: {},
    period_start: '2999-01-04',
    period_end: '2999-01-10',
  };

  it('names the deciders of the routed scope: sorted, deleted skipped, capped at 5; one preview read', async () => {
    const mocks = defaultMocks();
    const row = sheet(future);
    mocks.authority.assertViewTimesheet.mockResolvedValue(row);
    const { service, db } = await setup(
      { timesheets: [row], time_entries: [entry({})], profiles: PEOPLE },
      {
        time_sheet_routing_preview: () => ({
          data: {
            approver_scope: 'workspace',
            routing: {
              base: 'workspace',
              cost_money: true,
              deciders_count: 6,
              fallback: 'none',
            },
          },
        }),
        time_scope_deciders: () => ({
          data: [P_ZED, P_ANA, P_BEA, P_NONAME, P_CARL, P_DINA, P_EVE],
        }),
      },
      mocks,
    );
    const detail = await service.get(MEMBER, S1);
    expect(detail.routing_preview).toEqual({
      approver_scope: 'workspace',
      cost_money: true,
      deciders: [
        { id: P_ANA, display_name: 'Ana' },
        { id: P_BEA, display_name: 'Bea' },
        { id: P_DINA, display_name: 'Dina' },
        { id: P_EVE, display_name: 'Eve' },
        { id: P_ZED, display_name: 'Zed' },
      ],
    });
    expect(rpcCalls(db, 'time_sheet_routing_preview')).toEqual([
      { p_timesheet_id: S1, p_action: 'submit' },
    ]);
    expect(rpcCalls(db, 'time_scope_deciders')).toEqual([
      {
        p_approver_scope: 'workspace',
        p_team_id: null,
        p_policy_workspace_id: WS,
        p_engagement_id: null,
        p_member_user_id: MEMBER,
      },
    ]);
    // A manual route before the period's last day: no early submit (D13), and no A2 list while open.
    expect(detail.viewer.actions).toEqual([]);
    expect(detail).not.toHaveProperty('deciders');
    expect(detail).not.toHaveProperty('deciders_count');
  });

  it('auto/self routes have no deciders and need no decider read; self still submits early', async () => {
    const mocks = defaultMocks();
    const row = sheet(future);
    mocks.authority.assertViewTimesheet.mockResolvedValue(row);
    const { service, db } = await setup(
      { timesheets: [row], time_entries: [entry({})], profiles: PEOPLE },
      {
        time_sheet_routing_preview: () => ({
          data: {
            approver_scope: 'self',
            routing: { cost_money: false, fallback: 'self' },
          },
        }),
      },
      mocks,
    );
    const detail = await service.get(MEMBER, S1);
    expect(detail.routing_preview).toEqual({
      approver_scope: 'self',
      cost_money: false,
      deciders: [],
    });
    expect(detail.viewer.actions).toEqual(['submit']);
    expect(rpcCalls(db, 'time_scope_deciders')).toHaveLength(0);
  });

  it('a returned engagement sheet previews its hirer ("Goes to Ana Reyes")', async () => {
    const mocks = defaultMocks();
    const row = sheet({
      status: 'returned',
      approver_scope: 'hirer',
      scope_kind: 'engagement',
      scope_ref: ENG,
      engagement_id: ENG,
      workspace_id: null,
    });
    mocks.authority.assertViewTimesheet.mockResolvedValue(row);
    const { service, db } = await setup(
      { timesheets: [row], time_entries: [entry({})], profiles: PEOPLE },
      {
        time_sheet_routing_preview: () => ({
          data: { approver_scope: 'hirer', routing: { cost_money: true } },
        }),
        time_scope_deciders: () => ({ data: [P_ANA] }),
      },
      mocks,
    );
    const detail = await service.get(MEMBER, S1);
    expect(detail.routing_preview).toEqual({
      approver_scope: 'hirer',
      cost_money: true,
      deciders: [{ id: P_ANA, display_name: 'Ana' }],
    });
    expect(rpcCalls(db, 'time_scope_deciders')[0]).toMatchObject({
      p_approver_scope: 'hirer',
      p_engagement_id: ENG,
      p_member_user_id: MEMBER,
    });
    expect(detail.viewer.actions).toEqual(['submit']);
  });

  it('omitted when the preview is null, malformed or fails, or a name read fails; the detail still loads', async () => {
    for (const answer of [
      { data: null },
      { data: { approver_scope: 'nobody' } },
      { error: { code: 'XX000', message: 'boom' } },
    ]) {
      const mocks = defaultMocks();
      const row = sheet(future);
      mocks.authority.assertViewTimesheet.mockResolvedValue(row);
      const { service } = await setup(
        { timesheets: [row], time_entries: [entry({})] },
        { time_sheet_routing_preview: () => answer },
        mocks,
      );
      const detail = await service.get(MEMBER, S1);
      expect(detail).not.toHaveProperty('routing_preview');
      // An unknown route never offers an early submit.
      expect(detail.viewer.actions).toEqual([]);
    }

    for (const failing of ['scope', 'names'] as const) {
      const mocks = defaultMocks();
      const row = sheet(future);
      mocks.authority.assertViewTimesheet.mockResolvedValue(row);
      const { service, db } = await setup(
        { timesheets: [row], time_entries: [entry({})], profiles: PEOPLE },
        {
          time_sheet_routing_preview: () => ({
            data: { approver_scope: 'workspace', routing: {} },
          }),
          time_scope_deciders: () =>
            failing === 'scope'
              ? { error: { code: 'XX000', message: 'boom' } }
              : { data: [P_ANA] },
        },
        mocks,
      );
      if (failing === 'names') {
        db.failures.profiles = { code: 'XX000', message: 'boom' };
      }
      const detail = await service.get(MEMBER, S1);
      expect(detail).not.toHaveProperty('routing_preview');
      expect(detail.sheet.id).toBe(S1);
    }
  });

  it('never for anyone but the member, nor for the member once submitted or approved', async () => {
    const mocks = defaultMocks();
    const open = sheet(future);
    mocks.authority.assertViewTimesheet.mockResolvedValue(open);
    const a = await setup(
      { timesheets: [open], time_entries: [entry({})] },
      {
        time_sheet_routing_preview: () => ({
          data: { approver_scope: 'workspace', routing: {} },
        }),
      },
      mocks,
    );
    expect(await a.service.get(MANAGER, S1)).not.toHaveProperty(
      'routing_preview',
    );
    expect(rpcCalls(a.db, 'time_sheet_routing_preview')).toHaveLength(0);

    for (const status of ['submitted', 'approved'] as const) {
      const m = defaultMocks();
      const row = sheet({ status });
      m.authority.assertViewTimesheet.mockResolvedValue(row);
      const b = await setup(
        { timesheets: [row], time_entries: [entry({})] },
        {},
        m,
      );
      expect(await b.service.get(MEMBER, S1)).not.toHaveProperty(
        'routing_preview',
      );
      expect(rpcCalls(b.db, 'time_sheet_routing_preview')).toHaveLength(0);
    }
  });
});

describe('A2 deciders (member, submitted)', () => {
  it('names who the submitted sheet waits on; the decider view keeps only deciders_count', async () => {
    const mocks = defaultMocks();
    const row = sheet({});
    mocks.authority.assertViewTimesheet.mockResolvedValue(row);
    mocks.authority.approversFor.mockResolvedValue([
      P_ZED,
      P_ANA,
      P_CARL,
      P_BEA,
      P_DINA,
      P_EVE,
      P_NONAME,
    ]);
    const { service } = await setup(
      { timesheets: [row], time_entries: [entry({})], profiles: PEOPLE },
      {},
      mocks,
    );
    const detail = await service.get(MEMBER, S1);
    expect(detail.deciders_count).toBe(7);
    expect(detail.deciders).toEqual([
      { id: P_ANA, display_name: 'Ana' },
      { id: P_BEA, display_name: 'Bea' },
      { id: P_DINA, display_name: 'Dina' },
      { id: P_EVE, display_name: 'Eve' },
      { id: P_ZED, display_name: 'Zed' },
    ]);
    expect(detail).not.toHaveProperty('routing_preview');

    const m = defaultMocks();
    m.authority.assertViewTimesheet.mockResolvedValue(row);
    m.authority.canDecide.mockResolvedValue(true);
    const b = await setup(
      { timesheets: [row], time_entries: [entry({})], profiles: PEOPLE },
      {},
      m,
    );
    const asDecider = await b.service.get(DECIDER, S1);
    expect(asDecider.deciders_count).toBe(1);
    expect(asDecider).not.toHaveProperty('deciders');
  });

  it('a failed name read only omits the list', async () => {
    const mocks = defaultMocks();
    const row = sheet({});
    mocks.authority.assertViewTimesheet.mockResolvedValue(row);
    const { service, db } = await setup(
      { timesheets: [row], time_entries: [entry({})] },
      {},
      mocks,
    );
    db.failures.profiles = { code: 'XX000', message: 'boom' };
    const detail = await service.get(MEMBER, S1);
    expect(detail.deciders_count).toBe(1);
    expect(detail).not.toHaveProperty('deciders');
  });
});

describe('A1 + A2 on me/timesheets', () => {
  it('previews open/returned sheets (one scope read per scope), names submitted ones, leaves the rest', async () => {
    const S4 = uid(103);
    const S5 = uid(104);
    const S6 = uid(105);
    const mocks = defaultMocks();
    mocks.authority.approversFor.mockResolvedValue([P_ZED]);
    const { service, db } = await setup(
      {
        timesheets: [
          sheet({ id: S1, status: 'submitted' }),
          sheet({
            id: S2,
            status: 'open',
            period_start: '2026-09-21',
            period_end: '2026-09-27',
          }),
          sheet({
            id: S3,
            status: 'returned',
            period_start: '2026-09-07',
            period_end: '2026-09-13',
          }),
          sheet({
            id: S4,
            status: 'open',
            period_start: '2026-09-28',
            period_end: '2026-10-04',
          }),
          sheet({
            id: S5,
            status: 'approved',
            period_start: '2026-08-31',
            period_end: '2026-09-06',
          }),
          sheet({
            id: S6,
            status: 'open',
            period_start: '2026-08-24',
            period_end: '2026-08-30',
          }),
        ],
        time_entries: [],
        profiles: PEOPLE,
      },
      {
        time_sheet_routing_preview: (args) =>
          args.p_timesheet_id === S4
            ? { error: { code: 'XX000', message: 'boom' } }
            : args.p_timesheet_id === S6
              ? { data: { approver_scope: 'auto', routing: {} } }
              : {
                  data: {
                    approver_scope: 'workspace',
                    routing: { cost_money: false },
                  },
                },
        time_scope_deciders: () => ({ data: [P_ANA, P_CARL] }),
      },
      mocks,
    );
    const items = await service.listMine(MEMBER, {});
    const byId = new Map(items.map((s) => [s.id, s]));
    const workspacePreview = {
      approver_scope: 'workspace',
      cost_money: false,
      deciders: [{ id: P_ANA, display_name: 'Ana' }],
    };
    expect(byId.get(S2)?.routing_preview).toEqual(workspacePreview);
    expect(byId.get(S3)?.routing_preview).toEqual(workspacePreview);
    expect(byId.get(S6)?.routing_preview).toEqual({
      approver_scope: 'auto',
      cost_money: false,
      deciders: [],
    });
    // A failed preview leaves only that sheet undecorated.
    expect(byId.get(S4)).not.toHaveProperty('routing_preview');
    expect(byId.get(S1)?.deciders).toEqual([
      { id: P_ZED, display_name: 'Zed' },
    ]);
    expect(byId.get(S1)).not.toHaveProperty('routing_preview');
    expect(byId.get(S5)).not.toHaveProperty('routing_preview');
    expect(byId.get(S5)).not.toHaveProperty('deciders');
    // The same scope is read once; deciders only for the submitted sheet; one profile read.
    expect(rpcCalls(db, 'time_scope_deciders')).toHaveLength(1);
    expect(mocks.authority.approversFor).toHaveBeenCalledTimes(1);
    expect(mocks.authority.approversFor).toHaveBeenCalledWith(S1);
    expect(db.from.mock.calls.filter((c) => c[0] === 'profiles')).toHaveLength(
      1,
    );
  });

  it('a failed name read leaves the list undecorated but answered', async () => {
    const { service, db } = await setup(
      {
        timesheets: [
          sheet({ id: S1, status: 'submitted' }),
          sheet({ id: S2, status: 'open' }),
        ],
        time_entries: [],
      },
      {
        time_sheet_routing_preview: () => ({
          data: { approver_scope: 'team', routing: {} },
        }),
        time_scope_deciders: () => ({ data: [P_ANA] }),
      },
    );
    db.failures.profiles = { code: 'XX000', message: 'boom' };
    const items = await service.listMine(MEMBER, {});
    expect(items).toHaveLength(2);
    for (const s of items) {
      expect(s).not.toHaveProperty('routing_preview');
      expect(s).not.toHaveProperty('deciders');
    }
  });
});

describe('A3 approval queue flags', () => {
  const teamSheet = {
    scope_kind: 'team',
    scope_ref: TEAM,
    team_id: TEAM,
    workspace_id: null,
    approver_scope: 'team',
  } as const;
  const teamEntry = {
    context_kind: 'team',
    context_ref: TEAM,
    team_id: TEAM,
  } as const;

  it('needs_review, over_cap_seconds and running per waiting row, from one entry read and a rate-free preview', async () => {
    const mocks = defaultMocks();
    mocks.rates.memberCaps.mockResolvedValue({
      weekly_limit_hours: 10,
      monthly_limit_hours: null,
      overtime_requires_approval: true,
    });
    const { service, db, rates } = await setup(
      {
        timesheets: [
          sheet({
            id: S1,
            ...teamSheet,
            submitted_at: '2026-09-21T01:00:00.000Z',
          }),
          sheet({
            id: S2,
            member_user_id: OUTSIDER,
            submitted_at: '2026-09-21T02:00:00.000Z',
          }),
        ],
        time_entries: [
          entry({ id: E1, ...teamEntry, duration_seconds: 6 * HOUR }),
          entry({
            id: E2,
            ...teamEntry,
            started_at: '2026-09-16T09:00:00.000Z',
            duration_seconds: 6 * HOUR,
          }),
          // Running: counted in `running`, adds nothing to the freeze.
          entry({
            id: E3,
            ...teamEntry,
            started_at: '2026-09-17T09:00:00.000Z',
            ended_at: null,
            duration_seconds: null,
          }),
          // S2: one entry over 10 h, one flagged by the cron.
          entry({
            id: E4,
            member_user_id: OUTSIDER,
            timesheet_id: S2,
            duration_seconds: 11 * HOUR,
          }),
          entry({
            id: uid(204),
            member_user_id: OUTSIDER,
            timesheet_id: S2,
            started_at: '2026-09-16T09:00:00.000Z',
            duration_seconds: HOUR,
            flagged_reason: 'auto_stopped_24h',
          }),
        ],
        profiles: [profile(MEMBER, 'Maria'), profile(OUTSIDER, 'Leo')],
      },
      { time_approval_queue_ids: () => ({ data: [S1, S2] }) },
      mocks,
    );
    const page = await service.queue(DECIDER, {
      status: 'submitted',
      page: 1,
      limit: 50,
    });
    const byId = new Map(page.items.map((r) => [r.id, r]));
    expect(byId.get(S1)?.flags).toEqual({
      needs_review: 0,
      over_cap_seconds: 2 * HOUR,
      running: 1,
    });
    expect(byId.get(S2)?.flags).toEqual({
      needs_review: 2,
      over_cap_seconds: 0,
      running: 0,
    });
    expect(byId.get(S1)).not.toHaveProperty('flags_partial');
    // The preview reads no rates (no cap needs them) and never writes.
    expect(rates.freezeRate).not.toHaveBeenCalled();
    expect(rates.legacyCutoff).not.toHaveBeenCalled();
    expect(transitionCalls(db)).toHaveLength(0);
    // One preview build per waiting sheet (bounded concurrency): one sheet read each besides the queue's own.
    expect(
      db.from.mock.calls.filter((c) => c[0] === 'timesheets'),
    ).toHaveLength(3);
  });

  it('no preview starts once the page budget is spent: the rows left read 0 with flags_partial', async () => {
    const ids = Array.from({ length: 10 }, (_, i) => uid(1100 + i));
    const mocks = defaultMocks();
    let late = false;
    // The first cap read marks the budget spent; the 8 builds already in flight still finish.
    mocks.rates.memberCaps.mockImplementation(() => {
      late = true;
      return Promise.resolve({
        weekly_limit_hours: 0.5,
        monthly_limit_hours: null,
        overtime_requires_approval: true,
      });
    });
    const { service } = await setup(
      {
        timesheets: ids.map((id, i) =>
          sheet({ id, ...teamSheet, member_user_id: uid(5100 + i) }),
        ),
        time_entries: ids.map((id, i) =>
          entry({
            id: uid(1200 + i),
            ...teamEntry,
            member_user_id: uid(5100 + i),
            timesheet_id: id,
          }),
        ),
      },
      { time_approval_queue_ids: () => ({ data: ids }) },
      mocks,
    );
    const now = jest
      .spyOn(Date, 'now')
      .mockImplementation(() => (late ? FLAGS_BUDGET_MS + 1 : 0));
    try {
      const page = await service.queue(DECIDER, {
        status: 'submitted',
        page: 1,
        limit: 50,
      });
      expect(page.items.map((r) => r.id)).toEqual(ids);
      for (const r of page.items.slice(0, 8)) {
        expect(r).not.toHaveProperty('flags_partial');
        expect(r.flags?.over_cap_seconds).toBe(HOUR / 2);
      }
      for (const r of page.items.slice(8)) {
        expect(r.flags_partial).toBe(true);
        expect(r.flags?.over_cap_seconds).toBe(0);
      }
      // The two skipped sheets were never built.
      expect(mocks.rates.memberCaps).toHaveBeenCalledTimes(8);
    } finally {
      now.mockRestore();
    }
  });

  it('two sheets of one member are previewed alone, as each detail shows them (not as one bulk batch)', async () => {
    const mocks = defaultMocks();
    mocks.rates.memberCaps.mockResolvedValue({
      weekly_limit_hours: null,
      monthly_limit_hours: 10,
      overtime_requires_approval: false,
    });
    const { service } = await setup(
      {
        timesheets: [
          sheet({ id: S1, ...teamSheet }),
          sheet({
            id: S2,
            ...teamSheet,
            period_start: '2026-09-21',
            period_end: '2026-09-27',
            submitted_at: '2026-09-28T01:00:00.000Z',
          }),
        ],
        time_entries: [
          entry({ id: E1, ...teamEntry, duration_seconds: 7 * HOUR }),
          entry({
            id: E2,
            ...teamEntry,
            timesheet_id: S2,
            started_at: '2026-09-22T09:00:00.000Z',
            duration_seconds: 7 * HOUR,
          }),
        ],
      },
      { time_approval_queue_ids: () => ({ data: [S1, S2] }) },
      mocks,
    );
    const page = await service.queue(DECIDER, {
      status: 'submitted',
      page: 1,
      limit: 50,
    });
    expect(page.items.map((r) => r.flags?.over_cap_seconds)).toEqual([0, 0]);
    // Bulk-approving both would cut the later one; each detail (and so each row) shows it alone.
    const together = await service.buildFreeze([S1, S2], {
      approveOvertime: false,
      mode: 'approve',
    });
    expect(together.preview[S2].over_cap_seconds).toBe(4 * HOUR);
    const alone = await service.buildFreeze([S2], {
      approveOvertime: false,
      mode: 'approve',
    });
    expect(alone.preview[S2].over_cap_seconds).toBe(0);
  });

  it('past the first 50 waiting rows, over_cap_seconds reads 0 with flags_partial', async () => {
    const ids = Array.from({ length: 52 }, (_, i) => uid(1000 + i));
    const { service } = await setup(
      {
        timesheets: ids.map((id, i) =>
          sheet({ id, member_user_id: uid(5000 + i) }),
        ),
        time_entries: [],
      },
      { time_approval_queue_ids: () => ({ data: ids }) },
    );
    const page = await service.queue(DECIDER, {
      status: 'submitted',
      page: 1,
      limit: 100,
    });
    expect(page.items).toHaveLength(52);
    expect(page.items.filter((r) => r.flags_partial)).toHaveLength(2);
    expect(page.items.slice(50).map((r) => r.id)).toEqual(ids.slice(50));
    for (const r of page.items.slice(50)) {
      expect(r.flags_partial).toBe(true);
      expect(r.flags?.over_cap_seconds).toBe(0);
    }
    expect(page.items[0]).not.toHaveProperty('flags_partial');
  });

  it('a failed preview marks its rows partial and the queue still answers; the decided queue has no flags', async () => {
    const mocks = defaultMocks();
    mocks.rates.memberCaps.mockRejectedValue(new Error('rates exploded'));
    const { service } = await setup(
      {
        timesheets: [sheet({ id: S1, ...teamSheet })],
        time_entries: [entry({ id: E1, ...teamEntry })],
      },
      { time_approval_queue_ids: () => ({ data: [S1] }) },
      mocks,
    );
    const waiting = await service.queue(DECIDER, {
      status: 'submitted',
      page: 1,
      limit: 50,
    });
    expect(waiting.items[0]).toMatchObject({
      flags: { needs_review: 0, over_cap_seconds: 0, running: 0 },
      flags_partial: true,
    });

    const decided = await service.queue(DECIDER, {
      status: 'decided',
      page: 1,
      limit: 50,
    });
    expect(decided.items).toHaveLength(1);
    expect(decided.items[0]).not.toHaveProperty('flags');
    expect(decided.items[0]).not.toHaveProperty('flags_partial');
  });
});

describe('A10 bulk-approve STALE_REVISION names the sheet', () => {
  it.each([
    [
      'revision',
      { timesheet_id: S2, expected: 7, actual: 8 },
      { timesheet_id: S2, expected: 7, actual: 8 },
    ],
    [
      'entry_set',
      { reason: 'entry_set', timesheet_id: S2 },
      { timesheet_id: S2, reason: 'entry_set' },
    ],
  ])(
    '%s: 409 with timesheet_id, all or none, never retried',
    async (_kind, detail, extras) => {
      const { service, db, notifications } = await setup(
        {
          timesheets: [sheet({ id: S1 }), sheet({ id: S2, revision: 7 })],
          time_entries: [
            entry({ id: E1, timesheet_id: S1 }),
            entry({ id: E2, timesheet_id: S2 }),
          ],
        },
        transitionReturning(() => ({
          error: { message: 'STALE_REVISION', details: JSON.stringify(detail) },
        })),
      );
      const err = await service
        .approveBulk(DECIDER, { ids: [S1, S2], expected_revisions: [3, 7] })
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect((err as HttpException).getResponse()).toEqual({
        code: 'STALE_REVISION',
        message: 'This timesheet changed. Reload to see the latest version.',
        ...extras,
      });
      expect(transitionCalls(db)).toHaveLength(1);
      expect(notifications.sheetDecided).not.toHaveBeenCalled();
    },
  );
});

describe('A12 TIMESHEET_HAS_SETTLED_ENTRIES extras', () => {
  const INV1 = uid(400);
  const INV2 = uid(401);
  const PAY1 = uid(300);
  const PAY2 = uid(301);
  const SETTLED_MESSAGE =
    'This timesheet has time that was already paid or billed, so it cannot be reopened.';

  function refusing(reason: string) {
    return transitionReturning(() => ({
      error: {
        message: 'TIMESHEET_HAS_SETTLED_ENTRIES',
        details: JSON.stringify({ timesheet_id: S1, reason }),
      },
    }));
  }

  async function reopen(service: TimesheetsService): Promise<HttpException> {
    const err = await service
      .act(DECIDER, 'reopen', [S1], [3], { note: 'Split Thursday' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictException);
    return err as HttpException;
  }

  /** The decider path: DECIDER may decide S1 (D80 re-checks it before naming an invoice). */
  function deciderMocks(): Mocks {
    const m = defaultMocks();
    m.authority.canDecide.mockImplementation((user: string) =>
      Promise.resolve(user === DECIDER),
    );
    return m;
  }

  const approved = sheet({ status: 'approved', decision_kind: 'manual' });

  it('paid: the payout of the earliest paid entry on the sheet', async () => {
    const { service } = await setup(
      {
        timesheets: [approved],
        time_entries: [
          entry({ id: E1, payout_id: null }),
          entry({
            id: E2,
            started_at: '2026-09-17T09:00:00.000Z',
            payout_id: PAY1,
          }),
          entry({
            id: E3,
            started_at: '2026-09-16T09:00:00.000Z',
            payout_id: PAY2,
          }),
          // Another sheet's earlier payout never counts.
          entry({
            id: E4,
            timesheet_id: S2,
            started_at: '2026-09-01T09:00:00.000Z',
            payout_id: uid(302),
          }),
        ],
      },
      refusing('paid'),
    );
    expect((await reopen(service)).getResponse()).toEqual({
      code: 'TIMESHEET_HAS_SETTLED_ENTRIES',
      message: SETTLED_MESSAGE,
      timesheet_id: S1,
      reason: 'paid',
      payout_id: PAY2,
    });
  });

  it('paid with no payout: paid outside Proyekto', async () => {
    const { service } = await setup(
      {
        timesheets: [approved],
        time_entries: [
          entry({ id: E1, payout_id: null, legacy_status: 'paid_outside' }),
        ],
      },
      refusing('paid'),
    );
    const body = (await reopen(service)).getResponse();
    expect(body).toMatchObject({ reason: 'paid', paid_outside: true });
    expect(body).not.toHaveProperty('payout_id');
  });

  /** Two reservations on S1 (INV1 is the earliest) and an earlier one on another sheet. */
  const billedTables = (sheetRow: Row = approved): Record<string, Row[]> => ({
    timesheets: [sheetRow],
    time_entries: [
      entry({ id: E1 }),
      entry({ id: E2, started_at: '2026-09-16T09:00:00.000Z' }),
      entry({ id: E4, timesheet_id: S2 }),
    ],
    invoice_time_entries: [
      {
        invoice_id: INV2,
        entry_id: E1,
        created_at: '2026-09-25T00:00:00.000Z',
      },
      {
        invoice_id: INV1,
        entry_id: E2,
        created_at: '2026-09-22T00:00:00.000Z',
      },
      // Earlier, but on another sheet.
      {
        invoice_id: uid(402),
        entry_id: E4,
        created_at: '2026-09-01T00:00:00.000Z',
      },
    ],
    invoices: [
      { id: INV1, number: 'INV-0042', status: 'draft' },
      { id: INV2, number: 'INV-0043', status: 'issued' },
    ],
  });

  it('billed: the invoice of the earliest reservation on the sheet, with number and status', async () => {
    const { service, authority } = await setup(
      billedTables(),
      refusing('billed'),
      deciderMocks(),
    );
    expect((await reopen(service)).getResponse()).toEqual({
      code: 'TIMESHEET_HAS_SETTLED_ENTRIES',
      message: SETTLED_MESSAGE,
      timesheet_id: S1,
      reason: 'billed',
      invoice_id: INV1,
      invoice_number: 'INV-0042',
      invoice_status: 'draft',
    });
    // D80: the decider is re-checked before any invoice is named.
    expect(authority.canDecide).toHaveBeenCalledWith(DECIDER, S1);
  });

  it('a failed lookup keeps the original refusal; legacy adds nothing', async () => {
    const original = {
      code: 'TIMESHEET_HAS_SETTLED_ENTRIES',
      message: SETTLED_MESSAGE,
      timesheet_id: S1,
      reason: 'billed',
    };
    const a = await setup(
      {
        timesheets: [approved],
        time_entries: [entry({ id: E1 })],
        invoice_time_entries: [
          {
            invoice_id: INV1,
            entry_id: E1,
            created_at: '2026-09-22T00:00:00.000Z',
          },
        ],
      },
      refusing('billed'),
      deciderMocks(),
    );
    a.db.failures.invoices = { code: 'XX000', message: 'invoices exploded' };
    const err = await reopen(a.service);
    expect(err.getResponse()).toEqual(original);
    expect(JSON.stringify(err.getResponse())).not.toContain('exploded');
    expect(a.db.from.mock.calls.map(([t]) => t)).toContain('invoices');

    const b = await setup(
      { timesheets: [approved], time_entries: [entry({ id: E1 })] },
      refusing('legacy'),
    );
    expect((await reopen(b.service)).getResponse()).toEqual({
      ...original,
      reason: 'legacy',
    });
  });

  describe('D80: the invoice only for a caller who can see cost', () => {
    /** The member's own self-approved sheet (the member reopen path). */
    const ownSelf = sheet({
      status: 'approved',
      approver_scope: 'self',
      decision_kind: 'auto',
    });
    const memberReopen = async (
      service: TimesheetsService,
    ): Promise<HttpException> => {
      const err = await service
        .act(MEMBER, 'reopen', [S1], [3])
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ConflictException);
      return err as HttpException;
    };
    const tablesRead = (db: ReturnType<typeof fakeDb>) =>
      db.from.mock.calls.map(([t]) => t);

    it('a member reopening their own sheet gets the reason only: no invoice id, number or status, and none is read', async () => {
      const { service, db, authority } = await setup(
        billedTables(ownSelf),
        refusing('billed'),
        deciderMocks(),
      );
      const body = (await memberReopen(service)).getResponse();
      expect(body).toEqual({
        code: 'TIMESHEET_HAS_SETTLED_ENTRIES',
        message: SETTLED_MESSAGE,
        timesheet_id: S1,
        reason: 'billed',
      });
      expect(JSON.stringify(body)).not.toMatch(/INV-|invoice/);
      expect(tablesRead(db)).not.toContain('invoice_time_entries');
      expect(tablesRead(db)).not.toContain('invoices');
      expect(authority.canDecide).not.toHaveBeenCalled();
    });

    it('the member still gets payout_id and paid_outside (their own pay)', async () => {
      const paid = await setup(
        {
          timesheets: [ownSelf],
          time_entries: [entry({ id: E1, payout_id: PAY1 })],
        },
        refusing('paid'),
      );
      expect((await memberReopen(paid.service)).getResponse()).toMatchObject({
        reason: 'paid',
        payout_id: PAY1,
      });

      const outside = await setup(
        {
          timesheets: [ownSelf],
          time_entries: [
            entry({ id: E1, payout_id: null, legacy_status: 'paid_outside' }),
          ],
        },
        refusing('paid'),
      );
      expect((await memberReopen(outside.service)).getResponse()).toMatchObject(
        { reason: 'paid', paid_outside: true },
      );
    });

    it('a non-member who is not a decider of the sheet gets the reason only (re-checked, never assumed)', async () => {
      const { service, db, authority } = await setup(
        billedTables(),
        refusing('billed'),
      );
      // defaultMocks: canDecide answers false.
      const body = (await reopen(service)).getResponse();
      expect(body).not.toHaveProperty('invoice_id');
      expect(body).not.toHaveProperty('invoice_number');
      expect(body).not.toHaveProperty('invoice_status');
      expect(authority.canDecide).toHaveBeenCalledWith(DECIDER, S1);
      expect(tablesRead(db)).not.toContain('invoices');
    });

    it('a failed decider check keeps the original refusal', async () => {
      const m = deciderMocks();
      m.authority.canDecide.mockRejectedValue(new Error('rpc down'));
      const { service } = await setup(billedTables(), refusing('billed'), m);
      expect((await reopen(service)).getResponse()).toEqual({
        code: 'TIMESHEET_HAS_SETTLED_ENTRIES',
        message: SETTLED_MESSAGE,
        timesheet_id: S1,
        reason: 'billed',
      });
    });
  });
});

// ── D85: period rules on reads (overview contexts, reminder_days on summaries) ─
describe('D85 period rules on reads', () => {
  const TEAM_GONE = uid(21);
  const recentIso = (daysAgo: number) =>
    new Date(Date.now() - daysAgo * 86_400_000).toISOString();
  const MANILA = {
    timezone: 'Asia/Manila',
    week_start: 7,
    period_kind: 'semi_monthly',
    period_anchor: null,
    reminder_days: 2,
    rounding_minutes: 0,
    sources: {},
  };
  const scopeKey = (scope: { kind: string; ref: string }) =>
    `${scope.kind}:${scope.ref}`;

  describe('pure helpers', () => {
    it('reminderDaysOf keeps whole days ≥ 0 only', () => {
      expect(reminderDaysOf(0)).toBe(0);
      expect(reminderDaysOf(14)).toBe(14);
      expect(reminderDaysOf('3')).toBe(3);
      expect(reminderDaysOf(-1)).toBeNull();
      expect(reminderDaysOf(1.5)).toBeNull();
      expect(reminderDaysOf(null)).toBeNull();
      expect(reminderDaysOf(undefined)).toBeNull();
      expect(reminderDaysOf('soon')).toBeNull();
    });

    it('contextPolicyFields: null policy → all null; values read the way the server reads them', () => {
      expect(contextPolicyFields(null)).toEqual(NO_CONTEXT_POLICY);
      expect(
        contextPolicyFields({
          ...MANILA,
          period_kind: 'biweekly',
          period_anchor: '2026-01-04',
        } as never),
      ).toEqual({
        timezone: 'Asia/Manila',
        week_start: 7,
        period_kind: 'biweekly',
        period_anchor: '2026-01-04',
        reminder_days: 2,
      });
      // An invalid zone is UTC, week start Monday, kind weekly, no anchor; a missing reminder is 1 day.
      expect(
        contextPolicyFields({
          timezone: 'Mars/Olympus',
          week_start: 0,
          period_kind: 'fortnightly',
          period_anchor: 'soon',
        } as never),
      ).toEqual({
        timezone: 'UTC',
        week_start: 1,
        period_kind: 'weekly',
        period_anchor: null,
        reminder_days: 1,
      });
    });
  });

  describe('overview contexts', () => {
    function contextMocks() {
      const mocks = defaultMocks();
      mocks.policy.sheetScopeFor.mockImplementation(
        (kind: string, ref: string) => {
          if (kind === 'team' && ref === TEAM) {
            // A team without an override routes to its workspace.
            return Promise.resolve({
              scope_kind: 'workspace',
              scope_ref: WS,
              policy_workspace_id: WS,
              scope_label: 'Acme',
            });
          }
          if (kind === 'assignment' && ref === ASSIGN) {
            return Promise.resolve({
              scope_kind: 'engagement',
              scope_ref: ENG,
              policy_workspace_id: WS_OTHER,
              scope_label: 'Rico for Pixel',
            });
          }
          return Promise.reject(new Error('LOGGING_FOR_INVALID'));
        },
      );
      mocks.policy.resolve.mockImplementation(
        (scope: { kind: string; ref: string }) =>
          scopeKey(scope) === `workspace:${WS}`
            ? Promise.resolve(MANILA)
            : scopeKey(scope) === `engagement:${ENG}`
              ? Promise.resolve({
                  ...MANILA,
                  timezone: 'Europe/Berlin',
                  week_start: 1,
                  period_kind: 'biweekly',
                  period_anchor: '2026-09-07',
                  reminder_days: 0,
                })
              : Promise.reject(new Error('resolve down')),
      );
      return mocks;
    }

    function contextEntries(): Row[] {
      return [
        entry({
          id: E1,
          context_kind: 'team',
          context_ref: TEAM,
          team_id: TEAM,
          timesheet_id: null,
          started_at: recentIso(1),
        }),
        entry({
          id: E2,
          context_kind: 'workspace',
          context_ref: WS,
          timesheet_id: null,
          started_at: recentIso(2),
        }),
        entry({
          id: E3,
          context_kind: 'assignment',
          context_ref: ASSIGN,
          engagement_assignment_id: ASSIGN,
          timesheet_id: null,
          started_at: recentIso(3),
        }),
        entry({
          id: E4,
          context_kind: 'team',
          context_ref: TEAM_GONE,
          team_id: TEAM_GONE,
          timesheet_id: null,
          started_at: recentIso(4),
        }),
      ];
    }

    it('each context reads its routed scope now; one resolve per distinct scope; a failed scope read is null', async () => {
      const mocks = contextMocks();
      const { service, policy } = await setup(
        { time_entries: contextEntries() },
        { time_approval_queue_ids: () => ({ data: [] }) },
        mocks,
      );
      const o = await service.overview({ id: MEMBER });
      const byKey = new Map(o.contexts.map((c) => [`${c.kind}:${c.id}`, c]));
      const manila = {
        timezone: 'Asia/Manila',
        week_start: 7,
        period_kind: 'semi_monthly',
        period_anchor: null,
        reminder_days: 2,
      };
      // The team routes to its workspace: the same rules as the workspace context, read once.
      expect(byKey.get(`team:${TEAM}`)).toMatchObject(manila);
      expect(byKey.get(`workspace:${WS}`)).toMatchObject(manila);
      expect(byKey.get(`assignment:${ASSIGN}`)).toMatchObject({
        timezone: 'Europe/Berlin',
        week_start: 1,
        period_kind: 'biweekly',
        period_anchor: '2026-09-07',
        reminder_days: 0,
      });
      // A context the scope call refuses (me/entries reads it in the person's own zone): null here.
      expect(byKey.get(`team:${TEAM_GONE}`)).toMatchObject(NO_CONTEXT_POLICY);

      expect(policy.sheetScopeFor.mock.calls).toEqual(
        expect.arrayContaining([
          ['team', TEAM, null],
          ['assignment', ASSIGN, null],
          ['team', TEAM_GONE, null],
        ]),
      );
      // A workspace context is its own scope.
      expect(policy.sheetScopeFor).toHaveBeenCalledTimes(3);
      expect(policy.resolve).toHaveBeenCalledTimes(2);
      expect(policy.resolve).toHaveBeenCalledWith(
        { kind: 'workspace', ref: WS },
        WS,
        expect.any(Date),
      );
      expect(policy.resolve).toHaveBeenCalledWith(
        { kind: 'engagement', ref: ENG },
        WS_OTHER,
        expect.any(Date),
      );
    });

    it('a failed policy read leaves only that context null; the overview still answers', async () => {
      const mocks = contextMocks();
      mocks.policy.sheetScopeFor.mockImplementation(() =>
        Promise.resolve({
          scope_kind: 'team',
          scope_ref: TEAM,
          policy_workspace_id: WS,
          scope_label: 'Design',
        }),
      );
      const [teamEntry, workspaceEntry] = contextEntries();
      const { service } = await setup(
        { time_entries: [teamEntry, workspaceEntry] },
        { time_approval_queue_ids: () => ({ data: [] }) },
        mocks,
      );
      const o = await service.overview({ id: MEMBER });
      expect(o.contexts.map((c) => c.kind)).toEqual(['team', 'workspace']);
      // team:TEAM rejects in contextMocks' resolve; the workspace context still reads.
      expect(o.contexts[0]).toMatchObject(NO_CONTEXT_POLICY);
      expect(o.contexts[1]).toMatchObject({ timezone: 'Asia/Manila' });
    });

    it('the recent contexts read their rules alongside the sheet reads; a context only on an open sheet reads after', async () => {
      const mocks = contextMocks();
      const [teamEntry, workspaceEntry] = contextEntries();
      // An assignment context with no recent entry, only an older entry on an open sheet.
      const onSheetOnly = entry({
        id: E3,
        context_kind: 'assignment',
        context_ref: ASSIGN,
        engagement_assignment_id: ASSIGN,
        timesheet_id: S1,
        started_at: recentIso(40),
      });
      const { service, policy, db } = await setup(
        {
          time_entries: [teamEntry, workspaceEntry, onSheetOnly],
          timesheets: [sheet({ status: 'open', approver_scope: null })],
        },
        { time_approval_queue_ids: () => ({ data: [] }) },
        mocks,
      );
      const o = await service.overview({ id: MEMBER });

      const byKey = new Map(o.contexts.map((c) => [`${c.kind}:${c.id}`, c]));
      expect(byKey.get(`team:${TEAM}`)).toMatchObject({
        timezone: 'Asia/Manila',
      });
      expect(byKey.get(`assignment:${ASSIGN}`)).toMatchObject({
        timezone: 'Europe/Berlin',
        reminder_days: 0,
      });

      const firstSheetRead = Math.min(
        ...db.from.mock.calls.flatMap((call, i) =>
          call[0] === 'timesheets' ? [db.from.mock.invocationCallOrder[i]] : [],
        ),
      );
      const scopeCallOrder = (kind: string, ref: string) =>
        policy.sheetScopeFor.mock.invocationCallOrder[
          policy.sheetScopeFor.mock.calls.findIndex(
            (call) => call[0] === kind && call[1] === ref,
          )
        ];
      // The team's scope call (from a recent entry) does not wait for the sheet reads.
      expect(scopeCallOrder('team', TEAM)).toBeLessThan(firstSheetRead);
      // The assignment is known only from its sheet's entries.
      expect(scopeCallOrder('assignment', ASSIGN)).toBeGreaterThan(
        firstSheetRead,
      );
      // Still one scope call per context and one resolve per distinct scope.
      expect(policy.sheetScopeFor).toHaveBeenCalledTimes(2);
      expect(policy.resolve).toHaveBeenCalledTimes(2);
    });
  });

  describe('reminder_days on summaries', () => {
    const S4 = uid(103);
    const S5 = uid(104);
    const S6 = uid(105);
    const S7 = uid(106);
    const snapshot = (over: Row) => ({
      rounding_minutes: 0,
      weekly_limit_minutes: null,
      sources: {},
      routing: {
        base: 'workspace',
        cost_money: false,
        deciders_count: 1,
        fallback: 'none',
      },
      ...over,
    });

    function reminderMocks() {
      const mocks = defaultMocks();
      mocks.policy.resolve.mockImplementation(
        (scope: { kind: string; ref: string }) =>
          scope.kind === 'workspace'
            ? Promise.resolve({ ...MANILA, reminder_days: 5 })
            : Promise.reject(new Error('resolve down')),
      );
      return mocks;
    }

    it('me/timesheets: the scope policy now when open or returned, the snapshot when submitted or approved, else absent', async () => {
      const mocks = reminderMocks();
      const { service, policy } = await setup(
        {
          timesheets: [
            sheet({
              id: S1,
              status: 'submitted',
              policy_snapshot: snapshot({ reminder_days: 3 }),
            }),
            sheet({
              id: S2,
              status: 'open',
              approver_scope: null,
              policy_snapshot: {},
              period_start: '2026-09-21',
              period_end: '2026-09-27',
            }),
            // A pre-move open sheet keeps a legacy snapshot; the auto-submit check re-resolves, so does this.
            sheet({
              id: S3,
              status: 'open',
              approver_scope: null,
              policy_snapshot: snapshot({ reminder_days: 9, legacy: true }),
              period_start: '2026-09-28',
              period_end: '2026-10-04',
            }),
            // A snapshot without the key: unknown, so absent.
            sheet({
              id: S4,
              status: 'approved',
              period_start: '2026-08-31',
              period_end: '2026-09-06',
            }),
            // An open team sheet whose policy read fails: absent, the list still answers.
            sheet({
              id: S5,
              status: 'open',
              approver_scope: null,
              policy_snapshot: {},
              scope_kind: 'team',
              scope_ref: TEAM,
              team_id: TEAM,
              period_start: '2026-08-24',
              period_end: '2026-08-30',
            }),
            // Returned: the reminder check still acts on it and resolves when it runs, so not the snapshot.
            sheet({
              id: S6,
              status: 'returned',
              policy_snapshot: snapshot({ reminder_days: 8 }),
              period_start: '2026-08-17',
              period_end: '2026-08-23',
            }),
            // A zero-day snapshot is a value, not a gap.
            sheet({
              id: S7,
              status: 'approved',
              policy_snapshot: snapshot({ reminder_days: 0 }),
              period_start: '2026-08-10',
              period_end: '2026-08-16',
            }),
          ],
          time_entries: [],
        },
        {},
        mocks,
      );
      const items = await service.listMine(MEMBER, {});
      const byId = new Map(items.map((s) => [s.id, s]));
      expect(byId.get(S1)?.reminder_days).toBe(3);
      expect(byId.get(S2)?.reminder_days).toBe(5);
      expect(byId.get(S3)?.reminder_days).toBe(5);
      expect(byId.get(S4)).not.toHaveProperty('reminder_days');
      expect(byId.get(S5)).not.toHaveProperty('reminder_days');
      expect(byId.get(S6)?.reminder_days).toBe(5);
      expect(byId.get(S7)?.reminder_days).toBe(0);
      // The read key never reaches the answer, and neither does the snapshot.
      for (const s of items) {
        expect(s).not.toHaveProperty('snapshot_reminder_days');
        expect(s).not.toHaveProperty('policy_snapshot');
      }
      // One resolve per distinct scope of the open sheets.
      expect(policy.resolve).toHaveBeenCalledTimes(2);
      expect(policy.resolve).toHaveBeenCalledWith(
        { kind: 'workspace', ref: WS },
        WS,
        expect.any(Date),
      );
      expect(policy.resolve).toHaveBeenCalledWith(
        { kind: 'team', ref: TEAM },
        WS,
        expect.any(Date),
      );
    });

    it('approval rows: the waiting queue reads the snapshot; a reopened (open) decided row reads its scope', async () => {
      const mocks = reminderMocks();
      const { service } = await setup(
        {
          timesheets: [
            sheet({
              id: S1,
              status: 'submitted',
              policy_snapshot: snapshot({ reminder_days: 4 }),
            }),
            sheet({
              id: S2,
              status: 'approved',
              decided_at: '2026-09-22T01:00:00.000Z',
              policy_snapshot: snapshot({ reminder_days: 6 }),
            }),
            sheet({
              id: S3,
              status: 'open',
              approver_scope: null,
              decided_at: null,
              policy_snapshot: {},
            }),
          ],
          time_entries: [],
        },
        {
          time_approval_queue_ids: (args) => ({
            data: args.p_status === 'submitted' ? [S1] : [S2, S3],
          }),
        },
        mocks,
      );
      const waiting = await service.queue(DECIDER, {
        status: 'submitted',
        page: 1,
        limit: 50,
      });
      expect(waiting.items.map((r) => [r.id, r.reminder_days])).toEqual([
        [S1, 4],
      ]);
      expect(waiting.items[0]).not.toHaveProperty('snapshot_reminder_days');
      const decided = await service.queue(DECIDER, {
        status: 'decided',
        page: 1,
        limit: 50,
      });
      expect(
        new Map(decided.items.map((r) => [r.id, r.reminder_days])),
      ).toEqual(
        new Map([
          [S2, 6],
          [S3, 5],
        ]),
      );
    });

    it('detail: the sheet carries the snapshot value, or the scope policy now while open or returned', async () => {
      const submitted = sheet({
        status: 'submitted',
        policy_snapshot: snapshot({ reminder_days: 7 }),
      });
      const a = reminderMocks();
      a.authority.assertViewTimesheet.mockResolvedValue(submitted);
      const one = await setup(
        { timesheets: [submitted], time_entries: [entry({})] },
        {},
        a,
      );
      const detail = await one.service.get(MEMBER, S1);
      expect(detail.sheet.reminder_days).toBe(7);
      expect(one.policy.resolve).not.toHaveBeenCalled();

      const open = sheet({
        status: 'open',
        approver_scope: null,
        policy_snapshot: {},
        period_start: '2999-01-04',
        period_end: '2999-01-10',
      });
      const b = reminderMocks();
      b.authority.assertViewTimesheet.mockResolvedValue(open);
      const two = await setup(
        { timesheets: [open], time_entries: [entry({})] },
        {},
        b,
      );
      expect((await two.service.get(MEMBER, S1)).sheet.reminder_days).toBe(5);
      expect(two.policy.resolve).toHaveBeenCalledWith(
        { kind: 'workspace', ref: WS },
        WS,
        expect.any(Date),
      );

      // Returned: the scope policy now, not the submit-time snapshot.
      const returned = sheet({
        status: 'returned',
        policy_snapshot: snapshot({ reminder_days: 8 }),
      });
      const r = reminderMocks();
      r.authority.assertViewTimesheet.mockResolvedValue(returned);
      const back = await setup(
        { timesheets: [returned], time_entries: [entry({})] },
        {},
        r,
      );
      expect((await back.service.get(MEMBER, S1)).sheet.reminder_days).toBe(5);

      // A failed read leaves it out; the detail still answers.
      const c = defaultMocks();
      c.policy.resolve.mockRejectedValue(new Error('resolve down'));
      c.authority.assertViewTimesheet.mockResolvedValue(open);
      const three = await setup(
        { timesheets: [open], time_entries: [entry({})] },
        {},
        c,
      );
      expect((await three.service.get(MEMBER, S1)).sheet).not.toHaveProperty(
        'reminder_days',
      );
    });
  });
});
