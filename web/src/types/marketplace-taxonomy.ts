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
	/** A lucide-react component name, resolved by the mega-menu at render time. */
	icon: string | null;
	position: number;
}

export interface MarketplaceCategoryNav extends MarketplaceCategory {
	subcategories: MarketplaceSubcategory[];
}

/** The third level: what a client actually searches for under a speciality. */
export interface MarketplaceTopic {
	id: string;
	slug: string;
	name: string;
	description: string | null;
	position: number;
}

export interface MarketplaceSubcategoryWithTopics
	extends MarketplaceSubcategory {
	topics: MarketplaceTopic[];
}

/**
 * A category page's payload. Distinct from `MarketplaceCategoryNav` by exactly
 * one thing — whether topics come along — and kept a separate type because the
 * mega-menu deliberately does not fetch them. One type carrying an optional
 * `topics` would claim navigation has them, where it would always be empty.
 */
export interface MarketplaceCategoryDetail extends MarketplaceCategory {
	subcategories: MarketplaceSubcategoryWithTopics[];
}

export interface MarketplaceTopicDetail extends MarketplaceTopic {
	category: MarketplaceCategory;
	subcategory: MarketplaceSubcategory;
	/** Topics beside this one, so an empty leaf offers a lateral move. */
	siblings: MarketplaceTopic[];
}

export interface MarketplaceSubcategoryDetail extends MarketplaceSubcategory {
	category: MarketplaceCategory;
	/** This speciality's own topics, for its browse row. */
	topics: MarketplaceTopic[];
	/**
	 * Siblings under the same category, so a leaf page with no consultants can
	 * still offer somewhere to go.
	 */
	siblings: MarketplaceSubcategory[];
}

/**
 * One entry in a consultant's declared expertise, as the public profile
 * endpoint returns it.
 *
 * Flattened to slugs and names rather than nested rows because the only thing
 * the profile does with it is render a chip that links to
 * `/marketplace/category/$categorySlug/$subcategorySlug`.
 */
export interface ConsultantExpertise {
	categorySlug: string;
	categoryName: string;
	subcategorySlug: string;
	subcategoryName: string;
	isPrimary: boolean;
}
