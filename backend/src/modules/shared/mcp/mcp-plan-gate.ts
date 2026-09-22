import { HttpException, Logger } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ProjectAuthorizationService } from '../../execution/projects/authorization/project-authorization.service';
import type { RoadmapAuthorizationService } from '../../execution/roadmaps/services/roadmap-authorization.service';
import type {
  EntitlementScope,
  EntitlementsService,
  LimitMatrix,
} from '../entitlements/entitlements.service';
import { buildFeatureLimitPayload } from '../entitlements/entitlements.logic';
import {
  isPlanLimitException,
  PlanLimitException,
} from '../entitlements/plan-limit.exception';
import {
  McpToolError,
  normalizeError,
  toErrorResult,
} from './tools/tool-helpers';

export interface McpPlanGateDeps {
  entitlements: EntitlementsService;
  roadmapAuthz: Pick<
    RoadmapAuthorizationService,
    'resolveRoadmapId' | 'canViewRoadmap'
  >;
  projectAuthz: Pick<ProjectAuthorizationService, 'resolvePermissions'>;
  /** Admin client, for the workspace-membership probe on the deny path only. */
  db: SupabaseClient;
}

type RoadmapChildRef = {
  epicId?: string;
  featureId?: string;
  taskId?: string;
  milestoneId?: string;
};

type Target =
  | { kind: 'project'; id: string }
  | { kind: 'roadmap'; id: string }
  | { kind: 'workspace'; id: string }
  | { kind: 'child'; refs: RoadmapChildRef[] };

interface ResolvedTarget {
  scope: EntitlementScope | string;
  /** Can the caller see the target? Asked only when the plan says no. */
  canAccess: () => Promise<boolean>;
}

/** Arguments naming the thing a call acts on, most specific scope first. */
const DIRECT_TARGETS = [
  ['project_id', 'project'],
  ['roadmap_id', 'roadmap'],
  ['workspace_id', 'workspace'],
] as const;

/** Roadmap children, resolved to their roadmap through the authz walker. */
const CHILD_TARGETS = [
  ['task_id', 'taskId'],
  ['epic_id', 'epicId'],
  ['feature_id', 'featureId'],
  ['milestone_id', 'milestoneId'],
] as const;

const NODE_TYPE_REF: Record<string, keyof RoadmapChildRef> = {
  epic: 'epicId',
  feature: 'featureId',
  task: 'taskId',
  milestone: 'milestoneId',
};

