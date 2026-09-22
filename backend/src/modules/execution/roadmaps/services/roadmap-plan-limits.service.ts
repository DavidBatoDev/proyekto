import { Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_ADMIN } from '../../../../config/supabase.module';
import {
  EntitlementsService,
  type EntitlementScope,
  type PlanLimitContext,
} from '../../../shared/entitlements/entitlements.service';
import type { RoadmapValidationIssueDto } from '../dto/roadmap-ai.dto';

/**
 * Which roadmap a check is about. Either the authz walk's RoadmapWriteContext
 * (camelCase) or a roadmap row (snake_case) fits, so callers pass what they
 * already hold. `roadmapId`/`id` null means the roadmap does not exist yet
 * (a create-full of a new roadmap, a template instantiation): the scope then
 * comes from the project, else from the would-be owner.
 */
export type RoadmapPlanTarget =
  | {
      roadmapId?: string | null;
      projectId?: string | null;
      ownerId?: string | null;
    }
  | {
      id?: string | null;
      project_id?: string | null;
      owner_id?: string | null;
    };

interface NormalizedTarget {
  roadmapId: string | null;
  projectId: string | null;
  ownerId: string | null;
}

/** `live`: read the stored node count, and only when the limit is finite. */
export type PreviousNodeCount = number | 'live';

const NODE_LIMIT_KEY = 'roadmap_nodes_per_roadmap';
const EXEMPT_SCOPE: EntitlementScope = { workspaceId: null, exempt: true };

/**
 * Scopes change rarely (a link, a deleted workspace), so a short in-process
 * memo turns the per-create scope lookup into a map read on busy roadmaps.
 * Per-node creates pass the authz walk's fresh projectId, so a link made a
 * moment ago is never judged by the stale standalone answer.
 */
const SCOPE_MEMO_TTL_MS = 30_000;
const SCOPE_MEMO_MAX_ENTRIES = 1_000;

