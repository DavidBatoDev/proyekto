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
      { publishRoadmapChange: jest.fn(), publishChatEvent: jest.fn() } as never,
      { log: jest.fn() } as never,
      { notifyNewlyAssigned: jest.fn().mockResolvedValue(undefined) } as never,
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
      { publishRoadmapChange: jest.fn(), publishChatEvent: jest.fn() } as never,
      { log: jest.fn() } as never,
      { notifyNewlyAssigned: jest.fn().mockResolvedValue(undefined) } as never,
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
      { publishRoadmapChange: jest.fn(), publishChatEvent: jest.fn() } as never,
      { log: jest.fn() } as never,
      { notifyNewlyAssigned: jest.fn().mockResolvedValue(undefined) } as never,
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
      status: 'in_progress',
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
      status: 'in_progress',
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
      { publishRoadmapChange: jest.fn(), publishChatEvent: jest.fn() } as never,
      { log: jest.fn() } as never,
      { notifyNewlyAssigned: jest.fn().mockResolvedValue(undefined) } as never,
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
      { publishRoadmapChange: jest.fn(), publishChatEvent: jest.fn() } as never,
      { log: jest.fn() } as never,
      { notifyNewlyAssigned: jest.fn().mockResolvedValue(undefined) } as never,
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

describe('RoadmapAiService commit attribution', () => {
  const ROADMAP_ID = '55e431e2-e416-468c-a973-94d97280e97d';
  const PROJECT_ID = '0c3d0b8e-6f1e-4b0f-9b1e-2b7f0a3c9d11';
  const USER_ID = 'f4a8b7e5-cf32-4d03-bad8-7e385efef7cb';
  const SESSION_ID = '8e1b2f5c-3d4a-4e6f-9a7b-1c2d3e4f5a6b';
  const RUN_ID = '3f2a1b0c-9d8e-4f7a-b6c5-d4e3f2a1b0c9';
  const REVISION_TOKEN = '2026-04-02T11:00:00.000Z';
  const IDEMPOTENCY_KEY = 'run-batch-1';

  type DbOptions = {
    session?: { id: string; scope?: string } | null;
    insertError?: string;
    insertHangs?: boolean;
  };

  const createDb = (options: DbOptions) => {
    const insert = jest.fn().mockImplementation(() =>
      options.insertHangs
        ? new Promise<never>(() => undefined)
        : Promise.resolve({
            error: options.insertError
              ? { message: options.insertError }
              : null,
          }),
    );
    const maybeSingle = jest
      .fn()
      .mockResolvedValue({ data: options.session ?? null, error: null });
    const eqUser = jest.fn().mockReturnValue({ maybeSingle });
    const eqId = jest.fn().mockReturnValue({ eq: eqUser });
    const select = jest.fn().mockReturnValue({ eq: eqId });
    const from = jest.fn((table: string) =>
      table === 'roadmap_ai_sessions' ? { select } : { insert },
    );
    return { from, insert, select, eqId, eqUser, maybeSingle };
  };

  const createService = (dbOptions: DbOptions = {}) => {
    const db = createDb(dbOptions);
    const previewStore = {
      getChangeTimeline: jest.fn().mockResolvedValue(null),
      setChangeTimeline: jest.fn().mockResolvedValue(undefined),
      deleteResolveLookupByRoadmapAndNodeTypes: jest
        .fn()
        .mockResolvedValue(undefined),
      deleteResolveLookupByRoadmap: jest.fn().mockResolvedValue(undefined),
      readCommitIdempotency: jest.fn().mockResolvedValue(null),
      writeCommitIdempotency: jest.fn().mockResolvedValue(undefined),
    };
    const roadmapsRepo = {
      findById: jest.fn().mockResolvedValue({
        id: ROADMAP_ID,
        owner_id: USER_ID,
        project_id: PROJECT_ID,
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
    const audit = { log: jest.fn() };

    const service = new RoadmapAiService(
      db as never,
      roadmapsRepo as never,
      patchRepo as never,
      { assertRoadmapPermission: jest.fn() } as never,
      previewStore as never,
      { publishRoadmapChange: jest.fn(), publishChatEvent: jest.fn() } as never,
      audit as never,
      { notifyNewlyAssigned: jest.fn().mockResolvedValue(undefined) } as never,
    );
    const warn = jest
      .spyOn((service as any).logger, 'warn')
      .mockImplementation(() => undefined);
    return { service, db, previewStore, audit, warn };
  };

  const commit = (service: RoadmapAiService, dto: Record<string, unknown>) =>
    service.commit(
      ROADMAP_ID,
      {
        revision_token: REVISION_TOKEN,
        operations: [
          { op: 'add_epic', data: { title: 'Platform Foundation' } },
        ],
        ...dto,
      } as any,
      USER_ID,
    );

  it('stamps session_id and run_id on the history row and the audit entry', async () => {
    const { service, db, audit } = createService({
      session: { id: SESSION_ID, scope: 'workspace' },
    });

    const result = await commit(service, {
      session_id: SESSION_ID,
      run_id: RUN_ID,
      idempotency_key: IDEMPOTENCY_KEY,
    });

    expect(db.from).toHaveBeenCalledWith('roadmap_ai_sessions');
    expect(db.eqId).toHaveBeenCalledWith('id', SESSION_ID);
    expect(db.eqUser).toHaveBeenCalledWith('user_id', USER_ID);
    expect(db.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        change_id: result.change_id,
        session_id: SESSION_ID,
        run_id: RUN_ID,
      }),
    );
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'roadmap.committed',
        metadata: expect.objectContaining({
          change_id: result.change_id,
          ai_session_id: SESSION_ID,
          ai_run_id: RUN_ID,
          ai_scope: 'workspace',
        }),
      }),
    );
    expect(result.history_recorded).toBe(true);
  });

  it('stores a trimmed 24h replay record after the history write when a run is attached', async () => {
    const { service, db, previewStore } = createService({
      session: { id: SESSION_ID, scope: 'roadmap' },
    });

    const result = await commit(service, {
      session_id: SESSION_ID,
      run_id: RUN_ID,
      idempotency_key: IDEMPOTENCY_KEY,
    });

    expect(previewStore.writeCommitIdempotency).toHaveBeenCalledTimes(1);
    const [roadmapId, userId, key, hash, record, ttl] =
      previewStore.writeCommitIdempotency.mock.calls[0];
    expect([roadmapId, userId, key]).toEqual([
      ROADMAP_ID,
      USER_ID,
      IDEMPOTENCY_KEY,
    ]);
    expect(hash).toEqual(expect.any(String));
    expect(ttl).toBe(86_400);
    expect(record).toEqual({
      change_id: result.change_id,
      committed_at: result.committed_at,
      revision_token: REVISION_TOKEN,
      semantic_diff: result.semantic_diff,
      operation_results: result.operation_results,
      temp_id_mapping: expect.any(Object),
      timeline: result.timeline,
      history_recorded: true,
    });
    expect(record).not.toHaveProperty('candidate_snapshot');
    expect(record).not.toHaveProperty('roadmap');
    expect(db.insert.mock.invocationCallOrder[0]).toBeLessThan(
      previewStore.writeCommitIdempotency.mock.invocationCallOrder[0],
    );
  });

  it('keeps the commit successful and reports history_recorded=false when the history insert fails', async () => {
    const { service, previewStore, audit, warn } = createService({
      session: { id: SESSION_ID, scope: 'roadmap' },
      insertError: 'insert failed',
    });

    const result = await commit(service, {
      session_id: SESSION_ID,
      run_id: RUN_ID,
      idempotency_key: IDEMPOTENCY_KEY,
    });

    expect(result.change_id).toEqual(expect.any(String));
    expect(result.revision_token).toBe(REVISION_TOKEN);
    expect(result.history_recorded).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('event=roadmap_change_history_write_failed'),
    );
    expect(previewStore.writeCommitIdempotency.mock.calls[0][4]).toMatchObject({
      history_recorded: false,
    });
    expect(audit.log).toHaveBeenCalledTimes(1);
  });

  it('does not wait for the history write and omits history_recorded without run_id', async () => {
    const { service, db, previewStore } = createService({
      session: { id: SESSION_ID, scope: 'roadmap' },
      insertHangs: true,
    });

    const result = await commit(service, {
      session_id: SESSION_ID,
      idempotency_key: IDEMPOTENCY_KEY,
    });

    expect(result).not.toHaveProperty('history_recorded');
    expect(db.insert).toHaveBeenCalledWith(
      expect.objectContaining({ session_id: SESSION_ID }),
    );
    expect(db.insert.mock.calls[0][0]).not.toHaveProperty('run_id');
    expect(previewStore.writeCommitIdempotency).toHaveBeenCalledTimes(1);
    const call = previewStore.writeCommitIdempotency.mock.calls[0];
    expect(call).toHaveLength(5);
    expect(call[4]).toMatchObject({
      change_id: result.change_id,
      candidate_snapshot: expect.objectContaining({ id: ROADMAP_ID }),
    });
    expect(call[4]).not.toHaveProperty('history_recorded');
  });

  it('drops a session the caller does not own with a warning and still commits', async () => {
    const { service, db, audit, warn } = createService({ session: null });

    const result = await commit(service, {
      session_id: SESSION_ID,
      run_id: RUN_ID,
    });

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('event=roadmap_ai_commit_session_mismatch'),
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(`session_id=${SESSION_ID}`),
    );
    expect(db.insert.mock.calls[0][0]).not.toHaveProperty('session_id');
    expect(db.insert).toHaveBeenCalledWith(
      expect.objectContaining({ run_id: RUN_ID }),
    );
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          ai_session_id: null,
          ai_run_id: RUN_ID,
          ai_scope: null,
        }),
      }),
    );
    expect(result.history_recorded).toBe(true);
  });

  it('skips the session lookup entirely when no session_id is supplied', async () => {
    const { service, db, audit } = createService();

    await commit(service, {});

    expect(db.from).not.toHaveBeenCalledWith('roadmap_ai_sessions');
    expect(db.insert.mock.calls[0][0]).not.toHaveProperty('session_id');
    expect(db.insert.mock.calls[0][0]).not.toHaveProperty('run_id');
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          ai_session_id: null,
          ai_run_id: null,
          ai_scope: null,
        }),
      }),
    );
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
      { publishRoadmapChange: jest.fn(), publishChatEvent: jest.fn() } as never,
      { log: jest.fn() } as never,
      { notifyNewlyAssigned: jest.fn().mockResolvedValue(undefined) } as never,
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
      { publishRoadmapChange: jest.fn(), publishChatEvent: jest.fn() } as never,
      { log: jest.fn() } as never,
      { notifyNewlyAssigned: jest.fn().mockResolvedValue(undefined) } as never,
    ) as unknown as {
      authzDecisionCache: Map<string, { expiresAtMs: number; allowed: true }>;
      buildAuthzDecisionCacheKey: (roadmapId: string, userId: string) => string;
      writeAuthzDecisionCache: (cacheKey: string) => void;
      readAuthzDecisionCache: (cacheKey: string) => boolean;
    };

  it('evicts old entries when max size is exceeded', () => {
    const service = createService();
    // Fill past the default max size and verify bounded cache behavior.
    for (let index = 0; index < 5005; index += 1) {
      const key = service.buildAuthzDecisionCacheKey(
        `roadmap-${index}`,
        `user-${index}`,
      );
      service.writeAuthzDecisionCache(key);
    }

    expect(service.authzDecisionCache.size).toBeLessThanOrEqual(5000);
  });

  it('removes expired entries on read', () => {
    const service = createService();
    const key = service.buildAuthzDecisionCacheKey('roadmap-1', 'user-1');
    service.authzDecisionCache.set(key, {
      allowed: true,
      expiresAtMs: Date.now() - 1,
    });

    const hit = service.readAuthzDecisionCache(key);

    expect(hit).toBe(false);
    expect(service.authzDecisionCache.has(key)).toBe(false);
  });

  // The cache stores a verdict, never the roadmap row. Callers derive
  // `revision_token` from `updated_at`, so a cached row would hand out tokens
  // for a superseded revision and `commit` would 409 STALE_REVISION against a
  // roadmap the caller had in fact read at its latest state.
  it('caches only the verdict, so no roadmap row can be served stale', () => {
    const service = createService();
    const key = service.buildAuthzDecisionCacheKey('roadmap-1', 'user-1');

    service.writeAuthzDecisionCache(key);

    expect(service.readAuthzDecisionCache(key)).toBe(true);
    expect(
      Object.keys(service.authzDecisionCache.get(key) ?? {}).sort(),
    ).toEqual(['allowed', 'expiresAtMs']);
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
      { publishRoadmapChange: jest.fn(), publishChatEvent: jest.fn() } as never,
      { log: jest.fn() } as never,
      { notifyNewlyAssigned: jest.fn().mockResolvedValue(undefined) } as never,
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

  it('keeps the node index consistent when a bulk update is followed by a delete', () => {
    const service = createService() as unknown as {
      applyOperations: (
        state: Record<string, unknown>,
        operations: any[],
      ) => { issues: Array<{ code: string }> };
    };

    const taskA = '44444444-4444-4444-4444-444444444444';
    const taskB = '55555555-5555-5555-5555-555555555555';
    const state: any = {
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
                { id: taskA, title: 'A', status: 'todo' },
                { id: taskB, title: 'B', status: 'todo' },
              ],
            },
          ],
        },
      ],
    };

    const result = service.applyOperations(state as any, [
      {
        op: 'update_node',
        targets: [taskA, taskB],
        patch: { priority: 'high' },
      },
      { op: 'delete_node', node_id: taskA },
      { op: 'mark_status', node_id: taskB, status: 'done' },
    ]);

    expect(result.issues).toEqual([]);
    const tasks = state.roadmap_epics[0].roadmap_features[0]
      .roadmap_tasks as Array<{
      id: string;
      status: string;
      priority?: string;
    }>;
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe(taskB);
    expect(tasks[0].status).toBe('done');
    expect(tasks[0].priority).toBe('high');
  });

  it('fans out a single update_node op across targets[] within one pass', () => {
    const service = createService() as unknown as {
      applyOperations: (
        state: Record<string, unknown>,
        operations: any[],
      ) => {
        issues: Array<{ code: string }>;
      };
    };

    const assignee = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const taskIds = [
      '11111111-1111-1111-1111-111111111111',
      '22222222-2222-2222-2222-222222222222',
      '33333333-3333-3333-3333-333333333333',
    ];
    const state: any = {
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
              roadmap_tasks: taskIds.map((id, index) => ({
                id,
                title: `Task ${index + 1}`,
                status: 'todo',
                assignee_id: null,
              })),
            },
          ],
        },
      ],
    };

    const result = service.applyOperations(state as any, [
      {
        op: 'update_node',
        targets: taskIds,
        patch: { assignee_id: assignee },
      },
    ]);

    expect(result.issues).toEqual([]);
    const tasks = state.roadmap_epics[0].roadmap_features[0]
      .roadmap_tasks as Array<{
      assignee_id: string | null;
    }>;
    expect(tasks).toHaveLength(3);
    for (const task of tasks) {
      expect(task.assignee_id).toBe(assignee);
    }
  });
});

