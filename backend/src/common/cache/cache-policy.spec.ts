import {
  buildCacheControlHeader,
  type CachePolicyConfig,
} from './cache-policy';

describe('buildCacheControlHeader', () => {
  it('formats public cache directives', () => {
    const policy: CachePolicyConfig = {
      mode: 'public',
      maxAgeSeconds: 60,
      sMaxAgeSeconds: 300,
      staleWhileRevalidateSeconds: 30,
    };

    expect(buildCacheControlHeader(policy)).toBe(
      'public, max-age=60, s-maxage=300, stale-while-revalidate=30',
    );
  });

  it('formats no-store without extra directives', () => {
    expect(buildCacheControlHeader({ mode: 'no-store' })).toBe('no-store');
  });
});