function stringArg(
  args: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = args[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** The first target a call's arguments name, or null for an untargeted call. */
export function pickPlanGateTarget(
  args: Record<string, unknown> | null | undefined,
): Target | null {
  if (!args || typeof args !== 'object') return null;
  for (const [key, kind] of DIRECT_TARGETS) {
    const id = stringArg(args, key);
    if (id) return { kind, id };
  }
  for (const [key, ref] of CHILD_TARGETS) {
    const id = stringArg(args, key);
    if (id) return { kind: 'child', refs: [{ [ref]: id }] };
  }
  const nodeId = stringArg(args, 'node_id');
  if (nodeId) {
    const typed = NODE_TYPE_REF[stringArg(args, 'node_type') ?? ''];
    // An untyped node id could be any of the four; try each in turn.
    const refs = typed
      ? [typed]
      : (['epicId', 'featureId', 'taskId', 'milestoneId'] as const);
    return { kind: 'child', refs: refs.map((ref) => ({ [ref]: nodeId })) };
  }
  return null;
}

/** `{ projectId }` from a resource template becomes `{ project_id }`. */
export function templateVariablesToArgs(
  variables: unknown,
): Record<string, unknown> | undefined {
  if (!variables || typeof variables !== 'object') return undefined;
  const args: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(variables)) {
    const value: unknown = Array.isArray(raw) ? raw[0] : raw;
    const snake = key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
    args[snake] = typeof value === 'string' ? value : undefined;
  }
  return args;
}

/**
 * The MCP server's plan gate: MCP access is itself the feature being sold
 * (`mcp_server`), so unlike the in-app feature gates it covers reads too.
 *
 * Per call rather than at token issuance: the identity is a user who can sit
 * in Free and Pro workspaces at once, an issuance check goes stale after a
 * downgrade (hosts refresh OAuth tokens silently), and a refused `initialize`
 * gives the host model nothing to relay. A refused call returns
 * `{ error: 'PLAN_LIMIT' }`, which it can.
 *
 * Two stages, both before the tool body runs:
 *   1. Coarse: some workspace the user belongs to includes MCP (memoized per
 *      request; EntitlementsService caches it 60s across requests).
 *   2. Precise: when the arguments name a target (project_id, roadmap_id,
 *      workspace_id, or a roadmap child id), that target's workspace must
 *      include it. A target that does not resolve passes, and the tool
 *      answers NOT_FOUND as it always did.
 *
 * A precise refusal is only surfaced to someone who can see the target;
 * anyone else passes through to the tool's own NOT_FOUND/FORBIDDEN, so a
 * guessed id never reveals a workspace's plan. Lookups fail open, like every
 * entitlements check.
 *
 * Known gap: untargeted list tools (projects_list, search_everything,
 * my_tasks_list, room-keyed chat reads) get the coarse stage only.
 */
export class McpPlanGate {
  private readonly logger = new Logger(McpPlanGate.name);
  private coarse: Promise<void> | null = null;
  private readonly precise = new Map<string, Promise<void>>();

  constructor(
    private readonly deps: McpPlanGateDeps,
    private readonly userId: string,
  ) {}

  async check(args?: Record<string, unknown> | null): Promise<void> {
    await this.checkCoarse();
    const target = pickPlanGateTarget(args);
    if (!target) return;
    const key = JSON.stringify(target);
    let pending = this.precise.get(key);
    if (!pending) {
      pending = this.checkTarget(target);
      this.precise.set(key, pending);
    }
    await pending;
  }

  private checkCoarse(): Promise<void> {
    this.coarse ??= this.runCoarse();
    return this.coarse;
  }

  private async runCoarse(): Promise<void> {
    const { entitlements } = this.deps;
    // Fails open to true on a lookup error, so false is a real answer.
    const allowed = await entitlements.userHasFeatureInAnyWorkspace(
      this.userId,
      'mcp_server',
    );
    if (allowed) return;
    let matrix: LimitMatrix;
    try {
      matrix = await entitlements.getLimitMatrix();
    } catch (error) {
      this.logLookupFailure('coarse', error);
      return;
    }
    // No single workspace is at fault, so the payload names none; the plan
    // is Free because none of the user's plans includes MCP.
    throw new PlanLimitException(
      buildFeatureLimitPayload(
        matrix,
        {
          plan: 'free',
          workspaceId: null,
          workspaceSlug: null,
          workspaceName: null,
        },
        { key: 'mcp_server', context: 'write' },
      ),
    );
  }

  private async checkTarget(target: Target): Promise<void> {
    let resolved: ResolvedTarget | null = null;
    try {
      resolved = await this.resolve(target);
      if (!resolved) return;
      await this.deps.entitlements.assertFeature(resolved.scope, 'mcp_server', {
        context: 'write',
      });
    } catch (error) {
      if (isPlanLimitException(error) && resolved) {
        if (await this.safeCanAccess(resolved)) throw error;
        return;
      }
      if (error instanceof HttpException) throw error;
      this.logLookupFailure(target.kind, error);
    }
  }

  private async resolve(target: Target): Promise<ResolvedTarget | null> {
    const { entitlements, roadmapAuthz, projectAuthz } = this.deps;
    switch (target.kind) {
      case 'project':
        return {
          scope: await entitlements.resolveScopeForProject(target.id),
          canAccess: async () =>
            (await projectAuthz.resolvePermissions(this.userId, target.id)) !==
            null,
        };
      case 'roadmap':
        return this.resolveRoadmap(target.id);
      case 'workspace':
        return {
          scope: target.id,
          canAccess: () => this.isWorkspaceMember(target.id),
        };
      case 'child': {
        for (const ref of target.refs) {
          const roadmapId = await roadmapAuthz.resolveRoadmapId(ref);
          if (roadmapId) return this.resolveRoadmap(roadmapId);
        }
        return null;
      }
    }
  }

  private async resolveRoadmap(roadmapId: string): Promise<ResolvedTarget> {
    return {
      scope: await this.deps.entitlements.resolveScopeForRoadmap(roadmapId),
      canAccess: () =>
        this.deps.roadmapAuthz.canViewRoadmap(roadmapId, this.userId),
    };
  }

  private async isWorkspaceMember(workspaceId: string): Promise<boolean> {
    const { data, error } = await this.deps.db
      .from('workspace_members')
      .select('user_id')
      .eq('workspace_id', workspaceId)
      .eq('user_id', this.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return Boolean(data);
  }

  /** An access probe that errors lets the call through; the tool re-checks. */
  private async safeCanAccess(resolved: ResolvedTarget): Promise<boolean> {
    try {
      return await resolved.canAccess();
    } catch (error) {
      this.logLookupFailure('access', error);
      return false;
    }
  }

  private logLookupFailure(stage: string, error: unknown): void {
    this.logger.warn(
      `mcp_plan_gate_lookup_failed stage=${stage} user=${this.userId} message=${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

type AnyCallback = (...args: unknown[]) => unknown;

/**
 * Put the gate in front of every tool and resource registered on `server`
 * from now on, current and future, with no per-tool edits.
 *
 * Tools: the SDK calls `cb(args, extra)` when a tool has an inputSchema and
 * `cb(extra)` when it has none, so only the former has arguments to target.
 * A refusal is the same structured error result runTool produces.
 *
 * Resources cannot return an error result, so a refusal is thrown as an
 * McpToolError, the way the resources' own scope and access checks fail.
 * Template variables (`{projectId}`) target like tool arguments.
 *
 * Returns `ungateResources`, for the static MCP App shell: it carries no
 * data, and a host must be able to load it to render any tool result.
 */
export function installMcpPlanGate(
  server: McpServer,
  gate: McpPlanGate,
): { ungateResources: () => void } {
  const target = server as unknown as {
    registerTool: AnyCallback;
    registerResource: AnyCallback;
  };
  const registerTool = target.registerTool;
  const registerResource = target.registerResource;

  target.registerTool = (name: unknown, config: unknown, callback: unknown) => {
    const hasInput = Boolean(
      (config as { inputSchema?: unknown } | null)?.inputSchema,
    );
    const handler = callback as AnyCallback;
    const gated = async (...callArgs: unknown[]) => {
      try {
        await gate.check(
          hasInput ? (callArgs[0] as Record<string, unknown>) : undefined,
        );
      } catch (error) {
        return toErrorResult(error);
      }
      return handler(...callArgs);
    };
    return registerTool.call(server, name, config, gated);
  };

  target.registerResource = (
    name: unknown,
    uriOrTemplate: unknown,
    config: unknown,
    callback: unknown,
  ) => {
    const isTemplate = typeof uriOrTemplate !== 'string';
    const handler = callback as AnyCallback;
    const gated = async (...callArgs: unknown[]) => {
      try {
        await gate.check(
          isTemplate ? templateVariablesToArgs(callArgs[1]) : undefined,
        );
      } catch (error) {
        const { code, message } = normalizeError(error);
        throw new McpToolError(code, message);
      }
      return handler(...callArgs);
    };
    return registerResource.call(server, name, uriOrTemplate, config, gated);
  };

  return {
    ungateResources: () => {
      target.registerResource = registerResource;
    },
  };
}
