import { RoadmapAiService } from './roadmap-ai.service';

describe('RoadmapAiService search scoring', () => {
  const createService = () =>
    new RoadmapAiService(
      {
        from: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              maybeSingle: jest
                .fn()
                .mockResolvedValue({ data: null, error: null }),
            }),
          }),
        }),
      } as never,
      {
        findById: jest.fn(),
        findFull: jest.fn(),
        findUpdatedAt: jest.fn().mockResolvedValue('2026-04-02T11:00:00.000Z'),
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
      findUpdatedAt: jest.fn().mockResolvedValue('2026-04-02T11:00:00.000Z'),
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

    const previewStore = {
      getPreview: jest.fn().mockResolvedValue(null),
    };

    const service = new RoadmapAiService(
      { from } as never,
      roadmapsRepo as never,
      {} as never,
      { assertRoadmapPermission: jest.fn() } as never,
      previewStore as never,
    );

    return { service, roadmapsRepo, from, previewStore };
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

  it('returns done tasks for filtered context query even when include_completed=false', async () => {
    const { service } = createServiceWithMocks();
    const result = await service.getContextTasksFiltered(
      ROADMAP_ID,
      {
        status: 'done',
        include_completed: 'false',
        limit: 50,
      },
      USER_ID,
    );

    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]).toMatchObject({
      title: 'Close legacy auth ticket',
      status: 'done',
      assignee_id: USER_ID,
      feature_title: 'Authentication System',
      epic_title: 'Platform Foundation',
    });
  });

  it('uses preview snapshot context for summary and assigned tasks when preview_id is provided', async () => {
    const { service, roadmapsRepo, previewStore } = createServiceWithMocks();
    const previewId = '123e4567-e89b-12d3-a456-426614174000';
    previewStore.getPreview.mockResolvedValue({
      roadmapId: ROADMAP_ID,
      userId: USER_ID,
      candidate: {
        id: ROADMAP_ID,
        name: 'Draft Snapshot',
        description: 'Preview candidate',
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
                    status: 'done',
                    assignee_id: USER_ID,
                  },
                  {
                    id: '1beecdd2-f057-4c41-bf6d-8bb9e5e4b2b4',
                    title: 'Harden auth middleware',
                    status: 'in_progress',
                    assignee_id: USER_ID,
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    const summary = await service.getContextSummary(
      ROADMAP_ID,
      { preview_id: previewId },
      USER_ID,
    );
    const tasks = await service.getContextTasksAssignedToMe(
      ROADMAP_ID,
      { status: 'open', preview_id: previewId },
      USER_ID,
    );

    expect(summary.title).toBe('Draft Snapshot');
    expect(tasks.tasks).toHaveLength(1);
    expect(tasks.tasks[0].title).toBe('Harden auth middleware');
    expect(roadmapsRepo.findFull).not.toHaveBeenCalled();
  });
});

describe('RoadmapAiService context timing logs', () => {
  const ROADMAP_ID = '55e431e2-e416-468c-a973-94d97280e97d';
  const USER_ID = 'f4a8b7e5-cf32-4d03-bad8-7e385efef7cb';
  const EPIC_ID = 'dad5697a-8962-4f80-8bc3-8a964edd8e56';
  const FEATURE_ID = '60bcab3f-3989-448d-9c84-3261cf38685b';
  const TASK_ID = '1beecdd2-f057-4c41-bf6d-8bb9e5e4b2b1';

  const createService = () => {
    const maybeSingle = jest
      .fn()
      .mockResolvedValue({ data: { display_name: 'Alice' }, error: null });
    const eq = jest.fn().mockReturnValue({ maybeSingle });
    const select = jest.fn().mockReturnValue({ eq });
    const from = jest.fn().mockReturnValue({ select });

    const fullRoadmap = {
      id: ROADMAP_ID,
      name: 'Q2 SaaS Platform Development',
      roadmap_epics: [
        {
          id: EPIC_ID,
          title: 'Platform Foundation',
          roadmap_features: [
            {
              id: FEATURE_ID,
              title: 'Authentication System',
              roadmap_tasks: [
                {
                  id: TASK_ID,
                  title: 'Implement login API',
                  status: 'in_progress',
                  assignee_id: USER_ID,
                },
              ],
            },
          ],
        },
      ],
    };

    const service = new RoadmapAiService(
      { from } as never,
      {
        findById: jest.fn().mockResolvedValue({
          id: ROADMAP_ID,
          owner_id: USER_ID,
        }),
        findUpdatedAt: jest.fn().mockResolvedValue('2026-04-02T11:00:00.000Z'),
        findFull: jest.fn().mockResolvedValue(fullRoadmap),
        searchContextCandidates: jest.fn(),
      } as never,
      {} as never,
      {
        assertRoadmapPermission: jest.fn().mockResolvedValue(undefined),
      } as never,
      {
        getResolution: jest.fn().mockResolvedValue({
          roadmapId: ROADMAP_ID,
          userId: USER_ID,
          matches: [
            {
              id: EPIC_ID,
              type: 'epic',
              title: 'Platform Foundation',
              parent_id: ROADMAP_ID,
            },
          ],
        }),
      } as never,
    );

    return service;
  };

  it('emits timing logs for all non-search context handlers', async () => {
    const service = createService();
    const timingSpy = jest.spyOn(service as any, 'logRoadmapAiHandlerTiming');
    const traceId = 'trace-context-timing';

    await service.getContextSummary(ROADMAP_ID, {}, USER_ID, traceId);
    await service.getContextActor(ROADMAP_ID, USER_ID, traceId);
    await service.getContextNodeDetails(ROADMAP_ID, EPIC_ID, USER_ID, traceId);
    await service.getContextNodeChildren(
      ROADMAP_ID,
      EPIC_ID,
      { limit: 10 } as any,
      USER_ID,
      traceId,
    );
    await service.getContextChildrenFromResolution(
      ROADMAP_ID,
      'dc86d208-1ea6-42d4-874d-d6f3c68c0228',
      { choice: 1, limit: 10 } as any,
      USER_ID,
      traceId,
    );
    await service.getContextFeatures(
      ROADMAP_ID,
      { epic_id: EPIC_ID, limit: 10 } as any,
      USER_ID,
      traceId,
    );
    await service.getContextTasksAssignedToMe(
      ROADMAP_ID,
      { status: 'open', limit: 10 } as any,
      USER_ID,
      traceId,
    );
    await service.getContextTasksFiltered(
      ROADMAP_ID,
      { status: 'done', include_completed: 'false', limit: 10 } as any,
      USER_ID,
      traceId,
    );

    const events = timingSpy.mock.calls.map((call) => (call[0] as any)?.event);
    expect(events).toContain('roadmap_ai_context_summary_timing');
    expect(events).toContain('roadmap_ai_context_actor_timing');
    expect(events).toContain('roadmap_ai_context_node_details_timing');
    expect(events).toContain('roadmap_ai_context_node_children_timing');
    expect(events).toContain('roadmap_ai_context_resolution_children_timing');
    expect(events).toContain('roadmap_ai_context_features_timing');
    expect(events).toContain('roadmap_ai_context_tasks_assigned_timing');
    expect(events).toContain('roadmap_ai_context_tasks_filtered_timing');
  });

  it('includes status in context node children responses', async () => {
    const service = createService();

    const epicChildren = await service.getContextNodeChildren(
      ROADMAP_ID,
      EPIC_ID,
      { limit: 10 } as any,
      USER_ID,
    );
    expect(epicChildren.children).toHaveLength(1);
    expect(epicChildren.children[0]).toMatchObject({
      id: FEATURE_ID,
      type: 'feature',
      status: 'not_started',
      parent_id: EPIC_ID,
    });

    const featureChildren = await service.getContextNodeChildren(
      ROADMAP_ID,
      FEATURE_ID,
      { limit: 10 } as any,
      USER_ID,
    );
    expect(featureChildren.children).toHaveLength(1);
    expect(featureChildren.children[0]).toMatchObject({
      id: TASK_ID,
      type: 'task',
      status: 'in_progress',
      parent_id: FEATURE_ID,
    });
  });

  it('includes status in context features responses', async () => {
    const service = createService();
    const result = await service.getContextFeatures(
      ROADMAP_ID,
      { epic_id: EPIC_ID, limit: 10 } as any,
      USER_ID,
    );

    expect(result.children).toHaveLength(1);
    expect(result.children[0]).toMatchObject({
      id: FEATURE_ID,
      type: 'feature',
      status: 'not_started',
      parent_id: EPIC_ID,
    });
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
      findUpdatedAt: jest.fn().mockResolvedValue('2026-04-02T11:00:00.000Z'),
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
    expect(result.resolution_id).toBeUndefined();
    expect(previewStore.setResolution).not.toHaveBeenCalled();
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
    expect(result.resolution_id).toBeUndefined();
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

    expect(roadmapsRepo.searchContextCandidates).toHaveBeenCalledTimes(3);
  });

  it('stops at epic stage when a strong unique epic match is found', async () => {
    const { service, roadmapsRepo } = createSearchService();
    roadmapsRepo.searchContextCandidates.mockResolvedValueOnce([
      {
        id: 'dad5697a-8962-4f80-8bc3-8a964edd8e56',
        type: 'epic',
        title: 'Platform Foundation',
        parent_id: ROADMAP_ID,
      },
    ]);

    const result = await service.searchContextNodes(
      ROADMAP_ID,
      {
        query: 'Platform Foundation',
        limit: 10,
      },
      USER_ID,
    );

    expect(roadmapsRepo.searchContextCandidates).toHaveBeenCalledTimes(1);
    expect(roadmapsRepo.searchContextCandidates).toHaveBeenCalledWith(
      ROADMAP_ID,
      'platform foundation',
      expect.objectContaining({ nodeType: 'epic' }),
    );
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].type).toBe('epic');
    expect(result.resolution_id).toBeUndefined();
  });

  it('does not early-stop on weak single epic hit and continues stages', async () => {
    const { service, roadmapsRepo } = createSearchService();
    roadmapsRepo.searchContextCandidates
      .mockResolvedValueOnce([
        {
          id: 'dad5697a-8962-4f80-8bc3-8a964edd8e56',
          type: 'epic',
          title: 'Unrelated Epic',
          parent_id: ROADMAP_ID,
          parent_title: 'Platform Foundation',
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: '1beecdd2-f057-4c41-bf6d-8bb9e5e4b2b1',
          type: 'task',
          title: 'Platform Foundation',
          parent_id: '60bcab3f-3989-448d-9c84-3261cf38685b',
          parent_title: 'Authentication System',
        },
      ]);

    const result = await service.searchContextNodes(
      ROADMAP_ID,
      {
        query: 'Platform Foundation',
        limit: 10,
      },
      USER_ID,
    );

    expect(roadmapsRepo.searchContextCandidates).toHaveBeenCalledTimes(3);
    expect(
      roadmapsRepo.searchContextCandidates.mock.calls.map(
        (call) => call[2]?.nodeType,
      ),
    ).toEqual(['epic', 'feature', 'task']);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].type).toBe('task');
    expect(result.resolution_id).toBeUndefined();
  });

  it('continues to feature/task stages when earlier stages miss', async () => {
    const { service, roadmapsRepo, previewStore } = createSearchService();
    roadmapsRepo.searchContextCandidates
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: '60bcab3f-3989-448d-9c84-3261cf38685b',
          type: 'feature',
          title: 'Authentication System',
          parent_id: 'dad5697a-8962-4f80-8bc3-8a964edd8e56',
          parent_title: 'Platform Foundation',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: '1beecdd2-f057-4c41-bf6d-8bb9e5e4b2b1',
          type: 'task',
          title: 'Implement login API',
          parent_id: '60bcab3f-3989-448d-9c84-3261cf38685b',
          parent_title: 'Authentication System',
        },
      ]);

    const result = await service.searchContextNodes(
      ROADMAP_ID,
      {
        query: 'Authentication',
        limit: 10,
      },
      USER_ID,
    );

    expect(roadmapsRepo.searchContextCandidates).toHaveBeenCalledTimes(2);
    expect(
      roadmapsRepo.searchContextCandidates.mock.calls.map(
        (call) => call[2]?.nodeType,
      ),
    ).toEqual(['epic', 'feature']);
    expect(result.matches).toHaveLength(1);
    expect(result.resolution_id).toBeUndefined();
    expect(previewStore.setResolution).not.toHaveBeenCalled();
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

    expect(roadmapsRepo.searchContextCandidates).toHaveBeenCalledTimes(3);
    expect(result.matches.length).toBeGreaterThanOrEqual(1);
  });
});

