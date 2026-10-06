import {
  BadRequestException,
  ConflictException,
  HttpException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import { EngagementsService } from '../../marketplace/engagements/engagements.service';
import { ProjectAuthorizationService } from '../projects/authorization/project-authorization.service';
import { resolvePermissions } from '../projects/permissions/project-permissions';
import { LoggingContextService } from './logging-context.service';
import { TimeAuthorityService } from './time-authority.service';
import { TimeEntriesService } from './time-entries.service';
import {
  ALIAS_LOCKED_MESSAGE,
  RUNNING_TIMER_MESSAGE,
  timeError,
  timeNotFound,
} from './time-errors';
import { TimeNotificationsService } from './time-notifications.service';
import { TimePolicyService } from './time-policy.service';
import { TimeRatesService } from './time-rates.service';
import type { LoggingOption, ResolvedTimePolicy } from './time.types';

// ── ids and clock ───────────────────────────────────────────────────────────────────────────────────────────
const uid = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const USER = uid(1);
const OTHER = uid(2);
const PROJECT = uid(10);
const PROJECT_B = uid(11);
const WS = uid(20);
const TEAM = uid(30);
const TEAM_B = uid(31);
const ASSIGN = uid(40);
const ENG = uid(50);
const TASK = uid(60);
const TASK_B = uid(61);
const SHEET = uid(70);
const ENTRY = uid(80);

/** Wednesday 2026-10-07, 11:00 in Manila. */
const NOW = '2026-10-07T03:00:00.000Z';

type Row = Record<string, any>;

// ── a small PostgREST stand-in ──────────────────────────────────────────────────────────────────────────────
interface Call {
  table: string;
  op: 'select' | 'insert' | 'update' | 'delete' | 'upsert';
  select?: string;
  selectOpts?: Row;
  values?: Row;
  upsertOpts?: Row;
  filters: Array<[string, string, unknown]>;
}

type Pred = (r: Row) => boolean;

function getPath(row: Row, path: string): unknown {
  return path
    .split('.')
    .reduce<any>((v, k) => (v == null ? undefined : v[k]), row);
}

function cmp(a: unknown, b: unknown): number {
  if (typeof a === 'string' && typeof b === 'string') {
    const am = Date.parse(a);
    const bm = Date.parse(b);
    if (/^\d{4}-\d{2}-\d{2}T/.test(a) && !Number.isNaN(am) && !Number.isNaN(bm))
      return am - bm;
    return a < b ? -1 : a > b ? 1 : 0;
  }
  return Number(a) - Number(b);
}

function opPred(col: string, op: string, raw: unknown): Pred {
  const value =
    typeof raw === 'string' && raw.startsWith('"') && raw.endsWith('"')
      ? raw.slice(1, -1)
      : raw;
  switch (op) {
    case 'eq':
      return (r) => getPath(r, col) === value;
    case 'neq':
      return (r) => getPath(r, col) !== value;
    case 'gt':
      return (r) => getPath(r, col) != null && cmp(getPath(r, col), value) > 0;
    case 'gte':
      return (r) => getPath(r, col) != null && cmp(getPath(r, col), value) >= 0;
    case 'lt':
      return (r) => getPath(r, col) != null && cmp(getPath(r, col), value) < 0;
    case 'lte':
      return (r) => getPath(r, col) != null && cmp(getPath(r, col), value) <= 0;
    case 'is':
      return (r) =>
        value === null || value === 'null'
          ? getPath(r, col) == null
          : getPath(r, col) === (value === 'true' || value === true);
    default:
      throw new Error(`fake: unsupported op ${op}`);
  }
}

/** `a.op.v,b.op."v"` (top-level commas only). */
function orPred(expr: string): Pred {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let cur = '';
  for (const ch of expr) {
    if (ch === '"') quoted = !quoted;
    if (!quoted && ch === '(') depth++;
    if (!quoted && ch === ')') depth--;
    if (!quoted && depth === 0 && ch === ',') {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  parts.push(cur);
  const preds = parts.map((p) => {
    const first = p.indexOf('.');
    const second = p.indexOf('.', first + 1);
    return opPred(
      p.slice(0, first),
      p.slice(first + 1, second),
      p.slice(second + 1),
    );
  });
  return (r) => preds.some((pr) => pr(r));
}

let generated = 0;

function fakeDb(tables: Record<string, Row[]>) {
  const calls: Call[] = [];
  const failures: Array<{ table: string; op: Call['op']; error: Row }> = [];
  const rpc = jest.fn<
    Promise<{ data: unknown; error: unknown }>,
    [name: string, args: Row]
  >(() => Promise.resolve({ data: null, error: null }));

  const from = jest.fn((table: string) => {
    const call: Call = { table, op: 'select', filters: [] };
    calls.push(call);
    const preds: Pred[] = [];
    const orders: Array<[string, boolean]> = [];
    let rangeFrom: number | null = null;
    let rangeTo: number | null = null;
    let limitN: number | null = null;
    let returning = false;

    const exec = (): { data: unknown; error: unknown; count?: number } => {
      const failIdx = failures.findIndex(
        (f) => f.table === table && f.op === call.op,
      );
      if (failIdx >= 0) {
        const [f] = failures.splice(failIdx, 1);
        return { data: null, error: f.error };
      }
      const rows = (tables[table] ??= []);
      if (call.op === 'insert' || call.op === 'upsert') {
        const values = { ...(call.values as Row) };
        if (call.op === 'upsert') {
          const key = String(call.upsertOpts?.onConflict ?? 'id');
          const existing = rows.find((r) => r[key] === values[key]);
          if (existing) {
            if (!call.upsertOpts?.ignoreDuplicates)
              Object.assign(existing, values);
            return { data: returning ? { ...existing } : null, error: null };
          }
        }
        const row = { ...defaultsFor(table), ...values };
        rows.push(row);
        return { data: returning ? { ...row } : null, error: null };
      }
      let matched = rows.filter((r) => preds.every((p) => p(r)));
      if (call.op === 'delete') {
        tables[table] = rows.filter((r) => !matched.includes(r));
        return {
          data: returning ? matched.map((r) => ({ ...r })) : null,
          error: null,
        };
      }
      if (call.op === 'update') {
        for (const r of matched) {
          Object.assign(
            r,
            call.values,
            table === 'time_entries' ? { updated_at: bumpStamp() } : {},
          );
        }
        return {
          data: returning ? matched.map((r) => ({ ...r })) : null,
          error: null,
        };
      }
      for (const [col, asc] of [...orders].reverse()) {
        matched = [...matched].sort((a, b) => {
          const c = cmp(getPath(a, col), getPath(b, col));
          return asc ? c : -c;
        });
      }
      const count = matched.length;
      if (rangeFrom !== null && rangeTo !== null)
        matched = matched.slice(rangeFrom, rangeTo + 1);
      if (limitN !== null) matched = matched.slice(0, limitN);
      return { data: matched.map((r) => ({ ...r })), error: null, count };
    };

    const chain: any = {
      select: (s: string, opts?: Row) => {
        if (call.op === 'select') {
          call.select = s;
          call.selectOpts = opts;
        } else {
          returning = true;
          call.select = s;
        }
        return chain;
      },
      insert: (v: Row) => {
        call.op = 'insert';
        call.values = v;
        return chain;
      },
      upsert: (v: Row, opts?: Row) => {
        call.op = 'upsert';
        call.values = v;
        call.upsertOpts = opts;
        return chain;
      },
      update: (v: Row) => {
        call.op = 'update';
        call.values = v;
        return chain;
      },
      delete: () => {
        call.op = 'delete';
        return chain;
      },
      eq: (c: string, v: unknown) => {
        call.filters.push(['eq', c, v]);
        preds.push(opPred(c, 'eq', v));
        return chain;
      },
      neq: (c: string, v: unknown) => {
        call.filters.push(['neq', c, v]);
        preds.push(opPred(c, 'neq', v));
        return chain;
      },
      is: (c: string, v: unknown) => {
        call.filters.push(['is', c, v]);
        preds.push(opPred(c, 'is', v));
        return chain;
      },
      gt: (c: string, v: unknown) => {
        call.filters.push(['gt', c, v]);
        preds.push(opPred(c, 'gt', v));
        return chain;
      },
      gte: (c: string, v: unknown) => {
        call.filters.push(['gte', c, v]);
        preds.push(opPred(c, 'gte', v));
        return chain;
      },
      lt: (c: string, v: unknown) => {
        call.filters.push(['lt', c, v]);
        preds.push(opPred(c, 'lt', v));
        return chain;
      },
      lte: (c: string, v: unknown) => {
        call.filters.push(['lte', c, v]);
        preds.push(opPred(c, 'lte', v));
        return chain;
      },
      in: (c: string, vs: unknown[]) => {
        call.filters.push(['in', c, vs]);
        preds.push((r) => vs.includes(getPath(r, c)));
        return chain;
      },
      or: (expr: string) => {
        call.filters.push(['or', expr, null]);
        preds.push(orPred(expr));
        return chain;
      },
      order: (c: string, o?: { ascending?: boolean }) => {
        orders.push([c, o?.ascending !== false]);
        return chain;
      },
      range: (a: number, b: number) => {
        rangeFrom = a;
        rangeTo = b;
        return chain;
      },
      limit: (n: number) => {
        limitN = n;
        return chain;
      },
      maybeSingle: () => {
        const res = exec();
        const data = Array.isArray(res.data) ? (res.data[0] ?? null) : res.data;
        return Promise.resolve({ data, error: res.error });
      },
      single: () => {
        const res = exec();
        const data = Array.isArray(res.data) ? (res.data[0] ?? null) : res.data;
        return Promise.resolve({ data, error: res.error });
      },
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
        Promise.resolve(exec()).then(ok, ko),
    };
    return chain;
  });

  return {
    sb: { from, rpc } as unknown as SupabaseClient,
    from,
    rpc,
    calls,
    tables,
    failNext(table: string, op: Call['op'], error: Row) {
      failures.push({ table, op, error });
    },
    writes(table: string, op: Call['op']) {
      return calls.filter((c) => c.table === table && c.op === op);
    },
  };
}

let stamp = 0;
function bumpStamp(): string {
  stamp += 1;
  return new Date(Date.parse(NOW) + stamp).toISOString();
}

function defaultsFor(table: string): Row {
  generated += 1;
  if (table === 'time_entries') {
    return {
      id: `gen-entry-${generated}`,
      timesheet_id: null,
      timesheet: null,
      paused_at: null,
      ended_at: null,
      duration_seconds: null,
      break_seconds: 0,
      break_minutes: 0,
      payable_seconds: null,
      legacy_status: null,
      payout_id: null,
      flagged_reason: null,
      amount_snapshot: null,
      task: null,
      member: null,
      project: null,
      created_at: NOW,
      updated_at: NOW,
    };
  }
  if (table === 'time_entry_comments') {
    return {
      id: `gen-comment-${generated}`,
      created_at: NOW,
      updated_at: NOW,
      author: null,
    };
  }
  return { id: `gen-${generated}` };
}

// ── fixtures ────────────────────────────────────────────────────────────────────────────────────────────────
function basePolicy(
  over: Partial<ResolvedTimePolicy> = {},
): ResolvedTimePolicy {
  return {
    tracking_enabled: true,
    period_kind: 'weekly',
    week_start: 1,
    timezone: 'UTC',
    period_anchor: null,
    approval_required: true,
    approver_scope: 'workspace',
    allow_manual_entries: true,
    retroactive_days: null,
    rounding_minutes: 0,
    weekly_limit_minutes: null,
    reminder_days: 1,
    hidden_presets: [],
    tracking_mode: null,
    sources: {},
    plan: { time_tracking: true, time_team_rules: true },
    policy_workspace_id: WS,
    team_override_applied: false,
    member: null,
    client_hours_detail_level: null,
    ...over,
  };
}

function option(over: Partial<LoggingOption> = {}): LoggingOption {
  return {
    kind: 'team',
    id: TEAM,
    label: 'Design team',
    sheet_scope: { kind: 'workspace', ref: WS },
    rate_source: 'none',
    workspace_tag: null,
    approver_hint: 'workspace',
    ...over,
  };
}

const PERSONAL: LoggingOption = {
  kind: 'personal',
  id: null,
  label: 'Just me',
  sheet_scope: null,
  rate_source: 'none',
  workspace_tag: null,
  approver_hint: null,
};

function entry(over: Row = {}): Row {
  return {
    id: ENTRY,
    context_kind: 'team',
    context_ref: TEAM,
    context_label_snapshot: 'Design team',
    timesheet_id: SHEET,
    work_item: 'other',
    started_at: '2026-10-06T01:00:00.000Z',
    ended_at: '2026-10-06T03:00:00.000Z',
    paused_at: null,
    duration_seconds: 7200,
    break_seconds: 0,
    break_minutes: 0,
    payable_seconds: null,
    source: 'manual',
    work_type_snapshot: 'real_work',
    legacy_status: null,
    payout_id: null,
    flagged_reason: null,
    project_id: PROJECT,
    team_id: TEAM,
    workspace_id: null,
    engagement_assignment_id: null,
    created_at: '2026-10-06T03:00:00.000Z',
    updated_at: '2026-10-06T03:00:00.000000+00:00',
    timesheet: {
      id: SHEET,
      status: 'open',
      period_start: '2026-10-05',
      period_end: '2026-10-11',
      decision_kind: null,
      decided_by: null,
      decided_at: null,
      decision_note: null,
      scope_label_snapshot: 'Acme',
    },
    member_user_id: USER,
    member_display_name_snapshot: 'Ana Cruz',
    member: { id: USER, display_name: 'Ana Cruz', avatar_url: null },
    task_id: null,
    note: null,
    task: null,
    project: { id: PROJECT, title: 'Pixel' },
    rate_snapshot: 25,
    rate_type_snapshot: 'hourly',
    currency_snapshot: 'USD',
    amount_snapshot: null,
    ...over,
  };
}

function running(over: Row = {}): Row {
  return entry({
    source: 'timer',
    started_at: '2026-10-07T01:00:00.000Z',
    ended_at: null,
    duration_seconds: null,
    ...over,
  });
}

function baseTables(): Record<string, Row[]> {
  return {
    profiles: [
      {
        id: USER,
        display_name: '  ',
        first_name: 'Ana',
        last_name: 'Cruz',
        email: 'ana@example.test',
      },
    ],
    projects: [
      { id: PROJECT, owner_id: OTHER, workspace_id: WS },
      { id: PROJECT_B, owner_id: OTHER, workspace_id: WS },
    ],
    roadmap_tasks: [
      {
        id: TASK,
        title: 'Hero banner',
        work_type: 'training',
        feature_id: uid(90),
        feature: {
          id: uid(90),
          title: 'Landing',
          epic_id: uid(91),
          epic: {
            id: uid(91),
            title: 'Site',
            roadmap: { project_id: PROJECT },
          },
        },
      },
      {
        id: TASK_B,
        title: 'Other project task',
        work_type: null,
        feature_id: uid(92),
        feature: {
          id: uid(92),
          title: 'B feature',
          epic_id: uid(93),
          epic: {
            id: uid(93),
            title: 'B epic',
            roadmap: { project_id: PROJECT_B },
          },
        },
      },
    ],
    time_entries: [],
    time_entry_segments: [],
    time_entry_comments: [],
    invoice_time_entries: [],
    timesheets: [],
    team_member_rates: [],
    user_time_preferences: [],
  };
}

const ownAuth = (row: Row) => ({
  id: row.id,
  member_user_id: row.member_user_id,
  project_id: row.project_id,
  context_kind: row.context_kind,
  context_ref: row.context_ref,
  team_id: row.team_id,
  workspace_id: row.workspace_id,
  engagement_assignment_id: row.engagement_assignment_id,
  timesheet_id: row.timesheet_id,
  started_at: row.started_at,
});

async function build(
  o: {
    tables?: Record<string, Row[]>;
    policy?: Partial<ResolvedTimePolicy>;
    option?: LoggingOption;
    viewable?: string[];
  } = {},
) {
  const db = fakeDb(o.tables ?? baseTables());
  const chosen = o.option ?? option();
  const loggingContext = {
    select: jest.fn(() => Promise.resolve(chosen)),
    resolve: jest.fn(),
    policyFor: jest.fn(),
  };
  const policy = {
    sheetScopeFor: jest.fn(() =>
      Promise.resolve({
        scope_kind: 'workspace',
        scope_ref: WS,
        policy_workspace_id: WS,
        scope_label: 'Acme',
      }),
    ),
    resolve: jest.fn(() => Promise.resolve(basePolicy(o.policy))),
    teamTimezone: jest.fn(() => Promise.resolve('Asia/Manila')),
    workspaceTimezone: jest.fn(() => Promise.resolve('UTC')),
  };
  const rates = {
    estimate: jest.fn(() =>
      Promise.resolve({
        rate_snapshot: 25,
        rate_type_snapshot: 'hourly',
        currency_snapshot: 'PHP',
      }),
    ),
  };
  const lookup = (id: string) =>
    db.tables.time_entries.find((r) => r.id === id);
  const viewable = new Set(o.viewable ?? []);
  const authority = {
    assertOwnEntry: jest.fn((userId: string, id: string) => {
      const row = lookup(id);
      if (!row || row.member_user_id !== userId)
        return Promise.reject(timeNotFound('entry'));
      return Promise.resolve(ownAuth(row));
    }),
    assertViewEntry: jest.fn((userId: string, id: string) => {
      const row = lookup(id);
      if (!row || (row.member_user_id !== userId && !viewable.has(userId)))
        return Promise.reject(timeNotFound('entry'));
      return Promise.resolve(ownAuth(row));
    }),
    hydrate: jest.fn((_viewer: string, rows: Row[]) =>
      Promise.resolve(rows.map((r) => ({ id: r.id, identity: 'masked' }))),
    ),
    isTeamManager: jest.fn(() => Promise.resolve(false)),
    identityVisible: jest.fn(() => Promise.resolve(new Set<string>())),
  };
  const notifications = {
    timerStopped: jest.fn(() => Promise.resolve()),
    commentAdded: jest.fn(() => Promise.resolve()),
  };
  const projectAuth = {
    resolvePermissions: jest.fn(() =>
      Promise.resolve(resolvePermissions('editor', null)),
    ),
  };
  const engagements = { getAssignment: jest.fn() };

  const moduleRef = await Test.createTestingModule({
    providers: [
      TimeEntriesService,
      { provide: SUPABASE_ADMIN, useValue: db.sb },
      { provide: ProjectAuthorizationService, useValue: projectAuth },
      { provide: LoggingContextService, useValue: loggingContext },
      { provide: TimePolicyService, useValue: policy },
      { provide: TimeRatesService, useValue: rates },
      { provide: TimeAuthorityService, useValue: authority },
      { provide: TimeNotificationsService, useValue: notifications },
      { provide: EngagementsService, useValue: engagements },
    ],
  }).compile();
  return {
    service: moduleRef.get(TimeEntriesService),
    db,
    loggingContext,
    policy,
    rates,
    authority,
    notifications,
    projectAuth,
    engagements,
  };
}

/** The HttpException body (code, message, extras). */
async function errorOf(p: Promise<unknown>): Promise<{
  status: number;
  body: Row;
  error: unknown;
}> {
  try {
    await p;
  } catch (error) {
    if (error instanceof HttpException) {
      const response = error.getResponse();
      return {
        status: error.getStatus(),
        body:
          typeof response === 'string'
            ? { message: response }
            : (response as Row),
        error,
      };
    }
    throw error;
  }
  throw new Error('expected a rejection');
}

beforeEach(() => {
  jest.useFakeTimers({
    now: new Date(NOW),
    doNotFake: [
      'nextTick',
      'setImmediate',
      'clearImmediate',
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'queueMicrotask',
    ],
  });
});
afterEach(() => {
  jest.useRealTimers();
});

// ── start ───────────────────────────────────────────────────────────────────────────────────────────────────
describe('start', () => {
  it('inserts the resolved context, the rate estimate and the snapshot, then opens a work segment', async () => {
    const b = await build();
    const result = await b.service.start(USER, { project_id: PROJECT });

    expect(b.loggingContext.select).toHaveBeenCalledWith(USER, PROJECT, {
      requested: undefined,
      at: new Date(NOW),
      purpose: 'timer',
      remember: false,
    });
    const [insert] = b.db.writes('time_entries', 'insert');
    expect(insert.values).toMatchObject({
      context_kind: 'team',
      context_ref: TEAM,
      team_id: TEAM,
      workspace_id: null,
      engagement_assignment_id: null,
      context_label_snapshot: 'Design team',
      project_id: PROJECT,
      task_id: null,
      work_item: 'other',
      member_user_id: USER,
      started_at: NOW,
      source: 'timer',
      rate_snapshot: 25,
      rate_type_snapshot: 'hourly',
      currency_snapshot: 'PHP',
      work_type_snapshot: 'real_work',
      member_display_name_snapshot: 'Ana Cruz',
    });
    expect(insert.values).not.toHaveProperty('status');
    expect(b.db.writes('time_entry_segments', 'insert')[0].values).toEqual({
      entry_id: result.id,
      kind: 'work',
      started_at: NOW,
    });
    expect(result).toMatchObject({
      identity: 'visible',
      content: 'visible',
      cost: 'visible',
      currency_snapshot: 'PHP',
      warnings: [],
      locked_reason: null,
    });
  });

  it('a task snapshots its own work type and makes the work item "task"', async () => {
    const b = await build();
    await b.service.start(USER, {
      project_id: PROJECT,
      task_id: TASK,
      work_type: 'real_work',
    });
    const [insert] = b.db.writes('time_entries', 'insert');
    expect(insert.values).toMatchObject({
      task_id: TASK,
      work_item: 'task',
      work_type_snapshot: 'training',
    });
    expect(b.rates.estimate).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'team' }),
      USER,
      PROJECT,
      'training',
      new Date(NOW),
    );
  });

  it('refuses a task and a work item together, a task of another project, and a hidden preset (422)', async () => {
    const both = await build();
    expect(
      (
        await errorOf(
          both.service.start(USER, {
            project_id: PROJECT,
            task_id: TASK,
            work_item: 'meeting',
          }),
        )
      ).body.code,
    ).toBe('WORK_ITEM_INVALID');

    const foreign = await build();
    const e = await errorOf(
      foreign.service.start(USER, { project_id: PROJECT, task_id: TASK_B }),
    );
    expect(e.status).toBe(422);
    expect(e.body.code).toBe('WORK_ITEM_INVALID');
    expect(foreign.db.writes('time_entries', 'insert')).toHaveLength(0);

    const hidden = await build({ policy: { hidden_presets: ['meeting'] } });
    expect(
      (
        await errorOf(
          hidden.service.start(USER, {
            project_id: PROJECT,
            work_item: 'meeting',
          }),
        )
      ).status,
    ).toBe(422);
    await hidden.service.start(USER, {
      project_id: PROJECT,
      work_item: 'review',
    });
    expect(
      hidden.db.writes('time_entries', 'insert')[0].values?.work_item,
    ).toBe('review');
  });

  it('remembers the choice only for a timer that asks, and passes the alias purpose through', async () => {
    const b = await build();
    await b.service.start(USER, {
      project_id: PROJECT,
      logging_for: { kind: 'team', id: TEAM },
      remember: true,
    });
    expect(b.loggingContext.select).toHaveBeenLastCalledWith(
      USER,
      PROJECT,
      expect.objectContaining({
        requested: { kind: 'team', id: TEAM },
        remember: true,
        purpose: 'timer',
      }),
    );

    b.db.tables.time_entries = [];
    await b.service.start(
      USER,
      { project_id: PROJECT, remember: true },
      { purpose: 'alias', native: true },
    );
    expect(b.loggingContext.select).toHaveBeenLastCalledWith(
      USER,
      PROJECT,
      expect.objectContaining({ purpose: 'alias', remember: false }),
    );
  });

  it('a second running timer is 409 TIMER_ALREADY_RUNNING; on the alias it is the PR-0 400 (D07)', async () => {
    const conflict = {
      code: '23505',
      message:
        'duplicate key value violates unique constraint "uq_time_entries_one_running_per_member"',
    };
    const b = await build();
    b.db.failNext('time_entries', 'insert', conflict);
    const e = await errorOf(b.service.start(USER, { project_id: PROJECT }));
    expect(e.status).toBe(409);
    expect(e.body.code).toBe('TIMER_ALREADY_RUNNING');
    expect(b.db.writes('time_entry_segments', 'insert')).toHaveLength(0);

    b.db.failNext('time_entries', 'insert', conflict);
    const legacy = await errorOf(
      b.service.start(USER, { project_id: PROJECT }, { purpose: 'alias' }),
    );
    expect(legacy.error).toBeInstanceOf(BadRequestException);
    expect(legacy.body.message).toBe(RUNNING_TIMER_MESSAGE);
  });

  it('a running timer elsewhere is refused first, before the resolver, the task and the caps (D77)', async () => {
    // The caller's timer runs on another project under another context; the new start would also be refused
    // by the resolver (403) and by a full cap, but the running timer wins, as in the old startLog.
    const tables = (): Record<string, Row[]> => ({
      ...baseTables(),
      time_entries: [
        running({
          id: uid(87),
          project_id: PROJECT_B,
          context_kind: 'assignment',
          context_ref: ASSIGN,
          team_id: null,
          engagement_assignment_id: ASSIGN,
        }),
      ],
    });
    const fullCap = {
      member: {
        weekly_limit_hours: 1,
        monthly_limit_hours: null,
        overtime_requires_approval: true,
      },
    };

    const b = await build({ tables: tables(), policy: fullCap });
    b.loggingContext.select.mockRejectedValue(timeError('NO_LOGGING_CONTEXT'));
    const e = await errorOf(
      b.service.start(USER, { project_id: PROJECT, task_id: TASK }),
    );
    expect(e.status).toBe(409);
    expect(e.body.code).toBe('TIMER_ALREADY_RUNNING');
    expect(b.loggingContext.select).not.toHaveBeenCalled();
    expect(b.policy.resolve).not.toHaveBeenCalled();
    expect(b.rates.estimate).not.toHaveBeenCalled();
    expect(b.db.calls.some((c) => c.table === 'roadmap_tasks')).toBe(false);
    expect(b.db.writes('time_entries', 'insert')).toHaveLength(0);
    expect(b.db.writes('time_entry_segments', 'insert')).toHaveLength(0);

    // The alias keeps the exact PR-0 400 (D07).
    const a = await build({ tables: tables(), policy: fullCap });
    a.loggingContext.select.mockRejectedValue(timeError('NO_LOGGING_CONTEXT'));
    const legacy = await errorOf(
      a.service.start(
        USER,
        { project_id: PROJECT },
        { purpose: 'alias', native: true },
      ),
    );
    expect(legacy.status).toBe(400);
    expect(legacy.error).toBeInstanceOf(BadRequestException);
    expect(legacy.body.message).toBe(RUNNING_TIMER_MESSAGE);
    expect(a.loggingContext.select).not.toHaveBeenCalled();
    expect(a.db.writes('time_entries', 'insert')).toHaveLength(0);
  });

  it("only the caller's own open timer counts: a stopped entry or another member's timer does not block (D77)", async () => {
    const t = baseTables();
    t.time_entries = [
      entry({ id: uid(88) }),
      running({ id: uid(89), member_user_id: OTHER }),
    ];
    const b = await build({ tables: t });
    await b.service.start(USER, { project_id: PROJECT });
    expect(b.db.writes('time_entries', 'insert')).toHaveLength(1);
    // The pre-check is the first time_entries read: the caller's open rows only, any project, any context.
    const pre = b.db.calls.find((c) => c.table === 'time_entries')!;
    expect(pre.op).toBe('select');
    expect(pre.filters).toEqual([
      ['eq', 'member_user_id', USER],
      ['is', 'ended_at', null],
    ]);
  });

  it('a submitted period is 409 TIMESHEET_LOCKED {reason: period, sheet_status} (D50)', async () => {
    const b = await build();
    b.db.failNext('time_entries', 'insert', {
      code: 'P0001',
      message: 'TIME_PERIOD_LOCKED',
      details: JSON.stringify({ timesheet_id: SHEET, status: 'submitted' }),
    });
    const e = await errorOf(b.service.start(USER, { project_id: PROJECT }));
    expect(e.status).toBe(409);
    expect(e.body).toMatchObject({
      code: 'TIMESHEET_LOCKED',
      reason: 'period',
      timesheet_id: SHEET,
      sheet_status: 'submitted',
    });
    expect(e.body).not.toHaveProperty('status');
  });

  it('an unmapped database error is TIME_INTERNAL with no Postgres text (D55)', async () => {
    const b = await build();
    b.db.failNext('time_entries', 'insert', {
      code: '42703',
      message: 'column "secret_column" does not exist',
    });
    const e = await errorOf(b.service.start(USER, { project_id: PROJECT }));
    expect(e.status).toBe(500);
    expect(e.body.code).toBe('TIME_INTERNAL');
    expect(JSON.stringify(e.body)).not.toContain('secret_column');
  });

  it('a resolver refusal writes nothing (no access 404, viewer 403)', async () => {
    const b = await build();
    b.loggingContext.select.mockRejectedValueOnce(timeNotFound('scope'));
    expect(
      (
        await errorOf(
          b.service.start(USER, { project_id: PROJECT, task_id: TASK }),
        )
      ).status,
    ).toBe(404);
    b.loggingContext.select.mockRejectedValueOnce(
      timeError('NO_LOGGING_CONTEXT'),
    );
    expect(
      (
        await errorOf(
          b.service.start(USER, { project_id: PROJECT, task_id: TASK }),
        )
      ).body.code,
    ).toBe('NO_LOGGING_CONTEXT');
    expect(b.db.writes('time_entries', 'insert')).toHaveLength(0);
    // The task lookup never runs for a caller the resolver refused.
    expect(b.db.calls.some((c) => c.table === 'roadmap_tasks')).toBe(false);
  });

  it('personal time reads no policy and writes no context ids', async () => {
    const b = await build({ option: PERSONAL });
    await b.service.start(USER, { project_id: PROJECT });
    expect(b.policy.resolve).not.toHaveBeenCalled();
    expect(b.db.writes('time_entries', 'insert')[0].values).toMatchObject({
      context_kind: 'personal',
      context_ref: null,
      team_id: null,
      workspace_id: null,
      engagement_assignment_id: null,
      context_label_snapshot: null,
    });
  });
});

