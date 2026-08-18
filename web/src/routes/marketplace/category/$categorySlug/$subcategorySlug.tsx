import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { CategoryEmptyState } from "@/components/marketplace/category/CategoryEmptyState";
import { ConsultantDirectoryGrid } from "@/components/marketplace/category/ConsultantDirectoryGrid";
import { useMarketplaceSubcategoryQuery } from "@/hooks/useMarketplaceTaxonomy";
import { mapRetiredCategorySlug } from "@/lib/marketplaceCategoryRedirects";

export const Route = createFileRoute(
	"/marketplace/category/$categorySlug/$subcategorySlug",
)({
	// Sub-category slugs survived the merge untouched, so only the first
	// segment moves.
	beforeLoad: ({ params }) => {
		const merged = mapRetiredCategorySlug(params.categorySlug);
		if (merged) {
			throw redirect({
				to: "/marketplace/category/$categorySlug/$subcategorySlug",
				params: {
					categorySlug: merged,
					subcategorySlug: params.subcategorySlug,
				},
				replace: true,
			});
		}
	},
	component: MarketplaceSubcategoryPage,
});

function MarketplaceSubcategoryPage() {
	const { categorySlug, subcategorySlug } = Route.useParams();
	const subcategoryQuery = useMarketplaceSubcategoryQuery(
		categorySlug,
		subcategorySlug,
	);
	const subcategory = subcategoryQuery.data;

	if (subcategoryQuery.isError) {
		return (
			<main className="mx-auto max-w-7xl px-4 py-16 text-center sm:px-6 lg:px-8">
				<h1 className="text-[20px] font-semibold text-foreground">
					Speciality not found
				</h1>
				<p className="mt-1.5 text-[13px] text-muted-foreground">
					That speciality does not exist under this category.
				</p>
				<Link
					to="/marketplace/category/$categorySlug"
					params={{ categorySlug }}
					className="mt-5 inline-block rounded-xl bg-foreground px-4 py-2 text-[13px] font-bold text-background"
				>
					Back to the category
				</Link>
			</main>
		);
	}

	return (
		<main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
			<nav aria-label="Breadcrumb">
				<ol className="flex items-center gap-1 text-[12.5px] text-muted-foreground">
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
							{subcategory?.category.name ?? categorySlug}
						</Link>
					</li>
				</ol>
			</nav>

			<header className="mt-3">
				<h1 className="text-[24px] font-semibold tracking-tight text-foreground">
					{subcategory?.name ?? "Loading…"}
				</h1>
				{subcategory?.description && (
					<p className="mt-1 max-w-2xl text-[14px] text-muted-foreground">
						{subcategory.description}
					</p>
				)}
			</header>

			<section className="mt-8">
				<ConsultantDirectoryGrid
					params={{ category: categorySlug, subcategory: subcategorySlug }}
					emptyState={
						<CategoryEmptyState
							label={subcategory?.name ?? "this speciality"}
						/>
					}
				/>
			</section>

			{/*
			 * Siblings matter most exactly when the list above is empty: without
			 * them a resultless leaf is a dead end, and going back is the only
			 * move left.
			 */}
			{subcategory && subcategory.siblings.length > 0 && (
				<section className="mt-10">
					<h2 className="text-[13px] font-semibold text-foreground">
						Related in {subcategory.category.name}
					</h2>
					<ul className="mt-3 flex flex-wrap gap-2">
						{subcategory.siblings.map((sibling) => (
							<li key={sibling.id}>
								<Link
									to="/marketplace/category/$categorySlug/$subcategorySlug"
									params={{
										categorySlug,
										subcategorySlug: sibling.slug,
									}}
									preload="intent"
									className="inline-block rounded-full border border-border bg-card px-3 py-1.5 text-[12.5px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
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
