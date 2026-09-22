import { ENTITLEMENT_KEYS } from './entitlement-keys';
import {
  buildCountLimitPayload,
  buildFeatureLimitPayload,
  buildMatrix,
  buildPlanLimitMessage,
  computeUpgradePlan,
  featureAvailableOn,
  featureEnabled,
  isLimitMatrix,
  meterState,
  numericLimit,
  overLimitKeys,
  toPublicPlans,
  toWorkspacePlanState,
  violatesGrandfatheredLimit,
} from './entitlements.logic';
import {
  buildSeedKeyRows,
  buildSeedLimitRows,
  SEED_UPDATED_AT,
} from './__entitlements-test-kit-spec';
import type { WorkspacePlanStateRow } from './repositories/entitlements.repository.interface';

const seedMatrix = () => buildMatrix(buildSeedKeyRows(), buildSeedLimitRows());

const subject = {
  plan: 'free' as const,
  workspaceId: 'ws-1',
  workspaceSlug: 'acme',
  workspaceName: 'Acme',
};

describe('buildMatrix', () => {
  it('builds every seeded cell with no drift', () => {
    const matrix = seedMatrix();

    expect(matrix.plans).toEqual(['free', 'pro', 'business', 'enterprise']);
    expect(matrix.keys.map((k) => k.key)).toEqual(
      buildSeedKeyRows().map((r) => r.key),
    );
    expect(matrix.drift).toEqual({ missing_in_db: [], unknown_to_code: [] });
    expect(matrix.version).toBe(SEED_UPDATED_AT);

    expect(matrix.cells.free.projects).toEqual({
      kind: 'count',
      value: 2,
      per_seat: false,
      display_label: null,
    });
    expect(matrix.cells.business.projects).toEqual({
      kind: 'count',
      value: null,
      per_seat: false,
      display_label: null,
    });
    expect(matrix.cells.pro.ai_messages_monthly).toEqual({
      kind: 'quota',
      value: 500,
      per_seat: true,
      display_label: null,
    });
    expect(matrix.cells.enterprise.ai_messages_monthly).toMatchObject({
      value: null,
      display_label: 'Negotiated',
    });
    expect(matrix.cells.free.decisions).toEqual({
      kind: 'feature',
      enabled: false,
      display_label: null,
    });
    expect(matrix.cells.enterprise.mcp_server).toEqual({
      kind: 'feature',
      enabled: true,
      display_label: 'Higher limits',
    });
  });

  it('takes `enforced` from the code registry, never the database', () => {
    const matrix = seedMatrix();
    const enforced = Object.fromEntries(
      matrix.keys.map((k) => [k.key, k.enforced]),
    );
    for (const [key, def] of Object.entries(ENTITLEMENT_KEYS)) {
      expect(enforced[key]).toBe(def.enforced);
    }
    expect(enforced.ai_messages_monthly).toBe(false);
    expect(enforced.projects).toBe(true);
  });

  it('fails open on a missing plan row and reports the key as drift', () => {
    const rows = buildSeedLimitRows().filter(
      (r) => !(r.plan === 'free' && r.limit_key === 'projects'),
    );
    const matrix = buildMatrix(buildSeedKeyRows(), rows);

    expect(matrix.cells.free.projects).toEqual({
      kind: 'count',
      value: null,
      per_seat: false,
      display_label: null,
    });
    expect(matrix.cells.pro.projects).toMatchObject({ value: 10 });
    expect(matrix.drift.missing_in_db).toEqual(['projects']);
  });

  it('leaves a code key with no key row out of the matrix, so its cells read as open', () => {
    const matrix = buildMatrix(
      buildSeedKeyRows().filter((r) => r.key !== 'decisions'),
      buildSeedLimitRows().filter((r) => r.limit_key !== 'decisions'),
    );

    expect(matrix.keys.some((k) => k.key === 'decisions')).toBe(false);
    expect(matrix.cells.free.decisions).toBeUndefined();
    expect(featureEnabled(matrix.cells.free.decisions)).toBe(true);
    expect(matrix.drift.missing_in_db).toEqual(['decisions']);
  });

  it('treats a kind the code disagrees with as missing', () => {
    const keyRows = buildSeedKeyRows().map((r) =>
      r.key === 'teams' ? { ...r, kind: 'quota' } : r,
    );
    const limitRows = buildSeedLimitRows().map((r) =>
      r.limit_key === 'teams' ? { ...r, kind: 'quota' } : r,
    );
    const matrix = buildMatrix(keyRows, limitRows);

    expect(matrix.cells.free.teams).toBeUndefined();
    expect(numericLimit(matrix.cells.free.teams)).toBeNull();
    expect(matrix.drift.missing_in_db).toEqual(['teams']);
  });

  it('passes a key the code does not know through as display-only', () => {
    const keyRows = [
      ...buildSeedKeyRows(),
      {
        key: 'storage_gb',
        kind: 'quota',
        label: 'Storage',
        description: null,
        unit: 'GB',
        group_key: 'usage',
        sort_order: 5,
      },
    ];
    const limitRows = [
      ...buildSeedLimitRows(),
      ...(['free', 'pro', 'business', 'enterprise'] as const).map((plan) => ({
        plan,
        limit_key: 'storage_gb',
        kind: 'quota',
        int_value: plan === 'free' ? 1 : null,
        bool_value: null,
        per_seat: false,
        display_label: null,
        updated_by: null,
        updated_at: SEED_UPDATED_AT,
      })),
    ];
    const matrix = buildMatrix(keyRows, limitRows);

    expect(matrix.drift.unknown_to_code).toEqual(['storage_gb']);
    expect(matrix.drift.missing_in_db).toEqual([]);
    expect(matrix.keys[0]).toMatchObject({
      key: 'storage_gb',
      enforced: false,
      sort_order: 5,
    });
    expect(matrix.cells.free.storage_gb).toMatchObject({ value: 1 });
  });

  it('keeps the newest updated_at verbatim, microseconds included', () => {
    // The admin editor sends `version` back as its stale-write guard; rounding
    // to milliseconds would make every save look stale.
    const rows = buildSeedLimitRows([
      {
        plan: 'pro',
        limit_key: 'teams',
        updated_at: '2026-09-23T08:15:30.123456+00:00',
      },
      {
        plan: 'free',
        limit_key: 'teams',
        updated_at: '2026-09-23T08:15:30.123999+00:00',
      },
    ]);
    expect(buildMatrix(buildSeedKeyRows(), rows).version).toBe(
      '2026-09-23T08:15:30.123999+00:00',
    );
    expect(buildMatrix(buildSeedKeyRows(), []).version).toBeNull();
  });

  it('never switches a feature off on a NULL bool', () => {
    const rows = buildSeedLimitRows([
      { plan: 'pro', limit_key: 'risks', bool_value: null },
    ]);
    expect(buildMatrix(buildSeedKeyRows(), rows).cells.pro.risks).toMatchObject(
      { enabled: true },
    );
  });
});

