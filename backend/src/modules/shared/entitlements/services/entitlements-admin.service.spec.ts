/* eslint-disable @typescript-eslint/unbound-method --
 * The entitlements double is a jest.Mocked object; passing its members to
 * expect() is an identity check on the mock, never a call, so `this` scoping
 * is irrelevant.
 */
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  allowAllEntitlements,
  buildSeedKeyRows,
  buildSeedLimitRows,
  SEED_UPDATED_AT,
} from '../__entitlements-test-kit-spec';
import type {
  AdminWorkspacesQueryDto,
  PlanLimitChangeDto,
  UpdatePlanLimitsDto,
} from '../dto/entitlements.dto';
import type { CompPlan, WorkspacePlanState } from '../entitlement-keys';
import { buildMatrix } from '../entitlements.logic';
import {
  EntitlementsAdminQueryError,
  type AdminWorkspaceHeader,
  type AdminWorkspaceListRow,
} from '../repositories/entitlements-admin.repository.interface';
import type { PlanLimitRow } from '../repositories/entitlements.repository.interface';
import {
  EntitlementsAdminService,
  escapeLikePattern,
  mapAdminRpcError,
} from './entitlements-admin.service';

const ACTOR = 'admin-1';
const WS = '11111111-1111-4111-8111-111111111111';

function listRow(
  overrides: Partial<AdminWorkspaceListRow> = {},
): AdminWorkspaceListRow {
  return {
    id: WS,
    name: 'Acme',
    slug: 'acme',
    created_at: '2026-09-01T00:00:00.000Z',
    owner_id: 'owner-1',
    owner_email: 'owner@acme.test',
    members: 3,
    pending_invites: 1,
    projects: 1,
    teams: 1,
    subscription_plan: 'free',
    subscription_status: null,
    has_provider_subscription: false,
    is_discounted_free: false,
    discounted_plan: null,
    discounted_at: null,
    discounted_until: null,
    effective_plan: 'free',
    plan_source: 'default',
    total_count: 1,
    ...overrides,
  };
}

function header(): AdminWorkspaceHeader {
  return {
    id: WS,
    name: 'Acme',
    slug: 'acme',
    created_at: '2026-09-01T00:00:00.000Z',
    owner_id: 'owner-1',
    owner_email: 'owner@acme.test',
  };
}

function planState(
  overrides: Partial<WorkspacePlanState> & {
    comp?: { plan: CompPlan; active?: boolean } | null;
  } = {},
): WorkspacePlanState {
  const { comp, ...rest } = overrides;
  return {
    workspace_id: WS,
    workspace_name: 'Acme',
    workspace_slug: 'acme',
    effective_plan: 'free',
    plan_source: 'default',
    subscription_plan: 'free',
    subscription_status: null,
    has_provider_subscription: false,
    complimentary: comp
      ? {
          plan: comp.plan,
          since: '2026-09-02T00:00:00.000Z',
          until: null,
          active: comp.active ?? true,
        }
      : null,
    ...rest,
  };
}

