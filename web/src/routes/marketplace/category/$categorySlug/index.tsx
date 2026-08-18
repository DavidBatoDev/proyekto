import { createFileRoute, Link } from "@tanstack/react-router";
import { CategoryEmptyState } from "@/components/marketplace/category/CategoryEmptyState";
import { ConsultantDirectoryGrid } from "@/components/marketplace/category/ConsultantDirectoryGrid";
import { useMarketplaceCategoryQuery } from "@/hooks/useMarketplaceTaxonomy";

export const Route = createFileRoute("/marketplace/category/$categorySlug/")({
	component: MarketplaceCategoryPage,
});

function MarketplaceCategoryPage() {
	const { categorySlug } = Route.useParams();
	const categoryQuery = useMarketplaceCategoryQuery(categorySlug);
	const category = categoryQuery.data;

	if (categoryQuery.isError) {
		return (
			<main className="mx-auto max-w-7xl px-4 py-16 text-center sm:px-6 lg:px-8">
				<h1 className="text-[20px] font-semibold text-foreground">
					Category not found
				</h1>
				<p className="mt-1.5 text-[13px] text-muted-foreground">
					That category does not exist, or is no longer listed.
				</p>
				<Link
					to="/marketplace"
					className="mt-5 inline-block rounded-xl bg-foreground px-4 py-2 text-[13px] font-bold text-background"
				>
					Back to the marketplace
				</Link>
			</main>
		);
	}

	return (
		<main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
			<header>
				<h1 className="text-[24px] font-semibold tracking-tight text-foreground">
					{category?.name ?? "Loading…"}
				</h1>
				{category?.description && (
					<p className="mt-1 max-w-2xl text-[14px] text-muted-foreground">
						{category.description}
					</p>
				)}
			</header>

			{category && category.subcategories.length > 0 && (
				<nav aria-label={`${category.name} specialities`} className="mt-5">
					<ul className="flex flex-wrap gap-2">
						{category.subcategories.map((subcategory) => (
							<li key={subcategory.id}>
								<Link
									to="/marketplace/category/$categorySlug/$subcategorySlug"
									params={{
										categorySlug: category.slug,
										subcategorySlug: subcategory.slug,
									}}
									preload="intent"
									className="inline-block rounded-full border border-border bg-card px-3 py-1.5 text-[12.5px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
								>
									{subcategory.name}
								</Link>
							</li>
						))}
					</ul>
				</nav>
			)}

			<section className="mt-8">
				<h2 className="mb-4 text-[15px] font-semibold text-foreground">
					Consultants
				</h2>
				<ConsultantDirectoryGrid
					params={{ category: categorySlug }}
					emptyState={
						<CategoryEmptyState label={category?.name ?? "this category"} />
					}
				/>
			</section>
		</main>
	);
}
