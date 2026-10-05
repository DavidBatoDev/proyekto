/* eslint-disable @typescript-eslint/unbound-method --
 * The entitlements double is a jest.Mocked<EntitlementsService>; passing its members to expect() is an identity
 * check on the mock, never a call, so `this` scoping is irrelevant. */
import { HttpException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import {
  type AssignmentContext,
  EngagementsService,
} from '../../marketplace/engagements/engagements.service';
import {
  allowAllEntitlements,
  type EntitlementsMock,
} from '../../shared/entitlements/__entitlements-test-kit-spec';
import { EntitlementsService } from '../../shared/entitlements/entitlements.service';
import { ProjectAuthorizationService } from '../projects/authorization/project-authorization.service';
import { resolvePermissions } from '../projects/permissions/project-permissions';
import { LoggingContextService } from './logging-context.service';
import { TimeAuthorityService } from './time-authority.service';
import { TimeCacheService } from './time-cache';
import { TimeEntriesService } from './time-entries.service';
import { timeNotFound } from './time-errors';
import { TimeNotificationsService } from './time-notifications.service';
import { TimePolicyService } from './time-policy.service';
import { TimeRatesService } from './time-rates.service';
import type { ResolvedTimePolicy, SheetScopeResult } from './time.types';

/**
 * The time_tracking plan gate (D26, CHANGE-21), ported from the old per-log service's plan-gate spec.
 *
 * The gate is the For resolver: a team or workspace option without `time_tracking` on its plan subject (the
 * TEAM's workspace for a team, never the project's) is `unavailable: 'plan'`, so a write cannot land on it.
 * Contract (assignment) time and personal time are never gated. Winding down and reading (stop, pause, resume,
 * delete, every read) never consult the plan at all, so a downgrade strands no running timer. Entries never
 * call EntitlementsService themselves: the real LoggingContextService runs here, with only its collaborators
 * stubbed.
 */

const uid = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const USER = uid(1);
const OWNER = uid(2);
const PROJECT = uid(10);
const PROJECT_WS = uid(20);
const TEAM_WS = uid(21);
const TEAM = uid(30);
const ASSIGN = uid(40);
const ENG = uid(50);
const ENTRY = uid(80);

type Row = Record<string, any>;

// ── a minimal PostgREST stand-in (eq/is/in/gte/lt/or/order/range/limit; insert/update/delete) ──────────────
function getPath(row: Row, path: string): unknown {
  return path
    .split('.')
    .reduce<any>((v, k) => (v == null ? undefined : v[k]), row);
}

function cmp(a: unknown, b: unknown): number {
  if (typeof a === 'string' && typeof b === 'string') {
    const am = Date.parse(a);
    const bm = Date.parse(b);
    if (/T/.test(a) && !Number.isNaN(am) && !Number.isNaN(bm)) return am - bm;
    return a < b ? -1 : a > b ? 1 : 0;
  }
  return Number(a) - Number(b);
}

function pred(col: string, op: string, raw: unknown): (r: Row) => boolean {
  const v =
    typeof raw === 'string' && raw.startsWith('"') ? raw.slice(1, -1) : raw;
  if (op === 'eq') return (r) => getPath(r, col) === v;
  if (op === 'neq') return (r) => getPath(r, col) !== v;
  if (op === 'is') return (r) => getPath(r, col) == null;
  if (op === 'gt') return (r) => cmp(getPath(r, col), v) > 0;
  if (op === 'gte') return (r) => cmp(getPath(r, col), v) >= 0;
  if (op === 'lt') return (r) => cmp(getPath(r, col), v) < 0;
  if (op === 'lte') return (r) => cmp(getPath(r, col), v) <= 0;
  throw new Error(`fake: ${op}`);
}

let generated = 0;

function fakeDb(tables: Record<string, Row[]>) {
  const writes: Array<{ table: string; op: string; values?: Row }> = [];
  const from = jest.fn((table: string) => {
    let op = 'select';
    let values: Row | undefined;
    let returning = false;
    let limitN: number | null = null;
    const preds: Array<(r: Row) => boolean> = [];
    const exec = () => {
      const rows = (tables[table] ??= []);
      if (op === 'insert') {
        generated += 1;
        const row = {
          id: `gen-${generated}`,
          created_at: '2026-10-07T03:00:00.000Z',
          updated_at: '2026-10-07T03:00:00.000Z',
          timesheet: null,
          ...values,
        };
        rows.push(row);
        return { data: returning ? { ...row } : null, error: null };
      }
      const matched = rows.filter((r) => preds.every((p) => p(r)));
      if (op === 'delete') {
        tables[table] = rows.filter((r) => !matched.includes(r));
        return { data: null, error: null };
      }
      if (op === 'update') {
        matched.forEach((r) => Object.assign(r, values));
        return {
          data: returning ? matched.map((r) => ({ ...r })) : null,
          error: null,
        };
      }
      const out = limitN === null ? matched : matched.slice(0, limitN);
      return {
        data: out.map((r) => ({ ...r })),
        error: null,
        count: matched.length,
      };
    };
    const filter =
      (name: string) =>
      (c: string, v: unknown): unknown => {
        preds.push(pred(c, name, v));
        return chain;
      };
    const chain: any = {
      select: () => {
        if (op !== 'select') returning = true;
        return chain;
      },
      insert: (v: Row) => {
        op = 'insert';
        values = v;
        writes.push({ table, op, values: v });
        return chain;
      },
      update: (v: Row) => {
        op = 'update';
        values = v;
        writes.push({ table, op, values: v });
        return chain;
      },
      delete: () => {
        op = 'delete';
        writes.push({ table, op });
        return chain;
      },
      upsert: (v: Row) => {
        op = 'insert';
        values = v;
        return chain;
      },
      eq: filter('eq'),
      neq: filter('neq'),
      is: filter('is'),
      gt: filter('gt'),
      gte: filter('gte'),
      lt: filter('lt'),
      lte: filter('lte'),
      in: (c: string, vs: unknown[]) => {
        preds.push((r) => vs.includes(getPath(r, c)));
        return chain;
      },
      or: (expr: string) => {
        const parts = expr.split(',').map((p) => {
          const [col, o, ...rest] = p.split('.');
          return pred(col, o, rest.join('.'));
        });
        preds.push((r) => parts.some((p) => p(r)));
        return chain;
      },
      order: () => chain,
      range: () => chain,
      limit: (n: number) => {
        limitN = n;
        return chain;
      },
      maybeSingle: () => {
        const res = exec();
        const data = Array.isArray(res.data) ? (res.data[0] ?? null) : res.data;
        return Promise.resolve({ data, error: null });
      },
      single: () => {
        const res = exec();
        const data = Array.isArray(res.data) ? (res.data[0] ?? null) : res.data;
        return Promise.resolve({ data, error: null });
      },
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
        Promise.resolve(exec()).then(ok, ko),
    };
    return chain;
  });
  return {
    sb: {
      from,
      rpc: jest.fn(() => Promise.resolve({ data: 0, error: null })),
    } as unknown as SupabaseClient,
    tables,
    entryInserts: () =>
      writes.filter((w) => w.table === 'time_entries' && w.op === 'insert'),
  };
}

function basePolicy(): ResolvedTimePolicy {
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
    plan: { time_tracking: true, time_team_rules: false },
    policy_workspace_id: PROJECT_WS,
    team_override_applied: false,
    member: null,
    client_hours_detail_level: null,
  };
}

