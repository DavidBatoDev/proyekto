import { HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import { CloudflareCachePurgeService } from '../../../common/cache/cloudflare-cache-purge.service';
import { REDIS_CACHE_KEYS } from '../../../common/cache/redis-cache.keys';
import { RedisDataCacheService } from '../../../common/cache/redis-data-cache.service';
import type {
  CountKey,
  EntitlementRef,
  EntitlementScope,
  FeatureKey,
  LimitCell,
  LimitMatrix,
  NumericLimitKey,
  PlanId,
  PlanLimitContext,
  WorkspacePlanState,
} from './entitlement-keys';
import {
  buildCountLimitPayload,
  buildFeatureLimitPayload,
  buildMatrix,
  defaultPlanState,
  featureEnabled,
  isLimitMatrix,
  numericLimit,
  toWorkspacePlanState,
  violatesGrandfatheredLimit,
} from './entitlements.logic';
import {
  PlanLimitException,
  type PlanLimitPayload,
} from './plan-limit.exception';
import {
  ENTITLEMENTS_REPOSITORY,
  type EntitlementsRepository,
  type EntitlementSubjectKind,
} from './repositories/entitlements.repository.interface';

export type {
  CompPlan,
  CountKey,
  EntitlementKey,
  EntitlementRef,
  EntitlementScope,
  FeatureKey,
  KeyMeta,
  LimitCell,
  LimitKind,
  LimitMatrix,
  NumericLimitKey,
  PlanId,
  PlanLimitContext,
  PlanSource,
  WorkspacePlanState,
} from './entitlement-keys';
export type { PlanLimitPayload } from './plan-limit.exception';
export {
  computeUpgradePlan,
  violatesGrandfatheredLimit,
} from './entitlements.logic';

/** In-process memo in front of Redis: an admin edit reaches every instance within this. */
const MATRIX_MEMO_MS = 15_000;
const MATRIX_TTL_SECONDS = 300;
const PLAN_STATE_TTL_SECONDS = 60;
const USER_WORKSPACES_TTL_SECONDS = 60;
const DAY_MS = 86_400_000;

/**
 * The workspaces a user belongs to, for the MCP coarse gate. Ids only, never
 * computed plans: each plan is read through the per-workspace plan-state key
 * that invalidateWorkspace drops, so a plan change (checkout, cancel, comp)
 * applies at once and a limits edit applies within the matrix memo. Only a
 * membership change waits out this key's TTL.
 */
const userWorkspacesCacheKey = (userId: string) =>
  `cache:v1:entitlements:user-workspaces:user:${userId}`;

export interface WorkspaceUsageCounts {
  members: number;
  pending_invites: number;
  projects: number;
  teams: number;
}

export interface LargestRoadmap {
  roadmap_id: string;
  name: string;
  project_id: string | null;
  project_title: string | null;
  owner_id: string;
  nodes: number;
}

/** A ref resolved to what a check needs. Exempt refs never load anything. */
type Resolved =
  | { exempt: true }
  | {
      exempt: false;
      workspaceId: string | null;
      plan: PlanId;
      state: WorkspacePlanState | null;
      matrix: LimitMatrix;
    };

const EXEMPT_SCOPE: EntitlementScope = { workspaceId: null, exempt: true };

function toScope(ref: EntitlementRef): EntitlementScope {
  if (ref === null || ref === undefined) return EXEMPT_SCOPE;
  if (typeof ref === 'string') {
    return { workspaceId: ref.trim() || null, exempt: false };
  }
  return { workspaceId: ref.workspaceId ?? null, exempt: ref.exempt === true };
}

function describeRef(ref: EntitlementRef): string {
  const scope = toScope(ref);
  if (scope.exempt) return 'exempt';
  return scope.workspaceId ?? 'unhomed';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * What a workspace's plan allows, and the checks that enforce it.
 *
 * Contract every caller relies on:
 *   - A write that does not grow a count (`adding <= 0`, or a node total that
 *     does not rise) is never checked, so grandfathered data stays editable.
 *   - An exempt ref (a guest's `null`, a guest-owned roadmap) always passes.
 *   - An unlimited cell passes WITHOUT running a count query, so paid plans
 *     pay only for cached lookups.
 *   - An unhomed resource (no workspace, not exempt) gets Free limits, but a
 *     workspace-scoped count has nothing to count and passes.
 *   - FAIL OPEN: any non-HTTP error during a lookup (a repository error, a
 *     relation missing because the migration has not reached this database)
 *     is logged as `entitlements_lookup_failed` and the write is allowed. A
 *     broken lookup must never block a customer.
 *
 * Checks sit AFTER the caller's permission check, so a non-member keeps
 * getting 403/404 and never learns anything about the plan.
 */
@Injectable()
export class EntitlementsService {
  private readonly logger = new Logger(EntitlementsService.name);
  private matrixMemo: { value: LimitMatrix; expiresAt: number } | null = null;
  private matrixInFlight: Promise<LimitMatrix> | null = null;
  /** Bumped by invalidateLimits so a load already in flight cannot re-memoize stale data. */
  private matrixGeneration = 0;
  private readonly reportedDrift = new Set<string>();

  constructor(
    @Inject(ENTITLEMENTS_REPOSITORY)
    private readonly repo: EntitlementsRepository,
    private readonly cache: RedisDataCacheService,
    private readonly cloudflarePurge: CloudflareCachePurgeService,
  ) {}

  // -------------------------------------------------------------------------
  // Plans
  // -------------------------------------------------------------------------

  /**
   * The workspace's effective plan, as workspace_plan_state decides it. A
   * workspace with no row reads as Free / default. Cached in Redis for 60s;
   * `fresh` reads the database directly (checkout, right after a comp).
   *
   * Throws on a lookup error: display paths decide their own fallback.
   */
  async getEffectivePlan(
    workspaceId: string,
    opts?: { fresh?: boolean },
  ): Promise<WorkspacePlanState> {
    const load = async (): Promise<WorkspacePlanState> => {
      const rows = await this.repo.getPlanStates([workspaceId]);
      const row = rows.find((r) => r.workspace_id === workspaceId);
      return row ? toWorkspacePlanState(row) : defaultPlanState(workspaceId);
    };
    if (opts?.fresh) return load();
    return this.cache.rememberJson(
      REDIS_CACHE_KEYS.entitlementsPlanState(workspaceId),
      PLAN_STATE_TTL_SECONDS,
      load,
    );
  }

  /** Batch and uncached, for list views. Every requested id gets an entry. */
  async getEffectivePlans(
    workspaceIds: string[],
  ): Promise<Map<string, WorkspacePlanState>> {
    const ids = [...new Set(workspaceIds.filter(Boolean))];
    const states = new Map<string, WorkspacePlanState>();
    if (ids.length === 0) return states;
    const rows = await this.repo.getPlanStates(ids);
    for (const row of rows) {
      states.set(row.workspace_id, toWorkspacePlanState(row));
    }
    for (const id of ids) {
      if (!states.has(id)) states.set(id, defaultPlanState(id));
    }
    return states;
  }

  /**
   * The whole limits table. Memoized in process for 15s, then Redis for 300s.
   * Concurrent callers share one load. Throws on a lookup error.
   */
  async getLimitMatrix(): Promise<LimitMatrix> {
    const memo = this.matrixMemo;
    if (memo && memo.expiresAt > Date.now()) return memo.value;
    if (this.matrixInFlight) return this.matrixInFlight;

    const generation = this.matrixGeneration;
    const load = this.loadMatrixThroughCache().then((matrix) => {
      if (generation === this.matrixGeneration) {
        this.matrixMemo = {
          value: matrix,
          expiresAt: Date.now() + MATRIX_MEMO_MS,
        };
      }
      this.reportDrift(matrix);
      return matrix;
    });
    const inFlight = load.finally(() => {
      if (this.matrixInFlight === inFlight) this.matrixInFlight = null;
    });
    this.matrixInFlight = inFlight;
    return inFlight;
  }

  /** One plan's cells. Keys missing from the database are absent (and fail open). */
  async getLimits(plan: PlanId): Promise<Record<string, LimitCell>> {
    const matrix = await this.getLimitMatrix();
    return matrix.cells[plan] ?? {};
  }

  // -------------------------------------------------------------------------
  // Scopes
  // -------------------------------------------------------------------------

  resolveScopeForProject(projectId: string): Promise<EntitlementScope> {
    return this.resolveScope('project', projectId);
  }

  resolveScopeForTeam(teamId: string): Promise<EntitlementScope> {
    return this.resolveScope('team', teamId);
  }

  /**
   * A linked roadmap answers to its project's workspace; an unlinked one to
   * its owner's default workspace; a guest-owned one is exempt.
   */
  resolveScopeForRoadmap(roadmapId: string): Promise<EntitlementScope> {
    return this.resolveScope('roadmap', roadmapId);
  }

  // -------------------------------------------------------------------------
  // Checks
  // -------------------------------------------------------------------------

  /** A numeric limit. Null = unlimited, exempt, or the lookup failed open. */
  async getLimit(
    ref: EntitlementRef,
    key: NumericLimitKey,
  ): Promise<number | null> {
    return this.failOpen('get_limit', describeRef(ref), null, async () => {
      const resolved = await this.resolve(ref);
      if (resolved.exempt) return null;
      return numericLimit(resolved.matrix.cells[resolved.plan]?.[key]);
    });
  }

  /**
   * Rejects a create that would take a workspace count past its limit.
   *
   * `used` skips the count query when the caller already knows it.
   * `includePendingInvites` counts pending invites toward members (invite
   * time only: at accept time the accepting invite is itself the pending one).
   */
  async assertWithinLimit(
    ref: EntitlementRef,
    key: CountKey,
    opts: {
      adding: number;
      includePendingInvites?: boolean;
      used?: number;
      context?: PlanLimitContext;
    },
  ): Promise<void> {
    if (!(opts.adding > 0)) return;
    const countsPendingInvites =
      key === 'members' && opts.includePendingInvites === true;
    const context: PlanLimitContext =
      opts.context ?? (countsPendingInvites ? 'invite' : 'create');

    const violation = await this.failOpen(
      `assert_within_limit:${key}`,
      describeRef(ref),
      null,
      async (): Promise<PlanLimitPayload | null> => {
        const resolved = await this.resolve(ref);
        if (resolved.exempt) return null;
        const limit = numericLimit(resolved.matrix.cells[resolved.plan]?.[key]);
        if (limit === null) return null;
        // Unhomed: Free limits, but there is no workspace to count.
        if (!resolved.workspaceId) return null;

        let used = opts.used;
        if (used === undefined) {
          const counts = await this.readUsageCounts(resolved.workspaceId);
          used =
            key === 'members'
              ? counts.members +
                (countsPendingInvites ? counts.pending_invites : 0)
              : counts[key];
        }
        if (used + opts.adding <= limit) return null;

        return buildCountLimitPayload(
          resolved.matrix,
          this.subjectOf(resolved),
          {
            key,
            limit,
            used,
            next: used + opts.adding,
            context,
            countsPendingInvites,
          },
        );
      },
    );
    if (violation) throw new PlanLimitException(violation);
  }

  /**
   * Rejects a roadmap write that grows the node total past the per-roadmap
   * limit. Grandfathered: a roadmap already over it can shrink or stay put.
   */
  async assertNodeWrite(
    ref: EntitlementRef,
    counts: {
      previousCount: number;
      newCount: number;
      context?: PlanLimitContext;
    },
  ): Promise<void> {
    const violation = await this.findNodeViolation(
      ref,
      counts,
      counts.context ?? 'write',
    );
    if (violation) throw new PlanLimitException(violation);
  }

  /** The same rule as assertNodeWrite, as a value: for preview validation issues. */
  nodeLimitViolation(
    ref: EntitlementRef,
    counts: { previousCount: number; newCount: number },
  ): Promise<PlanLimitPayload | null> {
    return this.findNodeViolation(ref, counts, 'write');
  }

  /**
   * epics + features + tasks (milestones excluded). Fails open to 0: callers
   * use it as the "before" count of a node check, and 0 lets the write through.
   */
  async countRoadmapNodes(roadmapId: string): Promise<number> {
    return this.failOpen(
      'count_roadmap_nodes',
      `roadmap:${roadmapId}`,
      0,
      async () => {
        const counts = await this.repo.countRoadmapNodes([roadmapId]);
        return counts.get(roadmapId) ?? 0;
      },
    );
  }

  /** Rejects when the plan lacks the feature; with several keys, all are required. */
  async assertFeature(
    ref: EntitlementRef,
    key: FeatureKey | readonly FeatureKey[],
    opts?: { context?: PlanLimitContext },
  ): Promise<void> {
    const keys: readonly FeatureKey[] =
      typeof key === 'string' ? [key] : [...key];
    if (keys.length === 0) return;
    const context = opts?.context ?? 'write';

    const violation = await this.failOpen(
      `assert_feature:${keys.join(',')}`,
      describeRef(ref),
      null,
      async (): Promise<PlanLimitPayload | null> => {
        const resolved = await this.resolve(ref);
        if (resolved.exempt) return null;
        const cells = resolved.matrix.cells[resolved.plan];
        const missing = keys.find((k) => !featureEnabled(cells?.[k]));
        if (!missing) return null;
        return buildFeatureLimitPayload(
          resolved.matrix,
          this.subjectOf(resolved),
          { key: missing, context },
        );
      },
    );
    if (violation) throw new PlanLimitException(violation);
  }

  /** Non-throwing, for read-only UI and conditional behaviour. Fails open to true. */
  async hasFeature(ref: EntitlementRef, key: FeatureKey): Promise<boolean> {
    return this.failOpen(
      `has_feature:${key}`,
      describeRef(ref),
      true,
      async () => {
        const resolved = await this.resolve(ref);
        if (resolved.exempt) return true;
        return featureEnabled(resolved.matrix.cells[resolved.plan]?.[key]);
      },
    );
  }

  /**
   * True when ANY workspace the user belongs to has the feature. The coarse
   * MCP gate: the identity is a user, and one user can sit in Free and Pro
   * workspaces at once. A user in no workspace is judged on Free.
   */
  async userHasFeatureInAnyWorkspace(
    userId: string,
    key: FeatureKey,
  ): Promise<boolean> {
    return this.failOpen(
      `user_has_feature:${key}`,
      `user:${userId}`,
      true,
      async () => {
        const [matrix, workspaceIds] = await Promise.all([
          this.getLimitMatrix(),
          this.cache.rememberJson<string[]>(
            userWorkspacesCacheKey(userId),
            USER_WORKSPACES_TTL_SECONDS,
            () => this.repo.listMemberWorkspaceIds(userId),
          ),
        ]);
        const ids = Array.isArray(workspaceIds)
          ? workspaceIds.filter((id) => typeof id === 'string' && id)
          : [];
        const states = await Promise.all(
          ids.map((id) => this.getEffectivePlan(id)),
        );
        const candidates: PlanId[] =
          states.length > 0
            ? [...new Set(states.map((s) => s.effective_plan))]
            : ['free'];
        return candidates.some((plan) =>
          featureEnabled(matrix.cells[plan]?.[key]),
        );
      },
    );
  }

  /**
   * The activity window. `cutoff` is the oldest timestamp still visible; both
   * null means unlimited (or exempt, or failed open). Nothing is purged.
   */
  async getRetentionCutoff(
    ref: EntitlementRef,
    now: Date = new Date(),
  ): Promise<{ days: number | null; cutoff: string | null }> {
    return this.failOpen(
      'retention_cutoff',
      describeRef(ref),
      { days: null, cutoff: null },
      async () => {
        const resolved = await this.resolve(ref);
        if (resolved.exempt) return { days: null, cutoff: null };
        const days = numericLimit(
          resolved.matrix.cells[resolved.plan]?.activity_retention_days,
        );
        if (days === null) return { days: null, cutoff: null };
        return {
          days,
          cutoff: new Date(now.getTime() - days * DAY_MS).toISOString(),
        };
      },
    );
  }

  // -------------------------------------------------------------------------
  // Usage (display; throws on a lookup error)
  // -------------------------------------------------------------------------

  async getUsageCounts(workspaceId: string): Promise<WorkspaceUsageCounts> {
    return this.readUsageCounts(workspaceId);
  }

  async getLargestRoadmaps(
    workspaceId: string,
    limit = 5,
  ): Promise<LargestRoadmap[]> {
    return this.repo.getLargestRoadmaps(workspaceId, limit);
  }

  // -------------------------------------------------------------------------
  // Invalidation
  // -------------------------------------------------------------------------

  /**
   * After anything that changes a workspace's plan: a provider write, a comp.
   * Every plan read goes through this one key, the MCP coarse gate's included
   * (it caches workspace ids, not plans), so nothing else needs dropping.
   */
  async invalidateWorkspace(workspaceId: string): Promise<void> {
    await this.cache.del(REDIS_CACHE_KEYS.entitlementsPlanState(workspaceId));
  }

  /**
   * After a limits edit: drops this instance's memo and the shared Redis copy,
   * and purges the public /api/plans edge copy. Other instances catch up when
   * their 15s memo expires.
   */
  async invalidateLimits(): Promise<void> {
    this.matrixGeneration += 1;
    this.matrixMemo = null;
    this.matrixInFlight = null;
    await Promise.all([
      this.cache.del(REDIS_CACHE_KEYS.entitlementsLimitMatrix),
      this.cloudflarePurge.purgePaths(['/api/plans']).catch((error) => {
        this.logger.warn(
          `entitlements_plans_purge_failed message=${errorMessage(error)}`,
        );
      }),
    ]);
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async loadMatrixThroughCache(): Promise<LimitMatrix> {
    const cached = await this.cache.rememberJson(
      REDIS_CACHE_KEYS.entitlementsLimitMatrix,
      MATRIX_TTL_SECONDS,
      () => this.loadMatrix(),
    );
    // A shape from an older build, or a corrupted entry: rebuild from source.
    return isLimitMatrix(cached) ? cached : this.loadMatrix();
  }

  private async loadMatrix(): Promise<LimitMatrix> {
    const [keyRows, limitRows] = await Promise.all([
      this.repo.listLimitKeys(),
      this.repo.listLimits(),
    ]);
    return buildMatrix(keyRows, limitRows);
  }

  /** Once per process per distinct drift, so a missing seed is loud but not a flood. */
  private reportDrift(matrix: LimitMatrix): void {
    const { missing_in_db, unknown_to_code } = matrix.drift;
    if (missing_in_db.length === 0 && unknown_to_code.length === 0) return;
    const signature = JSON.stringify(matrix.drift);
    if (this.reportedDrift.has(signature)) return;
    this.reportedDrift.add(signature);
    if (missing_in_db.length > 0) {
      this.logger.error(
        `entitlements_drift missing_in_db=${missing_in_db.join(',')} (failing open for these keys)`,
      );
    }
    if (unknown_to_code.length > 0) {
      this.logger.warn(
        `entitlements_drift unknown_to_code=${unknown_to_code.join(',')} (display only)`,
      );
    }
  }

  private async resolveScope(
    kind: EntitlementSubjectKind,
    id: string,
  ): Promise<EntitlementScope> {
    if (!id) return EXEMPT_SCOPE;
    return this.failOpen(
      `resolve_scope:${kind}`,
      `${kind}:${id}`,
      EXEMPT_SCOPE,
      async () => {
        const row = await this.repo.resolveSubject(kind, id);
        // Not found: nothing to enforce against; the caller's own lookup 404s.
        if (!row || !row.found) return EXEMPT_SCOPE;
        return { workspaceId: row.workspace_id ?? null, exempt: row.exempt };
      },
    );
  }

  private async resolve(ref: EntitlementRef): Promise<Resolved> {
    const scope = toScope(ref);
    if (scope.exempt) return { exempt: true };
    if (!scope.workspaceId) {
      const matrix = await this.getLimitMatrix();
      return {
        exempt: false,
        workspaceId: null,
        plan: 'free',
        state: null,
        matrix,
      };
    }
    const [matrix, state] = await Promise.all([
      this.getLimitMatrix(),
      this.getEffectivePlan(scope.workspaceId),
    ]);
    return {
      exempt: false,
      workspaceId: scope.workspaceId,
      plan: state.effective_plan,
      state,
      matrix,
    };
  }

  private subjectOf(resolved: Extract<Resolved, { exempt: false }>) {
    return {
      plan: resolved.plan,
      workspaceId: resolved.workspaceId,
      workspaceSlug: resolved.state?.workspace_slug ?? null,
      workspaceName: resolved.state?.workspace_name ?? null,
    };
  }

  private async readUsageCounts(
    workspaceId: string,
  ): Promise<WorkspaceUsageCounts> {
    const rows = await this.repo.getUsageCounts([workspaceId]);
    const row = rows.find((r) => r.workspace_id === workspaceId);
    return {
      members: row?.members ?? 0,
      pending_invites: row?.pending_invites ?? 0,
      projects: row?.projects ?? 0,
      teams: row?.teams ?? 0,
    };
  }

  private async findNodeViolation(
    ref: EntitlementRef,
    counts: { previousCount: number; newCount: number },
    context: PlanLimitContext,
  ): Promise<PlanLimitPayload | null> {
    // A write that does not grow the roadmap is never checked.
    if (!(counts.newCount > counts.previousCount)) return null;
    return this.failOpen('node_limit', describeRef(ref), null, async () => {
      const resolved = await this.resolve(ref);
      if (resolved.exempt) return null;
      const limit = numericLimit(
        resolved.matrix.cells[resolved.plan]?.roadmap_nodes_per_roadmap,
      );
      if (
        limit === null ||
        !violatesGrandfatheredLimit(
          limit,
          counts.previousCount,
          counts.newCount,
        )
      ) {
        return null;
      }
      return buildCountLimitPayload(resolved.matrix, this.subjectOf(resolved), {
        key: 'roadmap_nodes_per_roadmap',
        limit,
        used: counts.previousCount,
        next: counts.newCount,
        context,
      });
    });
  }

  /** HTTP errors propagate; anything else is logged and replaced by `fallback`. */
  private async failOpen<T>(
    operation: string,
    subject: string,
    fallback: T,
    run: () => Promise<T>,
  ): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.warn(
        `entitlements_lookup_failed op=${operation} subject=${subject} message=${errorMessage(error)}`,
      );
      return fallback;
    }
  }
}
