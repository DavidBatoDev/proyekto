import { RoadmapAiService } from './roadmap-ai.service';

describe('RoadmapAiService search scoring', () => {
  const createService = () =>
    new RoadmapAiService(
      {
        from: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
        }),
      } as never,
      {
        findById: jest.fn(),
        findFull: jest.fn(),
      } as never,
      {} as never,
      { assertRoadmapPermission: jest.fn() } as never,
      {} as never,
    ) as unknown as {
      tokenizeSearchQuery: (query: string) => string[];
      normalizeSearchText: (value: string) => string;
      scoreContextSearchCandidate: (
        candidate: {
          id: string;
          type: 'epic' | 'feature' | 'task';
          title: string;
          description?: string;
          parent_id: string;
          parent_title?: string;
        },
        query: string,
        queryTokens: string[],
        typeHint?: 'epic' | 'feature' | 'task',
      ) => { score: number; matched_fields: string[] };
    };

  it('ranks title match above description-only match', () => {
    const service = createService();
    const query = 'platform foundation';
    const tokens = service.tokenizeSearchQuery(query);

    const titleHit = service.scoreContextSearchCandidate(
      {
        id: '1',
        type: 'epic',
        title: 'Platform Foundation',
        parent_id: 'root',
      },
      query,
      tokens,
    );
    const descriptionHit = service.scoreContextSearchCandidate(
      {
        id: '2',
        type: 'epic',
        title: 'Unrelated',
        description: 'Platform Foundation',
        parent_id: 'root',
      },
      query,
      tokens,
    );

    expect(titleHit.score).toBeGreaterThan(descriptionHit.score);
  });

  it('includes parent_title as a matched field when applicable', () => {
    const service = createService();
    const query = 'payments';
    const tokens = service.tokenizeSearchQuery(query);

    const candidate = service.scoreContextSearchCandidate(
      {
        id: '3',
        type: 'task',
        title: 'Implement retries',
        parent_id: 'feature-1',
        parent_title: 'Payments Platform',
      },
      query,
      tokens,
    );

    expect(candidate.score).toBeGreaterThan(0);
    expect(candidate.matched_fields).toContain('parent_title');
  });

  it('applies node type hint boost for matching types', () => {
    const service = createService();
    const query = 'authentication';
    const tokens = service.tokenizeSearchQuery(query);

    const withoutHint = service.scoreContextSearchCandidate(
      {
        id: '4',
        type: 'feature',
        title: 'Authentication workflow',
        parent_id: 'epic-1',
      },
      query,
      tokens,
      undefined,
    );
    const withHint = service.scoreContextSearchCandidate(
      {
        id: '4',
        type: 'feature',
        title: 'Authentication workflow',
        parent_id: 'epic-1',
      },
      query,
      tokens,
      'feature',
    );

    expect(withHint.score).toBeGreaterThan(withoutHint.score);
    expect(withHint.matched_fields).toContain('type_hint');
  });

  it('normalizes separator and punctuation in query tokens', () => {
    const service = createService();
    expect(service.tokenizeSearchQuery('auth,')).toEqual(['auth']);
    expect(service.tokenizeSearchQuery('oauth-callback')).toEqual([
      'oauth',
      'callback',
    ]);
    expect(service.tokenizeSearchQuery('db/setup')).toEqual(['db', 'setup']);
  });

  it('normalizes separators in searchable fields for matching', () => {
    const service = createService();
    const query = service.normalizeSearchText('oauth-callback');
    const tokens = service.tokenizeSearchQuery(query);
    const candidate = service.scoreContextSearchCandidate(
      {
        id: '5',
        type: 'feature',
        title: 'OAuth Callback',
        parent_id: 'epic-2',
      },
      query,
      tokens,
    );
    expect(candidate.score).toBeGreaterThan(0);
    expect(candidate.matched_fields).toContain('title');
  });

  it('bounds final score to [0,1]', () => {
    const service = createService();
    const query = service.normalizeSearchText('platform foundation feature');
    const tokens = service.tokenizeSearchQuery(query);
    const candidate = service.scoreContextSearchCandidate(
      {
        id: '6',
        type: 'feature',
        title: 'Platform Foundation Feature',
        description: 'Platform Foundation Feature',
        parent_id: 'epic-3',
        parent_title: 'Platform Foundation',
      },
      query,
      tokens,
      'feature',
    );
    expect(candidate.score).toBeGreaterThanOrEqual(0);
    expect(candidate.score).toBeLessThanOrEqual(1);
  });
});