describe('computeUpgradePlan', () => {
  const matrix = seedMatrix();

  it.each([
    ['free projects at 2 -> pro', 'free', 'projects', 3, 'pro'],
    [
      'free projects needing 11 -> business',
      'free',
      'projects',
      11,
      'business',
    ],
    ['pro teams -> business', 'pro', 'teams', 4, 'business'],
    ['free members -> pro', 'free', 'members', 11, 'pro'],
    ['free nodes -> pro', 'free', 'roadmap_nodes_per_roadmap', 251, 'pro'],
  ] as const)('%s', (_label, current, key, needed, expected) => {
    expect(computeUpgradePlan(matrix, current, key, needed)).toBe(expected);
  });

  it('finds the first plan that turns a feature on', () => {
    expect(computeUpgradePlan(matrix, 'free', 'decisions')).toBe('pro');
    expect(computeUpgradePlan(matrix, 'free', 'roles_permissions')).toBe(
      'business',
    );
    expect(computeUpgradePlan(matrix, 'pro', 'saml_scim')).toBe('enterprise');
  });

  it('returns null when no higher plan allows it', () => {
    expect(computeUpgradePlan(matrix, 'enterprise', 'projects', 99)).toBeNull();
    expect(computeUpgradePlan(matrix, 'business', 'nope')).toBeNull();
  });

  it('without `needed`, asks for any plan more generous than the current one', () => {
    expect(computeUpgradePlan(matrix, 'free', 'activity_retention_days')).toBe(
      'pro',
    );
    expect(computeUpgradePlan(matrix, 'pro', 'activity_retention_days')).toBe(
      'business',
    );
  });

  it('follows admin edits to the matrix', () => {
    const edited = buildMatrix(
      buildSeedKeyRows(),
      buildSeedLimitRows([
        { plan: 'pro', limit_key: 'decisions', bool_value: false },
        { plan: 'pro', limit_key: 'projects', int_value: 50 },
      ]),
    );
    expect(computeUpgradePlan(edited, 'free', 'decisions')).toBe('business');
    expect(computeUpgradePlan(edited, 'free', 'projects', 11)).toBe('pro');
  });
});

