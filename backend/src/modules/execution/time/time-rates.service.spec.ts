import { Test } from '@nestjs/testing';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../config/supabase.module';
import {
  type AssignmentContext,
  type EngagementTimeRateRow,
  EngagementsService,
} from '../../marketplace/engagements/engagements.service';
import { EntitlementsService } from '../../shared/entitlements/entitlements.service';
import { TimePolicyService } from './time-policy.service';
import { TimeRatesService } from './time-rates.service';
import type { LoggingOption, RateType, WorkType } from './time.types';

// ── In-memory PostgREST stand-in (eq filters, order, limit, maybeSingle) ─────────────────────────────────────

type Row = Record<string, unknown>;

interface World {
  teams: Row[];
  team_member_rates: Row[];
  projects: Row[];
  timesheet_events: Row[];
}

function fakeDb(world: World) {
  const reads: string[] = [];
  const from = jest.fn((table: keyof World) => {
    const filters: Array<[string, unknown]> = [];
    let orderBy: { col: string; asc: boolean } | null = null;
    let limitN: number | null = null;
    const exec = () => {
      reads.push(table);
      let rows = world[table].filter((row) =>
        filters.every(([col, value]) => (row[col] ?? null) === value),
      );
      if (orderBy) {
        const { col, asc } = orderBy;
        rows = [...rows].sort((a, b) => {
          const av = String(a[col]);
          const bv = String(b[col]);
          if (av === bv) return 0;
          return (av < bv ? -1 : 1) * (asc ? 1 : -1);
        });
      }
      if (limitN !== null) rows = rows.slice(0, limitN);
      return { data: rows.map((row) => ({ ...row })), error: null };
    };
    const chain = {
      select: () => chain,
      eq: (col: string, value: unknown) => {
        filters.push([col, value]);
        return chain;
      },
      order: (col: string, o?: { ascending?: boolean }) => {
        orderBy = { col, asc: o?.ascending !== false };
        return chain;
      },
      limit: (n: number) => {
        limitN = n;
        return chain;
      },
      maybeSingle: () => {
        const res = exec();
        return Promise.resolve({ data: res.data[0] ?? null, error: null });
      },
      then: (
        resolve: (v: unknown) => unknown,
        reject?: (e: unknown) => unknown,
      ) => Promise.resolve(exec()).then(resolve, reject),
    };
    return chain;
  });
  return { client: { from } as unknown as SupabaseClient, from, reads };
}

// ── Fixtures ───────────────────────────────────────────────────────────────────────────────────────────────

const WS = 'ws-1';
const TEAM = 'team-1';
const MEMBER = 'u-member';
const PROJECT = 'proj-1';
const TALENT_ENG = 'eng-talent';
const CLIENT_ENG = 'eng-client';
const ASSIGNMENT = 'asg-1';
const CUTOFF = '2026-10-06T00:00:00.000Z';

function world(over: Partial<World> = {}): World {
  return {
    teams: [
      {
        id: TEAM,
        workspace_id: WS,
        member_rates_enabled: true,
        default_currency: 'PHP',
      },
      {
        id: 'team-eur',
        workspace_id: WS,
        member_rates_enabled: false,
        default_currency: 'EUR',
      },
    ],
    team_member_rates: [],
    projects: [
      { id: PROJECT, currency: 'SGD' },
      { id: 'proj-nocurrency', currency: null },
    ],
    timesheet_events: [],
    ...over,
  };
}

