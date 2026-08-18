import type {
	MarketplaceCategoryNav,
	MarketplaceSubcategoryDetail,
} from "@/types/marketplace-taxonomy";
import apiClient from "../axios";

type ApiResponse<T> = { data: T };

/**
 * The whole mega-menu in one request: every active category with its active
 * sub-categories nested and ordered.
 */
export async function getMarketplaceCategoryNavigation() {
	const response = await apiClient.get<
		ApiResponse<{ items: MarketplaceCategoryNav[] }>
	>("/api/marketplace/categories/navigation");
	return response.data.data.items;
}

export async function getMarketplaceCategory(categorySlug: string) {
	const response = await apiClient.get<ApiResponse<MarketplaceCategoryNav>>(
		`/api/marketplace/categories/${categorySlug}`,
	);
	return response.data.data;
}

export async function getMarketplaceSubcategory(
	categorySlug: string,
	subcategorySlug: string,
) {
	const response = await apiClient.get<
		ApiResponse<MarketplaceSubcategoryDetail>
	>(`/api/marketplace/categories/${categorySlug}/${subcategorySlug}`);
	return response.data.data;
}
