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

/**
 * The third level. A topic is what a client actually searches for -- "RAG
 * Systems", "Kubernetes" -- under the speciality that owns it.
 */
export interface MarketplaceTopic {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  position: number;
}

export interface MarketplaceSubcategoryWithTopics extends MarketplaceSubcategory {
  topics: MarketplaceTopic[];
}

/**
 * A category page's payload, distinct from the navigation payload above.
 *
 * The two differ by exactly one thing -- whether topics come along -- and they
 * stay separate types rather than one optional field because the mega-menu
 * deliberately does NOT fetch topics. A single type carrying `topics` would
 * claim navigation has them, and it would always be an empty array there.
 */
export interface MarketplaceCategoryDetail extends MarketplaceCategory {
  subcategories: MarketplaceSubcategoryWithTopics[];
}

export interface MarketplaceTopicWithParents extends MarketplaceTopic {
  category: MarketplaceCategory;
  subcategory: MarketplaceSubcategory;
  /** Topics beside this one, so an empty leaf offers a lateral move. */
  siblings: MarketplaceTopic[];
}

export interface MarketplaceSubcategoryWithCategory extends MarketplaceSubcategory {
  category: MarketplaceCategory;
  /** This speciality's own topics, for the leaf page's browse row. */
  topics: MarketplaceTopic[];
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

/**
 * One topic-level placement, carrying its whole path because a chip has to link
 * to `/marketplace/category/:cat/:sub/:topic` and nothing shorter resolves.
 */
export interface ConsultantTopicPlacement {
  categorySlug: string;
  categoryName: string;
  subcategorySlug: string;
  subcategoryName: string;
  topicSlug: string;
  topicName: string;
}
