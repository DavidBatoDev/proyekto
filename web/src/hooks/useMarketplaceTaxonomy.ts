import { useQuery } from "@tanstack/react-query";
import {
	getMarketplaceCategory,
	getMarketplaceCategoryNavigation,
	getMarketplaceSubcategory,
	marketplaceTaxonomyKeys,
} from "@/queries/marketplaceTaxonomy";

/**
 * The taxonomy is editorial and only changes by migration, so it is held far
 * longer than ordinary server state. The mega-menu opens on hover and must
 * never wait on a request to render.
 */
const TAXONOMY_STALE_TIME = 1000 * 60 * 30;
const DETAIL_STALE_TIME = 1000 * 60 * 5;

export function useMarketplaceCategoryNavigationQuery() {
	return useQuery({
		queryKey: marketplaceTaxonomyKeys.navigation(),
		queryFn: getMarketplaceCategoryNavigation,
		staleTime: TAXONOMY_STALE_TIME,
	});
}

export function useMarketplaceCategoryQuery(categorySlug: string) {
	return useQuery({
		queryKey: marketplaceTaxonomyKeys.category(categorySlug),
		queryFn: () => getMarketplaceCategory(categorySlug),
		enabled: !!categorySlug,
		staleTime: DETAIL_STALE_TIME,
		retry: 1,
	});
}

export function useMarketplaceSubcategoryQuery(
	categorySlug: string,
	subcategorySlug: string,
) {
	return useQuery({
		queryKey: marketplaceTaxonomyKeys.subcategory(
			categorySlug,
			subcategorySlug,
		),
		queryFn: () => getMarketplaceSubcategory(categorySlug, subcategorySlug),
		enabled: !!categorySlug && !!subcategorySlug,
		staleTime: DETAIL_STALE_TIME,
		retry: 1,
	});
}
