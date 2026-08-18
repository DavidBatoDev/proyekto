export {
	getMarketplaceCategory,
	getMarketplaceCategoryNavigation,
	getMarketplaceSubcategory,
} from "@/api/endpoints/marketplace-taxonomy";

/**
 * Query key factory, shaped like `consultantKeys` so the two read the same way
 * at call sites.
 */
export const marketplaceTaxonomyKeys = {
	all: ["marketplace-taxonomy"] as const,
	navigation: () => [...marketplaceTaxonomyKeys.all, "navigation"] as const,
	category: (categorySlug: string) =>
		[...marketplaceTaxonomyKeys.all, "category", categorySlug] as const,
	subcategory: (categorySlug: string, subcategorySlug: string) =>
		[
			...marketplaceTaxonomyKeys.all,
			"subcategory",
			categorySlug,
			subcategorySlug,
		] as const,
};
