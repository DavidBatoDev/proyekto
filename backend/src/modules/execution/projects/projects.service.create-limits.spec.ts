import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { buildPlanLimitPayload } from '../../shared/entitlements/__entitlements-test-kit-spec';
import { PlanLimitException } from '../../shared/entitlements/plan-limit.exception';
import { ProjectsService } from './projects.service';

/**
 * A project create that the workspace's plan refuses must leave no trace: no
 * project row, no grant, no chat channels, and, when converting a guest's
 * roadmap, no claim of that roadmap or its AI sessions. The refusal comes from
 * WorkspacesService.resolveWorkspaceForCreate (its own spec covers the limit
 * arithmetic); what is pinned here is WHERE it sits in each create path.
 */

const USER = 'user-1';
const GUEST = 'guest-1';

function planRefusal() {
  return new PlanLimitException(buildPlanLimitPayload());
}

/**
 * Records every write the conversion path could make, in order, so a test can
 * assert both "nothing was written" and "the plan was asked first".
 */
function buildSupabase(input: {
  roadmap: Record<string, unknown>;
  guestProfile?: Record<string, unknown> | null;
  claimResult?: { data: unknown; error: unknown };
  sequence: string[];
}) {
  const writes: Array<{ table: string; op: string; payload?: unknown }> = [];
  const chain = (table: string) => {
    let op = 'select';
    const c: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'is', 'gt', 'in', 'order', 'limit']) {
      c[method] = () => c;
    }
    c.update = (payload: unknown) => {
      op = 'update';
      writes.push({ table, op, payload });
      input.sequence.push(`update:${table}`);
      return c;
    };
    c.insert = (payload: unknown) => {
      op = 'insert';
      writes.push({ table, op, payload });
      return c;
    };
    c.delete = () => {
      op = 'delete';
      writes.push({ table, op });
      return c;
    };
    c.maybeSingle = () => {
      if (table === 'roadmaps') {
        return Promise.resolve({ data: input.roadmap, error: null });
      }
      if (table === 'profiles') {
        return Promise.resolve({
          data: input.guestProfile ?? null,
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    };
    c.single = () =>
      Promise.resolve(
        table === 'roadmaps' && op === 'update'
          ? (input.claimResult ?? { data: null, error: { message: 'no' } })
          : { data: null, error: null },
      );
    c.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: null, error: null }).then(resolve);
    return c;
  };
  return { supabase: { from: (table: string) => chain(table) }, writes };
}

function buildHarness(
  options: {
    /** What resolveWorkspaceForCreate does; 'deny' (the plan refuses) by default. */
    plan?: 'allow' | 'deny';
    roadmap?: Record<string, unknown>;
    guestProfile?: Record<string, unknown> | null;
    claimResult?: { data: unknown; error: unknown };
    isActiveConsultant?: boolean;
  } = {},
) {
  const sequence: string[] = [];
  const resolveWorkspaceForCreate = jest.fn(() => {
    sequence.push('resolveWorkspaceForCreate');
    return options.plan === 'allow'
      ? Promise.resolve('ws-1')
      : Promise.reject(planRefusal());
  });
  const workspaces = {
    resolveWorkspaceForCreate,
    resolveWorkspaceForWrite: jest.fn().mockResolvedValue('ws-1'),
  };
  const projectsRepo = {
    getCreatorProfileForProjectCreation: jest
      .fn()
      .mockResolvedValue({ id: USER }),
    create: jest.fn(),
    deleteProject: jest.fn(),
  };
  const authorization = {
    grant: jest.fn(),
    isActiveConsultant: jest
      .fn()
      .mockResolvedValue(options.isActiveConsultant ?? true),
  };
  const accessSync = { syncUser: jest.fn() };
  const chatService = { provisionDefaultChannels: jest.fn() };
  const projectTeams = { attach: jest.fn() };
  const { supabase, writes } = buildSupabase({
    roadmap: options.roadmap ?? {
      id: 'roadmap-1',
      name: 'Guest roadmap',
      description: null,
      owner_id: GUEST,
      project_id: null,
    },
    guestProfile:
      options.guestProfile === undefined ? { id: GUEST } : options.guestProfile,
    claimResult: options.claimResult,
    sequence,
  });

  const service = new ProjectsService(
    projectsRepo as never,
    { createNotification: jest.fn() } as never,
    authorization as never,
    projectTeams as never,
    accessSync as never,
    supabase as never,
    {} as never,
    { invalidateAllDashboardCache: jest.fn() } as never,
    {} as never,
    chatService as never,
    {} as never,
    {} as never,
    {} as never,
    workspaces as never,
  );

  return {
    service,
    workspaces,
    projectsRepo,
    authorization,
    accessSync,
    chatService,
    projectTeams,
    writes,
    sequence,
  };
}