describe('RoadmapAiService resolve cache invalidation on commit', () => {
  const ROADMAP_ID = '55e431e2-e416-468c-a973-94d97280e97d';
  const USER_ID = 'f4a8b7e5-cf32-4d03-bad8-7e385efef7cb';
  const REVISION_TOKEN = '2026-04-02T11:00:00.000Z';

  const createCommitService = () => {
    const previewStore = {
      getChangeTimeline: jest.fn().mockResolvedValue(null),
      setChangeTimeline: jest.fn().mockResolvedValue(undefined),
      deleteResolveLookupByRoadmapAndNodeTypes: jest
        .fn()
        .mockResolvedValue(undefined),
      deleteResolveLookupByRoadmap: jest.fn().mockResolvedValue(undefined),
    };

    const roadmapsRepo = {
      findById: jest.fn().mockResolvedValue({
        id: ROADMAP_ID,
        owner_id: USER_ID,
        updated_at: REVISION_TOKEN,
      }),
      findUpdatedAt: jest.fn().mockResolvedValue(REVISION_TOKEN),
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

  it('invalidates resolve lookup cache and appends timeline on successful commit', async () => {
    const { service, previewStore } = createCommitService();

    const result = await service.commit(
      ROADMAP_ID,
      {
        revision_token: REVISION_TOKEN,
        operations: [
          { op: 'add_epic', data: { title: 'Platform Foundation' } },
        ],
      } as any,
      USER_ID,
    );

    expect(
      previewStore.deleteResolveLookupByRoadmapAndNodeTypes,
    ).toHaveBeenCalledWith(ROADMAP_ID, ['epic']);
    expect(previewStore.deleteResolveLookupByRoadmap).not.toHaveBeenCalled();
    expect(previewStore.setChangeTimeline).toHaveBeenCalledTimes(1);
    expect(result.change_id).toEqual(expect.any(String));
    expect(result.timeline).toHaveLength(1);
  });

  it('supports lean commit responses without roadmap reload payload', async () => {
    const { service, roadmapsRepo } = createCommitService();

    const result = await service.commit(
      ROADMAP_ID,
      {
        revision_token: REVISION_TOKEN,
        include_roadmap: false,
        include_timeline: false,
        operations: [
          { op: 'add_epic', data: { title: 'Platform Foundation' } },
        ],
      } as any,
      USER_ID,
    );

    expect(roadmapsRepo.findFull).toHaveBeenCalledTimes(1);
    expect(roadmapsRepo.findFull).toHaveBeenCalledWith(ROADMAP_ID, USER_ID, {
      includeTaskAssigneeProfile: false,
    });
    expect(result.roadmap).toBeUndefined();
    expect(result.timeline).toEqual([]);
    expect(result.candidate_snapshot).toMatchObject({ id: ROADMAP_ID });
  });

  it('keeps commit successful when timeline persistence fails', async () => {
    const { service, previewStore } = createCommitService();
    previewStore.setChangeTimeline.mockRejectedValueOnce(
      new Error('redis down'),
    );

    await expect(
      service.commit(
        ROADMAP_ID,
        {
          revision_token: REVISION_TOKEN,
          operations: [
            { op: 'add_epic', data: { title: 'Platform Foundation' } },
          ],
        } as any,
        USER_ID,
      ),
    ).resolves.toMatchObject({
      revision_token: REVISION_TOKEN,
      timeline: [],
    });
  });

  it('falls back to roadmap-wide invalidation when typed invalidation api is unavailable', async () => {
    const { service, previewStore } = createCommitService();
    delete (previewStore as any).deleteResolveLookupByRoadmapAndNodeTypes;

    await service.commit(
      ROADMAP_ID,
      {
        revision_token: REVISION_TOKEN,
        operations: [
          { op: 'add_epic', data: { title: 'Platform Foundation' } },
        ],
      } as any,
      USER_ID,
    );

    expect(previewStore.deleteResolveLookupByRoadmap).toHaveBeenCalledWith(
      ROADMAP_ID,
    );
  });

  it('falls back to roadmap-wide invalidation when no node types are provided', async () => {
    const { service, previewStore } = createCommitService();

    await (service as any).invalidateResolveLookupCache(ROADMAP_ID, new Set());

    expect(previewStore.deleteResolveLookupByRoadmap).toHaveBeenCalledWith(
      ROADMAP_ID,
    );
    expect(
      previewStore.deleteResolveLookupByRoadmapAndNodeTypes,
    ).not.toHaveBeenCalled();
  });
});

describe('RoadmapAiService preview durability', () => {
  const ROADMAP_ID = '55e431e2-e416-468c-a973-94d97280e97d';
  const USER_ID = 'f4a8b7e5-cf32-4d03-bad8-7e385efef7cb';

  it('allows immediate getPreview after preview returns', async () => {
    const previews = new Map<string, Record<string, unknown>>();
    const roadmapsRepo = {
      findById: jest.fn().mockResolvedValue({
        id: ROADMAP_ID,
        owner_id: USER_ID,
        updated_at: '2026-04-02T16:00:00.000Z',
      }),
      findUpdatedAt: jest.fn().mockResolvedValue('2026-04-02T16:00:00.000Z'),
      findFull: jest.fn().mockResolvedValue({
        id: ROADMAP_ID,
        name: 'Q2 SaaS Platform Development',
        roadmap_epics: [],
      }),
    };
    const previewStore = {
      setPreview: jest
        .fn()
        .mockImplementation(
          async (previewId: string, payload: Record<string, unknown>) => {
            previews.set(previewId, payload);
          },
        ),
      getPreview: jest
        .fn()
        .mockImplementation(
          async (previewId: string) => previews.get(previewId) ?? null,
        ),
      setResolveLookup: jest.fn().mockResolvedValue(undefined),
      getResolveLookup: jest.fn().mockResolvedValue(null),
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

    const preview = await service.preview(
      ROADMAP_ID,
      { operations: [] } as any,
      USER_ID,
    );
    const fetched = await service.getPreview(
      ROADMAP_ID,
      preview.preview_id,
      USER_ID,
    );

    expect(previewStore.setPreview).toHaveBeenCalledTimes(1);
    expect(fetched.preview_id).toBe(preview.preview_id);
  });
});

describe('RoadmapAiService authz cache hardening', () => {
  const createService = () =>
    new RoadmapAiService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    ) as unknown as {
      authzDecisionCache: Map<
        string,
        { expiresAtMs: number; roadmap: Record<string, unknown> }
      >;
      buildAuthzDecisionCacheKey: (roadmapId: string, userId: string) => string;
      writeAuthzDecisionCache: (
        cacheKey: string,
        roadmap: Record<string, unknown>,
      ) => void;
      readAuthzDecisionCache: (
        cacheKey: string,
      ) => Record<string, unknown> | null;
    };

  it('evicts old entries when max size is exceeded', () => {
    const service = createService();
    // Fill past the default max size and verify bounded cache behavior.
    for (let index = 0; index < 5005; index += 1) {
      const key = service.buildAuthzDecisionCacheKey(
        `roadmap-${index}`,
        `user-${index}`,
      );
      service.writeAuthzDecisionCache(key, { id: `roadmap-${index}` });
    }

    expect(service.authzDecisionCache.size).toBeLessThanOrEqual(5000);
  });

  it('removes expired entries on read', () => {
    const service = createService();
    const key = service.buildAuthzDecisionCacheKey('roadmap-1', 'user-1');
    service.authzDecisionCache.set(key, {
      roadmap: { id: 'roadmap-1' },
      expiresAtMs: Date.now() - 1,
    });

    const hit = service.readAuthzDecisionCache(key);

    expect(hit).toBeNull();
    expect(service.authzDecisionCache.has(key)).toBe(false);
  });

  it('includes configured authz cache version in cache key', () => {
    const originalVersion = process.env.ROADMAP_AI_AUTHZ_CACHE_VERSION;
    process.env.ROADMAP_AI_AUTHZ_CACHE_VERSION = 'v-test';
    jest.resetModules();

    let key = '';
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const {
        RoadmapAiService: ReloadedRoadmapAiService,
      } = require('./roadmap-ai.service');
      const service = new ReloadedRoadmapAiService(
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      );
      key = (service as any).buildAuthzDecisionCacheKey('roadmap-x', 'user-x');
    });

    process.env.ROADMAP_AI_AUTHZ_CACHE_VERSION = originalVersion;
    jest.resetModules();
    expect(key.startsWith('v-test:')).toBe(true);
  });
});

