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
