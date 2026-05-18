import {
  buildWeakEtag,
  ifNoneMatchMatchesEtag,
} from './cache-policy.interceptor';

describe('CachePolicyInterceptor helpers', () => {
  it('builds deterministic weak etags for equivalent payloads', () => {
    const first = buildWeakEtag({ data: { id: 1, name: 'Cache test' } });
    const second = buildWeakEtag({ data: { id: 1, name: 'Cache test' } });
    expect(first).toBe(second);
    expect(first.startsWith('W/"')).toBe(true);
  });

  it('matches If-None-Match headers with weak/strong variants', () => {
    const etag = 'W/"abc123"';
    expect(ifNoneMatchMatchesEtag(etag, etag)).toBe(true);
    expect(ifNoneMatchMatchesEtag('"abc123"', etag)).toBe(true);
    expect(ifNoneMatchMatchesEtag('W/"abc123", "other"', etag)).toBe(true);
    expect(ifNoneMatchMatchesEtag('*', etag)).toBe(true);
    expect(ifNoneMatchMatchesEtag('"different"', etag)).toBe(false);
  });
});
