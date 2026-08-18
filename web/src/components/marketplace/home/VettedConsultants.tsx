import { Link } from "@tanstack/react-router";
import {
	CONSULTANT_CARD_SKELETON_CLASS,
	ConsultantCard,
} from "@/components/marketplace/ConsultantCard";
import {
	useConsultantDirectoryQuery,
	useConsultantsQuery,
} from "@/hooks/useConsultants";
import { useMarketplaceSurveyQuery } from "@/hooks/useMarketplaceSurvey";

/**
 * Verified consultants, straight from the public `/api/consultants` endpoint,
 * which already filters to `consultant_profiles.status = 'verified'`.
 *
 * When the viewer named a category in the intake survey, this narrows to it via
 * `/api/consultants/directory?category=`, and says so in the heading rather
 * than silently showing a shorter list.
 *
 * The fallback is not defensive polish — it is the common path. There are four
 * verified consultants and barely any taxonomy placements, so a category filter
 * returning nothing is the expected case today, and an empty strip would be a
 * worse storefront than an unfiltered one.
 */
export function VettedConsultants() {
	const surveyQuery = useMarketplaceSurveyQuery();
	const leadCategory = surveyQuery.data?.categories?.[0];

	const categoryQuery = useConsultantDirectoryQuery(
		{ category: leadCategory?.slug, limit: 4 },
		{ enabled: Boolean(leadCategory) },
	);

	const categoryItems = leadCategory ? (categoryQuery.data?.items ?? []) : [];
	const filtered = categoryItems.length > 0;

	/**
	 * Settled either way — success OR failure.
	 *
	 * Gating the fallback on `isSuccess` alone was wrong and shipped a stuck
	 * section: when the directory endpoint 500s, `isSuccess` never becomes true,
	 * so the fallback query stayed disabled and the strip rendered skeletons
	 * forever. A category filter is a personalization nicety on top of a list
	 * that works without it, so anything other than "the filter produced
	 * results" has to end up showing the unfiltered list.
	 */
	const categorySettled = categoryQuery.isSuccess || categoryQuery.isError;

	// Held back until the filtered read is known not to be usable, so the common
	// case is one request rather than two.
	const needsFallback =
		!leadCategory || (categorySettled && categoryItems.length === 0);
	const allQuery = useConsultantsQuery({ enabled: needsFallback });

	const items = filtered
		? categoryItems.slice(0, 4)
		: (allQuery.data?.slice(0, 4) ?? []);
	const isPending = leadCategory
		? !categorySettled || (needsFallback && allQuery.isPending)
		: allQuery.isPending;

	if (!isPending && items.length === 0) return null;

	return (
		<section className="mx-auto max-w-7xl px-4 pt-10 sm:px-6 lg:px-8">
			<div className="flex items-end justify-between gap-4">
				<div>
					<h2 className="text-[17px] font-semibold text-foreground">
						{filtered
							? `Consultants in ${leadCategory?.name}`
							: "Vetted consultants"}
					</h2>
					<p className="mt-0.5 text-[13px] text-muted-foreground">
						Every one reviewed and verified before they can take work.
					</p>
				</div>
				<Link
					to="/marketplace/consultant/browse"
					className="shrink-0 text-[13px] font-medium text-primary hover:underline"
				>
					See all
				</Link>
			</div>

			<div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
				{isPending
					? Array.from({ length: 4 }, (_, index) => (
							<div
								key={`consultant-skeleton-${index}`}
								className={CONSULTANT_CARD_SKELETON_CLASS}
							/>
						))
					: items.map((consultant) => (
							<ConsultantCard key={consultant.id} consultant={consultant} />
						))}
			</div>
		</section>
	);
}
