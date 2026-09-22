import {
  HttpException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { WorkspacesService } from '../../../execution/workspaces/workspaces.service';
import {
  PLAN_IDS,
  PLAN_RANK,
  type CompPlan,
  type LimitCell,
  type PlanId,
  type PlanSource,
} from '../entitlement-keys';
import {
  featureAvailableOn,
  featureEnabled,
  meterState,
  numericLimit,
} from '../entitlements.logic';
import {
  EntitlementsService,
  type LargestRoadmap,
} from '../entitlements.service';
import {
  WORKSPACE_USAGE_REPOSITORY,
  type WorkspaceUsageRepository,
} from '../repositories/workspace-usage.repository.interface';

/** How many of the largest roadmaps the page considers. */
const LARGEST_ROADMAPS = 5;

export interface RoadmapNodeUsage {
  roadmap_id: string;
  /** Null unless the viewer can open the roadmap: membership is not access. */
  name: string | null;
  project_id: string | null;
  project_title: string | null;
  nodes: number;
}

export interface WorkspaceUsageFeature {
  key: string;
  label: string;
  group: string;
  enabled: boolean;
  enforced: boolean;
  /** The cheapest plan that includes it; null when no plan does. */
  available_on: PlanId | null;
}

export interface WorkspaceUsage {
  workspace_id: string;
  plan: {
    effective: PlanId;
    source: PlanSource;
    complimentary: {
      plan: CompPlan;
      since: string | null;
      until: string | null;
    } | null;
  };
  /** Owners and admins only; null for everyone else. */
  subscription: { plan: PlanId; status: string | null } | null;
  /** The effective plan's cells. */
  limits: Record<string, LimitCell>;
  usage: {
    members: number;
    pending_invites: number;
    projects: number;
    teams: number;
  };
  /** Pending invites hold a member spot at invite time. */
  counts_pending_invites: true;
  roadmaps: {
    largest: RoadmapNodeUsage | null;
    near_limit: RoadmapNodeUsage[];
  };
  features: WorkspaceUsageFeature[];
  retention_days: number | null;
  upgrade_plan: PlanId | null;
  generated_at: string;
}

const PLANS_BY_RANK: readonly PlanId[] = [...PLAN_IDS].sort(
  (a, b) => PLAN_RANK[a] - PLAN_RANK[b],
);

/** The next plan up, or null at the top. */
function nextPlanAbove(plan: PlanId): PlanId | null {
  return PLANS_BY_RANK.find((p) => PLAN_RANK[p] > PLAN_RANK[plan]) ?? null;
}

/**
 * GET /api/workspaces/:workspaceId/usage: what the workspace's plan allows and
 * how much of it is in use.
 *
 * Readable by ANY member, because members hit limits too and the web shows
 * them why. Two things stay narrower than membership:
 *   - the subscription (what is billed, and its status) goes to owners and
 *     admins only, like the billing summary;
 *   - a roadmap's name and project appear only when the viewer can open that
 *     roadmap; otherwise the payload carries its size alone.
 */
@Injectable()
export class WorkspaceUsageService {
  private readonly logger = new Logger(WorkspaceUsageService.name);

  constructor(
    private readonly workspaces: WorkspacesService,
    private readonly entitlements: EntitlementsService,
    @Inject(WORKSPACE_USAGE_REPOSITORY)
    private readonly repo: WorkspaceUsageRepository,
  ) {}

  async getUsage(
    workspaceId: string,
    viewerId: string,
  ): Promise<WorkspaceUsage> {
    // 404 for a workspace that does not exist, 403 for a non-member: both
    // before anything about the plan is read.
    const workspace = await this.workspaces.fetchWorkspaceOrThrow(workspaceId);
    const role = await this.workspaces.assertCanRead(workspace, viewerId);

    try {
      const [state, matrix, counts, largest] = await Promise.all([
        this.entitlements.getEffectivePlan(workspaceId),
        this.entitlements.getLimitMatrix(),
        this.entitlements.getUsageCounts(workspaceId),
        this.entitlements.getLargestRoadmaps(workspaceId, LARGEST_ROADMAPS),
      ]);

      const effective = state.effective_plan;
      const limits = matrix.cells[effective] ?? {};
      const nodeLimit = numericLimit(limits.roadmap_nodes_per_roadmap);
      const viewable = await this.repo.filterViewableRoadmapIds(
        viewerId,
        largest.map((roadmap) => roadmap.roadmap_id),
      );
      const toUsage = (roadmap: LargestRoadmap): RoadmapNodeUsage => {
        const visible = viewable.has(roadmap.roadmap_id);
        return {
          roadmap_id: roadmap.roadmap_id,
          name: visible ? roadmap.name : null,
          project_id: visible ? roadmap.project_id : null,
          project_title: visible ? roadmap.project_title : null,
          nodes: roadmap.nodes,
        };
      };

      const comp = state.complimentary;
      return {
        workspace_id: workspaceId,
        plan: {
          effective,
          source: state.plan_source,
          complimentary:
            comp && comp.active
              ? { plan: comp.plan, since: comp.since, until: comp.until }
              : null,
        },
        subscription:
          role === 'owner' || role === 'admin'
            ? {
                plan: state.subscription_plan,
                status: state.subscription_status,
              }
            : null,
        limits,
        usage: counts,
        counts_pending_invites: true,
        roadmaps: {
          largest: largest[0] ? toUsage(largest[0]) : null,
          near_limit:
            nodeLimit === null
              ? []
              : largest
                  .filter((roadmap) =>
                    ['near', 'at', 'over'].includes(
                      meterState(roadmap.nodes, nodeLimit),
                    ),
                  )
                  .map(toUsage),
        },
        features: matrix.keys
          .filter((meta) => meta.kind === 'feature')
          .map((meta) => ({
            key: meta.key,
            label: meta.label,
            group: meta.group,
            enabled: featureEnabled(limits[meta.key]),
            enforced: meta.enforced,
            available_on: featureAvailableOn(matrix, meta.key),
          })),
        retention_days: numericLimit(limits.activity_retention_days),
        upgrade_plan: nextPlanAbove(effective),
        generated_at: new Date().toISOString(),
      };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      // Display only: a missing table (a database the migration has not
      // reached) or a lookup error degrades to a 503 the page can explain.
      this.logger.warn(
        `workspace_usage_failed workspace=${workspaceId} message=${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw new ServiceUnavailableException(
        'Plan usage is unavailable right now. Try again shortly.',
      );
    }
  }
}