function normalizeTarget(target: RoadmapPlanTarget): NormalizedTarget {
  if ('roadmapId' in target || 'projectId' in target || 'ownerId' in target) {
    return {
      roadmapId: target.roadmapId ?? null,
      projectId: target.projectId ?? null,
      ownerId: target.ownerId ?? null,
    };
  }
  const row = target as { id?: string | null } & {
    project_id?: string | null;
    owner_id?: string | null;
  };
  return {
    roadmapId: row.id ?? null,
    projectId: row.project_id ?? null,
    ownerId: row.owner_id ?? null,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type QueryError = { message: string } | null;

/**
 * The per-roadmap node limit (`roadmap_nodes_per_roadmap`) and the activity
 * retention window, for every roadmap write and history read.
 *
 * Three shapes of check, all built on EntitlementsService:
 *   - per-node creates (`assertCanAdd`): reject when the stored count plus the
 *     nodes being added would pass the limit;
 *   - full-state writes (`assertFullStateWrite`, `previewIssue`): the
 *     grandfather rule, reject only when the new total is over the limit AND
 *     above the previous total, so an over-limit roadmap stays editable and
 *     can always shrink;
 *   - links and unlinks (`assertCanLink`, `assertCanUnlink`): a roadmap
 *     moving into another workspace must fit that workspace's plan.
 *
 * Cost contract: an unlimited plan (and an exempt guest roadmap) never runs a
 * count query; it pays the scope lookup plus the cached plan read. Every
 * lookup fails open (EntitlementsService's rule): a broken read never blocks
 * a write. Call sites sit after the permission check.
 */
@Injectable()
export class RoadmapPlanLimitsService {
  private readonly logger = new Logger(RoadmapPlanLimitsService.name);
  private readonly scopeMemo = new Map<
    string,
    { scope: EntitlementScope; expiresAt: number }
  >();

  constructor(
    private readonly entitlements: EntitlementsService,
    @Inject(SUPABASE_ADMIN) private readonly db: SupabaseClient,
  ) {}

  // -------------------------------------------------------------------------
  // Node limits
  // -------------------------------------------------------------------------

  /**
   * Rejects a create of `adding` nodes (epics + features + tasks) that would
   * take the roadmap past its plan's limit. A roadmap not created yet
   * (`roadmapId` null) counts from 0.
   */
  async assertCanAdd(target: RoadmapPlanTarget, adding: number): Promise<void> {
    if (!(adding > 0)) return;
    const ref = normalizeTarget(target);
    const scope = await this.scopeFor(ref);
    const limit = await this.nodeLimit(scope);
    if (limit === null) return;
    const current = ref.roadmapId ? await this.countNodes(ref.roadmapId) : 0;
    if (current + adding <= limit) return;
    await this.entitlements.assertNodeWrite(scope, {
      previousCount: current,
      newCount: current + adding,
      context: 'create',
    });
  }

  /**
   * A write that replaces the whole tree (AI commit, discard/rollback, the
   * JSON-patch and create-full paths). Grandfathered: only growth past the
   * limit is rejected. A numeric `previous` that the new total does not
   * exceed returns before any lookup.
   */
  async assertFullStateWrite(
    target: RoadmapPlanTarget,
    previous: PreviousNodeCount,
    next: number,
  ): Promise<void> {
    if (typeof previous === 'number' && !(next > previous)) return;
    const ref = normalizeTarget(target);
    const scope = await this.scopeFor(ref);
    await this.assertNodeTotal(scope, {
      previous:
        previous === 'live'
          ? () => (ref.roadmapId ? this.countNodes(ref.roadmapId) : 0)
          : previous,
      next,
      context: 'full_state',
    });
  }

  /**
   * The lowest-level node check, for a caller that resolved the scope itself
   * (create-full compares two scopes; a template counts before the roadmap
   * exists). `previous` may be a loader, run only when the limit is finite
   * and the new total is over it.
   */
  async assertNodeTotal(
    scope: EntitlementScope,
    counts: {
      previous: number | (() => number | Promise<number>);
      next: number;
      context: PlanLimitContext;
    },
  ): Promise<void> {
    const limit = await this.nodeLimit(scope);
    if (limit === null || counts.next <= limit) return;
    const previousCount =
      typeof counts.previous === 'function'
        ? await counts.previous()
        : counts.previous;
    await this.entitlements.assertNodeWrite(scope, {
      previousCount,
      newCount: counts.next,
      context: counts.context,
    });
  }

  /**
   * The full-state rule as a preview validation issue (severity error), so a
   * caller sees the limit before it commits. Null when the change is allowed.
   */
  async previewIssue(
    target: RoadmapPlanTarget,
    previous: number,
    next: number,
  ): Promise<RoadmapValidationIssueDto | null> {
    if (!(next > previous)) return null;
    const ref = normalizeTarget(target);
    const scope = await this.scopeFor(ref);
    const violation = await this.entitlements.nodeLimitViolation(scope, {
      previousCount: previous,
      newCount: next,
    });
    if (!violation) return null;
    return {
      code: 'PLAN_LIMIT',
      severity: 'error',
      path: '/roadmap',
      message: violation.message,
      ...(ref.roadmapId
        ? { node_ref: { type: 'roadmap' as const, id: ref.roadmapId } }
        : {}),
    };
  }

  /**
   * A roadmap being linked to `targetProjectId` must fit the destination
   * workspace's plan. Moving within one workspace is never checked (and never
   * counts). The count is the roadmap's stored total, judged from 0.
   */
  async assertCanLink(
    roadmap: RoadmapPlanTarget,
    targetProjectId: string,
  ): Promise<void> {
    const ref = normalizeTarget(roadmap);
    const [source, target] = await Promise.all([
      this.scopeFor(ref),
      this.scopeForProject(targetProjectId),
    ]);
    if (target.exempt) return;
    if (
      !source.exempt &&
      source.workspaceId !== null &&
      source.workspaceId === target.workspaceId
    ) {
      return;
    }
    if (!ref.roadmapId) return;
    const limit = await this.nodeLimit(target);
    if (limit === null) return;
    const nodes = await this.countNodes(ref.roadmapId);
    if (nodes <= limit) return;
    await this.entitlements.assertNodeWrite(target, {
      previousCount: 0,
      newCount: nodes,
      context: 'link',
    });
  }

  /**
   * Unlinking a roadmap from its project (project_id set to null) re-homes it
   * to its owner's default workspace, so it must fit that plan: the link rule
   * with the owner's scope as the destination, judged from 0, exactly as a
   * create-full that unlinks is judged. Staying in the same workspace is never
   * checked (and never counts).
   */
  async assertCanUnlink(roadmap: RoadmapPlanTarget): Promise<void> {
    const ref = normalizeTarget(roadmap);
    if (!ref.roadmapId || !ref.projectId || !ref.ownerId) return;
    const [source, target] = await Promise.all([
      this.scopeForProject(ref.projectId),
      this.scopeForOwner(ref.ownerId),
    ]);
    if (target.exempt) return;
    if (
      source.exempt === target.exempt &&
      source.workspaceId === target.workspaceId
    ) {
      return;
    }
    const limit = await this.nodeLimit(target);
    if (limit === null) return;
    const nodes = await this.countNodes(ref.roadmapId);
    if (nodes <= limit) return;
    await this.entitlements.assertNodeWrite(target, {
      previousCount: 0,
      newCount: nodes,
      context: 'link',
    });
  }

  /** The stored epics + features + tasks. Fails open to 0. */
  countNodes(roadmapId: string): Promise<number> {
    return this.entitlements.countRoadmapNodes(roadmapId);
  }

  // -------------------------------------------------------------------------
  // Retention
  // -------------------------------------------------------------------------

  /**
   * The oldest timestamp a history read may return for this roadmap's plan,
   * or null for no cutoff (unlimited, exempt, or failed open). Rows older
   * than it are hidden, never purged.
   */
  async retentionCutoff(target: RoadmapPlanTarget): Promise<string | null> {
    const scope = await this.scopeFor(normalizeTarget(target));
    const { cutoff } = await this.entitlements.getRetentionCutoff(scope);
    return cutoff;
  }

  // -------------------------------------------------------------------------
  // Scopes
  // -------------------------------------------------------------------------

  /**
   * The plan a roadmap answers to: its project's workspace; else, for an
   * existing standalone roadmap, EntitlementsService's roadmap rule (the
   * owner's default workspace, exempt when a guest owns it); else, for a
   * roadmap not created yet, the would-be owner under the same rule.
   */
  scopeFor(target: RoadmapPlanTarget): Promise<EntitlementScope> {
    const ref = normalizeTarget(target);
    if (ref.projectId) return this.scopeForProject(ref.projectId);
    if (ref.roadmapId) {
      const roadmapId = ref.roadmapId;
      return this.memoScope(`roadmap:${roadmapId}`, () =>
        this.entitlements.resolveScopeForRoadmap(roadmapId),
      );
    }
    if (ref.ownerId) return this.scopeForOwner(ref.ownerId);
    return Promise.resolve(EXEMPT_SCOPE);
  }

  scopeForProject(projectId: string): Promise<EntitlementScope> {
    return this.memoScope(`project:${projectId}`, () =>
      this.entitlements.resolveScopeForProject(projectId),
    );
  }

  /**
   * A would-be standalone owner, mirroring entitlement_subject's roadmap
   * branch: `user_default_workspace_id(owner)`, exempt only for a guest with
   * no workspace. Read-only; never provisions. Fails open (exempt), and a
   * failed read is not memoized.
   */
  async scopeForOwner(ownerId: string): Promise<EntitlementScope> {
    const key = `owner:${ownerId}`;
    const hit = this.readMemo(key);
    if (hit) return hit;
    try {
      const [workspace, profile] = await Promise.all([
        this.db.rpc('user_default_workspace_id', {
          p_user_id: ownerId,
        }) as unknown as Promise<{ data: unknown; error: QueryError }>,
        this.db
          .from('profiles')
          .select('is_guest')
          .eq('id', ownerId)
          .maybeSingle() as unknown as Promise<{
          data: { is_guest?: boolean | null } | null;
          error: QueryError;
        }>,
      ]);
      if (workspace.error) throw new Error(workspace.error.message);
      if (profile.error) throw new Error(profile.error.message);
      const workspaceId =
        typeof workspace.data === 'string' && workspace.data
          ? workspace.data
          : null;
      const scope: EntitlementScope = {
        workspaceId,
        exempt: !workspaceId && profile.data?.is_guest === true,
      };
      this.writeMemo(key, scope);
      return scope;
    } catch (error) {
      this.logger.warn(
        `entitlements_lookup_failed op=resolve_scope:owner subject=user:${ownerId} message=${errorMessage(error)}`,
      );
      return EXEMPT_SCOPE;
    }
  }

  /**
   * The scope's per-roadmap node limit; null = unlimited, exempt, or failed
   * open. For a caller that must decide whether counting is worth it at all.
   */
  nodeLimit(scope: EntitlementScope): Promise<number | null> {
    if (scope.exempt) return Promise.resolve(null);
    return this.entitlements.getLimit(scope, NODE_LIMIT_KEY);
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async memoScope(
    key: string,
    load: () => Promise<EntitlementScope>,
  ): Promise<EntitlementScope> {
    const hit = this.readMemo(key);
    if (hit) return hit;
    const scope = await load();
    // An exempt answer is also what a failed lookup falls back to, so it is
    // never memoized: one transient error must not switch enforcement off
    // for the whole TTL. (Guest roadmaps, the real exempt case, are rare.)
    if (!scope.exempt) this.writeMemo(key, scope);
    return scope;
  }

  private readMemo(key: string): EntitlementScope | null {
    const hit = this.scopeMemo.get(key);
    if (!hit) return null;
    if (hit.expiresAt <= Date.now()) {
      this.scopeMemo.delete(key);
      return null;
    }
    return hit.scope;
  }

  private writeMemo(key: string, scope: EntitlementScope): void {
    if (
      !this.scopeMemo.has(key) &&
      this.scopeMemo.size >= SCOPE_MEMO_MAX_ENTRIES
    ) {
      // Insertion order: drop the oldest entry.
      const oldest = this.scopeMemo.keys().next().value as string | undefined;
      if (oldest !== undefined) this.scopeMemo.delete(oldest);
    }
    this.scopeMemo.set(key, {
      scope,
      expiresAt: Date.now() + SCOPE_MEMO_TTL_MS,
    });
  }
}
