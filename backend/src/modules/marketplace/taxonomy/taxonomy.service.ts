import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  AppCacheStatus,
  RedisDataCacheService,
} from '../../../common/cache/redis-data-cache.service';
import { REDIS_CACHE_KEYS } from '../../../common/cache/redis-cache.keys';
import { RedisCacheInvalidationService } from '../../../common/cache/redis-cache-invalidation.service';
import {
  TAXONOMY_REPOSITORY,
  type TaxonomyRepository,
} from './repositories/taxonomy.repository.interface';
import type {
  ConsultantPlacement,
  MarketplaceCategoryWithSubcategories,
  MarketplaceSubcategoryWithCategory,
} from './taxonomy.types';

type CacheOptions = { onCacheStatus?: (status: AppCacheStatus) => void };

@Injectable()
export class TaxonomyService {
  constructor(
    @Inject(TAXONOMY_REPOSITORY) private readonly repo: TaxonomyRepository,
    private readonly cache: RedisDataCacheService,
    private readonly cacheInvalidation: RedisCacheInvalidationService,
  ) {}

  async navigation(
    options?: CacheOptions,
  ): Promise<{ items: MarketplaceCategoryWithSubcategories[] }> {
    return this.cache.rememberJson(
      REDIS_CACHE_KEYS.marketplaceTaxonomyNavigation,
      this.cache.getPublicTtlSeconds(),
      async () => ({ items: await this.repo.findNavigation() }),
      {
        onStatus: options?.onCacheStatus,
        indexKey: REDIS_CACHE_KEYS.marketplaceTaxonomyIndex,
      },
    );
  }

  async category(
    categorySlug: string,
    options?: CacheOptions,
  ): Promise<MarketplaceCategoryWithSubcategories> {
    const category = await this.cache.rememberJson(
      REDIS_CACHE_KEYS.marketplaceTaxonomyCategory(categorySlug),
      this.cache.getPublicTtlSeconds(),
      () => this.repo.findCategoryBySlug(categorySlug),
      {
        onStatus: options?.onCacheStatus,
        indexKey: REDIS_CACHE_KEYS.marketplaceTaxonomyIndex,
      },
    );

    if (!category) throw new NotFoundException('Category not found');
    return category;
  }

  async subcategory(
    categorySlug: string,
    subcategorySlug: string,
    options?: CacheOptions,
  ): Promise<MarketplaceSubcategoryWithCategory> {
    const subcategory = await this.cache.rememberJson(
      REDIS_CACHE_KEYS.marketplaceTaxonomySubcategory(
        categorySlug,
        subcategorySlug,
      ),
      this.cache.getPublicTtlSeconds(),
      () => this.repo.findSubcategoryBySlugs(categorySlug, subcategorySlug),
      {
        onStatus: options?.onCacheStatus,
        indexKey: REDIS_CACHE_KEYS.marketplaceTaxonomyIndex,
      },
    );

    if (!subcategory) throw new NotFoundException('Subcategory not found');
    return subcategory;
  }

  /**
   * Resolves category/sub-category slugs to the sub-category ids a consultant
   * listing filters on. `null` means the slugs did not resolve; an empty array
   * means they resolved to a category that has no active sub-categories.
   */
  resolveSubcategoryIds(
    categorySlug: string | undefined,
    subcategorySlug: string | undefined,
  ): Promise<string[] | null> {
    return this.repo.findSubcategoryIds(categorySlug, subcategorySlug);
  }

  /** A consultant's own placements. Uncached: it is a per-user editor read. */
  listMyPlacements(userId: string): Promise<ConsultantPlacement[]> {
    return this.repo.findConsultantSubcategories(userId);
  }

  async replaceMyPlacements(
    userId: string,
    subcategoryIds: string[],
  ): Promise<ConsultantPlacement[]> {
    // Duplicates would trip the composite primary key mid-insert and leave the
    // consultant with a partially-written set, since the delete has already
    // happened. De-duplicating here keeps that impossible.
    const unique = Array.from(new Set(subcategoryIds));

    const placements = await this.repo.replaceConsultantSubcategories(
      userId,
      unique,
    );

    // The directory is category-filtered and the public profile renders these
    // chips, so both must be purged. `invalidateConsultantsCache` clears the
    // consultants index as well as the profile key, which covers the category
    // landing pages without a second call.
    await this.cacheInvalidation.invalidateConsultantsCache(userId);
    return placements;
  }
}
