import type {
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
}
