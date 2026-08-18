import type {
  ConsultantPlacement,
  ConsultantTopicPlacement,
  MarketplaceCategoryDetail,
  MarketplaceCategoryWithSubcategories,
  MarketplaceSubcategoryWithCategory,
  MarketplaceTopicWithParents,
} from '../taxonomy.types';

export const TAXONOMY_REPOSITORY = Symbol('TAXONOMY_REPOSITORY');

export interface TaxonomyRepository {
  /**
   * Every active category with its active sub-categories nested, ordered by
   * `position`. One call backs the whole mega-menu.
   */
  findNavigation(): Promise<MarketplaceCategoryWithSubcategories[]>;

  /**
   * One category with its sub-categories AND their topics. Deliberately a
   * richer shape than `findNavigation` returns: the category page needs all
   * three levels in one round trip, the mega-menu needs two and must not pay
   * for the third.
   */
  findCategoryBySlug(slug: string): Promise<MarketplaceCategoryDetail | null>;

  findSubcategoryBySlugs(
    categorySlug: string,
    subcategorySlug: string,
  ): Promise<MarketplaceSubcategoryWithCategory | null>;

  /**
   * Resolves a category (and optionally one sub-category within it) to the
   * sub-category ids a consultant listing should filter on. Returns null when
   * the slugs do not resolve, which the caller turns into a 404.
   */
  findSubcategoryIds(
    categorySlug: string | undefined,
    subcategorySlug: string | undefined,
  ): Promise<string[] | null>;

  /**
   * Resolves category slugs to ids, keyed by slug. Slugs missing from the map
   * did not resolve — inactive or simply wrong — which the caller turns into a
   * 400 naming the offender rather than dropping it silently.
   *
   * Separate from `findSubcategoryIds` because that one answers "which
   * sub-categories should this listing filter on" and collapses a category to
   * its children; this one is a plain lookup that keeps the top level.
   */
  findCategoryIdsBySlugs(slugs: string[]): Promise<Map<string, string>>;

  findTopicBySlugs(
    categorySlug: string,
    subcategorySlug: string,
    topicSlug: string,
  ): Promise<MarketplaceTopicWithParents | null>;

  /**
   * Resolves a full slug path to the topic ids a consultant listing should
   * filter on. Same null-vs-empty contract as `findSubcategoryIds`: null means
   * "do not constrain by topic", never "nothing matched".
   */
  findTopicIds(
    categorySlug: string | undefined,
    subcategorySlug: string | undefined,
    topicSlug: string | undefined,
  ): Promise<string[] | null>;

  /** A consultant's own topic placements, each carrying its whole path. */
  findConsultantTopics(userId: string): Promise<ConsultantTopicPlacement[]>;

  replaceConsultantTopics(
    userId: string,
    topicIds: string[],
  ): Promise<ConsultantTopicPlacement[]>;

  /** A consultant's own placements, with enough context to render chips. */
  findConsultantSubcategories(userId: string): Promise<ConsultantPlacement[]>;

  /**
   * Full replace, in one round trip per side. Replace rather than add/remove
   * because the editor is a multi-select that already knows the whole intended
   * set; a diffing API would invent an ordering problem for no gain.
   */
  replaceConsultantSubcategories(
    userId: string,
    subcategoryIds: string[],
  ): Promise<ConsultantPlacement[]>;
}
