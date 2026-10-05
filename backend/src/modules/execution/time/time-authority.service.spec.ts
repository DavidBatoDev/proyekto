import { HttpException, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import {
  AssignmentContext,
  EngagementPosition,
  EngagementsService,
} from '../../marketplace/engagements/engagements.service';
import { EntitlementsService } from '../../shared/entitlements/entitlements.service';
import { ProjectAuthorizationService } from '../projects/authorization/project-authorization.service';
import {
  HIDDEN_CONTENT_LABEL,
  MASKED_MEMBER_LABEL,
  TimeAuthorityService,
} from './time-authority.service';
import {
  ENTRY_BASE_SELECT,
  ENTRY_CONTENT_SELECT,
  ENTRY_COST_SELECT,
  ENTRY_IDENTITY_EMAIL_SELECT,
  ENTRY_IDENTITY_SELECT,
} from './time-entry.select';
import { TimePolicyService } from './time-policy.service';
import type { EntryAuthRow } from './time.types';

// ── ids ─────────────────────────────────────────────────────────────────────
const uid = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
// people
const MEMBER = uid(1); // the worker / entry member
const MANAGER = uid(2); // manages every team below
const OUTSIDER = uid(3);
const TALENT_HIRER = uid(4);
const TALENT_PROVIDER = uid(5);
const CLIENT_HIRER = uid(6);
const CLIENT_PROVIDER = uid(7);
const WS_ADMIN = uid(8);
const CONSULTANT = uid(9); // worker of the client-only assignment
const OWNER_OF_P1 = uid(50);
// places
const P1 = uid(100);
const P2 = uid(101);
const P3 = uid(102);
const WS_BIZ = uid(110); // has time_team_rules
const WS_FREE = uid(111); // does not
const T_RATES = uid(120);
const T_PLAIN = uid(121);
const T_NORULES = uid(122);
const TALENT_ENG = uid(130);
const CLIENT_ENG = uid(131);
const CLIENT_ENG_2 = uid(132);
const A_TALENT = uid(140);
const A_CLIENT = uid(141);
const S_OPEN = uid(150);
const S_SUBMITTED = uid(151);
const S_FOREIGN = uid(152);
// entries
const E_TEAM_RATES = uid(200);
const E_TEAM_PLAIN = uid(201);
const E_TEAM_NORULES = uid(202);
const E_TALENT = uid(203);
const E_CLIENT = uid(204);
const E_WS = uid(205);
const E_PERSONAL = uid(206);
const E_HIDDEN = uid(207); // on P2, where MANAGER has no access.time
const E_PAID = uid(208);
const E_BILLED = uid(209);
const E_LEGACY = uid(210);
const E_FROZEN = uid(211);
const E_SUBMITTED = uid(212);
const E_GONE = uid(213); // authorised, then deleted before hydration

type Row = Record<string, unknown>;

// ── a PostgREST stand-in that projects the select (embeds included) ─────────
function splitTop(select: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of select) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function project(row: Row, select: string): Row {
  const out: Row = {};
  for (const token of splitTop(select)) {
    const paren = token.indexOf('(');
    if (paren < 0) {
      out[token] = row[token] ?? null;
      continue;
    }
    const head = token.slice(0, paren);
    const inner = token.slice(paren + 1, token.lastIndexOf(')'));
    const key = (
      head.includes(':') ? head.split(':')[0] : head.split('!')[0]
    ).trim();
    const value = row[key];
    out[key] =
      value && typeof value === 'object' ? project(value as Row, inner) : null;
  }
  return out;
}

interface Call {
  table: string;
  select?: string;
  eq: Record<string, unknown>;
  in: Record<string, unknown[]>;
}

function fakeDb(
  tables: Record<string, Row[]>,
  rpc: (name: string, args: Row) => { data: unknown; error: unknown },
) {
  const calls: Call[] = [];
  const from = jest.fn((table: string) => {
    const call: Call = { table, eq: {}, in: {} };
    calls.push(call);
    const preds: Array<(r: Row) => boolean> = [];
    const exec = () => {
      if (tables.__fail && tables.__fail.some((f) => f.table === table)) {
        const f = tables.__fail.find((x) => x.table === table) as Row;
        return { data: null, error: f.error };
      }
      const rows = (tables[table] ?? []).filter((r) =>
        preds.every((p) => p(r)),
      );
      return {
        data: rows.map((r) => (call.select ? project(r, call.select) : r)),
        error: null,
      };
    };
    const chain: any = {
      select: (s: string) => {
        call.select = s;
        return chain;
      },
      eq: (c: string, v: unknown) => {
        call.eq[c] = v;
        preds.push((r) => r[c] === v);
        return chain;
      },
      in: (c: string, vs: unknown[]) => {
        call.in[c] = vs;
        preds.push((r) => vs.includes(r[c]));
        return chain;
      },
      maybeSingle: () => {
        const res = exec();
        return Promise.resolve({
          data: Array.isArray(res.data) ? (res.data[0] ?? null) : null,
          error: res.error,
        });
      },
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
        Promise.resolve(exec()).then(ok, ko),
    };
    return chain;
  });
  const rpcFn = jest.fn((name: string, args: Row) =>
    Promise.resolve(rpc(name, args)),
  );
  return {
    sb: { from, rpc: rpcFn } as unknown as SupabaseClient,
    calls,
    rpc: rpcFn,
  };
}

// ── the world ───────────────────────────────────────────────────────────────
const SHEETS: Row[] = [
  {
    id: S_OPEN,
    status: 'open',
    member_user_id: MEMBER,
    scope_kind: 'workspace',
  },
  {
    id: S_SUBMITTED,
    status: 'submitted',
    member_user_id: MEMBER,
    scope_kind: 'workspace',
  },
  {
    id: S_FOREIGN,
    status: 'open',
    member_user_id: OUTSIDER,
    scope_kind: 'workspace',
  },
];

function entry(id: string, over: Row = {}): Row {
  const sheetId = (over.timesheet_id as string | null | undefined) ?? S_OPEN;
  const sheet = SHEETS.find((s) => s.id === sheetId) ?? null;
  return {
    id,
    member_user_id: MEMBER,
    member_display_name_snapshot: 'Maria',
    project_id: P1,
    context_kind: 'team',
    context_ref: T_RATES,
    context_label_snapshot: 'Rates team',
    team_id: T_RATES,
    workspace_id: null,
    engagement_assignment_id: null,
    timesheet_id: sheetId,
    work_item: 'task',
    started_at: '2026-10-01T01:00:00Z',
    ended_at: '2026-10-01T02:00:00Z',
    paused_at: null,
    duration_seconds: 3600,
    break_seconds: 0,
    break_minutes: 0,
    payable_seconds: null,
    source: 'timer',
    work_type_snapshot: 'real_work',
    legacy_status: null,
    payout_id: null,
    flagged_reason: null,
    created_at: '2026-10-01T01:00:00Z',
    updated_at: '2026-10-01T02:00:00Z',
    task_id: uid(900),
    note: 'Fixed the login bug',
    rate_snapshot: '500.00',
    rate_type_snapshot: 'hourly',
    currency_snapshot: 'PHP',
    amount_snapshot: '500.00',
    timesheet: sheet
      ? {
          id: sheet.id,
          status: sheet.status,
          period_start: '2026-09-28',
          period_end: '2026-10-04',
          decision_kind: null,
          decided_by: null,
          decided_at: null,
          decision_note: null,
          scope_label_snapshot: 'Acme',
        }
      : null,
    member: {
      id: MEMBER,
      display_name: 'Maria',
      avatar_url: 'https://cdn/m.png',
      first_name: 'Maria',
      last_name: 'Reyes',
      email: 'maria@example.com',
    },
    task: {
      id: uid(900),
      title: 'Login bug',
      work_type: 'real_work',
      status: 'done',
    },
    project: { id: P1, title: 'Client portal' },
    ...over,
  };
}

const ENTRIES: Row[] = [
  entry(E_TEAM_RATES),
  entry(E_TEAM_PLAIN, { team_id: T_PLAIN, context_ref: T_PLAIN }),
  entry(E_TEAM_NORULES, { team_id: T_NORULES, context_ref: T_NORULES }),
  entry(E_TALENT, {
    context_kind: 'assignment',
    context_ref: A_TALENT,
    team_id: null,
    engagement_assignment_id: A_TALENT,
  }),
  entry(E_CLIENT, {
    member_user_id: CONSULTANT,
    context_kind: 'assignment',
    context_ref: A_CLIENT,
    team_id: null,
    engagement_assignment_id: A_CLIENT,
  }),
  entry(E_WS, {
    context_kind: 'workspace',
    context_ref: WS_BIZ,
    team_id: null,
    workspace_id: WS_BIZ,
  }),
  entry(E_PERSONAL, {
    context_kind: 'personal',
    context_ref: null,
    team_id: null,
    timesheet_id: null,
    timesheet: null,
  }),
  entry(E_HIDDEN, { project_id: P2, team_id: T_PLAIN, context_ref: T_PLAIN }),
  entry(E_PAID, { payout_id: uid(800), payable_seconds: 3600 }),
  entry(E_BILLED, { payable_seconds: 3600 }),
  entry(E_LEGACY, { legacy_status: 'rejected', payable_seconds: 0 }),
  entry(E_FROZEN, { payable_seconds: 3600 }),
  entry(E_SUBMITTED, { timesheet_id: S_SUBMITTED }),
];

function authRow(id: string): EntryAuthRow {
  const r = ENTRIES.find((e) => e.id === id) ?? entry(id);
  return {
    id: r.id as string,
    member_user_id: r.member_user_id as string | null,
    project_id: r.project_id as string | null,
    context_kind: r.context_kind as EntryAuthRow['context_kind'],
    context_ref: r.context_ref as string | null,
    team_id: r.team_id as string | null,
    workspace_id: r.workspace_id as string | null,
    engagement_assignment_id: r.engagement_assignment_id as string | null,
    timesheet_id: r.timesheet_id as string | null,
    started_at: r.started_at as string,
  };
}

const TEAMS: Row[] = [
  { id: T_RATES, workspace_id: WS_BIZ, member_rates_enabled: true },
  { id: T_PLAIN, workspace_id: WS_BIZ, member_rates_enabled: false },
  { id: T_NORULES, workspace_id: WS_FREE, member_rates_enabled: true },
];
const MANAGERS: Record<string, string[]> = {
  [T_RATES]: [MANAGER],
  [T_PLAIN]: [MANAGER],
  [T_NORULES]: [MANAGER],
};

const ASSIGNMENTS: AssignmentContext[] = [
  {
    id: A_TALENT,
    project_id: P1,
    worker_user_id: MEMBER,
    talent_engagement_id: TALENT_ENG,
    client_engagement_id: CLIENT_ENG,
    governing_engagement_id: TALENT_ENG,
    governing_kind: 'talent_services',
    governing_status: 'active',
    team_id: null,
    role_title: null,
    status: 'active',
    started_at: '2026-09-01T00:00:00Z',
    ended_at: null,
    created_at: '2026-09-01T00:00:00Z',
    hirer_label: 'Pixel',
  },
  {
    id: A_CLIENT,
    project_id: P1,
    worker_user_id: CONSULTANT,
    talent_engagement_id: null,
    client_engagement_id: CLIENT_ENG_2,
    governing_engagement_id: CLIENT_ENG_2,
    governing_kind: 'client_services',
    governing_status: 'active',
    team_id: null,
    role_title: null,
    status: 'active',
    started_at: '2026-09-01T00:00:00Z',
    ended_at: null,
    created_at: '2026-09-01T00:00:00Z',
    hirer_label: 'Acme',
  },
];

const PARTIES: Record<string, Record<string, EngagementPosition>> = {
  [TALENT_ENG]: { [TALENT_HIRER]: 'hirer', [TALENT_PROVIDER]: 'provider' },
  [CLIENT_ENG]: { [CLIENT_HIRER]: 'hirer', [CLIENT_PROVIDER]: 'provider' },
  [CLIENT_ENG_2]: { [CLIENT_HIRER]: 'hirer', [CONSULTANT]: 'provider' },
};

interface Opts {
  sheetViewers?: Record<string, string[]>;
  deciders?: unknown;
  engagementViews?: unknown[] | Error;
  failTable?: { table: string; error: Row };
}

async function build(o: Opts = {}) {
  const tables: Record<string, Row[]> = {
    time_entries: ENTRIES.map((e) => ({ ...e })),
    timesheets: SHEETS.map((s) => ({ ...s })),
    teams: TEAMS,
    invoice_time_entries: [{ invoice_id: uid(700), entry_id: E_BILLED }],
    project_access: [
      { user_id: MANAGER, project_id: P1, role: 'editor', capabilities: null },
      {
        user_id: MANAGER,
        project_id: P2,
        role: 'viewer',
        capabilities: { 'access.time': false },
      },
      { user_id: WS_ADMIN, project_id: P1, role: 'admin', capabilities: null },
    ],
    projects: [
      { id: P1, owner_id: OWNER_OF_P1 },
      { id: P2, owner_id: OWNER_OF_P1 },
      { id: P3, owner_id: MANAGER },
    ],
    ...(o.failTable ? { __fail: [o.failTable] } : {}),
  };
  const db = fakeDb(tables, (name, args) => {
    switch (name) {
      case 'can_manage_team':
        return {
          data: (MANAGERS[args.p_team_id as string] ?? []).includes(
            args.p_user_id as string,
          ),
          error: null,
        };
      case 'can_view_timesheet':
        return {
          data: (
            o.sheetViewers?.[args.p_timesheet_id as string] ?? []
          ).includes(args.p_user_id as string),
          error: null,
        };
      case 'can_decide_timesheet':
        return { data: false, error: null };
      case 'can_manage_workspace':
        return {
          data: args.p_workspace_id === WS_BIZ && args.p_user_id === WS_ADMIN,
          error: null,
        };
      case 'time_timesheet_deciders':
        return { data: o.deciders ?? [], error: null };
      default:
        return { data: null, error: { code: '42883', message: 'no function' } };
    }
  });

  const engagements = {
    assignmentsForProject: jest.fn((projectId: string) =>
      Promise.resolve(ASSIGNMENTS.filter((a) => a.project_id === projectId)),
    ),
    getAssignment: jest.fn((id: string) =>
      Promise.resolve(ASSIGNMENTS.find((a) => a.id === id) ?? null),
    ),
    isParty: jest.fn((engagementId: string, userId: string) =>
      Promise.resolve(PARTIES[engagementId]?.[userId] ?? null),
    ),
    list: jest.fn(() =>
      o.engagementViews instanceof Error
        ? Promise.reject(o.engagementViews)
        : Promise.resolve(o.engagementViews ?? []),
    ),
  };
  const policy = {
    planRefForTeam: jest.fn(
      (team: { id: string; workspace_id: string | null }) =>
        Promise.resolve(team.workspace_id),
    ),
  };
  const entitlements = {
    hasFeature: jest.fn((ref: unknown, key: string) =>
      Promise.resolve(!(ref === WS_FREE && key === 'time_team_rules')),
    ),
  };
  const projectAuth = { resolvePermissions: jest.fn() };

  const moduleRef = await Test.createTestingModule({
    providers: [
      TimeAuthorityService,
      { provide: SUPABASE_ADMIN, useValue: db.sb },
      { provide: ProjectAuthorizationService, useValue: projectAuth },
      { provide: EngagementsService, useValue: engagements },
      { provide: EntitlementsService, useValue: entitlements },
      { provide: TimePolicyService, useValue: policy },
    ],
  }).compile();
  return {
    service: moduleRef.get(TimeAuthorityService),
    db,
    engagements,
    entitlements,
    policy,
  };
}
async function caught(p: Promise<unknown>): Promise<HttpException> {
  try {
    await p;
  } catch (error) {
    if (error instanceof HttpException) return error;
    throw error;
  }
  throw new Error('expected the call to throw');
}
const code = (e: HttpException) =>
  (e.getResponse() as Record<string, unknown>).code;

beforeEach(() => {
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

// ── costVisible ─────────────────────────────────────────────────────────────
describe('costVisible matrix', () => {
  const rows = [
    E_TEAM_RATES,
    E_TEAM_PLAIN,
    E_TEAM_NORULES,
    E_TALENT,
    E_CLIENT,
    E_WS,
    E_PERSONAL,
  ].map(authRow);

  const cases: Array<[string, string, string[]]> = [
    // the member sees money on every own entry
    [
      'member',
      MEMBER,
      [E_TEAM_RATES, E_TEAM_PLAIN, E_TEAM_NORULES, E_TALENT, E_WS, E_PERSONAL],
    ],
    // team manager: only with member rates on AND time_team_rules on the plan subject
    ['team manager', MANAGER, [E_TEAM_RATES]],
    // talent hirer: their own talent engagement only (L22)
    ['talent hirer', TALENT_HIRER, [E_TALENT]],
    // client hirer, client provider, workspace admin, outsiders: never through time
    ['client hirer', CLIENT_HIRER, []],
    ['client provider', CLIENT_PROVIDER, []],
    ['workspace admin', WS_ADMIN, []],
    ['outsider', OUTSIDER, []],
  ];
  for (const [label, viewer, expected] of cases) {
    it(label, async () => {
      const { service } = await build();
      const visible = await service.costVisible(viewer, rows);
      expect([...visible].sort()).toEqual([...expected].sort());
    });
  }

  it('the consultant worker sees their own client time cost, nobody else does', async () => {
    const { service } = await build();
    expect([...(await service.costVisible(CONSULTANT, rows))]).toEqual([
      E_CLIENT,
    ]);
  });

  it('the team-rules check uses the team plan subject (D26)', async () => {
    const { service, policy, entitlements } = await build();
    await service.costVisible(MANAGER, [authRow(E_TEAM_NORULES)]);
    expect(policy.planRefForTeam).toHaveBeenCalledWith({
      id: T_NORULES,
      workspace_id: WS_FREE,
    });
    expect(entitlements.hasFeature).toHaveBeenCalledWith(
      WS_FREE,
      'time_team_rules',
    );
  });
});

// ── identityVisible (E35) ───────────────────────────────────────────────────
describe('identityVisible: the E35 matrix', () => {
  const cases: Array<[string, string, boolean]> = [
    ['worker', MEMBER, true],
    ['talent hirer', TALENT_HIRER, true],
    ['talent provider', TALENT_PROVIDER, true],
    ['client provider', CLIENT_PROVIDER, true],
    ['client hirer (even at detailed)', CLIENT_HIRER, false],
    ['team manager', MANAGER, false],
    ['workspace admin', WS_ADMIN, false],
    ['outsider', OUTSIDER, false],
  ];
  for (const [label, viewer, visible] of cases) {
    it(`${label} ${visible ? 'sees' : 'does not see'} the assignment worker`, async () => {
      const { service } = await build();
      const set = await service.identityVisible(viewer, [authRow(E_TALENT)]);
      expect(set.has(E_TALENT)).toBe(visible);
    });
  }

  it('team, workspace and personal entries always show their person', async () => {
    const { service, engagements } = await build();
    const set = await service.identityVisible(
      OUTSIDER,
      [E_TEAM_RATES, E_WS, E_PERSONAL].map(authRow),
    );
    expect([...set].sort()).toEqual([E_TEAM_RATES, E_WS, E_PERSONAL].sort());
    expect(engagements.assignmentsForProject).not.toHaveBeenCalled();
  });

  it('is keyed on the assignment, one project read for many entries', async () => {
    const { service, engagements } = await build();
    await service.identityVisible(CLIENT_HIRER, [
      authRow(E_TALENT),
      authRow(E_CLIENT),
    ]);
    expect(engagements.assignmentsForProject).toHaveBeenCalledTimes(1);
    expect(engagements.getAssignment).not.toHaveBeenCalled();
  });
});

// ── contentVisible ──────────────────────────────────────────────────────────
describe('contentVisible', () => {
  it('access.time per project, the capability override, and an owner without a row', async () => {
    const { service } = await build();
    const set = await service.contentVisible(MANAGER, [P1, P2, P3, P1]);
    expect([...set].sort()).toEqual([P1, P3].sort());
  });

  it('no project ids → no query', async () => {
    const { service, db } = await build();
    expect((await service.contentVisible(MANAGER, [])).size).toBe(0);
    expect(db.calls).toHaveLength(0);
  });
});

// ── hydrate ─────────────────────────────────────────────────────────────────
describe('hydrate', () => {
  const entryCalls = (
    calls: Array<{
      table: string;
      select?: string;
      in: Record<string, unknown[]>;
    }>,
    select: string,
  ) => calls.filter((c) => c.table === 'time_entries' && c.select === select);

  it('never selects a hidden class: cost, identity and content .in() carry only the allowed ids', async () => {
    const { service, db } = await build();
    const rows = [E_TEAM_RATES, E_TEAM_PLAIN, E_TALENT, E_HIDDEN].map(authRow);
    const views = await service.hydrate(MANAGER, rows);

    expect(entryCalls(db.calls, ENTRY_BASE_SELECT).map((c) => c.in.id)).toEqual(
      [[E_TEAM_RATES, E_TEAM_PLAIN, E_TALENT, E_HIDDEN]],
    );
    // Money only for the rates team.
    expect(entryCalls(db.calls, ENTRY_COST_SELECT).map((c) => c.in.id)).toEqual(
      [[E_TEAM_RATES]],
    );
    // The assignment worker is masked for a team manager.
    expect(
      entryCalls(db.calls, ENTRY_IDENTITY_SELECT).map((c) => c.in.id),
    ).toEqual([[E_TEAM_RATES, E_TEAM_PLAIN, E_HIDDEN]]);
    // P2 has access.time switched off for the manager.
    expect(
      entryCalls(db.calls, ENTRY_CONTENT_SELECT).map((c) => c.in.id),
    ).toEqual([[E_TEAM_RATES, E_TEAM_PLAIN, E_TALENT]]);
    // The base select carries no money, no identity, no content (time-entry.select.ts).
    const baseColumns = splitTop(ENTRY_BASE_SELECT);
    for (const col of [
      'rate_snapshot',
      'rate_type_snapshot',
      'currency_snapshot',
      'amount_snapshot',
      'member_user_id',
      'member_display_name_snapshot',
      'task_id',
      'note',
    ]) {
      expect(baseColumns).not.toContain(col);
    }
    expect(ENTRY_BASE_SELECT).not.toContain('email');
    expect(ENTRY_BASE_SELECT).not.toContain('profiles');

    const byId = new Map(views.map((v) => [v.id, v]));
    expect(byId.get(E_TEAM_RATES)).toMatchObject({
      cost: 'visible',
      rate_snapshot: 500,
      rate_type_snapshot: 'hourly',
      currency_snapshot: 'PHP',
      amount_snapshot: 500,
      identity: 'visible',
      content: 'visible',
      note: 'Fixed the login bug',
    });
    const plain = byId.get(E_TEAM_PLAIN);
    expect(plain?.cost).toBe('hidden');
    expect(plain && 'rate_snapshot' in plain).toBe(false);
    expect(plain && 'currency_snapshot' in plain).toBe(false);
    expect(plain && 'amount_snapshot' in plain).toBe(false);
  });

  it('fills the D32 labels for masked identity and hidden content', async () => {
    const { service } = await build();
    const [talent, hidden] = await service.hydrate(
      MANAGER,
      [E_TALENT, E_HIDDEN].map(authRow),
    );
    expect(talent).toMatchObject({
      identity: 'masked',
      member_user_id: null,
      member: null,
      member_display_name_snapshot: null,
      member_label: MASKED_MEMBER_LABEL,
    });
    expect(MASKED_MEMBER_LABEL).toBe('Delivery team');
    expect(hidden).toMatchObject({
      content: 'hidden',
      task_id: null,
      note: null,
      task: null,
      project: null,
      content_label: HIDDEN_CONTENT_LABEL,
      // Base facts survive: interval, duration, work item (Axis 7).
      duration_seconds: 3600,
      work_item: 'task',
      project_id: P2,
    });
    expect(HIDDEN_CONTENT_LABEL).toBe("A project you can't open");
  });

  it('email only with withEmail', async () => {
    const plain = await build();
    const [a] = await plain.service.hydrate(MANAGER, [authRow(E_TEAM_RATES)]);
    expect(a.member).toEqual({
      id: MEMBER,
      display_name: 'Maria',
      avatar_url: 'https://cdn/m.png',
      first_name: 'Maria',
      last_name: 'Reyes',
    });
    expect(
      entryCalls(plain.db.calls, ENTRY_IDENTITY_EMAIL_SELECT),
    ).toHaveLength(0);

    const withEmail = await build();
    const [b] = await withEmail.service.hydrate(
      MANAGER,
      [authRow(E_TEAM_RATES)],
      {
        withEmail: true,
      },
    );
    expect(b.member?.email).toBe('maria@example.com');
    expect(entryCalls(withEmail.db.calls, ENTRY_IDENTITY_SELECT)).toHaveLength(
      0,
    );
  });

  it('no cost query at all when no row is cost-visible', async () => {
    const { service, db } = await build();
    const views = await service.hydrate(
      WS_ADMIN,
      [E_WS, E_TEAM_PLAIN].map(authRow),
    );
    expect(entryCalls(db.calls, ENTRY_COST_SELECT)).toHaveLength(0);
    expect(views.every((v) => v.cost === 'hidden')).toBe(true);
  });

  it('own rows show every class', async () => {
    const { service } = await build();
    const [own] = await service.hydrate(MEMBER, [authRow(E_PERSONAL)], {
      withEmail: true,
    });
    expect(own).toMatchObject({
      identity: 'visible',
      content: 'visible',
      cost: 'visible',
      member_user_id: MEMBER,
      note: 'Fixed the login bug',
      project: { id: P1, title: 'Client portal' },
      task: {
        id: uid(900),
        title: 'Login bug',
        work_type: 'real_work',
        status: 'done',
      },
    });
  });

  it('preserves input order and skips rows deleted since authorisation', async () => {
    const { service } = await build();
    const views = await service.hydrate(
      MEMBER,
      [E_WS, E_GONE, E_TEAM_PLAIN, E_TEAM_RATES].map(authRow),
    );
    expect(views.map((v) => v.id)).toEqual([E_WS, E_TEAM_PLAIN, E_TEAM_RATES]);
  });

  it('derives locked_reason: paid → billed → legacy → frozen → sheet status', async () => {
    const { service, db } = await build();
    const ids = [
      E_PAID,
      E_BILLED,
      E_LEGACY,
      E_FROZEN,
      E_SUBMITTED,
      E_TEAM_RATES,
    ];
    const views = await service.hydrate(MEMBER, ids.map(authRow));
    expect(views.map((v) => v.locked_reason)).toEqual([
      'paid',
      'billed',
      'legacy',
      'frozen',
      'sheet_submitted',
      null,
    ]);
    // One reservation lookup, never for paid rows.
    const billed = db.calls.filter((c) => c.table === 'invoice_time_entries');
    expect(billed).toHaveLength(1);
    expect(billed[0].in.entry_id).not.toContain(E_PAID);
  });

  it('issues at most four entry queries plus the reservation lookup', async () => {
    const { service, db } = await build();
    await service.hydrate(
      MANAGER,
      [E_TEAM_RATES, E_TALENT, E_HIDDEN].map(authRow),
    );
    expect(db.calls.filter((c) => c.table === 'time_entries')).toHaveLength(4);
    expect(
      db.calls.filter((c) => c.table === 'invoice_time_entries'),
    ).toHaveLength(1);
  });

  it('chunks long id lists', async () => {
    const { service, db } = await build();
    const many: EntryAuthRow[] = Array.from({ length: 150 }, (_, i) => ({
      ...authRow(E_PERSONAL),
      id: uid(5000 + i),
    }));
    await service.hydrate(MEMBER, many);
    const base = entryCalls(db.calls, ENTRY_BASE_SELECT);
    expect(base.map((c) => c.in.id.length)).toEqual([100, 50]);
  });

  it('an empty list issues no query', async () => {
    const { service, db } = await build();
    expect(await service.hydrate(MEMBER, [])).toEqual([]);
    expect(db.calls).toHaveLength(0);
  });
});

// ── E65: probes are 404s ────────────────────────────────────────────────────
describe('E65: misses are 404', () => {
  it('a missing entry', async () => {
    const { service } = await build();
    const e = await caught(service.assertViewEntry(MEMBER, uid(4040)));
    expect(e.getStatus()).toBe(404);
    expect(code(e)).toBe('TIME_NOT_FOUND');
  });

  it('a non-UUID id is a 404, not a 500', async () => {
    const { service } = await build({
      failTable: {
        table: 'time_entries',
        error: { code: '22P02', message: 'invalid input syntax for type uuid' },
      },
    });
    const e = await caught(service.assertViewEntry(MEMBER, 'not-a-uuid'));
    expect(e.getStatus()).toBe(404);
  });

  it("someone else's personal entry, without asking any predicate", async () => {
    const { service, db } = await build({ sheetViewers: {} });
    const e = await caught(service.assertViewEntry(MANAGER, E_PERSONAL));
    expect(e.getStatus()).toBe(404);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('own entries pass without a predicate', async () => {
    const { service, db } = await build();
    await expect(
      service.assertViewEntry(MEMBER, E_PERSONAL),
    ).resolves.toMatchObject({
      id: E_PERSONAL,
    });
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it('a sheet viewer passes (can_view_timesheet)', async () => {
    const { service } = await build({
      sheetViewers: { [S_OPEN]: [TALENT_HIRER] },
    });
    await expect(
      service.assertViewEntry(TALENT_HIRER, E_TALENT),
    ).resolves.toMatchObject({
      id: E_TALENT,
    });
  });

  it('D49: a team manager reads a team-context entry on a workspace-scope sheet', async () => {
    const { service, db } = await build({ sheetViewers: {} });
    await expect(
      service.assertViewEntry(MANAGER, E_TEAM_PLAIN),
    ).resolves.toMatchObject({
      id: E_TEAM_PLAIN,
    });
    expect(db.rpc).toHaveBeenCalledWith('can_manage_team', {
      p_team_id: T_PLAIN,
      p_user_id: MANAGER,
    });
  });

  it('D49 is team context only: a team manager does not read an assignment or workspace entry', async () => {
    const { service } = await build({ sheetViewers: {} });
    expect(
      (await caught(service.assertViewEntry(MANAGER, E_TALENT))).getStatus(),
    ).toBe(404);
    expect(
      (await caught(service.assertViewEntry(MANAGER, E_WS))).getStatus(),
    ).toBe(404);
  });

  it('an outsider is a 404', async () => {
    const { service } = await build({ sheetViewers: {} });
    expect(
      (
        await caught(service.assertViewEntry(OUTSIDER, E_TEAM_RATES))
      ).getStatus(),
    ).toBe(404);
  });

  it("assertOwnEntry: someone else's entry is a 404, never a 403", async () => {
    const { service } = await build();
    const e = await caught(service.assertOwnEntry(MANAGER, E_TEAM_RATES));
    expect(e.getStatus()).toBe(404);
    await expect(
      service.assertOwnEntry(MEMBER, E_TEAM_RATES),
    ).resolves.toMatchObject({
      id: E_TEAM_RATES,
      member_user_id: MEMBER,
    });
  });

  it('assertViewTimesheet: member, viewer via the predicate, else TIMESHEET_NOT_FOUND', async () => {
    const { service, db } = await build({
      sheetViewers: { [S_FOREIGN]: [WS_ADMIN] },
    });
    await expect(
      service.assertViewTimesheet(MEMBER, S_OPEN),
    ).resolves.toMatchObject({
      id: S_OPEN,
    });
    expect(db.rpc).not.toHaveBeenCalled();
    await expect(
      service.assertViewTimesheet(WS_ADMIN, S_FOREIGN),
    ).resolves.toMatchObject({
      id: S_FOREIGN,
    });
    const e = await caught(service.assertViewTimesheet(MEMBER, S_FOREIGN));
    expect(e.getStatus()).toBe(404);
    expect(code(e)).toBe('TIMESHEET_NOT_FOUND');
    const missing = await caught(
      service.assertViewTimesheet(MEMBER, uid(4041)),
    );
    expect(code(missing)).toBe('TIMESHEET_NOT_FOUND');
  });

  it('a DB failure is a 500 without the Postgres text', async () => {
    const { service } = await build({
      failTable: {
        table: 'time_entries',
        error: { code: 'XX000', message: 'relation "secret" exploded' },
      },
    });
    const error = await service
      .assertViewEntry(MEMBER, E_WS)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(500);
    expect(
      JSON.stringify((error as HttpException).getResponse()),
    ).not.toContain('secret');
  });
});

// ── predicates ──────────────────────────────────────────────────────────────
describe('predicates', () => {
  it('canViewTimesheet / canDecide / canManageWorkspace call their RPCs', async () => {
    const { service, db } = await build({
      sheetViewers: { [S_OPEN]: [OUTSIDER] },
    });
    expect(await service.canViewTimesheet(OUTSIDER, S_OPEN)).toBe(true);
    expect(await service.canDecide(OUTSIDER, S_OPEN)).toBe(false);
    expect(await service.canManageWorkspace(WS_BIZ, WS_ADMIN)).toBe(true);
    expect(db.rpc).toHaveBeenCalledWith('can_view_timesheet', {
      p_timesheet_id: S_OPEN,
      p_user_id: OUTSIDER,
    });
    expect(db.rpc).toHaveBeenCalledWith('can_decide_timesheet', {
      p_timesheet_id: S_OPEN,
      p_user_id: OUTSIDER,
    });
    expect(db.rpc).toHaveBeenCalledWith('can_manage_workspace', {
      p_workspace_id: WS_BIZ,
      p_user_id: WS_ADMIN,
    });
  });

  it('isTeamManager is the shared team-authority predicate', async () => {
    const { service } = await build();
    expect(await service.isTeamManager(T_RATES, MANAGER)).toBe(true);
    expect(await service.isTeamManager(T_RATES, OUTSIDER)).toBe(false);
  });

  it('approversFor reads time_timesheet_deciders (flat or row-shaped)', async () => {
    const flat = await build({ deciders: [MANAGER, WS_ADMIN] });
    expect(await flat.service.approversFor(S_OPEN)).toEqual([
      MANAGER,
      WS_ADMIN,
    ]);
    expect(flat.db.rpc).toHaveBeenCalledWith('time_timesheet_deciders', {
      p_timesheet_id: S_OPEN,
    });
    const rows = await build({
      deciders: [{ time_timesheet_deciders: MANAGER }],
    });
    expect(await rows.service.approversFor(S_OPEN)).toEqual([MANAGER]);
  });
});

// ── clientHoursLevel ────────────────────────────────────────────────────────
describe('clientHoursLevel', () => {
  const view = (o: {
    position?: string;
    link?: string | null;
    level?: string | null;
  }) => ({
    viewer_position: o.position ?? 'hirer',
    project_links:
      o.link === null ? [] : [{ project_id: P1, status: o.link ?? 'active' }],
    current_settings:
      o.level === null
        ? null
        : { client_hours_detail_level: o.level ?? 'detailed' },
  });

  it('least(...) over active client hirer seats linked to the project', async () => {
    const { service, engagements } = await build({
      engagementViews: [
        view({ level: 'detailed' }),
        view({ level: 'summary' }),
      ],
    });
    expect(await service.clientHoursLevel(CLIENT_HIRER, P1)).toBe('summary');
    expect(engagements.list).toHaveBeenCalledWith(CLIENT_HIRER, {
      kind: 'client_services',
      status: 'active',
      project_id: P1,
    });
  });

  it('none without a seat; legacy (no settings) is none', async () => {
    expect(
      await (await build()).service.clientHoursLevel(CLIENT_HIRER, P1),
    ).toBe('none');
    const legacy = await build({
      engagementViews: [view({ level: null }), view({ level: 'detailed' })],
    });
    expect(await legacy.service.clientHoursLevel(CLIENT_HIRER, P1)).toBe(
      'none',
    );
  });

  it('ignores provider seats and inactive links', async () => {
    const { service } = await build({
      engagementViews: [
        view({ position: 'provider', level: 'detailed' }),
        view({ link: 'ended', level: 'summary' }),
        view({ level: 'detailed' }),
      ],
    });
    expect(await service.clientHoursLevel(CLIENT_HIRER, P1)).toBe('detailed');
  });

  it('a lookup failure fails closed to none', async () => {
    const { service } = await build({ engagementViews: new Error('boom') });
    expect(await service.clientHoursLevel(CLIENT_HIRER, P1)).toBe('none');
  });
});

// ── maskedWorkerIds ─────────────────────────────────────────────────────────
describe('maskedWorkerIds', () => {
  it('the client hirer sees every assignment worker masked', async () => {
    const { service } = await build();
    expect(
      [...(await service.maskedWorkerIds(P1, CLIENT_HIRER))].sort(),
    ).toEqual([MEMBER, CONSULTANT].sort());
  });

  it('a provider-side party names their own workers only', async () => {
    const { service } = await build();
    expect([...(await service.maskedWorkerIds(P1, TALENT_HIRER))]).toEqual([
      CONSULTANT,
    ]);
    expect([...(await service.maskedWorkerIds(P1, CLIENT_PROVIDER))]).toEqual([
      CONSULTANT,
    ]);
  });

  it('never masks the viewer themself', async () => {
    const { service } = await build();
    expect([...(await service.maskedWorkerIds(P1, MEMBER))]).toEqual([
      CONSULTANT,
    ]);
    expect([...(await service.maskedWorkerIds(P1, CONSULTANT))]).toEqual([
      MEMBER,
    ]);
  });

  it('a project without assignments masks nobody', async () => {
    const { service } = await build();
    expect((await service.maskedWorkerIds(P3, CLIENT_HIRER)).size).toBe(0);
  });
});
