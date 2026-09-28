/**
 * Test doubles for EntitlementsService, for the specs of every service that
 * enforces a plan limit.
 *
 * Named `-spec.ts`, not `.spec.ts`, deliberately: tsconfig.build.json excludes
 * every file ending in "spec.ts", so these jest globals never reach the
 * production build, while Jest's `.spec.ts` testRegex does not mistake this
 * file for a suite.
 *
 *   const entitlements = allowAllEntitlements();
 *   new ProjectsService(..., entitlements);
 *   expect(entitlements.assertWithinLimit).toHaveBeenCalledWith(...);
 *
 *   const denied = denyingEntitlements({ limit_key: 'projects' });
 *   await expect(service.create(...)).rejects.toBeInstanceOf(PlanLimitException);
 */
import type { PlanId } from './entitlement-keys';
import type { EntitlementsService } from './entitlements.service';
import {
  PlanLimitException,
  type PlanLimitPayload,
} from './plan-limit.exception';
import type {
  PlanLimitKeyRow,
  PlanLimitRow,
} from './repositories/entitlements.repository.interface';

// ---------------------------------------------------------------------------
// Seed fixtures: the limits table as 20260922120000_workspace_plan_limits.sql
// seeds it (the pricing page's matrix), as repository rows.
// ---------------------------------------------------------------------------

type SeedValue = number | boolean | null;
type SeedCell = SeedValue | { v: SeedValue; seat?: boolean; label?: string };

interface SeedKey {
  key: string;
  kind: 'count' | 'quota' | 'days' | 'feature';
  label: string;
  unit: string | null;
  group: string;
  values: [SeedCell, SeedCell, SeedCell, SeedCell];
}

const SEED_PLANS: PlanId[] = ['free', 'pro', 'business', 'enterprise'];

export const SEED_KEYS: SeedKey[] = [
  {
    key: 'members',
    kind: 'count',
    label: 'Members',
    unit: 'members',
    group: 'usage',
    values: [10, null, null, null],
  },
  {
    key: 'projects',
    kind: 'count',
    label: 'Projects',
    unit: 'projects',
    group: 'usage',
    values: [2, 10, null, null],
  },
  {
    key: 'teams',
    kind: 'count',
    label: 'Teams',
    unit: 'teams',
    group: 'usage',
    values: [2, 3, null, null],
  },
  {
    key: 'roadmap_nodes_per_roadmap',
    kind: 'count',
    label: 'Roadmap nodes per roadmap',
    unit: 'nodes',
    group: 'usage',
    values: [250, null, null, null],
  },
  {
    key: 'ai_messages_monthly',
    kind: 'quota',
    label: 'AI messages',
    unit: 'messages',
    group: 'ai',
    values: [
      50,
      { v: 500, seat: true },
      { v: 2000, seat: true },
      { v: null, label: 'Negotiated' },
    ],
  },
  {
    key: 'deliverables',
    kind: 'feature',
    label: 'Deliverables',
    unit: null,
    group: 'governance',
    values: [false, true, true, true],
  },
  {
    key: 'deliverable_review',
    kind: 'feature',
    label: 'Deliverable review and acceptance',
    unit: null,
    group: 'governance',
    values: [false, true, true, true],
  },
  {
    key: 'change_requests',
    kind: 'feature',
    label: 'Change requests',
    unit: null,
    group: 'governance',
    values: [false, true, true, true],
  },
  {
    key: 'risks',
    kind: 'feature',
    label: 'Risks and issues register',
    unit: null,
    group: 'governance',
    values: [false, true, true, true],
  },
  {
    key: 'decisions',
    kind: 'feature',
    label: 'Decision log',
    unit: null,
    group: 'governance',
    values: [false, true, true, true],
  },
  {
    key: 'custom_register_fields',
    kind: 'feature',
    label: 'Custom register fields',
    unit: null,
    group: 'governance',
    values: [false, false, false, true],
  },
  {
    key: 'time_tracking',
    kind: 'feature',
    label: 'Time tracking and timesheets',
    unit: null,
    group: 'team',
    values: [false, true, true, true],
  },
  {
    key: 'private_teams_guests',
    kind: 'feature',
    label: 'Private teams and guests',
    unit: null,
    group: 'team',
    values: [false, false, true, true],
  },
  {
    key: 'roles_permissions',
    kind: 'feature',
    label: 'Roles and permissions',
    unit: null,
    group: 'team',
    values: [false, false, true, { v: true, label: 'Granular' }],
  },
  {
    key: 'activity_retention_days',
    kind: 'days',
    label: 'Activity log retention',
    unit: 'days',
    group: 'team',
    values: [7, 90, null, null],
  },
  {
    key: 'activity_export',
    kind: 'feature',
    label: 'Activity export',
    unit: null,
    group: 'team',
    values: [false, false, false, true],
  },
  {
    key: 'mcp_server',
    kind: 'feature',
    label: 'MCP server',
    unit: null,
    group: 'platform',
    values: [false, true, true, { v: true, label: 'Higher limits' }],
  },
  {
    key: 'saml_scim',
    kind: 'feature',
    label: 'SAML and SCIM',
    unit: null,
    group: 'platform',
    values: [false, false, false, true],
  },
];

export const SEED_UPDATED_AT = '2026-09-22T12:00:00.000000+00:00';

export function buildSeedKeyRows(): PlanLimitKeyRow[] {
  return SEED_KEYS.map((seed, index) => ({
    key: seed.key,
    kind: seed.kind,
    label: seed.label,
    description: null,
    unit: seed.unit,
    group_key: seed.group,
    sort_order: (index + 1) * 10,
  }));
}

