import { ProfileService } from './profile.service';

describe('ProfileService cache consistency', () => {
  const cacheInvalidation = {
    invalidateDiscoveryCaches: jest.fn().mockResolvedValue(undefined),
    invalidateMarketplaceFreelancersCache: jest
      .fn()
      .mockResolvedValue(undefined),
  };

  const profileRepo = {
    updateBasic: jest.fn(),
    replaceUserSkills: jest.fn(),
  };

  const service = new ProfileService(
    profileRepo as any,
    cacheInvalidation as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('invalidates discovery caches after basic profile update', async () => {
    profileRepo.updateBasic.mockResolvedValueOnce({ id: 'user-1' });

    await service.updateBasic('user-1', {} as any);

    expect(cacheInvalidation.invalidateDiscoveryCaches).toHaveBeenCalledWith(
      'user-1',
    );
  });

  it('invalidates marketplace cache after skills replacement', async () => {
    profileRepo.replaceUserSkills.mockResolvedValueOnce([]);

    await service.replaceSkills('user-1', { skills: [] });

    expect(
      cacheInvalidation.invalidateMarketplaceFreelancersCache,
    ).toHaveBeenCalledTimes(1);
  });
});
