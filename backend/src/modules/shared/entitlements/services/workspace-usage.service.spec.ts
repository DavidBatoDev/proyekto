/* eslint-disable @typescript-eslint/unbound-method --
 * The entitlements double is a jest.Mocked object; passing its members to
 * expect() is an identity check on the mock, never a call, so `this` scoping
 * is irrelevant.
 */
import {
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  allowAllEntitlements,
  buildSeedKeyRows,
  buildSeedLimitRows,
} from '../__entitlements-test-kit-spec';
import type {
  CompPlan,
  PlanId,
  PlanSource,
  WorkspacePlanState,
} from '../entitlement-keys';
import { buildMatrix } from '../entitlements.logic';
import type { LargestRoadmap } from '../entitlements.service';
import type { PlanLimitRow } from '../repositories/entitlements.repository.interface';
import { WorkspaceUsageService } from './workspace-usage.service';

const WS = '11111111-1111-4111-8111-111111111111';

function planState(
  overrides: {
    effective?: PlanId;
    source?: PlanSource;
    subscription?: { plan: PlanId; status: string | null };
    comp?: { plan: CompPlan; active?: boolean } | null;
  } = {},
): WorkspacePlanState {
  return {
    workspace_id: WS,
    workspace_name: 'Acme',
    workspace_slug: 'acme',
    effective_plan: overrides.effective ?? 'free',
    plan_source: overrides.source ?? 'default',
    subscription_plan: overrides.subscription?.plan ?? 'free',
    subscription_status: overrides.subscription?.status ?? null,
    has_provider_subscription: false,
    complimentary: overrides.comp
      ? {
          plan: overrides.comp.plan,
          since: '2026-09-02T00:00:00.000Z',
          until: null,
          active: overrides.comp.active ?? true,
        }
      : null,
  };
}

function roadmap(
  id: string,
  nodes: number,
  overrides: Partial<LargestRoadmap> = {},
): LargestRoadmap {
  return {
    roadmap_id: id,
    name: `Roadmap ${id}`,
    project_id: `project-${id}`,
    project_title: `Project ${id}`,
    owner_id: 'owner-1',
    nodes,
    ...overrides,
  };
}

function buildDeps(
  options: {
    role?: 'owner' | 'admin' | 'member' | null;
    state?: WorkspacePlanState;
    largest?: LargestRoadmap[];
    viewable?: string[];
    limitRows?: PlanLimitRow[];
  } = {},
) {
  const workspace = { id: WS, name: 'Acme', slug: 'acme' };
  const workspaces = {
    fetchWorkspaceOrThrow: jest.fn().mockResolvedValue(workspace),
    assertCanRead: jest.fn(() => {
      const role = options.role === undefined ? 'member' : options.role;
      return role
        ? Promise.resolve(role)
        : Promise.reject(
            new ForbiddenException('You do not have access to this workspace'),
          );
    }),
  };
  const entitlements = allowAllEntitlements();
  entitlements.getEffectivePlan.mockResolvedValue(options.state ?? planState());
  entitlements.getLimitMatrix.mockResolvedValue(
    buildMatrix(buildSeedKeyRows(), options.limitRows ?? buildSeedLimitRows()),
  );
  entitlements.getUsageCounts.mockResolvedValue({
    members: 4,
    pending_invites: 2,
    projects: 2,
    teams: 1,
  });
  entitlements.getLargestRoadmaps.mockResolvedValue(options.largest ?? []);
  const repo = {
    filterViewableRoadmapIds: jest.fn(() =>
      Promise.resolve(new Set(options.viewable ?? [])),
    ),
  };
  const service = new WorkspaceUsageService(
    workspaces as never,
    entitlements,
    repo,
  );
  return { service, workspaces, entitlements, repo };
}

