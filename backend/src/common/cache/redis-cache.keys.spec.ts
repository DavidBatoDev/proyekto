import { buildMarketplaceTalentCacheKey } from './redis-cache.keys';

describe('redis-cache.keys', () => {
  it('builds identical marketplace cache keys for equivalent query shapes', () => {
    const keyA = buildMarketplaceTalentCacheKey({
      search: '  React Dev  ',
      availability: 'AVAILABLE',
      sort: 'RATING_DESC',
      minRate: 100,
      maxRate: 250,
    });

    const keyB = buildMarketplaceTalentCacheKey({
      maxRate: 250,
      minRate: 100,
      sort: 'rating_desc',
      availability: 'available',
      search: 'react dev',
    });

    expect(keyA).toBe(keyB);
  });

  it('ignores empty and undefined query fields', () => {
    const emptyKey = buildMarketplaceTalentCacheKey({});
    const noisyKey = buildMarketplaceTalentCacheKey({
      search: '   ',
      skill: undefined,
      specialization: '',
      availability: '   ',
    });

    expect(noisyKey).toBe(emptyKey);
  });
});

