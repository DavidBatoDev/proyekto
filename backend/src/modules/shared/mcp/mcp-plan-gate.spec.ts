/* eslint-disable @typescript-eslint/unbound-method --
 * The entitlements double is a jest.Mocked<EntitlementsService>; passing its
 * members to expect() is an identity check on the mock, never a call, so
 * `this` scoping is irrelevant. */
import {
  buildSeedKeyRows,
  buildSeedLimitRows,
  denyingEntitlements,
} from '../entitlements/__entitlements-test-kit-spec';
import { buildMatrix } from '../entitlements/entitlements.logic';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { PlanLimitException } from '../entitlements/plan-limit.exception';
import type {
  EntitlementsRepository,
  EntitlementSubjectKind,
  EntitlementSubjectRow,
  WorkspacePlanStateRow,
} from '../entitlements/repositories/entitlements.repository.interface';
import {
  installMcpPlanGate,
  McpPlanGate,
  pickPlanGateTarget,
  templateVariablesToArgs,
} from './mcp-plan-gate';
import { MCP_ALL_SCOPES } from './mcp-scopes';
import { McpServerFactory } from './mcp-server.factory';
import { ROADMAP_SUMMARY_APP_URI } from './roadmap-app';
import { McpToolError } from './tools/tool-helpers';

/**
 * The MCP server's per-call plan gate.
 *
 * The gate runs against a REAL EntitlementsService over a fake repository, so
 * the plan resolution (effective plan, scope, the seeded limits table) is the
 * production code path; only the database rows are invented:
 *
 *   ws-free  Free  -> project p-free, roadmap r-free
 *   ws-pro   Pro   -> project p-pro,  roadmap r-pro
 */

const USER = 'user-1';

