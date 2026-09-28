import { Logger, NotFoundException } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { CloudflareCachePurgeService } from '../../../common/cache/cloudflare-cache-purge.service';
import { REDIS_CACHE_KEYS } from '../../../common/cache/redis-cache.keys';
import type { RedisDataCacheService } from '../../../common/cache/redis-data-cache.service';
import { RedisModule } from '../../../config/redis.module';
import { EntitlementsCoreModule } from './entitlements-core.module';
import { EntitlementsService } from './entitlements.service';
import { PlanLimitException } from './plan-limit.exception';
import {
  buildSeedKeyRows,
  buildSeedLimitRows,
} from './__entitlements-test-kit-spec';
import {
  ENTITLEMENTS_REPOSITORY,
  type EntitlementsRepository,
  type WorkspacePlanStateRow,
} from './repositories/entitlements.repository.interface';
import { SupabaseEntitlementsRepository } from './repositories/entitlements.repository.supabase';

// ---------------------------------------------------------------------------
// Doubles
// ---------------------------------------------------------------------------

function planRow(
  workspaceId: string,
  plan: 'free' | 'pro' | 'business' | 'enterprise',
  overrides: Partial<WorkspacePlanStateRow> = {},
): WorkspacePlanStateRow {
  return {
    workspace_id: workspaceId,
    workspace_name: 'Acme',
    workspace_slug: 'acme',
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
    ...overrides,
  };
}

type FakeRepo = { [K in keyof EntitlementsRepository]: jest.Mock };

function buildRepo(
  plans: Record<string, WorkspacePlanStateRow> = {
    'ws-free': planRow('ws-free', 'free'),
    'ws-pro': planRow('ws-pro', 'pro'),
    'ws-business': planRow('ws-business', 'business'),
  },
): FakeRepo {
  return {
    listLimitKeys: jest.fn(() => Promise.resolve(buildSeedKeyRows())),
    listLimits: jest.fn(() => Promise.resolve(buildSeedLimitRows())),
    getPlanStates: jest.fn((ids: string[]) =>
      Promise.resolve(ids.map((id) => plans[id]).filter(Boolean)),
    ),
    getUsageCounts: jest.fn((ids: string[]) =>
      Promise.resolve(
        ids.map((id) => ({
          workspace_id: id,
          members: 3,
          pending_invites: 0,
          projects: 2,
          teams: 1,
        })),
      ),
    ),
    getLargestRoadmaps: jest.fn(() => Promise.resolve([])),
    resolveSubject: jest.fn(() =>
      Promise.resolve({ found: true, workspace_id: 'ws-free', exempt: false }),
    ),
    countRoadmapNodes: jest.fn(() => Promise.resolve(new Map())),
    listMemberWorkspaceIds: jest.fn(() => Promise.resolve([])),
  };
}

/** An in-memory stand-in for RedisDataCacheService's rememberJson/del. */
function buildCache() {
  const store = new Map<string, unknown>();
  return {
    store,
    rememberJson: jest.fn(
      async (key: string, _ttl: number, loader: () => Promise<unknown>) => {
        if (store.has(key)) return store.get(key);
        const value = await loader();
        // Round-trip through JSON like Redis does.
        store.set(key, JSON.parse(JSON.stringify(value)));
        return value;
      },
    ),
    del: jest.fn((key: string) => {
      store.delete(key);
      return Promise.resolve();
    }),
  };
}

function setup(repo: FakeRepo = buildRepo()) {
  const cache = buildCache();
  const purge = { purgePaths: jest.fn(() => Promise.resolve()) };
  const service = new EntitlementsService(
    repo as unknown as EntitlementsRepository,
    cache as unknown as RedisDataCacheService,
    purge as unknown as CloudflareCachePurgeService,
  );
  return { service, repo, cache, purge };
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected a rejection');
}

let warn: jest.SpyInstance;
let error: jest.SpyInstance;