describe('small rules', () => {
  it('violatesGrandfatheredLimit only rejects growth past the limit', () => {
    expect(violatesGrandfatheredLimit(null, 0, 10_000)).toBe(false);
    expect(violatesGrandfatheredLimit(250, 249, 250)).toBe(false);
    expect(violatesGrandfatheredLimit(250, 250, 251)).toBe(true);
    expect(violatesGrandfatheredLimit(250, 0, 300)).toBe(true);
    // Already over: may stay or shrink, never grow.
    expect(violatesGrandfatheredLimit(250, 300, 300)).toBe(false);
    expect(violatesGrandfatheredLimit(250, 300, 260)).toBe(false);
    expect(violatesGrandfatheredLimit(250, 300, 301)).toBe(true);
  });

  it('meterState thresholds', () => {
    expect(meterState(5, null)).toBe('unlimited');
    expect(meterState(3, 10)).toBe('ok');
    expect(meterState(8, 10)).toBe('near');
    expect(meterState(10, 10)).toBe('at');
    expect(meterState(12, 10)).toBe('over');
    expect(meterState(0, 0)).toBe('at');
  });

  it('numericLimit and featureEnabled fail open on missing cells', () => {
    expect(numericLimit(undefined)).toBeNull();
    expect(
      numericLimit({ kind: 'feature', enabled: false, display_label: null }),
    ).toBeNull();
    expect(featureEnabled(undefined)).toBe(true);
    expect(
      featureEnabled({
        kind: 'count',
        value: 1,
        per_seat: false,
        display_label: null,
      }),
    ).toBe(true);
  });

  it('overLimitKeys lists grandfathered counts only', () => {
    const cells = seedMatrix().cells.free;
    expect(
      overLimitKeys({ members: 14, projects: 2, teams: 3 }, cells),
    ).toEqual(['members', 'teams']);
    expect(
      overLimitKeys(
        { members: 99, projects: 99, teams: 99 },
        seedMatrix().cells.business,
      ),
    ).toEqual([]);
  });

  it('featureAvailableOn includes Free', () => {
    const matrix = seedMatrix();
    expect(featureAvailableOn(matrix, 'decisions')).toBe('pro');
    expect(featureAvailableOn(matrix, 'saml_scim')).toBe('enterprise');
    expect(featureAvailableOn(matrix, 'projects')).toBeNull();
  });

  it('toPublicPlans drops staff-only fields', () => {
    const matrix = seedMatrix();
    const pub = toPublicPlans(matrix);
    expect(pub.keys[0]).not.toHaveProperty('enforced');
    expect(pub).not.toHaveProperty('drift');
    expect(pub.limits).toBe(matrix.cells);
    expect(pub.version).toBe(matrix.version);
  });

  it('isLimitMatrix recognizes only a full matrix', () => {
    expect(isLimitMatrix(seedMatrix())).toBe(true);
    expect(isLimitMatrix(null)).toBe(false);
    expect(isLimitMatrix({ plans: [], keys: [] })).toBe(false);
  });
});