describe('RoadmapAiService actor + assignee context', () => {
  const ROADMAP_ID = '55e431e2-e416-468c-a973-94d97280e97d';
  const USER_ID = 'f4a8b7e5-cf32-4d03-bad8-7e385efef7cb';

  const createServiceWithMocks = () => {
    const maybeSingle = jest
      .fn()
      .mockResolvedValue({ data: { display_name: 'Alice' }, error: null });
    const eq = jest.fn().mockReturnValue({ maybeSingle });
    const select = jest.fn().mockReturnValue({ eq });
    const from = jest.fn().mockReturnValue({ select });

    const roadmapsRepo = {
      findById: jest.fn().mockResolvedValue({
        id: ROADMAP_ID,
        owner_id: USER_ID,
      }),
      findFull: jest.fn().mockResolvedValue({
        id: ROADMAP_ID,
        name: 'Q2 SaaS Platform Development',
        roadmap_epics: [
          {
            id: 'dad5697a-8962-4f80-8bc3-8a964edd8e56',
            title: 'Platform Foundation',
            roadmap_features: [
              {
                id: '60bcab3f-3989-448d-9c84-3261cf38685b',
                title: 'Authentication System',
                roadmap_tasks: [
                  {
                    id: '1beecdd2-f057-4c41-bf6d-8bb9e5e4b2b1',
                    title: 'Implement login API',
                    status: 'in_progress',
                    assignee_id: USER_ID,
                  },
                  {
                    id: '1beecdd2-f057-4c41-bf6d-8bb9e5e4b2b2',
                    title: 'Close legacy auth ticket',
                    status: 'done',
                    assignee_id: USER_ID,
                  },
                  {
                    id: '1beecdd2-f057-4c41-bf6d-8bb9e5e4b2b3',
                    title: 'Other user task',
                    status: 'in_progress',
                    assignee_id: '0f7be23f-3b57-4cf4-a269-a98d2164a45a',
                  },
                ],
              },
            ],
          },
        ],
      }),
    };

    const service = new RoadmapAiService(
      { from } as never,
      roadmapsRepo as never,
      {} as never,
      { assertRoadmapPermission: jest.fn() } as never,
      {} as never,
    );

    return { service, roadmapsRepo, from };
  };

  it('returns backend-authoritative actor context', async () => {
    const { service, from } = createServiceWithMocks();
    const result = await service.getContextActor(ROADMAP_ID, USER_ID);

    expect(result.actor_id).toBe(USER_ID);
    expect(result.display_name).toBe('Alice');
    expect(result.roadmap_role).toBe('owner');
    expect(result.locale).toBeNull();
    expect(result.timezone).toBeNull();
    expect(from).toHaveBeenCalledWith('profiles');
  });

  it('returns only open tasks assigned to actor by default', async () => {
    const { service } = createServiceWithMocks();
    const result = await service.getContextTasksAssignedToMe(
      ROADMAP_ID,
      {},
      USER_ID,
    );

    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].title).toBe('Implement login API');
    expect(result.tasks[0].feature_title).toBe('Authentication System');
    expect(result.tasks[0].epic_title).toBe('Platform Foundation');
  });

  it('returns open and completed tasks when status=all', async () => {
    const { service } = createServiceWithMocks();
    const result = await service.getContextTasksAssignedToMe(
      ROADMAP_ID,
      { status: 'all' },
      USER_ID,
    );

    expect(result.tasks).toHaveLength(2);
    expect(result.tasks.map((task) => task.title)).toEqual([
      'Implement login API',
      'Close legacy auth ticket',
    ]);
  });
});

