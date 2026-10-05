import {
  ForbiddenException,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import { EngagementsService } from '../../marketplace/engagements/engagements.service';
import { EntitlementsService } from '../../shared/entitlements/entitlements.service';
import type {
  TeamTimePolicyInput,
  WorkspaceTimePolicyInput,
} from './dto/policies.dto';
import { TimeCacheService } from './time-cache';
import {
  type TeamMemberRateRow,
  TimePolicyService,
  pickMemberRateInForce,
} from './time-policy.service';

// ── In-memory PostgREST stand-in ───────────────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;
type DbError = { code?: string; message: string; details?: string | null };
type RpcHandler = (args: Row) => { data: unknown; error: DbError | null };

interface Call {
  table: string;
  op: 'select' | 'insert' | 'update' | 'delete';
  payload?: Row;
  filters: Array<[string, unknown]>;
}

interface World {
  time_policies: Row[];
  teams: Row[];
  team_members: Row[];
  team_member_rates: Row[];
  managers: Record<string, string[]>; // workspace id → can_manage_workspace users
}

function fakeDb(world: World, rpcOverrides: Record<string, RpcHandler> = {}) {
  const calls: Call[] = [];
  const failures: Record<string, DbError> = {};
  let seq = 0;

  const canManageTeam = (teamId: unknown, userId: unknown) =>
    world.teams.some((t) => t.id === teamId && t.owner_id === userId) ||
    world.team_members.some(
      (m) =>
        m.team_id === teamId &&
        m.user_id === userId &&
        (m.role === 'owner' || m.role === 'admin'),
    );

  const defaults: Record<string, RpcHandler> = {
    can_manage_team: (a) => ({
      data: canManageTeam(a.p_team_id, a.p_user_id),
      error: null,
    }),
    can_manage_workspace: (a) => ({
      data: (world.managers[a.p_workspace_id as string] ?? []).includes(
        a.p_user_id as string,
      ),
      error: null,
    }),
    time_resolve_policy: () => ({ data: sqlPolicy(), error: null }),
    time_sheet_scope_for: (a) => {
      if (a.p_context_kind !== 'team') return { data: [], error: null };
      const team = world.teams.find((t) => t.id === a.p_context_ref);
      const override = world.time_policies.some(
        (p) => p.scope === 'team' && p.team_id === a.p_context_ref,
      );
      if (!team)
        return {
          data: [
            {
              scope_kind: 'team',
              scope_ref: a.p_context_ref,
              policy_workspace_id: null,
              scope_label: 'Deleted team',
            },
          ],
          error: null,
        };
      return {
        data: [
          override || !team.workspace_id
            ? {
                scope_kind: 'team',
                scope_ref: team.id,
                policy_workspace_id: team.workspace_id ?? null,
                scope_label: team.name,
              }
            : {
                scope_kind: 'workspace',
                scope_ref: team.workspace_id,
                policy_workspace_id: team.workspace_id,
                scope_label: 'Acme',
              },
        ],
        error: null,
      };
    },
    time_ensure_workspace_policy: (a) => {
      let row = world.time_policies.find(
        (p) => p.scope === 'workspace' && p.workspace_id === a.p_workspace_id,
      );
      if (!row) {
        row = {
          id: `pol-${++seq}`,
          scope: 'workspace',
          workspace_id: a.p_workspace_id,
          tracking_enabled: true,
          period_kind: 'weekly',
          week_start: 1,
          timezone: (a.p_timezone_hint as string | null) ?? 'UTC',
          approval_required: true,
          allow_manual_entries: true,
          rounding_minutes: 0,
          reminder_days: 1,
          hidden_presets: [],
          updated_by: null,
        };
        world.time_policies.push(row);
      }
      return { data: row.id, error: null };
    },
    time_policy_delete: (a) => {
      world.time_policies = world.time_policies.filter(
        (p) => p.id !== a.p_policy_id,
      );
      return { data: null, error: null };
    },
  };

  const rpc = jest.fn((name: string, args: Row) => {
    const handler = rpcOverrides[name] ?? defaults[name];
    if (!handler) {
      return Promise.resolve({
        data: null,
        error: { code: '42883', message: `function ${name} does not exist` },
      });
    }
    return Promise.resolve(handler(args));
  });

  const from = jest.fn((table: keyof World) => {
    let op: Call['op'] = 'select';
    let payload: Row | undefined;
    const filters: Array<[string, unknown]> = [];
    const exec = () => {
      calls.push({ table, op, payload, filters: [...filters] });
      const failure = failures[`${table}:${op}`];
      if (failure) return { data: null, error: failure };
      const rows = world[table] as Row[];
      const match = (row: Row) =>
        filters.every(([col, value]) => (row[col] ?? null) === value);
      if (op === 'insert') {
        const row = { id: `pol-${++seq}`, ...payload };
        rows.push(row);
        return { data: [row], error: null };
      }
      if (op === 'update') {
        const hit = rows.filter(match);
        hit.forEach((row) => Object.assign(row, payload));
        return { data: hit, error: null };
      }
      if (op === 'delete') {
        (world as unknown as Record<string, Row[]>)[table] = rows.filter(
          (row) => !match(row),
        );
        return { data: null, error: null };
      }
      return {
        data: rows.filter(match).map((row) => ({ ...row })),
        error: null,
      };
    };
    const chain = {
      select: () => chain,
      insert: (p: Row) => {
        op = 'insert';
        payload = p;
        return chain;
      },
      update: (p: Row) => {
        op = 'update';
        payload = p;
        return chain;
      },
      delete: () => {
        op = 'delete';
        return chain;
      },
      eq: (col: string, value: unknown) => {
        filters.push([col, value]);
        return chain;
      },
      is: (col: string, value: unknown) => {
        filters.push([col, value]);
        return chain;
      },
      order: () => chain,
      limit: () => chain,
      maybeSingle: () => {
        const res = exec();
        if (res.error) return Promise.resolve(res);
        const data = res.data as Row[];
        if (data.length > 1) {
          return Promise.resolve({
            data: null,
            error: { code: 'PGRST116', message: 'multiple rows' },
          });
        }
        return Promise.resolve({ data: data[0] ?? null, error: null });
      },
      then: (
        resolve: (v: unknown) => unknown,
        reject?: (e: unknown) => unknown,
      ) => Promise.resolve(exec()).then(resolve, reject),
    };
    return chain;
  });

  return {
    client: { from, rpc } as unknown as SupabaseClient,
    from,
    rpc,
    calls,
    failures,
    writes: (table: string) =>
      calls.filter((c) => c.table === table && c.op !== 'select'),
    rpcCalls: (name: string) =>
      rpc.mock.calls.filter(([n]) => n === name).map(([, a]) => a),
  };
}

// ── Fixtures ───────────────────────────────────────────────────────────────────────────────────────────────

const WS = 'ws-1';
const TEAM = 'team-1';
const OWNER = 'u-owner';
const ADMIN = 'u-admin';
const MEMBER = 'u-member';
const WS_ADMIN = 'u-ws-admin';
const PROJECT = 'proj-1';
const ENGAGEMENT = 'eng-1';

/** A canned time_resolve_policy jsonb: workspace and team layers already applied in SQL. */
function sqlPolicy(over: Row = {}): Row {
  return {
    tracking_enabled: true,
    period_kind: 'biweekly',
    week_start: 1,
    timezone: 'Asia/Manila',
    period_anchor: '2026-01-05',
    approval_required: true,
    approver_scope: 'team',
    allow_manual_entries: false,
    retroactive_days: 7,
    rounding_minutes: 15,
    weekly_limit_minutes: null,
    reminder_days: 2,
    hidden_presets: ['admin'],
    tracking_mode: null,
    sources: {
      tracking_enabled: 'default',
      period_kind: 'team',
      week_start: 'workspace',
      timezone: 'workspace',
      period_anchor: 'team',
      approval_required: 'default',
      approver_scope: 'team',
      allow_manual_entries: 'workspace',
      retroactive_days: 'team',
      rounding_minutes: 'team',
      weekly_limit_minutes: 'default',
      reminder_days: 'workspace',
      hidden_presets: 'workspace',
      tracking_mode: 'default',
    },
    plan: { time_tracking: true, time_team_rules: true },
    policy_workspace_id: WS,
    team_override_applied: true,
    ...over,
  };
}

function world(over: Partial<World> = {}): World {
  return {
    time_policies: [],
    teams: [
      {
        id: TEAM,
        name: 'Design',
        owner_id: OWNER,
        workspace_id: WS,
        member_rates_enabled: false,
      },
    ],
    team_members: [
      { team_id: TEAM, user_id: OWNER, role: 'owner' },
      { team_id: TEAM, user_id: ADMIN, role: 'admin' },
      { team_id: TEAM, user_id: MEMBER, role: 'member' },
    ],
    team_member_rates: [],
    managers: { [WS]: [WS_ADMIN] },
    ...over,
  };
}

function rate(over: Partial<TeamMemberRateRow>): TeamMemberRateRow & Row {
  return {
    id: 'r-1',
    team_id: TEAM,
    user_id: MEMBER,
    project_id: PROJECT,
    rate_type: 'hourly',
    hourly_rate: 500,
    training_hourly_rate: 100,
    currency: 'PHP',
    start_date: null,
    end_date: null,
    weekly_limit_hours: null,
    monthly_limit_hours: null,
    overtime_requires_approval: false,
    ...over,
  };
}

async function build(w: World, rpcs: Record<string, RpcHandler> = {}) {
  const db = fakeDb(w, rpcs);
  const engagements = {
    settingsInForceOn: jest.fn().mockResolvedValue(null),
  };
  const entitlements = {
    hasFeature: jest.fn().mockResolvedValue(true),
    assertFeature: jest.fn().mockResolvedValue(undefined),
    resolveScopeForTeam: jest
      .fn()
      .mockResolvedValue({ workspaceId: null, exempt: false }),
  };
  const cache = { bumpEpoch: jest.fn().mockResolvedValue(undefined) };
  const moduleRef = await Test.createTestingModule({
    providers: [
      TimePolicyService,
      { provide: SUPABASE_ADMIN, useValue: db.client },
      { provide: EngagementsService, useValue: engagements },
      { provide: EntitlementsService, useValue: entitlements },
      { provide: TimeCacheService, useValue: cache },
    ],
  }).compile();
  return {
    service: moduleRef.get(TimePolicyService),
    db,
    engagements,
    entitlements,
    cache,
    w,
  };
}

async function codeOf(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    const body = (e as { getResponse?: () => unknown }).getResponse?.();
    return body && typeof body === 'object'
      ? (body as { code?: unknown }).code
      : body;
  }
  throw new Error('expected a rejection');
}