interface Scenario {
  /** plan ref (workspace id) → has time_tracking. Missing = true. */
  timeTracking?: Record<string, boolean>;
  team?: boolean;
  workspaceSeat?: boolean;
  assignment?: boolean;
}

function assignmentContext(): AssignmentContext {
  return {
    id: ASSIGN,
    project_id: PROJECT,
    worker_user_id: USER,
    talent_engagement_id: ENG,
    client_engagement_id: null,
    governing_engagement_id: ENG,
    governing_kind: 'talent_services',
    governing_status: 'active',
    team_id: null,
    role_title: null,
    status: 'active',
    started_at: '2026-09-01T00:00:00Z',
    ended_at: null,
    created_at: '2026-09-01T00:00:00Z',
    hirer_label: 'Pixel Co',
  };
}

async function build(s: Scenario = {}) {
  const withTeam = s.team !== false;
  const db = fakeDb({
    projects: [{ id: PROJECT, owner_id: OWNER, workspace_id: PROJECT_WS }],
    project_teams: withTeam
      ? [
          {
            project_id: PROJECT,
            team_id: TEAM,
            is_primary: true,
            attached_at: '2026-01-01T00:00:00Z',
          },
        ]
      : [],
    project_team_members: withTeam
      ? [{ project_id: PROJECT, team_id: TEAM, user_id: USER }]
      : [],
    teams: [
      {
        id: TEAM,
        name: 'Design team',
        workspace_id: TEAM_WS,
        time_tracking_enabled: true,
        member_rates_enabled: false,
      },
    ],
    workspace_members: s.workspaceSeat
      ? [{ workspace_id: PROJECT_WS, user_id: USER }]
      : [],
    workspaces: [
      { id: PROJECT_WS, name: 'Acme' },
      { id: TEAM_WS, name: 'Studio' },
    ],
    time_logging_defaults: [],
    profiles: [{ id: USER, display_name: 'Ana' }],
    time_entries: [],
    time_entry_segments: [],
    time_entry_comments: [],
    invoice_time_entries: [],
    user_time_preferences: [],
  });

  const entitlements: EntitlementsMock = allowAllEntitlements();
  entitlements.hasFeature.mockImplementation((ref: unknown, key: string) =>
    Promise.resolve(
      key === 'time_tracking' && typeof ref === 'string'
        ? (s.timeTracking?.[ref] ?? true)
        : key !== 'time_tracking',
    ),
  );

  const policy = {
    sheetScopeFor: jest.fn(
      (kind: string, ref: string): Promise<SheetScopeResult | null> =>
        Promise.resolve(
          kind === 'assignment'
            ? {
                scope_kind: 'engagement',
                scope_ref: ENG,
                policy_workspace_id: PROJECT_WS,
                scope_label: 'Pixel Co',
              }
            : kind === 'team'
              ? {
                  scope_kind: 'workspace',
                  scope_ref: TEAM_WS,
                  policy_workspace_id: TEAM_WS,
                  scope_label: 'Studio',
                }
              : kind === 'workspace'
                ? {
                    scope_kind: 'workspace',
                    scope_ref: ref,
                    policy_workspace_id: ref,
                    scope_label: 'Acme',
                  }
                : null,
        ),
    ),
    resolve: jest.fn(() => Promise.resolve(basePolicy())),
    workspaceTimezone: jest.fn(() => Promise.resolve('UTC')),
    teamTimezone: jest.fn(() => Promise.resolve('UTC')),
    planRefForTeam: jest.fn((team: { workspace_id: string | null }) =>
      Promise.resolve(team.workspace_id),
    ),
  };
  const engagements = {
    listActiveAssignmentsForWorker: jest.fn(() =>
      Promise.resolve(s.assignment ? [assignmentContext()] : []),
    ),
    settingsInForceOn: jest.fn(() =>
      Promise.resolve({ id: 'set-1', tracking_mode: 'optional' }),
    ),
    hirerPartyTeamId: jest.fn(() => Promise.resolve(null)),
    getAssignment: jest.fn(() => Promise.resolve(assignmentContext())),
  };
  const projectAuth = {
    resolvePermissions: jest.fn(() =>
      Promise.resolve(resolvePermissions('editor', null)),
    ),
  };
  const cache = {
    getLoggingFor: jest.fn(() => Promise.resolve({ value: null, epoch: null })),
    setLoggingFor: jest.fn(() => Promise.resolve()),
    bumpEpoch: jest.fn(() => Promise.resolve()),
  };
  const rates = {
    estimate: jest.fn(() =>
      Promise.resolve({
        rate_snapshot: 0,
        rate_type_snapshot: 'hourly',
        currency_snapshot: 'USD',
      }),
    ),
  };
  const find = (id: string) => db.tables.time_entries.find((r) => r.id === id);
  const authRow = (r: Row) => ({
    id: r.id,
    member_user_id: r.member_user_id,
    project_id: r.project_id,
    context_kind: r.context_kind,
    context_ref: r.context_ref,
    team_id: r.team_id,
    workspace_id: r.workspace_id,
    engagement_assignment_id: r.engagement_assignment_id,
    timesheet_id: r.timesheet_id,
    started_at: r.started_at,
  });
  const authority = {
    assertOwnEntry: jest.fn((userId: string, id: string) => {
      const r = find(id);
      return r && r.member_user_id === userId
        ? Promise.resolve(authRow(r))
        : Promise.reject(timeNotFound('entry'));
    }),
    assertViewEntry: jest.fn((userId: string, id: string) => {
      const r = find(id);
      return r && r.member_user_id === userId
        ? Promise.resolve(authRow(r))
        : Promise.reject(timeNotFound('entry'));
    }),
    hydrate: jest.fn(() => Promise.resolve([])),
    isTeamManager: jest.fn(() => Promise.resolve(false)),
    identityVisible: jest.fn(() => Promise.resolve(new Set<string>())),
  };
  const notifications = {
    timerStopped: jest.fn(() => Promise.resolve()),
    commentAdded: jest.fn(() => Promise.resolve()),
  };

  const moduleRef = await Test.createTestingModule({
    providers: [
      TimeEntriesService,
      LoggingContextService,
      { provide: SUPABASE_ADMIN, useValue: db.sb },
      { provide: ProjectAuthorizationService, useValue: projectAuth },
      { provide: EngagementsService, useValue: engagements },
      { provide: TimePolicyService, useValue: policy },
      { provide: EntitlementsService, useValue: entitlements },
      { provide: TimeCacheService, useValue: cache },
      { provide: TimeRatesService, useValue: rates },
      { provide: TimeAuthorityService, useValue: authority },
      { provide: TimeNotificationsService, useValue: notifications },
    ],
  }).compile();
  return {
    service: moduleRef.get(TimeEntriesService),
    db,
    entitlements,
  };
}