function planRow(id: string, plan: string): WorkspacePlanStateRow {
  return {
    workspace_id: id,
    workspace_name: id,
    workspace_slug: id,
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

const PLANS: Record<string, WorkspacePlanStateRow> = {
  'ws-free': planRow('ws-free', 'free'),
  'ws-pro': planRow('ws-pro', 'pro'),
};

const SUBJECTS: Record<string, EntitlementSubjectRow> = {
  'project:p-free': { found: true, workspace_id: 'ws-free', exempt: false },
  'project:p-pro': { found: true, workspace_id: 'ws-pro', exempt: false },
  'roadmap:r-free': { found: true, workspace_id: 'ws-free', exempt: false },
  'roadmap:r-pro': { found: true, workspace_id: 'ws-pro', exempt: false },
};

function realEntitlements(memberOf: string[]) {
  const repo = {
    listLimitKeys: jest.fn(() => Promise.resolve(buildSeedKeyRows())),
    listLimits: jest.fn(() => Promise.resolve(buildSeedLimitRows())),
    getPlanStates: jest.fn((ids: string[]) =>
      Promise.resolve(ids.map((id) => PLANS[id]).filter(Boolean)),
    ),
    getUsageCounts: jest.fn(() => Promise.resolve([])),
    getLargestRoadmaps: jest.fn(() => Promise.resolve([])),
    resolveSubject: jest.fn((kind: EntitlementSubjectKind, id: string) =>
      Promise.resolve(
        SUBJECTS[`${kind}:${id}`] ?? {
          found: false,
          workspace_id: null,
          exempt: false,
        },
      ),
    ),
    countRoadmapNodes: jest.fn(() => Promise.resolve(new Map())),
    listMemberWorkspaceIds: jest.fn(() => Promise.resolve(memberOf)),
  };
  const cache = {
    rememberJson: jest.fn(
      (_key: string, _ttl: number, load: () => Promise<unknown>) => load(),
    ),
    del: jest.fn(() => Promise.resolve()),
  };
  const purge = { purgePaths: jest.fn(() => Promise.resolve()) };
  const service = new EntitlementsService(
    repo as EntitlementsRepository,
    cache as never,
    purge as never,
  );
  return { service, repo };
}

function buildGate(
  options: {
    memberOf?: string[];
    /** Projects the caller can see. */
    visibleProjects?: string[];
    /** Roadmaps the caller can see. */
    visibleRoadmaps?: string[];
    /** Child id -> roadmap id, per ref kind. */
    children?: Record<string, string>;
    workspaceMember?: boolean;
  } = {},
) {
  const { service, repo } = realEntitlements(
    options.memberOf ?? ['ws-free', 'ws-pro'],
  );
  const visibleProjects = options.visibleProjects ?? ['p-free', 'p-pro'];
  const visibleRoadmaps = options.visibleRoadmaps ?? ['r-free', 'r-pro'];
  const children = options.children ?? {};
  const projectAuthz = {
    resolvePermissions: jest.fn((_user: string, projectId: string) =>
      Promise.resolve(
        visibleProjects.includes(projectId)
          ? { roadmap: { view: true } }
          : null,
      ),
    ),
  };
  const roadmapAuthz = {
    resolveRoadmapId: jest.fn((ref: Record<string, string | undefined>) => {
      const [kind, id] = Object.entries(ref).find(([, v]) => v) ?? [];
      return Promise.resolve(children[`${kind}:${id}`] ?? null);
    }),
    canViewRoadmap: jest.fn((roadmapId: string) =>
      Promise.resolve(visibleRoadmaps.includes(roadmapId)),
    ),
  };
  const membership = {
    data: options.workspaceMember === false ? null : { user_id: USER },
    error: null,
  };
  const db = {
    from: jest.fn(() => {
      const query: Record<string, unknown> = {};
      for (const m of ['select', 'eq']) query[m] = jest.fn(() => query);
      query.maybeSingle = jest.fn(() => Promise.resolve(membership));
      return query;
    }),
  };
  const gate = new McpPlanGate(
    {
      entitlements: service,
      roadmapAuthz: roadmapAuthz as never,
      projectAuthz: projectAuthz as never,
      db: db as never,
    },
    USER,
  );
  return { gate, service, repo, projectAuthz, roadmapAuthz, db };
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => null,
    (error: unknown) => error,
  );
}

describe('McpPlanGate', () => {
  describe('coarse: some workspace must include MCP', () => {
    it('refuses a user whose only workspace is on Free', async () => {
      const { gate } = buildGate({ memberOf: ['ws-free'] });

      const error = await rejection(gate.check({}));

      expect(error).toBeInstanceOf(PlanLimitException);
      const payload = (error as PlanLimitException).payload;
      expect(payload).toMatchObject({
        code: 'plan_limit',
        kind: 'feature',
        limit_key: 'mcp_server',
        plan: 'free',
        upgrade_plan: 'pro',
        workspace_id: null,
      });
      expect(payload.message).toBe('MCP server is available on Pro and above.');
    });

    it('judges a user in no workspace on Free', async () => {
      const { gate } = buildGate({ memberOf: [] });
      await expect(gate.check()).rejects.toBeInstanceOf(PlanLimitException);
    });

    it('lets an untargeted call through once any workspace has it', async () => {
      const { gate } = buildGate({ memberOf: ['ws-free', 'ws-pro'] });
      await expect(gate.check({ limit: 10 })).resolves.toBeUndefined();
    });

    it('asks once per request, however many calls it makes', async () => {
      const { gate, service } = buildGate();
      const spy = jest.spyOn(service, 'userHasFeatureInAnyWorkspace');

      await gate.check({});
      await gate.check({ project_id: 'p-pro' });
      await gate.check();

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(USER, 'mcp_server');
    });
  });

  describe('precise: the targeted workspace must include MCP', () => {
    it('refuses a Free project even when the user also has a Pro workspace', async () => {
      const { gate } = buildGate();

      const error = await rejection(gate.check({ project_id: 'p-free' }));

      expect(error).toBeInstanceOf(PlanLimitException);
      expect((error as PlanLimitException).payload).toMatchObject({
        limit_key: 'mcp_server',
        plan: 'free',
        workspace_id: 'ws-free',
      });
    });

    it('allows a Pro project', async () => {
      const { gate } = buildGate();
      await expect(
        gate.check({ project_id: 'p-pro' }),
      ).resolves.toBeUndefined();
    });

    it('prefers project_id over roadmap_id over workspace_id', async () => {
      const { gate } = buildGate();
      await expect(
        gate.check({
          project_id: 'p-pro',
          roadmap_id: 'r-free',
          workspace_id: 'ws-free',
        }),
      ).resolves.toBeUndefined();
      await expect(
        gate.check({ roadmap_id: 'r-free', workspace_id: 'ws-pro' }),
      ).rejects.toBeInstanceOf(PlanLimitException);
    });

    it('judges a named workspace directly', async () => {
      const { gate } = buildGate();
      await expect(
        gate.check({ workspace_id: 'ws-free' }),
      ).rejects.toBeInstanceOf(PlanLimitException);
      await expect(
        gate.check({ workspace_id: 'ws-pro' }),
      ).resolves.toBeUndefined();
    });

    it('resolves a roadmap child (task_id) to its roadmap through the authz walker', async () => {
      const { gate, roadmapAuthz } = buildGate({
        children: { 'taskId:t-1': 'r-free' },
      });

      await expect(gate.check({ task_id: 't-1' })).rejects.toBeInstanceOf(
        PlanLimitException,
      );
      expect(roadmapAuthz.resolveRoadmapId).toHaveBeenCalledWith({
        taskId: 't-1',
      });
    });

    it('tries each node kind for an untyped node_id', async () => {
      const { gate, roadmapAuthz } = buildGate({
        children: { 'featureId:n-1': 'r-free' },
      });

      await expect(gate.check({ node_id: 'n-1' })).rejects.toBeInstanceOf(
        PlanLimitException,
      );
      expect(roadmapAuthz.resolveRoadmapId.mock.calls).toEqual([
        [{ epicId: 'n-1' }],
        [{ featureId: 'n-1' }],
      ]);
    });

    it('memoizes each target within the request', async () => {
      const { gate, repo } = buildGate();
      await gate.check({ project_id: 'p-pro' });
      await gate.check({ project_id: 'p-pro' });
      expect(repo.resolveSubject).toHaveBeenCalledTimes(1);
    });
  });

  describe('what passes through to the tool', () => {
    it('an unresolvable project (the tool answers NOT_FOUND)', async () => {
      const { gate, projectAuthz } = buildGate();
      await expect(
        gate.check({ project_id: 'p-missing' }),
      ).resolves.toBeUndefined();
      expect(projectAuthz.resolvePermissions).not.toHaveBeenCalled();
    });

    it('a child id that resolves to no roadmap', async () => {
      const { gate } = buildGate();
      await expect(gate.check({ epic_id: 'e-gone' })).resolves.toBeUndefined();
    });

    it("a Free project the caller cannot see: its plan is not the caller's business", async () => {
      const { gate, projectAuthz } = buildGate({ visibleProjects: ['p-pro'] });
      await expect(
        gate.check({ project_id: 'p-free' }),
      ).resolves.toBeUndefined();
      expect(projectAuthz.resolvePermissions).toHaveBeenCalledWith(
        USER,
        'p-free',
      );
    });

    it('a Free roadmap the caller cannot see', async () => {
      const { gate } = buildGate({ visibleRoadmaps: [] });
      await expect(
        gate.check({ roadmap_id: 'r-free' }),
      ).resolves.toBeUndefined();
    });

    it('a Free workspace the caller is not a member of', async () => {
      const { gate } = buildGate({ workspaceMember: false });
      await expect(
        gate.check({ workspace_id: 'ws-free' }),
      ).resolves.toBeUndefined();
    });

    it('a target lookup that errors (fails open)', async () => {
      const { gate, roadmapAuthz } = buildGate();
      roadmapAuthz.resolveRoadmapId.mockRejectedValue(new Error('timeout'));
      await expect(gate.check({ task_id: 't-1' })).resolves.toBeUndefined();
    });

    it('never asks for access on the allow path', async () => {
      const { gate, projectAuthz, roadmapAuthz, db } = buildGate();
      await gate.check({ project_id: 'p-pro' });
      await gate.check({ roadmap_id: 'r-pro' });
      await gate.check({ workspace_id: 'ws-pro' });
      expect(projectAuthz.resolvePermissions).not.toHaveBeenCalled();
      expect(roadmapAuthz.canViewRoadmap).not.toHaveBeenCalled();
      expect(db.from).not.toHaveBeenCalled();
    });
  });
});

describe('plan gate targeting helpers', () => {
  it('returns null for an untargeted call', () => {
    expect(pickPlanGateTarget(undefined)).toBeNull();
    expect(pickPlanGateTarget({ query: 'x', project_id: '' })).toBeNull();
  });

  it('uses node_type when the node is typed', () => {
    expect(pickPlanGateTarget({ node_id: 'n', node_type: 'task' })).toEqual({
      kind: 'child',
      refs: [{ taskId: 'n' }],
    });
  });

  it('maps resource template variables onto argument names', () => {
    expect(templateVariablesToArgs({ projectId: 'p-1' })).toEqual({
      project_id: 'p-1',
    });
    expect(templateVariablesToArgs({ roadmapId: ['r-1'] })).toEqual({
      roadmap_id: 'r-1',
    });
    expect(templateVariablesToArgs(undefined)).toBeUndefined();
  });
});

describe('installMcpPlanGate on the real server (McpServerFactory.create)', () => {
  /**
   * Every domain service is a trap: touching any of them means a tool body
   * ran, which a refused call must never do.
   */
  function trappedServices() {
    const touched: string[] = [];
    const trap = (name: string) =>
      new Proxy(
        {},
        {
          get: (_target, prop) => {
            touched.push(`${name}.${String(prop)}`);
            return jest.fn(() => {
              throw new Error(`${name}.${String(prop)} ran`);
            });
          },
        },
      );
    return { touched, trap };
  }

  function buildFactory(entitlements: EntitlementsService) {
    const { touched, trap } = trappedServices();
    const config = { get: (_key: string, fallback: unknown) => fallback };
    // Chat writes on, so the conditional tools are covered too.
    const capabilities = { chatWriteEnabled: true };
    const factory = new McpServerFactory(
      trap('db') as never,
      config as never,
      trap('projects') as never,
      trap('projectAuthz') as never,
      trap('roadmaps') as never,
      trap('roadmapAuthz') as never,
      trap('roadmapAi') as never,
      trap('projectContext') as never,
      trap('knowledge') as never,
      trap('tasks') as never,
      trap('taskExtras') as never,
      trap('epics') as never,
      trap('features') as never,
      trap('aiSessions') as never,
      trap('aiContext') as never,
      trap('chat') as never,
      trap('deliverables') as never,
      trap('changeRequests') as never,
      trap('risks') as never,
      trap('decisions') as never,
      trap('decisionCategories') as never,
      trap('audit') as never,
      capabilities as never,
      entitlements,
    );
    const server = factory.create({
      userId: USER,
      scopes: [...MCP_ALL_SCOPES],
    }) as any;
    return {
      touched,
      tools: server._registeredTools as Record<
        string,
        { handler: (...args: unknown[]) => Promise<any>; inputSchema?: unknown }
      >,
      resources: server._registeredResources as Record<
        string,
        { readCallback: (...args: unknown[]) => Promise<any> }
      >,
      templates: server._registeredResourceTemplates as Record<
        string,
        { readCallback: (...args: unknown[]) => Promise<any> }
      >,
    };
  }

  /** A user on Free everywhere, with the seeded limits table. */
  function freeEverywhere() {
    const entitlements = denyingEntitlements({ limit_key: 'mcp_server' });
    entitlements.getLimitMatrix.mockResolvedValue(
      buildMatrix(buildSeedKeyRows(), buildSeedLimitRows()),
    );
    return entitlements;
  }

  it('answers EVERY registered tool with PLAN_LIMIT, running no tool body', async () => {
    const entitlements = freeEverywhere();
    const { tools, touched } = buildFactory(entitlements);
    const names = Object.keys(tools);

    // A sample of every family, so an empty registry cannot pass vacuously.
    expect(names).toEqual(
      expect.arrayContaining([
        'projects_list',
        'project_create',
        'roadmap_get_summary',
        'roadmap_commit_operations',
        'task_update',
        'chat_rooms_list',
        'chat_send_message',
        'deliverable_create',
        'workspace_overview_get',
      ]),
    );

    for (const name of names) {
      const tool = tools[name];
      // The SDK passes (args, extra) with an inputSchema and (extra) without.
      const result = tool.inputSchema
        ? await tool.handler({ project_id: 'p-1' }, {})
        : await tool.handler({});
      expect({ name, isError: result.isError }).toEqual({
        name,
        isError: true,
      });
      expect({ name, error: JSON.parse(result.content[0].text).error }).toEqual(
        { name, error: 'PLAN_LIMIT' },
      );
    }
    expect(touched).toEqual([]);
    // Memoized: one coarse lookup for the whole request.
    expect(entitlements.userHasFeatureInAnyWorkspace).toHaveBeenCalledTimes(1);
  });

  it('refuses every data resource with PLAN_LIMIT', async () => {
    const { resources, templates, touched } = buildFactory(freeEverywhere());

    const dataResources = Object.entries(resources).filter(
      ([uri]) => uri !== ROADMAP_SUMMARY_APP_URI,
    );
    expect(dataResources.length).toBeGreaterThan(0);
    for (const [uri, resource] of dataResources) {
      const error = await rejection(resource.readCallback(new URL(uri), {}));
      expect(error).toBeInstanceOf(McpToolError);
      expect((error as McpToolError).code).toBe('PLAN_LIMIT');
    }

    const templateEntries = Object.entries(templates);
    expect(templateEntries.length).toBeGreaterThan(0);
    for (const [, template] of templateEntries) {
      const error = await rejection(
        template.readCallback(
          new URL('proyekto://projects/p-1'),
          { projectId: 'p-1', roadmapId: 'r-1' },
          {},
        ),
      );
      expect((error as McpToolError).code).toBe('PLAN_LIMIT');
    }
    expect(touched).toEqual([]);
  });

  it('leaves the static MCP App shell ungated', async () => {
    const entitlements = freeEverywhere();
    const { resources } = buildFactory(entitlements);

    const app = resources[ROADMAP_SUMMARY_APP_URI];
    expect(app).toBeDefined();
    // The bundled HTML may not be built in a test checkout; whatever the read
    // does, it must not have asked the plan.
    const outcome: unknown = await app
      .readCallback(new URL(ROADMAP_SUMMARY_APP_URI), {})
      .catch((error: unknown) => error);

    expect(outcome).not.toBeInstanceOf(McpToolError);
    expect(entitlements.userHasFeatureInAnyWorkspace).not.toHaveBeenCalled();
    expect(entitlements.assertFeature).not.toHaveBeenCalled();
  });

  it('runs the tool body once the plan allows it', async () => {
    const entitlements = freeEverywhere();
    entitlements.userHasFeatureInAnyWorkspace.mockResolvedValue(true);
    entitlements.assertFeature.mockResolvedValue(undefined);
    const { tools, touched } = buildFactory(entitlements);

    await tools.projects_list.handler({}, {});

    // The trap threw inside the body, but the body ran: the gate let it in.
    expect(touched.length).toBeGreaterThan(0);
  });
});

describe('installMcpPlanGate registration plumbing', () => {
  it('passes the SDK arguments through untouched on the allow path', async () => {
    const registered: Record<string, (...args: unknown[]) => unknown> = {};
    const server = {
      registerTool(name: string, _config: unknown, cb: never) {
        registered[name] = cb;
      },
      registerResource: jest.fn(),
    };
    const gate = { check: jest.fn(() => Promise.resolve()) };
    installMcpPlanGate(server as never, gate as never);

    const body = jest.fn(() => Promise.resolve('ok'));
    const noInput = jest.fn(() => Promise.resolve('ok'));
    (server.registerTool as any)('with_input', { inputSchema: {} }, body);
    (server.registerTool as any)('without_input', {}, noInput);

    await registered.with_input({ task_id: 't' }, { signal: 'x' });
    await registered.without_input({ signal: 'y' });

    expect(body).toHaveBeenCalledWith({ task_id: 't' }, { signal: 'x' });
    expect(noInput).toHaveBeenCalledWith({ signal: 'y' });
    // A tool without an inputSchema gets `extra` first: not arguments.
    expect(gate.check.mock.calls).toEqual([[{ task_id: 't' }], [undefined]]);
  });

  it('restores the original registerResource on ungate', () => {
    const original = jest.fn();
    const server = { registerTool: jest.fn(), registerResource: original };
    const gate = { check: jest.fn(() => Promise.resolve()) };

    const { ungateResources } = installMcpPlanGate(
      server as never,
      gate as never,
    );
    expect(server.registerResource).not.toBe(original);
    ungateResources();
    expect(server.registerResource).toBe(original);
  });
});
