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
  ConsultantTopicPlacement,
  MarketplaceCategoryDetail,
  MarketplaceCategoryWithSubcategories,
  MarketplaceSubcategoryWithCategory,
  MarketplaceTopicWithParents,
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
  ): Promise<MarketplaceCategoryDetail> {
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

  async topic(
    categorySlug: string,
    subcategorySlug: string,
    topicSlug: string,
    options?: CacheOptions,
  ): Promise<MarketplaceTopicWithParents> {
    const topic = await this.cache.rememberJson(
      REDIS_CACHE_KEYS.marketplaceTaxonomyTopic(
        categorySlug,
        subcategorySlug,
        topicSlug,
      ),
      this.cache.getPublicTtlSeconds(),
      () =>
        this.repo.findTopicBySlugs(categorySlug, subcategorySlug, topicSlug),
      {
        onStatus: options?.onCacheStatus,
        indexKey: REDIS_CACHE_KEYS.marketplaceTaxonomyIndex,
      },
    );

    if (!topic) throw new NotFoundException('Topic not found');
    return topic;
  }

  /**
   * Resolves a full slug path to topic ids for the consultant listing. Same
   * null-vs-empty contract as `resolveSubcategoryIds`.
   */
  resolveTopicIds(
    categorySlug: string | undefined,
    subcategorySlug: string | undefined,
    topicSlug: string | undefined,
  ): Promise<string[] | null> {
    return this.repo.findTopicIds(categorySlug, subcategorySlug, topicSlug);
  }

  /** A consultant's own topic placements. Uncached, like the speciality read. */
  listMyTopics(userId: string): Promise<ConsultantTopicPlacement[]> {
    return this.repo.findConsultantTopics(userId);
  }

  async replaceMyTopics(
    userId: string,
    topicIds: string[],
  ): Promise<ConsultantTopicPlacement[]> {
    // De-duplicated for the same reason the speciality replace is: the delete
    // has already happened by the time a duplicate trips the composite primary
    // key, which would leave the consultant with a partially-written set.
    const unique = Array.from(new Set(topicIds));

    const placements = await this.repo.replaceConsultantTopics(userId, unique);

    await this.cacheInvalidation.invalidateConsultantsCache(userId);
    return placements;
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