function tmr(over: Row): Row {
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

function engRate(over: Partial<EngagementTimeRateRow>): EngagementTimeRateRow {
  return {
    id: 'er-1',
    engagement_id: TALENT_ENG,
    source_contract_id: null,
    worker_user_id: null,
    rate_kind: 'cost',
    unit: 'hour',
    work_type: null,
    amount: 300,
    currency: 'USD',
    effective_from: '2026-01-01',
    effective_until: null,
    ...over,
  };
}

function assignment(over: Partial<AssignmentContext> = {}): AssignmentContext {
  return {
    id: ASSIGNMENT,
    project_id: PROJECT,
    worker_user_id: MEMBER,
    talent_engagement_id: TALENT_ENG,
    client_engagement_id: CLIENT_ENG,
    governing_engagement_id: TALENT_ENG,
    governing_kind: 'talent_services',
    governing_status: 'active',
    team_id: null,
    role_title: null,
    status: 'active',
    started_at: '2026-01-01T00:00:00.000Z',
    ended_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    hirer_label: 'Pixel',
    ...over,
  };
}

const teamOption: LoggingOption = {
  kind: 'team',
  id: TEAM,
  label: 'Design',
  sheet_scope: { kind: 'team', ref: TEAM },
  rate_source: 'team_member_rates',
  workspace_tag: null,
  approver_hint: 'team',
};

const assignmentOption: LoggingOption = {
  kind: 'assignment',
  id: ASSIGNMENT,
  label: 'Pixel',
  sheet_scope: { kind: 'engagement', ref: TALENT_ENG },
  rate_source: 'engagement_cost',
  workspace_tag: null,
  approver_hint: 'hirer',
};

async function build(w: World) {
  const db = fakeDb(w);
  const policy = {
    planRefForTeam: jest.fn((team: { workspace_id: string | null }) =>
      Promise.resolve(
        team.workspace_id ?? { workspaceId: null, exempt: false },
      ),
    ),
    resolve: jest.fn().mockResolvedValue({ timezone: 'Asia/Manila' }),
    workspaceTimezone: jest.fn().mockResolvedValue('UTC'),
    teamTimezone: jest.fn().mockResolvedValue('UTC'),
  };
  // ratesFor narrows a mixed table by kind and worker, as the real reader does.
  let engagementRates: EngagementTimeRateRow[] = [];
  const engagements = {
    getAssignment: jest.fn().mockResolvedValue(assignment()),
    policyWorkspaceFor: jest.fn().mockResolvedValue(WS),
    ratesFor: jest.fn(
      (
        engagementId: string,
        o: { rateKind: 'cost' | 'billing'; workerId?: string | null },
      ) =>
        Promise.resolve(
          engagementRates.filter(
            (r) =>
              r.engagement_id === engagementId &&
              r.rate_kind === o.rateKind &&
              (r.worker_user_id === null ||
                r.worker_user_id === (o.workerId ?? null)),
          ),
        ),
    ),
  };
  const entitlements = { hasFeature: jest.fn().mockResolvedValue(true) };
  const moduleRef = await Test.createTestingModule({
    providers: [
      TimeRatesService,
      { provide: SUPABASE_ADMIN, useValue: db.client },
      { provide: EngagementsService, useValue: engagements },
      { provide: EntitlementsService, useValue: entitlements },
      { provide: TimePolicyService, useValue: policy },
    ],
  }).compile();
  return {
    service: moduleRef.get(TimeRatesService),
    db,
    policy,
    engagements,
    entitlements,
    setEngagementRates: (rows: EngagementTimeRateRow[]) => {
      engagementRates = rows;
    },
  };
}

function entry(
  over: Partial<{
    context_kind: 'team' | 'assignment' | 'workspace' | 'personal';
    context_ref: string | null;
    team_id: string | null;
    engagement_assignment_id: string | null;
    project_id: string | null;
    work_type_snapshot: WorkType;
    created_at: string;
    rate_snapshot: number;
    rate_type_snapshot: RateType;
    currency_snapshot: string;
  }> = {},
) {
  return {
    context_kind: 'team' as const,
    context_ref: TEAM,
    team_id: TEAM,
    engagement_assignment_id: null,
    member_user_id: MEMBER,
    project_id: PROJECT,
    work_type_snapshot: 'real_work' as WorkType,
    created_at: '2026-10-07T01:00:00.000Z',
    rate_snapshot: 42,
    rate_type_snapshot: 'hourly' as RateType,
    currency_snapshot: 'JPY',
    ...over,
  };
}

const AT = new Date('2026-10-04T16:30:00.000Z'); // 2026-10-05 00:30 in Manila

// ── estimate ───────────────────────────────────────────────────────────────────────────────────────────────

describe('TimeRatesService.estimate — team', () => {
  const twoVersions = () =>
    world({
      team_member_rates: [
        tmr({
          id: 'r-old',
          start_date: '2026-09-01',
          end_date: '2026-10-04',
          hourly_rate: 400,
        }),
        tmr({ id: 'r-new', start_date: '2026-10-05', hourly_rate: '500' }),
      ],
    });

  it('uses the team_member_rates row in force on the local date of the sheet timezone (E43)', async () => {
    const t = await build(twoVersions());
    const estimate = await t.service.estimate(
      teamOption,
      MEMBER,
      PROJECT,
      'real_work',
      AT,
    );
    expect(estimate).toEqual({
      rate_snapshot: 500,
      rate_type_snapshot: 'hourly',
      currency_snapshot: 'PHP',
    });
    expect(t.policy.resolve).toHaveBeenCalledWith(
      { kind: 'team', ref: TEAM },
      WS,
      AT,
    );
  });

  it('takes the training rate for training work', async () => {
    const t = await build(twoVersions());
    const estimate = await t.service.estimate(
      teamOption,
      MEMBER,
      PROJECT,
      'training',
      AT,
    );
    expect(estimate.rate_snapshot).toBe(100);
  });

  it("snapshots a fixed rate card as 'fixed'", async () => {
    const t = await build(
      world({ team_member_rates: [tmr({ rate_type: 'fixed' })] }),
    );
    const estimate = await t.service.estimate(
      teamOption,
      MEMBER,
      PROJECT,
      'real_work',
      AT,
    );
    expect(estimate.rate_type_snapshot).toBe('fixed');
  });

  it('is 0 in the team currency while member rates are off, without reading rates', async () => {
    const w = twoVersions();
    w.teams[0].member_rates_enabled = false;
    const t = await build(w);
    const estimate = await t.service.estimate(
      teamOption,
      MEMBER,
      PROJECT,
      'real_work',
      AT,
    );
    expect(estimate).toEqual({
      rate_snapshot: 0,
      rate_type_snapshot: 'hourly',
      currency_snapshot: 'PHP',
    });
    expect(t.db.reads).not.toContain('team_member_rates');
  });

  it("is 0 when the team's plan subject lacks time_team_rules", async () => {
    const t = await build(twoVersions());
    t.entitlements.hasFeature.mockResolvedValue(false);
    const estimate = await t.service.estimate(
      teamOption,
      MEMBER,
      PROJECT,
      'real_work',
      AT,
    );
    expect(estimate.rate_snapshot).toBe(0);
    expect(t.entitlements.hasFeature).toHaveBeenCalledWith(
      WS,
      'time_team_rules',
    );
    expect(t.policy.planRefForTeam).toHaveBeenCalledWith(
      expect.objectContaining({ id: TEAM }),
    );
  });

  it('is 0 in the team currency when no row is in force', async () => {
    const t = await build(
      world({ team_member_rates: [tmr({ end_date: '2026-09-30' })] }),
    );
    const estimate = await t.service.estimate(
      teamOption,
      MEMBER,
      PROJECT,
      'real_work',
      AT,
    );
    expect(estimate).toEqual({
      rate_snapshot: 0,
      rate_type_snapshot: 'hourly',
      currency_snapshot: 'PHP',
    });
  });

  it('dates a workspace-scope team option in the workspace timezone', async () => {
    const t = await build(twoVersions());
    t.policy.workspaceTimezone.mockResolvedValue('UTC');
    const estimate = await t.service.estimate(
      { ...teamOption, sheet_scope: { kind: 'workspace', ref: WS } },
      MEMBER,
      PROJECT,
      'real_work',
      AT,
    );
    // 16:30Z on Oct 4 is still Oct 4 in UTC: the old row.
    expect(estimate.rate_snapshot).toBe(400);
    expect(t.policy.workspaceTimezone).toHaveBeenCalledWith(WS);
    expect(t.policy.resolve).not.toHaveBeenCalled();
  });
});

describe('TimeRatesService.estimate — assignment, workspace, personal', () => {
  it("uses the talent engagement's cost rate (never billing), work_type before NULL", async () => {
    const t = await build(world());
    t.setEngagementRates([
      engRate({ id: 'cost-any', amount: 300 }),
      engRate({ id: 'cost-training', work_type: 'training', amount: 150 }),
      engRate({ id: 'billing', rate_kind: 'billing', amount: 900 }),
    ]);
    const realWork = await t.service.estimate(
      assignmentOption,
      MEMBER,
      PROJECT,
      'real_work',
      AT,
    );
    const training = await t.service.estimate(
      assignmentOption,
      MEMBER,
      PROJECT,
      'training',
      AT,
    );
    expect(realWork).toEqual({
      rate_snapshot: 300,
      rate_type_snapshot: 'hourly',
      currency_snapshot: 'USD',
    });
    expect(training.rate_snapshot).toBe(150);
    expect(t.engagements.ratesFor).toHaveBeenCalledWith(TALENT_ENG, {
      rateKind: 'cost',
      workerId: MEMBER,
    });
    expect(t.engagements.policyWorkspaceFor).toHaveBeenCalledWith(TALENT_ENG);
  });

  it("is 0 for a client-only assignment; currency falls to the assignment team's default", async () => {
    const t = await build(world());
    t.engagements.getAssignment.mockResolvedValue(
      assignment({
        talent_engagement_id: null,
        governing_engagement_id: CLIENT_ENG,
        governing_kind: 'client_services',
        team_id: 'team-eur',
      }),
    );
    const estimate = await t.service.estimate(
      {
        ...assignmentOption,
        sheet_scope: { kind: 'engagement', ref: CLIENT_ENG },
      },
      MEMBER,
      PROJECT,
      'real_work',
      AT,
    );
    expect(estimate).toEqual({
      rate_snapshot: 0,
      rate_type_snapshot: 'hourly',
      currency_snapshot: 'EUR',
    });
    expect(t.engagements.ratesFor).not.toHaveBeenCalled();
  });

  it('fills a rate row without a currency from the project, then USD', async () => {
    const t = await build(world());
    t.setEngagementRates([engRate({ currency: null })]);
    const fromProject = await t.service.estimate(
      assignmentOption,
      MEMBER,
      PROJECT,
      'real_work',
      AT,
    );
    expect(fromProject.currency_snapshot).toBe('SGD');
    const fallback = await t.service.estimate(
      assignmentOption,
      MEMBER,
      'proj-nocurrency',
      'real_work',
      AT,
    );
    expect(fallback.currency_snapshot).toBe('USD');
  });

  it('is 0 in the project currency for workspace and personal options', async () => {
    const t = await build(world());
    const workspace = await t.service.estimate(
      {
        kind: 'workspace',
        id: WS,
        label: 'Acme',
        sheet_scope: { kind: 'workspace', ref: WS },
        rate_source: 'none',
        workspace_tag: null,
        approver_hint: 'workspace',
      },
      MEMBER,
      PROJECT,
      'real_work',
      AT,
    );
    const personal = await t.service.estimate(
      {
        kind: 'personal',
        id: null,
        label: 'Just me',
        sheet_scope: null,
        rate_source: 'none',
        workspace_tag: null,
        approver_hint: null,
      },
      MEMBER,
      'proj-missing',
      'real_work',
      AT,
    );
    expect(workspace).toEqual({
      rate_snapshot: 0,
      rate_type_snapshot: 'hourly',
      currency_snapshot: 'SGD',
    });
    expect(personal.currency_snapshot).toBe('USD');
    expect(t.db.reads).not.toContain('team_member_rates');
  });
});

// ── freezeRate ─────────────────────────────────────────────────────────────────────────────────────────────

describe('TimeRatesService.freezeRate', () => {
  it('keeps the stored snapshot for a legacy entry (D13)', async () => {
    const t = await build(world());
    const legacy = entry({ created_at: '2026-10-01T00:00:00.000Z' });
    await expect(
      t.service.freezeRate(legacy, '2026-10-01', CUTOFF),
    ).resolves.toEqual({
      rate: 42,
      rateType: 'hourly',
      currency: 'JPY',
      amountable: true,
    });
    await expect(
      t.service.freezeRate(
        { ...legacy, rate_type_snapshot: 'fixed' },
        '2026-10-01',
        CUTOFF,
      ),
    ).resolves.toEqual(
      expect.objectContaining({ rateType: 'fixed', amountable: false }),
    );
    expect(t.db.reads).toEqual([]);
  });

  it('re-resolves the team row in force on the local date d', async () => {
    const t = await build(
      world({
        team_member_rates: [
          tmr({ id: 'old', end_date: '2026-10-04', hourly_rate: 400 }),
          tmr({ id: 'new', start_date: '2026-10-05', hourly_rate: 500 }),
        ],
      }),
    );
    await expect(
      t.service.freezeRate(entry(), '2026-10-04', CUTOFF),
    ).resolves.toEqual({
      rate: 400,
      rateType: 'hourly',
      currency: 'PHP',
      amountable: true,
    });
    await expect(
      t.service.freezeRate(entry(), '2026-10-05', null),
    ).resolves.toEqual(expect.objectContaining({ rate: 500 }));
  });

  it('freezes a fixed team rate card as fixed, not amountable', async () => {
    const t = await build(
      world({ team_member_rates: [tmr({ rate_type: 'fixed' })] }),
    );
    await expect(
      t.service.freezeRate(entry(), '2026-10-07', CUTOFF),
    ).resolves.toEqual({
      rate: 500,
      rateType: 'fixed',
      currency: 'PHP',
      amountable: false,
    });
  });

  it('is 0 without member rates or time_team_rules', async () => {
    const w = world({ team_member_rates: [tmr({})] });
    w.teams[0].member_rates_enabled = false;
    const off = await build(w);
    await expect(
      off.service.freezeRate(entry(), '2026-10-07', CUTOFF),
    ).resolves.toEqual(expect.objectContaining({ rate: 0, amountable: true }));

    const noRules = await build(world({ team_member_rates: [tmr({})] }));
    noRules.entitlements.hasFeature.mockResolvedValue(false);
    await expect(
      noRules.service.freezeRate(entry(), '2026-10-07', CUTOFF),
    ).resolves.toEqual(expect.objectContaining({ rate: 0 }));
  });

  it('is 0 for a deleted team', async () => {
    const t = await build(world());
    await expect(
      t.service.freezeRate(
        entry({ team_id: null, context_ref: 'team-gone' }),
        '2026-10-07',
        CUTOFF,
      ),
    ).resolves.toEqual({
      rate: 0,
      rateType: 'hourly',
      currency: 'JPY',
      amountable: true,
    });
  });

  it('assignment: an hourly cost rate is amountable; a month or fixed unit is not', async () => {
    const t = await build(world());
    const assignmentEntry = entry({
      context_kind: 'assignment',
      context_ref: ASSIGNMENT,
      team_id: null,
      engagement_assignment_id: ASSIGNMENT,
      work_type_snapshot: 'training',
    });
    t.setEngagementRates([
      engRate({ id: 'null-wt', amount: 300 }),
      engRate({ id: 'training', work_type: 'training', amount: 120 }),
    ]);
    await expect(
      t.service.freezeRate(assignmentEntry, '2026-10-07', CUTOFF),
    ).resolves.toEqual({
      rate: 120,
      rateType: 'hourly',
      currency: 'USD',
      amountable: true,
    });
    expect(t.engagements.ratesFor).toHaveBeenCalledWith(TALENT_ENG, {
      rateKind: 'cost',
      workerId: MEMBER,
    });

    t.setEngagementRates([engRate({ unit: 'month', amount: 80000 })]);
    await expect(
      t.service.freezeRate(assignmentEntry, '2026-10-07', CUTOFF),
    ).resolves.toEqual({
      rate: 80000,
      rateType: 'fixed',
      currency: 'USD',
      amountable: false,
    });
  });

  it('assignment: a client-only governing engagement freezes at 0, not amountable (L3)', async () => {
    const t = await build(world());
    t.engagements.getAssignment.mockResolvedValue(
      assignment({ talent_engagement_id: null }),
    );
    await expect(
      t.service.freezeRate(
        entry({
          context_kind: 'assignment',
          context_ref: ASSIGNMENT,
          team_id: null,
          engagement_assignment_id: ASSIGNMENT,
        }),
        '2026-10-07',
        CUTOFF,
      ),
    ).resolves.toEqual({
      rate: 0,
      rateType: 'hourly',
      currency: 'JPY',
      amountable: false,
    });
  });

  it('workspace time freezes at 0 in its stored currency', async () => {
    const t = await build(world());
    await expect(
      t.service.freezeRate(
        entry({ context_kind: 'workspace', context_ref: WS, team_id: null }),
        '2026-10-07',
        CUTOFF,
      ),
    ).resolves.toEqual({
      rate: 0,
      rateType: 'hourly',
      currency: 'JPY',
      amountable: true,
    });
    expect(t.db.reads).toEqual([]);
  });
});

// ── memberCaps and legacyCutoff ────────────────────────────────────────────────────────────────────────────

describe('TimeRatesService.memberCaps', () => {
  it('reads the caps of the row in force on d, else null', async () => {
    const t = await build(
      world({
        team_member_rates: [
          tmr({
            start_date: '2026-10-01',
            weekly_limit_hours: '40',
            monthly_limit_hours: null,
            overtime_requires_approval: true,
          }),
        ],
      }),
    );
    await expect(
      t.service.memberCaps(TEAM, MEMBER, PROJECT, '2026-10-05'),
    ).resolves.toEqual({
      weekly_limit_hours: 40,
      monthly_limit_hours: null,
      overtime_requires_approval: true,
    });
    await expect(
      t.service.memberCaps(TEAM, MEMBER, PROJECT, '2026-09-30'),
    ).resolves.toBeNull();
    await expect(
      t.service.memberCaps(TEAM, MEMBER, null, '2026-10-05'),
    ).resolves.toBeNull();
  });
});

describe('TimeRatesService.legacyCutoff', () => {
  it('answers the earliest legacy_import and caches it for the process', async () => {
    const t = await build(
      world({
        timesheet_events: [
          { event: 'submitted', created_at: '2026-10-01T00:00:00.000Z' },
          { event: 'legacy_import', created_at: '2026-10-06T08:00:00.000Z' },
          { event: 'legacy_import', created_at: '2026-10-06T07:00:00.000Z' },
        ],
      }),
    );
    await expect(t.service.legacyCutoff()).resolves.toBe(
      '2026-10-06T07:00:00.000Z',
    );
    await expect(t.service.legacyCutoff()).resolves.toBe(
      '2026-10-06T07:00:00.000Z',
    );
    expect(t.db.reads.filter((r) => r === 'timesheet_events')).toHaveLength(1);
  });

  it('does not cache "no import yet"', async () => {
    const w = world();
    const t = await build(w);
    await expect(t.service.legacyCutoff()).resolves.toBeNull();
    w.timesheet_events.push({
      event: 'legacy_import',
      created_at: '2026-10-06T07:00:00.000Z',
    });
    await expect(t.service.legacyCutoff()).resolves.toBe(
      '2026-10-06T07:00:00.000Z',
    );
  });
});
