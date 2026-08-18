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

export interface MarketplaceSubcategoryDetail extends MarketplaceSubcategory {
	category: MarketplaceCategory;
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