describe('RoadmapAiService context search lookup', () => {
  const ROADMAP_ID = '55e431e2-e416-468c-a973-94d97280e97d';
  const USER_ID = 'f4a8b7e5-cf32-4d03-bad8-7e385efef7cb';

  const createSearchService = (overrides?: {
    cachedCandidates?: Array<Record<string, unknown>> | null;
  }) => {
    const roadmapsRepo = {
      findById: jest.fn().mockResolvedValue({
        id: ROADMAP_ID,
        owner_id: USER_ID,
      }),
      searchContextCandidates: jest.fn().mockResolvedValue([
        {
          id: 'dad5697a-8962-4f80-8bc3-8a964edd8e56',
          type: 'epic',
          title: 'Roadmap and Project Management Module',
          description: 'Core roadmap module',
          parent_id: ROADMAP_ID,
          parent_title: 'Q2 SaaS Platform Development',
        },
      ]),
    };

    const previewStore = {
      getResolveLookup: jest
        .fn()
        .mockResolvedValue(overrides?.cachedCandidates ?? null),
      setResolveLookup: jest.fn().mockResolvedValue(undefined),
      setResolution: jest.fn().mockResolvedValue(undefined),
      deleteResolveLookupByRoadmap: jest.fn().mockResolvedValue(undefined),
    };

    const service = new RoadmapAiService(
      {} as never,
      roadmapsRepo as never,
      {} as never,
      { assertRoadmapPermission: jest.fn() } as never,
      previewStore as never,
    );

    return { service, roadmapsRepo, previewStore };
  };

  it('uses db-scoped candidate search and caches the result', async () => {
    const { service, roadmapsRepo, previewStore } = createSearchService();

    const result = await service.searchContextNodes(
      ROADMAP_ID,
      {
        query: 'Roadmap and Project Management Module',
        node_type: 'epic',
        limit: 5,
      },
      USER_ID,
    );

    expect(roadmapsRepo.searchContextCandidates).toHaveBeenCalledWith(
      ROADMAP_ID,
      'roadmap and project management module',
      expect.objectContaining({
        nodeType: 'epic',
      }),
    );
    expect(previewStore.setResolveLookup).toHaveBeenCalledTimes(1);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].type).toBe('epic');
    expect(result.resolution_id).toBeDefined();
  });

  it('reuses cached candidates when present and skips db lookup', async () => {
    const { service, roadmapsRepo, previewStore } = createSearchService({
      cachedCandidates: [
        {
          id: '60bcab3f-3989-448d-9c84-3261cf38685b',
          type: 'feature',
          title: 'Authentication System',
          parent_id: 'dad5697a-8962-4f80-8bc3-8a964edd8e56',
          parent_title: 'Platform Foundation',
        },
      ],
    });

    const result = await service.searchContextNodes(
      ROADMAP_ID,
      {
        query: 'Authentication System',
        limit: 10,
      },
      USER_ID,
    );

    expect(roadmapsRepo.searchContextCandidates).not.toHaveBeenCalled();
    expect(previewStore.setResolveLookup).not.toHaveBeenCalled();
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].type).toBe('feature');
  });

  it('falls back to db lookup when cache read fails', async () => {
    const { service, roadmapsRepo, previewStore } = createSearchService();
    previewStore.getResolveLookup.mockRejectedValueOnce(
      new Error('redis unavailable'),
    );

    await service.searchContextNodes(
      ROADMAP_ID,
      {
        query: 'Authentication System',
        limit: 10,
      },
      USER_ID,
    );

    expect(roadmapsRepo.searchContextCandidates).toHaveBeenCalledTimes(1);
  });

  it('handles punctuation-heavy free-text query without parser errors', async () => {
    const { service, roadmapsRepo } = createSearchService();
    roadmapsRepo.searchContextCandidates.mockResolvedValueOnce([
      {
        id: '60bcab3f-3989-448d-9c84-3261cf38685b',
        type: 'feature',
        title: 'OAuth Callback',
        parent_id: 'dad5697a-8962-4f80-8bc3-8a964edd8e56',
        parent_title: 'Platform Foundation',
      },
      {
        id: '60bcab3f-3989-448d-9c84-3261cf38685b',
        type: 'feature',
        title: 'OAuth Callback',
        parent_id: 'dad5697a-8962-4f80-8bc3-8a964edd8e56',
        parent_title: 'Platform Foundation',
      },
    ]);

    const result = await service.searchContextNodes(
      ROADMAP_ID,
      {
        query: `Roadmap, PM "module" -- OAuth/callback's`,
        limit: 10,
      },
      USER_ID,
    );

    expect(roadmapsRepo.searchContextCandidates).toHaveBeenCalledTimes(1);
    expect(result.matches.length).toBeGreaterThanOrEqual(1);
  });
});