// ── resolve ────────────────────────────────────────────────────────────────────────────────────────────────

describe('TimePolicyService.resolve', () => {
  it('passes scope, policy workspace and instant to time_resolve_policy and keeps its layers', async () => {
    const t = await build(world());
    const at = new Date('2026-10-05T03:00:00.000Z');
    const policy = await t.service.resolve({ kind: 'team', ref: TEAM }, WS, at);

    expect(t.db.rpcCalls('time_resolve_policy')).toEqual([
      {
        p_scope_kind: 'team',
        p_scope_ref: TEAM,
        p_policy_workspace_id: WS,
        p_at: '2026-10-05T03:00:00.000Z',
      },
    ]);
    // Layer precedence is SQL's: values and sources come back untouched.
    expect(policy.period_kind).toBe('biweekly');
    expect(policy.sources.period_kind).toBe('team');
    expect(policy.sources.week_start).toBe('workspace');
    expect(policy.sources.tracking_enabled).toBe('default');
    expect(policy.approver_scope).toBe('team');
    expect(policy.hidden_presets).toEqual(['admin']);
    expect(policy.plan).toEqual({ time_tracking: true, time_team_rules: true });
    expect(policy.team_override_applied).toBe(true);
    // TS layers stay empty without a member or an engagement.
    expect(policy.member).toBeNull();
    expect(policy.client_hours_detail_level).toBeNull();
    expect(t.db.calls.some((c) => c.table === 'team_member_rates')).toBe(false);
    expect(t.engagements.settingsInForceOn).not.toHaveBeenCalled();
  });

  it('attaches the member caps in force on the local date (team policy timezone)', async () => {
    const w = world({
      team_member_rates: [
        rate({
          id: 'r-old',
          start_date: '2026-09-01',
          end_date: '2026-10-04',
          weekly_limit_hours: 40,
        }),
        rate({
          id: 'r-new',
          start_date: '2026-10-05',
          weekly_limit_hours: '30',
          monthly_limit_hours: '120.5',
          overtime_requires_approval: true,
        }),
        rate({ id: 'r-other', project_id: 'proj-2', weekly_limit_hours: 99 }),
      ],
    });
    const t = await build(w);
    // 16:30Z on Oct 4 is 00:30 on Oct 5 in Manila: the new row is in force.
    const policy = await t.service.resolve(
      { kind: 'team', ref: TEAM },
      WS,
      new Date('2026-10-04T16:30:00.000Z'),
      { memberUserId: MEMBER, projectId: PROJECT },
    );
    expect(policy.member).toEqual({
      weekly_limit_hours: 30,
      monthly_limit_hours: 120.5,
      overtime_requires_approval: true,
    });
    expect(policy.sources.member).toBe('member');
  });

  it('uses the caller teamId on a workspace-scope sheet (team context without an override)', async () => {
    const w = world({
      team_member_rates: [rate({ weekly_limit_hours: 20 })],
    });
    const t = await build(w);
    const policy = await t.service.resolve(
      { kind: 'workspace', ref: WS },
      WS,
      new Date('2026-10-05T03:00:00.000Z'),
      { memberUserId: MEMBER, teamId: TEAM, projectId: PROJECT },
    );
    expect(policy.member?.weekly_limit_hours).toBe(20);
  });

  it('leaves member null when no rate row is in force, and never reads rates without a member', async () => {
    const w = world({
      team_member_rates: [rate({ end_date: '2026-09-30' })],
    });
    const t = await build(w);
    const at = new Date('2026-10-05T03:00:00.000Z');
    const withMember = await t.service.resolve(
      { kind: 'team', ref: TEAM },
      WS,
      at,
      { memberUserId: MEMBER, projectId: PROJECT },
    );
    expect(withMember.member).toBeNull();
    expect(withMember.sources.member).toBeUndefined();

    t.db.calls.length = 0;
    await t.service.resolve({ kind: 'team', ref: TEAM }, WS, at, {
      teamId: TEAM,
    });
    expect(t.db.calls.some((c) => c.table === 'team_member_rates')).toBe(false);
  });

  it('adds client_hours_detail_level from the engagement settings in force on the local date', async () => {
    const t = await build(world(), {
      time_resolve_policy: () => ({
        data: sqlPolicy({
          timezone: 'Asia/Manila',
          sources: { timezone: 'workspace' },
        }),
        error: null,
      }),
    });
    t.engagements.settingsInForceOn.mockResolvedValue({
      client_hours_detail_level: 'summary',
    });
    const policy = await t.service.resolve(
      { kind: 'engagement', ref: ENGAGEMENT },
      WS,
      new Date('2026-10-04T20:00:00.000Z'),
    );
    expect(t.engagements.settingsInForceOn).toHaveBeenCalledWith(
      ENGAGEMENT,
      '2026-10-05',
    );
    expect(policy.client_hours_detail_level).toBe('summary');
    expect(policy.sources.client_hours_detail_level).toBe('contract');
    expect(policy.member).toBeNull();
  });

  it("reads a legacy contract (no settings in force) as 'none'", async () => {
    const t = await build(world());
    const policy = await t.service.resolve(
      { kind: 'engagement', ref: ENGAGEMENT },
      null,
      new Date('2026-10-05T03:00:00.000Z'),
    );
    expect(policy.client_hours_detail_level).toBe('none');
    expect(policy.sources.client_hours_detail_level).toBeUndefined();
  });

  it('dates the contract layer in the pre-contract timezone when the contract sets its own (SQL parity)', async () => {
    const w = world({
      time_policies: [
        {
          id: 'pol-ws',
          scope: 'workspace',
          workspace_id: WS,
          timezone: 'UTC',
          updated_by: null,
        },
      ],
    });
    const t = await build(w, {
      time_resolve_policy: () => ({
        data: sqlPolicy({
          timezone: 'Asia/Manila',
          sources: { timezone: 'contract' },
        }),
        error: null,
      }),
    });
    await t.service.resolve(
      { kind: 'engagement', ref: ENGAGEMENT },
      WS,
      new Date('2026-10-04T20:00:00.000Z'),
    );
    // UTC date, not the contract's Manila date (2026-10-05).
    expect(t.engagements.settingsInForceOn).toHaveBeenCalledWith(
      ENGAGEMENT,
      '2026-10-04',
    );
  });

  it('turns an unmapped database error into a 500 without the Postgres text', async () => {
    const logged = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const t = await build(world(), {
      time_resolve_policy: () => ({
        data: null,
        error: { code: 'XX000', message: 'relation "secret" exploded' },
      }),
    });
    const error = await t.service
      .resolve({ kind: 'workspace', ref: WS }, WS, new Date())
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(InternalServerErrorException);
    expect((error as Error).message).not.toContain('secret');
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});

describe('pickMemberRateInForce', () => {
  it('is in force from start_date through end_date, both inclusive; a NULL start always applied', () => {
    const rows = [
      rate({ id: 'a', start_date: '2026-10-01', end_date: '2026-10-31' }),
    ];
    expect(pickMemberRateInForce(rows, PROJECT, '2026-09-30')).toBeNull();
    expect(pickMemberRateInForce(rows, PROJECT, '2026-10-01')?.id).toBe('a');
    expect(pickMemberRateInForce(rows, PROJECT, '2026-10-31')?.id).toBe('a');
    expect(pickMemberRateInForce(rows, PROJECT, '2026-11-01')).toBeNull();
    expect(
      pickMemberRateInForce(
        [rate({ id: 'b', end_date: '2026-12-31' })],
        PROJECT,
        '1999-01-01',
      )?.id,
    ).toBe('b');
  });

  it('prefers the project row over a team default, never another project, then the latest start', () => {
    const rows = [
      rate({ id: 'default', project_id: null, start_date: '2026-10-03' }),
      rate({ id: 'other', project_id: 'proj-2', start_date: '2026-10-04' }),
      rate({ id: 'p-old', start_date: '2026-01-01' }),
      rate({ id: 'p-new', start_date: '2026-10-01' }),
    ];
    expect(pickMemberRateInForce(rows, PROJECT, '2026-10-05')?.id).toBe(
      'p-new',
    );
    expect(pickMemberRateInForce(rows, 'proj-3', '2026-10-05')?.id).toBe(
      'default',
    );
    expect(pickMemberRateInForce(rows, null, '2026-10-05')?.id).toBe('default');
    expect(
      pickMemberRateInForce(
        [rate({ id: 'z' }), rate({ id: 'y' })],
        PROJECT,
        '2026-10-05',
      )?.id,
    ).toBe('y');
  });
});

// ── sheetScopeFor ──────────────────────────────────────────────────────────────────────────────────────────

describe('TimePolicyService.sheetScopeFor', () => {
  it('answers null for personal time without asking the database', async () => {
    const t = await build(world());
    await expect(
      t.service.sheetScopeFor('personal', null, PROJECT),
    ).resolves.toBeNull();
    expect(t.db.rpc).not.toHaveBeenCalled();
  });

  it('maps time_sheet_scope_for', async () => {
    const t = await build(world());
    const scope = await t.service.sheetScopeFor('team', TEAM, PROJECT);
    expect(t.db.rpcCalls('time_sheet_scope_for')).toEqual([
      { p_context_kind: 'team', p_context_ref: TEAM, p_project_id: PROJECT },
    ]);
    expect(scope).toEqual({
      scope_kind: 'workspace',
      scope_ref: WS,
      policy_workspace_id: WS,
      scope_label: 'Acme',
    });
  });

  it('maps LOGGING_FOR_INVALID (assignment not found) to 422', async () => {
    const t = await build(world(), {
      time_sheet_scope_for: () => ({
        data: null,
        error: {
          code: 'P0001',
          message: 'LOGGING_FOR_INVALID',
          details: 'assignment not found',
        },
      }),
    });
    const p = t.service.sheetScopeFor('assignment', 'a-1', PROJECT);
    await expect(p).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(
      codeOf(t.service.sheetScopeFor('assignment', 'a-1', PROJECT)),
    ).resolves.toBe('LOGGING_FOR_INVALID');
  });
});

// ── workspace policy ───────────────────────────────────────────────────────────────────────────────────────

describe('workspace policy', () => {
  it('GET 404s for a caller who cannot manage the workspace, and writes nothing', async () => {
    const t = await build(world());
    await expect(
      t.service.getWorkspacePolicy(MEMBER, WS, 'Asia/Manila'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      codeOf(t.service.getWorkspacePolicy(MEMBER, WS)),
    ).resolves.toBe('TIME_NOT_FOUND');
    expect(t.db.rpcCalls('time_ensure_workspace_policy')).toEqual([]);
  });

  it('GET without ?tz= never materialises the row and reports it unconfirmed', async () => {
    const t = await build(world());
    const view = await t.service.getWorkspacePolicy(WS_ADMIN, WS);
    expect(t.db.rpcCalls('time_ensure_workspace_policy')).toEqual([]);
    expect(view).toEqual(
      expect.objectContaining({
        workspace_id: WS,
        policy_unconfirmed: true,
        can_edit: true,
      }),
    );
    expect(view.policy.period_kind).toBe('biweekly');
  });

  it("GET with ?tz= materialises the row from the manager's timezone", async () => {
    const t = await build(world());
    await t.service.getWorkspacePolicy(WS_ADMIN, WS, 'Asia/Manila');
    expect(t.db.rpcCalls('time_ensure_workspace_policy')).toEqual([
      {
        p_workspace_id: WS,
        p_timezone_hint: 'Asia/Manila',
        p_member_user_id: WS_ADMIN,
      },
    ]);
  });

  it('GET reports a saved row as confirmed', async () => {
    const w = world({
      time_policies: [
        {
          id: 'pol-ws',
          scope: 'workspace',
          workspace_id: WS,
          updated_by: WS_ADMIN,
        },
      ],
    });
    const t = await build(w);
    const view = await t.service.getWorkspacePolicy(WS_ADMIN, WS);
    expect(view.policy_unconfirmed).toBe(false);
  });

  it('PUT materialises through the RPC, then updates only the sent fields and stamps updated_by (CC16)', async () => {
    const t = await build(world());
    const view = await t.service.putWorkspacePolicy(WS_ADMIN, WS, {
      rounding_minutes: 15,
      retroactive_days: null,
      hidden_presets: ['admin', 'admin', 'other'],
    });

    const order = t.db.rpc.mock.calls.map(([name]) => name);
    expect(order.indexOf('time_ensure_workspace_policy')).toBeGreaterThan(-1);
    const writes = t.db.writes('time_policies');
    expect(writes.map((c) => c.op)).toEqual(['update']);
    expect(writes[0].payload).toEqual({
      rounding_minutes: 15,
      retroactive_days: null,
      hidden_presets: ['admin', 'other'],
      updated_by: WS_ADMIN,
    });
    expect(writes[0].filters).toEqual(
      expect.arrayContaining([['scope', 'workspace']]),
    );
    expect(t.entitlements.assertFeature).toHaveBeenCalledWith(
      WS,
      'time_tracking',
    );
    expect(t.cache.bumpEpoch).toHaveBeenCalledTimes(1);
    expect(view.policy_unconfirmed).toBe(false);
  });

  it('PUT passes a sent timezone as the materialisation hint', async () => {
    const t = await build(world());
    await t.service.putWorkspacePolicy(WS_ADMIN, WS, {
      timezone: 'Asia/Tokyo',
    });
    expect(t.db.rpcCalls('time_ensure_workspace_policy')).toEqual([
      {
        p_workspace_id: WS,
        p_timezone_hint: 'Asia/Tokyo',
        p_member_user_id: WS_ADMIN,
      },
    ]);
  });

  const planCases: Array<{ input: WorkspaceTimePolicyInput; gated: boolean }> =
    [
      { input: { timezone: 'Asia/Tokyo' }, gated: false },
      { input: { week_start: 7 }, gated: false },
      { input: { tracking_enabled: false }, gated: false },
      {
        input: { timezone: 'UTC', week_start: 1, tracking_enabled: false },
        gated: false,
      },
      { input: { tracking_enabled: true }, gated: true },
      { input: { approval_required: false }, gated: true },
      { input: { timezone: 'UTC', allow_manual_entries: false }, gated: true },
    ];
  for (const { input, gated } of planCases) {
    it(`PUT ${JSON.stringify(input)} needs time_tracking: ${gated}`, async () => {
      const t = await build(world());
      await t.service.putWorkspacePolicy(WS_ADMIN, WS, input);
      if (gated) {
        expect(t.entitlements.assertFeature).toHaveBeenCalledWith(
          WS,
          'time_tracking',
        );
      } else {
        expect(t.entitlements.assertFeature).not.toHaveBeenCalled();
      }
    });
  }

  it('PUT { confirm: true } only stamps updated_by ("Looks right")', async () => {
    const t = await build(world());
    await t.service.putWorkspacePolicy(WS_ADMIN, WS, { confirm: true });
    const writes = t.db.writes('time_policies');
    expect(writes).toHaveLength(1);
    expect(writes[0].payload).toEqual({ updated_by: WS_ADMIN });
    expect(t.entitlements.assertFeature).not.toHaveBeenCalled();
  });

  it('PUT without the plan writes nothing', async () => {
    const t = await build(world());
    t.entitlements.assertFeature.mockRejectedValue(
      new ForbiddenException('plan'),
    );
    await expect(
      t.service.putWorkspacePolicy(WS_ADMIN, WS, { rounding_minutes: 5 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(t.db.rpcCalls('time_ensure_workspace_policy')).toEqual([]);
    expect(t.db.writes('time_policies')).toEqual([]);
    expect(t.cache.bumpEpoch).not.toHaveBeenCalled();
  });

  it('PUT refuses null on a column a workspace row keeps non-NULL', async () => {
    const t = await build(world());
    await expect(
      codeOf(
        t.service.putWorkspacePolicy(WS_ADMIN, WS, {
          tracking_enabled: null as unknown as boolean,
        }),
      ),
    ).resolves.toBe('TIME_POLICY_INVALID');
    expect(t.db.writes('time_policies')).toEqual([]);
  });

  it('PUT 404s for a non-manager before any write', async () => {
    const t = await build(world());
    await expect(
      t.service.putWorkspacePolicy(MEMBER, WS, { timezone: 'UTC' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(t.db.rpcCalls('time_ensure_workspace_policy')).toEqual([]);
    expect(t.db.writes('time_policies')).toEqual([]);
  });

  it('PUT maps the policy guard (TIME_POLICY_INVALID) to 422', async () => {
    const t = await build(world());
    t.db.failures['time_policies:update'] = {
      code: 'P0001',
      message: 'TIME_POLICY_INVALID',
      details: 'period_anchor must fall on week_start',
    };
    await expect(
      t.service.putWorkspacePolicy(WS_ADMIN, WS, { week_start: 3 }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});

// ── team policy ────────────────────────────────────────────────────────────────────────────────────────────

describe('team policy', () => {
  it('GET 404s for a plain member and for a missing team', async () => {
    const t = await build(world());
    await expect(t.service.getTeamPolicy(MEMBER, TEAM)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      t.service.getTeamPolicy(OWNER, 'team-missing'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('GET gives the override, the effective policy on the routed scope, and the caller flags', async () => {
    const w = world({
      time_policies: [
        { id: 'pol-t', scope: 'team', team_id: TEAM, rounding_minutes: 15 },
      ],
    });
    const t = await build(w);
    t.entitlements.hasFeature.mockResolvedValue(false);

    const asAdmin = await t.service.getTeamPolicy(ADMIN, TEAM);
    expect(asAdmin.team_id).toBe(TEAM);
    expect(asAdmin.override).toEqual(
      expect.objectContaining({ id: 'pol-t', rounding_minutes: 15 }),
    );
    expect(asAdmin.can_edit_money_fields).toBe(false);
    expect(asAdmin.has_team_rules).toBe(false);
    expect(t.entitlements.hasFeature).toHaveBeenCalledWith(
      WS,
      'time_team_rules',
    );
    expect(t.db.rpcCalls('time_resolve_policy')[0]).toEqual(
      expect.objectContaining({
        p_scope_kind: 'team',
        p_scope_ref: TEAM,
        p_policy_workspace_id: WS,
      }),
    );

    const asOwner = await t.service.getTeamPolicy(OWNER, TEAM);
    expect(asOwner.can_edit_money_fields).toBe(true);
  });

  it('GET without an override resolves on the workspace scope the team routes to', async () => {
    const t = await build(world());
    const view = await t.service.getTeamPolicy(ADMIN, TEAM);
    expect(view.override).toBeNull();
    expect(t.db.rpcCalls('time_resolve_policy')[0]).toEqual(
      expect.objectContaining({ p_scope_kind: 'workspace', p_scope_ref: WS }),
    );
  });

  it('PUT 404s for a non-manager', async () => {
    const t = await build(world());
    await expect(
      t.service.putTeamPolicy(MEMBER, TEAM, { period_kind: 'monthly' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(t.db.writes('time_policies')).toEqual([]);
  });

  const ownerOnly: Array<[string, TeamTimePolicyInput]> = [
    ['approval_required', { approval_required: true }],
    ['approver_scope', { approver_scope: 'team' }],
    ['retroactive_days', { retroactive_days: 5 }],
    ['rounding_minutes', { rounding_minutes: 5 }],
  ];
  for (const [field, input] of ownerOnly) {
    it(`PUT ${field} needs the team owner (403 for an admin)`, async () => {
      const t = await build(world());
      const error = await t.service
        .putTeamPolicy(ADMIN, TEAM, input)
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as Error).message).toBe(
        `Only the team owner can change: ${field}`,
      );
      expect(t.db.writes('time_policies')).toEqual([]);
      expect(t.entitlements.assertFeature).not.toHaveBeenCalled();
    });
  }

  it('PUT by an admin inserts the override with created_by and updated_by after the time_team_rules gate', async () => {
    const t = await build(world());
    await t.service.putTeamPolicy(ADMIN, TEAM, {
      period_kind: 'monthly',
      timezone: null,
    });
    expect(t.entitlements.assertFeature).toHaveBeenCalledWith(
      WS,
      'time_team_rules',
    );
    const writes = t.db.writes('time_policies');
    expect(writes.map((c) => c.op)).toEqual(['insert']);
    expect(writes[0].payload).toEqual({
      period_kind: 'monthly',
      timezone: null,
      scope: 'team',
      team_id: TEAM,
      created_by: ADMIN,
      updated_by: ADMIN,
    });
    expect(t.cache.bumpEpoch).toHaveBeenCalledTimes(1);
  });

  it('PUT on an existing override updates only the sent fields', async () => {
    const w = world({
      time_policies: [{ id: 'pol-t', scope: 'team', team_id: TEAM }],
    });
    const t = await build(w);
    await t.service.putTeamPolicy(OWNER, TEAM, {
      approval_required: true,
      approver_scope: 'team',
    });
    const writes = t.db.writes('time_policies');
    expect(writes.map((c) => c.op)).toEqual(['update']);
    expect(writes[0].payload).toEqual({
      approval_required: true,
      approver_scope: 'team',
      updated_by: OWNER,
    });
    expect(writes[0].filters).toEqual([['id', 'pol-t']]);
  });

  it('PUT without time_team_rules writes nothing', async () => {
    const t = await build(world());
    t.entitlements.assertFeature.mockRejectedValue(
      new ForbiddenException('plan'),
    );
    await expect(
      t.service.putTeamPolicy(OWNER, TEAM, { period_kind: 'monthly' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(t.db.writes('time_policies')).toEqual([]);
    expect(t.cache.bumpEpoch).not.toHaveBeenCalled();
  });

  it('PUT on a team with no workspace gates on the resolved team scope, never raw null (D26)', async () => {
    const w = world();
    w.teams[0].workspace_id = null;
    const t = await build(w);
    const scope = { workspaceId: null, exempt: false };
    t.entitlements.resolveScopeForTeam.mockResolvedValue(scope);
    await t.service.putTeamPolicy(OWNER, TEAM, { reminder_days: 2 });
    expect(t.entitlements.resolveScopeForTeam).toHaveBeenCalledWith(TEAM);
    expect(t.entitlements.assertFeature).toHaveBeenCalledWith(
      scope,
      'time_team_rules',
    );
  });

  it('PUT approval off while member rates are on is 422 TEAM_RATES_REQUIRE_APPROVAL', async () => {
    const w = world();
    w.teams[0].member_rates_enabled = true;
    const t = await build(w);
    const error = await t.service
      .putTeamPolicy(OWNER, TEAM, { approval_required: false })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnprocessableEntityException);
    expect((error as UnprocessableEntityException).getResponse()).toEqual(
      expect.objectContaining({
        code: 'TEAM_RATES_REQUIRE_APPROVAL',
        message: 'Approval stays on while member rates are on.',
      }),
    );
    expect(t.db.writes('time_policies')).toEqual([]);
  });

  it('PUT maps the guard trigger TEAM_RATES_REQUIRE_APPROVAL to 422', async () => {
    const t = await build(world());
    t.db.failures['time_policies:insert'] = {
      code: 'P0001',
      message: 'TEAM_RATES_REQUIRE_APPROVAL',
    };
    await expect(
      codeOf(
        t.service.putTeamPolicy(OWNER, TEAM, { approval_required: false }),
      ),
    ).resolves.toBe('TEAM_RATES_REQUIRE_APPROVAL');
  });

  it('PUT with nothing sent writes nothing (no all-inherit row)', async () => {
    const t = await build(world());
    await t.service.putTeamPolicy(OWNER, TEAM, {});
    expect(t.db.writes('time_policies')).toEqual([]);
    expect(t.cache.bumpEpoch).not.toHaveBeenCalled();
  });

  it('PUT that loses an insert race updates the winning row', async () => {
    const w = world();
    const t = await build(w);
    t.db.failures['time_policies:insert'] = {
      code: '23505',
      message: 'duplicate key value violates unique constraint',
    };
    // The concurrent writer's row appears between our select and our insert.
    const realFrom = t.db.from.getMockImplementation()!;
    let reads = 0;
    t.db.from.mockImplementation((table: keyof World) => {
      if (table === 'time_policies') {
        reads += 1;
        if (reads === 2) {
          w.time_policies.push({
            id: 'pol-race',
            scope: 'team',
            team_id: TEAM,
          });
        }
      }
      return realFrom(table);
    });
    await t.service.putTeamPolicy(OWNER, TEAM, { reminder_days: 3 });
    const update = t.db.writes('time_policies').find((c) => c.op === 'update');
    expect(update?.filters).toEqual([['id', 'pol-race']]);
    expect(update?.payload).toEqual({ reminder_days: 3, updated_by: OWNER });
  });

  it('DELETE 404s for a non-manager and 403s for an admin', async () => {
    const w = world({
      time_policies: [{ id: 'pol-t', scope: 'team', team_id: TEAM }],
    });
    const t = await build(w);
    await expect(
      t.service.deleteTeamPolicy(MEMBER, TEAM),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      t.service.deleteTeamPolicy(ADMIN, TEAM),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(t.db.rpcCalls('time_policy_delete')).toEqual([]);
  });

  it('DELETE by the owner goes through time_policy_delete, ungated', async () => {
    const w = world({
      time_policies: [{ id: 'pol-t', scope: 'team', team_id: TEAM }],
    });
    const t = await build(w);
    await t.service.deleteTeamPolicy(OWNER, TEAM);
    expect(t.db.rpcCalls('time_policy_delete')).toEqual([
      { p_policy_id: 'pol-t', p_actor: OWNER },
    ]);
    expect(t.db.writes('time_policies')).toEqual([]);
    expect(t.entitlements.assertFeature).not.toHaveBeenCalled();
    expect(t.cache.bumpEpoch).toHaveBeenCalledTimes(1);
    expect(w.time_policies).toEqual([]);
  });

  it('DELETE an owner role from team_members counts as the owner', async () => {
    const w = world({
      time_policies: [{ id: 'pol-t', scope: 'team', team_id: TEAM }],
      team_members: [{ team_id: TEAM, user_id: 'u-co-owner', role: 'owner' }],
    });
    const t = await build(w);
    await t.service.deleteTeamPolicy('u-co-owner', TEAM);
    expect(t.db.rpcCalls('time_policy_delete')).toHaveLength(1);
  });

  it('DELETE with no override is a no-op', async () => {
    const t = await build(world());
    await t.service.deleteTeamPolicy(OWNER, TEAM);
    expect(t.db.rpcCalls('time_policy_delete')).toEqual([]);
  });
});

// ── D28 write-through ──────────────────────────────────────────────────────────────────────────────────────

describe('setTeamRetroactiveDays (D28)', () => {
  it('n > 0 inserts the team row when missing', async () => {
    const t = await build(world());
    await t.service.setTeamRetroactiveDays(TEAM, 7, OWNER);
    const writes = t.db.writes('time_policies');
    expect(writes.map((c) => c.op)).toEqual(['insert']);
    expect(writes[0].payload).toEqual({
      retroactive_days: 7,
      scope: 'team',
      team_id: TEAM,
      created_by: OWNER,
      updated_by: OWNER,
    });
    expect(t.cache.bumpEpoch).toHaveBeenCalledTimes(1);
  });

  it('n > 0 updates an existing row', async () => {
    const w = world({
      time_policies: [
        { id: 'pol-t', scope: 'team', team_id: TEAM, retroactive_days: 3 },
      ],
    });
    const t = await build(w);
    await t.service.setTeamRetroactiveDays(TEAM, 14, OWNER);
    const writes = t.db.writes('time_policies');
    expect(writes.map((c) => c.op)).toEqual(['update']);
    expect(writes[0].payload).toEqual({
      retroactive_days: 14,
      updated_by: OWNER,
    });
    expect(w.time_policies[0].retroactive_days).toBe(14);
  });

  it('0 sets an existing row to NULL', async () => {
    const w = world({
      time_policies: [
        { id: 'pol-t', scope: 'team', team_id: TEAM, retroactive_days: 3 },
      ],
    });
    const t = await build(w);
    await t.service.setTeamRetroactiveDays(TEAM, 0, OWNER);
    expect(t.db.writes('time_policies')[0].payload).toEqual({
      retroactive_days: null,
      updated_by: OWNER,
    });
    expect(t.cache.bumpEpoch).toHaveBeenCalledTimes(1);
  });

  for (const days of [0, null]) {
    it(`${String(days)} never inserts a row`, async () => {
      const t = await build(world());
      await t.service.setTeamRetroactiveDays(TEAM, days, OWNER);
      expect(t.db.writes('time_policies')).toEqual([]);
      expect(t.cache.bumpEpoch).toHaveBeenCalledTimes(1);
    });
  }

  it('truncates fractions and clamps to the column CHECK (3650)', async () => {
    const t = await build(world());
    await t.service.setTeamRetroactiveDays(TEAM, 5000, OWNER);
    expect(t.db.writes('time_policies')[0].payload).toEqual(
      expect.objectContaining({ retroactive_days: 3650 }),
    );
    const t2 = await build(world());
    await t2.service.setTeamRetroactiveDays(TEAM, 2.7, OWNER);
    expect(t2.db.writes('time_policies')[0].payload).toEqual(
      expect.objectContaining({ retroactive_days: 2 }),
    );
  });
});

// ── timezones and the plan subject ─────────────────────────────────────────────────────────────────────────

describe('timezones and planRefForTeam', () => {
  it('workspaceTimezone: the row, else UTC; never materialises', async () => {
    const w = world({
      time_policies: [
        {
          id: 'pol-ws',
          scope: 'workspace',
          workspace_id: WS,
          timezone: 'Asia/Manila',
        },
        {
          id: 'pol-bad',
          scope: 'workspace',
          workspace_id: 'ws-bad',
          timezone: 'Mars/Olympus',
        },
      ],
    });
    const t = await build(w);
    await expect(t.service.workspaceTimezone(WS)).resolves.toBe('Asia/Manila');
    await expect(t.service.workspaceTimezone('ws-none')).resolves.toBe('UTC');
    await expect(t.service.workspaceTimezone('ws-bad')).resolves.toBe('UTC');
    const before = t.db.calls.length;
    await expect(t.service.workspaceTimezone(null)).resolves.toBe('UTC');
    expect(t.db.calls.length).toBe(before);
    expect(t.db.rpcCalls('time_ensure_workspace_policy')).toEqual([]);
  });

  it("teamTimezone resolves on the team's routed sheet scope", async () => {
    const t = await build(world(), {
      time_resolve_policy: () => ({
        data: sqlPolicy({ timezone: 'Asia/Tokyo' }),
        error: null,
      }),
    });
    await expect(t.service.teamTimezone(TEAM)).resolves.toBe('Asia/Tokyo');
    expect(t.db.rpcCalls('time_sheet_scope_for')[0]).toEqual({
      p_context_kind: 'team',
      p_context_ref: TEAM,
      p_project_id: null,
    });
    expect(t.db.rpcCalls('time_resolve_policy')[0]).toEqual(
      expect.objectContaining({ p_scope_kind: 'workspace', p_scope_ref: WS }),
    );
  });

  it("planRefForTeam: the team's workspace, else the resolved team scope", async () => {
    const t = await build(world());
    await expect(
      t.service.planRefForTeam({ id: TEAM, workspace_id: WS }),
    ).resolves.toBe(WS);
    expect(t.entitlements.resolveScopeForTeam).not.toHaveBeenCalled();
    const scope = { workspaceId: 'ws-2', exempt: false };
    t.entitlements.resolveScopeForTeam.mockResolvedValue(scope);
    await expect(
      t.service.planRefForTeam({ id: TEAM, workspace_id: null }),
    ).resolves.toBe(scope);
  });
});