beforeEach(() => {
  warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Plans and the matrix
// ---------------------------------------------------------------------------

describe('EntitlementsService plans', () => {
  it('reads a workspace with no plan row as free / default', async () => {
    const { service } = setup();
    await expect(service.getEffectivePlan('ws-missing')).resolves.toEqual({
      workspace_id: 'ws-missing',
      workspace_name: null,
      workspace_slug: null,
      effective_plan: 'free',
      plan_source: 'default',
      subscription_plan: 'free',
      subscription_status: null,
      has_provider_subscription: false,
      complimentary: null,
    });
  });

  it('caches plan state in Redis for 60s per workspace; `fresh` reads through', async () => {
    const { service, repo, cache } = setup();

    await service.getEffectivePlan('ws-pro');
    await service.getEffectivePlan('ws-pro');
    expect(cache.rememberJson).toHaveBeenCalledWith(
      REDIS_CACHE_KEYS.entitlementsPlanState('ws-pro'),
      60,
      expect.any(Function),
    );
    expect(repo.getPlanStates).toHaveBeenCalledTimes(1);

    const fresh = await service.getEffectivePlan('ws-pro', { fresh: true });
    expect(fresh.effective_plan).toBe('pro');
    expect(repo.getPlanStates).toHaveBeenCalledTimes(2);
    expect(cache.rememberJson).toHaveBeenCalledTimes(2);
  });

  it('getEffectivePlans batches, fills defaults, and skips an empty list', async () => {
    const { service, repo } = setup();

    const states = await service.getEffectivePlans([
      'ws-pro',
      'ws-missing',
      'ws-pro',
    ]);
    expect(repo.getPlanStates).toHaveBeenCalledWith(['ws-pro', 'ws-missing']);
    expect(states.get('ws-pro')?.effective_plan).toBe('pro');
    expect(states.get('ws-missing')?.plan_source).toBe('default');

    await expect(service.getEffectivePlans([])).resolves.toEqual(new Map());
    expect(repo.getPlanStates).toHaveBeenCalledTimes(1);
  });

  it('memoizes the matrix for 15s in process, behind Redis for 300s', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const { service, repo, cache } = setup();

    await service.getLimitMatrix();
    await service.getLimitMatrix();
    expect(cache.rememberJson).toHaveBeenCalledTimes(1);
    expect(cache.rememberJson).toHaveBeenCalledWith(
      REDIS_CACHE_KEYS.entitlementsLimitMatrix,
      300,
      expect.any(Function),
    );
    expect(repo.listLimits).toHaveBeenCalledTimes(1);

    now.mockReturnValue(1_000_000 + 15_001);
    await service.getLimitMatrix();
    // The memo expired, so Redis was asked again (and answered from its copy).
    expect(cache.rememberJson).toHaveBeenCalledTimes(2);
    expect(repo.listLimits).toHaveBeenCalledTimes(1);
  });

  it('shares one load between concurrent callers', async () => {
    const { service, repo } = setup();
    const [a, b] = await Promise.all([
      service.getLimitMatrix(),
      service.getLimitMatrix(),
    ]);
    expect(a).toBe(b);
    expect(repo.listLimitKeys).toHaveBeenCalledTimes(1);
  });

  it('does not memoize a failed load', async () => {
    const repo = buildRepo();
    repo.listLimits.mockRejectedValueOnce(new Error('relation missing'));
    const { service } = setup(repo);

    await expect(service.getLimitMatrix()).rejects.toThrow('relation missing');
    await expect(service.getLimitMatrix()).resolves.toMatchObject({
      plans: ['free', 'pro', 'business', 'enterprise'],
    });
  });

  it('rebuilds from source when Redis holds something that is not a matrix', async () => {
    const { service, repo, cache } = setup();
    cache.store.set(REDIS_CACHE_KEYS.entitlementsLimitMatrix, { stale: true });

    const matrix = await service.getLimitMatrix();
    expect(matrix.cells.free.projects).toMatchObject({ value: 2 });
    expect(repo.listLimits).toHaveBeenCalledTimes(1);
  });

  it('logs drift once per process', async () => {
    const repo = buildRepo();
    repo.listLimits.mockResolvedValue(
      buildSeedLimitRows().filter((r) => r.limit_key !== 'teams'),
    );
    const now = jest.spyOn(Date, 'now').mockReturnValue(0);
    const { service, cache } = setup(repo);

    await service.getLimitMatrix();
    cache.store.clear();
    now.mockReturnValue(60_000);
    await service.getLimitMatrix();

    const driftLogs = error.mock.calls.filter((call) =>
      String(call[0]).startsWith('entitlements_drift'),
    );
    expect(driftLogs).toHaveLength(1);
    expect(String(driftLogs[0][0])).toContain('missing_in_db=teams');
  });

  it('getLimits returns one plan’s cells', async () => {
    const { service } = setup();
    const limits = await service.getLimits('pro');
    expect(limits.projects).toMatchObject({ value: 10 });
    expect(limits.decisions).toMatchObject({ enabled: true });
  });
});

describe('EntitlementsService invalidation', () => {
  it('invalidateWorkspace drops that workspace’s plan state', async () => {
    const { service, cache, repo } = setup();
    await service.getEffectivePlan('ws-pro');

    await service.invalidateWorkspace('ws-pro');
    expect(cache.del).toHaveBeenCalledWith(
      REDIS_CACHE_KEYS.entitlementsPlanState('ws-pro'),
    );

    await service.getEffectivePlan('ws-pro');
    expect(repo.getPlanStates).toHaveBeenCalledTimes(2);
  });

  it('invalidateLimits clears the memo and Redis, and purges /api/plans', async () => {
    const { service, cache, repo, purge } = setup();
    await service.getLimitMatrix();

    await service.invalidateLimits();
    expect(cache.del).toHaveBeenCalledWith(
      REDIS_CACHE_KEYS.entitlementsLimitMatrix,
    );
    expect(purge.purgePaths).toHaveBeenCalledWith(['/api/plans']);

    await service.getLimitMatrix();
    expect(repo.listLimits).toHaveBeenCalledTimes(2);
  });

  it('a load in flight during invalidateLimits cannot re-memoize its stale result', async () => {
    const repo = buildRepo();
    let release!: () => void;
    repo.listLimits.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve(buildSeedLimitRows());
        }),
    );
    const { service, cache } = setup(repo);

    const stale = service.getLimitMatrix();
    await Promise.resolve();
    await service.invalidateLimits();
    release();
    await stale;
    cache.store.clear();

    await service.getLimitMatrix();
    expect(repo.listLimits).toHaveBeenCalledTimes(2);
  });

  it('a failed edge purge never fails the invalidation', async () => {
    const { service, purge } = setup();
    purge.purgePaths.mockRejectedValueOnce(new Error('cloudflare down'));
    await expect(service.invalidateLimits()).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Scopes
// ---------------------------------------------------------------------------

describe('EntitlementsService scopes', () => {
  it('maps entitlement_subject for each kind', async () => {
    const { service, repo } = setup();
    repo.resolveSubject.mockResolvedValueOnce({
      found: true,
      workspace_id: 'ws-pro',
      exempt: false,
    });
    await expect(service.resolveScopeForProject('p-1')).resolves.toEqual({
      workspaceId: 'ws-pro',
      exempt: false,
    });
    expect(repo.resolveSubject).toHaveBeenLastCalledWith('project', 'p-1');

    repo.resolveSubject.mockResolvedValueOnce({
      found: true,
      workspace_id: null,
      exempt: false,
    });
    await expect(service.resolveScopeForTeam('t-1')).resolves.toEqual({
      workspaceId: null,
      exempt: false,
    });
    expect(repo.resolveSubject).toHaveBeenLastCalledWith('team', 't-1');

    repo.resolveSubject.mockResolvedValueOnce({
      found: true,
      workspace_id: null,
      exempt: true,
    });
    await expect(service.resolveScopeForRoadmap('r-1')).resolves.toEqual({
      workspaceId: null,
      exempt: true,
    });
    expect(repo.resolveSubject).toHaveBeenLastCalledWith('roadmap', 'r-1');
  });

  it('treats a target that does not exist, or a failed lookup, as exempt', async () => {
    const { service, repo } = setup();
    repo.resolveSubject.mockResolvedValueOnce({
      found: false,
      workspace_id: null,
      exempt: false,
    });
    await expect(service.resolveScopeForProject('gone')).resolves.toEqual({
      workspaceId: null,
      exempt: true,
    });

    repo.resolveSubject.mockRejectedValueOnce(new Error('boom'));
    await expect(service.resolveScopeForRoadmap('r-1')).resolves.toEqual({
      workspaceId: null,
      exempt: true,
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('entitlements_lookup_failed'),
    );
  });
});

// ---------------------------------------------------------------------------
// Counts
// ---------------------------------------------------------------------------

describe('EntitlementsService.assertWithinLimit', () => {
  it('never looks anything up when adding <= 0', async () => {
    const { service, repo, cache } = setup();
    await service.assertWithinLimit('ws-free', 'projects', { adding: 0 });
    await service.assertWithinLimit('ws-free', 'projects', { adding: -1 });
    expect(repo.getUsageCounts).not.toHaveBeenCalled();
    expect(repo.getPlanStates).not.toHaveBeenCalled();
    expect(cache.rememberJson).not.toHaveBeenCalled();
  });

  it('lets an exempt ref through without a lookup', async () => {
    const { service, repo, cache } = setup();
    await service.assertWithinLimit(null, 'projects', { adding: 5 });
    await service.assertWithinLimit(
      { workspaceId: 'ws-free', exempt: true },
      'projects',
      { adding: 5 },
    );
    expect(repo.getUsageCounts).not.toHaveBeenCalled();
    expect(cache.rememberJson).not.toHaveBeenCalled();
  });

  it('never runs the count query for an unlimited plan', async () => {
    const { service, repo } = setup();
    await service.assertWithinLimit('ws-business', 'projects', { adding: 1 });
    await service.assertWithinLimit('ws-pro', 'members', { adding: 1 });
    expect(repo.getUsageCounts).not.toHaveBeenCalled();
  });

  it('rejects at the limit with the exact body', async () => {
    const { service, repo } = setup();

    const error = await rejection(
      service.assertWithinLimit('ws-free', 'projects', { adding: 1 }),
    );

    expect(repo.getUsageCounts).toHaveBeenCalledWith(['ws-free']);
    expect(error).toBeInstanceOf(PlanLimitException);
    expect((error as PlanLimitException).getStatus()).toBe(403);
    expect((error as PlanLimitException).getResponse()).toEqual({
      code: 'plan_limit',
      kind: 'count',
      limit_key: 'projects',
      label: 'Projects',
      limit: 2,
      used: 2,
      plan: 'free',
      upgrade_plan: 'pro',
      workspace_id: 'ws-free',
      workspace_slug: 'acme',
      context: 'create',
      message:
        'Your Free plan includes 2 projects and this workspace has 2. Upgrade to Pro to add more.',
    });
  });

  it('allows below the limit', async () => {
    const { service } = setup();
    await expect(
      service.assertWithinLimit('ws-free', 'teams', { adding: 1 }),
    ).resolves.toBeUndefined();
  });

  it('uses opts.used instead of the database', async () => {
    const { service, repo } = setup();
    await expect(
      service.assertWithinLimit('ws-free', 'projects', { adding: 1, used: 1 }),
    ).resolves.toBeUndefined();
    await expect(
      service.assertWithinLimit('ws-free', 'projects', { adding: 2, used: 1 }),
    ).rejects.toBeInstanceOf(PlanLimitException);
    expect(repo.getUsageCounts).not.toHaveBeenCalled();
  });

  it('keeps grandfathered data: over the limit blocks only growth', async () => {
    const { service } = setup();
    await expect(
      service.assertWithinLimit('ws-free', 'projects', { adding: 0, used: 5 }),
    ).resolves.toBeUndefined();
    await expect(
      service.assertWithinLimit('ws-free', 'projects', { adding: 1, used: 5 }),
    ).rejects.toBeInstanceOf(PlanLimitException);
  });

  it('counts pending invites toward members only when asked (invite time)', async () => {
    const repo = buildRepo();
    repo.getUsageCounts.mockResolvedValue([
      {
        workspace_id: 'ws-free',
        members: 8,
        pending_invites: 2,
        projects: 0,
        teams: 0,
      },
    ]);
    const { service } = setup(repo);

    await expect(
      service.assertWithinLimit('ws-free', 'members', { adding: 1 }),
    ).resolves.toBeUndefined();

    const error = (await rejection(
      service.assertWithinLimit('ws-free', 'members', {
        adding: 1,
        includePendingInvites: true,
      }),
    )) as PlanLimitException;
    expect(error.payload).toMatchObject({
      limit_key: 'members',
      limit: 10,
      used: 10,
      context: 'invite',
      upgrade_plan: 'pro',
      message:
        'Your Free plan includes 10 members and this workspace has 10, counting pending invites. Upgrade to Pro to invite more.',
    });
  });

  it('speaks to the invitee on accept', async () => {
    const repo = buildRepo();
    repo.getUsageCounts.mockResolvedValue([
      {
        workspace_id: 'ws-free',
        members: 10,
        pending_invites: 1,
        projects: 0,
        teams: 0,
      },
    ]);
    const { service } = setup(repo);

    const error = (await rejection(
      service.assertWithinLimit('ws-free', 'members', {
        adding: 1,
        context: 'accept',
      }),
    )) as PlanLimitException;
    expect(error.payload.context).toBe('accept');
    expect(error.payload.message).toBe(
      'Acme has reached the 10-member limit of its Free plan. Ask a workspace owner to upgrade, then accept this invite again.',
    );
  });

  it('an unhomed resource has nothing to count, so workspace counts pass', async () => {
    const { service, repo } = setup();
    await expect(
      service.assertWithinLimit(
        { workspaceId: null, exempt: false },
        'projects',
        { adding: 50 },
      ),
    ).resolves.toBeUndefined();
    expect(repo.getUsageCounts).not.toHaveBeenCalled();
    expect(repo.getPlanStates).not.toHaveBeenCalled();
  });

  it('uses the effective plan, so a comp outranks Free', async () => {
    const { service, repo } = setup(
      buildRepo({
        'ws-comp': planRow('ws-comp', 'free', {
          is_discounted_free: true,
          discounted_plan: 'business',
          comp_active: true,
          effective_plan: 'business',
          plan_source: 'complimentary',
        }),
      }),
    );
    await service.assertWithinLimit('ws-comp', 'projects', { adding: 1 });
    expect(repo.getUsageCounts).not.toHaveBeenCalled();
  });

  it('fails open on a repository error and logs entitlements_lookup_failed', async () => {
    const repo = buildRepo();
    repo.getPlanStates.mockRejectedValue(
      new Error('relation "workspace_plan_state" does not exist'),
    );
    const { service } = setup(repo);

    await expect(
      service.assertWithinLimit('ws-free', 'projects', { adding: 1 }),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(
        /^entitlements_lookup_failed op=assert_within_limit:projects subject=ws-free/,
      ),
    );
  });

  it('fails open when the matrix cannot load, or the count fails', async () => {
    const repo = buildRepo();
    repo.listLimitKeys.mockRejectedValue(new Error('permission denied'));
    await expect(
      setup(repo).service.assertWithinLimit('ws-free', 'projects', {
        adding: 1,
      }),
    ).resolves.toBeUndefined();

    const repo2 = buildRepo();
    repo2.getUsageCounts.mockRejectedValue(new Error('timeout'));
    await expect(
      setup(repo2).service.assertWithinLimit('ws-free', 'projects', {
        adding: 1,
      }),
    ).resolves.toBeUndefined();
  });

  it('lets an HTTP error from a lookup propagate', async () => {
    const repo = buildRepo();
    repo.getPlanStates.mockRejectedValue(new NotFoundException('no'));
    await expect(
      setup(repo).service.assertWithinLimit('ws-free', 'projects', {
        adding: 1,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('follows an admin edit once the matrix is invalidated', async () => {
    const repo = buildRepo();
    const { service } = setup(repo);
    await expect(
      service.assertWithinLimit('ws-free', 'projects', { adding: 1 }),
    ).rejects.toBeInstanceOf(PlanLimitException);

    repo.listLimits.mockResolvedValue(
      buildSeedLimitRows([
        { plan: 'free', limit_key: 'projects', int_value: 5 },
      ]),
    );
    await service.invalidateLimits();
    await expect(
      service.assertWithinLimit('ws-free', 'projects', { adding: 1 }),
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Roadmap nodes
// ---------------------------------------------------------------------------

describe('EntitlementsService roadmap nodes', () => {
  const unhomed = { workspaceId: null, exempt: false };

  it('an unhomed roadmap gets Free’s 250', async () => {
    const { service } = setup();
    await expect(
      service.assertNodeWrite(unhomed, { previousCount: 249, newCount: 250 }),
    ).resolves.toBeUndefined();

    const error = (await rejection(
      service.assertNodeWrite(unhomed, {
        previousCount: 250,
        newCount: 251,
        context: 'full_state',
      }),
    )) as PlanLimitException;
    expect(error).toBeInstanceOf(PlanLimitException);
    expect(error.payload).toEqual({
      code: 'plan_limit',
      kind: 'count',
      limit_key: 'roadmap_nodes_per_roadmap',
      label: 'Roadmap nodes per roadmap',
      limit: 250,
      used: 250,
      plan: 'free',
      upgrade_plan: 'pro',
      workspace_id: null,
      workspace_slug: null,
      context: 'full_state',
      message:
        'This change would bring the roadmap to 251 nodes; the Free plan allows 250 per roadmap. Remove nodes or upgrade to Pro.',
    });
  });

  it('grandfathers a roadmap already over the limit', async () => {
    const { service, cache } = setup();
    await service.assertNodeWrite('ws-free', {
      previousCount: 300,
      newCount: 300,
    });
    await service.assertNodeWrite('ws-free', {
      previousCount: 300,
      newCount: 260,
    });
    // Neither grew, so nothing was even looked up.
    expect(cache.rememberJson).not.toHaveBeenCalled();

    await expect(
      service.assertNodeWrite('ws-free', { previousCount: 300, newCount: 301 }),
    ).rejects.toBeInstanceOf(PlanLimitException);
  });

  it('paid plans are unlimited; exempt refs pass', async () => {
    const { service } = setup();
    await expect(
      service.assertNodeWrite('ws-pro', { previousCount: 0, newCount: 5000 }),
    ).resolves.toBeUndefined();
    await expect(
      service.assertNodeWrite(null, { previousCount: 0, newCount: 5000 }),
    ).resolves.toBeUndefined();
  });

  it('nodeLimitViolation returns the payload instead of throwing', async () => {
    const { service } = setup();
    await expect(
      service.nodeLimitViolation('ws-free', {
        previousCount: 240,
        newCount: 262,
      }),
    ).resolves.toMatchObject({
      limit_key: 'roadmap_nodes_per_roadmap',
      limit: 250,
      used: 240,
      context: 'write',
      workspace_slug: 'acme',
    });
    await expect(
      service.nodeLimitViolation('ws-free', {
        previousCount: 10,
        newCount: 20,
      }),
    ).resolves.toBeNull();
  });

  it('node checks fail open', async () => {
    const repo = buildRepo();
    repo.getPlanStates.mockRejectedValue(new Error('down'));
    const { service } = setup(repo);
    await expect(
      service.assertNodeWrite('ws-free', { previousCount: 0, newCount: 999 }),
    ).resolves.toBeUndefined();
    await expect(
      service.nodeLimitViolation('ws-free', {
        previousCount: 0,
        newCount: 999,
      }),
    ).resolves.toBeNull();
  });

  it('countRoadmapNodes reads ai_context_roadmap_counts and fails open to 0', async () => {
    const repo = buildRepo();
    repo.countRoadmapNodes.mockResolvedValueOnce(new Map([['r-1', 42]]));
    const { service } = setup(repo);

    await expect(service.countRoadmapNodes('r-1')).resolves.toBe(42);
    expect(repo.countRoadmapNodes).toHaveBeenCalledWith(['r-1']);

    await expect(service.countRoadmapNodes('r-empty')).resolves.toBe(0);

    repo.countRoadmapNodes.mockRejectedValueOnce(new Error('down'));
    await expect(service.countRoadmapNodes('r-1')).resolves.toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Features
// ---------------------------------------------------------------------------

describe('EntitlementsService features', () => {
  it('assertFeature on Free names Pro as the upgrade', async () => {
    const { service } = setup();
    const error = (await rejection(
      service.assertFeature('ws-free', 'decisions'),
    )) as PlanLimitException;
    expect(error).toBeInstanceOf(PlanLimitException);
    expect(error.payload).toEqual({
      code: 'plan_limit',
      kind: 'feature',
      limit_key: 'decisions',
      label: 'Decision log',
      limit: null,
      used: null,
      plan: 'free',
      upgrade_plan: 'pro',
      workspace_id: 'ws-free',
      workspace_slug: 'acme',
      context: 'write',
      message: 'Decision log is available on Pro and above.',
    });
  });

  it('requires every key in a list and reports the first missing one', async () => {
    const { service } = setup();
    await expect(
      service.assertFeature('ws-pro', ['deliverables', 'deliverable_review']),
    ).resolves.toBeUndefined();

    const error = (await rejection(
      service.assertFeature('ws-pro', ['deliverables', 'roles_permissions'], {
        context: 'enable',
      }),
    )) as PlanLimitException;
    expect(error.payload).toMatchObject({
      limit_key: 'roles_permissions',
      plan: 'pro',
      upgrade_plan: 'business',
      context: 'enable',
      message: 'Roles and permissions are available on Business and above.',
    });
  });

  it('passes exempt refs and fails open on errors', async () => {
    const { service } = setup();
    await expect(
      service.assertFeature(null, 'change_requests'),
    ).resolves.toBeUndefined();

    const repo = buildRepo();
    repo.listLimits.mockRejectedValue(new Error('down'));
    await expect(
      setup(repo).service.assertFeature('ws-free', 'change_requests'),
    ).resolves.toBeUndefined();
  });

  it('an unhomed project is judged on Free', async () => {
    const { service } = setup();
    await expect(
      service.assertFeature({ workspaceId: null, exempt: false }, 'risks'),
    ).rejects.toBeInstanceOf(PlanLimitException);
  });

  it('hasFeature answers without throwing, failing open to true', async () => {
    const { service } = setup();
    await expect(service.hasFeature('ws-free', 'time_tracking')).resolves.toBe(
      false,
    );
    await expect(service.hasFeature('ws-pro', 'time_tracking')).resolves.toBe(
      true,
    );
    await expect(service.hasFeature(null, 'saml_scim')).resolves.toBe(true);

    const repo = buildRepo();
    repo.getPlanStates.mockRejectedValue(new Error('down'));
    await expect(
      setup(repo).service.hasFeature('ws-free', 'time_tracking'),
    ).resolves.toBe(true);
  });

  it('userHasFeatureInAnyWorkspace: any membership with the feature is enough', async () => {
    const repo = buildRepo();
    repo.listMemberWorkspaceIds.mockResolvedValue(['ws-free', 'ws-pro']);
    const { service, cache } = setup(repo);

    await expect(
      service.userHasFeatureInAnyWorkspace('u-1', 'mcp_server'),
    ).resolves.toBe(true);
    expect(cache.rememberJson).toHaveBeenCalledWith(
      'cache:v1:entitlements:user-workspaces:user:u-1',
      60,
      expect.any(Function),
    );
    await expect(
      service.userHasFeatureInAnyWorkspace('u-1', 'saml_scim'),
    ).resolves.toBe(false);
    // Memberships are cached per user, not per feature; each plan is read
    // through its workspace's own plan-state key.
    expect(repo.listMemberWorkspaceIds).toHaveBeenCalledTimes(1);
    expect(repo.getPlanStates).toHaveBeenCalledTimes(2);
    expect(
      cache.store.get('cache:v1:entitlements:user-workspaces:user:u-1'),
    ).toEqual(['ws-free', 'ws-pro']);
  });

  it('userHasFeatureInAnyWorkspace follows a plan change as soon as invalidateWorkspace runs', async () => {
    const plans: Record<string, WorkspacePlanStateRow> = {
      'ws-acme': planRow('ws-acme', 'free'),
    };
    const repo = buildRepo(plans);
    repo.listMemberWorkspaceIds.mockResolvedValue(['ws-acme']);
    const { service } = setup(repo);

    await expect(
      service.userHasFeatureInAnyWorkspace('u-1', 'mcp_server'),
    ).resolves.toBe(false);

    // Checkout completes: the webhook writes Pro and invalidates the workspace.
    plans['ws-acme'] = planRow('ws-acme', 'pro');
    await service.invalidateWorkspace('ws-acme');
    await expect(
      service.userHasFeatureInAnyWorkspace('u-1', 'mcp_server'),
    ).resolves.toBe(true);

    // A comp or subscription ends: the same key, the same immediacy.
    plans['ws-acme'] = planRow('ws-acme', 'free');
    await service.invalidateWorkspace('ws-acme');
    await expect(
      service.userHasFeatureInAnyWorkspace('u-1', 'mcp_server'),
    ).resolves.toBe(false);
    // The membership list itself stayed cached throughout.
    expect(repo.listMemberWorkspaceIds).toHaveBeenCalledTimes(1);
  });

  it('userHasFeatureInAnyWorkspace keeps its cached answer until the workspace is invalidated', async () => {
    const plans: Record<string, WorkspacePlanStateRow> = {
      'ws-acme': planRow('ws-acme', 'free'),
    };
    const repo = buildRepo(plans);
    repo.listMemberWorkspaceIds.mockResolvedValue(['ws-acme']);
    const { service } = setup(repo);

    await service.userHasFeatureInAnyWorkspace('u-1', 'mcp_server');
    plans['ws-acme'] = planRow('ws-acme', 'pro');

    // No invalidation: the cached Free plan state still answers.
    await expect(
      service.userHasFeatureInAnyWorkspace('u-1', 'mcp_server'),
    ).resolves.toBe(false);
  });

  it('userHasFeatureInAnyWorkspace: no workspace is judged on Free; errors fail open', async () => {
    const repo = buildRepo();
    const { service } = setup(repo);
    await expect(
      service.userHasFeatureInAnyWorkspace('u-none', 'mcp_server'),
    ).resolves.toBe(false);

    const failing = buildRepo();
    failing.listMemberWorkspaceIds.mockRejectedValue(new Error('down'));
    await expect(
      setup(failing).service.userHasFeatureInAnyWorkspace('u-1', 'mcp_server'),
    ).resolves.toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Limits, retention, usage
// ---------------------------------------------------------------------------

describe('EntitlementsService limits and retention', () => {
  it('getLimit: the plan value, null for unlimited, exempt, or failure', async () => {
    const { service } = setup();
    await expect(service.getLimit('ws-free', 'projects')).resolves.toBe(2);
    await expect(service.getLimit('ws-pro', 'projects')).resolves.toBe(10);
    await expect(
      service.getLimit('ws-business', 'projects'),
    ).resolves.toBeNull();
    await expect(
      service.getLimit(null, 'roadmap_nodes_per_roadmap'),
    ).resolves.toBeNull();
    await expect(
      service.getLimit(
        { workspaceId: null, exempt: false },
        'roadmap_nodes_per_roadmap',
      ),
    ).resolves.toBe(250);

    const repo = buildRepo();
    repo.listLimits.mockRejectedValue(new Error('down'));
    await expect(
      setup(repo).service.getLimit('ws-free', 'projects'),
    ).resolves.toBeNull();
  });

  it('getRetentionCutoff: 7 days on Free, 90 on Pro, none on Business', async () => {
    const { service } = setup();
    const now = new Date('2026-09-22T12:00:00.000Z');

    await expect(service.getRetentionCutoff('ws-free', now)).resolves.toEqual({
      days: 7,
      cutoff: '2026-09-15T12:00:00.000Z',
    });
    await expect(service.getRetentionCutoff('ws-pro', now)).resolves.toEqual({
      days: 90,
      cutoff: '2026-06-24T12:00:00.000Z',
    });
    await expect(
      service.getRetentionCutoff('ws-business', now),
    ).resolves.toEqual({ days: null, cutoff: null });
    await expect(service.getRetentionCutoff(null, now)).resolves.toEqual({
      days: null,
      cutoff: null,
    });

    const repo = buildRepo();
    repo.getPlanStates.mockRejectedValue(new Error('down'));
    await expect(
      setup(repo).service.getRetentionCutoff('ws-free', now),
    ).resolves.toEqual({ days: null, cutoff: null });
  });

  it('getUsageCounts reads zeros for a workspace with no row', async () => {
    const repo = buildRepo();
    repo.getUsageCounts.mockResolvedValue([]);
    await expect(setup(repo).service.getUsageCounts('ws-x')).resolves.toEqual({
      members: 0,
      pending_invites: 0,
      projects: 0,
      teams: 0,
    });
  });

  it('getLargestRoadmaps defaults to five', async () => {
    const { service, repo } = setup();
    await service.getLargestRoadmaps('ws-free');
    expect(repo.getLargestRoadmaps).toHaveBeenCalledWith('ws-free', 5);
    await service.getLargestRoadmaps('ws-free', 10);
    expect(repo.getLargestRoadmaps).toHaveBeenLastCalledWith('ws-free', 10);
  });

  it('display reads throw rather than fail open', async () => {
    const repo = buildRepo();
    repo.getUsageCounts.mockRejectedValue(new Error('down'));
    await expect(setup(repo).service.getUsageCounts('ws-free')).rejects.toThrow(
      'down',
    );
  });
});

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

describe('EntitlementsCoreModule', () => {
  it('resolves with only Supabase and the global Redis cache, importing no feature module', async () => {
    // Placeholders: the container compiles and never opens a connection.
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () => ({
              SUPABASE_URL: 'https://wiring-check.supabase.co',
              SUPABASE_ANON_KEY: 'anon-key-placeholder',
              SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-placeholder',
            }),
          ],
        }),
        RedisModule,
        EntitlementsCoreModule,
      ],
    }).compile();

    expect(moduleRef.get(EntitlementsService)).toBeInstanceOf(
      EntitlementsService,
    );
    expect(moduleRef.get(ENTITLEMENTS_REPOSITORY)).toBeInstanceOf(
      SupabaseEntitlementsRepository,
    );
    await moduleRef.close();
  });
});
