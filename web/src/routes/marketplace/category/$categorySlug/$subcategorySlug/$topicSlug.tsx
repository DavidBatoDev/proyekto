import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { CategoryEmptyState } from "@/components/marketplace/category/CategoryEmptyState";
import { ConsultantDirectoryGrid } from "@/components/marketplace/category/ConsultantDirectoryGrid";
import { useMarketplaceTopicQuery } from "@/hooks/useMarketplaceTaxonomy";
import { mapRetiredCategorySlug } from "@/lib/marketplaceCategoryRedirects";

export const Route = createFileRoute(
	"/marketplace/category/$categorySlug/$subcategorySlug/$topicSlug",
)({
	// Only the first segment ever moved in the category merge; speciality and
	// topic slugs are untouched.
	beforeLoad: ({ params }) => {
		const merged = mapRetiredCategorySlug(params.categorySlug);
		if (merged) {
			throw redirect({
				to: "/marketplace/category/$categorySlug/$subcategorySlug/$topicSlug",
				params: {
					categorySlug: merged,
					subcategorySlug: params.subcategorySlug,
					topicSlug: params.topicSlug,
				},
				replace: true,
			});
		}
	},
	component: MarketplaceTopicPage,
});

/**
 * The deepest leaf: consultants who declared THIS topic.
 *
 * Not the parent speciality's list under a topic heading. `consultant_topics`
 * is its own table and the directory filters on it, so an empty page here means
 * nobody has claimed the topic — which is true, rather than a roster implying
 * expertise nobody declared.
 */
function MarketplaceTopicPage() {
	const { categorySlug, subcategorySlug, topicSlug } = Route.useParams();
	const topicQuery = useMarketplaceTopicQuery(
		categorySlug,
		subcategorySlug,
		topicSlug,
	);
	const topic = topicQuery.data;

	if (topicQuery.isError) {
		return (
			<main className="mx-auto max-w-7xl px-4 py-16 text-center sm:px-6 lg:px-8">
				<h1 className="text-[20px] font-semibold text-foreground">
					Topic not found
				</h1>
				<p className="mt-1.5 text-[13px] text-muted-foreground">
					That topic does not exist under this speciality.
				</p>
				<Link
					to="/marketplace/category/$categorySlug/$subcategorySlug"
					params={{ categorySlug, subcategorySlug }}
					className="mt-5 inline-block rounded-xl bg-foreground px-4 py-2 text-[13px] font-bold text-background"
				>
					Back to the speciality
				</Link>
			</main>
		);
	}

	return (
		<main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
			<nav aria-label="Breadcrumb">
				<ol className="flex flex-wrap items-center gap-1 text-[12.5px] text-muted-foreground">
					<li>
						<Link to="/marketplace" className="hover:text-foreground">
							Marketplace
						</Link>
					</li>
					<ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
					<li>
						<Link
							to="/marketplace/category/$categorySlug"
							params={{ categorySlug }}
							className="hover:text-foreground"
						>
							{topic?.category.name ?? categorySlug}
						</Link>
					</li>
					<ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
					<li>
						<Link
							to="/marketplace/category/$categorySlug/$subcategorySlug"
							params={{ categorySlug, subcategorySlug }}
							className="hover:text-foreground"
						>
							{topic?.subcategory.name ?? subcategorySlug}
						</Link>
					</li>
				</ol>
			</nav>

			<header className="mt-3">
				<h1 className="text-[24px] font-semibold tracking-tight text-foreground">
					{topic?.name ?? "Loading…"}
				</h1>
				{topic?.description && (
					<p className="mt-1 max-w-2xl text-[14px] text-muted-foreground">
						{topic.description}
					</p>
				)}
			</header>

			<section className="mt-8">
				<ConsultantDirectoryGrid
					params={{
						category: categorySlug,
						subcategory: subcategorySlug,
						topic: topicSlug,
					}}
					emptyState={
						<CategoryEmptyState label={topic?.name ?? "this topic"} />
					}
				/>
			</section>

			{/*
			 * Siblings matter most exactly when the list above is empty, which at a
			 * topic's depth is the common case: without them the deepest page in
			 * the taxonomy is also the easiest one to get stuck on.
			 */}
			{topic && topic.siblings.length > 0 && (
				<section className="mt-10">
					<h2 className="text-[13px] font-semibold text-foreground">
						More in {topic.subcategory.name}
					</h2>
					<ul className="mt-3 flex flex-wrap gap-2">
						{topic.siblings.map((sibling) => (
							<li key={sibling.id}>
								<Link
									to="/marketplace/category/$categorySlug/$subcategorySlug/$topicSlug"
									params={{
										categorySlug,
										subcategorySlug,
										topicSlug: sibling.slug,
									}}
									preload="intent"
									className="inline-block rounded-full border border-border px-3 py-1.5 text-[12.5px] text-foreground transition-colors hover:border-foreground/40 hover:bg-muted"
								>
									{sibling.name}
								</Link>
							</li>
						))}
					</ul>
				</section>
			)}
		</main>
	);
}