function entryRow(over: Row = {}): Row {
  return {
    id: ENTRY,
    member_user_id: USER,
    project_id: PROJECT,
    context_kind: 'team',
    context_ref: TEAM,
    context_label_snapshot: 'Design team',
    team_id: TEAM,
    workspace_id: null,
    engagement_assignment_id: null,
    timesheet_id: uid(70),
    timesheet: { id: uid(70), status: 'open' },
    work_item: 'other',
    task_id: null,
    note: null,
    // In the past whatever the clock says (stop refuses an end before the start).
    started_at: '2026-01-05T01:00:00.000Z',
    ended_at: null,
    paused_at: null,
    duration_seconds: null,
    break_seconds: 0,
    break_minutes: 0,
    payable_seconds: null,
    payout_id: null,
    legacy_status: null,
    source: 'timer',
    work_type_snapshot: 'real_work',
    created_at: '2026-10-07T01:00:00.000Z',
    updated_at: '2026-10-07T01:00:00.000Z',
    ...over,
  };
}

/** Writes that consult the plan never call an assert (the resolver reads hasFeature only). */
function expectNoAssert(e: EntitlementsMock) {
  expect(e.assertFeature).not.toHaveBeenCalled();
  expect(e.assertWithinLimit).not.toHaveBeenCalled();
  expect(e.assertCountedLimit).not.toHaveBeenCalled();
}

