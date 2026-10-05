import { HttpException, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import {
  AssignmentContext,
  EngagementsService,
} from '../../marketplace/engagements/engagements.service';
import { EntitlementsService } from '../../shared/entitlements/entitlements.service';
import { ProjectAuthorizationService } from '../projects/authorization/project-authorization.service';
import {
  ProjectRole,
  resolvePermissions,
} from '../projects/permissions/project-permissions';
import {
  LoggingContextService,
  PERSONAL_LABEL,
} from './logging-context.service';
import { TimeCacheService } from './time-cache';
import { TimePolicyService } from './time-policy.service';
import type {
  LoggingForResult,
  ResolvedTimePolicy,
  SheetScopeResult,
  UnavailableReason,
} from './time.types';

// ── ids ─────────────────────────────────────────────────────────────────────
const uid = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const ME = uid(1);
const OWNER = uid(2);
const PROJECT = uid(10);
const WS = uid(20); // the project's workspace
const OTHER_WS = uid(21); // a cross-workspace team's workspace
const TEAM_A = uid(30);
const TEAM_B = uid(31);
const TEAM_C = uid(32);
const HIRER_TEAM = uid(33);
const ASSIGN_1 = uid(40);
const ASSIGN_2 = uid(41);
const TALENT_ENG = uid(50);
const CLIENT_ENG = uid(51);
const TALENT_ENG_2 = uid(52);
const FOREIGN = uid(99);

type Row = Record<string, unknown>;

// ── a tiny PostgREST stand-in ───────────────────────────────────────────────
interface Call {
  table: string;
  op: 'select' | 'insert' | 'update';
  select?: string;
  filters: Array<[string, string, unknown]>;
  values?: Row;
}

function fakeDb(tables: Record<string, Row[]>) {
  const calls: Call[] = [];
  const from = jest.fn((table: string) => {
    const call: Call = { table, op: 'select', filters: [] };
    calls.push(call);
    const preds: Array<(r: Row) => boolean> = [];
    const exec = () => {
      if (call.op === 'insert') {
        tables[table] = [...(tables[table] ?? []), { ...call.values }];
        return { data: null, error: null };
      }
      const rows = (tables[table] ?? []).filter((r) =>
        preds.every((p) => p(r)),
      );
      if (call.op === 'update') {
        rows.forEach((r) => Object.assign(r, call.values));
        return { data: null, error: null };
      }
      return { data: rows.map((r) => ({ ...r })), error: null };
    };
    const chain: any = {
      select: (s: string) => {
        call.select = s;
        return chain;
      },
      insert: (v: Row) => {
        call.op = 'insert';
        call.values = v;
        return chain;
      },
      update: (v: Row) => {
        call.op = 'update';
        call.values = v;
        return chain;
      },
      eq: (c: string, v: unknown) => {
        call.filters.push(['eq', c, v]);
        preds.push((r) => r[c] === v);
        return chain;
      },
      in: (c: string, vs: unknown[]) => {
        call.filters.push(['in', c, vs]);
        preds.push((r) => vs.includes(r[c]));
        return chain;
      },
      order: () => chain,
      maybeSingle: () => {
        const res = exec();
        return Promise.resolve({
          data: Array.isArray(res.data) ? (res.data[0] ?? null) : res.data,
          error: res.error,
        });
      },
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
        Promise.resolve(exec()).then(ok, ko),
    };
    return chain;
  });
  return { sb: { from } as unknown as SupabaseClient, calls, tables };
}

// ── scenario ────────────────────────────────────────────────────────────────
interface TeamSpec {
  id: string;
  name: string;
  workspace_id?: string | null;
  time_tracking_enabled?: boolean;
  member_rates_enabled?: boolean;
  is_primary?: boolean;
  attached_at?: string;
  curated?: boolean;
  /** time_sheet_scope_for answers `team` (Business override) instead of the workspace. */
  teamScope?: boolean;
}

interface Scenario {
  role?: ProjectRole | null;
  ownerId?: string;
  projectWs?: string | null;
  teams?: TeamSpec[];
  workspaceMember?: boolean;
  assignments?: Array<Partial<AssignmentContext> & { id: string }>;
  /** engagement id → tracking_mode of the settings in force (null = none in force). */
  settings?: Record<string, string | null>;
  hirerTeams?: Record<string, string>;
  /** plan ref → feature → enabled (default true). */
  features?: Record<string, Record<string, boolean>>;
  /** sheet scope ref → policy overrides. */
  policies?: Record<string, Partial<ResolvedTimePolicy>>;
  defaultRow?: Row | null;
  cached?: LoggingForResult | null;
}

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

function assignment(
  a: Partial<AssignmentContext> & { id: string },
): AssignmentContext {
  const talent = a.talent_engagement_id ?? null;
  const client = a.client_engagement_id ?? null;
  return {
    project_id: PROJECT,
    worker_user_id: ME,
    talent_engagement_id: talent,
    client_engagement_id: client,
    governing_engagement_id: (talent ?? client) as string,
    governing_kind: talent ? 'talent_services' : 'client_services',
    governing_status: 'active',
    team_id: null,
    role_title: null,
    status: 'active',
    started_at: '2026-09-01T00:00:00Z',
    ended_at: null,
    created_at: '2026-09-01T00:00:00Z',
    hirer_label: 'Acme',
    ...a,
  };
}

async function build(s: Scenario = {}) {
  const teams = s.teams ?? [];
  const projectWs = s.projectWs === undefined ? WS : s.projectWs;
  const db = fakeDb({
    projects: [
      { id: PROJECT, owner_id: s.ownerId ?? OWNER, workspace_id: projectWs },
    ],
    project_teams: teams.map((t, i) => ({
      project_id: PROJECT,
      team_id: t.id,
      is_primary: t.is_primary ?? false,
      attached_at: t.attached_at ?? `2026-01-0${i + 1}T00:00:00Z`,
    })),
    project_team_members: teams
      .filter((t) => t.curated !== false)
      .map((t) => ({ project_id: PROJECT, team_id: t.id, user_id: ME })),
    teams: teams.map((t) => ({
      id: t.id,
      name: t.name,
      workspace_id: t.workspace_id === undefined ? WS : t.workspace_id,
      time_tracking_enabled: t.time_tracking_enabled ?? true,
      member_rates_enabled: t.member_rates_enabled ?? false,
    })),
    workspace_members: s.workspaceMember
      ? [{ workspace_id: projectWs, user_id: ME, role: 'member' }]
      : [],
    workspaces: [
      { id: WS, name: 'Acme Workspace' },
      { id: OTHER_WS, name: 'Prodigitality' },
    ],
    time_logging_defaults: s.defaultRow
      ? [{ user_id: ME, project_id: PROJECT, ...s.defaultRow }]
      : [],
  });

  const role = s.role === undefined ? 'editor' : s.role;
  const projectAuth = {
    resolvePermissions: jest.fn((caller: string) =>
      Promise.resolve(
        caller === ME && role ? resolvePermissions(role, null) : null,
      ),
    ),
  };

  const assignments = (s.assignments ?? []).map(assignment);
  const engagements = {
    listActiveAssignmentsForWorker: jest.fn(() => Promise.resolve(assignments)),
    settingsInForceOn: jest.fn((engagementId: string) => {
      const mode =
        s.settings && engagementId in s.settings
          ? s.settings[engagementId]
          : 'optional';
      return Promise.resolve(
        mode === null ? null : { tracking_mode: mode, id: 'set-1' },
      );
    }),
    hirerPartyTeamId: jest.fn((engagementId: string) =>
      Promise.resolve(s.hirerTeams?.[engagementId] ?? null),
    ),
  };

  const teamById = new Map(teams.map((t) => [t.id, t]));
  const policy = {
    sheetScopeFor: jest.fn(
      (kind: string, ref: string): Promise<SheetScopeResult | null> => {
        if (kind === 'assignment') {
          const a = assignments.find((x) => x.id === ref);
          return Promise.resolve(
            a
              ? {
                  scope_kind: 'engagement',
                  scope_ref: a.governing_engagement_id,
                  policy_workspace_id: OTHER_WS,
                  scope_label: a.hirer_label,
                }
              : null,
          );
        }
        if (kind === 'team') {
          const t = teamById.get(ref);
          const ws = t?.workspace_id === undefined ? WS : t.workspace_id;
          return Promise.resolve(
            t?.teamScope || !ws
              ? {
                  scope_kind: 'team',
                  scope_ref: ref,
                  policy_workspace_id: ws,
                  scope_label: t?.name ?? 'Team',
                }
              : {
                  scope_kind: 'workspace',
                  scope_ref: ws,
                  policy_workspace_id: ws,
                  scope_label: 'Workspace',
                },
          );
        }
        if (kind === 'workspace') {
          return Promise.resolve({
            scope_kind: 'workspace',
            scope_ref: ref,
            policy_workspace_id: ref,
            scope_label: 'Workspace',
          });
        }
        return Promise.resolve(null);
      },
    ),
    resolve: jest.fn((scope: { ref: string }) =>
      Promise.resolve(basePolicy(s.policies?.[scope.ref])),
    ),
    workspaceTimezone: jest.fn(() => Promise.resolve('UTC')),
    planRefForTeam: jest.fn(
      (team: { id: string; workspace_id: string | null }) =>
        Promise.resolve(
          team.workspace_id ?? { workspaceId: null, exempt: false },
        ),
    ),
  };

  const entitlements = {
    hasFeature: jest.fn((ref: unknown, key: string) => {
      const k = typeof ref === 'string' ? ref : 'scope';
      return Promise.resolve(s.features?.[k]?.[key] ?? true);
    }),
  };

  const cache = {
    getLoggingFor: jest.fn(() => Promise.resolve(s.cached ?? null)),
    setLoggingFor: jest.fn(() => Promise.resolve()),
    bumpEpoch: jest.fn(() => Promise.resolve()),
  };

  const moduleRef = await Test.createTestingModule({
    providers: [
      LoggingContextService,
      { provide: SUPABASE_ADMIN, useValue: db.sb },
      { provide: ProjectAuthorizationService, useValue: projectAuth },
      { provide: EngagementsService, useValue: engagements },
      { provide: TimePolicyService, useValue: policy },
      { provide: EntitlementsService, useValue: entitlements },
      { provide: TimeCacheService, useValue: cache },
    ],
  }).compile();

  return {
    service: moduleRef.get(LoggingContextService),
    db,
    projectAuth,
    engagements,
    policy,
    entitlements,
    cache,
  };
}

const NOW = () => new Date();

async function caught(p: Promise<unknown>): Promise<HttpException> {
  try {
    await p;
  } catch (error) {
    if (error instanceof HttpException) return error;
    throw error;
  }
  throw new Error('expected the call to throw');
}

function body(e: HttpException): Record<string, unknown> {
  return e.getResponse() as Record<string, unknown>;
}

const kinds = (r: LoggingForResult) =>
  r.options.map((o) => `${o.kind}:${o.id ?? ''}`);

beforeEach(() => {
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

// ── step 0 ──────────────────────────────────────────────────────────────────
describe('step 0: access and time.log', () => {
  it.each(['viewer', 'commenter'] as ProjectRole[])(
    '%s gets no options with reason none (CHANGE-1)',
    async (role) => {
      const { service, engagements } = await build({
        role,
        teams: [{ id: TEAM_A, name: 'Design' }],
        workspaceMember: true,
      });
      const r = await service.resolve(ME, PROJECT, {
        at: NOW(),
        purpose: 'read',
      });
      expect(r).toEqual({
        options: [],
        selected: null,
        prefill: null,
        reason: 'none',
        unavailable: [],
      });
      // No option kind is even looked at, assignments included.
      expect(engagements.listActiveAssignmentsForWorker).not.toHaveBeenCalled();
    },
  );

  it('a viewer write is 403 NO_LOGGING_CONTEXT', async () => {
    const { service } = await build({ role: 'viewer' });
    const e = await caught(
      service.select(ME, PROJECT, { at: NOW(), purpose: 'timer' }),
    );
    expect(e.getStatus()).toBe(403);
    expect(body(e).code).toBe('NO_LOGGING_CONTEXT');
    expect(body(e).message).toBe("You can't log time on this project.");
  });

  it('no project_access row and not the owner is a 404 (guests included)', async () => {
    const { service } = await build({ role: null });
    const e = await caught(
      service.resolve(ME, PROJECT, { at: NOW(), purpose: 'read' }),
    );
    expect(e.getStatus()).toBe(404);
    expect(body(e).code).toBe('TIME_NOT_FOUND');
  });

  it('a missing project is the same 404', async () => {
    const { service } = await build();
    const e = await caught(
      service.resolve(ME, FOREIGN, { at: NOW(), purpose: 'read' }),
    );
    expect(e.getStatus()).toBe(404);
  });

  it('the project owner with no share row can still log', async () => {
    const { service } = await build({ role: null, ownerId: ME });
    const r = await service.resolve(ME, PROJECT, {
      at: NOW(),
      purpose: 'read',
    });
    expect(kinds(r)).toEqual(['personal:']);
  });
});

// ── step 3 ──────────────────────────────────────────────────────────────────
describe('step 3: curated teams', () => {
  it('an uncurated team member is not offered the team (E31)', async () => {
    const { service } = await build({
      teams: [{ id: TEAM_A, name: 'Design', curated: false }],
    });
    const r = await service.resolve(ME, PROJECT, {
      at: NOW(),
      purpose: 'read',
    });
    expect(kinds(r)).toEqual(['personal:']);
    const e = await caught(
      service.select(ME, PROJECT, {
        at: NOW(),
        purpose: 'timer',
        requested: { kind: 'team', id: TEAM_A },
      }),
    );
    expect(e.getStatus()).toBe(422);
    expect(body(e).code).toBe('LOGGING_FOR_INVALID');
  });

  it('an uncurated viewer gets 403 NO_LOGGING_CONTEXT on select', async () => {
    const { service } = await build({
      role: 'viewer',
      teams: [{ id: TEAM_A, name: 'Design', curated: false }],
    });
    const e = await caught(
      service.select(ME, PROJECT, { at: NOW(), purpose: 'manual' }),
    );
    expect(body(e).code).toBe('NO_LOGGING_CONTEXT');
  });

  it('orders is_primary DESC, attached_at, team_id (L1)', async () => {
    const { service } = await build({
      // Each team on its own sheet scope so nothing collapses.
      teams: [
        {
          id: TEAM_C,
          name: 'C',
          attached_at: '2026-01-01T00:00:00Z',
          teamScope: true,
        },
        {
          id: TEAM_B,
          name: 'B',
          attached_at: '2026-01-02T00:00:00Z',
          teamScope: true,
        },
        {
          id: TEAM_A,
          name: 'A',
          attached_at: '2026-01-02T00:00:00Z',
          teamScope: true,
        },
        {
          id: HIRER_TEAM,
          name: 'Primary',
          attached_at: '2026-03-01T00:00:00Z',
          is_primary: true,
          teamScope: true,
        },
      ],
    });
    const r = await service.resolve(ME, PROJECT, {
      at: NOW(),
      purpose: 'read',
    });
    expect(kinds(r)).toEqual([
      `team:${HIRER_TEAM}`,
      `team:${TEAM_C}`,
      `team:${TEAM_A}`,
      `team:${TEAM_B}`,
    ]);
    expect(r.options.map((o) => o.label)).toEqual(['Primary', 'C', 'A', 'B']);
  });

  it('team_time_off and plan are unavailable, and they block the workspace option (L34)', async () => {
    const { service } = await build({
      workspaceMember: true,
      teams: [
        { id: TEAM_A, name: 'Off', time_tracking_enabled: false },
        { id: TEAM_B, name: 'Unpaid', workspace_id: OTHER_WS },
      ],
      features: { [OTHER_WS]: { time_tracking: false } },
    });
    const r = await service.resolve(ME, PROJECT, {
      at: NOW(),
      purpose: 'read',
    });
    expect(r.unavailable).toEqual([
      { kind: 'team', id: TEAM_A, label: 'Off', reason: 'team_time_off' },
      { kind: 'team', id: TEAM_B, label: 'Unpaid', reason: 'plan' },
    ]);
    // Never the workspace name: "Just me" (L31), told why.
    expect(kinds(r)).toEqual(['personal:']);
    expect(r.options[0].label).toBe(PERSONAL_LABEL);
    expect(r.personal_reason).toBe('plan');
    expect(r.selected).toEqual(r.options[0]);
  });

  it('the plan subject of a team without a workspace is never a raw null (D26)', async () => {
    const { service, entitlements, policy } = await build({
      teams: [{ id: TEAM_A, name: 'Loose', workspace_id: null }],
    });
    await service.resolve(ME, PROJECT, { at: NOW(), purpose: 'read' });
    expect(policy.planRefForTeam).toHaveBeenCalledWith({
      id: TEAM_A,
      workspace_id: null,
    });
    for (const [ref] of entitlements.hasFeature.mock.calls) {
      expect(ref).not.toBeNull();
    }
  });

  it('rate_source is team_member_rates only with member rates and time_team_rules', async () => {
    const { service } = await build({
      teams: [
        {
          id: TEAM_A,
          name: 'Rates',
          member_rates_enabled: true,
          teamScope: true,
        },
        {
          id: TEAM_B,
          name: 'Rates, no rules',
          member_rates_enabled: true,
          workspace_id: OTHER_WS,
          teamScope: true,
        },
      ],
      features: { [OTHER_WS]: { time_team_rules: false } },
    });
    const r = await service.resolve(ME, PROJECT, {
      at: NOW(),
      purpose: 'read',
    });
    expect(r.options.map((o) => o.rate_source)).toEqual([
      'team_member_rates',
      'none',
    ]);
  });

  it('tags an option governed by another workspace (L57)', async () => {
    const { service } = await build({
      teams: [{ id: TEAM_A, name: 'Cross', workspace_id: OTHER_WS }],
    });
    const r = await service.resolve(ME, PROJECT, {
      at: NOW(),
      purpose: 'read',
    });
    expect(r.options[0].workspace_tag).toBe('Prodigitality');
    expect(r.options[0].sheet_scope).toEqual({
      kind: 'workspace',
      ref: OTHER_WS,
    });
  });

  it('approver_hint follows the override and approval_required', async () => {
    const { service } = await build({
      teams: [
        { id: TEAM_A, name: 'Team approves', teamScope: true },
        { id: TEAM_B, name: 'No approval', workspace_id: OTHER_WS },
      ],
      policies: {
        [TEAM_A]: { approver_scope: 'team' },
        [OTHER_WS]: { approval_required: false },
      },
    });
    const r = await service.resolve(ME, PROJECT, {
      at: NOW(),
      purpose: 'read',
    });
    expect(r.options.map((o) => o.approver_hint)).toEqual(['team', 'auto']);
  });
});

// ── step 4 ──────────────────────────────────────────────────────────────────
describe('step 4: workspace', () => {
  it('only with no team present, for a workspace member', async () => {
    const { service } = await build({ workspaceMember: true });
    const r = await service.resolve(ME, PROJECT, {
      at: NOW(),
      purpose: 'read',
    });
    expect(kinds(r)).toEqual([`workspace:${WS}`]);
    expect(r.options[0]).toMatchObject({
      label: 'Acme Workspace',
      sheet_scope: { kind: 'workspace', ref: WS },
      rate_source: 'none',
      workspace_tag: null,
      approver_hint: 'workspace',
    });
    expect(r.selected).toEqual(r.options[0]);
    expect(r.reason).toBeUndefined();
  });

  it('not for a non-member of the workspace', async () => {
    const { service } = await build({ workspaceMember: false });
    const r = await service.resolve(ME, PROJECT, {
      at: NOW(),
      purpose: 'read',
    });
    expect(kinds(r)).toEqual(['personal:']);
    expect(r.personal_reason).toBe('no_governed_option');
  });

  it('a workspace without time_tracking is unavailable: plan', async () => {
    const { service } = await build({
      workspaceMember: true,
      features: { [WS]: { time_tracking: false } },
    });
    const r = await service.resolve(ME, PROJECT, {
      at: NOW(),
      purpose: 'read',
    });
    expect(r.unavailable).toEqual([
      { kind: 'workspace', id: WS, label: 'Acme Workspace', reason: 'plan' },
    ]);
    expect(r.personal_reason).toBe('plan');
  });

  it('effective tracking_enabled=false leaves no workspace option (CHANGE-11)', async () => {
    const { service } = await build({
      workspaceMember: true,
      policies: { [WS]: { tracking_enabled: false } },
    });
    const r = await service.resolve(ME, PROJECT, {
      at: NOW(),
      purpose: 'read',
    });
    expect(kinds(r)).toEqual(['personal:']);
    expect(r.unavailable).toEqual([]);
  });

  it('is skipped when a team is present, even a suppressed one', async () => {
    const { service } = await build({
      workspaceMember: true,
      teams: [{ id: HIRER_TEAM, name: 'Hirer team' }],
      assignments: [{ id: ASSIGN_1, talent_engagement_id: TALENT_ENG }],
      hirerTeams: { [TALENT_ENG]: HIRER_TEAM },
    });
    const r = await service.resolve(ME, PROJECT, {
      at: NOW(),
      purpose: 'read',
    });
    expect(kinds(r)).toEqual([`assignment:${ASSIGN_1}`]);
  });
});

// ── step 2 ──────────────────────────────────────────────────────────────────
describe('step 2: assignments', () => {
  it('a talent assignment: hirer label, engagement scope, cost rate, hirer approves', async () => {
    const { service } = await build({
      assignments: [
        {
          id: ASSIGN_1,
          talent_engagement_id: TALENT_ENG,
          hirer_label: 'Rico for Pixel',
        },
      ],
    });
    const r = await service.resolve(ME, PROJECT, {
      at: NOW(),
      purpose: 'read',
    });
    expect(r.options).toEqual([
      {
        kind: 'assignment',
        id: ASSIGN_1,
        label: 'Rico for Pixel',
        sheet_scope: { kind: 'engagement', ref: TALENT_ENG },
        rate_source: 'engagement_cost',
        // The engagement's policy workspace differs from the project's.
        workspace_tag: 'Prodigitality',
        approver_hint: 'hirer',
      },
    ]);
  });

  it('a client-only assignment carries no cost and confirms automatically', async () => {
    const { service } = await build({
      assignments: [{ id: ASSIGN_1, client_engagement_id: CLIENT_ENG }],
    });
    const r = await service.resolve(ME, PROJECT, {
      at: NOW(),
      purpose: 'read',
    });
    expect(r.options[0]).toMatchObject({
      rate_source: 'none',
      approver_hint: 'auto',
    });
  });

  const unavailableCases: Array<{
    reason: UnavailableReason;
    extra: Partial<AssignmentContext>;
    /** tracking_mode in force; null = no settings row; absent = 'optional'. */
    mode?: string | null;
  }> = [
    { reason: 'engagement_inactive', extra: { governing_status: 'ended' } },
    { reason: 'no_settings', extra: {}, mode: null },
    { reason: 'contract_disabled', extra: {}, mode: 'disabled' },
  ];
  for (const c of unavailableCases) {
    it(c.reason, async () => {
      const { service } = await build({
        assignments: [
          { id: ASSIGN_1, talent_engagement_id: TALENT_ENG, ...c.extra },
        ],
        settings: c.mode === undefined ? {} : { [TALENT_ENG]: c.mode },
      });
      const r = await service.resolve(ME, PROJECT, {
        at: NOW(),
        purpose: 'read',
      });
      expect(r.unavailable).toEqual([
        { kind: 'assignment', id: ASSIGN_1, label: 'Acme', reason: c.reason },
      ]);
      expect(kinds(r)).toEqual(['personal:']);
      expect(r.personal_reason).toBe('no_governed_option');
    });
  }

  it('timer reads active assignments only; manual, edit and alias accept an ended window', async () => {
    const { service, engagements } = await build();
    await service.select(ME, PROJECT, { at: NOW(), purpose: 'timer' });
    await service.select(ME, PROJECT, { at: NOW(), purpose: 'manual' });
    await service.select(ME, PROJECT, { at: NOW(), purpose: 'edit' });
    await service.select(ME, PROJECT, { at: NOW(), purpose: 'alias' });
    expect(
      engagements.listActiveAssignmentsForWorker.mock.calls.map(
        (c: unknown[]) =>
          (c[3] as { includeEndedWindow: boolean }).includeEndedWindow,
      ),
    ).toEqual([false, true, true, true]);
  });

  it('L35: suppresses the assignment team and the talent hirer party team (E34)', async () => {
    const { service } = await build({
      teams: [
        { id: TEAM_A, name: 'Assignment team', teamScope: true },
        { id: HIRER_TEAM, name: 'Hirer team', teamScope: true },
        { id: TEAM_B, name: 'Unrelated', teamScope: true },
      ],
      assignments: [
        { id: ASSIGN_1, talent_engagement_id: TALENT_ENG, team_id: TEAM_A },
      ],
      hirerTeams: { [TALENT_ENG]: HIRER_TEAM },
    });
    const r = await service.resolve(ME, PROJECT, {
      at: NOW(),
      purpose: 'read',
    });
    expect(kinds(r)).toEqual([`assignment:${ASSIGN_1}`, `team:${TEAM_B}`]);
  });
});

// ── step 5 and 6 ────────────────────────────────────────────────────────────
describe('steps 5 and 6', () => {
  it("an agreement with tracking_mode='required' removes every other option", async () => {
    const { service } = await build({
      teams: [{ id: TEAM_A, name: 'Design' }],
      assignments: [{ id: ASSIGN_1, talent_engagement_id: TALENT_ENG }],
      settings: { [TALENT_ENG]: 'required' },
    });
    const r = await service.resolve(ME, PROJECT, {
      at: NOW(),
      purpose: 'read',
    });
    expect(kinds(r)).toEqual([`assignment:${ASSIGN_1}`]);
    expect(r.selected?.id).toBe(ASSIGN_1);
  });

  it('"Just me" never appears next to a governed option', async () => {
    const { service } = await build({
      teams: [{ id: TEAM_A, name: 'Design' }],
    });
    const r = await service.resolve(ME, PROJECT, {
      at: NOW(),
      purpose: 'read',
    });
    expect(kinds(r)).toEqual([`team:${TEAM_A}`]);
    expect(r.personal_reason).toBeUndefined();
  });

  it('"Just me" has no sheet, no rate, no approver', async () => {
    const { service } = await build();
    const choice = await service.select(ME, PROJECT, {
      at: NOW(),
      purpose: 'timer',
    });
    expect(choice).toEqual({
      kind: 'personal',
      id: null,
      label: 'Just me',
      sheet_scope: null,
      rate_source: 'none',
      workspace_tag: null,
      approver_hint: null,
    });
  });
});

// ── step 7 and 8 ────────────────────────────────────────────────────────────
describe('step 7: collapse, prefill, errors', () => {
  const twoAgreements: Scenario = {
    assignments: [
      { id: ASSIGN_1, talent_engagement_id: TALENT_ENG, hirer_label: 'Acme' },
      {
        id: ASSIGN_2,
        talent_engagement_id: TALENT_ENG_2,
        hirer_label: 'Pixel',
      },
    ],
  };

  it('collapses equal (sheet scope, rate source), keeping the first (E52)', async () => {
    const { service } = await build({
      teams: [
        { id: TEAM_A, name: 'First' },
        { id: TEAM_B, name: 'Second' },
      ],
    });
    const r = await service.resolve(ME, PROJECT, {
      at: NOW(),
      purpose: 'read',
    });
    expect(kinds(r)).toEqual([`team:${TEAM_A}`]);
    expect(r.selected?.id).toBe(TEAM_A);
    // The collapsed-away option is still a valid explicit choice.
    const choice = await service.select(ME, PROJECT, {
      at: NOW(),
      purpose: 'manual',
      requested: { kind: 'team', id: TEAM_B },
    });
    expect(choice.id).toBe(TEAM_B);
  });

  it('several differing options without a default: reason required, write 409 with {options, prefill:null}', async () => {
    const { service } = await build(twoAgreements);
    const r = await service.resolve(ME, PROJECT, {
      at: NOW(),
      purpose: 'read',
    });
    expect(r.selected).toBeNull();
    expect(r.prefill).toBeNull();
    expect(r.reason).toBe('required');
    const e = await caught(
      service.select(ME, PROJECT, { at: NOW(), purpose: 'timer' }),
    );
    expect(e.getStatus()).toBe(409);
    expect(body(e)).toMatchObject({
      code: 'LOGGING_FOR_REQUIRED',
      options: r.options,
      prefill: null,
    });
  });

  it('a remembered default is a one-tap prefill, never applied silently (E40, L38)', async () => {
    const { service } = await build({
      ...twoAgreements,
      defaultRow: {
        context_kind: 'assignment',
        team_id: null,
        workspace_id: null,
        engagement_assignment_id: ASSIGN_2,
      },
    });
    const r = await service.resolve(ME, PROJECT, {
      at: NOW(),
      purpose: 'read',
    });
    expect(r.prefill?.id).toBe(ASSIGN_2);
    expect(r.selected).toBeNull();
    expect(r.reason).toBe('confirm');
    const e = await caught(
      service.select(ME, PROJECT, { at: NOW(), purpose: 'manual' }),
    );
    expect(body(e)).toMatchObject({
      code: 'LOGGING_FOR_REQUIRED',
      prefill: r.prefill,
    });
    // One tap resends it.
    const choice = await service.select(ME, PROJECT, {
      at: NOW(),
      purpose: 'manual',
      requested: { kind: 'assignment', id: ASSIGN_2 },
    });
    expect(choice.id).toBe(ASSIGN_2);
  });

  it('a stale default is ignored (E26)', async () => {
    const { service } = await build({
      ...twoAgreements,
      defaultRow: {
        context_kind: 'team',
        team_id: TEAM_C,
        workspace_id: null,
        engagement_assignment_id: null,
      },
    });
    const r = await service.resolve(ME, PROJECT, {
      at: NOW(),
      purpose: 'read',
    });
    expect(r.prefill).toBeNull();
    expect(r.reason).toBe('required');
  });

  it('a foreign request is 422 {options} and never echoes or looks up the id (L24)', async () => {
    const { service, db } = await build(twoAgreements);
    const e = await caught(
      service.select(ME, PROJECT, {
        at: NOW(),
        purpose: 'timer',
        requested: { kind: 'team', id: FOREIGN },
      }),
    );
    expect(e.getStatus()).toBe(422);
    expect(body(e).code).toBe('LOGGING_FOR_INVALID');
    expect((body(e).options as unknown[]).length).toBe(2);
    expect(JSON.stringify(body(e))).not.toContain(FOREIGN);
    for (const call of db.calls) {
      expect(JSON.stringify(call.filters)).not.toContain(FOREIGN);
    }
  });

  it('a request for an unavailable option is 422', async () => {
    const { service } = await build({
      teams: [{ id: TEAM_A, name: 'Off', time_tracking_enabled: false }],
    });
    const e = await caught(
      service.select(ME, PROJECT, {
        at: NOW(),
        purpose: 'timer',
        requested: { kind: 'team', id: TEAM_A },
      }),
    );
    expect(body(e).code).toBe('LOGGING_FOR_INVALID');
  });

  it('remember: true stores the choice', async () => {
    const { service, db, cache } = await build(twoAgreements);
    await service.select(ME, PROJECT, {
      at: NOW(),
      purpose: 'timer',
      requested: { kind: 'assignment', id: ASSIGN_1 },
      remember: true,
    });
    expect(db.tables.time_logging_defaults).toEqual([
      expect.objectContaining({
        user_id: ME,
        project_id: PROJECT,
        context_kind: 'assignment',
        engagement_assignment_id: ASSIGN_1,
        team_id: null,
        workspace_id: null,
      }),
    ]);
    expect(cache.bumpEpoch).toHaveBeenCalled();
  });
});

describe('step 8: alias (D44)', () => {
  it('uses the remembered default when several options differ', async () => {
    const { service } = await build({
      assignments: [
        { id: ASSIGN_1, talent_engagement_id: TALENT_ENG },
        { id: ASSIGN_2, talent_engagement_id: TALENT_ENG_2 },
      ],
      defaultRow: {
        context_kind: 'assignment',
        team_id: null,
        workspace_id: null,
        engagement_assignment_id: ASSIGN_2,
      },
    });
    const choice = await service.select(ME, PROJECT, {
      at: NOW(),
      purpose: 'alias',
    });
    expect(choice.id).toBe(ASSIGN_2);
  });

  it('else the first option after the collapse, never a 409', async () => {
    const { service } = await build({
      assignments: [
        { id: ASSIGN_1, talent_engagement_id: TALENT_ENG },
        { id: ASSIGN_2, talent_engagement_id: TALENT_ENG_2 },
      ],
    });
    const choice = await service.select(ME, PROJECT, {
      at: NOW(),
      purpose: 'alias',
    });
    expect(choice.id).toBe(ASSIGN_1);
  });

  it('no option is 403 NO_LOGGING_CONTEXT', async () => {
    const { service } = await build({ role: 'commenter' });
    const e = await caught(
      service.select(ME, PROJECT, { at: NOW(), purpose: 'alias' }),
    );
    expect(body(e).code).toBe('NO_LOGGING_CONTEXT');
  });
});

// ── caching ─────────────────────────────────────────────────────────────────
describe('caching (L60)', () => {
  it('writes never read or write Redis', async () => {
    const { service, cache } = await build({ workspaceMember: true });
    for (const purpose of ['timer', 'manual', 'edit', 'alias'] as const) {
      await service.select(ME, PROJECT, { at: NOW(), purpose });
      await service.resolve(ME, PROJECT, { at: NOW(), purpose });
    }
    expect(cache.getLoggingFor).not.toHaveBeenCalled();
    expect(cache.setLoggingFor).not.toHaveBeenCalled();
  });

  it('a read of now is served from the cache when present', async () => {
    const cached: LoggingForResult = {
      options: [],
      selected: null,
      prefill: null,
      reason: 'none',
      unavailable: [],
    };
    const { service, projectAuth } = await build({ cached });
    const r = await service.resolve(ME, PROJECT, {
      at: NOW(),
      purpose: 'read',
    });
    expect(r).toBe(cached);
    expect(projectAuth.resolvePermissions).not.toHaveBeenCalled();
  });

  it('a read miss is computed and stored', async () => {
    const { service, cache } = await build({ workspaceMember: true });
    const r = await service.resolve(ME, PROJECT, {
      at: NOW(),
      purpose: 'read',
    });
    expect(cache.setLoggingFor).toHaveBeenCalledWith(ME, PROJECT, r);
  });

  it('a dated read (manual entry for last week) is never cached', async () => {
    const { service, cache } = await build({ workspaceMember: true });
    await service.resolve(ME, PROJECT, {
      at: new Date(Date.now() - 7 * 86_400_000),
      purpose: 'read',
    });
    expect(cache.getLoggingFor).not.toHaveBeenCalled();
    expect(cache.setLoggingFor).not.toHaveBeenCalled();
  });
});

// ── remember ────────────────────────────────────────────────────────────────
describe('remember', () => {
  it('inserts, then updates, and skips an unchanged row', async () => {
    const { service, db, cache } = await build();
    await service.remember(ME, PROJECT, { kind: 'team', id: TEAM_A });
    await service.remember(ME, PROJECT, { kind: 'workspace', id: WS });
    await service.remember(ME, PROJECT, { kind: 'workspace', id: WS });
    expect(db.tables.time_logging_defaults).toHaveLength(1);
    expect(db.tables.time_logging_defaults[0]).toMatchObject({
      context_kind: 'workspace',
      workspace_id: WS,
      team_id: null,
      engagement_assignment_id: null,
    });
    expect(db.calls.filter((c) => c.op === 'insert')).toHaveLength(1);
    expect(db.calls.filter((c) => c.op === 'update')).toHaveLength(1);
    expect(cache.bumpEpoch).toHaveBeenCalledTimes(2);
  });

  it('personal stores no ids', async () => {
    const { service, db } = await build();
    await service.remember(ME, PROJECT, { kind: 'personal', id: null });
    expect(db.tables.time_logging_defaults[0]).toMatchObject({
      context_kind: 'personal',
      team_id: null,
      workspace_id: null,
      engagement_assignment_id: null,
    });
  });

  it('a governed choice without an id is 422', async () => {
    const { service } = await build();
    const e = await caught(service.remember(ME, PROJECT, { kind: 'team' }));
    expect(body(e).code).toBe('LOGGING_FOR_INVALID');
  });
});

// ── policyFor ───────────────────────────────────────────────────────────────
describe('policyFor', () => {
  it('404 for a ref that is not one of the caller options, never echoing it', async () => {
    const { service, policy } = await build({
      teams: [{ id: TEAM_A, name: 'A' }],
    });
    const e = await caught(
      service.policyFor(ME, PROJECT, { kind: 'team', id: FOREIGN }, NOW()),
    );
    expect(e.getStatus()).toBe(404);
    expect(JSON.stringify(body(e))).not.toContain(FOREIGN);
    // Only the option's own policy reads ran (the step-3 hint), never one for the foreign id.
    for (const call of policy.resolve.mock.calls) {
      expect(JSON.stringify(call)).not.toContain(FOREIGN);
    }
  });

  it('resolves the option sheet scope with the member layer for a team', async () => {
    const { service, policy } = await build({
      teams: [{ id: TEAM_A, name: 'A', teamScope: true }],
    });
    policy.resolve.mockClear();
    await service.policyFor(ME, PROJECT, { kind: 'team', id: TEAM_A }, NOW());
    expect(policy.resolve).toHaveBeenLastCalledWith(
      { kind: 'team', ref: TEAM_A },
      WS,
      expect.any(Date),
      { memberUserId: ME, projectId: PROJECT, teamId: TEAM_A },
    );
  });

  it('null = the selected option', async () => {
    const { service, policy } = await build({ workspaceMember: true });
    await service.policyFor(ME, PROJECT, null, NOW());
    expect(policy.resolve).toHaveBeenLastCalledWith(
      { kind: 'workspace', ref: WS },
      WS,
      expect.any(Date),
      { memberUserId: ME, projectId: PROJECT },
    );
  });

  it('"Just me" reads the platform defaults (no policy workspace)', async () => {
    const { service, policy } = await build();
    await service.policyFor(ME, PROJECT, { kind: 'personal' }, NOW());
    expect(policy.resolve).toHaveBeenLastCalledWith(
      { kind: 'workspace', ref: PROJECT },
      null,
      expect.any(Date),
    );
  });

  it('a viewer has no options, so every ref is a 404', async () => {
    const { service } = await build({ role: 'viewer', workspaceMember: true });
    const e = await caught(service.policyFor(ME, PROJECT, null, NOW()));
    expect(e.getStatus()).toBe(404);
  });
});
