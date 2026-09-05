import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AiContextResolveRefsDto } from '../dto/ai-context.dto';
import { AiContextRefsService } from './ai-context-refs.service';

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;

function buildService() {
  const repo = {
    loadRefTasks: jest.fn().mockResolvedValue([]),
    loadRefFeatures: jest.fn().mockResolvedValue([]),
    loadRefEpics: jest.fn().mockResolvedValue([]),
    loadRefMilestones: jest.fn().mockResolvedValue([]),
    loadRefRoadmaps: jest.fn().mockResolvedValue([]),
    loadRefProjects: jest.fn().mockResolvedValue([]),
    loadRefTeams: jest.fn().mockResolvedValue([]),
    loadTeamMembershipIds: jest.fn().mockResolvedValue(new Set<string>()),
    loadChainProjects: jest.fn().mockResolvedValue(new Map()),
    loadWorkspaceNames: jest.fn().mockResolvedValue(new Map()),
    loadLinkedRoadmapIds: jest.fn().mockResolvedValue(new Map()),
  };
  const roadmapsRepo = {
    getAccessibleProjectIds: jest.fn().mockResolvedValue([]),
  };
  const roadmapAuth = {
    filterViewableRoadmapIds: jest.fn().mockResolvedValue(new Map()),
  };
  const service = new AiContextRefsService(
    repo as never,
    roadmapsRepo as never,
    roadmapAuth as never,
  );
  return { service, repo, roadmapsRepo, roadmapAuth };
}

