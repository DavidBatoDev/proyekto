import { RoadmapsRepositorySupabase } from './roadmaps.repository.supabase';

describe('RoadmapsRepositorySupabase findPreviews', () => {
  it('merge-sorts owned + shared roadmaps by updated_at desc across both blocks', async () => {
    const projectsBuilder = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockResolvedValue({ data: [], error: null }),
    };
    const projectAccessBuilder = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockResolvedValue({
        data: [{ project_id: 'project-shared' }],
        error: null,
      }),
    };
    // Owned and shared roadmaps are each individually ordered by updated_at
    // desc server-side (mirroring the real query), but the owned roadmap is
    // OLDER than the shared one - a bare concatenation of the two blocks
    // would still put it first.
    const roadmapsBuilder = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      neq: jest.fn().mockReturnThis(),
      order: jest
        .fn()
        .mockResolvedValueOnce({
          data: [{ id: 'r-owned', updated_at: '2026-01-01T00:00:00Z' }],
          error: null,
        })
        .mockResolvedValueOnce({
          data: [{ id: 'r-shared', updated_at: '2026-01-10T00:00:00Z' }],
          error: null,
        }),
    };
    const emptyChildBuilder = {
      select: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      order: jest.fn().mockResolvedValue({ data: [], error: null }),
    };
    const from = jest.fn((table: string) => {
      if (table === 'projects') return projectsBuilder;
      if (table === 'project_access') return projectAccessBuilder;
      if (table === 'roadmaps') return roadmapsBuilder;
      if (
        table === 'roadmap_epics' ||
        table === 'roadmap_features' ||
        table === 'roadmap_milestones'
      ) {
        return emptyChildBuilder;
      }
      throw new Error(`Unexpected table: ${table}`);
    });
    const repo = new RoadmapsRepositorySupabase({ from } as never);

    const result = await repo.findPreviews('user-1');

    expect(result.map((r) => r.id)).toEqual(['r-shared', 'r-owned']);
  });
});

describe('RoadmapsRepositorySupabase searchContextCandidates', () => {
  it('short-circuits wildcard-only query without touching db', async () => {
    const from = jest.fn();
    const repo = new RoadmapsRepositorySupabase({ from } as never);

    const result = await repo.searchContextCandidates(
      '55e431e2-e416-468c-a973-94d97280e97d',
      '%%%___%%',
      { nodeType: 'epic', scanLimit: 20 },
    );

    expect(result).toEqual([]);
    expect(from).not.toHaveBeenCalled();
  });

  it('sanitizes wildcard chars before building ilike passes', async () => {
    const ilikeCalls: Array<{ column: string; pattern: string }> = [];

    const queryBuilder = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      ilike: jest.fn((column: string, pattern: string) => {
        ilikeCalls.push({ column, pattern });
        return queryBuilder;
      }),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue({ data: [], error: null }),
    };

    const from = jest.fn().mockReturnValue(queryBuilder);
    const repo = new RoadmapsRepositorySupabase({ from } as never);

    await repo.searchContextCandidates(
      '55e431e2-e416-468c-a973-94d97280e97d',
      'Roadmap%__Module',
      { nodeType: 'epic', scanLimit: 20 },
    );

    expect(ilikeCalls.length).toBeGreaterThan(0);
    for (const call of ilikeCalls) {
      expect(call.pattern).not.toContain('%__');
      expect(call.pattern).not.toContain('__');
    }
    expect(ilikeCalls.map((entry) => entry.pattern)).toEqual(
      expect.arrayContaining([
        'roadmap module',
        'roadmap module%',
        '%roadmap module%',
      ]),
    );
  });
});

