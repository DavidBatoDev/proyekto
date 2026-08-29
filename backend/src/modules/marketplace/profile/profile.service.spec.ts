import { ProfileService } from './profile.service';

describe('ProfileService cache consistency', () => {
  const cacheInvalidation = {
    invalidateDiscoveryCaches: jest.fn().mockResolvedValue(undefined),
    invalidateMarketplaceTalentCache: jest.fn().mockResolvedValue(undefined),
  };

  const profileRepo = {
    updateBasic: jest.fn(),
    replaceUserSkills: jest.fn(),
    upsertRateSettings: jest.fn(),
    addExperience: jest.fn(),
    updateExperience: jest.fn(),
    deleteExperience: jest.fn(),
    addPortfolio: jest.fn(),
    updatePortfolio: jest.fn(),
    deletePortfolio: jest.fn(),
    addLanguage: jest.fn(),
    updateLanguage: jest.fn(),
    deleteLanguage: jest.fn(),
    addSpecialization: jest.fn(),
    updateSpecialization: jest.fn(),
    deleteSpecialization: jest.fn(),
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

  /**
   * Experiences, portfolios and languages render on both cached PUBLIC seller
   * profiles (consultant + talent). Before the WYSIWYG profiles these writes
   * invalidated nothing, so an owner's edit sat stale for a full TTL.
   */
  it.each([
    ['addExperience', () => service.addExperience('user-1', {} as any)],
    [
      'updateExperience',
      () => service.updateExperience('row-1', 'user-1', {} as any),
    ],
    ['deleteExperience', () => service.deleteExperience('row-1', 'user-1')],
    ['addPortfolio', () => service.addPortfolio('user-1', {} as any)],
    [
      'updatePortfolio',
      () => service.updatePortfolio('row-1', 'user-1', {} as any),
    ],
    ['deletePortfolio', () => service.deletePortfolio('row-1', 'user-1')],
    ['addLanguage', () => service.addLanguage('user-1', {} as any)],
    [
      'updateLanguage',
      () => service.updateLanguage('row-1', 'user-1', {} as any),
    ],
    ['deleteLanguage', () => service.deleteLanguage('row-1', 'user-1')],
  ])('invalidates both public profiles after %s', async (_name, run) => {
    await run();

    expect(cacheInvalidation.invalidateDiscoveryCaches).toHaveBeenCalledWith(
      'user-1',
    );
  });

  /**
   * Specializations are talent-only, so they purge the talent side — but must
   * now carry the userId so the cached public talent PROFILE goes too, not
   * just the browse index.
   */
  it.each([
    ['addSpecialization', () => service.addSpecialization('user-1', {} as any)],
    [
      'updateSpecialization',
      () => service.updateSpecialization('row-1', 'user-1', {} as any),
    ],
    [
      'deleteSpecialization',
      () => service.deleteSpecialization('row-1', 'user-1'),
    ],
  ])('purges the talent profile key after %s', async (_name, run) => {
    await run();

    expect(
      cacheInvalidation.invalidateMarketplaceTalentCache,
    ).toHaveBeenCalledWith('user-1');
  });
});
