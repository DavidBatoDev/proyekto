import { BadRequestException, NotFoundException } from '@nestjs/common';
import { REDIS_CACHE_KEYS } from '../../../../common/cache/redis-cache.keys';
import type { AccessibleRoadmapLightRecord } from '../../roadmaps/repositories/roadmaps.repository.interface';
import {
  AiContextService,
  classifyAiContextLane,
  decodeAiContextCursor,
  encodeAiContextCursor,
  mapTaskStatusFilter,
  sanitizeAiContextQuery,
} from './ai-context.service';

const WS_CURRENT = 'ws-current';
const WS_OTHER = 'ws-other';
const WS_FOREIGN = 'ws-foreign';

function roadmap(
  overrides: Partial<AccessibleRoadmapLightRecord> & { id: string },
): AccessibleRoadmapLightRecord {
  return {
    name: `Roadmap ${overrides.id}`,
    description: null,
    status: 'active',
    project_id: null,
    owner_id: 'user-1',
    updated_at: '2026-01-01T00:00:00+00:00',
    project: null,
    ...overrides,
  };
}

function buildService(
  options: {
    roadmaps?: AccessibleRoadmapLightRecord[];
    projects?: Array<Record<string, unknown>>;
    teams?: Array<Record<string, unknown>>;
    workspaces?: Array<Record<string, unknown>>;
    isMember?: boolean;
  } = {},
) {
  const repo = {
    readActorDisplayName: jest.fn().mockResolvedValue('Ada'),
    roadmapCounts: jest.fn().mockResolvedValue(new Map()),
    searchNodes: jest.fn().mockResolvedValue([]),
    listTasks: jest.fn().mockResolvedValue([]),
    listChangeHistory: jest.fn().mockResolvedValue([]),
    filterProjectIdsByWorkspace: jest.fn().mockResolvedValue([]),
  };
  const roadmapsRepo = {
    listAccessibleRoadmapsLight: jest
      .fn()
      .mockResolvedValue(options.roadmaps ?? []),
    getAccessibleProjectIds: jest.fn().mockResolvedValue([]),
  };
  const roadmapAuth = {
    filterViewableRoadmapIds: jest.fn().mockResolvedValue(new Map()),
  };
  const projectsService = {
    listDashboardProjects: jest.fn().mockResolvedValue(options.projects ?? []),
  };
  const workspacesService = {
    isMember: jest.fn().mockResolvedValue(options.isMember ?? true),
    listMyWorkspaces: jest.fn().mockResolvedValue(options.workspaces ?? []),
    fetchWorkspaceOrThrow: jest.fn().mockResolvedValue({
      id: WS_CURRENT,
      name: 'Fetched',
      slug: 'fetched',
    }),
  };
  const teamsService = {
    listMyTeams: jest.fn().mockResolvedValue(options.teams ?? []),
  };
  const cache = {
    getDashboardTtlSeconds: jest.fn().mockReturnValue(15),
    rememberJson: jest.fn(
      (_key: string, _ttl: number, loader: () => Promise<unknown>) => loader(),
    ),
  };
  const service = new AiContextService(
    repo as never,
    roadmapsRepo as never,
    roadmapAuth as never,
    projectsService as never,
    workspacesService as never,
    teamsService as never,
    cache as never,
  );
  return {
    service,
    repo,
    roadmapsRepo,
    roadmapAuth,
    projectsService,
    workspacesService,
    teamsService,
    cache,
  };
}