describe('WorkspaceUsageService — access', () => {
  it('answers any member', async () => {
    const { service } = buildDeps({ role: 'member' });

    await expect(service.getUsage(WS, 'member-1')).resolves.toMatchObject({
      workspace_id: WS,
    });
  });

  it('403s a non-member before reading anything about the plan', async () => {
    const { service, entitlements } = buildDeps({ role: null });

    await expect(service.getUsage(WS, 'stranger')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(entitlements.getEffectivePlan).not.toHaveBeenCalled();
    expect(entitlements.getUsageCounts).not.toHaveBeenCalled();
  });

  it('404s a workspace that does not exist', async () => {
    const { service, workspaces } = buildDeps();
    workspaces.fetchWorkspaceOrThrow.mockRejectedValue(
      new NotFoundException('Workspace not found'),
    );

    await expect(service.getUsage(WS, 'member-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('turns a lookup failure into a 503, not a 500', async () => {
    const { service, entitlements } = buildDeps();
    entitlements.getLimitMatrix.mockRejectedValue(
      new Error('relation "plan_limits" does not exist'),
    );

    await expect(service.getUsage(WS, 'member-1')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});

describe('WorkspaceUsageService — subscription visibility', () => {
  const state = planState({
    effective: 'pro',
    source: 'subscription',
    subscription: { plan: 'pro', status: 'past_due' },
  });

  it.each(['owner', 'admin'] as const)(
    'shows the subscription to an %s',
    async (role) => {
      const { service } = buildDeps({ role, state });

      const usage = await service.getUsage(WS, 'u');

      expect(usage.subscription).toEqual({ plan: 'pro', status: 'past_due' });
    },
  );

  it('hides the subscription from a plain member', async () => {
    const { service } = buildDeps({ role: 'member', state });

    const usage = await service.getUsage(WS, 'u');

    expect(usage.subscription).toBeNull();
    expect(usage.plan).toEqual({
      effective: 'pro',
      source: 'subscription',
      complimentary: null,
    });
  });
});

describe('WorkspaceUsageService — the payload', () => {
  it('reports the effective plan, its cells, the counts, features and retention', async () => {
    const { service } = buildDeps();

    const usage = await service.getUsage(WS, 'member-1');

    expect(usage.plan).toEqual({
      effective: 'free',
      source: 'default',
      complimentary: null,
    });
    expect(usage.limits.projects).toEqual({
      kind: 'count',
      value: 2,
      per_seat: false,
      display_label: null,
    });
    expect(usage.usage).toEqual({
      members: 4,
      pending_invites: 2,
      projects: 2,
      teams: 1,
    });
    expect(usage.counts_pending_invites).toBe(true);
    expect(usage.retention_days).toBe(7);
    expect(usage.upgrade_plan).toBe('pro');
    expect(usage.features.find((f) => f.key === 'change_requests')).toEqual({
      key: 'change_requests',
      label: 'Change requests',
      group: 'governance',
      enabled: false,
      enforced: true,
      available_on: 'pro',
    });
    expect(usage.features.find((f) => f.key === 'saml_scim')).toMatchObject({
      enabled: false,
      enforced: false,
      available_on: 'enterprise',
    });
    expect(usage.features.every((f) => f.key !== 'projects')).toBe(true);
    expect(typeof usage.generated_at).toBe('string');
  });

  it('shows an active comp and the limits of the plan it grants', async () => {
    const { service } = buildDeps({
      state: planState({
        effective: 'business',
        source: 'complimentary',
        comp: { plan: 'business' },
      }),
    });

    const usage = await service.getUsage(WS, 'member-1');

    expect(usage.plan).toEqual({
      effective: 'business',
      source: 'complimentary',
      complimentary: {
        plan: 'business',
        since: '2026-09-02T00:00:00.000Z',
        until: null,
      },
    });
    expect(usage.limits.projects).toMatchObject({ value: null });
    expect(usage.retention_days).toBeNull();
    expect(usage.upgrade_plan).toBe('enterprise');
  });

  it('leaves a lapsed comp out', async () => {
    const { service } = buildDeps({
      state: planState({ comp: { plan: 'business', active: false } }),
    });

    expect(
      (await service.getUsage(WS, 'member-1')).plan.complimentary,
    ).toBeNull();
  });

  it('has no upgrade above Enterprise', async () => {
    const { service } = buildDeps({
      state: planState({ effective: 'enterprise', source: 'subscription' }),
    });

    expect((await service.getUsage(WS, 'member-1')).upgrade_plan).toBeNull();
  });
});

describe('WorkspaceUsageService — roadmaps', () => {
  it('lists roadmaps at 80% or more of a finite node limit as near the limit', async () => {
    // Free allows 250 nodes: 200 is exactly 80%.
    const { service } = buildDeps({
      largest: [
        roadmap('a', 260),
        roadmap('b', 250),
        roadmap('c', 200),
        roadmap('d', 199),
      ],
      viewable: ['a', 'b', 'c', 'd'],
    });

    const usage = await service.getUsage(WS, 'member-1');

    expect(usage.roadmaps.largest).toMatchObject({
      roadmap_id: 'a',
      nodes: 260,
    });
    expect(usage.roadmaps.near_limit.map((r) => r.roadmap_id)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('has nothing near an unlimited node limit, but still reports the largest', async () => {
    const { service } = buildDeps({
      state: planState({ effective: 'pro', source: 'subscription' }),
      largest: [roadmap('a', 5000)],
      viewable: ['a'],
    });

    const usage = await service.getUsage(WS, 'member-1');

    expect(usage.roadmaps.near_limit).toEqual([]);
    expect(usage.roadmaps.largest).toMatchObject({ nodes: 5000 });
  });

  it('names only the roadmaps the viewer can open', async () => {
    // Workspace membership is not project access: a member sees how big a
    // roadmap is, never what it is called or which project it belongs to.
    const { service, repo } = buildDeps({
      largest: [roadmap('secret', 240), roadmap('mine', 230)],
      viewable: ['mine'],
    });

    const usage = await service.getUsage(WS, 'member-1');

    expect(repo.filterViewableRoadmapIds).toHaveBeenCalledWith('member-1', [
      'secret',
      'mine',
    ]);
    expect(usage.roadmaps.largest).toEqual({
      roadmap_id: 'secret',
      name: null,
      project_id: null,
      project_title: null,
      nodes: 240,
    });
    expect(usage.roadmaps.near_limit[1]).toEqual({
      roadmap_id: 'mine',
      name: 'Roadmap mine',
      project_id: 'project-mine',
      project_title: 'Project mine',
      nodes: 230,
    });
  });

  it('reports no largest roadmap when the workspace has none', async () => {
    const { service } = buildDeps({ largest: [] });

    const usage = await service.getUsage(WS, 'member-1');

    expect(usage.roadmaps).toEqual({ largest: null, near_limit: [] });
  });
});
