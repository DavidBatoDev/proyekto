/**
 * Test doubles for RoadmapPlanLimitsService, for every roadmap-side spec.
 *
 * Named `-spec.ts`, not `.spec.ts`, deliberately (the same trick as the
 * entitlements test kit): tsconfig.build.json excludes it from the build and
 * Jest's `.spec.ts` regex does not collect it as a suite.
 *
 *   // Thread the dependency through a constructor; every check passes and
 *   // nothing is looked up.
 *   new EpicsService(..., allowAllPlanLimits());
 *
 *   // The real service over a real EntitlementsService and a fake
 *   // repository seeded like the migration: real grandfather rule, real
 *   // messages.
 *   const { planLimits, repo } = planLimitsHarness({ nodes: { 'rm-1': 250 } });
 */
import type { CloudflareCachePurgeService } from '../../../../common/cache/cloudflare-cache-purge.service';
import type { RedisDataCacheService } from '../../../../common/cache/redis-data-cache.service';
import { EntitlementsService } from '../../../shared/entitlements/entitlements.service';
import type { PlanId } from '../../../shared/entitlements/entitlement-keys';
import {
  allowAllEntitlements,
  buildPlanLimitPayload,
  buildSeedKeyRows,
  buildSeedLimitRows,
} from '../../../shared/entitlements/__entitlements-test-kit-spec';
import { PlanLimitException } from '../../../shared/entitlements/plan-limit.exception';
import type {
  EntitlementsRepository,
  WorkspacePlanStateRow,
} from '../../../shared/entitlements/repositories/entitlements.repository.interface';
import { RoadmapPlanLimitsService } from './roadmap-plan-limits.service';

interface ProfileQuery {
  select: jest.Mock<ProfileQuery, []>;
  eq: jest.Mock<ProfileQuery, [string, string]>;
  maybeSingle: jest.Mock<
    Promise<{ data: { is_guest: boolean } | null; error: null }>,
    []
  >;
}

/** A db whose owner lookups answer "no workspace, not a guest". */
function ownerLookupDb(
  owners: Record<
    string,
    { workspaceId: string | null; isGuest?: boolean }
  > = {},
) {
  return {
    rpc: jest.fn((fn: string, args: { p_user_id?: string }) =>
      Promise.resolve({
        data:
          fn === 'user_default_workspace_id'
            ? (owners[args.p_user_id ?? '']?.workspaceId ?? null)
            : null,
        error: null,
      }),
    ),
    from: jest.fn((): ProfileQuery => {
      let id = '';
      const query: ProfileQuery = {
        select: jest.fn((): ProfileQuery => query),
        eq: jest.fn((_column: string, value: string): ProfileQuery => {
          id = value;
          return query;
        }),
        maybeSingle: jest.fn(() =>
          Promise.resolve({
            data: owners[id] ? { is_guest: owners[id].isGuest === true } : null,
            error: null,
          }),
        ),
      };
      return query;
    }),
  };
}

/** The real service over an all-permissive entitlements mock: every check passes, nothing is counted. */
export function allowAllPlanLimits(): RoadmapPlanLimitsService {
  return new RoadmapPlanLimitsService(
    allowAllEntitlements(),
    ownerLookupDb() as never,
  );
}

type PlanLimitsMethod = {
  [K in keyof RoadmapPlanLimitsService]: RoadmapPlanLimitsService[K] extends (
    ...args: never[]
  ) => unknown
    ? K
    : never;
}[keyof RoadmapPlanLimitsService];

/**
 * Every public method as a plain jest.Mock property (not a class method, so
 * `expect(stub.assertCanAdd)` reads cleanly); pass it to a constructor with
 * `as never`.
 */
export type PlanLimitsStub = Record<PlanLimitsMethod, jest.Mock>;

/**
 * Every method a jest.fn with a permissive default, for call-order
 * assertions. Exhaustive on purpose: a method added to the service fails to
 * compile here until it has a default.
 */
export function planLimitsStub(): PlanLimitsStub {
  const scope = () => Promise.resolve({ workspaceId: 'ws-1', exempt: false });
  const mocks: Record<PlanLimitsMethod, jest.Mock> = {
    assertCanAdd: jest.fn(() => Promise.resolve()),
    assertFullStateWrite: jest.fn(() => Promise.resolve()),
    assertNodeTotal: jest.fn(() => Promise.resolve()),
    previewIssue: jest.fn(() => Promise.resolve(null)),
    assertCanLink: jest.fn(() => Promise.resolve()),
    assertCanUnlink: jest.fn(() => Promise.resolve()),
    countNodes: jest.fn(() => Promise.resolve(0)),
    retentionCutoff: jest.fn(() => Promise.resolve(null)),
    scopeFor: jest.fn(scope),
    scopeForProject: jest.fn(scope),
    scopeForOwner: jest.fn(scope),
    nodeLimit: jest.fn(() => Promise.resolve(null)),
  };
  return mocks;
}

