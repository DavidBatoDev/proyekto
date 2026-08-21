import { Link } from "@tanstack/react-router";
import { ArrowRight, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import {
	useMarketplaceCategoryNavigationQuery,
	useMarketplaceCategoryQuery,
} from "@/hooks/useMarketplaceTaxonomy";
import { cn } from "@/lib/utils";

/** Enough to fill three rows without turning the section into a directory. */
const MAX_TOPICS = 9;

/**
 * What people actually get hired for, drawn from the live taxonomy.
 *
 * Every card is a real `marketplace_topics` row — 292 of them across 73
 * specialities — so this section needs no invented copy and stays correct as
 * the taxonomy is edited. That is the whole reason it is here rather than a
 * hand-written list of job titles.
 *
 * Two queries, matching what the API actually offers: `navigation` for the tabs
 * (already cached for 30 minutes and already fetched by the category bar, so
 * the tabs are usually free), and `/categories/:slug` per opened tab for the
 * topics, because the navigation payload deliberately omits them. TanStack
 * caches per slug, so re-opening a tab costs nothing.
 */
export function OpportunitiesByCategory() {
	const navigationQuery = useMarketplaceCategoryNavigationQuery();
	const categories = navigationQuery.data ?? [];
	const [activeSlug, setActiveSlug] = useState<string | null>(null);

	// Defaults to the first category once navigation lands, without an effect:
	// deriving avoids a render where the tabs are up and none is selected.
	const selected = activeSlug ?? categories[0]?.slug ?? null;
	const detailQuery = useMarketplaceCategoryQuery(selected ?? "");

	const topics = useMemo(() => {
		const subcategories = detailQuery.data?.subcategories ?? [];
		return subcategories
			.flatMap((subcategory) =>
				subcategory.topics.map((topic) => ({
					id: topic.id,
					name: topic.name,
					speciality: subcategory.name,
					subcategorySlug: subcategory.slug,
				})),
			)
			.slice(0, MAX_TOPICS);
	}, [detailQuery.data]);

	if (!navigationQuery.isPending && categories.length === 0) return null;

	return (
		<section className="mx-auto max-w-7xl px-4 pt-20 sm:px-6 lg:px-10 lg:pt-24">
			<h2 className="max-w-2xl text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
				Opportunities for every expert. Find yours.
			</h2>
			<p className="mt-3 max-w-2xl text-[15px] text-muted-foreground">
				These are the specialities clients brief against on Proyekto today.
			</p>

			{/* Horizontal scroll rather than a wrapping row: eight tabs that reflow
			    to two lines push the cards below the fold on a laptop. */}
			<div className="mt-8 -mx-4 overflow-x-auto px-4 hide-scrollbar sm:mx-0 sm:px-0">
				<div className="flex min-w-max gap-1 border-b border-border">
					{categories.map((category) => {
						const isActive = category.slug === selected;
						return (
							<button
								key={category.slug}
								type="button"
								onClick={() => setActiveSlug(category.slug)}
								aria-pressed={isActive}
								className={cn(
									"whitespace-nowrap border-b-2 px-3 py-2.5 text-[13px] font-medium transition-colors",
									isActive
										? "border-foreground text-foreground"
										: "border-transparent text-muted-foreground hover:text-foreground",
								)}
							>
								{category.name}
							</button>
						);
					})}
				</div>
			</div>

			<div className="mt-6 min-h-[18rem]">
				{detailQuery.isPending ? (
					<div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
						<Loader2 className="h-4 w-4 animate-spin" />
						Loading specialities…
					</div>
				) : (
					<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
						{topics.map((topic) => (
							<Link
								key={topic.id}
								to="/marketplace/category/$categorySlug/$subcategorySlug"
								params={{
									categorySlug: selected ?? "",
									subcategorySlug: topic.subcategorySlug,
								}}
								className="group rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/50"
							>
								<p className="text-[15px] font-semibold text-foreground">
									{topic.name}
								</p>
								<p className="mt-1 text-[13px] text-muted-foreground">
									{topic.speciality}
								</p>
								<span className="mt-3 inline-flex items-center gap-1 text-[13px] font-medium text-primary">
									See the work
									<ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
								</span>
							</Link>
						))}
					</div>
				)}
			</div>
		</section>
	);
}
