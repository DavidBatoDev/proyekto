import { ConfigService } from '@nestjs/config';
import { RedisDataCacheService } from './redis-data-cache.service';

function createRedisMock() {
  const pipeline = {
    sadd: jest.fn(),
    expire: jest.fn(),
    exec: jest.fn().mockResolvedValue([]),
  };

  return {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    smembers: jest.fn(),
    pipeline: jest.fn().mockReturnValue(pipeline),
    pipelineMock: pipeline,
  };
}

function createService(
  env: Record<string, string>,
  redisMock: ReturnType<typeof createRedisMock> | null,
) {
  const configService = new ConfigService({
    REDIS_CACHE_TTL_JITTER_PERCENT: '0',
    ...env,
  });
  return new RedisDataCacheService(redisMock as any, configService);
}

describe('RedisDataCacheService', () => {
  it('returns cached value on hit and skips loader', async () => {
    const redis = createRedisMock();
    redis.get.mockResolvedValueOnce(JSON.stringify({ ok: true }));
    const service = createService(
      { REDIS_DATA_CACHE_ENABLED: 'true' },
      redis,
    );

    const loader = jest.fn(async () => ({ ok: false }));
    const onStatus = jest.fn();

    const result = await service.rememberJson(
      'cache:key',
      60,
      loader,
      { onStatus },
    );

    expect(result).toEqual({ ok: true });
    expect(loader).not.toHaveBeenCalled();
    expect(onStatus).toHaveBeenCalledWith('HIT');
  });

  it('loads and stores value on miss', async () => {
    const redis = createRedisMock();
    redis.get.mockResolvedValueOnce(null);
    redis.set.mockResolvedValueOnce('OK');
    const service = createService(
      { REDIS_DATA_CACHE_ENABLED: 'true' },
      redis,
    );

    const loader = jest.fn(async () => ({ rows: [1, 2, 3] }));
    const onStatus = jest.fn();

    const result = await service.rememberJson(
      'cache:key',
      120,
      loader,
      { onStatus },
    );

    expect(result).toEqual({ rows: [1, 2, 3] });
    expect(loader).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalledWith(
      'cache:key',
      JSON.stringify({ rows: [1, 2, 3] }),
      { ex: 120 },
    );
    expect(onStatus).toHaveBeenCalledWith('MISS');
  });

  it('fails open to loader and reports ERROR when redis read fails', async () => {
    const redis = createRedisMock();
    redis.get.mockRejectedValueOnce(new Error('redis down'));
    redis.set.mockResolvedValueOnce('OK');
    const service = createService(
      { REDIS_DATA_CACHE_ENABLED: 'true' },
      redis,
    );

    const loader = jest.fn(async () => ({ ok: true }));
    const onStatus = jest.fn();

    const result = await service.rememberJson(
      'cache:key',
      45,
      loader,
      { onStatus },
    );

    expect(result).toEqual({ ok: true });
    expect(loader).toHaveBeenCalledTimes(1);
    expect(onStatus).toHaveBeenCalledWith('ERROR');
  });

  it('bypasses redis when cache is disabled', async () => {
    const redis = createRedisMock();
    const service = createService(
      { REDIS_DATA_CACHE_ENABLED: 'false' },
      redis,
    );

    const loader = jest.fn(async () => ({ ok: true }));
    const onStatus = jest.fn();

    const result = await service.rememberJson(
      'cache:key',
      45,
      loader,
      { onStatus },
    );

    expect(result).toEqual({ ok: true });
    expect(loader).toHaveBeenCalledTimes(1);
    expect(redis.get).not.toHaveBeenCalled();
    expect(onStatus).toHaveBeenCalledWith('BYPASS');
  });

  it('adds and expires index entries when configured', async () => {
    const redis = createRedisMock();
    redis.get.mockResolvedValueOnce(null);
    redis.set.mockResolvedValueOnce('OK');
    const service = createService(
      {
        REDIS_DATA_CACHE_ENABLED: 'true',
        REDIS_CACHE_MARKETPLACE_INDEX_TTL_SECONDS: '86400',
      },
      redis,
    );

    await service.rememberJson(
      'cache:key',
      45,
      async () => ({ ok: true }),
      {
        indexKey: 'cache:index',
      },
    );

    expect(redis.pipeline).toHaveBeenCalledTimes(1);
    expect(redis.pipelineMock.sadd).toHaveBeenCalledWith(
      'cache:index',
      'cache:key',
    );
    expect(redis.pipelineMock.expire).toHaveBeenCalledWith(
      'cache:index',
      86400,
    );
  });

  it('applies ttl jitter within configured bounds', async () => {
    const redis = createRedisMock();
    redis.get.mockResolvedValueOnce(null);
    redis.set.mockResolvedValueOnce('OK');
    const service = createService(
      {
        REDIS_DATA_CACHE_ENABLED: 'true',
        REDIS_CACHE_TTL_JITTER_PERCENT: '10',
      },
      redis,
    );

    const randomSpy = jest.spyOn(Math, 'random').mockReturnValueOnce(0);

    await service.rememberJson('cache:key', 100, async () => ({ ok: true }));

    expect(redis.set).toHaveBeenCalledWith(
      'cache:key',
      JSON.stringify({ ok: true }),
      { ex: 90 },
    );

    randomSpy.mockRestore();
  });
});