describe('RoadmapsRepositorySupabase migrateGuestRoadmaps', () => {
  const buildDb = ({
    guestProfileId = 'guest-profile-1',
    migratedRows = [] as Array<{ id: string }>,
  }: {
    guestProfileId?: string | null;
    migratedRows?: Array<{ id: string }>;
  } = {}) => {
    const profilesBuilder = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: guestProfileId ? { id: guestProfileId } : null,
        error: null,
      }),
    };
    const roadmapsBuilder = {
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      select: jest.fn().mockResolvedValue({ data: migratedRows, error: null }),
    };
    const sessionsBuilder = {
      update: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      in: jest.fn().mockResolvedValue({ error: null }),
    };
    const from = jest.fn((table: string) => {
      if (table === 'profiles') return profilesBuilder;
      if (table === 'roadmaps') return roadmapsBuilder;
      if (table === 'roadmap_ai_sessions') return sessionsBuilder;
      throw new Error(`Unexpected table: ${table}`);
    });
    return { from, profilesBuilder, roadmapsBuilder, sessionsBuilder };
  };

  it('reassigns roadmaps AND their ai sessions to the user', async () => {
    const db = buildDb({
      migratedRows: [{ id: 'roadmap-1' }, { id: 'roadmap-2' }],
    });
    const repo = new RoadmapsRepositorySupabase({ from: db.from } as never);

    const result = await repo.migrateGuestRoadmaps('session-1', 'user-1');

    expect(result).toEqual({ migrated: 2 });
    expect(db.roadmapsBuilder.update).toHaveBeenCalledWith({
      owner_id: 'user-1',
    });
    expect(db.roadmapsBuilder.eq).toHaveBeenCalledWith(
      'owner_id',
      'guest-profile-1',
    );
    expect(db.sessionsBuilder.update).toHaveBeenCalledWith({
      user_id: 'user-1',
    });
    expect(db.sessionsBuilder.eq).toHaveBeenCalledWith(
      'user_id',
      'guest-profile-1',
    );
    expect(db.sessionsBuilder.in).toHaveBeenCalledWith('roadmap_id', [
      'roadmap-1',
      'roadmap-2',
    ]);
  });

  it('skips session reassignment when no roadmaps migrated', async () => {
    const db = buildDb({ migratedRows: [] });
    const repo = new RoadmapsRepositorySupabase({ from: db.from } as never);

    const result = await repo.migrateGuestRoadmaps('session-1', 'user-1');

    expect(result).toEqual({ migrated: 0 });
    expect(db.sessionsBuilder.update).not.toHaveBeenCalled();
  });

  it('returns 0 without touching roadmaps when the guest profile is missing', async () => {
    const db = buildDb({ guestProfileId: null });
    const repo = new RoadmapsRepositorySupabase({ from: db.from } as never);

    const result = await repo.migrateGuestRoadmaps('session-1', 'user-1');

    expect(result).toEqual({ migrated: 0 });
    expect(db.roadmapsBuilder.update).not.toHaveBeenCalled();
    expect(db.sessionsBuilder.update).not.toHaveBeenCalled();
  });
});

describe('RoadmapsRepositorySupabase listAccessibleRoadmapsLight', () => {
  function buildRepo(options: {
    ownedProjectIds?: string[];
    memberProjectIds?: string[];
    owned: Array<Record<string, unknown>>;
    shared?: Array<Record<string, unknown>>;
  }) {
    const projectsBuilder = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockResolvedValue({
        data: (options.ownedProjectIds ?? []).map((id) => ({ id })),
        error: null,
      }),
    };
    const projectAccessBuilder = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockResolvedValue({
        data: (options.memberProjectIds ?? []).map((project_id) => ({
          project_id,
        })),
        error: null,
      }),
    };
    const roadmapsBuilder = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      neq: jest.fn().mockReturnThis(),
      order: jest
        .fn()
        .mockResolvedValueOnce({ data: options.owned, error: null })
        .mockResolvedValueOnce({ data: options.shared ?? [], error: null }),
    };
    const from = jest.fn((table: string) => {
      if (table === 'projects') return projectsBuilder;
      if (table === 'project_access') return projectAccessBuilder;
      if (table === 'roadmaps') return roadmapsBuilder;
      throw new Error(`Unexpected table: ${table}`);
    });
    return {
      repo: new RoadmapsRepositorySupabase({ from } as never),
      roadmapsBuilder,
    };
  }

  it('selects only the light columns and merge-sorts owned + shared by updated_at desc', async () => {
    const { repo, roadmapsBuilder } = buildRepo({
      memberProjectIds: ['project-shared'],
      owned: [
        {
          id: 'r-owned',
          name: 'Owned',
          description: null,
          status: 'draft',
          project_id: null,
          owner_id: 'user-1',
          updated_at: '2026-01-01T00:00:00Z',
          project: null,
        },
      ],
      shared: [
        {
          id: 'r-shared',
          name: 'Shared',
          description: 'd',
          status: 'active',
          project_id: 'project-shared',
          owner_id: 'user-2',
          updated_at: '2026-01-10T00:00:00Z',
          // The client may widen the to-one embed to an array.
          project: [
            { id: 'project-shared', title: 'Apollo', workspace_id: 'ws-1' },
          ],
        },
      ],
    });

    const result = await repo.listAccessibleRoadmapsLight('user-1');

    expect(result.map((r) => r.id)).toEqual(['r-shared', 'r-owned']);
    expect(result[0]).toEqual({
      id: 'r-shared',
      name: 'Shared',
      description: 'd',
      status: 'active',
      project_id: 'project-shared',
      owner_id: 'user-2',
      updated_at: '2026-01-10T00:00:00Z',
      project: { id: 'project-shared', title: 'Apollo', workspace_id: 'ws-1' },
    });
    expect(result[1].project).toBeNull();
    const selects = roadmapsBuilder.select.mock.calls.map(
      (call) => call[0] as string,
    );
    expect(selects).toHaveLength(2);
    for (const select of selects) {
      expect(select).not.toContain('*');
      expect(select).toContain('project:projects(id, title, workspace_id)');
    }
    expect(roadmapsBuilder.in).toHaveBeenCalledWith('project_id', [
      'project-shared',
    ]);
    expect(roadmapsBuilder.neq).toHaveBeenCalledWith('owner_id', 'user-1');
  });

  it('skips the shared query without accessible projects and dedupes by id', async () => {
    const { repo, roadmapsBuilder } = buildRepo({
      owned: [
        { id: 'r-1', name: 'A', updated_at: '2026-01-01T00:00:00Z' },
        { id: 'r-1', name: 'A again', updated_at: '2026-01-02T00:00:00Z' },
        { id: 42, name: 'not a uuid' },
      ],
    });

    const result = await repo.listAccessibleRoadmapsLight('user-1');

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('A again');
    expect(roadmapsBuilder.in).not.toHaveBeenCalled();
    expect(roadmapsBuilder.order).toHaveBeenCalledTimes(1);
  });

  it('exposes getAccessibleProjectIds as the owned + member union', async () => {
    const { repo } = buildRepo({
      ownedProjectIds: ['p-1', 'p-2'],
      memberProjectIds: ['p-2', 'p-3'],
      owned: [],
    });

    await expect(repo.getAccessibleProjectIds('user-1')).resolves.toEqual([
      'p-1',
      'p-2',
      'p-3',
    ]);
  });
});

