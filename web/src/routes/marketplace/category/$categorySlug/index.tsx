import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { CategoryArt } from "@/components/marketplace/category/CategoryArt";
import {
	useMarketplaceCategoryNavigationQuery,
	useMarketplaceCategoryQuery,
} from "@/hooks/useMarketplaceTaxonomy";
import { mapRetiredCategorySlug } from "@/lib/marketplaceCategoryRedirects";
import type { MarketplaceCategoryNav } from "@/types/marketplace-taxonomy";

export const Route = createFileRoute("/marketplace/category/$categorySlug/")({
	beforeLoad: ({ params }) => {
		const merged = mapRetiredCategorySlug(params.categorySlug);
		if (merged) {
			throw redirect({
				to: "/marketplace/category/$categorySlug",
				params: { categorySlug: merged },
				replace: true,
			});
		}
	},
	component: MarketplaceCategoryPage,
});

/**
 * A category landing page: what this discipline covers and how to start work in
 * it, rather than a directory of who is available.
 *
 * It deliberately does NOT list consultants. The leaf pages under
 * `$subcategorySlug` are where people appear, and they are specific enough for
 * the list to mean something; a category-wide roster would be a wall of faces
 * answering a question the visitor has not asked yet. It also degrades badly
 * while the marketplace is young — an empty roster reads as "nobody works
 * here", where a map of the discipline reads as "here is what you can ask for".
 */
function MarketplaceCategoryPage() {
	const { categorySlug } = Route.useParams();
	const categoryQuery = useMarketplaceCategoryQuery(categorySlug);
	const navigationQuery = useMarketplaceCategoryNavigationQuery();
	const category = categoryQuery.data;

	if (categoryQuery.isError) return <CategoryNotFound />;

	const name = category?.name ?? "";

	return (
		<main>
			<section className="bg-foreground px-4 py-14 text-center sm:px-6 lg:px-8">
				{/* "Solutions lead" is display copy only. The model, the enrolment
				    table and every identifier stay `consultant` — renaming those was
				    explicitly deferred. */}
				<h1 className="mx-auto max-w-3xl text-[28px] font-bold leading-tight text-background sm:text-[34px]">
					{name
						? `Hire vetted ${name} solutions leads`
						: "Hire vetted solutions leads"}
				</h1>
				<p className="mx-auto mt-3 max-w-xl text-[14px] text-background/70">
					{category?.description ??
						"A consultant scopes the work, leads delivery, and is accountable for it."}
				</p>
				<Link
					to="/marketplace/project-posting"
					search={{ roadmapId: undefined }}
					className="mt-6 inline-flex h-11 items-center justify-center rounded-lg bg-background px-6 text-[14px] font-semibold text-foreground transition-opacity hover:opacity-90"
				>
					Post a project
				</Link>
			</section>

			{category && category.subcategories.length > 0 && (
				<section className="bg-muted/50 px-4 py-10 sm:px-6 lg:px-8">
					<h2 className="text-center text-[20px] font-semibold text-foreground">
						{name} specialities
					</h2>
					<ul className="mx-auto mt-5 flex max-w-4xl flex-wrap justify-center gap-2.5">
						{category.subcategories.map((subcategory) => (
							<li key={subcategory.id}>
								<Link
									to="/marketplace/category/$categorySlug/$subcategorySlug"
									params={{
										categorySlug: category.slug,
										subcategorySlug: subcategory.slug,
									}}
									preload="intent"
									className="inline-block rounded-full border border-border bg-background px-4 py-2 text-[13.5px] text-foreground transition-colors hover:border-foreground/40 hover:bg-muted"
								>
									{subcategory.name}
								</Link>
							</li>
						))}
					</ul>
				</section>
			)}

			<LeadPromo categoryName={name} />

			<section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
				<h2 className="text-center text-[24px] font-semibold tracking-tight text-foreground">
					Browse by category to find the right fit for your project
				</h2>

				<div className="mt-9 grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
					{navigationQuery.isPending
						? Array.from({ length: 8 }, (_, index) => (
								<div key={`tile-skeleton-${index}`}>
									<div className="aspect-video w-full animate-pulse rounded-lg bg-muted" />
									<div className="mt-3 h-4 w-32 animate-pulse rounded bg-muted" />
								</div>
							))
						: (navigationQuery.data ?? []).map((entry, index) => (
								<CategoryTile
									key={entry.id}
									entry={entry}
									index={index}
									current={entry.slug === categorySlug}
								/>
							))}
				</div>
			</section>
		</main>
	);
}

