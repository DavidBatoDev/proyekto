import { createHash } from 'crypto';

export const REDIS_CACHE_KEYS = {
  consultantsList: 'cache:v1:consultants:list',
  consultantsProfile: (userId: string) =>
    `cache:v1:consultants:profile:${userId}`,
  consultantsDirectoryByHash: (queryHash: string) =>
    `cache:v1:consultants:directory:${queryHash}`,
  consultantsFacets: 'cache:v1:consultants:facets',
  consultantsIndex: 'cache:v1:index:consultants',
  marketplaceTaxonomyNavigation: 'cache:v1:marketplace:taxonomy:navigation',
  marketplaceTaxonomyCategory: (slug: string) =>
    `cache:v1:marketplace:taxonomy:category:${slug.toLowerCase()}`,
  marketplaceTaxonomySubcategory: (
    categorySlug: string,
    subcategorySlug: string,
  ) =>
    `cache:v1:marketplace:taxonomy:subcategory:${categorySlug.toLowerCase()}:${subcategorySlug.toLowerCase()}`,
  marketplaceTaxonomyTopic: (
    categorySlug: string,
    subcategorySlug: string,
    topicSlug: string,
  ) =>
    `cache:v1:marketplace:taxonomy:topic:${categorySlug.toLowerCase()}:${subcategorySlug.toLowerCase()}:${topicSlug.toLowerCase()}`,
  marketplaceTaxonomyIndex: 'cache:v1:index:marketplace:taxonomy',
  roadmapTemplatesByHash: (queryHash: string) =>
    `cache:v3:roadmap-templates:catalog:${queryHash}`,
  roadmapTemplatesFeatured: 'cache:v3:roadmap-templates:featured',
  roadmapTemplateDetail: (slug: string) =>
    `cache:v3:roadmap-templates:detail:${slug.toLowerCase()}`,
  roadmapTemplatesIndex: 'cache:v3:index:roadmap-templates',
  projectsDashboardByUser: (userId: string) =>
    `cache:v1:projects:dashboard:user:${userId}`,
  projectsDashboardIndex: 'cache:v1:index:projects:dashboard',
  profileAppearanceByUser: (userId: string) =>
    `cache:v1:profiles:appearance:user:${userId}`,
  profileAppearanceIndex: 'cache:v1:index:profiles:appearance',
  marketplaceTalentByHash: (queryHash: string) =>
    `cache:v1:marketplace:talent:${queryHash}`,
  marketplaceTalentIndex: 'cache:v1:index:marketplace:talent',
  talentProfile: (userId: string) => `cache:v1:talent:profile:${userId}`,
  /**
   * `GET /api/ai/context/overview`, one entry per (user, requested workspace).
   * Every variant is also recorded in the per-user index so a dashboard
   * invalidation can drop them all without enumerating workspaces.
   */
  aiContextOverviewByUser: (userId: string, workspaceId: string | null) =>
    `cache:v1:ai:context:overview:user:${userId}:ws:${workspaceId ?? 'none'}`,
  aiContextOverviewIndexByUser: (userId: string) =>
    `cache:v1:index:ai:context:overview:user:${userId}`,
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

export function buildMarketplaceTalentCacheKey(
  query: MarketplaceQueryShape | null | undefined,
): string {
  const normalizedQuery = normalizeMarketplaceQuery(query);
  const hash = hashNormalizedQuery(normalizedQuery);
  return REDIS_CACHE_KEYS.marketplaceTalentByHash(hash);
}