// ── hour caps (D46) ─────────────────────────────────────────────────────────────────────────────────────────
describe('hour caps (D46)', () => {
  const caps = (overtime: boolean) => ({
    weekly_limit_hours: 10,
    monthly_limit_hours: null,
    overtime_requires_approval: overtime,
  });
  function tablesWithLogged(hours: number, extra: Row[] = []) {
    const t = baseTables();
    t.time_entries = [
      entry({
        id: uid(81),
        started_at: '2026-10-05T01:00:00.000Z',
        ended_at: '2026-10-05T11:00:00.000Z',
        duration_seconds: hours * 3600,
      }),
      ...extra,
    ];
    return t;
  }

  it('a manual entry past the weekly cap is 422 only when overtime needs approval', async () => {
    const blocked = await build({
      tables: tablesWithLogged(9),
      policy: { member: caps(true), timezone: 'Asia/Manila' },
    });
    const e = await errorOf(
      blocked.service.createManual(USER, {
        project_id: PROJECT,
        started_at: '2026-10-06T01:00:00.000Z',
        ended_at: '2026-10-06T03:00:00.000Z',
      }),
    );
    expect(e.status).toBe(422);
    expect(e.body).toMatchObject({
      code: 'HOUR_CAP_EXCEEDED',
      limit_window: 'weekly',
      limit_hours: 10,
      logged_hours: 9,
      window_start: '2026-10-05',
      window_end: '2026-10-11',
    });
    expect(blocked.db.writes('time_entries', 'insert')).toHaveLength(0);

    const allowed = await build({
      tables: tablesWithLogged(9),
      policy: { member: caps(false) },
    });
    await allowed.service.createManual(USER, {
      project_id: PROJECT,
      started_at: '2026-10-06T01:00:00.000Z',
      ended_at: '2026-10-06T03:00:00.000Z',
    });
    expect(allowed.db.writes('time_entries', 'insert')).toHaveLength(1);
  });

  it('rejected legacy rows and other teams do not count; a timer cannot start once the window is full', async () => {
    const t = tablesWithLogged(9, [
      entry({
        id: uid(82),
        started_at: '2026-10-06T05:00:00.000Z',
        ended_at: '2026-10-06T10:00:00.000Z',
        duration_seconds: 5 * 3600,
        legacy_status: 'rejected',
      }),
      entry({
        id: uid(83),
        context_ref: TEAM_B,
        team_id: TEAM_B,
        started_at: '2026-10-06T05:00:00.000Z',
        ended_at: '2026-10-06T10:00:00.000Z',
        duration_seconds: 5 * 3600,
      }),
    ]);
    const b = await build({ tables: t, policy: { member: caps(true) } });
    // 9 h counted, so a timer may still start.
    await b.service.start(USER, { project_id: PROJECT });

    const full = await build({
      tables: tablesWithLogged(10),
      policy: { member: caps(true) },
    });
    const e = await errorOf(full.service.start(USER, { project_id: PROJECT }));
    expect(e.body.code).toBe('HOUR_CAP_EXCEEDED');
  });
});