function CategoryTile({
	entry,
	index,
	current,
}: {
	entry: MarketplaceCategoryNav;
	index: number;
	current: boolean;
}) {
	return (
		<div>
			<Link
				to="/marketplace/category/$categorySlug"
				params={{ categorySlug: entry.slug }}
				preload="intent"
				aria-label={entry.name}
				className="block overflow-hidden rounded-lg"
			>
				<CategoryArt
					slug={entry.slug}
					index={index}
					className="aspect-video w-full transition-transform duration-200 hover:scale-[1.03]"
				/>
			</Link>

			<h3 className="mt-3 text-[14px] font-bold text-foreground">
				<Link
					to="/marketplace/category/$categorySlug"
					params={{ categorySlug: entry.slug }}
					preload="intent"
					// The category you are already on is marked rather than hidden, so
					// the grid stays a stable map instead of reshuffling per page.
					className={current ? "underline" : "hover:underline"}
					aria-current={current ? "page" : undefined}
				>
					{entry.name}
				</Link>
			</h3>

			<ul className="mt-2 space-y-1.5">
				{entry.subcategories.map((subcategory) => (
					<li key={subcategory.id}>
						<Link
							to="/marketplace/category/$categorySlug/$subcategorySlug"
							params={{
								categorySlug: entry.slug,
								subcategorySlug: subcategory.slug,
							}}
							preload="intent"
							className="text-[13px] text-muted-foreground transition-colors hover:text-foreground hover:underline"
						>
							{subcategory.name}
						</Link>
					</li>
				))}
			</ul>
		</div>
	);
}

/**
 * The counterpart to the reference's "we'll handle it" band.
 *
 * Every claim here is something the platform actually enforces — verification
 * gates who can take work, signing activates the engagement, and deliverables
 * carry acceptance criteria. No response times, ratings or guarantees, because
 * nothing records those.
 */
function LeadPromo({ categoryName }: { categoryName: string }) {
	const points = [
		"Every consultant is verified before they can take on work",
		"Scope, rates and dates are agreed in a signed contract first",
		"Deliverables are accepted against criteria, not assumed",
	];

	return (
		<section className="mx-auto max-w-7xl px-4 pt-12 sm:px-6 lg:px-8">
			<div className="grid items-center gap-8 rounded-2xl bg-primary/5 px-6 py-8 sm:px-10 lg:grid-cols-2">
				<div>
					<h2 className="text-[20px] font-semibold text-foreground">
						{categoryName ? `A big ${categoryName} project?` : "A big project?"}{" "}
						<span className="text-primary">A consultant leads it.</span>
					</h2>
					<p className="mt-2 max-w-md text-[14px] text-muted-foreground">
						You describe the outcome. They scope the work, assemble the team,
						and stay accountable for delivery.
					</p>
					<ul className="mt-5 space-y-2.5">
						{points.map((point) => (
							<li
								key={point}
								className="flex items-start gap-2.5 text-[13.5px] text-foreground"
							>
								<Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
								{point}
							</li>
						))}
					</ul>
					<Link
						to="/marketplace/consultant/browse"
						className="mt-6 inline-flex h-11 items-center justify-center rounded-lg bg-foreground px-6 text-[14px] font-semibold text-background transition-opacity hover:opacity-90"
					>
						Browse consultants
					</Link>
				</div>

				<div className="hidden lg:block">
					<CategoryArt
						slug="consultant-led-delivery"
						className="w-full rounded-xl"
					/>
				</div>
			</div>
		</section>
	);
}

function CategoryNotFound() {
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