function buildDeps(options: { limitRows?: PlanLimitRow[] } = {}) {
  let limitRows = options.limitRows ?? buildSeedLimitRows();
  const keyRows = buildSeedKeyRows();
  const limitsRepo = {
    listLimitKeys: jest.fn(() => Promise.resolve(keyRows)),
    listLimits: jest.fn(() => Promise.resolve(limitRows)),
    getPlanStates: jest.fn(),
    getUsageCounts: jest.fn(),
    getLargestRoadmaps: jest.fn(),
    resolveSubject: jest.fn(),
    countRoadmapNodes: jest.fn(),
    listMemberWorkspaceIds: jest.fn(),
  };
  const repo = {
    updatePlanLimits: jest.fn(
      (changes: Array<Record<string, unknown>>): Promise<number> => {
        // Behave like the SQL: rewrite the cells, stamp them.
        limitRows = limitRows.map((row) => {
          const change = changes.find(
            (c) => c.plan === row.plan && c.limit_key === row.limit_key,
          );
          return change
            ? ({
                ...row,
                ...change,
                updated_by: ACTOR,
                updated_at: '2026-09-22T13:00:00.000000+00:00',
              } as PlanLimitRow)
            : row;
        });
        return Promise.resolve(changes.length);
      },
    ),
    listWorkspaces: jest.fn<Promise<AdminWorkspaceListRow[]>, unknown[]>(() =>
      Promise.resolve([listRow()]),
    ),
    findWorkspaceHeader: jest.fn(() =>
      Promise.resolve<AdminWorkspaceHeader | null>(header()),
    ),
    listWorkspaceAudit: jest.fn(() => Promise.resolve([])),
    setWorkspaceComp: jest.fn<Promise<boolean>, unknown[]>(() =>
      Promise.resolve(true),
    ),
    clearWorkspaceComp: jest.fn<Promise<boolean>, unknown[]>(() =>
      Promise.resolve(true),
    ),
  };
  const entitlements = allowAllEntitlements();
  entitlements.getLimitMatrix.mockImplementation(() =>
    Promise.resolve(buildMatrix(keyRows, limitRows)),
  );
  entitlements.getUsageCounts.mockResolvedValue({
    members: 3,
    pending_invites: 1,
    projects: 1,
    teams: 1,
  });
  const service = new EntitlementsAdminService(
    repo as never,
    limitsRepo as never,
    entitlements,
  );
  return { service, repo, limitsRepo, entitlements };
}

function change(overrides: Partial<PlanLimitChangeDto>): PlanLimitChangeDto {
  return { plan: 'free', key: 'projects', ...overrides } as PlanLimitChangeDto;
}

function update(
  changes: PlanLimitChangeDto[],
  extra: Partial<UpdatePlanLimitsDto> = {},
): UpdatePlanLimitsDto {
  return { changes, ...extra } as UpdatePlanLimitsDto;
}

async function rejection(promise: Promise<unknown>) {
  return promise.then(
    () => {
      throw new Error('expected a rejection');
    },
    (error: unknown) => error,
  );
}

describe('EntitlementsAdminService — reading the limits', () => {
  it('returns every cell with who changed it and when, plus the registry floor', async () => {
    const { service } = buildDeps({
      limitRows: buildSeedLimitRows([
        { plan: 'free', limit_key: 'projects', updated_by: 'someone' },
      ]),
    });

    const limits = await service.getPlanLimits();

    expect(limits.plans).toEqual(['free', 'pro', 'business', 'enterprise']);
    expect(limits.cells.free.projects).toEqual({
      kind: 'count',
      value: 2,
      per_seat: false,
      display_label: null,
      updated_at: SEED_UPDATED_AT,
      updated_by: 'someone',
    });
    expect(limits.keys.find((k) => k.key === 'members')).toMatchObject({
      enforced: true,
      min: 1,
    });
    expect(limits.keys.find((k) => k.key === 'projects')?.min).toBeNull();
    expect(limits.version).toBe(SEED_UPDATED_AT);
    expect(limits.drift).toEqual({ missing_in_db: [], unknown_to_code: [] });
  });

  it('reads the tables directly, past the enforcement caches', async () => {
    const { service, limitsRepo, entitlements } = buildDeps();

    await service.getPlanLimits();

    expect(limitsRepo.listLimits).toHaveBeenCalled();
    expect(entitlements.getLimitMatrix).not.toHaveBeenCalled();
  });
});

