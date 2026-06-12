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
  order = jest.fn().mockReturnThis();
  single = jest.fn().mockImplementation(async () => ({
    data: this.__resolveData,
    error: this.__resolveError,
  }));
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
  options: { roadmapFindByIdResult?: unknown } = {},
) => {
  const db = { from: jest.fn().mockReturnValue(builder) };
  const roadmapsRepo = {
    findById: jest.fn().mockResolvedValue(
      options.roadmapFindByIdResult === undefined
        ? { id: 'roadmap-1' }
        : options.roadmapFindByIdResult,
    ),
  };
  const service = new RoadmapAiMemoriesService(
    db as never,
    roadmapsRepo as never,
  );
  return { service, roadmapsRepo };
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

  it('list filters to active memories', async () => {
    const builder = new QueryBuilder();
    builder.__resolveData = [];
    const { service } = buildService(builder);

    await service.list('roadmap-1', 'user-1');

    const calls = (builder.eq as MockFn).mock.calls;
    expect(
      calls.some(([col, val]) => col === 'is_active' && val === true),
    ).toBe(true);
  });

  it('enforces the active-memory cap', async () => {
    const builder = new QueryBuilder();
    builder.__resolveCount = 50;
    const { service } = buildService(builder);

    await expect(
      service.create('roadmap-1', 'user-1', { content: 'one more rule' }),
    ).rejects.toBeInstanceOf(BadRequestException);
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
