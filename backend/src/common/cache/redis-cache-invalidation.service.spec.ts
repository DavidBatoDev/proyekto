import { RedisCacheInvalidationService } from './redis-cache-invalidation.service';
import { REDIS_CACHE_KEYS } from './redis-cache.keys';

describe('RedisCacheInvalidationService', () => {
  const cache = {
    del: jest.fn().mockResolvedValue(undefined),
    delMany: jest.fn().mockResolvedValue(undefined),
    clearIndex: jest.fn().mockResolvedValue(undefined),
  };
  const cloudflarePurge = {
    purgePaths: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('invalidates consultants list + profile key when user is provided', async () => {
    const service = new RedisCacheInvalidationService(
      cache as any,
      cloudflarePurge as any,
    );
    await service.invalidateConsultantsCache('user-1');

    expect(cache.delMany).toHaveBeenCalledWith([
      REDIS_CACHE_KEYS.consultantsList,
      REDIS_CACHE_KEYS.consultantsProfile('user-1'),
    ]);
    expect(cloudflarePurge.purgePaths).toHaveBeenCalledWith([
      '/api/consultants',
      '/api/consultants/user-1',
    ]);
  });

  it('invalidates all dashboard cache entries via index clear', async () => {
    const service = new RedisCacheInvalidationService(
      cache as any,
      cloudflarePurge as any,
    );
    await service.invalidateAllDashboardCache();

    expect(cache.clearIndex).toHaveBeenCalledWith(
      REDIS_CACHE_KEYS.projectsDashboardIndex,
    );
  });

  it('invalidates marketplace cached queries via index clear', async () => {
    const service = new RedisCacheInvalidationService(
      cache as any,
      cloudflarePurge as any,
    );
    await service.invalidateMarketplaceFreelancersCache();

    expect(cache.clearIndex).toHaveBeenCalledWith(
      REDIS_CACHE_KEYS.marketplaceFreelancersIndex,
    );
  });

  it('invalidates indexed roadmap template responses and purges the catalog', async () => {
    const service = new RedisCacheInvalidationService(
      cache as any,
      cloudflarePurge as any,
    );
    await service.invalidateRoadmapTemplatesCache();

    expect(cache.clearIndex).toHaveBeenCalledWith(
      REDIS_CACHE_KEYS.roadmapTemplatesIndex,
    );
    expect(cloudflarePurge.purgePaths).toHaveBeenCalledWith([
      '/api/roadmap-templates',
    ]);
  });

  it('stays fail-open when purge call throws', async () => {
    cloudflarePurge.purgePaths.mockRejectedValueOnce(new Error('cf down'));
    const service = new RedisCacheInvalidationService(
      cache as any,
      cloudflarePurge as any,
    );

    await expect(service.invalidateConsultantsCache('user-1')).resolves.toBe(
      undefined,
    );
  });
});