describe('AiContextService helpers', () => {
  it('sanitizes the needle like sanitizeLookupQuery (wildcards, whitespace, length)', () => {
    expect(sanitizeAiContextQuery('  Pay%ments__Core  ')).toBe(
      'pay ments core',
    );
    expect(sanitizeAiContextQuery('%%%___')).toBe('');
    expect(sanitizeAiContextQuery('a'.repeat(200))).toHaveLength(160);
  });

  it('maps status=open to the four non-done statuses and all to no filter', () => {
    expect(mapTaskStatusFilter('open')).toEqual([
      'todo',
      'in_progress',
      'in_review',
      'blocked',
    ]);
    expect(mapTaskStatusFilter(undefined)).toEqual([
      'todo',
      'in_progress',
      'in_review',
      'blocked',
    ]);
    expect(mapTaskStatusFilter('all')).toBeNull();
    expect(mapTaskStatusFilter('blocked')).toEqual(['blocked']);
  });

  it('lanes current | shared | other_workspace', () => {
    const member = new Set([WS_CURRENT, WS_OTHER]);
    expect(classifyAiContextLane(WS_CURRENT, WS_CURRENT, member)).toBe(
      'current',
    );
    expect(classifyAiContextLane(WS_OTHER, WS_CURRENT, member)).toBe(
      'other_workspace',
    );
    expect(classifyAiContextLane(null, WS_CURRENT, member)).toBe('shared');
    expect(classifyAiContextLane(WS_FOREIGN, WS_CURRENT, member)).toBe(
      'shared',
    );
    // No workspace requested: anything in one of mine is current.
    expect(classifyAiContextLane(WS_OTHER, null, member)).toBe('current');
    expect(classifyAiContextLane(WS_FOREIGN, null, member)).toBe('shared');
  });

  it('round-trips the keyset cursor and rejects garbage', () => {
    const cursor = encodeAiContextCursor({
      updated_at: '2026-02-02T00:00:00+00:00',
      id: 'r-1',
    });
    expect(decodeAiContextCursor(cursor)).toEqual({
      updatedAt: '2026-02-02T00:00:00+00:00',
      id: 'r-1',
    });
    expect(
      decodeAiContextCursor(
        encodeAiContextCursor({ updated_at: null, id: 'x' }),
      ),
    ).toEqual({ updatedAt: '', id: 'x' });
    expect(
      decodeAiContextCursor(Buffer.from('no-separator').toString('base64url')),
    ).toBeNull();
  });
});