export function buildSeedLimitRows(
  overrides: Array<
    Partial<PlanLimitRow> & { plan: string; limit_key: string }
  > = [],
): PlanLimitRow[] {
  const rows: PlanLimitRow[] = [];
  for (const seed of SEED_KEYS) {
    seed.values.forEach((cell, index) => {
      const spec =
        cell !== null && typeof cell === 'object' ? cell : { v: cell };
      rows.push({
        plan: SEED_PLANS[index],
        limit_key: seed.key,
        kind: seed.kind,
        int_value: seed.kind === 'feature' ? null : (spec.v as number | null),
        bool_value: seed.kind === 'feature' ? (spec.v as boolean) : null,
        per_seat: spec.seat === true,
        display_label: spec.label ?? null,
        updated_by: null,
        updated_at: SEED_UPDATED_AT,
      });
    });
  }
  for (const override of overrides) {
    const row = rows.find(
      (r) => r.plan === override.plan && r.limit_key === override.limit_key,
    );
    if (row) Object.assign(row, override);
  }
  return rows;
}

type EntitlementsMethod = {
  [K in keyof EntitlementsService]: EntitlementsService[K] extends (
    ...args: never[]
  ) => unknown
    ? K
    : never;
}[keyof EntitlementsService];

/** Every public method a jest.fn, and still assignable to EntitlementsService. */
export type EntitlementsMock = jest.Mocked<EntitlementsService>;

/** The Free plan's project limit, as a PlanLimitException would carry it. */
export function buildPlanLimitPayload(
  overrides: Partial<PlanLimitPayload> = {},
): PlanLimitPayload {
  return {
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
    ...overrides,
  };
}

function freePlanState(workspaceId: string) {
  return {
    workspace_id: workspaceId,
    workspace_name: null,
    workspace_slug: null,
    effective_plan: 'free' as const,
    plan_source: 'default' as const,
    subscription_plan: 'free' as const,
    subscription_status: null,
    has_provider_subscription: false,
    complimentary: null,
  };
}

function emptyMatrix() {
  return {
    plans: ['free', 'pro', 'business', 'enterprise'],
    keys: [],
    cells: { free: {}, pro: {}, business: {}, enterprise: {} },
    version: null,
    drift: { missing_in_db: [], unknown_to_code: [] },
  };
}

/**
 * Permissive defaults: every assert resolves, every feature is on, every
 * limit is unlimited, every scope is workspace ws-1, every count is 0.
 * The keyed object literal is exhaustive on purpose: a method added to
 * EntitlementsService fails to compile here until it has a default.
 */
export function allowAllEntitlements(): EntitlementsMock {
  const mocks: Record<EntitlementsMethod, jest.Mock> = {
    getEffectivePlan: jest.fn((workspaceId: string) =>
      Promise.resolve(freePlanState(workspaceId)),
    ),
    getEffectivePlans: jest.fn((workspaceIds: string[]) =>
      Promise.resolve(
        new Map(workspaceIds.map((id) => [id, freePlanState(id)])),
      ),
    ),
    getLimitMatrix: jest.fn(() => Promise.resolve(emptyMatrix())),
    getLimits: jest.fn(() => Promise.resolve({})),
    resolveScopeForProject: jest.fn(() =>
      Promise.resolve({ workspaceId: 'ws-1', exempt: false }),
    ),
    resolveScopeForTeam: jest.fn(() =>
      Promise.resolve({ workspaceId: 'ws-1', exempt: false }),
    ),
    resolveScopeForRoadmap: jest.fn(() =>
      Promise.resolve({ workspaceId: 'ws-1', exempt: false }),
    ),
    getLimit: jest.fn(() => Promise.resolve(null)),
    assertWithinLimit: jest.fn(() => Promise.resolve(undefined)),
    assertNodeWrite: jest.fn(() => Promise.resolve(undefined)),
    nodeLimitViolation: jest.fn(() => Promise.resolve(null)),
    countRoadmapNodes: jest.fn(() => Promise.resolve(0)),
    assertFeature: jest.fn(() => Promise.resolve(undefined)),
    hasFeature: jest.fn(() => Promise.resolve(true)),
    userHasFeatureInAnyWorkspace: jest.fn(() => Promise.resolve(true)),
    getRetentionCutoff: jest.fn(() =>
      Promise.resolve({ days: null, cutoff: null }),
    ),
    getUsageCounts: jest.fn(() =>
      Promise.resolve({
        members: 0,
        pending_invites: 0,
        projects: 0,
        teams: 0,
      }),
    ),
    getLargestRoadmaps: jest.fn(() => Promise.resolve([])),
    invalidateWorkspace: jest.fn(() => Promise.resolve(undefined)),
    invalidateLimits: jest.fn(() => Promise.resolve(undefined)),
  };
  return mocks as unknown as EntitlementsMock;
}

/**
 * Every assert rejects with a PlanLimitException (a fresh instance per call),
 * hasFeature/userHasFeatureInAnyWorkspace answer false, and nodeLimitViolation
 * returns the payload. Reads keep the permissive defaults.
 */
export function denyingEntitlements(
  payloadOverrides: Partial<PlanLimitPayload> = {},
): EntitlementsMock {
  const payload = buildPlanLimitPayload(payloadOverrides);
  const reject = () => Promise.reject(new PlanLimitException({ ...payload }));
  const mock = allowAllEntitlements();
  mock.assertWithinLimit.mockImplementation(reject);
  mock.assertNodeWrite.mockImplementation(reject);
  mock.assertFeature.mockImplementation(reject);
  mock.nodeLimitViolation.mockImplementation(() =>
    Promise.resolve({ ...payload }),
  );
  mock.hasFeature.mockImplementation(() => Promise.resolve(false));
  mock.userHasFeatureInAnyWorkspace.mockImplementation(() =>
    Promise.resolve(false),
  );
  return mock;
}
