import type {
  ConsultantPlacement,
  MarketplaceCategoryWithSubcategories,
  MarketplaceSubcategoryWithCategory,
} from '../taxonomy.types';

export const TAXONOMY_REPOSITORY = Symbol('TAXONOMY_REPOSITORY');

export interface TaxonomyRepository {
  /**
   * Every active category with its active sub-categories nested, ordered by
   * `position`. One call backs the whole mega-menu.
   */
  findNavigation(): Promise<MarketplaceCategoryWithSubcategories[]>;

  findCategoryBySlug(
    slug: string,
  ): Promise<MarketplaceCategoryWithSubcategories | null>;

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
