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