// ── stop, pause, resume ─────────────────────────────────────────────────────────────────────────────────────
describe('stop / pause / resume', () => {
  it('stop folds an open pause, closes the open segment and clears the long-timer notice (D61)', async () => {
    const t = baseTables();
    t.time_entries = [
      running({
        paused_at: '2026-10-07T02:30:00.000Z',
        break_seconds: 600,
      }),
    ];
    t.time_entry_segments = [
      {
        id: uid(100),
        entry_id: ENTRY,
        kind: 'break',
        started_at: '2026-10-07T02:30:00.000Z',
        ended_at: null,
      },
    ];
    const b = await build({ tables: t });
    const view = await b.service.stop(USER, ENTRY);

    const [update] = b.db.writes('time_entries', 'update');
    expect(update.values).toEqual({
      ended_at: NOW,
      // 2 h gross − (600 s banked + 30 min open pause)
      duration_seconds: 7200 - 2400,
      break_seconds: 2400,
      break_minutes: 40,
      paused_at: null,
    });
    expect(update.filters).toContainEqual(['is', 'ended_at', null]);
    expect(b.db.tables.time_entry_segments[0].ended_at).toBe(NOW);
    expect(b.notifications.timerStopped).toHaveBeenCalledWith({
      id: ENTRY,
      member_user_id: USER,
    });
    expect(view.ended_at).toBe(NOW);
    // Never touches context or sheet (L60).
    for (const column of [
      'context_kind',
      'context_ref',
      'team_id',
      'timesheet_id',
      'started_at',
    ]) {
      expect(update.values).not.toHaveProperty(column);
    }
  });

  it('an old client break in minutes is used only when nothing was stored (alias)', async () => {
    const t = baseTables();
    t.time_entries = [running()];
    const b = await build({ tables: t });
    await b.service.stop(USER, ENTRY, {
      breakMinutes: 5,
      endedAt: '2026-10-07T02:00:00.000Z',
      alias: { native: false },
    });
    expect(b.db.writes('time_entries', 'update')[0].values).toMatchObject({
      ended_at: '2026-10-07T02:00:00.000Z',
      break_seconds: 300,
      duration_seconds: 3600 - 300,
    });
  });

  it('stopping a stopped entry is 409 TIMER_NOT_RUNNING; a lost race too', async () => {
    const t = baseTables();
    t.time_entries = [entry()];
    const b = await build({ tables: t });
    expect((await errorOf(b.service.stop(USER, ENTRY))).body.code).toBe(
      'TIMER_NOT_RUNNING',
    );

    // Another request stops it between the read and the write: the `ended_at IS NULL` filter matches nothing.
    const raced = await build({
      tables: { ...baseTables(), time_entries: [running()] },
    });
    const origFrom = raced.db.from.getMockImplementation()!;
    raced.db.from.mockImplementation((table: string) => {
      const chain = origFrom(table);
      const update = chain.update;
      chain.update = (v: Row) => {
        raced.db.tables.time_entries[0].ended_at = NOW;
        return update(v);
      };
      return chain;
    });
    const e = await errorOf(raced.service.stop(USER, ENTRY));
    expect(e.status).toBe(409);
    expect(e.body.code).toBe('TIMER_NOT_RUNNING');
    expect(raced.notifications.timerStopped).not.toHaveBeenCalled();
  });

  it("someone else's entry is 404 (never 403); a system stop skips the member check and flags it", async () => {
    const t = baseTables();
    t.time_entries = [running({ member_user_id: OTHER })];
    const b = await build({ tables: t });
    const e = await errorOf(b.service.stop(USER, ENTRY));
    expect(e.error).toBeInstanceOf(NotFoundException);

    await b.service.stop(null, ENTRY, {
      system: true,
      endedAt: '2026-10-08T01:00:00.000Z',
      flaggedReason: 'auto_stopped_24h',
    });
    expect(b.db.writes('time_entries', 'update')[0].values).toMatchObject({
      ended_at: '2026-10-08T01:00:00.000Z',
      flagged_reason: 'auto_stopped_24h',
      duration_seconds: 24 * 3600,
    });
    // System stops are notified by their caller (timer_auto_stopped), not here.
    expect(b.notifications.timerStopped).not.toHaveBeenCalled();
  });

  it('an end before the start is 400 for a person', async () => {
    const t = baseTables();
    t.time_entries = [running()];
    const b = await build({ tables: t });
    const e = await errorOf(
      b.service.stop(USER, ENTRY, { endedAt: '2026-10-07T00:00:00.000Z' }),
    );
    expect(e.status).toBe(400);
  });

  it('pause freezes the clock and switches the segment to a break; resume banks it', async () => {
    const t = baseTables();
    t.time_entries = [running({ break_seconds: 60 })];
    t.time_entry_segments = [
      {
        id: uid(100),
        entry_id: ENTRY,
        kind: 'work',
        started_at: '2026-10-07T01:00:00.000Z',
        ended_at: null,
      },
    ];
    const b = await build({ tables: t });
    await b.service.pause(USER, ENTRY);
    expect(b.db.writes('time_entries', 'update')[0].values).toEqual({
      paused_at: NOW,
    });
    expect(b.db.tables.time_entry_segments).toEqual([
      expect.objectContaining({ kind: 'work', ended_at: NOW }),
      expect.objectContaining({ kind: 'break', started_at: NOW }),
    ]);
    expect((await errorOf(b.service.pause(USER, ENTRY))).body.message).toBe(
      'This timer is already on break.',
    );

    jest.setSystemTime(new Date('2026-10-07T03:15:00.000Z'));
    await b.service.resume(USER, ENTRY);
    expect(b.db.writes('time_entries', 'update')[1].values).toEqual({
      paused_at: null,
      break_seconds: 60 + 900,
      break_minutes: 16,
    });
    expect(b.db.tables.time_entry_segments.map((s) => s.kind)).toEqual([
      'work',
      'break',
      'work',
    ]);
    expect((await errorOf(b.service.resume(USER, ENTRY))).body.code).toBe(
      'TIMER_NOT_RUNNING',
    );
  });
});

