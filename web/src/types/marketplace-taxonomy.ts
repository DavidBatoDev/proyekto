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
