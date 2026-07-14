import { createHash } from 'crypto';

export const REDIS_CACHE_KEYS = {
  consultantsList: 'cache:v1:consultants:list',
  consultantsProfile: (userId: string) =>
    `cache:v1:consultants:profile:${userId}`,
  roadmapTemplatesByHash: (queryHash: string) =>
    `cache:v2:roadmap-templates:catalog:${queryHash}`,
  roadmapTemplateDetail: (slug: string) =>
    `cache:v2:roadmap-templates:detail:${slug.toLowerCase()}`,
  roadmapTemplatesIndex: 'cache:v2:index:roadmap-templates',
  projectsDashboardByUser: (userId: string) =>
    `cache:v1:projects:dashboard:user:${userId}`,
  projectsDashboardIndex: 'cache:v1:index:projects:dashboard',
  marketplaceFreelancersByHash: (queryHash: string) =>
    `cache:v1:marketplace:freelancers:${queryHash}`,
  marketplaceFreelancersIndex: 'cache:v1:index:marketplace:freelancers',
} as const;

type MarketplaceQueryShape = {
  search?: string;
  availability?: string;
  specialization?: string;
  skill?: string;
  sort?: string;
  minRate?: number;
  maxRate?: number;
};

function normalizeText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export function normalizeMarketplaceQuery(
  query: MarketplaceQueryShape | null | undefined,
): Record<string, string | number> {
  const normalized: Record<string, string | number> = {};
  if (!query) return normalized;

  const textFields: Array<keyof MarketplaceQueryShape> = [
    'search',
    'availability',
    'specialization',
    'skill',
    'sort',
  ];

  for (const field of textFields) {
    const value = normalizeText(query[field]);
    if (value !== undefined) {
      normalized[field] = value;
    }
  }

  const minRate = normalizeNumber(query.minRate);
  if (minRate !== undefined) normalized.minRate = minRate;
  const maxRate = normalizeNumber(query.maxRate);
  if (maxRate !== undefined) normalized.maxRate = maxRate;

  return normalized;
}

export function hashNormalizedQuery(
  normalizedQuery: Record<string, unknown>,
): string {
  const sorted = Object.entries(normalizedQuery).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const serialized = JSON.stringify(Object.fromEntries(sorted));
  return createHash('sha1').update(serialized).digest('hex');
}

export function buildMarketplaceFreelancersCacheKey(
  query: MarketplaceQueryShape | null | undefined,
): string {
  const normalizedQuery = normalizeMarketplaceQuery(query);
  const hash = hashNormalizedQuery(normalizedQuery);
  return REDIS_CACHE_KEYS.marketplaceFreelancersByHash(hash);
}
