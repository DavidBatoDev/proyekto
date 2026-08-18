import type {
	MarketplaceCategoryDetail,
	MarketplaceCategoryNav,
	MarketplaceSubcategoryDetail,
	MarketplaceTopicDetail,
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

/**
 * One category with its specialities AND their topics — the three levels the
 * category page tiles. Richer than the navigation payload on purpose.
 */
export async function getMarketplaceCategory(categorySlug: string) {
	const response = await apiClient.get<ApiResponse<MarketplaceCategoryDetail>>(
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

export async function getMarketplaceTopic(
	categorySlug: string,
	subcategorySlug: string,
	topicSlug: string,
) {
	const response = await apiClient.get<ApiResponse<MarketplaceTopicDetail>>(
		`/api/marketplace/categories/${categorySlug}/${subcategorySlug}/${topicSlug}`,
	);
	return response.data.data;
}