describe('RoadmapsRepositorySupabase findFull task assignees', () => {
  const ROADMAP_ID = '55e431e2-e416-468c-a973-94d97280e97d';
  const ANA = '0f7be23f-3b57-4cf4-a269-a98d2164a45a';
  const BEN = '8d1c2b3a-4e5f-4a6b-9c7d-0e1f2a3b4c5d';

  const build = (row: Record<string, unknown>) => {
    const single = jest.fn().mockResolvedValue({ data: row, error: null });
    const eq = jest.fn().mockReturnValue({ single });
    const select = jest.fn().mockReturnValue({ eq });
    const from = jest.fn().mockReturnValue({ select });
    return { repo: new RoadmapsRepositorySupabase({ from } as never), select };
  };

  const roadmapRow = (assignees: unknown[]) => ({
    id: ROADMAP_ID,
    epics: [
      {
        id: 'epic-1',
        position: 0,
        features: [
          {
            id: 'feature-1',
            position: 0,
            assignees: [],
            tasks: [{ id: 'task-1', position: 0, assignee_id: BEN, assignees }],
          },
        ],
      },
    ],
  });

  it('lean select still embeds the assignee ids and flattens them to { id }, primary first', async () => {
    const { repo, select } = build(
      roadmapRow([{ assignee_id: ANA }, { assignee_id: BEN }]),
    );

    const result = await repo.findFull(ROADMAP_ID, undefined, {
      includeTaskAssigneeProfile: false,
    });

    const selectString = select.mock.calls[0][0] as string;
    expect(selectString).toContain(
      'tasks:roadmap_tasks(*, assignees:roadmap_task_assignees(assignee_id))',
    );
    expect(selectString).not.toContain(
      'assignee:profiles!roadmap_tasks_assignee_id_fkey',
    );
    expect(result.epics[0].features[0].tasks[0].assignees).toEqual([
      { id: BEN },
      { id: ANA },
    ]);
  });

  it('full select flattens the profile embeds and puts the stored primary first', async () => {
    const { repo, select } = build(
      roadmapRow([
        { profile: { id: ANA, display_name: 'Ana' } },
        { profile: { id: BEN, display_name: 'Ben' } },
      ]),
    );

    const result = await repo.findFull(ROADMAP_ID);

    expect(select.mock.calls[0][0]).toContain(
      'assignees:roadmap_task_assignees(profile:profiles!assignee_id(',
    );
    expect(result.epics[0].features[0].tasks[0].assignees).toEqual([
      { id: BEN, display_name: 'Ben' },
      { id: ANA, display_name: 'Ana' },
    ]);
  });

  it('leaves the order alone when the column is not part of the set', async () => {
    const { repo } = build(roadmapRow([{ assignee_id: ANA }]));

    const result = await repo.findFull(ROADMAP_ID, undefined, {
      includeTaskAssigneeProfile: false,
    });

    expect(result.epics[0].features[0].tasks[0].assignees).toEqual([
      { id: ANA },
    ]);
  });
});