describe('RoadmapAiService resolve cache invalidation on commit', () => {
  const ROADMAP_ID = '55e431e2-e416-468c-a973-94d97280e97d';
  const USER_ID = 'f4a8b7e5-cf32-4d03-bad8-7e385efef7cb';
  const PREVIEW_ID = 'd76dfba4-0f02-4988-bec3-e9af9510ff72';
  const REVISION_TOKEN = '2026-04-02T11:00:00.000Z';

  const createCommitService = () => {
    const previewStore = {
      getPreview: jest.fn().mockResolvedValue({
        roadmapId: ROADMAP_ID,
        userId: USER_ID,
        revisionToken: REVISION_TOKEN,
        candidate: {
          id: ROADMAP_ID,
          name: 'Q2 SaaS Platform Development',
          roadmap_epics: [],
        },
        semanticDiff: { summary: {}, changes: [] },
        validationIssues: [],
      }),
      deletePreview: jest.fn().mockResolvedValue(undefined),
      deleteResolveLookupByRoadmap: jest.fn().mockResolvedValue(undefined),
    };

    const roadmapsRepo = {
      findById: jest
        .fn()
        .mockResolvedValueOnce({
          id: ROADMAP_ID,
          owner_id: USER_ID,
          updated_at: REVISION_TOKEN,
        })
        .mockResolvedValueOnce({
          id: ROADMAP_ID,
          owner_id: USER_ID,
          updated_at: REVISION_TOKEN,
        }),
      findFull: jest.fn().mockResolvedValue({
        id: ROADMAP_ID,
        name: 'Q2 SaaS Platform Development',
        roadmap_epics: [],
      }),
    };

    const patchRepo = {
      upsertFullRoadmap: jest.fn().mockResolvedValue(undefined),
    };

    const service = new RoadmapAiService(
      {} as never,
      roadmapsRepo as never,
      patchRepo as never,
      { assertRoadmapPermission: jest.fn() } as never,
      previewStore as never,
    );
    return { service, previewStore, roadmapsRepo, patchRepo };
  };

  it('invalidates resolve lookup cache on successful commit', async () => {
    const { service, previewStore } = createCommitService();

    await service.commit(
      ROADMAP_ID,
      { preview_id: PREVIEW_ID, revision_token: REVISION_TOKEN },
      USER_ID,
    );

    expect(previewStore.deleteResolveLookupByRoadmap).toHaveBeenCalledWith(
      ROADMAP_ID,
    );
  });

  it('keeps commit successful when resolve cache invalidation fails', async () => {
    const { service, previewStore } = createCommitService();
    previewStore.deleteResolveLookupByRoadmap.mockRejectedValueOnce(
      new Error('redis down'),
    );

    await expect(
      service.commit(
        ROADMAP_ID,
        { preview_id: PREVIEW_ID, revision_token: REVISION_TOKEN },
        USER_ID,
      ),
    ).resolves.toMatchObject({
      revision_token: REVISION_TOKEN,
    });
  });
});