describe('RoadmapAiService task assignees', () => {
  const ROADMAP_ID = '55e431e2-e416-468c-a973-94d97280e97d';
  const EPIC_ID = 'dad5697a-8962-4f80-8bc3-8a964edd8e56';
  const FEATURE_ID = '60bcab3f-3989-448d-9c84-3261cf38685b';
  const TASK_ID = '1beecdd2-f057-4c41-bf6d-8bb9e5e4b2b1';
  const ANA = '0f7be23f-3b57-4cf4-a269-a98d2164a45a';
  const BEN = '8d1c2b3a-4e5f-4a6b-9c7d-0e1f2a3b4c5d';
  const CID = '2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f';

  type Internals = {
    applyOperations: (
      state: any,
      operations: any[],
    ) => { issues: Array<{ code: string; path: string }> };
    normalizeFullRoadmapState: (raw: Record<string, unknown>) => any;
    computeSemanticDiff: (
      base: any,
      candidate: any,
    ) => {
      changes: Array<{
        type: string;
        node: { id: string };
        from?: Record<string, unknown>;
        to?: Record<string, unknown>;
      }>;
    };
    validateState: (state: any) => Array<{ code: string }>;
  };

  const createService = () =>
    new RoadmapAiService(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { publishRoadmapChange: jest.fn(), publishChatEvent: jest.fn() } as never,
      { log: jest.fn() } as never,
      { notifyNewlyAssigned: jest.fn().mockResolvedValue(undefined) } as never,
    ) as unknown as Internals;

  const stateWithTask = (task: Record<string, unknown>) => ({
    id: ROADMAP_ID,
    name: 'Roadmap',
    status: 'active',
    roadmap_epics: [
      {
        id: EPIC_ID,
        title: 'Epic',
        status: 'in_progress',
        roadmap_features: [
          {
            id: FEATURE_ID,
            title: 'Feature',
            roadmap_tasks: [
              { id: TASK_ID, title: 'Task', status: 'todo', ...task },
            ],
          },
        ],
      },
    ],
  });
  const taskOf = (state: any) =>
    state.roadmap_epics[0].roadmap_features[0].roadmap_tasks[0];
  const update = (patch: Record<string, unknown>) => ({
    op: 'update_node',
    node_id: TASK_ID,
    patch,
  });

  it('derives assignee_ids from the join rows (any embed shape), primary first, and mirrors assignee_id', () => {
    const state = createService().normalizeFullRoadmapState({
      id: ROADMAP_ID,
      name: 'Roadmap',
      epics: [
        {
          id: EPIC_ID,
          title: 'Epic',
          features: [
            {
              id: FEATURE_ID,
              title: 'Feature',
              tasks: [
                {
                  id: TASK_ID,
                  title: 'Task',
                  assignee_id: BEN,
                  assignees: [
                    { id: ANA },
                    { assignee_id: BEN },
                    { profile: { id: CID } },
                    { id: ANA },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });

    expect(taskOf(state).assignee_ids).toEqual([BEN, ANA, CID]);
    expect(taskOf(state).assignee_id).toBe(BEN);
  });

  it('keeps a column-only assignee (row written before the join table existed) instead of dropping it', () => {
    const state = createService().normalizeFullRoadmapState(
      stateWithTask({ assignee_id: ANA, assignees: [] }),
    );

    expect(taskOf(state).assignee_ids).toEqual([ANA]);
    expect(taskOf(state).assignee_id).toBe(ANA);
  });

  it('assignee_ids patch replaces the set (deduped, order kept) and mirrors assignee_id', () => {
    const service = createService();
    const state = stateWithTask({ assignee_id: ANA, assignee_ids: [ANA] });

    const result = service.applyOperations(state, [
      update({ assignee_ids: [BEN, CID, BEN] }),
    ]);

    expect(result.issues).toEqual([]);
    expect(taskOf(state).assignee_ids).toEqual([BEN, CID]);
    expect(taskOf(state).assignee_id).toBe(BEN);
  });

  it('assignee_id alone becomes [id]', () => {
    const service = createService();
    const state = stateWithTask({ assignee_id: ANA, assignee_ids: [ANA] });

    const result = service.applyOperations(state, [
      update({ assignee_id: BEN }),
    ]);

    expect(result.issues).toEqual([]);
    expect(taskOf(state).assignee_ids).toEqual([BEN]);
    expect(taskOf(state).assignee_id).toBe(BEN);
  });

  it('assignee_id alone is stored lowercased, like the array branch', () => {
    const service = createService();
    const state = stateWithTask({ assignee_id: ANA, assignee_ids: [ANA] });

    const result = service.applyOperations(state, [
      update({ assignee_id: BEN.toUpperCase() }),
    ]);

    expect(result.issues).toEqual([]);
    expect(taskOf(state).assignee_ids).toEqual([BEN]);
    expect(taskOf(state).assignee_id).toBe(BEN);
  });

  it('add_task lowercases a scalar assignee_id', () => {
    const service = createService();
    const state = stateWithTask({});

    const result = service.applyOperations(state, [
      {
        op: 'add_task',
        parent_id: FEATURE_ID,
        temp_id: 'task_upper',
        data: { title: 'Upper', assignee_id: CID.toUpperCase() },
      },
    ]);

    expect(result.issues).toEqual([]);
    const tasks = state.roadmap_epics[0].roadmap_features[0]
      .roadmap_tasks as any[];
    expect(tasks.find((task: any) => task.title === 'Upper')).toMatchObject({
      assignee_ids: [CID],
      assignee_id: CID,
    });
  });

  it('assignee_id: null unassigns everyone', () => {
    const service = createService();
    const state = stateWithTask({ assignee_id: ANA, assignee_ids: [ANA, BEN] });

    const result = service.applyOperations(state, [
      update({ assignee_id: null }),
    ]);

    expect(result.issues).toEqual([]);
    expect(taskOf(state).assignee_ids).toEqual([]);
    expect(taskOf(state).assignee_id).toBeUndefined();
  });

  it('assignee_ids: null means "assignment unchanged"; only [] unassigns', () => {
    const service = createService();
    const state = stateWithTask({ assignee_id: ANA, assignee_ids: [ANA, BEN] });

    const untouched = service.applyOperations(state, [
      update({ title: 'Renamed', assignee_ids: null }),
    ]);
    expect(untouched.issues).toEqual([]);
    expect(taskOf(state).title).toBe('Renamed');
    expect(taskOf(state).assignee_ids).toEqual([ANA, BEN]);
    expect(taskOf(state).assignee_id).toBe(ANA);

    const cleared = service.applyOperations(state, [
      update({ assignee_ids: [] }),
    ]);
    expect(cleared.issues).toEqual([]);
    expect(taskOf(state).assignee_ids).toEqual([]);
    expect(taskOf(state).assignee_id).toBeUndefined();
  });

  it('add_task treats data.assignee_ids: null as absent and falls back to assignee_id', () => {
    const service = createService();
    const state = stateWithTask({});

    const result = service.applyOperations(state, [
      {
        op: 'add_task',
        parent_id: FEATURE_ID,
        temp_id: 'task_null_set',
        data: { title: 'Null set', assignee_ids: null, assignee_id: BEN },
      },
      {
        op: 'add_task',
        parent_id: FEATURE_ID,
        temp_id: 'task_null_only',
        data: { title: 'Null only', assignee_ids: null },
      },
    ]);

    expect(result.issues).toEqual([]);
    const tasks = state.roadmap_epics[0].roadmap_features[0]
      .roadmap_tasks as any[];
    const byTitle = (title: string): any =>
      tasks.find((task: any) => task.title === title);
    expect(byTitle('Null set')).toMatchObject({
      assignee_ids: [BEN],
      assignee_id: BEN,
    });
    expect(byTitle('Null only').assignee_ids).toEqual([]);
    expect(byTitle('Null only').assignee_id).toBeUndefined();
  });

  it('dedupes assignee_ids case-insensitively and stores lowercase ids', () => {
    const service = createService();
    const state = stateWithTask({ assignee_id: ANA, assignee_ids: [ANA] });

    const result = service.applyOperations(state, [
      update({ assignee_ids: [BEN.toUpperCase(), BEN, CID] }),
    ]);

    expect(result.issues).toEqual([]);
    expect(taskOf(state).assignee_ids).toEqual([BEN, CID]);
    expect(taskOf(state).assignee_id).toBe(BEN);
  });

  it('assignee_ids wins over assignee_id when both are present', () => {
    const service = createService();
    const state = stateWithTask({ assignee_id: ANA, assignee_ids: [ANA] });

    const result = service.applyOperations(state, [
      update({ assignee_ids: [CID], assignee_id: BEN }),
    ]);

    expect(result.issues).toEqual([]);
    expect(taskOf(state).assignee_ids).toEqual([CID]);
    expect(taskOf(state).assignee_id).toBe(CID);
  });

  it('rejects a malformed assignee patch with INVALID_FIELD_VALUE and leaves the task untouched', () => {
    const service = createService();
    const state = stateWithTask({ assignee_id: ANA, assignee_ids: [ANA] });

    const notIds = service.applyOperations(state, [
      update({ assignee_ids: ['ana'] }),
    ]);
    expect(notIds.issues).toEqual([
      expect.objectContaining({
        code: 'INVALID_FIELD_VALUE',
        path: '/operations/0/patch/assignee_ids',
      }),
    ]);

    const notArray = service.applyOperations(state, [
      update({ assignee_ids: BEN }),
    ]);
    expect(notArray.issues[0].code).toBe('INVALID_FIELD_VALUE');

    const badScalar = service.applyOperations(state, [
      update({ assignee_id: 'Ben' }),
    ]);
    expect(badScalar.issues).toEqual([
      expect.objectContaining({
        code: 'INVALID_FIELD_VALUE',
        path: '/operations/0/patch/assignee_id',
      }),
    ]);

    expect(taskOf(state).assignee_ids).toEqual([ANA]);
    expect(taskOf(state).assignee_id).toBe(ANA);
  });

  it('add_task accepts assignee_ids (deduped) and mirrors the primary; assignee_id alone still works', () => {
    const service = createService();
    const state = stateWithTask({});

    const result = service.applyOperations(state, [
      {
        op: 'add_task',
        parent_id: FEATURE_ID,
        temp_id: 'task_a',
        data: { title: 'With set', assignee_ids: [ANA, BEN, ANA] },
      },
      {
        op: 'add_task',
        parent_id: FEATURE_ID,
        temp_id: 'task_b',
        data: { title: 'With scalar', assignee_id: CID },
      },
      {
        op: 'add_task',
        parent_id: FEATURE_ID,
        temp_id: 'task_c',
        data: { title: 'Unassigned' },
      },
    ]);

    expect(result.issues).toEqual([]);
    const tasks = state.roadmap_epics[0].roadmap_features[0]
      .roadmap_tasks as any[];
    const byTitle = (title: string): any =>
      tasks.find((task: any) => task.title === title);
    expect(byTitle('With set')).toMatchObject({
      assignee_ids: [ANA, BEN],
      assignee_id: ANA,
    });
    expect(byTitle('With scalar')).toMatchObject({
      assignee_ids: [CID],
      assignee_id: CID,
    });
    expect(byTitle('Unassigned').assignee_ids).toEqual([]);
    expect(byTitle('Unassigned').assignee_id).toBeUndefined();
  });

  it('rejects assignee_ids on a feature as OUT_OF_SCOPE_MUTATION', () => {
    const service = createService();
    const state = stateWithTask({});

    const result = service.applyOperations(state, [
      {
        op: 'update_node',
        node_id: FEATURE_ID,
        patch: { assignee_ids: [ANA] },
      },
    ]);

    expect(result.issues).toEqual([
      expect.objectContaining({
        code: 'OUT_OF_SCOPE_MUTATION',
        path: '/operations/0/patch/assignee_ids',
      }),
    ]);
  });

  it('emits ASSIGNEE_CHANGED for a co-assignee-only change and stays silent when the ordered set is unchanged', () => {
    const service = createService();
    const base = stateWithTask({ assignee_id: ANA, assignee_ids: [ANA] });

    const same = service.computeSemanticDiff(
      base,
      stateWithTask({ assignee_id: ANA, assignee_ids: [ANA] }),
    );
    expect(
      same.changes.filter((change) => change.type === 'ASSIGNEE_CHANGED'),
    ).toEqual([]);

    const grown = service.computeSemanticDiff(
      base,
      stateWithTask({ assignee_id: ANA, assignee_ids: [ANA, BEN] }),
    );
    expect(grown.changes).toEqual([
      {
        type: 'ASSIGNEE_CHANGED',
        node: { type: 'task', id: TASK_ID, title: 'Task' },
        from: { assignee_id: ANA, assignee_ids: [ANA] },
        to: { assignee_id: ANA, assignee_ids: [ANA, BEN] },
      },
    ]);
  });

  it('validateState normalizes the set (precedence, dedupe, mirror) instead of failing', () => {
    const service = createService();
    const state = stateWithTask({
      assignee_id: BEN,
      assignee_ids: [ANA, ANA, 'junk'],
    });

    const issues = service.validateState(state);

    expect(issues).toEqual([]);
    expect(taskOf(state).assignee_ids).toEqual([ANA]);
    expect(taskOf(state).assignee_id).toBe(ANA);
  });
});

describe('RoadmapAiService commit assignment side effects', () => {
  const ROADMAP_ID = '55e431e2-e416-468c-a973-94d97280e97d';
  const PROJECT_ID = '0c3d0b8e-6f1e-4b0f-9b1e-2b7f0a3c9d11';
  const USER_ID = 'f4a8b7e5-cf32-4d03-bad8-7e385efef7cb';
  const EPIC_ID = 'dad5697a-8962-4f80-8bc3-8a964edd8e56';
  const FEATURE_ID = '60bcab3f-3989-448d-9c84-3261cf38685b';
  const TASK_ID = '1beecdd2-f057-4c41-bf6d-8bb9e5e4b2b1';
  const ANA = '0f7be23f-3b57-4cf4-a269-a98d2164a45a';
  const BEN = '8d1c2b3a-4e5f-4a6b-9c7d-0e1f2a3b4c5d';
  const REVISION_TOKEN = '2026-04-02T11:00:00.000Z';

  const createCommitService = () => {
    const insert = jest.fn().mockResolvedValue({ error: null });
    const db = { from: jest.fn(() => ({ insert })) };
    const previewStore = {
      getChangeTimeline: jest.fn().mockResolvedValue(null),
      setChangeTimeline: jest.fn().mockResolvedValue(undefined),
      deleteResolveLookupByRoadmapAndNodeTypes: jest
        .fn()
        .mockResolvedValue(undefined),
      deleteResolveLookupByRoadmap: jest.fn().mockResolvedValue(undefined),
      readCommitIdempotency: jest.fn().mockResolvedValue(null),
      writeCommitIdempotency: jest.fn().mockResolvedValue(undefined),
    };
    const roadmapsRepo = {
      findById: jest.fn().mockResolvedValue({
        id: ROADMAP_ID,
        owner_id: USER_ID,
        project_id: PROJECT_ID,
        updated_at: REVISION_TOKEN,
      }),
      findUpdatedAt: jest.fn().mockResolvedValue(REVISION_TOKEN),
      // Lean shape: id-only join rows, exactly what the commit path reads.
      findFull: jest.fn().mockResolvedValue({
        id: ROADMAP_ID,
        name: 'Q2 SaaS Platform Development',
        epics: [
          {
            id: EPIC_ID,
            title: 'Epic',
            features: [
              {
                id: FEATURE_ID,
                title: 'Feature',
                tasks: [
                  {
                    id: TASK_ID,
                    title: 'Task',
                    status: 'todo',
                    assignee_id: ANA,
                    assignees: [{ id: ANA }],
                  },
                ],
              },
            ],
          },
        ],
      }),
    };
    const patchRepo = {
      upsertFullRoadmap: jest.fn().mockResolvedValue(undefined),
    };
    const authz = { assertRoadmapPermission: jest.fn().mockResolvedValue({}) };
    const notifier = {
      notifyNewlyAssigned: jest.fn().mockResolvedValue(undefined),
    };
    const service = new RoadmapAiService(
      db as never,
      roadmapsRepo as never,
      patchRepo as never,
      authz as never,
      previewStore as never,
      { publishRoadmapChange: jest.fn(), publishChatEvent: jest.fn() } as never,
      { log: jest.fn() } as never,
      notifier as never,
    );
    const warn = jest
      .spyOn((service as any).logger, 'warn')
      .mockImplementation(() => undefined);
    return { service, patchRepo, authz, notifier, warn };
  };

  const commit = (service: RoadmapAiService, patch: Record<string, unknown>) =>
    service.commit(
      ROADMAP_ID,
      {
        revision_token: REVISION_TOKEN,
        include_roadmap: false,
        operations: [{ op: 'update_node', node_id: TASK_ID, patch }],
      } as any,
      USER_ID,
    );

  it('asserts roadmap.assign, passes the actor to the RPC, and notifies only the newly assigned', async () => {
    const { service, patchRepo, authz, notifier } = createCommitService();

    const result = await commit(service, { assignee_ids: [ANA, BEN] });

    expect(authz.assertRoadmapPermission).toHaveBeenCalledWith(
      ROADMAP_ID,
      USER_ID,
      'roadmap.assign',
    );
    expect(patchRepo.upsertFullRoadmap).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: USER_ID }),
    );
    const committedTask =
      patchRepo.upsertFullRoadmap.mock.calls[0][0].fullState.roadmap_epics[0]
        .roadmap_features[0].roadmap_tasks[0];
    expect(committedTask).toMatchObject({
      assignee_ids: [ANA, BEN],
      assignee_id: ANA,
    });
    expect(notifier.notifyNewlyAssigned).toHaveBeenCalledTimes(1);
    expect(notifier.notifyNewlyAssigned).toHaveBeenCalledWith({
      task: { id: TASK_ID, title: 'Task', feature_id: FEATURE_ID },
      assigneeIds: [BEN],
      actorId: USER_ID,
      projectId: PROJECT_ID,
    });
    expect(result.semantic_diff.changes).toEqual([
      expect.objectContaining({
        type: 'ASSIGNEE_CHANGED',
        to: { assignee_id: ANA, assignee_ids: [ANA, BEN] },
      }),
    ]);
  });

  it('skips the assign check and notifications when no operation touches assignment', async () => {
    const { service, authz, notifier } = createCommitService();

    await commit(service, { title: 'Renamed' });

    expect(authz.assertRoadmapPermission).not.toHaveBeenCalledWith(
      ROADMAP_ID,
      USER_ID,
      'roadmap.assign',
    );
    expect(notifier.notifyNewlyAssigned).not.toHaveBeenCalled();
  });

  it('treats assignee_ids: null as "assignment unchanged": no assign check, no notification', async () => {
    const { service, patchRepo, authz, notifier } = createCommitService();

    await commit(service, { title: 'Renamed', assignee_ids: null });

    expect(authz.assertRoadmapPermission).not.toHaveBeenCalledWith(
      ROADMAP_ID,
      USER_ID,
      'roadmap.assign',
    );
    expect(notifier.notifyNewlyAssigned).not.toHaveBeenCalled();
    const committedTask =
      patchRepo.upsertFullRoadmap.mock.calls[0][0].fullState.roadmap_epics[0]
        .roadmap_features[0].roadmap_tasks[0];
    expect(committedTask).toMatchObject({
      title: 'Renamed',
      assignee_ids: [ANA],
      assignee_id: ANA,
    });
  });

  it('treats assignee_id: null as an unassign that still asserts roadmap.assign', async () => {
    const { service, patchRepo, authz, notifier } = createCommitService();

    await commit(service, { assignee_id: null });

    expect(authz.assertRoadmapPermission).toHaveBeenCalledWith(
      ROADMAP_ID,
      USER_ID,
      'roadmap.assign',
    );
    expect(notifier.notifyNewlyAssigned).not.toHaveBeenCalled();
    const committedTask =
      patchRepo.upsertFullRoadmap.mock.calls[0][0].fullState.roadmap_epics[0]
        .roadmap_features[0].roadmap_tasks[0];
    expect(committedTask.assignee_ids).toEqual([]);
    expect(committedTask.assignee_id).toBeUndefined();
  });

  it('does not notify when the set only shrinks', async () => {
    const { service, notifier } = createCommitService();

    await commit(service, { assignee_ids: [] });

    expect(notifier.notifyNewlyAssigned).not.toHaveBeenCalled();
  });

  it('maps a missing roadmap.assign capability to 403 before writing', async () => {
    const { service, patchRepo, authz } = createCommitService();
    authz.assertRoadmapPermission.mockImplementation(
      (_roadmapId: string, _userId: string, permission: string) =>
        permission === 'roadmap.assign'
          ? Promise.reject(new Error('missing roadmap.assign'))
          : Promise.resolve({}),
    );

    await expect(commit(service, { assignee_id: BEN })).rejects.toMatchObject({
      status: 403,
    });
    expect(patchRepo.upsertFullRoadmap).not.toHaveBeenCalled();
  });

  it('keeps the commit successful when notification delivery fails', async () => {
    const { service, notifier, warn } = createCommitService();
    notifier.notifyNewlyAssigned.mockRejectedValueOnce(
      new Error('notifications down'),
    );

    const result = await commit(service, { assignee_ids: [ANA, BEN] });

    expect(result.change_id).toEqual(expect.any(String));
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('event=roadmap_ai_commit_assignee_notify_failed'),
    );
  });
});

describe('RoadmapAiService context reads expose the full assignee set', () => {
  const ROADMAP_ID = '55e431e2-e416-468c-a973-94d97280e97d';
  const USER_ID = 'f4a8b7e5-cf32-4d03-bad8-7e385efef7cb';
  const ANA = '0f7be23f-3b57-4cf4-a269-a98d2164a45a';
  const EPIC_ID = 'dad5697a-8962-4f80-8bc3-8a964edd8e56';
  const FEATURE_ID = '60bcab3f-3989-448d-9c84-3261cf38685b';
  const TASK_ID = '1beecdd2-f057-4c41-bf6d-8bb9e5e4b2b1';

  const createService = () => {
    const roadmapsRepo = {
      findById: jest
        .fn()
        .mockResolvedValue({ id: ROADMAP_ID, owner_id: USER_ID }),
      findUpdatedAt: jest.fn().mockResolvedValue('2026-04-02T11:00:00.000Z'),
      findFull: jest.fn().mockResolvedValue({
        id: ROADMAP_ID,
        name: 'Roadmap',
        epics: [
          {
            id: EPIC_ID,
            title: 'Epic',
            features: [
              {
                id: FEATURE_ID,
                title: 'Feature',
                tasks: [
                  {
                    id: TASK_ID,
                    title: 'Shared task',
                    status: 'in_progress',
                    assignee_id: ANA,
                    assignees: [
                      { id: ANA, display_name: 'Ana' },
                      { id: USER_ID, first_name: 'Sam', last_name: 'Lee' },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }),
    };
    const service = new RoadmapAiService(
      {} as never,
      roadmapsRepo as never,
      {} as never,
      { assertRoadmapPermission: jest.fn() } as never,
      { getPreview: jest.fn().mockResolvedValue(null) } as never,
      { publishRoadmapChange: jest.fn(), publishChatEvent: jest.fn() } as never,
      { log: jest.fn() } as never,
      { notifyNewlyAssigned: jest.fn().mockResolvedValue(undefined) } as never,
    );
    return { service };
  };

  it('tasks-assigned-to-me matches a co-assignee, not just the primary, and returns the set', async () => {
    const { service } = createService();
    const result = await service.getContextTasksAssignedToMe(
      ROADMAP_ID,
      {},
      USER_ID,
    );
    expect(result.tasks).toEqual([
      expect.objectContaining({
        id: TASK_ID,
        assignee_id: ANA,
        assignee_ids: [ANA, USER_ID],
      }),
    ]);
  });

  it('feature children carry each task assignee set, primary first', async () => {
    const { service } = createService();
    const result = await service.getContextNodeChildren(
      ROADMAP_ID,
      FEATURE_ID,
      {},
      USER_ID,
    );
    expect(result.children).toEqual([
      expect.objectContaining({
        id: TASK_ID,
        type: 'task',
        parent_id: FEATURE_ID,
        assignee_id: ANA,
        assignee_ids: [ANA, USER_ID],
      }),
    ]);
  });

  it('filtered tasks match assignee_id against the set and return assignee_ids', async () => {
    const { service } = createService();
    const result = await service.getContextTasksFiltered(
      ROADMAP_ID,
      { assignee_id: USER_ID },
      USER_ID,
    );
    expect(result.tasks).toEqual([
      expect.objectContaining({
        id: TASK_ID,
        assignee_id: ANA,
        assignee_ids: [ANA, USER_ID],
      }),
    ]);
  });

  it('node details return assignee_ids and named assignees', async () => {
    const { service } = createService();
    const result = await service.getContextNodeDetails(
      ROADMAP_ID,
      TASK_ID,
      USER_ID,
    );
    expect(result).toMatchObject({
      id: TASK_ID,
      assignee_id: ANA,
      assignee_ids: [ANA, USER_ID],
      assignees: [
        { id: ANA, display_name: 'Ana' },
        { id: USER_ID, display_name: 'Sam Lee' },
      ],
    });
  });
});