// ── manual time ─────────────────────────────────────────────────────────────────────────────────────────────
describe('createManual', () => {
  const manual = (over: Row = {}) => ({
    project_id: PROJECT,
    started_at: '2026-10-06T01:00:00.000Z',
    ended_at: '2026-10-06T03:00:00.000Z',
    ...over,
  });

  it('writes the net duration; break_seconds wins over the deprecated break_minutes (D43)', async () => {
    const b = await build();
    const view = await b.service.createManual(
      USER,
      manual({ break_seconds: 900, break_minutes: 1 }),
    );
    expect(b.db.writes('time_entries', 'insert')[0].values).toMatchObject({
      source: 'manual',
      started_at: '2026-10-06T01:00:00.000Z',
      ended_at: '2026-10-06T03:00:00.000Z',
      break_seconds: 900,
      break_minutes: 15,
      duration_seconds: 7200 - 900,
    });
    expect(view.warnings).toEqual([]);
    expect(b.loggingContext.select).toHaveBeenCalledWith(
      USER,
      PROJECT,
      expect.objectContaining({
        at: new Date('2026-10-06T01:00:00.000Z'),
        purpose: 'manual',
      }),
    );

    const minutes = await build();
    await minutes.service.createManual(USER, manual({ break_minutes: 10 }));
    expect(
      minutes.db.writes('time_entries', 'insert')[0].values?.break_seconds,
    ).toBe(600);
  });

  it('an end at or before the start is 400', async () => {
    const b = await build();
    const e = await errorOf(
      b.service.createManual(
        USER,
        manual({ ended_at: '2026-10-06T01:00:00.000Z' }),
      ),
    );
    expect(e.status).toBe(400);
    expect(b.loggingContext.select).not.toHaveBeenCalled();
  });

  it('MANUAL_ENTRIES_DISABLED is 403', async () => {
    const b = await build({ policy: { allow_manual_entries: false } });
    const e = await errorOf(b.service.createManual(USER, manual()));
    expect(e.status).toBe(403);
    expect(e.body.code).toBe('MANUAL_ENTRIES_DISABLED');
    expect(b.db.writes('time_entries', 'insert')).toHaveLength(0);
  });

  it('RETROACTIVE_WINDOW counts local days in the policy timezone', async () => {
    // Now = 2026-10-07 11:00 Manila. With 2 days the floor is 2026-10-05 (local).
    const policy = { retroactive_days: 2, timezone: 'Asia/Manila' };
    // 2026-10-04T17:00Z is 2026-10-05 01:00 in Manila: inside the window (it would be outside in UTC).
    const inside = await build({ policy });
    await inside.service.createManual(
      USER,
      manual({
        started_at: '2026-10-04T17:00:00.000Z',
        ended_at: '2026-10-04T18:00:00.000Z',
      }),
    );
    expect(inside.db.writes('time_entries', 'insert')).toHaveLength(1);

    // 2026-10-04T15:00Z is 2026-10-04 23:00 in Manila: outside.
    const outside = await build({ policy });
    const e = await errorOf(
      outside.service.createManual(
        USER,
        manual({
          started_at: '2026-10-04T15:00:00.000Z',
          ended_at: '2026-10-04T15:30:00.000Z',
        }),
      ),
    );
    expect(e.status).toBe(422);
    expect(e.body).toMatchObject({
      code: 'RETROACTIVE_WINDOW',
      earliest_date: '2026-10-05',
    });
  });

  it('personal time is never limited by a policy', async () => {
    const b = await build({
      option: PERSONAL,
      policy: { allow_manual_entries: false, retroactive_days: 1 },
    });
    await b.service.createManual(
      USER,
      manual({
        started_at: '2026-01-01T01:00:00.000Z',
        ended_at: '2026-01-01T02:00:00.000Z',
      }),
    );
    expect(b.db.writes('time_entries', 'insert')).toHaveLength(1);
  });

  it('overlap only warns (E28)', async () => {
    const t = baseTables();
    t.time_entries = [
      entry({
        id: uid(84),
        started_at: '2026-10-06T02:00:00.000Z',
        ended_at: '2026-10-06T04:00:00.000Z',
      }),
      entry({
        id: uid(85),
        started_at: '2026-10-06T03:00:00.000Z',
        ended_at: '2026-10-06T05:00:00.000Z',
      }),
    ];
    const b = await build({ tables: t });
    const view = await b.service.createManual(USER, manual());
    expect(view.warnings).toEqual([{ code: 'OVERLAP', entry_ids: [uid(84)] }]);
  });

  it('the contract weekly limit only warns, over the engagement week (D46)', async () => {
    const t = baseTables();
    t.timesheets = [
      {
        id: uid(71),
        member_user_id: USER,
        scope_kind: 'engagement',
        scope_ref: ENG,
        period_start: '2026-10-05',
        period_end: '2026-10-11',
      },
    ];
    t.time_entries = [
      entry({
        id: uid(86),
        context_kind: 'assignment',
        context_ref: ASSIGN,
        team_id: null,
        engagement_assignment_id: ASSIGN,
        timesheet_id: uid(71),
        started_at: '2026-10-05T01:00:00.000Z',
        ended_at: '2026-10-05T03:00:00.000Z',
        duration_seconds: 7200,
      }),
    ];
    const b = await build({
      tables: t,
      option: option({
        kind: 'assignment',
        id: ASSIGN,
        label: 'Acme',
        sheet_scope: { kind: 'engagement', ref: ENG },
      }),
      policy: {
        weekly_limit_minutes: 180,
        sources: { weekly_limit_minutes: 'contract' },
      },
    });
    b.policy.sheetScopeFor.mockResolvedValue({
      scope_kind: 'engagement',
      scope_ref: ENG,
      policy_workspace_id: WS,
      scope_label: 'Acme',
    } as never);
    const view = await b.service.createManual(USER, manual());
    expect(view.warnings).toEqual([
      {
        code: 'CONTRACT_WEEKLY_LIMIT',
        limit_minutes: 180,
        logged_minutes: 240,
      },
    ]);
    expect(b.db.writes('time_entries', 'insert')[0].values).toMatchObject({
      context_kind: 'assignment',
      engagement_assignment_id: ASSIGN,
      team_id: null,
    });
  });

  it('a workspace-sourced weekly limit on an engagement entry does not warn CONTRACT_WEEKLY_LIMIT (D76)', async () => {
    const t = baseTables();
    t.timesheets = [
      {
        id: uid(71),
        member_user_id: USER,
        scope_kind: 'engagement',
        scope_ref: ENG,
        period_start: '2026-10-05',
        period_end: '2026-10-11',
      },
    ];
    t.time_entries = [
      entry({
        id: uid(86),
        context_kind: 'assignment',
        context_ref: ASSIGN,
        team_id: null,
        engagement_assignment_id: ASSIGN,
        timesheet_id: uid(71),
        started_at: '2026-10-05T01:00:00.000Z',
        ended_at: '2026-10-05T03:00:00.000Z',
        duration_seconds: 7200,
      }),
    ];
    const b = await build({
      tables: t,
      option: option({
        kind: 'assignment',
        id: ASSIGN,
        label: 'Acme',
        sheet_scope: { kind: 'engagement', ref: ENG },
      }),
      // The contract sets no limit; the 180 min comes from the workspace policy (never cut, D65).
      policy: {
        weekly_limit_minutes: 180,
        sources: { weekly_limit_minutes: 'workspace' },
      },
    });
    b.policy.sheetScopeFor.mockResolvedValue({
      scope_kind: 'engagement',
      scope_ref: ENG,
      policy_workspace_id: WS,
      scope_label: 'Acme',
    } as never);
    const view = await b.service.createManual(USER, manual());
    expect(view.warnings).toEqual([]);
    // No week scan when the limit is not the contract's.
    expect(b.db.calls.some((c) => c.table === 'timesheets')).toBe(false);
  });
});