describe('toWorkspacePlanState', () => {
  const row = (
    overrides: Partial<WorkspacePlanStateRow> = {},
  ): WorkspacePlanStateRow => ({
    workspace_id: 'ws-1',
    workspace_name: 'Acme',
    workspace_slug: 'acme',
    subscription_plan: 'pro',
    subscription_status: 'active',
    has_provider_subscription: true,
    is_discounted_free: false,
    discounted_plan: null,
    discounted_at: null,
    discounted_until: null,
    comp_active: false,
    effective_plan: 'pro',
    plan_source: 'subscription',
    ...overrides,
  });

  it('reads the SQL decision without re-deriving it', () => {
    expect(toWorkspacePlanState(row())).toEqual({
      workspace_id: 'ws-1',
      workspace_name: 'Acme',
      workspace_slug: 'acme',
      effective_plan: 'pro',
      plan_source: 'subscription',
      subscription_plan: 'pro',
      subscription_status: 'active',
      has_provider_subscription: true,
      complimentary: null,
    });
  });

  it('maps a complimentary plan', () => {
    const state = toWorkspacePlanState(
      row({
        subscription_plan: null,
        subscription_status: null,
        has_provider_subscription: false,
        is_discounted_free: true,
        discounted_plan: 'business',
        discounted_at: '2026-09-22T00:00:00+00:00',
        discounted_until: null,
        comp_active: true,
        effective_plan: 'business',
        plan_source: 'complimentary',
      }),
    );
    expect(state.subscription_plan).toBe('free');
    expect(state.effective_plan).toBe('business');
    expect(state.complimentary).toEqual({
      plan: 'business',
      since: '2026-09-22T00:00:00+00:00',
      until: null,
      active: true,
    });
  });

  it('degrades unknown values to Free / default', () => {
    const state = toWorkspacePlanState(
      row({ effective_plan: 'platinum', plan_source: 'magic' }),
    );
    expect(state.effective_plan).toBe('free');
    expect(state.plan_source).toBe('default');
  });
});