const MANUAL = {
  project_id: PROJECT,
  started_at: '2026-10-06T01:00:00.000Z',
  ended_at: '2026-10-06T02:00:00.000Z',
};

describe('time_tracking plan gate (D26)', () => {
  it('a team whose workspace has time_tracking takes the entry', async () => {
    const b = await build();
    await b.service.start(USER, { project_id: PROJECT });
    expect(b.db.entryInserts()[0].values).toMatchObject({
      context_kind: 'team',
      team_id: TEAM,
    });
    // The plan subject of a team is the TEAM's workspace.
    expect(b.entitlements.hasFeature).toHaveBeenCalledWith(
      TEAM_WS,
      'time_tracking',
    );
    expectNoAssert(b.entitlements);
  });

  it.each([
    [
      'start',
      (b: Awaited<ReturnType<typeof build>>) =>
        b.service.start(USER, { project_id: PROJECT }),
    ],
    [
      'createManual',
      (b: Awaited<ReturnType<typeof build>>) =>
        b.service.createManual(USER, MANUAL),
    ],
    [
      'alias start',
      (b: Awaited<ReturnType<typeof build>>) =>
        b.service.start(USER, { project_id: PROJECT }, { purpose: 'alias' }),
    ],
  ])(
    '%s: a team without time_tracking is unavailable, so the time is personal (B12), never team',
    async (_name, run) => {
      // The project's workspace has the feature; the team's does not. The team's workspace decides.
      const b = await build({
        timeTracking: { [TEAM_WS]: false, [PROJECT_WS]: true },
      });
      await run(b);
      const [insert] = b.db.entryInserts();
      expect(insert.values).toMatchObject({
        context_kind: 'personal',
        team_id: null,
        context_ref: null,
      });
      expectNoAssert(b.entitlements);
    },
  );

  it('asking for the gated team explicitly is 422 LOGGING_FOR_INVALID and writes nothing', async () => {
    const b = await build({ timeTracking: { [TEAM_WS]: false } });
    let caught: unknown;
    try {
      await b.service.start(USER, {
        project_id: PROJECT,
        logging_for: { kind: 'team', id: TEAM },
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(HttpException);
    expect((caught as HttpException).getStatus()).toBe(422);
    expect(((caught as HttpException).getResponse() as Row).code).toBe(
      'LOGGING_FOR_INVALID',
    );
    expect(b.db.entryInserts()).toHaveLength(0);
  });

  it('a workspace option without time_tracking falls to "Just me" too', async () => {
    const b = await build({
      team: false,
      workspaceSeat: true,
      timeTracking: { [PROJECT_WS]: false },
    });
    await b.service.start(USER, { project_id: PROJECT });
    expect(b.db.entryInserts()[0].values).toMatchObject({
      context_kind: 'personal',
    });
    expect(b.entitlements.hasFeature).toHaveBeenCalledWith(
      PROJECT_WS,
      'time_tracking',
    );
  });

  it('contract (assignment) time is never gated, on any plan', async () => {
    const b = await build({
      team: false,
      assignment: true,
      timeTracking: { [PROJECT_WS]: false, [TEAM_WS]: false },
    });
    await b.service.start(USER, { project_id: PROJECT });
    expect(b.db.entryInserts()[0].values).toMatchObject({
      context_kind: 'assignment',
      engagement_assignment_id: ASSIGN,
    });
    expect(b.entitlements.hasFeature).not.toHaveBeenCalledWith(
      expect.anything(),
      'time_tracking',
    );
  });

  it('personal time on Free (no team, no seat) is never gated', async () => {
    const b = await build({
      team: false,
      timeTracking: { [PROJECT_WS]: false, [TEAM_WS]: false },
    });
    await b.service.createManual(USER, MANUAL);
    expect(b.db.entryInserts()[0].values).toMatchObject({
      context_kind: 'personal',
    });
    expect(b.entitlements.hasFeature).not.toHaveBeenCalled();
  });
});

describe('wind-down and reads never consult the plan', () => {
  const RUN: Array<
    [string, (b: Awaited<ReturnType<typeof build>>) => Promise<unknown>]
  > = [
    ['pause', (b) => b.service.pause(USER, ENTRY)],
    ['stop', (b) => b.service.stop(USER, ENTRY)],
    ['get', (b) => b.service.get(USER, ENTRY)],
    ['listSegments', (b) => b.service.listSegments(USER, ENTRY)],
    ['listComments', (b) => b.service.listComments(USER, ENTRY)],
    ['getRunning', (b) => b.service.getRunning(USER)],
    [
      'listMine',
      (b) =>
        b.service.listMine(USER, {
          from: '2026-10-05',
          to: '2026-10-11',
          page: 1,
          limit: 50,
        }),
    ],
    [
      'mySummary',
      (b) =>
        b.service.mySummary(USER, { from: '2026-10-05', to: '2026-10-11' }),
    ],
    ['remove', (b) => b.service.remove(USER, ENTRY)],
  ];

  it.each(RUN)('%s on a downgraded team', async (_name, run) => {
    const b = await build({
      timeTracking: { [TEAM_WS]: false, [PROJECT_WS]: false },
    });
    b.db.tables.time_entries.push(entryRow());
    await run(b);
    expect(b.entitlements.hasFeature).not.toHaveBeenCalled();
    expect(b.entitlements.resolveScopeForTeam).not.toHaveBeenCalled();
    expectNoAssert(b.entitlements);
  });

  it('resume on a downgraded team', async () => {
    const b = await build({ timeTracking: { [TEAM_WS]: false } });
    b.db.tables.time_entries.push(
      entryRow({ paused_at: '2026-01-05T02:00:00.000Z' }),
    );
    await b.service.resume(USER, ENTRY);
    expect(b.entitlements.hasFeature).not.toHaveBeenCalled();
    expectNoAssert(b.entitlements);
  });

  it('an edit that keeps its context never re-resolves (so never re-gates)', async () => {
    const b = await build({ timeTracking: { [TEAM_WS]: false } });
    b.db.tables.time_entries.push(
      entryRow({
        ended_at: '2026-01-05T02:00:00.000Z',
        duration_seconds: 3600,
      }),
    );
    await b.service.update(USER, ENTRY, { note: 'notes' });
    expect(b.entitlements.hasFeature).not.toHaveBeenCalled();
  });

  it('an edit that round-trips its unchanged logging_for is not re-gated (W2 review F2)', async () => {
    const b = await build({ timeTracking: { [TEAM_WS]: false } });
    b.db.tables.time_entries.push(
      entryRow({
        ended_at: '2026-01-05T02:00:00.000Z',
        duration_seconds: 3600,
      }),
    );
    // The web sends the whole entry back, its current (now plan-unavailable) team context included.
    await b.service.update(USER, ENTRY, {
      note: 'typo fixed',
      logging_for: { kind: 'team', id: TEAM.toUpperCase() },
    });
    expect(b.entitlements.hasFeature).not.toHaveBeenCalled();
    expect(b.db.tables.time_entries[0]).toMatchObject({
      note: 'typo fixed',
      context_kind: 'team',
      team_id: TEAM,
    });
  });
});
