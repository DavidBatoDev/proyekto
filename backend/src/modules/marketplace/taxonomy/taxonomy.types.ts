export interface MarketplaceSubcategory {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  position: number;
}

export interface MarketplaceCategory {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  icon: string | null;
  position: number;
}

export interface MarketplaceCategoryWithSubcategories extends MarketplaceCategory {
  subcategories: MarketplaceSubcategory[];
}

export interface MarketplaceSubcategoryWithCategory extends MarketplaceSubcategory {
  category: MarketplaceCategory;
  /**
   * The sub-category's siblings, so a leaf page with no consultants can still
   * offer a lateral move instead of dead-ending.
   */
  siblings: MarketplaceSubcategory[];
}

/**
 * One placement of a consultant in the curated taxonomy, flattened to the
 * slugs and names a chip needs.
 *
 * Defined here rather than in the consultants module because both read the
 * same `consultant_subcategories` rows — the public profile shows somebody
 * else's, the console shows your own — and consultants already depends on
 * taxonomy, so this is the direction that does not create a cycle.
 * `ConsultantExpertise` in consultants.service.ts is an alias of this.
 */
export interface ConsultantPlacement {
  categorySlug: string;
  categoryName: string;
  subcategorySlug: string;
  subcategoryName: string;
  isPrimary: boolean;
}
