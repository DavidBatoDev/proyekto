import { CategoryMegaMenuBar } from "@/components/marketplace/nav/CategoryMegaMenuBar";
import { useMarketplaceCategoryNavigationQuery } from "@/hooks/useMarketplaceTaxonomy";

/**
 * The category strip across the top of the marketplace.
 *
 * Categories are the curated `marketplace_categories` rows - a taxonomy of
 * consulting disciplines, distinct from `roadmap_template_categories`, which
 * classifies roadmap subjects. Each entry deep-links to its own category page
 * and reveals its sub-categories on hover.
 */
export function MarketplaceCategoryBar() {
	const { data: categories } = useMarketplaceCategoryNavigationQuery();

	if (!categories?.length) return null;

	return <CategoryMegaMenuBar categories={categories} />;
}
