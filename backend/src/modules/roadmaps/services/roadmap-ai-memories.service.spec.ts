import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RoadmapAiMemoriesService } from './roadmap-ai-memories.service';

type MockFn = jest.Mock;

class QueryBuilder {
  __resolveData: unknown = null;
  __resolveError: unknown = null;
  __resolveCount: number | null = null;
  select = jest.fn().mockReturnThis();
  insert = jest.fn().mockReturnThis();
  update = jest.fn().mockReturnThis();
  eq = jest.fn().mockReturnThis();
  or = jest.fn().mockReturnThis();
  order = jest.fn().mockReturnThis();
  single = jest.fn().mockImplementation(() =>
    Promise.resolve({
      data: this.__resolveData,
      error: this.__resolveError,
    }),
  );
  then(
    onFulfilled: (result: {
      data: unknown;
      error: unknown;
      count: number | null;
    }) => unknown,
    onRejected?: (err: unknown) => unknown,
  ) {
    return Promise.resolve({
      data: this.__resolveData,
      error: this.__resolveError,
      count: this.__resolveCount,
    }).then(onFulfilled, onRejected);
  }
}

const buildService = (
  builder: QueryBuilder,
  options: {
    roadmapFindByIdResult?: unknown;
    relevantMatches?: unknown[] | null;
  } = {},
) => {
  const db = { from: jest.fn().mockReturnValue(builder) };
  const roadmapsRepo = {
    findById: jest
      .fn()
      .mockResolvedValue(
        options.roadmapFindByIdResult === undefined
          ? { id: 'roadmap-1', project_id: 'project-1' }
          : options.roadmapFindByIdResult,
      ),
  };
  const knowledgeOutbox = { enqueue: jest.fn() };
  const knowledgeSearch = {
    matchRelevantMemories: jest
      .fn()
      .mockResolvedValue(options.relevantMatches ?? null),
  };
  const service = new RoadmapAiMemoriesService(
    db as never,
    roadmapsRepo as never,
    knowledgeOutbox as never,
    knowledgeSearch as never,
  );
  return { service, roadmapsRepo, knowledgeOutbox, knowledgeSearch, builder };
};

describe('RoadmapAiMemoriesService', () => {
  it('404s when the caller cannot access the roadmap', async () => {
    const { service } = buildService(new QueryBuilder(), {
      roadmapFindByIdResult: null,
    });

    await expect(service.list('roadmap-1', 'intruder')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('list filters to active memories with the scope OR-query and no embedding column', async () => {
    const builder = new QueryBuilder();
    builder.__resolveData = [];
    const { service } = buildService(builder);

    await service.list('roadmap-1', 'user-1');

    const eqCalls = (builder.eq as MockFn).mock.calls;
    expect(
      eqCalls.some(([col, val]) => col === 'is_active' && val === true),
    ).toBe(true);
    expect(builder.or).toHaveBeenCalledWith(
      'and(roadmap_id.eq.roadmap-1,scope.eq.roadmap),' +
        'and(project_id.eq.project-1,scope.eq.project)',
    );
    const selectCalls = (builder.select as MockFn).mock.calls as unknown as [
      string,
    ][];
    const selected = selectCalls[0][0];
    expect(selected).toContain('scope');
    expect(selected).toContain('category');
    expect(selected).not.toContain('embedding');
    expect(selected).not.toContain('*');
  });

  it('list falls back to roadmap-only scope on projectless roadmaps', async () => {
    const builder = new QueryBuilder();
    builder.__resolveData = [];
    const { service } = buildService(builder, {
      roadmapFindByIdResult: { id: 'roadmap-1', project_id: null },
    });

    await service.list('roadmap-1', 'user-1');

    expect(builder.or).toHaveBeenCalledWith(
      'and(roadmap_id.eq.roadmap-1,scope.eq.roadmap)',
    );
  });

  it('enforces the active-memory cap per scope bucket', async () => {
    const builder = new QueryBuilder();
    builder.__resolveCount = 50;
    const { service } = buildService(builder);

    await expect(
      service.create('roadmap-1', 'user-1', {
        content: 'one more rule',
        scope: 'project',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    const eqCalls = (builder.eq as MockFn).mock.calls;
    expect(
      eqCalls.some(([col, val]) => col === 'scope' && val === 'project'),
    ).toBe(true);
    expect(
      eqCalls.some(([col, val]) => col === 'project_id' && val === 'project-1'),
    ).toBe(true);
  });

  it('rejects project scope on a projectless roadmap', async () => {
    const { service } = buildService(new QueryBuilder(), {
      roadmapFindByIdResult: { id: 'roadmap-1', project_id: null },
    });

    await expect(
      service.create('roadmap-1', 'user-1', {
        content: 'a project-wide rule',
        scope: 'project',
      }),
    ).rejects.toMatchObject({
      response: { code: 'NO_PROJECT_FOR_SCOPE' },
    });
  });

  it('create stamps scope/category/project and enqueues a memory embedding', async () => {
    const builder = new QueryBuilder();
    builder.__resolveCount = 0;
    builder.__resolveData = {
      id: 'memory-1',
      roadmap_id: 'roadmap-1',
      project_id: 'project-1',
      scope: 'project',
      category: 'decision',
      content: 'Client prefers weekly demos',
    };
    const { service, knowledgeOutbox } = buildService(builder);

    const row = await service.create('roadmap-1', 'user-1', {
      content: 'Client prefers weekly demos',
      scope: 'project',
      category: 'decision',
    });

    expect(builder.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'project',
        category: 'decision',
        project_id: 'project-1',
      }),
    );
    expect(row.id).toBe('memory-1');
    expect(knowledgeOutbox.enqueue).toHaveBeenCalledWith({
      sourceType: 'memory',
      sourceId: 'memory-1',
      projectId: 'project-1',
      op: 'upsert',
    });
  });

  it('relevant returns semantic matches when available', async () => {
    const matches = [{ id: 'memory-2', content: 'rule', similarity: 0.91 }];
    const { service, knowledgeSearch } = buildService(new QueryBuilder(), {
      relevantMatches: matches,
    });

    const result = await service.relevant(
      'roadmap-1',
      'user-1',
      'what did we decide?',
      8,
    );

    expect(result.memories).toEqual(matches);
    expect(knowledgeSearch.matchRelevantMemories).toHaveBeenCalledWith({
      roadmapId: 'roadmap-1',
      projectId: 'project-1',
      query: 'what did we decide?',
      limit: 8,
    });
  });

  it('relevant falls back to the chronological list when embeddings are unavailable', async () => {
    const builder = new QueryBuilder();
    builder.__resolveData = [
      { id: 'memory-1', content: 'a' },
      { id: 'memory-2', content: 'b' },
      { id: 'memory-3', content: 'c' },
    ];
    const { service } = buildService(builder, { relevantMatches: null });

    const result = await service.relevant('roadmap-1', 'user-1', 'query', 2);

    expect(result.memories).toHaveLength(2);
    expect(result.memories[0]).toMatchObject({ id: 'memory-1' });
  });

  it('deactivate 404s when no active row matched', async () => {
    const builder = new QueryBuilder();
    builder.__resolveData = [];
    const { service } = buildService(builder);

    await expect(
      service.deactivate('roadmap-1', 'memory-x', 'user-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