// ── policy weekly limit (A6) ────────────────────────────────────────────────────────────────────────────────
describe('policy weekly limit (A6, D65)', () => {
  /** The member's workspace sheet for the week of NOW (Mon Oct 5 – Sun Oct 11, UTC policy). */
  const wsSheet = (over: Row = {}): Row => ({
    id: SHEET,
    member_user_id: USER,
    scope_kind: 'workspace',
    scope_ref: WS,
    period_start: '2026-10-05',
    period_end: '2026-10-11',
    ...over,
  });
  /** 2 h already logged on that sheet (Tue Oct 6). */
  const tables = (extra: Partial<Record<string, Row[]>> = {}) => ({
    ...baseTables(),
    timesheets: [wsSheet()],
    time_entries: [entry()],
    ...extra,
  });
  const limit = (
    minutes: number,
    source: string = 'workspace',
  ): Partial<ResolvedTimePolicy> => ({
    weekly_limit_minutes: minutes,
    sources: { weekly_limit_minutes: source as never },
  });
  const manual = (over: Row = {}) => ({
    project_id: PROJECT,
    started_at: '2026-10-07T01:00:00.000Z',
    ended_at: '2026-10-07T03:00:00.000Z',
    ...over,
  });
  const sheetReads = (b: Awaited<ReturnType<typeof build>>) =>
    b.db.calls.filter((c) => c.table === 'timesheets').length;

  it('manual time past a workspace limit warns with the sheet scope label; nothing blocks', async () => {
    const b = await build({ tables: tables(), policy: limit(180) });
    const view = await b.service.createManual(USER, manual());
    expect(view.warnings).toEqual([
      {
        code: 'POLICY_WEEKLY_LIMIT',
        limit_minutes: 180,
        logged_minutes: 240,
        label: 'Acme',
      },
    ]);
    expect(b.db.writes('time_entries', 'insert')).toHaveLength(1);
    // The week is read on the member's sheets of that scope only.
    const sheetsCall = b.db.calls.find((c) => c.table === 'timesheets');
    expect(sheetsCall?.filters).toEqual(
      expect.arrayContaining([
        ['eq', 'member_user_id', USER],
        ['eq', 'scope_kind', 'workspace'],
        ['eq', 'scope_ref', WS],
      ]),
    );
  });

  it('a team-override limit warns the same way; a workspace option too', async () => {
    const team = await build({ tables: tables(), policy: limit(180, 'team') });
    expect(
      (await team.service.createManual(USER, manual())).warnings,
    ).toMatchObject([{ code: 'POLICY_WEEKLY_LIMIT', label: 'Acme' }]);

    const ws = await build({
      tables: tables(),
      policy: limit(180),
      option: option({
        kind: 'workspace',
        id: WS,
        label: 'Acme',
        sheet_scope: { kind: 'workspace', ref: WS },
      }),
    });
    expect(
      (await ws.service.createManual(USER, manual())).warnings,
    ).toMatchObject([{ code: 'POLICY_WEEKLY_LIMIT', logged_minutes: 240 }]);
  });

  it('at or under the limit there is no warning', async () => {
    const b = await build({ tables: tables(), policy: limit(240) });
    const view = await b.service.createManual(USER, manual());
    expect(view.warnings).toEqual([]);
  });

  it('a default-, contract- or member-sourced limit never raises it, and reads no week', async () => {
    for (const source of ['default', 'contract', 'member']) {
      const b = await build({ tables: tables(), policy: limit(60, source) });
      const view = await b.service.createManual(USER, manual());
      expect(view.warnings).toEqual([]);
      expect(sheetReads(b)).toBe(0);
    }
  });

  it('agreement and personal time never raise it (team and workspace contexts only)', async () => {
    const assignment = await build({
      tables: tables(),
      policy: limit(60),
      option: option({
        kind: 'assignment',
        id: ASSIGN,
        label: 'Acme Corp',
        sheet_scope: { kind: 'engagement', ref: ENG },
      }),
    });
    assignment.policy.sheetScopeFor.mockResolvedValue({
      scope_kind: 'engagement',
      scope_ref: ENG,
      policy_workspace_id: WS,
      scope_label: 'Acme Corp',
    } as never);
    expect(
      (await assignment.service.createManual(USER, manual())).warnings,
    ).toEqual([]);
    expect(sheetReads(assignment)).toBe(0);

    const personal = await build({
      tables: tables(),
      policy: limit(60),
      option: PERSONAL,
    });
    expect(
      (await personal.service.createManual(USER, manual())).warnings,
    ).toEqual([]);
    expect(sheetReads(personal)).toBe(0);
  });

  it("only the member's own sheets of that scope count, and legacy rejected time is out", async () => {
    const b = await build({
      tables: tables({
        timesheets: [
          wsSheet(),
          wsSheet({ id: uid(71), scope_kind: 'team', scope_ref: TEAM_B }),
          wsSheet({ id: uid(72), member_user_id: OTHER }),
        ],
        time_entries: [
          entry(),
          entry({ id: uid(81), timesheet_id: uid(71) }),
          entry({
            id: uid(82),
            timesheet_id: uid(72),
            member_user_id: OTHER,
          }),
          entry({ id: uid(83), legacy_status: 'rejected' }),
          // Last week, same sheet scope: outside the window.
          entry({
            id: uid(84),
            started_at: '2026-10-04T23:00:00.000Z',
            ended_at: '2026-10-04T23:30:00.000Z',
            duration_seconds: 1800,
          }),
        ],
      }),
      policy: limit(200),
    });
    const view = await b.service.createManual(USER, manual());
    expect(view.warnings).toEqual([
      {
        code: 'POLICY_WEEKLY_LIMIT',
        limit_minutes: 200,
        logged_minutes: 240,
        label: 'Acme',
      },
    ]);
  });

  it('a timer warns when the week already holds the limit', async () => {
    const at = await build({ tables: tables(), policy: limit(120) });
    expect(
      (await at.service.start(USER, { project_id: PROJECT })).warnings,
    ).toEqual([
      {
        code: 'POLICY_WEEKLY_LIMIT',
        limit_minutes: 120,
        logged_minutes: 120,
        label: 'Acme',
      },
    ]);
    const under = await build({ tables: tables(), policy: limit(121) });
    expect(
      (await under.service.start(USER, { project_id: PROJECT })).warnings,
    ).toEqual([]);
  });

  it('the alias answers no warnings, so it never reads the week', async () => {
    const b = await build({ tables: tables(), policy: limit(60) });
    await b.service.createManual(USER, manual(), { purpose: 'alias' });
    await b.service.start(USER, { project_id: PROJECT }, { purpose: 'alias' });
    expect(sheetReads(b)).toBe(0);
  });

  it('an edit that adds hours warns, read after the write (the edited entry counted once)', async () => {
    const b = await build({ tables: tables(), policy: limit(180) });
    const view = await b.service.update(USER, ENTRY, {
      ended_at: '2026-10-06T05:00:00.000Z',
    });
    expect(view.duration_seconds).toBe(4 * 3600);
    expect(view.warnings).toEqual([
      {
        code: 'POLICY_WEEKLY_LIMIT',
        limit_minutes: 180,
        logged_minutes: 240,
        label: 'Acme',
      },
    ]);
  });

  it('an edit that changes no hours and no context reads no week', async () => {
    const b = await build({ tables: tables(), policy: limit(60) });
    const view = await b.service.update(USER, ENTRY, { note: 'Kickoff' });
    expect(view.warnings).toEqual([]);
    expect(sheetReads(b)).toBe(0);
    const unchanged = await build({ tables: tables(), policy: limit(60) });
    expect((await unchanged.service.update(USER, ENTRY, {})).warnings).toEqual(
      [],
    );
  });

  it('a running timer moved earlier warns once the week holds the limit', async () => {
    const b = await build({
      tables: tables({ time_entries: [entry(), running({ id: uid(85) })] }),
      policy: limit(120),
    });
    const view = await b.service.update(USER, uid(85), {
      started_at: '2026-10-07T00:30:00.000Z',
    });
    expect(view.warnings).toMatchObject([
      { code: 'POLICY_WEEKLY_LIMIT', logged_minutes: 120 },
    ]);
  });

  it('a failed week read after a saved edit gives no warning, never an error', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const b = await build({ tables: tables(), policy: limit(60) });
    b.db.failNext('timesheets', 'select', {
      code: '42P01',
      message: 'relation does not exist',
    });
    const view = await b.service.update(USER, ENTRY, {
      ended_at: '2026-10-06T05:00:00.000Z',
    });
    expect(view.warnings).toEqual([]);
    expect(b.db.tables.time_entries[0].duration_seconds).toBe(4 * 3600);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('a failed week read never refuses Add time or Start: the write lands with no warning', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const failure = { code: '42P01', message: 'relation does not exist' };
    const created = await build({ tables: tables(), policy: limit(60) });
    created.db.failNext('timesheets', 'select', failure);
    const view = await created.service.createManual(USER, manual());
    expect(view.warnings).toEqual([]);
    expect(created.db.writes('time_entries', 'insert')).toHaveLength(1);

    const started = await build({ tables: tables(), policy: limit(60) });
    started.db.failNext('timesheets', 'select', failure);
    const timer = await started.service.start(USER, { project_id: PROJECT });
    expect(timer.warnings).toEqual([]);
    expect(started.db.writes('time_entries', 'insert')).toHaveLength(1);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it('A-4: a failed contract week read never refuses Add time or Start either: the write lands with no warning', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const failure = { code: '42P01', message: 'relation does not exist' };
    const agreement = async () => {
      const b = await build({
        tables: tables({
          timesheets: [
            wsSheet({ id: uid(71), scope_kind: 'engagement', scope_ref: ENG }),
          ],
        }),
        option: option({
          kind: 'assignment',
          id: ASSIGN,
          label: 'Acme Corp',
          sheet_scope: { kind: 'engagement', ref: ENG },
        }),
        policy: limit(60, 'contract'),
      });
      b.policy.sheetScopeFor.mockResolvedValue({
        scope_kind: 'engagement',
        scope_ref: ENG,
        policy_workspace_id: WS,
        scope_label: 'Acme Corp',
      } as never);
      b.db.failNext('timesheets', 'select', failure);
      return b;
    };

    const created = await agreement();
    const view = await created.service.createManual(USER, manual());
    expect(view.warnings).toEqual([]);
    expect(created.db.writes('time_entries', 'insert')).toHaveLength(1);

    const started = await agreement();
    const timer = await started.service.start(USER, { project_id: PROJECT });
    expect(timer.warnings).toEqual([]);
    expect(started.db.writes('time_entries', 'insert')).toHaveLength(1);

    // The contract read is the one that failed (logged, never in the body).
    expect(warn.mock.calls.map(([m]) => String(m))).toEqual([
      expect.stringContaining('create.contractWeekWarning failed'),
      expect.stringContaining('start.contractWeekWarning failed'),
    ]);
    expect(JSON.stringify([view, timer])).not.toContain('relation');
    warn.mockRestore();
  });

  it('an agreement edit past the contract limit warns CONTRACT_WEEKLY_LIMIT', async () => {
    const t = tables({
      timesheets: [
        wsSheet({ id: uid(71), scope_kind: 'engagement', scope_ref: ENG }),
      ],
      time_entries: [
        entry({
          context_kind: 'assignment',
          context_ref: ASSIGN,
          context_label_snapshot: 'Acme Corp',
          team_id: null,
          engagement_assignment_id: ASSIGN,
          timesheet_id: uid(71),
        }),
      ],
    });
    const b = await build({ tables: t, policy: limit(180, 'contract') });
    b.policy.sheetScopeFor.mockResolvedValue({
      scope_kind: 'engagement',
      scope_ref: ENG,
      policy_workspace_id: WS,
      scope_label: 'Acme Corp',
    } as never);
    const view = await b.service.update(USER, ENTRY, {
      ended_at: '2026-10-06T05:00:00.000Z',
    });
    expect(view.warnings).toEqual([
      {
        code: 'CONTRACT_WEEKLY_LIMIT',
        limit_minutes: 180,
        logged_minutes: 240,
      },
    ]);
  });
});

// ── update ──────────────────────────────────────────────────────────────────────────────────────────────────
describe('update', () => {
  const STAMP = '2026-10-06T03:00:00.000000+00:00';

  it('a stale expected_updated_at is 409 STALE_REVISION (D42) and writes nothing', async () => {
    const b = await build({
      tables: { ...baseTables(), time_entries: [entry()] },
    });
    const e = await errorOf(
      b.service.update(USER, ENTRY, {
        note: 'x',
        expected_updated_at: '2026-10-06T02:59:59.000Z',
      }),
    );
    expect(e.status).toBe(409);
    expect(e.body).toMatchObject({ code: 'STALE_REVISION', entry_id: ENTRY });
    expect(b.db.writes('time_entries', 'update')).toHaveLength(0);
  });

  it('writes every change in one UPDATE, compare-and-swap on updated_at', async () => {
    const b = await build({
      tables: { ...baseTables(), time_entries: [entry()] },
    });
    const view = await b.service.update(USER, ENTRY, {
      started_at: '2026-10-06T00:30:00.000Z',
      break_seconds: 600,
      note: '  Kickoff  ',
      expected_updated_at: '2026-10-06T03:00:00.000Z',
    });
    const updates = b.db.writes('time_entries', 'update');
    expect(updates).toHaveLength(1);
    expect(updates[0].values).toEqual({
      started_at: '2026-10-06T00:30:00.000Z',
      break_seconds: 600,
      break_minutes: 10,
      duration_seconds: 9000 - 600,
      note: 'Kickoff',
    });
    expect(updates[0].filters).toContainEqual(['eq', 'updated_at', STAMP]);
    expect(view.note).toBe('Kickoff');
    // New boundaries drop the recorded timeline.
    expect(b.db.writes('time_entry_segments', 'delete')).toHaveLength(1);
  });

  it('a row changed between read and write is 409 STALE_REVISION', async () => {
    const b = await build({
      tables: { ...baseTables(), time_entries: [entry()] },
    });
    b.db.tables.time_entries[0].updated_at = STAMP;
    const origFrom = b.db.from.getMockImplementation()!;
    b.db.from.mockImplementation((table: string) => {
      const chain = origFrom(table);
      const update = chain.update;
      chain.update = (v: Row) => {
        b.db.tables.time_entries[0].updated_at = '2026-10-06T03:00:01.000Z';
        return update(v);
      };
      return chain;
    });
    const e = await errorOf(b.service.update(USER, ENTRY, { note: 'late' }));
    expect(e.body.code).toBe('STALE_REVISION');
  });

  it('a locked entry is 409 TIMESHEET_LOCKED {reason: entry, lock} before any resolver call; alias copy is origin-aware', async () => {
    const submitted = entry({
      timesheet: { ...entry().timesheet, status: 'submitted' },
    });
    const b = await build({
      tables: { ...baseTables(), time_entries: [submitted] },
    });
    const e = await errorOf(
      b.service.update(USER, ENTRY, {
        logging_for: { kind: 'personal', id: null },
      }),
    );
    expect(e.status).toBe(409);
    expect(e.body).toMatchObject({
      code: 'TIMESHEET_LOCKED',
      reason: 'entry',
      lock: 'sheet_submitted',
      entry_id: ENTRY,
    });
    expect(b.loggingContext.select).not.toHaveBeenCalled();

    const legacy = await errorOf(
      b.service.update(
        USER,
        ENTRY,
        { started_at: '2026-10-06T00:00:00.000Z' },
        { purpose: 'alias', native: true },
      ),
    );
    expect(legacy.body.message).toBe(ALIAS_LOCKED_MESSAGE(true));

    const billed = await build({
      tables: {
        ...baseTables(),
        time_entries: [entry()],
        invoice_time_entries: [{ entry_id: ENTRY, invoice_id: uid(200) }],
      },
    });
    expect(
      (await errorOf(billed.service.update(USER, ENTRY, { note: 'x' }))).body
        .lock,
    ).toBe('billed');
  });

  it('a lock raised by the database maps the same way (trg_40)', async () => {
    const b = await build({
      tables: { ...baseTables(), time_entries: [entry()] },
    });
    b.db.failNext('time_entries', 'update', {
      code: 'P0001',
      message: 'TIME_ENTRY_LOCKED',
      details: JSON.stringify({ entry_id: ENTRY, reason: 'frozen' }),
    });
    const e = await errorOf(b.service.update(USER, ENTRY, { note: 'x' }));
    expect(e.error).toBeInstanceOf(ConflictException);
    expect(e.body).toMatchObject({
      code: 'TIMESHEET_LOCKED',
      reason: 'entry',
      lock: 'frozen',
    });
  });

  it('retries a deadlock once', async () => {
    const b = await build({
      tables: { ...baseTables(), time_entries: [entry()] },
    });
    b.db.failNext('time_entries', 'update', {
      code: '40P01',
      message: 'deadlock detected',
    });
    await b.service.update(USER, ENTRY, { note: 'again' });
    expect(b.db.writes('time_entries', 'update')).toHaveLength(2);
    expect(b.db.tables.time_entries[0].note).toBe('again');
  });

  it('a task in another project is a project move: the resolver re-runs at started_at and the rate re-snapshots', async () => {
    const b = await build({
      tables: { ...baseTables(), time_entries: [entry()] },
      option: option({ id: TEAM_B, label: 'B team' }),
    });
    await b.service.update(USER, ENTRY, { task_id: TASK_B });
    expect(b.loggingContext.select).toHaveBeenCalledWith(USER, PROJECT_B, {
      requested: undefined,
      at: new Date('2026-10-06T01:00:00.000Z'),
      purpose: 'edit',
    });
    expect(b.db.writes('time_entries', 'update')[0].values).toMatchObject({
      task_id: TASK_B,
      work_item: 'task',
      project_id: PROJECT_B,
      context_kind: 'team',
      context_ref: TEAM_B,
      team_id: TEAM_B,
      context_label_snapshot: 'B team',
      rate_snapshot: 25,
      currency_snapshot: 'PHP',
    });
    expect(b.rates.estimate).toHaveBeenCalledWith(
      expect.objectContaining({ id: TEAM_B }),
      USER,
      PROJECT_B,
      'real_work',
      new Date('2026-10-06T01:00:00.000Z'),
    );
  });

  it('a task on the same project keeps the context', async () => {
    const b = await build({
      tables: { ...baseTables(), time_entries: [entry()] },
    });
    await b.service.update(USER, ENTRY, { task_id: TASK });
    expect(b.loggingContext.select).not.toHaveBeenCalled();
    const values = b.db.writes('time_entries', 'update')[0].values as Row;
    expect(values).toMatchObject({
      task_id: TASK,
      work_item: 'task',
      work_type_snapshot: 'training',
    });
    expect(values).not.toHaveProperty('context_kind');
    expect(values).not.toHaveProperty('project_id');
  });

  it('Change For re-snapshots rate, currency and label; the same context writes no context columns', async () => {
    const b = await build({
      tables: { ...baseTables(), time_entries: [entry()] },
      option: option({ kind: 'workspace', id: WS, label: 'Acme' }),
    });
    await b.service.update(USER, ENTRY, {
      logging_for: { kind: 'workspace', id: WS },
    });
    expect(b.db.writes('time_entries', 'update')[0].values).toMatchObject({
      context_kind: 'workspace',
      context_ref: WS,
      workspace_id: WS,
      team_id: null,
      context_label_snapshot: 'Acme',
      rate_snapshot: 25,
      rate_type_snapshot: 'hourly',
      currency_snapshot: 'PHP',
    });

    const same = await build({
      tables: { ...baseTables(), time_entries: [entry()] },
    });
    await same.service.update(USER, ENTRY, {
      logging_for: { kind: 'team', id: TEAM },
    });
    expect(same.db.writes('time_entries', 'update')).toHaveLength(0);
    // The current context is not a Change For, so the resolver is not asked at all (W2 review F2).
    expect(same.loggingContext.select).not.toHaveBeenCalled();
  });

  it('an unchanged logging_for plus a note edit saves even when the context is no longer offered (W2 review F2)', async () => {
    const b = await build({
      tables: { ...baseTables(), time_entries: [entry()] },
    });
    // What the resolver would answer after a plan downgrade or a lost time.log.
    b.loggingContext.select.mockRejectedValue(timeError('LOGGING_FOR_INVALID'));
    const view = await b.service.update(USER, ENTRY, {
      note: 'Fixed typo',
      logging_for: { kind: 'team', id: TEAM },
    });
    expect(view.note).toBe('Fixed typo');
    expect(b.db.writes('time_entries', 'update')[0].values).toEqual({
      note: 'Fixed typo',
    });

    // A real Change For is still gated.
    const e = await errorOf(
      b.service.update(USER, ENTRY, {
        logging_for: { kind: 'workspace', id: WS },
      }),
    );
    expect(e.status).toBe(422);
    expect(e.body.code).toBe('LOGGING_FOR_INVALID');
  });

  it('ending a running timer by edit clears "Timer still running"; editing a stopped entry does not (D61, W2 review F3)', async () => {
    const b = await build({
      tables: { ...baseTables(), time_entries: [running()] },
    });
    await b.service.update(USER, ENTRY, {
      ended_at: '2026-10-07T02:30:00.000Z',
    });
    expect(b.db.writes('time_entries', 'update')[0].values).toMatchObject({
      ended_at: '2026-10-07T02:30:00.000Z',
      paused_at: null,
      duration_seconds: 5400,
    });
    expect(b.notifications.timerStopped).toHaveBeenCalledWith({
      id: ENTRY,
      member_user_id: USER,
    });

    const stopped = await build({
      tables: { ...baseTables(), time_entries: [entry()] },
    });
    await stopped.service.update(USER, ENTRY, {
      ended_at: '2026-10-06T03:30:00.000Z',
    });
    expect(stopped.notifications.timerStopped).not.toHaveBeenCalled();
  });

  it('into an assignment that is newer than the entry is 422 LOGGING_FOR_INVALID (L58)', async () => {
    const b = await build({
      tables: { ...baseTables(), time_entries: [entry()] },
      option: option({
        kind: 'assignment',
        id: ASSIGN,
        label: 'Acme',
        sheet_scope: { kind: 'engagement', ref: ENG },
      }),
    });
    b.engagements.getAssignment.mockResolvedValue({
      id: ASSIGN,
      created_at: '2026-10-07T00:00:00.000Z',
      started_at: '2026-10-01T00:00:00.000Z',
    });
    const e = await errorOf(
      b.service.update(USER, ENTRY, {
        logging_for: { kind: 'assignment', id: ASSIGN },
      }),
    );
    expect(e.status).toBe(422);
    expect(e.body.code).toBe('LOGGING_FOR_INVALID');
    expect(b.db.writes('time_entries', 'update')).toHaveLength(0);

    b.engagements.getAssignment.mockResolvedValue({
      id: ASSIGN,
      created_at: '2026-10-01T00:00:00.000Z',
      started_at: '2026-10-06T02:00:00.000Z',
    });
    expect(
      (
        await errorOf(
          b.service.update(USER, ENTRY, {
            logging_for: { kind: 'assignment', id: ASSIGN },
          }),
        )
      ).status,
    ).toBe(422);

    b.engagements.getAssignment.mockResolvedValue({
      id: ASSIGN,
      created_at: '2026-10-01T00:00:00.000Z',
      started_at: '2026-10-01T00:00:00.000Z',
    });
    await b.service.update(USER, ENTRY, {
      logging_for: { kind: 'assignment', id: ASSIGN },
    });
    expect(b.db.writes('time_entries', 'update')[0].values).toMatchObject({
      context_kind: 'assignment',
      engagement_assignment_id: ASSIGN,
      team_id: null,
    });
  });

  it('an earlier start is checked against the retroactive window', async () => {
    const b = await build({
      tables: { ...baseTables(), time_entries: [entry()] },
      policy: { retroactive_days: 3 },
    });
    const e = await errorOf(
      b.service.update(USER, ENTRY, {
        started_at: '2026-09-01T01:00:00.000Z',
      }),
    );
    expect(e.body.code).toBe('RETROACTIVE_WINDOW');
  });

  it('a preset drops the task; a hidden preset is 422', async () => {
    const withTask = entry({
      task_id: TASK,
      work_item: 'task',
      task: { id: TASK, title: 'Hero', work_type: 'training', status: null },
      work_type_snapshot: 'training',
    });
    const b = await build({
      tables: { ...baseTables(), time_entries: [withTask] },
      policy: { hidden_presets: ['admin'] },
    });
    await b.service.update(USER, ENTRY, { work_item: 'meeting' });
    expect(b.db.writes('time_entries', 'update')[0].values).toMatchObject({
      task_id: null,
      work_item: 'meeting',
      work_type_snapshot: 'real_work',
    });
    const e = await errorOf(
      b.service.update(USER, ENTRY, { work_item: 'admin' }),
    );
    expect(e.body.code).toBe('WORK_ITEM_INVALID');
  });

  it("someone else's entry is 404", async () => {
    const b = await build({
      tables: {
        ...baseTables(),
        time_entries: [entry({ member_user_id: OTHER })],
      },
    });
    expect(
      (await errorOf(b.service.update(USER, ENTRY, { note: 'x' }))).status,
    ).toBe(404);
  });
});

// ── remove ──────────────────────────────────────────────────────────────────────────────────────────────────
describe('remove', () => {
  it('deletes the own entry; a locked one is 409 (trg_40); someone else’s is 404', async () => {
    const b = await build({
      tables: { ...baseTables(), time_entries: [entry()] },
    });
    b.db.failNext('time_entries', 'delete', {
      code: 'P0001',
      message: 'TIME_ENTRY_LOCKED',
      details: JSON.stringify({ entry_id: ENTRY, reason: 'paid' }),
    });
    const locked = await errorOf(
      b.service.remove(USER, ENTRY, { alias: true, native: false }),
    );
    expect(locked.status).toBe(409);
    expect(locked.body.message).toBe(ALIAS_LOCKED_MESSAGE(false));

    await b.service.remove(USER, ENTRY);
    expect(b.db.tables.time_entries).toHaveLength(0);

    const other = await build({
      tables: {
        ...baseTables(),
        time_entries: [entry({ member_user_id: OTHER })],
      },
    });
    expect((await errorOf(other.service.remove(USER, ENTRY))).status).toBe(404);
  });

  it('deleting a running timer clears its "Timer still running" notice; a stopped entry sends nothing (D61, W2 review F3)', async () => {
    const b = await build({
      tables: { ...baseTables(), time_entries: [running()] },
    });
    await b.service.remove(USER, ENTRY);
    expect(b.notifications.timerStopped).toHaveBeenCalledTimes(1);
    expect(b.notifications.timerStopped).toHaveBeenCalledWith({
      id: ENTRY,
      member_user_id: USER,
    });

    const stopped = await build({
      tables: { ...baseTables(), time_entries: [entry()] },
    });
    await stopped.service.remove(USER, ENTRY);
    expect(stopped.notifications.timerStopped).not.toHaveBeenCalled();

    // A refused delete (trg_40) clears nothing.
    const locked = await build({
      tables: { ...baseTables(), time_entries: [running()] },
    });
    locked.db.failNext('time_entries', 'delete', {
      code: 'P0001',
      message: 'TIME_ENTRY_LOCKED',
      details: JSON.stringify({ entry_id: ENTRY, reason: 'frozen' }),
    });
    await errorOf(locked.service.remove(USER, ENTRY));
    expect(locked.notifications.timerStopped).not.toHaveBeenCalled();
  });
});

// ── reads ───────────────────────────────────────────────────────────────────────────────────────────────────
describe('reads', () => {
  it('getRunning returns the own running timer or null', async () => {
    const b = await build({
      tables: {
        ...baseTables(),
        time_entries: [entry(), running({ id: uid(87) })],
      },
    });
    expect((await b.service.getRunning(USER))?.id).toBe(uid(87));
    expect(await b.service.getRunning(OTHER)).toBeNull();
  });

  it('get: the member reads the self view; another viewer is hydrated (manager views carry email)', async () => {
    const b = await build({
      tables: { ...baseTables(), time_entries: [entry()] },
      viewable: [OTHER],
    });
    const own = await b.service.get(USER, ENTRY);
    expect(own).toMatchObject({ cost: 'visible', identity: 'visible' });
    expect(b.authority.hydrate).not.toHaveBeenCalled();

    b.authority.isTeamManager.mockResolvedValue(true as never);
    await b.service.get(OTHER, ENTRY);
    expect(b.authority.hydrate).toHaveBeenCalledWith(
      OTHER,
      [expect.objectContaining({ id: ENTRY })],
      { withEmail: true },
    );
    expect((await errorOf(b.service.get(uid(3), ENTRY))).status).toBe(404);
  });

  it('listMine reads local dates in the preference timezone and pages', async () => {
    const t = baseTables();
    t.user_time_preferences = [
      {
        user_id: USER,
        timezone: 'Asia/Manila',
        week_start: 1,
        updated_at: NOW,
      },
    ];
    t.time_entries = [
      // 2026-10-05 07:30 in Manila: inside.
      entry({ id: uid(81), started_at: '2026-10-04T23:30:00.000Z' }),
      // 2026-10-12 01:00 in Manila: outside (it would be inside in UTC).
      entry({
        id: uid(82),
        started_at: '2026-10-11T17:00:00.000Z',
        ended_at: '2026-10-11T18:00:00.000Z',
      }),
      entry({ id: uid(83), started_at: '2026-10-06T01:00:00.000Z' }),
      entry({
        id: uid(84),
        started_at: '2026-10-06T02:00:00.000Z',
        member_user_id: OTHER,
      }),
    ];
    const b = await build({ tables: t });
    const page = await b.service.listMine(USER, {
      from: '2026-10-05',
      to: '2026-10-11',
      page: 1,
      limit: 1,
    });
    expect(page).toMatchObject({ total: 2, page: 1, limit: 1 });
    expect(page.items.map((i) => i.id)).toEqual([uid(83)]);
    const select = b.db.calls.find(
      (c) => c.table === 'time_entries' && c.selectOpts?.count === 'exact',
    )!;
    expect(select.filters).toContainEqual([
      'gte',
      'started_at',
      '2026-10-04T16:00:00.000Z',
    ]);
    expect(select.filters).toContainEqual([
      'lt',
      'started_at',
      '2026-10-11T16:00:00.000Z',
    ]);
  });

  it('listMine filters by For context in that context’s timezone', async () => {
    const b = await build();
    await b.service.listMine(USER, {
      from: '2026-10-05',
      to: '2026-10-11',
      for: { kind: 'team', id: TEAM },
      page: 1,
      limit: 50,
    });
    expect(b.policy.teamTimezone).toHaveBeenCalledWith(TEAM);
    const select = b.db.calls.find((c) => c.selectOpts?.count === 'exact')!;
    expect(select.filters).toEqual(
      expect.arrayContaining([
        ['eq', 'context_kind', 'team'],
        ['eq', 'context_ref', TEAM],
        ['gte', 'started_at', '2026-10-04T16:00:00.000Z'],
      ]),
    );
    await expect(
      b.service.listMine(USER, {
        from: '2026-10-12',
        to: '2026-10-11',
        page: 1,
        limit: 1,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('mySummary groups by day, context, project and sheet status; approved comes from payable_seconds', async () => {
    const t = baseTables();
    t.time_entries = [
      entry({ id: uid(81), duration_seconds: 3600, payable_seconds: 3000 }),
      entry({
        id: uid(82),
        duration_seconds: 1800,
        payable_seconds: 1800,
        legacy_status: 'rejected',
        timesheet: { status: 'approved' },
      }),
      entry({
        id: uid(83),
        context_kind: 'personal',
        context_ref: null,
        team_id: null,
        timesheet_id: null,
        timesheet: null,
        project_id: PROJECT_B,
        project: { id: PROJECT_B, title: 'B' },
        started_at: '2026-10-07T01:00:00.000Z',
        duration_seconds: 600,
      }),
      running({ id: uid(84) }),
    ];
    const b = await build({ tables: t });
    const s = await b.service.mySummary(USER, {
      from: '2026-10-05',
      to: '2026-10-07',
    });
    expect(s).toMatchObject({
      timezone: 'UTC',
      total_seconds: 3600 + 1800 + 600,
      payable_seconds: 3000,
      by_sheet_status: {
        open: 3600,
        approved: 1800,
        submitted: 0,
        returned: 0,
        personal: 600,
      },
    });
    expect(s.by_day).toEqual([
      { date: '2026-10-05', total_seconds: 0 },
      { date: '2026-10-06', total_seconds: 5400 },
      { date: '2026-10-07', total_seconds: 600 },
    ]);
    expect(s.by_context).toEqual([
      { kind: 'team', ref: TEAM, label: 'Design team', total_seconds: 5400 },
      { kind: 'personal', ref: null, label: 'Just me', total_seconds: 600 },
    ]);
    expect(s.by_project[0]).toEqual({
      project_id: PROJECT,
      title: 'Pixel',
      total_seconds: 5400,
    });
  });

  it('workItems needs access.roadmap (404 otherwise) and drops hidden presets', async () => {
    const b = await build({ policy: { hidden_presets: ['admin'] } });
    const result = await b.service.workItems(USER, PROJECT);
    expect(result.tasks).toEqual([
      {
        id: TASK,
        title: 'Hero banner',
        work_type: 'training',
        feature_id: uid(90),
        feature_title: 'Landing',
        epic_id: uid(91),
        epic_title: 'Site',
      },
    ]);
    expect(result.presets).toEqual(['meeting', 'review', 'other']);

    b.projectAuth.resolvePermissions.mockResolvedValueOnce(null as never);
    expect((await errorOf(b.service.workItems(USER, PROJECT))).status).toBe(
      404,
    );

    const noRoadmap = resolvePermissions('editor', null);
    noRoadmap.access.roadmap = false;
    b.projectAuth.resolvePermissions.mockResolvedValueOnce(noRoadmap as never);
    expect((await errorOf(b.service.workItems(USER, PROJECT))).status).toBe(
      404,
    );
  });
});

// ── comments and segments ───────────────────────────────────────────────────────────────────────────────────
describe('comments and segments', () => {
  it('addComment trims, refuses an empty body, inserts and notifies (awaited)', async () => {
    const b = await build({
      tables: { ...baseTables(), time_entries: [entry()] },
      viewable: [OTHER],
    });
    await expect(
      b.service.addComment(OTHER, ENTRY, '   '),
    ).rejects.toBeInstanceOf(BadRequestException);
    const comment = await b.service.addComment(OTHER, ENTRY, '  Looks good ');
    expect(b.db.writes('time_entry_comments', 'insert')[0].values).toEqual({
      entry_id: ENTRY,
      author_user_id: OTHER,
      body: 'Looks good',
    });
    expect(b.notifications.commentAdded).toHaveBeenCalledWith(
      expect.objectContaining({ id: ENTRY }),
      comment,
      OTHER,
    );
    expect(
      (await errorOf(b.service.addComment(uid(3), ENTRY, 'hi'))).status,
    ).toBe(404);
  });

  it('listComments hides the worker byline from a viewer who sees them masked (D32)', async () => {
    const t = baseTables();
    t.time_entries = [entry({ context_kind: 'assignment', team_id: null })];
    t.time_entry_comments = [
      {
        id: uid(110),
        entry_id: ENTRY,
        author_user_id: USER,
        body: 'mine',
        author: { id: USER },
      },
      {
        id: uid(111),
        entry_id: ENTRY,
        author_user_id: OTHER,
        body: 'theirs',
        author: { id: OTHER },
      },
    ];
    const b = await build({ tables: t, viewable: [OTHER] });
    const seen = await b.service.listComments(OTHER, ENTRY);
    expect(seen[0]).toMatchObject({
      author_user_id: null,
      author: null,
      body: 'mine',
    });
    expect(seen[1]).toMatchObject({ author_user_id: OTHER });

    const own = await b.service.listComments(USER, ENTRY);
    expect(own[0].author_user_id).toBe(USER);
    expect(
      b.db.calls.filter((c) => c.table === 'time_entry_comments').pop()?.select,
    ).toContain('email');
  });

  it('listSegments reads by entry_id after the view check', async () => {
    const t = baseTables();
    t.time_entries = [entry()];
    t.time_entry_segments = [
      {
        id: uid(100),
        entry_id: ENTRY,
        kind: 'work',
        started_at: '2026-10-06T01:00:00.000Z',
        ended_at: null,
      },
    ];
    const b = await build({ tables: t });
    expect(await b.service.listSegments(USER, ENTRY)).toHaveLength(1);
    expect((await errorOf(b.service.listSegments(OTHER, ENTRY))).status).toBe(
      404,
    );
  });
});

// ── preferences ─────────────────────────────────────────────────────────────────────────────────────────────
describe('preferences', () => {
  it('set upserts on user_id and keeps an omitted week start; seed never overwrites', async () => {
    const b = await build();
    expect(await b.service.getPreferences(USER)).toBeNull();
    await b.service.setPreferences(USER, {
      timezone: 'Asia/Manila',
      week_start: 7,
    });
    await b.service.setPreferences(USER, { timezone: 'Europe/Berlin' });
    expect(b.db.tables.user_time_preferences).toEqual([
      expect.objectContaining({
        user_id: USER,
        timezone: 'Europe/Berlin',
        week_start: 7,
      }),
    ]);

    await b.service.seedPreferences(USER, 'America/New_York');
    expect(b.db.tables.user_time_preferences[0].timezone).toBe('Europe/Berlin');
    await b.service.seedPreferences(OTHER, 'not/a_zone');
    expect(b.db.tables.user_time_preferences).toHaveLength(1);
    await b.service.seedPreferences(OTHER, 'Asia/Manila');
    expect(b.db.tables.user_time_preferences).toHaveLength(2);

    await expect(
      b.service.setPreferences(USER, { timezone: 'Mars/Olympus' }),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it('a failed seed never throws', async () => {
    const b = await build();
    b.db.failNext('user_time_preferences', 'upsert', {
      code: '23503',
      message: 'fk',
    });
    await expect(
      b.service.seedPreferences(USER, 'UTC'),
    ).resolves.toBeUndefined();
  });
});

// ── project integration ─────────────────────────────────────────────────────────────────────────────────────
describe('stopRunningForProject', () => {
  it('stops the project’s running timers through the RPC and clears their notices', async () => {
    const t = baseTables();
    t.time_entries = [
      running({ id: uid(81) }),
      running({ id: uid(82), member_user_id: OTHER }),
      entry({ id: uid(83) }),
      running({ id: uid(84), project_id: PROJECT_B }),
    ];
    const b = await build({ tables: t });
    b.db.rpc.mockResolvedValueOnce({ data: 2, error: null });
    expect(await b.service.stopRunningForProject(PROJECT)).toBe(2);
    expect(b.db.rpc).toHaveBeenCalledWith('time_stop_running_entries', {
      p_ids: [uid(81), uid(82)],
      p_at: NOW,
    });
    expect(b.notifications.timerStopped).toHaveBeenCalledTimes(2);
  });

  it('nothing running → 0 and no RPC', async () => {
    const b = await build();
    expect(await b.service.stopRunningForProject(PROJECT)).toBe(0);
    expect(b.db.rpc).not.toHaveBeenCalled();
  });
});

// ── capContext (D36) ────────────────────────────────────────────────────────────────────────────────────────
describe('capContext', () => {
  it('per (member, team): the rate in force on the local date, the team week, rejected rows excluded', async () => {
    const t = baseTables();
    t.team_member_rates = [
      {
        id: uid(120),
        team_id: TEAM,
        user_id: USER,
        project_id: PROJECT,
        rate_type: 'hourly',
        hourly_rate: 10,
        training_hourly_rate: 0,
        currency: 'USD',
        start_date: '2026-10-01',
        end_date: null,
        weekly_limit_hours: 2,
        monthly_limit_hours: 100,
        overtime_requires_approval: true,
      },
    ];
    t.time_entries = [
      entry({ id: uid(81), duration_seconds: 7200 }),
      entry({
        id: uid(82),
        duration_seconds: 3600,
        started_at: '2026-10-06T05:00:00.000Z',
      }),
      entry({
        id: uid(83),
        duration_seconds: 99999,
        started_at: '2026-10-06T06:00:00.000Z',
        legacy_status: 'rejected',
      }),
      // Before the rate starts: no cap applies.
      entry({ id: uid(84), started_at: '2026-09-20T01:00:00.000Z' }),
    ];
    const b = await build({
      tables: t,
      policy: { timezone: 'Asia/Manila', week_start: 1 },
    });
    const map = await b.service.capContext(
      t.time_entries.map((r) => ({
        id: r.id,
        member_user_id: r.member_user_id,
        team_id: r.team_id,
        project_id: r.project_id,
        started_at: r.started_at,
        context_kind: r.context_kind,
      })),
    );
    expect(map.get(uid(81))).toEqual({
      over_limit: true,
      limit_window: 'weekly',
      limit_hours: 2,
      logged_hours_in_window: 3,
      overtime_requires_approval: true,
      window_start: '2026-10-05',
      window_end: '2026-10-11',
    });
    expect(map.has(uid(84))).toBe(false);
    // One rate read per (team, member); one policy resolve per team.
    expect(
      b.db.calls.filter((c) => c.table === 'team_member_rates'),
    ).toHaveLength(1);
    expect(b.policy.resolve).toHaveBeenCalledTimes(1);
  });

  it('non-team rows and rows without caps are omitted', async () => {
    const b = await build();
    const map = await b.service.capContext([
      {
        id: ENTRY,
        member_user_id: USER,
        team_id: null,
        project_id: PROJECT,
        started_at: NOW,
        context_kind: 'personal',
      },
    ]);
    expect(map.size).toBe(0);
    expect(b.policy.resolve).not.toHaveBeenCalled();
  });
});