describe('RoadmapAiService operation semantics parity', () => {
  const createService = () =>
    new RoadmapAiService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

  it('validates task status enums consistently', () => {
    const service = createService() as unknown as {
      validateNodeStatus: (nodeType: string, status: string) => boolean;
    };

    expect(service.validateNodeStatus('task', 'todo')).toBe(true);
    expect(service.validateNodeStatus('task', 'done')).toBe(true);
    expect(service.validateNodeStatus('task', 'blocked')).toBe(true);
    expect(service.validateNodeStatus('task', 'invalid_status')).toBe(false);
  });

  it('shifts valid dates and preserves invalid date strings', () => {
    const service = createService() as unknown as {
      shiftDate: (
        dateInput: string | undefined,
        deltaDays: number,
      ) => string | undefined;
    };

    expect(service.shiftDate('2026-04-08', 2)).toBe('2026-04-10');
    expect(service.shiftDate('2026-04-08', -3)).toBe('2026-04-05');
    expect(service.shiftDate('not-a-date', 5)).toBe('not-a-date');
    expect(service.shiftDate(undefined, 5)).toBeUndefined();
  });

  it('applies mark_status for valid statuses and rejects invalid status enums', () => {
    const service = createService() as unknown as {
      applyOperations: (
        state: Record<string, unknown>,
        operations: any[],
      ) => {
        issues: any[];
      };
    };

    const state = {
      id: '55e431e2-e416-468c-a973-94d97280e97d',
      name: 'Roadmap',
      status: 'active',
      roadmap_epics: [
        {
          id: 'dad5697a-8962-4f80-8bc3-8a964edd8e56',
          title: 'Epic',
          status: 'in_progress',
          roadmap_features: [
            {
              id: '60bcab3f-3989-448d-9c84-3261cf38685b',
              title: 'Feature',
              status: 'in_progress',
              roadmap_tasks: [
                {
                  id: '1beecdd2-f057-4c41-bf6d-8bb9e5e4b2b1',
                  title: 'Task',
                  status: 'todo',
                },
              ],
            },
          ],
        },
      ],
    };

    const invalidResult = service.applyOperations(state as any, [
      {
        op: 'mark_status',
        node_id: '1beecdd2-f057-4c41-bf6d-8bb9e5e4b2b1',
        status: 'not_real',
      },
    ]);
    const invalidIssues = invalidResult.issues;
    expect(invalidIssues.length).toBeGreaterThan(0);
    expect(invalidIssues[0].code).toBe('INVALID_ENUM');

    const validResult = service.applyOperations(state as any, [
      {
        op: 'mark_status',
        node_id: '1beecdd2-f057-4c41-bf6d-8bb9e5e4b2b1',
        status: 'done',
      },
    ]);
    const validIssues = validResult.issues;
    expect(validIssues).toEqual([]);
    expect(
      (
        state.roadmap_epics[0].roadmap_features[0].roadmap_tasks[0] as {
          status: string;
        }
      ).status,
    ).toBe('done');
  });

  it('supports chained add operations via temp references', () => {
    const service = createService() as unknown as {
      applyOperations: (
        state: Record<string, unknown>,
        operations: any[],
      ) => {
        issues: Array<{ code: string }>;
        operationResults: Array<{
          operation_index: number;
          temp_id: string;
          assigned_id: string;
          node_type: 'epic' | 'feature' | 'task';
        }>;
      };
    };

    const state: any = {
      id: '55e431e2-e416-468c-a973-94d97280e97d',
      name: 'Roadmap',
      status: 'active',
      roadmap_epics: [],
    };

    const result = service.applyOperations(state as any, [
      {
        op: 'add_epic',
        temp_id: 'epic_agile',
        data: { title: 'Agile' },
      },
      {
        op: 'add_feature',
        parent_ref: 'epic_agile',
        temp_id: 'feature_jira',
        data: { title: 'Jira' },
      },
      {
        op: 'add_task',
        parent_ref: 'feature_jira',
        temp_id: 'task_workflow',
        data: { title: 'Set up sprint workflow' },
      },
    ]);

    expect(result.issues).toHaveLength(0);
    expect(state.roadmap_epics).toHaveLength(1);
    expect(state.roadmap_epics[0].title).toBe('Agile');
    expect(state.roadmap_epics[0].roadmap_features).toHaveLength(1);
    expect(state.roadmap_epics[0].roadmap_features[0].title).toBe('Jira');
    expect(
      state.roadmap_epics[0].roadmap_features[0].roadmap_tasks,
    ).toHaveLength(1);

    expect(result.operationResults).toHaveLength(3);
    expect(result.operationResults[0].temp_id).toBe('epic_agile');
    expect(result.operationResults[1].temp_id).toBe('feature_jira');
    expect(result.operationResults[2].temp_id).toBe('task_workflow');
  });

  it('rejects unresolved parent_ref in add_feature', () => {
    const service = createService() as unknown as {
      applyOperations: (
        state: Record<string, unknown>,
        operations: any[],
      ) => {
        issues: Array<{ code: string }>;
      };
    };

    const state: any = {
      id: '55e431e2-e416-468c-a973-94d97280e97d',
      name: 'Roadmap',
      status: 'active',
      roadmap_epics: [],
    };

    const result = service.applyOperations(state as any, [
      {
        op: 'add_feature',
        parent_ref: 'missing_epic',
        data: { title: 'Jira' },
      },
    ]);

    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues[0].code).toBe('BROKEN_RELATIONSHIP');
    expect(state.roadmap_epics).toHaveLength(0);
  });
});
