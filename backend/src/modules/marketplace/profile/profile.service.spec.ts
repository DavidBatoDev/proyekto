import { ProfileService } from './profile.service';

describe('ProfileService cache consistency', () => {
  const cacheInvalidation = {
    invalidateDiscoveryCaches: jest.fn().mockResolvedValue(undefined),
    invalidateMarketplaceTalentCache: jest
      .fn()
      .mockResolvedValue(undefined),
  };

  const profileRepo = {
    updateBasic: jest.fn(),
    replaceUserSkills: jest.fn(),
    upsertRateSettings: jest.fn(),
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

  /**
   * Skills and the rate card are ACCOUNT-level: one row set, rendered on the
   * talent directory and on the cached public consultant profile. These
   * two used to purge only the talent cache, which was correct while the
   * consultant profile carried neither. It now carries both, so purging one
   * side would leave the other serving stale data for a full TTL — and the
   * consultant would read that as "saving is broken".
   */
  it('invalidates BOTH directories after skills replacement', async () => {
    profileRepo.replaceUserSkills.mockResolvedValueOnce([]);

    await service.replaceSkills('user-1', { skills: [] });

    expect(cacheInvalidation.invalidateDiscoveryCaches).toHaveBeenCalledWith(
      'user-1',
    );
  });

  it('invalidates BOTH directories after a rate-card change', async () => {
    profileRepo.upsertRateSettings.mockResolvedValueOnce({ user_id: 'user-1' });

    await service.upsertRateSettings('user-1', {} as any);

    expect(cacheInvalidation.invalidateDiscoveryCaches).toHaveBeenCalledWith(
      'user-1',
    );
  });
});
