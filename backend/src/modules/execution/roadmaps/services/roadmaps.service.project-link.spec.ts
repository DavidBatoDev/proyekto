import { BadRequestException, ConflictException } from '@nestjs/common';
import { PlanLimitException } from '../../../shared/entitlements/plan-limit.exception';
import { RoadmapsService } from './roadmaps.service';
import {
  nodeLimitException,
  planLimitsHarness,
  planLimitsStub,
} from './__roadmap-plan-limits-test-kit-spec';

/**
 * The one-to-one project/roadmap rule at the service boundary: a project
 * holds at most one linked roadmap, and attaching a standalone roadmap to a
 * project is a permission-checked link rather than a plain field edit.
 */
describe('RoadmapsService project link rules', () => {
  const roadmapAuthz = {
    assertProjectRoadmapPermission: jest.fn(),
    assertRoadmapPermission: jest.fn(),
  };
  const maybeSingle = jest.fn();
  const supabase = {
    from: jest.fn(() => ({
      select: () => ({ eq: () => ({ maybeSingle }) }),
    })),
  };
  const repo = {
    create: jest.fn(),
    findById: jest.fn(),
    update: jest.fn(),
  };
  const planLimits = planLimitsStub();

  const service = new RoadmapsService(
    repo as any,
    supabase as any,
    roadmapAuthz as any,
    planLimits as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    maybeSingle.mockResolvedValue({ data: null, error: null });
  });

  it('refuses to create a second roadmap for a project with a 409', async () => {
    maybeSingle.mockResolvedValueOnce({
      data: { id: 'rm-existing', name: 'Launch plan' },
      error: null,
    });

    await expect(
      service.create({ name: 'Second', project_id: 'project-1' } as any, 'u-1'),
    ).rejects.toMatchObject({
      constructor: ConflictException,
      response: expect.objectContaining({
        code: 'PROJECT_ALREADY_HAS_ROADMAP',
        roadmap_id: 'rm-existing',
      }),
    });
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('creates a linked roadmap when the project has none', async () => {
    repo.create.mockResolvedValueOnce({ id: 'rm-new' });

    await expect(
      service.create({ name: 'First', project_id: 'project-1' } as any, 'u-1'),
    ).resolves.toEqual({ id: 'rm-new' });

    expect(roadmapAuthz.assertProjectRoadmapPermission).toHaveBeenCalledWith(
      'project-1',
      'u-1',
      'roadmap.edit',
    );
    expect(supabase.from).toHaveBeenCalledWith('roadmaps');
  });

  it('attaches a standalone roadmap only after checking the project and its vacancy', async () => {
    repo.findById.mockResolvedValueOnce({
      id: 'rm-solo',
      owner_id: 'u-1',
      project_id: null,
    });
    repo.update.mockResolvedValueOnce({
      id: 'rm-solo',
      project_id: 'project-1',
    });

    await expect(
      service.update('rm-solo', { project_id: 'project-1' }, 'u-1'),
    ).resolves.toEqual({ id: 'rm-solo', project_id: 'project-1' });

    expect(roadmapAuthz.assertProjectRoadmapPermission).toHaveBeenCalledWith(
      'project-1',
      'u-1',
      'roadmap.edit',
    );
    expect(repo.update).toHaveBeenCalledWith('rm-solo', {
      project_id: 'project-1',
    });
    // The plan check runs after the permission and vacancy checks.
    expect(planLimits.assertCanLink).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'rm-solo' }),
      'project-1',
    );
    expect(
      planLimits.assertCanLink.mock.invocationCallOrder[0],
    ).toBeGreaterThan(
      roadmapAuthz.assertProjectRoadmapPermission.mock.invocationCallOrder[0],
    );
  });

  it('refuses to attach when the project already has a roadmap', async () => {
    repo.findById.mockResolvedValueOnce({
      id: 'rm-solo',
      owner_id: 'u-1',
      project_id: null,
    });
    maybeSingle.mockResolvedValueOnce({
      data: { id: 'rm-existing', name: 'Launch plan' },
      error: null,
    });

    await expect(
      service.update('rm-solo', { project_id: 'project-1' }, 'u-1'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('refuses to move a roadmap that is already linked to a project', async () => {
    repo.findById.mockResolvedValueOnce({
      id: 'rm-linked',
      owner_id: 'u-1',
      project_id: 'project-0',
    });

    await expect(
      service.update('rm-linked', { project_id: 'project-1' }, 'u-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(roadmapAuthz.assertProjectRoadmapPermission).not.toHaveBeenCalled();
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('leaves plain field edits on a standalone roadmap untouched', async () => {
    repo.findById.mockResolvedValueOnce({
      id: 'rm-solo',
      owner_id: 'u-1',
      project_id: null,
    });
    repo.update.mockResolvedValueOnce({ id: 'rm-solo', name: 'Renamed' });

    await service.update('rm-solo', { name: 'Renamed' }, 'u-1');

    expect(roadmapAuthz.assertProjectRoadmapPermission).not.toHaveBeenCalled();
    expect(supabase.from).not.toHaveBeenCalled();
    expect(planLimits.assertCanLink).not.toHaveBeenCalled();
    expect(repo.update).toHaveBeenCalledWith('rm-solo', { name: 'Renamed' });
  });

  it("checks the owner's plan before unlinking a linked roadmap", async () => {
    const linked = {
      id: 'rm-linked',
      owner_id: 'u-1',
      project_id: 'project-0',
    };
    repo.findById.mockResolvedValueOnce(linked);
    repo.update.mockResolvedValueOnce({ ...linked, project_id: null });

    await service.update('rm-linked', { project_id: null }, 'u-2');

    expect(planLimits.assertCanUnlink).toHaveBeenCalledWith(linked);
    expect(
      planLimits.assertCanUnlink.mock.invocationCallOrder[0],
    ).toBeGreaterThan(
      roadmapAuthz.assertRoadmapPermission.mock.invocationCallOrder[0],
    );
    expect(planLimits.assertCanUnlink.mock.invocationCallOrder[0]).toBeLessThan(
      repo.update.mock.invocationCallOrder[0],
    );
  });

  it('writes nothing when the unlink check refuses', async () => {
    repo.findById.mockResolvedValueOnce({
      id: 'rm-linked',
      owner_id: 'u-1',
      project_id: 'project-0',
    });
    planLimits.assertCanUnlink.mockRejectedValueOnce(nodeLimitException());

    await expect(
      service.update('rm-linked', { project_id: null }, 'u-1'),
    ).rejects.toBeInstanceOf(PlanLimitException);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('never runs the unlink check for a plain edit of a linked roadmap', async () => {
    const linked = {
      id: 'rm-linked',
      owner_id: 'u-1',
      project_id: 'project-0',
    };
    repo.findById.mockResolvedValueOnce(linked).mockResolvedValueOnce(linked);

    await service.update('rm-linked', { name: 'Renamed' }, 'u-1');
    // Re-sending the current project is not an unlink either.
    await service.update(
      'rm-linked',
      { project_id: 'project-0', name: 'Same' },
      'u-1',
    );

    expect(planLimits.assertCanUnlink).not.toHaveBeenCalled();
  });
});

/**
 * Unlinking re-homes a roadmap to its owner's default workspace, so it must
 * fit that plan, exactly as the same unlink through create-full must. Runs
 * the real rule (Free = 250 nodes).
 */
describe('RoadmapsService project unlink plan limits', () => {
  const BIG = 'rm-big';

  function build(ownerWorkspace: string) {
    const harness = planLimitsHarness({
      subjects: { 'project:project-1': { workspace_id: 'ws-pro' } },
      owners: { 'u-1': { workspaceId: ownerWorkspace } },
      nodes: { [BIG]: 1000 },
    });
    const repo = {
      findById: jest.fn().mockResolvedValue({
        id: BIG,
        owner_id: 'u-1',
        project_id: 'project-1',
      }),
      update: jest.fn().mockResolvedValue({ id: BIG, project_id: null }),
    };
    const service = new RoadmapsService(
      repo as any,
      { from: jest.fn() } as any,
      { assertRoadmapPermission: jest.fn() } as any,
      harness.planLimits,
    );
    return { service, repo, entitlementsRepo: harness.repo };
  }

  it("refuses to unlink a 1,000-node roadmap into its owner's Free workspace", async () => {
    const { service, repo } = build('ws-free');

    await expect(
      service.update(BIG, { project_id: null }, 'u-2'),
    ).rejects.toMatchObject({
      payload: expect.objectContaining({
        code: 'plan_limit',
        context: 'link',
        limit_key: 'roadmap_nodes_per_roadmap',
        workspace_id: 'ws-free',
      }),
    });
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('unlinks within the same workspace without counting', async () => {
    const { service, repo, entitlementsRepo } = build('ws-pro');

    await service.update(BIG, { project_id: null }, 'u-2');

    expect(repo.update).toHaveBeenCalledWith(BIG, { project_id: null });
    expect(entitlementsRepo.countRoadmapNodes).not.toHaveBeenCalled();
  });
});

/**
 * Linking moves a roadmap under the project's workspace plan: a roadmap too
 * big for a Free destination is refused before any write, and a link within
 * one workspace is never counted. Runs the real rule (Free = 250 nodes).
 */
describe('RoadmapsService project link plan limits', () => {
  const BIG = 'rm-big';

  function build(destinationWorkspace: string) {
    const harness = planLimitsHarness({
      subjects: {
        [`roadmap:${BIG}`]: { workspace_id: 'ws-pro' },
        'project:project-1': { workspace_id: destinationWorkspace },
      },
      nodes: { [BIG]: 300 },
    });
    const roadmapAuthz = {
      assertProjectRoadmapPermission: jest.fn(),
      assertRoadmapPermission: jest.fn(),
    };
    const rpc = jest.fn(() => ({
      returns: () => Promise.resolve({ data: { id: BIG }, error: null }),
    }));
    const supabase = {
      from: jest.fn(() => ({
        // assertProjectHasNoRoadmap (vacant) and countRoadmapChildren (empty).
        select: () => ({
          eq: () => {
            const result = Promise.resolve({
              data: null,
              count: 0,
              error: null,
            });
            return Object.assign(result, {
              maybeSingle: () => Promise.resolve({ data: null, error: null }),
            });
          },
        }),
      })),
      rpc,
    };
    const repo = {
      findById: jest.fn().mockResolvedValue({
        id: BIG,
        owner_id: 'u-1',
        project_id: null,
      }),
      findByProjectId: jest
        .fn()
        .mockResolvedValue({ id: 'rm-empty', project_id: 'project-1' }),
      update: jest.fn().mockResolvedValue({ id: BIG }),
    };
    const service = new RoadmapsService(
      repo as any,
      supabase as any,
      roadmapAuthz as any,
      harness.planLimits,
    );
    return { service, repo, rpc, entitlementsRepo: harness.repo };
  }

  it('refuses to link a 300-node roadmap into a Free workspace', async () => {
    const { service, repo } = build('ws-free');

    await expect(
      service.update(BIG, { project_id: 'project-1' }, 'u-1'),
    ).rejects.toMatchObject({
      payload: expect.objectContaining({
        code: 'plan_limit',
        context: 'link',
        limit_key: 'roadmap_nodes_per_roadmap',
      }),
    });
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('links within the same workspace without counting', async () => {
    const { service, repo, entitlementsRepo } = build('ws-pro');

    await service.update(BIG, { project_id: 'project-1' }, 'u-1');

    expect(repo.update).toHaveBeenCalledWith(BIG, { project_id: 'project-1' });
    expect(entitlementsRepo.countRoadmapNodes).not.toHaveBeenCalled();
  });

  it('refuses a replacement too big for the project before the RPC', async () => {
    const { service, rpc } = build('ws-free');

    await expect(
      service.replaceProjectRoadmap('project-1', BIG, 'u-1'),
    ).rejects.toMatchObject({
      payload: expect.objectContaining({ context: 'link' }),
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('replaces within the same workspace', async () => {
    const { service, rpc } = build('ws-pro');

    await service.replaceProjectRoadmap('project-1', BIG, 'u-1');

    expect(rpc).toHaveBeenCalledWith(
      'replace_project_roadmap',
      expect.objectContaining({ p_replacement_roadmap_id: BIG }),
    );
  });
});
