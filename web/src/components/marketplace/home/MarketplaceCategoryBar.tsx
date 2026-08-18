import { CategoryMegaMenuBar } from "@/components/marketplace/nav/CategoryMegaMenuBar";
import { useMarketplaceSurveyQuery } from "@/hooks/useMarketplaceSurvey";
import { useMarketplaceCategoryNavigationQuery } from "@/hooks/useMarketplaceTaxonomy";

/**
 * The category strip across the top of the marketplace.
 *
 * Categories are the curated `marketplace_categories` rows - a taxonomy of
 * consulting disciplines, distinct from `roadmap_template_categories`, which
 * classifies roadmap subjects. Each entry deep-links to its own category page
 * and reveals its sub-categories on hover.
 *
 * Categories the viewer named in the intake survey get a dot, and nothing more:
 * the strip shows the whole taxonomy in its editorial order to everybody.
 */
export function MarketplaceCategoryBar() {
	const { data: categories } = useMarketplaceCategoryNavigationQuery();
	const surveyQuery = useMarketplaceSurveyQuery();

	if (!categories?.length) return null;

	return (
		<CategoryMegaMenuBar
			categories={categories}
			highlightSlugs={surveyQuery.data?.categories?.map(
				(category) => category.slug,
			)}
		/>
	);
}