describe('AiContextService.getOverview', () => {
  it('404s a non-member workspace before touching the cache', async () => {
    const { service, cache, workspacesService } = buildService({
      isMember: false,
    });

    await expect(
      service.getOverview({ id: 'user-1' }, { workspace_id: WS_FOREIGN }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(workspacesService.isMember).toHaveBeenCalledWith(
      WS_FOREIGN,
      'user-1',
    );
    expect(cache.rememberJson).not.toHaveBeenCalled();
  });

  it('lanes projects/roadmaps/teams against the requested workspace and merges counts', async () => {
    const roadmaps = [
      roadmap({
        id: 'r-current',
        project_id: 'p-current',
        project: {
          id: 'p-current',
          title: 'Current',
          workspace_id: WS_CURRENT,
        },
      }),
      roadmap({
        id: 'r-other',
        project_id: 'p-other',
        project: { id: 'p-other', title: 'Other', workspace_id: WS_OTHER },
      }),
      roadmap({
        id: 'r-foreign',
        project_id: 'p-foreign',
        project: {
          id: 'p-foreign',
          title: 'Foreign',
          workspace_id: WS_FOREIGN,
        },
      }),
      roadmap({ id: 'r-personal' }),
    ];
    const projects = [
      {
        id: 'p-current',
        title: 'Current',
        status: 'active',
        workspace_id: WS_CURRENT,
        owner_id: 'someone-else',
        members: [
          { user_id: 'user-1', role: 'editor' },
          { user_id: 'someone-else', role: 'owner' },
        ],
      },
      {
        id: 'p-owned',
        title: 'Owned unhomed',
        status: 'draft',
        workspace_id: null,
        owner_id: 'user-1',
        members: [],
      },
    ];
    const teams = [
      {
        id: 't-1',
        name: 'Team',
        workspace_id: WS_OTHER,
        status: 'active',
        owner_id: 'user-1',
        viewer_role: null,
      },
    ];
    const workspaces = [
      { id: WS_CURRENT, name: 'Current WS', slug: 'current', my_role: 'admin' },
      { id: WS_OTHER, name: 'Other WS', slug: 'other', my_role: 'member' },
    ];
    const { service, repo, cache, workspacesService } = buildService({
      roadmaps,
      projects,
      teams,
      workspaces,
    });
    repo.roadmapCounts.mockResolvedValue(
      new Map([
        [
          'r-current',
          { epics: 2, features: 4, tasks: 9, open_tasks: 5, overdue_tasks: 1 },
        ],
      ]),
    );

    const overview = await service.getOverview(
      { id: 'user-1' },
      { workspace_id: WS_CURRENT },
    );

    expect(cache.rememberJson).toHaveBeenCalledWith(
      REDIS_CACHE_KEYS.aiContextOverviewByUser('user-1', WS_CURRENT),
      15,
      expect.any(Function),
      { indexKey: REDIS_CACHE_KEYS.aiContextOverviewIndexByUser('user-1') },
    );
    expect(repo.roadmapCounts).toHaveBeenCalledWith([
      'r-current',
      'r-other',
      'r-foreign',
      'r-personal',
    ]);
    expect(workspacesService.fetchWorkspaceOrThrow).not.toHaveBeenCalled();
    expect(overview.workspace).toEqual({
      id: WS_CURRENT,
      name: 'Current WS',
      slug: 'current',
      my_role: 'admin',
    });
    expect(overview.roadmaps.map((r) => [r.id, r.lane])).toEqual([
      ['r-current', 'current'],
      ['r-other', 'other_workspace'],
      ['r-foreign', 'shared'],
      ['r-personal', 'shared'],
    ]);
    expect(overview.roadmaps[0].counts).toEqual({
      epics: 2,
      features: 4,
      tasks: 9,
      open_tasks: 5,
      overdue_tasks: 1,
    });
    expect(overview.roadmaps[1].counts).toEqual({
      epics: 0,
      features: 0,
      tasks: 0,
      open_tasks: 0,
      overdue_tasks: 0,
    });
    expect(overview.projects).toEqual([
      expect.objectContaining({
        id: 'p-current',
        lane: 'current',
        my_role: 'editor',
        member_count: 2,
        roadmap_id: 'r-current',
      }),
      expect.objectContaining({
        id: 'p-owned',
        lane: 'shared',
        my_role: 'owner',
        member_count: 0,
        roadmap_id: null,
      }),
    ]);
    expect(overview.teams).toEqual([
      expect.objectContaining({
        id: 't-1',
        lane: 'other_workspace',
        my_role: 'owner',
      }),
    ]);
    expect(overview.counts_truncated).toBe(false);
    expect(typeof overview.generated_at).toBe('string');
  });

  it('uses the ws:none key and a null workspace when none is requested, and skips workspace reads for guests', async () => {
    const { service, cache, workspacesService } = buildService({
      roadmaps: [roadmap({ id: 'r-1' })],
    });

    const overview = await service.getOverview(
      { id: 'guest-1', is_guest: true },
      {},
    );

    expect(cache.rememberJson.mock.calls[0][0]).toBe(
      REDIS_CACHE_KEYS.aiContextOverviewByUser('guest-1', null),
    );
    expect(workspacesService.isMember).not.toHaveBeenCalled();
    expect(workspacesService.listMyWorkspaces).not.toHaveBeenCalled();
    expect(overview.workspace).toBeNull();
    expect(overview.roadmaps[0].lane).toBe('shared');
  });

  it('flags truncated counts past the cap and only sends the first 300 ids', async () => {
    const roadmaps = Array.from({ length: 301 }, (_, index) =>
      roadmap({ id: `r-${index}` }),
    );
    const { service, repo } = buildService({ roadmaps });

    const overview = await service.getOverview({ id: 'user-1' }, {});

    expect(repo.roadmapCounts.mock.calls[0][0]).toHaveLength(300);
    expect(overview.counts_truncated).toBe(true);
  });
});

describe('AiContextService.listRoadmaps', () => {
  const roadmaps = [
    roadmap({ id: 'r-b', updated_at: '2026-03-01T00:00:00+00:00' }),
    roadmap({ id: 'r-a', updated_at: '2026-03-01T00:00:00+00:00' }),
    roadmap({ id: 'r-old', updated_at: '2026-01-01T00:00:00+00:00' }),
    roadmap({ id: 'r-null', updated_at: null }),
  ];

  it('pages by (updated_at desc, id asc) and the cursor resumes exactly after the last item', async () => {
    const { service } = buildService({ roadmaps });

    const first = await service.listRoadmaps('user-1', { limit: 2 });
    expect(first.items.map((item) => item.id)).toEqual(['r-a', 'r-b']);
    expect(first.next_cursor).not.toBeNull();

    const second = await service.listRoadmaps('user-1', {
      limit: 2,
      cursor: first.next_cursor as string,
    });
    expect(second.items.map((item) => item.id)).toEqual(['r-old', 'r-null']);
    expect(second.next_cursor).toBeNull();
  });

  it('rejects an undecodable cursor with 400 and narrows by workspace/project in-process', async () => {
    const scoped = [
      roadmap({
        id: 'r-ws',
        project_id: 'p-1',
        project: { id: 'p-1', title: 'P1', workspace_id: WS_CURRENT },
      }),
      roadmap({ id: 'r-personal', description: 'x'.repeat(400) }),
    ];
    const { service } = buildService({ roadmaps: scoped });

    await expect(
      service.listRoadmaps('user-1', { cursor: '!!!not-base64|' }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const byWorkspace = await service.listRoadmaps('user-1', {
      workspace_id: WS_CURRENT,
    });
    expect(byWorkspace.items.map((item) => item.id)).toEqual(['r-ws']);
    expect(byWorkspace.items[0].project).toEqual({
      id: 'p-1',
      title: 'P1',
      workspace_id: WS_CURRENT,
    });

    const byProject = await service.listRoadmaps('user-1', {
      project_id: 'p-1',
    });
    expect(byProject.items.map((item) => item.id)).toEqual(['r-ws']);

    const all = await service.listRoadmaps('user-1', {});
    const personal = all.items.find((item) => item.id === 'r-personal');
    expect(personal?.description).toHaveLength(280);
  });
});

describe('AiContextService.search', () => {
  const roadmaps = [
    roadmap({
      id: 'r-1',
      name: 'Payments platform',
      project_id: 'p-1',
      project: { id: 'p-1', title: 'Fintech', workspace_id: WS_CURRENT },
    }),
    roadmap({ id: 'r-2', name: 'Mobile' }),
  ];

  it('returns no matches and never calls the RPC on an empty needle', async () => {
    const { service, repo, roadmapsRepo } = buildService({ roadmaps });

    await expect(service.search('user-1', { q: '%%__' })).resolves.toEqual({
      matches: [],
    });
    expect(repo.searchNodes).not.toHaveBeenCalled();
    expect(roadmapsRepo.listAccessibleRoadmapsLight).not.toHaveBeenCalled();
  });

  it('passes the sanitized needle and only accessible ids; roadmap_ids intersects, never widens', async () => {
    const { service, repo } = buildService({ roadmaps });
    repo.searchNodes.mockResolvedValue([
      {
        id: 'e-1',
        kind: 'epic',
        title: 'Payments core',
        status: 'active',
        roadmap_id: 'r-1',
        epic_id: null,
        feature_id: null,
        parent_title: null,
        rank: 1,
        updated_at: '2026-02-01T00:00:00+00:00',
      },
      {
        id: 'leak',
        kind: 'task',
        title: 'Should not attribute',
        status: 'todo',
        roadmap_id: 'r-unknown',
        epic_id: null,
        feature_id: null,
        parent_title: null,
        rank: 0,
        updated_at: null,
      },
    ]);

    const result = await service.search('user-1', {
      q: ' Pay%ments ',
      roadmap_ids: ['r-1', 'r-not-mine'],
      kinds: ['epic', 'task', 'roadmap'],
      limit: 10,
    });

    expect(repo.searchNodes).toHaveBeenCalledWith({
      roadmapIds: ['r-1'],
      query: 'pay ments',
      kinds: ['epic', 'task'],
      limit: 10,
    });
    expect(result.matches.map((match) => match.id)).toEqual(['e-1']);
    expect(result.matches[0]).toMatchObject({
      kind: 'epic',
      roadmap_name: 'Payments platform',
      project_id: 'p-1',
      project_title: 'Fintech',
      workspace_id: WS_CURRENT,
    });
  });

  it('matches roadmap and project kinds in-process, ranked exact < prefix < substring, and skips the RPC for them', async () => {
    const projects = [
      {
        id: 'p-1',
        title: 'Fintech',
        status: 'active',
        workspace_id: WS_CURRENT,
        updated_at: '2026-02-01T00:00:00+00:00',
      },
      {
        id: 'p-9',
        title: 'Mobile',
        description: 'payments for mobile',
        workspace_id: null,
      },
    ];
    const { service, repo } = buildService({ roadmaps, projects });

    const result = await service.search('user-1', {
      q: 'payments',
      kinds: ['roadmap', 'project'],
    });

    expect(repo.searchNodes).not.toHaveBeenCalled();
    expect(
      result.matches.map((match) => [match.kind, match.id, match.rank]),
    ).toEqual([
      ['roadmap', 'r-1', 1],
      ['project', 'p-9', 3],
    ]);
    expect(result.matches[0]).toMatchObject({
      project_id: 'p-1',
      project_title: 'Fintech',
      workspace_id: WS_CURRENT,
    });
  });
});

describe('AiContextService.listTasks', () => {
  const roadmaps = [
    roadmap({
      id: 'r-1',
      project_id: 'p-1',
      project: { id: 'p-1', title: 'Fintech', workspace_id: WS_CURRENT },
    }),
  ];

  it('maps status=open, forwards assigned_to_me as the caller id, and attributes rows', async () => {
    const { service, repo } = buildService({ roadmaps });
    repo.listTasks.mockResolvedValue([
      {
        id: 't-1',
        title: 'Ship',
        status: 'todo',
        priority: 'high',
        due_date: null,
        updated_at: null,
        feature_id: 'f-1',
        feature_title: 'Checkout',
        epic_id: 'e-1',
        epic_title: 'Payments',
        roadmap_id: 'r-1',
        assignee_ids: ['user-1'],
      },
    ]);

    const result = await service.listTasks('user-1', {
      assigned_to_me: true,
      status: 'open',
      due_before: '2026-12-31T00:00:00Z',
      limit: 7,
    });

    expect(repo.listTasks).toHaveBeenCalledWith({
      roadmapIds: ['r-1'],
      assignee: 'user-1',
      statuses: ['todo', 'in_progress', 'in_review', 'blocked'],
      dueFrom: null,
      dueTo: '2026-12-31T00:00:00Z',
      overdueAt: null,
      limit: 7,
    });
    expect(result.tasks[0]).toMatchObject({
      id: 't-1',
      roadmap_name: 'Roadmap r-1',
      project_id: 'p-1',
      project_title: 'Fintech',
      workspace_id: WS_CURRENT,
    });
  });

  it('sends no status filter for all, an overdue timestamp when asked, and skips the RPC with no accessible roadmaps', async () => {
    const { service, repo } = buildService({ roadmaps });

    await service.listTasks('user-1', { status: 'all', overdue: true });
    const params = repo.listTasks.mock.calls[0][0];
    expect(params.statuses).toBeNull();
    expect(params.assignee).toBeNull();
    expect(typeof params.overdueAt).toBe('string');

    repo.listTasks.mockClear();
    await expect(
      service.listTasks('user-1', { roadmap_ids: ['r-not-mine'] }),
    ).resolves.toEqual({ tasks: [] });
    expect(repo.listTasks).not.toHaveBeenCalled();
  });
});

describe('AiContextService.listChanges', () => {
  it('rejects neither/both selectors with 400', async () => {
    const { service } = buildService();
    await expect(service.listChanges('user-1', {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      service.listChanges('user-1', { run_id: 'run-1', session_id: 's-1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reads the actor rows by run id and drops roadmaps the caller can no longer view', async () => {
    const { service, repo, roadmapAuth } = buildService();
    repo.listChangeHistory.mockResolvedValue([
      { change_id: 'c-1', roadmap_id: 'r-1', run_id: 'run-1' },
      { change_id: 'c-2', roadmap_id: 'r-gone', run_id: 'run-1' },
    ]);
    roadmapAuth.filterViewableRoadmapIds.mockResolvedValue(
      new Map([['r-1', { projectId: null, ownerId: 'user-1', name: 'R1' }]]),
    );

    const result = await service.listChanges('user-1', { run_id: 'run-1' });

    expect(repo.listChangeHistory).toHaveBeenCalledWith({
      actorId: 'user-1',
      runId: 'run-1',
      sessionId: undefined,
      limit: 50,
    });
    expect(roadmapAuth.filterViewableRoadmapIds).toHaveBeenCalledWith(
      'user-1',
      ['r-1', 'r-gone'],
    );
    expect(result.changes.map((change) => change.change_id)).toEqual(['c-1']);
  });
});

describe('AiContextService.getActor', () => {
  it('returns the caller id with the profile display name', async () => {
    const { service } = buildService();
    await expect(service.getActor('user-1')).resolves.toEqual({
      actor_id: 'user-1',
      display_name: 'Ada',
      locale: null,
      timezone: null,
    });
  });
});
