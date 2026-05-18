export type CachePolicyMode = 'public' | 'private' | 'no-store';

export interface CachePolicyConfig {
  mode: CachePolicyMode;
  maxAgeSeconds?: number;
  sMaxAgeSeconds?: number;
  staleWhileRevalidateSeconds?: number;
  etag?: boolean;
}

function readNonNegativeIntegerEnv(
  name: string,
  fallback: number,
): number {
  const rawValue = process.env[name];
  if (!rawValue) return fallback;
  const parsedValue = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsedValue) || parsedValue < 0) {
    return fallback;
  }
  return parsedValue;
}

function normalizeSeconds(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  return Math.max(0, Math.floor(value));
}

export function buildCacheControlHeader(policy: CachePolicyConfig): string {
  if (policy.mode === 'no-store') return 'no-store';

  const maxAgeSeconds = normalizeSeconds(policy.maxAgeSeconds) ?? 0;
  const directives = [policy.mode, `max-age=${maxAgeSeconds}`];

  const sMaxAgeSeconds = normalizeSeconds(policy.sMaxAgeSeconds);
  if (policy.mode === 'public' && sMaxAgeSeconds !== undefined) {
    directives.push(`s-maxage=${sMaxAgeSeconds}`);
  }

  const staleWhileRevalidateSeconds = normalizeSeconds(
    policy.staleWhileRevalidateSeconds,
  );
  if (staleWhileRevalidateSeconds !== undefined) {
    directives.push(`stale-while-revalidate=${staleWhileRevalidateSeconds}`);
  }

  return directives.join(', ');
}

export const CACHE_POLICY_PRESETS: Readonly<{
  PUBLIC_EDGE_SHORT: CachePolicyConfig;
  PRIVATE_BROWSER_SHORT: CachePolicyConfig;
  NO_STORE: CachePolicyConfig;
}> = {
  PUBLIC_EDGE_SHORT: {
    mode: 'public',
    maxAgeSeconds: readNonNegativeIntegerEnv(
      'CACHE_PUBLIC_MAX_AGE_SECONDS',
      60,
    ),
    sMaxAgeSeconds: readNonNegativeIntegerEnv(
      'CACHE_PUBLIC_S_MAX_AGE_SECONDS',
      300,
    ),
    staleWhileRevalidateSeconds: readNonNegativeIntegerEnv(
      'CACHE_PUBLIC_STALE_WHILE_REVALIDATE_SECONDS',
      60,
    ),
    etag: true,
  },
  PRIVATE_BROWSER_SHORT: {
    mode: 'private',
    maxAgeSeconds: readNonNegativeIntegerEnv(
      'CACHE_PRIVATE_MAX_AGE_SECONDS',
      15,
    ),
    staleWhileRevalidateSeconds: readNonNegativeIntegerEnv(
      'CACHE_PRIVATE_STALE_WHILE_REVALIDATE_SECONDS',
      30,
    ),
    etag: true,
  },
  NO_STORE: {
    mode: 'no-store',
    etag: false,
  },
};