/** The Free plan's node-limit rejection, as the real service would throw it. */
export function nodeLimitException(
  overrides: Parameters<typeof buildPlanLimitPayload>[0] = {},
): PlanLimitException {
  return new PlanLimitException(
    buildPlanLimitPayload({
      limit_key: 'roadmap_nodes_per_roadmap',
      label: 'Roadmap nodes per roadmap',
      limit: 250,
      used: 250,
      context: 'create',
      message:
        'This change would bring the roadmap to 251 nodes; the Free plan allows 250 per roadmap. Remove nodes or upgrade to Pro.',
      ...overrides,
    }),
  );
}

function planRow(workspaceId: string, plan: PlanId): WorkspacePlanStateRow {
  return {
    workspace_id: workspaceId,
    workspace_name: `Workspace ${workspaceId}`,
    workspace_slug: workspaceId,
    subscription_plan: plan,
    subscription_status: plan === 'free' ? null : 'active',
    has_provider_subscription: plan !== 'free',
    is_discounted_free: false,
    discounted_plan: null,
    discounted_at: null,
    discounted_until: null,
    comp_active: false,
    effective_plan: plan,
    plan_source: plan === 'free' ? 'default' : 'subscription',
  };
}

export interface PlanLimitsHarnessOptions {
  /** Effective plan per workspace. Default: ws-free free, ws-pro pro, ws-business business. */
  plans?: Record<string, PlanId>;
  /**
   * entitlement_subject answers keyed `kind:id` (e.g. `roadmap:rm-1`,
   * `project:p-1`). Anything unlisted resolves to ws-free.
   */
  subjects?: Record<string, { workspace_id: string | null; exempt?: boolean }>;
  /** Stored epics + features + tasks per roadmap. Unlisted: 0. */
  nodes?: Record<string, number>;
  /** Would-be standalone owners: default workspace and guest flag per user. */
  owners?: Record<string, { workspaceId: string | null; isGuest?: boolean }>;
}

type FakeEntitlementsRepo = { [K in keyof EntitlementsRepository]: jest.Mock };

/**
 * The real RoadmapPlanLimitsService over a real EntitlementsService whose
 * repository is a fake seeded with the migration's limits table.
 */
export function planLimitsHarness(options: PlanLimitsHarnessOptions = {}) {
  const plans = options.plans ?? {
    'ws-free': 'free',
    'ws-pro': 'pro',
    'ws-business': 'business',
  };
  const subjects = options.subjects ?? {};
  const nodes = options.nodes ?? {};

  const repo: FakeEntitlementsRepo = {
    listLimitKeys: jest.fn(() => Promise.resolve(buildSeedKeyRows())),
    listLimits: jest.fn(() => Promise.resolve(buildSeedLimitRows())),
    getPlanStates: jest.fn((ids: string[]) =>
      Promise.resolve(
        ids.filter((id) => plans[id]).map((id) => planRow(id, plans[id])),
      ),
    ),
    getUsageCounts: jest.fn(() => Promise.resolve([])),
    getLargestRoadmaps: jest.fn(() => Promise.resolve([])),
    resolveSubject: jest.fn((kind: string, id: string) => {
      const subject = subjects[`${kind}:${id}`];
      return Promise.resolve({
        found: true,
        workspace_id: subject ? subject.workspace_id : 'ws-free',
        exempt: subject?.exempt === true,
      });
    }),
    countRoadmapNodes: jest.fn((ids: string[]) =>
      Promise.resolve(new Map(ids.map((id) => [id, nodes[id] ?? 0]))),
    ),
    listMemberWorkspaceIds: jest.fn(() => Promise.resolve([])),
  };

  const store = new Map<string, unknown>();
  const cache = {
    rememberJson: jest.fn(
      async (key: string, _ttl: number, loader: () => Promise<unknown>) => {
        if (store.has(key)) return store.get(key);
        const value = await loader();
        store.set(key, JSON.parse(JSON.stringify(value)));
        return value;
      },
    ),
    del: jest.fn((key: string) => {
      store.delete(key);
      return Promise.resolve();
    }),
  };
  const purge = { purgePaths: jest.fn(() => Promise.resolve()) };
  const entitlements = new EntitlementsService(
    repo as unknown as EntitlementsRepository,
    cache as unknown as RedisDataCacheService,
    purge as unknown as CloudflareCachePurgeService,
  );
  const db = ownerLookupDb(options.owners);
  const planLimits = new RoadmapPlanLimitsService(entitlements, db as never);
  return { planLimits, entitlements, repo, db };
}