describe('EntitlementsAdminService — saving limits', () => {
  it('sends full cells, filling omitted fields from the stored cell', async () => {
    const { service, repo } = buildDeps();

    await service.updatePlanLimits(
      update(
        [
          change({ key: 'projects', value: 3 }),
          change({
            plan: 'pro',
            key: 'ai_messages_monthly',
            display_label: 'Fair use',
          }),
          change({ plan: 'free', key: 'decisions', enabled: true }),
        ],
        { note: '  Launch promo  ', base_version: SEED_UPDATED_AT },
      ),
      ACTOR,
    );

    expect(repo.updatePlanLimits).toHaveBeenCalledWith(
      [
        {
          plan: 'free',
          limit_key: 'projects',
          int_value: 3,
          bool_value: null,
          per_seat: false,
          display_label: null,
        },
        {
          plan: 'pro',
          limit_key: 'ai_messages_monthly',
          int_value: 500,
          bool_value: null,
          per_seat: true,
          display_label: 'Fair use',
        },
        {
          plan: 'free',
          limit_key: 'decisions',
          int_value: null,
          bool_value: true,
          per_seat: false,
          display_label: null,
        },
      ],
      ACTOR,
      'Launch promo',
      SEED_UPDATED_AT,
    );
  });

  it('treats value null as unlimited and an empty label as none', async () => {
    const { service, repo } = buildDeps();

    await service.updatePlanLimits(
      update([change({ key: 'teams', value: null, display_label: '' })]),
      ACTOR,
    );

    expect(repo.updatePlanLimits.mock.calls[0][0][0]).toMatchObject({
      int_value: null,
      display_label: null,
    });
  });

  it('invalidates the limits caches after a save, and again shortly after', async () => {
    jest.useFakeTimers();
    try {
      const { service, entitlements } = buildDeps();

      await service.updatePlanLimits(update([change({ value: 3 })]), ACTOR);
      expect(entitlements.invalidateLimits).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(2_000);
      expect(entitlements.invalidateLimits).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('returns the saved matrix', async () => {
    const { service } = buildDeps();

    const result = await service.updatePlanLimits(
      update([change({ value: 3 })]),
      ACTOR,
    );

    expect(result.cells.free.projects).toMatchObject({
      value: 3,
      updated_by: ACTOR,
    });
    expect(result.warnings).toEqual([]);
  });

  it('warns, without blocking, when a cheaper plan becomes more generous', async () => {
    const { service, repo } = buildDeps();

    const result = await service.updatePlanLimits(
      update([
        change({ key: 'projects', value: 20 }),
        change({ plan: 'free', key: 'roles_permissions', enabled: true }),
        change({ plan: 'pro', key: 'teams', value: null }),
      ]),
      ACTOR,
    );

    expect(repo.updatePlanLimits).toHaveBeenCalled();
    expect(result.warnings).toEqual([
      'Free is more generous than Pro for Projects.',
      'Free is more generous than Pro for Roles and permissions.',
    ]);
  });

  it('does not compare a per-workspace quota with a per-seat one', async () => {
    const { service } = buildDeps();

    const result = await service.updatePlanLimits(
      update([change({ key: 'ai_messages_monthly', value: 1000 })]),
      ACTOR,
    );

    expect(result.warnings).toEqual([]);
  });

  it.each([
    [
      'a feature sent a value',
      change({ key: 'decisions', value: 1 }),
      'plan_limits_kind_mismatch',
    ],
    [
      'a count sent enabled',
      change({ key: 'projects', enabled: true }),
      'plan_limits_kind_mismatch',
    ],
    [
      'retention of zero days',
      change({ key: 'activity_retention_days', value: 0 }),
      'plan_limits_below_minimum',
    ],
    [
      'zero members',
      change({ key: 'members', value: 0 }),
      'plan_limits_below_minimum',
    ],
    [
      'per_seat on a count',
      change({ key: 'projects', per_seat: true }),
      'plan_limits_per_seat_invalid',
    ],
    [
      'per_seat on a feature',
      change({ key: 'decisions', per_seat: true }),
      'plan_limits_per_seat_invalid',
    ],
    [
      'an unknown key',
      change({ key: 'widgets', value: 3 }),
      'plan_limits_unknown_key',
    ],
    ['an empty change', change({}), 'plan_limits_empty_change'],
  ])('rejects %s with 400', async (_label, bad, code) => {
    const { service, repo } = buildDeps();

    const error = await rejection(
      service.updatePlanLimits(update([bad]), ACTOR),
    );

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toMatchObject({
      code,
    });
    expect(repo.updatePlanLimits).not.toHaveBeenCalled();
  });

  it('allows unlimited members and a per-seat quota', async () => {
    const { service, repo } = buildDeps();

    await service.updatePlanLimits(
      update([
        change({ key: 'members', value: null }),
        change({ key: 'ai_messages_monthly', per_seat: true }),
        change({ key: 'activity_retention_days', value: 1 }),
      ]),
      ACTOR,
    );

    expect(repo.updatePlanLimits).toHaveBeenCalled();
  });

  it('rejects the same cell twice', async () => {
    const { service } = buildDeps();

    const error = await rejection(
      service.updatePlanLimits(
        update([change({ value: 3 }), change({ value: 4 })]),
        ACTOR,
      ),
    );

    expect((error as BadRequestException).getResponse()).toMatchObject({
      code: 'plan_limits_duplicate_cell',
    });
  });

  it('rejects a cell the database is missing', async () => {
    const { service } = buildDeps({
      limitRows: buildSeedLimitRows().filter(
        (row) => !(row.plan === 'free' && row.limit_key === 'projects'),
      ),
    });

    const error = await rejection(
      service.updatePlanLimits(update([change({ value: 3 })]), ACTOR),
    );

    expect((error as BadRequestException).getResponse()).toMatchObject({
      code: 'plan_limits_unknown_cell',
    });
  });

  it('answers 409 plan_limits_stale when someone saved in between', async () => {
    const { service, repo, entitlements } = buildDeps();
    repo.updatePlanLimits.mockRejectedValue(
      new EntitlementsAdminQueryError('plan_limits_stale', 'P0001'),
    );

    const error = await rejection(
      service.updatePlanLimits(
        update([change({ value: 3 })], { base_version: SEED_UPDATED_AT }),
        ACTOR,
      ),
    );

    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({
      code: 'plan_limits_stale',
    });
    expect(entitlements.invalidateLimits).not.toHaveBeenCalled();
  });
});

describe('mapAdminRpcError', () => {
  it.each([
    ['plan_limits_stale', ConflictException],
    ['workspace_not_found', NotFoundException],
    ['plan_limits_unknown_cell', BadRequestException],
    ['plan_limits_duplicate_cell', BadRequestException],
    ['workspace_comp_invalid_plan', BadRequestException],
    ['admin_list_workspaces_invalid_filter', BadRequestException],
  ])('maps %s by its message text', (token, type) => {
    expect(
      mapAdminRpcError(new EntitlementsAdminQueryError(token, 'P0001')),
    ).toBeInstanceOf(type);
  });

  it('maps a CHECK violation to 400', () => {
    expect(
      mapAdminRpcError(
        new EntitlementsAdminQueryError(
          'new row violates check constraint "plan_limits_days_min"',
          '23514',
        ),
      ),
    ).toBeInstanceOf(BadRequestException);
  });

  it('passes anything else through', () => {
    const error = new Error('connection reset');
    expect(mapAdminRpcError(error)).toBe(error);
  });
});

describe('EntitlementsAdminService — workspace list', () => {
  it('escapes LIKE metacharacters in the search', async () => {
    const { service, repo } = buildDeps();

    await service.listWorkspaces({
      search: '  50%_off\\  ',
    } as AdminWorkspacesQueryDto);

    expect(repo.listWorkspaces).toHaveBeenCalledWith({
      search: '50\\%\\_off\\\\',
      filter: 'all',
      limit: 25,
      offset: 0,
    });
    expect(escapeLikePattern('a_b%c\\d')).toBe('a\\_b\\%c\\\\d');
  });

  it('pages with page and page_size, and passes the filter', async () => {
    const { service, repo } = buildDeps();
    repo.listWorkspaces.mockResolvedValue([listRow({ total_count: 42 })]);

    const result = await service.listWorkspaces({
      filter: 'comped',
      page: 3,
      page_size: 10,
    } as AdminWorkspacesQueryDto);

    expect(repo.listWorkspaces).toHaveBeenCalledWith({
      search: null,
      filter: 'comped',
      limit: 10,
      offset: 20,
    });
    expect(result).toMatchObject({ page: 3, page_size: 10, total: 42 });
  });

  it('still reports the total past the last page', async () => {
    const { service, repo } = buildDeps();
    repo.listWorkspaces
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([listRow({ total_count: 7 })]);

    const result = await service.listWorkspaces({
      page: 9,
    } as AdminWorkspacesQueryDto);

    expect(result).toMatchObject({ items: [], total: 7 });
  });

  it('shapes each row, flags counts over the plan limit, and reads comp activity off the row', async () => {
    const { service, repo } = buildDeps();
    repo.listWorkspaces.mockResolvedValue([
      listRow({ projects: 5, teams: 2 }),
      listRow({
        id: 'ws-2',
        is_discounted_free: true,
        discounted_plan: 'business',
        discounted_at: '2026-09-02T00:00:00.000Z',
        discounted_until: '2020-01-01T00:00:00.000Z',
      }),
    ]);

    const { items } = await service.listWorkspaces(
      {} as AdminWorkspacesQueryDto,
    );

    expect(items[0]).toEqual({
      id: WS,
      name: 'Acme',
      slug: 'acme',
      created_at: '2026-09-01T00:00:00.000Z',
      owner: { id: 'owner-1', email: 'owner@acme.test' },
      members: 3,
      pending_invites: 1,
      projects: 5,
      teams: 2,
      subscription: {
        plan: 'free',
        status: null,
        has_provider_subscription: false,
      },
      complimentary: null,
      effective_plan: 'free',
      plan_source: 'default',
      over_limit: ['projects'],
    });
    expect(items[1].complimentary).toEqual({
      plan: 'business',
      since: '2026-09-02T00:00:00.000Z',
      until: '2020-01-01T00:00:00.000Z',
      active: false,
    });
  });

  it('hides over-limit badges rather than failing when the matrix is unavailable', async () => {
    const { service, repo, entitlements } = buildDeps();
    repo.listWorkspaces.mockResolvedValue([listRow({ projects: 5 })]);
    entitlements.getLimitMatrix.mockRejectedValue(new Error('down'));

    const { items } = await service.listWorkspaces(
      {} as AdminWorkspacesQueryDto,
    );

    expect(items[0].over_limit).toEqual([]);
  });
});

describe('EntitlementsAdminService — workspace detail', () => {
  it('adds the largest roadmaps and the last 20 audit entries', async () => {
    const { service, repo, entitlements } = buildDeps();
    entitlements.getEffectivePlans.mockResolvedValue(
      new Map([
        [
          WS,
          planState({
            effective_plan: 'pro',
            plan_source: 'complimentary',
            comp: { plan: 'pro' },
          }),
        ],
      ]),
    );
    const roadmap = {
      roadmap_id: 'rm-1',
      name: 'Launch',
      project_id: 'p-1',
      project_title: 'Website',
      owner_id: 'owner-1',
      nodes: 240,
    };
    entitlements.getLargestRoadmaps.mockResolvedValue([roadmap]);

    const detail = await service.getWorkspace(WS);

    expect(repo.listWorkspaceAudit).toHaveBeenCalledWith(WS, 20);
    expect(entitlements.getLargestRoadmaps).toHaveBeenCalledWith(WS, 5);
    expect(detail).toMatchObject({
      id: WS,
      effective_plan: 'pro',
      plan_source: 'complimentary',
      complimentary: { plan: 'pro', active: true },
      largest_roadmaps: [roadmap],
      audit: [],
    });
  });

  it('404s an unknown workspace', async () => {
    const { service, repo } = buildDeps();
    repo.findWorkspaceHeader.mockResolvedValue(null);

    await expect(service.getWorkspace(WS)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('EntitlementsAdminService — complimentary plans', () => {
  it('grants a comp, invalidates the plan state, and returns the fresh row', async () => {
    const { service, repo, entitlements } = buildDeps();
    entitlements.getEffectivePlans.mockResolvedValue(
      new Map([
        [
          WS,
          planState({
            effective_plan: 'business',
            plan_source: 'complimentary',
            comp: { plan: 'business' },
          }),
        ],
      ]),
    );

    const result = await service.setComp(
      WS,
      { plan: 'business', until: null, note: ' Design partner ' },
      ACTOR,
    );

    expect(repo.setWorkspaceComp).toHaveBeenCalledWith(
      WS,
      'business',
      null,
      'Design partner',
      ACTOR,
    );
    expect(entitlements.invalidateWorkspace).toHaveBeenCalledWith(WS);
    expect(result.workspace).toMatchObject({
      effective_plan: 'business',
      complimentary: { plan: 'business', active: true },
    });
    expect(result.warnings).toEqual([]);
  });

  it('normalizes a future end date to ISO', async () => {
    const { service, repo } = buildDeps();
    const until = new Date(Date.now() + 86_400_000);

    await service.setComp(
      WS,
      { plan: 'pro', until: until.toISOString(), note: 'Trial' },
      ACTOR,
    );

    expect(repo.setWorkspaceComp.mock.calls[0][2]).toBe(until.toISOString());
  });

  it('rejects an end date that is not in the future', async () => {
    const { service, repo } = buildDeps();

    const error = await rejection(
      service.setComp(
        WS,
        {
          plan: 'pro',
          until: new Date(Date.now() - 1_000).toISOString(),
          note: 'x',
        },
        ACTOR,
      ),
    );

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as BadRequestException).getResponse()).toMatchObject({
      code: 'workspace_comp_until_past',
    });
    expect(repo.setWorkspaceComp).not.toHaveBeenCalled();
  });

  it('warns when the workspace also has a live subscription', async () => {
    const { service, entitlements } = buildDeps();
    entitlements.getEffectivePlans.mockResolvedValue(
      new Map([
        [
          WS,
          planState({
            effective_plan: 'business',
            plan_source: 'subscription',
            subscription_plan: 'business',
            subscription_status: 'active',
            has_provider_subscription: true,
            comp: { plan: 'pro' },
          }),
        ],
      ]),
    );

    const result = await service.setComp(
      WS,
      { plan: 'pro', note: 'Partner' },
      ACTOR,
    );

    expect(result.warnings).toEqual(['workspace_has_live_subscription']);
  });

  it('does not warn about a canceled subscription', async () => {
    const { service, entitlements } = buildDeps();
    entitlements.getEffectivePlans.mockResolvedValue(
      new Map([
        [
          WS,
          planState({
            subscription_plan: 'pro',
            subscription_status: 'canceled',
            has_provider_subscription: false,
            comp: { plan: 'pro' },
          }),
        ],
      ]),
    );

    const result = await service.setComp(
      WS,
      { plan: 'pro', note: 'Partner' },
      ACTOR,
    );

    expect(result.warnings).toEqual([]);
  });

  it('404s a comp for an unknown workspace', async () => {
    const { service, repo } = buildDeps();
    repo.setWorkspaceComp.mockRejectedValue(
      new EntitlementsAdminQueryError('workspace_not_found', 'P0001'),
    );

    await expect(
      service.setComp(WS, { plan: 'pro', note: 'x' }, ACTOR),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('clears a comp idempotently: a second clear still answers with the row', async () => {
    const { service, repo, entitlements } = buildDeps();
    repo.clearWorkspaceComp
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    const first = await service.clearComp(WS, ' Ended ', ACTOR);
    const second = await service.clearComp(WS, undefined, ACTOR);

    expect(repo.clearWorkspaceComp).toHaveBeenNthCalledWith(
      1,
      WS,
      'Ended',
      ACTOR,
    );
    expect(repo.clearWorkspaceComp).toHaveBeenNthCalledWith(2, WS, null, ACTOR);
    expect(first.workspace.complimentary).toBeNull();
    expect(second.workspace.id).toBe(WS);
    expect(entitlements.invalidateWorkspace).toHaveBeenCalledWith(WS);
  });
});