describe('AiContextRefsService.resolve', () => {
  it('authorizes the union of roadmap ids in ONE filterViewableRoadmapIds call across a mixed batch', async () => {
    const { service, repo, roadmapAuth, roadmapsRepo } = buildService();
    repo.loadRefTasks.mockResolvedValue([
      {
        id: 'task-1',
        title: 'Ship checkout',
        status: 'todo',
        feature: {
          id: 'feat-1',
          title: 'Checkout',
          roadmap_id: 'rm-a',
          epic_id: 'epic-1',
          epic: { id: 'epic-1', title: 'Payments' },
        },
      },
    ]);
    repo.loadRefEpics.mockResolvedValue([
      {
        id: 'epic-2',
        title: 'Other epic',
        status: 'backlog',
        roadmap_id: 'rm-b',
      },
    ]);
    repo.loadRefRoadmaps.mockResolvedValue([
      {
        id: 'rm-c',
        name: 'Roadmap C',
        status: 'active',
        project_id: null,
        owner_id: 'user-1',
      },
    ]);
    roadmapAuth.filterViewableRoadmapIds.mockResolvedValue(
      new Map([
        ['rm-a', { projectId: 'proj-a', ownerId: 'owner', name: 'Roadmap A' }],
        ['rm-c', { projectId: null, ownerId: 'user-1', name: 'Roadmap C' }],
      ]),
    );
    roadmapsRepo.getAccessibleProjectIds.mockResolvedValue(['proj-a']);
    repo.loadChainProjects.mockResolvedValue(
      new Map([
        ['proj-a', { id: 'proj-a', title: 'Project A', workspace_id: 'ws-1' }],
      ]),
    );
    repo.loadWorkspaceNames.mockResolvedValue(new Map([['ws-1', 'Acme']]));

    const result = await service.resolve('user-1', {
      refs: [
        { kind: 'task', id: 'task-1' },
        { kind: 'epic', id: 'epic-2' },
        { kind: 'roadmap', id: 'rm-c' },
      ],
    });

    expect(roadmapAuth.filterViewableRoadmapIds).toHaveBeenCalledTimes(1);
    expect(roadmapAuth.filterViewableRoadmapIds).toHaveBeenCalledWith(
      'user-1',
      ['rm-a', 'rm-b', 'rm-c'],
    );
    expect(roadmapsRepo.getAccessibleProjectIds).toHaveBeenCalledTimes(1);
    expect(result.refs).toEqual([
      {
        kind: 'task',
        id: 'task-1',
        accessible: true,
        title: 'Ship checkout',
        status: 'todo',
        roadmap_id: 'rm-a',
        project_id: 'proj-a',
        workspace_id: 'ws-1',
        parent_chain: [
          { kind: 'feature', id: 'feat-1', title: 'Checkout' },
          { kind: 'epic', id: 'epic-1', title: 'Payments' },
          { kind: 'roadmap', id: 'rm-a', title: 'Roadmap A' },
          { kind: 'project', id: 'proj-a', title: 'Project A' },
          { kind: 'workspace', id: 'ws-1', title: 'Acme' },
        ],
      },
      // rm-b was not viewable: denied without a title.
      {
        kind: 'epic',
        id: 'epic-2',
        accessible: false,
        error_code: 'NOT_FOUND',
      },
      {
        kind: 'roadmap',
        id: 'rm-c',
        accessible: true,
        title: 'Roadmap C',
        status: 'active',
        roadmap_id: 'rm-c',
        project_id: null,
        workspace_id: null,
        parent_chain: [],
      },
    ]);
  });

  it('denies a missing row without a title and never throws for it', async () => {
    const { service, repo, roadmapAuth } = buildService();
    repo.loadRefFeatures.mockResolvedValue([]);

    const result = await service.resolve('user-1', {
      refs: [{ kind: 'feature', id: 'feat-missing', label: 'Checkout' }],
    });

    expect(roadmapAuth.filterViewableRoadmapIds).not.toHaveBeenCalled();
    expect(result.refs).toEqual([
      {
        kind: 'feature',
        id: 'feat-missing',
        accessible: false,
        error_code: 'NOT_FOUND',
      },
    ]);
    expect(result.refs[0]).not.toHaveProperty('title');
  });

  it('fails a whole kind closed on a query error while other kinds still resolve', async () => {
    const { service, repo, roadmapAuth } = buildService();
    repo.loadRefTasks.mockRejectedValue(new Error('boom'));
    repo.loadRefEpics.mockResolvedValue([
      { id: 'epic-1', title: 'Epic', status: null, roadmap_id: 'rm-a' },
    ]);
    roadmapAuth.filterViewableRoadmapIds.mockResolvedValue(
      new Map([['rm-a', { projectId: null, ownerId: 'user-1', name: 'A' }]]),
    );

    const result = await service.resolve('user-1', {
      refs: [
        { kind: 'task', id: 'task-1' },
        { kind: 'task', id: 'task-2' },
        { kind: 'epic', id: 'epic-1' },
      ],
    });

    expect(result.refs.slice(0, 2)).toEqual([
      {
        kind: 'task',
        id: 'task-1',
        accessible: false,
        error_code: 'LOOKUP_FAILED',
      },
      {
        kind: 'task',
        id: 'task-2',
        accessible: false,
        error_code: 'LOOKUP_FAILED',
      },
    ]);
    expect(result.refs[2]).toMatchObject({
      kind: 'epic',
      id: 'epic-1',
      accessible: true,
      title: 'Epic',
      parent_chain: [{ kind: 'roadmap', id: 'rm-a', title: 'A' }],
    });
  });

  it('fails every roadmap-bound kind closed when the authorization probe itself throws', async () => {
    const { service, repo, roadmapAuth } = buildService();
    repo.loadRefMilestones.mockResolvedValue([
      { id: 'ms-1', title: 'Beta', status: 'not_started', roadmap_id: 'rm-a' },
    ]);
    repo.loadRefTeams.mockResolvedValue([
      { id: 'team-1', name: 'Core', workspace_id: null, owner_id: 'user-1' },
    ]);
    roadmapAuth.filterViewableRoadmapIds.mockRejectedValue(
      new Error('db down'),
    );

    const result = await service.resolve('user-1', {
      refs: [
        { kind: 'milestone', id: 'ms-1' },
        { kind: 'team', id: 'team-1' },
      ],
    });

    expect(result.refs[0]).toEqual({
      kind: 'milestone',
      id: 'ms-1',
      accessible: false,
      error_code: 'LOOKUP_FAILED',
    });
    expect(result.refs[1]).toMatchObject({ kind: 'team', accessible: true });
  });

  it('dedupes repeated (kind, id) pairs before loading and answers once per pair', async () => {
    const { service, repo, roadmapAuth } = buildService();
    repo.loadRefEpics.mockResolvedValue([
      { id: 'epic-1', title: 'Epic', status: null, roadmap_id: 'rm-a' },
    ]);
    roadmapAuth.filterViewableRoadmapIds.mockResolvedValue(
      new Map([['rm-a', { projectId: null, ownerId: 'user-1', name: 'A' }]]),
    );

    const result = await service.resolve('user-1', {
      refs: [
        { kind: 'epic', id: 'epic-1' },
        { kind: 'epic', id: 'epic-1', label: 'again' },
        { kind: 'task', id: 'epic-1' },
      ],
    });

    expect(repo.loadRefEpics).toHaveBeenCalledWith(['epic-1']);
    expect(repo.loadRefTasks).toHaveBeenCalledWith(['epic-1']);
    expect(result.refs).toHaveLength(2);
    expect(result.refs.map((ref) => `${ref.kind}:${ref.id}`)).toEqual([
      'epic:epic-1',
      'task:epic-1',
    ]);
  });

  it('resolves teams for the owner and members, and denies outsiders without a title', async () => {
    const { service, repo } = buildService();
    repo.loadRefTeams.mockResolvedValue([
      {
        id: 'team-owned',
        name: 'Owned',
        workspace_id: 'ws-1',
        owner_id: 'user-1',
      },
      {
        id: 'team-member',
        name: 'Member',
        workspace_id: null,
        owner_id: 'boss',
      },
      {
        id: 'team-outsider',
        name: 'Secret',
        workspace_id: 'ws-9',
        owner_id: 'boss',
      },
    ]);
    repo.loadTeamMembershipIds.mockResolvedValue(new Set(['team-member']));
    repo.loadWorkspaceNames.mockResolvedValue(new Map([['ws-1', 'Acme']]));

    const result = await service.resolve('user-1', {
      refs: [
        { kind: 'team', id: 'team-owned' },
        { kind: 'team', id: 'team-member' },
        { kind: 'team', id: 'team-outsider' },
      ],
    });

    expect(repo.loadTeamMembershipIds).toHaveBeenCalledWith('user-1', [
      'team-owned',
      'team-member',
      'team-outsider',
    ]);
    expect(result.refs).toEqual([
      {
        kind: 'team',
        id: 'team-owned',
        accessible: true,
        title: 'Owned',
        status: null,
        roadmap_id: null,
        project_id: null,
        workspace_id: 'ws-1',
        parent_chain: [{ kind: 'workspace', id: 'ws-1', title: 'Acme' }],
      },
      {
        kind: 'team',
        id: 'team-member',
        accessible: true,
        title: 'Member',
        status: null,
        roadmap_id: null,
        project_id: null,
        workspace_id: null,
        parent_chain: [],
      },
      {
        kind: 'team',
        id: 'team-outsider',
        accessible: false,
        error_code: 'NOT_FOUND',
      },
    ]);
  });

  it('resolves projects through getAccessibleProjectIds or ownership, 404-style otherwise', async () => {
    const { service, repo, roadmapsRepo } = buildService();
    repo.loadRefProjects.mockResolvedValue([
      {
        id: 'p-member',
        title: 'Member project',
        status: 'active',
        workspace_id: 'ws-1',
        owner_id: 'boss',
      },
      {
        id: 'p-owned',
        title: 'Owned',
        status: 'draft',
        workspace_id: null,
        owner_id: 'user-1',
      },
      {
        id: 'p-foreign',
        title: 'Foreign',
        status: 'active',
        workspace_id: 'ws-9',
        owner_id: 'boss',
      },
    ]);
    roadmapsRepo.getAccessibleProjectIds.mockResolvedValue(['p-member']);
    repo.loadWorkspaceNames.mockResolvedValue(new Map([['ws-1', 'Acme']]));

    const result = await service.resolve('user-1', {
      refs: [
        { kind: 'project', id: 'p-member' },
        { kind: 'project', id: 'p-owned' },
        { kind: 'project', id: 'p-foreign' },
      ],
    });

    // Only workspaces of accessible projects are looked up (no probing ws-9).
    expect(repo.loadWorkspaceNames).toHaveBeenCalledWith(['ws-1']);
    expect(result.refs.map((ref) => [ref.id, ref.accessible])).toEqual([
      ['p-member', true],
      ['p-owned', true],
      ['p-foreign', false],
    ]);
    expect(result.refs[0]).toMatchObject({
      project_id: 'p-member',
      workspace_id: 'ws-1',
      parent_chain: [{ kind: 'workspace', id: 'ws-1', title: 'Acme' }],
    });
    expect(result.refs[2]).not.toHaveProperty('title');
  });

  describe('project refs and their linked roadmap', () => {
    const projectRow = {
      id: 'proj-a',
      title: 'Project A',
      status: 'active',
      workspace_id: 'ws-1',
      owner_id: 'boss',
    };

    it('carries the linked roadmap id when that roadmap is viewable, through the single authorization probe', async () => {
      const { service, repo, roadmapAuth, roadmapsRepo } = buildService();
      repo.loadRefProjects.mockResolvedValue([projectRow]);
      repo.loadLinkedRoadmapIds.mockResolvedValue(
        new Map([['proj-a', 'rm-a']]),
      );
      roadmapAuth.filterViewableRoadmapIds.mockResolvedValue(
        new Map([
          ['rm-a', { projectId: 'proj-a', ownerId: 'boss', name: 'Roadmap A' }],
        ]),
      );
      roadmapsRepo.getAccessibleProjectIds.mockResolvedValue(['proj-a']);
      repo.loadWorkspaceNames.mockResolvedValue(new Map([['ws-1', 'Acme']]));

      const result = await service.resolve('user-1', {
        refs: [{ kind: 'project', id: 'proj-a' }],
      });

      expect(repo.loadLinkedRoadmapIds).toHaveBeenCalledWith(['proj-a']);
      expect(roadmapAuth.filterViewableRoadmapIds).toHaveBeenCalledTimes(1);
      expect(roadmapAuth.filterViewableRoadmapIds).toHaveBeenCalledWith(
        'user-1',
        ['rm-a'],
      );
      expect(result.refs).toEqual([
        {
          kind: 'project',
          id: 'proj-a',
          accessible: true,
          title: 'Project A',
          status: 'active',
          roadmap_id: 'rm-a',
          project_id: 'proj-a',
          workspace_id: 'ws-1',
          // The chain is unchanged: a project still hangs off its workspace.
          parent_chain: [{ kind: 'workspace', id: 'ws-1', title: 'Acme' }],
        },
      ]);
    });

    it('still authorizes ONE union when the batch names both the project and its roadmap (the roadmap-page case)', async () => {
      const { service, repo, roadmapAuth, roadmapsRepo } = buildService();
      repo.loadRefProjects.mockResolvedValue([projectRow]);
      repo.loadRefRoadmaps.mockResolvedValue([
        {
          id: 'rm-a',
          name: 'Roadmap A',
          status: 'active',
          project_id: 'proj-a',
          owner_id: 'boss',
        },
      ]);
      repo.loadLinkedRoadmapIds.mockResolvedValue(
        new Map([['proj-a', 'rm-a']]),
      );
      roadmapAuth.filterViewableRoadmapIds.mockResolvedValue(
        new Map([
          ['rm-a', { projectId: 'proj-a', ownerId: 'boss', name: 'Roadmap A' }],
        ]),
      );
      roadmapsRepo.getAccessibleProjectIds.mockResolvedValue(['proj-a']);

      const result = await service.resolve('user-1', {
        refs: [
          { kind: 'roadmap', id: 'rm-a' },
          { kind: 'project', id: 'proj-a' },
        ],
      });

      expect(roadmapAuth.filterViewableRoadmapIds).toHaveBeenCalledTimes(1);
      expect(roadmapAuth.filterViewableRoadmapIds).toHaveBeenCalledWith(
        'user-1',
        ['rm-a'],
      );
      expect(result.refs.map((ref) => [ref.kind, ref.roadmap_id])).toEqual([
        ['roadmap', 'rm-a'],
        ['project', 'rm-a'],
      ]);
    });

    it('leaves roadmap_id null when the project has no linked roadmap or the roadmap is not viewable', async () => {
      const { service, repo, roadmapAuth, roadmapsRepo } = buildService();
      repo.loadRefProjects.mockResolvedValue([
        { ...projectRow, id: 'p-bare', title: 'No roadmap yet' },
        { ...projectRow, id: 'p-hidden', title: 'Hidden roadmap' },
      ]);
      // p-bare is absent from the map; p-hidden's roadmap fails the probe.
      repo.loadLinkedRoadmapIds.mockResolvedValue(
        new Map([['p-hidden', 'rm-hidden']]),
      );
      roadmapAuth.filterViewableRoadmapIds.mockResolvedValue(new Map());
      roadmapsRepo.getAccessibleProjectIds.mockResolvedValue([
        'p-bare',
        'p-hidden',
      ]);

      const result = await service.resolve('user-1', {
        refs: [
          { kind: 'project', id: 'p-bare' },
          { kind: 'project', id: 'p-hidden' },
        ],
      });

      expect(roadmapAuth.filterViewableRoadmapIds).toHaveBeenCalledWith(
        'user-1',
        ['rm-hidden'],
      );
      expect(result.refs).toEqual([
        expect.objectContaining({
          id: 'p-bare',
          accessible: true,
          title: 'No roadmap yet',
          roadmap_id: null,
        }),
        expect.objectContaining({
          id: 'p-hidden',
          accessible: true,
          title: 'Hidden roadmap',
          roadmap_id: null,
        }),
      ]);
    });

    it('keeps the project accessible with roadmap_id null when the linked-roadmap lookup fails', async () => {
      const { service, repo, roadmapAuth, roadmapsRepo } = buildService();
      repo.loadRefProjects.mockResolvedValue([projectRow]);
      repo.loadLinkedRoadmapIds.mockRejectedValue(new Error('roadmaps down'));
      roadmapsRepo.getAccessibleProjectIds.mockResolvedValue(['proj-a']);

      const result = await service.resolve('user-1', {
        refs: [{ kind: 'project', id: 'proj-a' }],
      });

      // Nothing to authorize once the lookup is gone: no probe, no denial.
      expect(roadmapAuth.filterViewableRoadmapIds).not.toHaveBeenCalled();
      expect(result.refs).toEqual([
        expect.objectContaining({
          kind: 'project',
          id: 'proj-a',
          accessible: true,
          title: 'Project A',
          roadmap_id: null,
        }),
      ]);
    });

    it('keeps the project accessible with roadmap_id null when the roadmap probe itself throws', async () => {
      const { service, repo, roadmapAuth, roadmapsRepo } = buildService();
      repo.loadRefProjects.mockResolvedValue([projectRow]);
      repo.loadLinkedRoadmapIds.mockResolvedValue(
        new Map([['proj-a', 'rm-a']]),
      );
      roadmapAuth.filterViewableRoadmapIds.mockRejectedValue(
        new Error('db down'),
      );
      roadmapsRepo.getAccessibleProjectIds.mockResolvedValue(['proj-a']);

      const result = await service.resolve('user-1', {
        refs: [{ kind: 'project', id: 'proj-a' }],
      });

      expect(result.refs).toEqual([
        expect.objectContaining({
          kind: 'project',
          id: 'proj-a',
          accessible: true,
          roadmap_id: null,
        }),
      ]);
    });

    it('never attaches a roadmap to a denied project ref', async () => {
      const { service, repo, roadmapAuth, roadmapsRepo } = buildService();
      repo.loadRefProjects.mockResolvedValue([projectRow]);
      repo.loadLinkedRoadmapIds.mockResolvedValue(
        new Map([['proj-a', 'rm-a']]),
      );
      roadmapAuth.filterViewableRoadmapIds.mockResolvedValue(
        new Map([
          ['rm-a', { projectId: 'proj-a', ownerId: 'boss', name: 'Roadmap A' }],
        ]),
      );
      roadmapsRepo.getAccessibleProjectIds.mockResolvedValue([]);

      const result = await service.resolve('user-1', {
        refs: [{ kind: 'project', id: 'proj-a' }],
      });

      expect(result.refs).toEqual([
        {
          kind: 'project',
          id: 'proj-a',
          accessible: false,
          error_code: 'NOT_FOUND',
        },
      ]);
    });
  });
});

describe('AiContextResolveRefsDto', () => {
  it('rejects more than 25 refs and unknown kinds', async () => {
    const tooMany = plainToInstance(AiContextResolveRefsDto, {
      refs: Array.from({ length: 26 }, (_, index) => ({
        kind: 'task',
        id: uuid(index + 1),
      })),
    });
    const errors = await validate(tooMany);
    expect(errors.map((error) => error.property)).toEqual(['refs']);
    expect(errors[0].constraints).toHaveProperty('arrayMaxSize');

    const badKind = plainToInstance(AiContextResolveRefsDto, {
      refs: [{ kind: 'sprint', id: uuid(1) }],
    });
    expect(await validate(badKind)).toHaveLength(1);

    const ok = plainToInstance(AiContextResolveRefsDto, {
      refs: [{ kind: 'roadmap', id: uuid(1), label: 'Roadmap' }],
    });
    expect(await validate(ok)).toHaveLength(0);
  });
});