describe('buildPlanLimitMessage', () => {
  const base = {
    label: 'Projects',
    unit: 'projects',
    plan: 'free' as const,
    upgradePlan: 'pro' as const,
    workspaceName: 'Acme',
  };

  it('count at create', () => {
    expect(
      buildPlanLimitMessage({
        ...base,
        kind: 'count',
        limitKey: 'projects',
        limit: 2,
        used: 2,
        context: 'create',
      }),
    ).toBe(
      'Your Free plan includes 2 projects and this workspace has 2. Upgrade to Pro to add more.',
    );
  });

  it('members at invite, counting pending invites', () => {
    expect(
      buildPlanLimitMessage({
        ...base,
        kind: 'count',
        limitKey: 'members',
        label: 'Members',
        unit: 'members',
        limit: 10,
        used: 10,
        context: 'invite',
        countsPendingInvites: true,
      }),
    ).toBe(
      'Your Free plan includes 10 members and this workspace has 10, counting pending invites. Upgrade to Pro to invite more.',
    );
  });

  it('members at accept speaks to the invitee', () => {
    expect(
      buildPlanLimitMessage({
        ...base,
        kind: 'count',
        limitKey: 'members',
        label: 'Members',
        unit: 'members',
        limit: 10,
        used: 10,
        context: 'accept',
      }),
    ).toBe(
      'Acme has reached the 10-member limit of its Free plan. Ask a workspace owner to upgrade, then accept this invite again.',
    );
    expect(
      buildPlanLimitMessage({
        ...base,
        kind: 'count',
        limitKey: 'members',
        label: 'Members',
        unit: 'members',
        limit: 10,
        used: 10,
        context: 'accept',
        workspaceName: null,
      }),
    ).toMatch(/^This workspace has reached the 10-member limit/);
  });

  it('roadmap nodes, on a write and on a link', () => {
    const nodes = {
      ...base,
      kind: 'count' as const,
      limitKey: 'roadmap_nodes_per_roadmap',
      label: 'Roadmap nodes per roadmap',
      unit: 'nodes',
      limit: 250,
      used: 240,
      next: 262,
    };
    expect(buildPlanLimitMessage({ ...nodes, context: 'full_state' })).toBe(
      'This change would bring the roadmap to 262 nodes; the Free plan allows 250 per roadmap. Remove nodes or upgrade to Pro.',
    );
    expect(buildPlanLimitMessage({ ...nodes, context: 'link' })).toBe(
      "This roadmap has 262 nodes; the destination workspace's Free plan allows 250 per roadmap. Remove nodes or upgrade that workspace to Pro, then link it again.",
    );
  });

  it('with no plan to upgrade to, points at sales rather than an upgrade', () => {
    expect(
      buildPlanLimitMessage({
        ...base,
        kind: 'count',
        limitKey: 'projects',
        plan: 'enterprise',
        upgradePlan: null,
        limit: 500,
        used: 500,
        context: 'create',
      }),
    ).toBe(
      'Your Enterprise plan includes 500 projects and this workspace has 500. Contact us to raise this limit.',
    );
  });

  it('singular unit for a limit of one', () => {
    expect(
      buildPlanLimitMessage({
        ...base,
        kind: 'count',
        limitKey: 'projects',
        limit: 1,
        used: 1,
        context: 'create',
      }),
    ).toBe(
      'Your Free plan includes 1 project and this workspace has 1. Upgrade to Pro to add more.',
    );
  });

  it('features, with verb agreement and no "and above" at the top tier', () => {
    const feature = {
      kind: 'feature' as const,
      limit: null,
      used: null,
      plan: 'free' as const,
      context: 'write' as const,
    };
    expect(
      buildPlanLimitMessage({
        ...feature,
        limitKey: 'change_requests',
        label: 'Change requests',
        upgradePlan: 'pro',
      }),
    ).toBe('Change requests are available on Pro and above.');
    expect(
      buildPlanLimitMessage({
        ...feature,
        limitKey: 'decisions',
        label: 'Decision log',
        upgradePlan: 'pro',
      }),
    ).toBe('Decision log is available on Pro and above.');
    expect(
      buildPlanLimitMessage({
        ...feature,
        limitKey: 'saml_scim',
        label: 'SAML and SCIM',
        upgradePlan: 'enterprise',
      }),
    ).toBe('SAML and SCIM are available on Enterprise.');
    expect(
      buildPlanLimitMessage({
        ...feature,
        limitKey: 'risks',
        label: 'Risks and issues register',
        plan: 'enterprise',
        upgradePlan: null,
      }),
    ).toBe('Risks and issues register is not included in the Enterprise plan.');
  });
});

describe('payload builders', () => {
  it('buildCountLimitPayload carries every field and an upgrade from the live matrix', () => {
    expect(
      buildCountLimitPayload(seedMatrix(), subject, {
        key: 'projects',
        limit: 2,
        used: 2,
        next: 3,
        context: 'create',
      }),
    ).toEqual({
      code: 'plan_limit',
      kind: 'count',
      limit_key: 'projects',
      label: 'Projects',
      limit: 2,
      used: 2,
      plan: 'free',
      upgrade_plan: 'pro',
      workspace_id: 'ws-1',
      workspace_slug: 'acme',
      context: 'create',
      message:
        'Your Free plan includes 2 projects and this workspace has 2. Upgrade to Pro to add more.',
    });
  });

  it('buildFeatureLimitPayload drops "and above" when a higher plan turns it back off', () => {
    const matrix = buildMatrix(
      buildSeedKeyRows(),
      buildSeedLimitRows([
        { plan: 'business', limit_key: 'change_requests', bool_value: false },
      ]),
    );
    const payload = buildFeatureLimitPayload(matrix, subject, {
      key: 'change_requests',
      context: 'write',
    });
    expect(payload).toMatchObject({
      kind: 'feature',
      limit_key: 'change_requests',
      label: 'Change requests',
      limit: null,
      used: null,
      upgrade_plan: 'pro',
      message: 'Change requests are available on Pro.',
    });
    expect(
      buildFeatureLimitPayload(seedMatrix(), subject, {
        key: 'change_requests',
        context: 'enable',
      }).message,
    ).toBe('Change requests are available on Pro and above.');
  });
});
