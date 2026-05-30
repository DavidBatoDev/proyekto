import { RoadmapsService } from './roadmaps.service';
import { REDIS_CACHE_KEYS } from '../../../common/cache/redis-cache.keys';

describe('RoadmapsService cache consistency', () => {
  const cache = {
    getPublicTtlSeconds: jest.fn().mockReturnValue(120),
    rememberJson: jest.fn(async (_key: string, _ttl: number, loader: any) =>
      loader(),
    ),
  };
  const cacheInvalidation = {
    invalidatePublicRoadmapTemplatesCache: jest
      .fn()
      .mockResolvedValue(undefined),
  };
  const roadmapAuthz = {
    assertProjectRoadmapPermission: jest.fn(),
  };
  const supabase = {
    from: jest.fn(),
  };
  const repo = {
    create: jest.fn(),
    findPublicTemplatePreviews: jest.fn(),
  };

  const service = new RoadmapsService(
    repo as any,
    supabase as any,
    roadmapAuthz as any,
    cache as any,
    cacheInvalidation as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('invalidates public template cache after create mutation', async () => {
    repo.create.mockResolvedValueOnce({ id: 'roadmap-1' });

    await service.create({ name: 'New roadmap' } as any, 'user-1');

    expect(
      cacheInvalidation.invalidatePublicRoadmapTemplatesCache,
    ).toHaveBeenCalledTimes(1);
  });

  it('uses cached path for public template listing', async () => {
    repo.findPublicTemplatePreviews.mockResolvedValueOnce([]);

    await service.findPublicTemplates();

    expect(cache.rememberJson).toHaveBeenCalledWith(
      REDIS_CACHE_KEYS.publicRoadmapTemplates,
      120,
      expect.any(Function),
      expect.objectContaining({ onStatus: undefined }),
    );
  });
});
