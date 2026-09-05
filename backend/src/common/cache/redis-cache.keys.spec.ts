import {
  buildMarketplaceTalentCacheKey,
  REDIS_CACHE_KEYS,
} from './redis-cache.keys';

describe('redis-cache.keys', () => {
  it('keys the AI context overview per user and workspace, with ws:none when omitted', () => {
    expect(REDIS_CACHE_KEYS.aiContextOverviewByUser('user-1', 'ws-1')).toBe(
      'cache:v1:ai:context:overview:user:user-1:ws:ws-1',
    );
    expect(REDIS_CACHE_KEYS.aiContextOverviewByUser('user-1', null)).toBe(
      'cache:v1:ai:context:overview:user:user-1:ws:none',
    );
    expect(REDIS_CACHE_KEYS.aiContextOverviewIndexByUser('user-1')).toBe(
      'cache:v1:index:ai:context:overview:user:user-1',
    );
  });

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