describe('ProjectsService.createProject — plan limit', () => {
  it.each(['client', 'consultant'] as const)(
    'writes nothing in %s mode when the workspace is at its project limit',
    async (mode) => {
      const h = buildHarness();

      await expect(
        h.service.createProject(USER, {
          title: 'Launch',
          creation_mode: mode,
          workspace_id: 'ws-1',
          primary_team_id: 'team-1',
        } as never),
      ).rejects.toBeInstanceOf(PlanLimitException);

      expect(h.workspaces.resolveWorkspaceForCreate).toHaveBeenCalledWith(
        USER,
        'projects',
        'ws-1',
      );
      expect(h.projectsRepo.create).not.toHaveBeenCalled();
      expect(h.authorization.grant).not.toHaveBeenCalled();
      expect(h.accessSync.syncUser).not.toHaveBeenCalled();
      expect(h.chatService.provisionDefaultChannels).not.toHaveBeenCalled();
      expect(h.projectTeams.attach).not.toHaveBeenCalled();
      expect(h.writes).toEqual([]);
    },
  );

  /** Eligibility first: someone who may not use consultant mode is told so. */
  it('refuses a non-consultant in consultant mode before consulting the plan', async () => {
    const h = buildHarness({ isActiveConsultant: false });

    await expect(
      h.service.createProject(USER, {
        title: 'Launch',
        creation_mode: 'consultant',
      } as never),
    ).rejects.toThrow('Consultant mode requires an active consultant account.');
    expect(h.workspaces.resolveWorkspaceForCreate).not.toHaveBeenCalled();
  });
});

describe('ProjectsService.createProjectFromRoadmap — plan limit', () => {
  const DTO = { roadmap_id: 'roadmap-1', guest_session_id: 'guest-session' };

  /**
   * The rejection must land before the guest claim: afterwards the roadmap
   * would belong to the converting user with no project around it, and the
   * guest's AI sessions would have moved too.
   */
  it('rejects before claiming the guest roadmap or its AI sessions', async () => {
    const h = buildHarness();

    await expect(
      h.service.createProjectFromRoadmap(USER, DTO as never),
    ).rejects.toBeInstanceOf(PlanLimitException);

    expect(h.workspaces.resolveWorkspaceForCreate).toHaveBeenCalledWith(
      USER,
      'projects',
    );
    expect(h.writes).toEqual([]);
    expect(h.projectsRepo.create).not.toHaveBeenCalled();
    expect(h.authorization.grant).not.toHaveBeenCalled();
  });

  it('rejects the user’s own unlinked roadmap without writing anything', async () => {
    const h = buildHarness({
      roadmap: {
        id: 'roadmap-1',
        name: 'Mine',
        description: null,
        owner_id: USER,
        project_id: null,
      },
    });

    await expect(
      h.service.createProjectFromRoadmap(USER, {
        roadmap_id: 'roadmap-1',
      } as never),
    ).rejects.toBeInstanceOf(PlanLimitException);
    expect(h.writes).toEqual([]);
    expect(h.projectsRepo.create).not.toHaveBeenCalled();
  });

  /** The guest-session check is authorization, so it still comes first. */
  it('refuses an invalid guest session before consulting the plan', async () => {
    const h = buildHarness({ guestProfile: null });

    await expect(
      h.service.createProjectFromRoadmap(USER, DTO as never),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.workspaces.resolveWorkspaceForCreate).not.toHaveBeenCalled();
    expect(h.writes).toEqual([]);
  });

  it('asks the plan first and claims only after it allows the conversion', async () => {
    const h = buildHarness({
      plan: 'allow',
      // Stop right after the claim so the test needs no project stubs.
      claimResult: { data: null, error: { message: 'claim failed' } },
    });

    await expect(
      h.service.createProjectFromRoadmap(USER, DTO as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(h.sequence).toEqual([
      'resolveWorkspaceForCreate',
      'update:roadmaps',
    ]);
  });
});
