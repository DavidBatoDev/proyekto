import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { CategoryArt } from "@/components/marketplace/category/CategoryArt";
import { columnize } from "@/components/marketplace/nav/categoryMegaMenu";
import {
	useMarketplaceCategoryNavigationQuery,
	useMarketplaceCategoryQuery,
} from "@/hooks/useMarketplaceTaxonomy";
import { mapRetiredCategorySlug } from "@/lib/marketplaceCategoryRedirects";
import type {
	MarketplaceCategoryNav,
	MarketplaceSubcategoryWithTopics,
} from "@/types/marketplace-taxonomy";

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
 * The browse grid is scoped to THIS category. It used to be fed by the
 * navigation query — every category with every speciality — so every category
 * page rendered an identical grid and clicking one told you nothing. That was
 * only possible because with two levels there was nothing category-specific to
 * tile; the third level is what fixed it.
 *
 * Consultants are deliberately not listed here. The leaf pages are specific
 * enough for a roster to mean something; a category-wide one answers a question
 * the visitor has not asked yet, and reads as "nobody works here" while the
 * marketplace is young.
 */
function MarketplaceCategoryPage() {
	const { categorySlug } = Route.useParams();
	const categoryQuery = useMarketplaceCategoryQuery(categorySlug);
	const category = categoryQuery.data;

	if (categoryQuery.isError) return <CategoryNotFound />;

	const name = category?.name ?? "";
	const specialities = category?.subcategories ?? [];

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

			<LeadPromo categoryName={name} />

			<section className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
				<h2 className="text-center text-[24px] font-semibold tracking-tight text-foreground">
					{name
						? `Browse ${name} to find the right fit`
						: "Browse to find the right fit"}
				</h2>

				<div className="mt-9 grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
					{categoryQuery.isPending
						? Array.from({ length: 8 }, (_, index) => (
								<div key={`tile-skeleton-${index}`}>
									<div className="aspect-video w-full animate-pulse rounded-lg bg-muted" />
									<div className="mt-3 h-4 w-32 animate-pulse rounded bg-muted" />
								</div>
							))
						: specialities.map((speciality, index) => (
								<SpecialityTile
									key={speciality.id}
									categorySlug={categorySlug}
									speciality={speciality}
									index={index}
								/>
							))}
				</div>
			</section>

			<AllCategories currentSlug={categorySlug} />
		</main>
	);
}

/**
 * One speciality: its picture, its name, and the topics underneath it.
 *
 * `CategoryArt` is reused unchanged — keyed on the speciality's own slug, so it
 * keeps a stable palette, and on its grid position, so scenes spread evenly.
 */
function SpecialityTile({
	categorySlug,
	speciality,
	index,
}: {
	categorySlug: string;
	speciality: MarketplaceSubcategoryWithTopics;
	index: number;
}) {
	return (
		<div>
			<Link
				to="/marketplace/category/$categorySlug/$subcategorySlug"
				params={{ categorySlug, subcategorySlug: speciality.slug }}
				preload="intent"
				aria-label={speciality.name}
				className="block overflow-hidden rounded-lg"
			>
				<CategoryArt
					slug={speciality.slug}
					index={index}
					className="aspect-video w-full transition-transform duration-200 hover:scale-[1.03]"
				/>
			</Link>

			<h3 className="mt-3 text-[14px] font-bold text-foreground">
				<Link
					to="/marketplace/category/$categorySlug/$subcategorySlug"
					params={{ categorySlug, subcategorySlug: speciality.slug }}
					preload="intent"
					className="hover:underline"
				>
					{speciality.name}
				</Link>
			</h3>

			<ul className="mt-2 space-y-1.5">
				{speciality.topics.map((topic) => (
					<li key={topic.id}>
						<Link
							to="/marketplace/category/$categorySlug/$subcategorySlug/$topicSlug"
							params={{
								categorySlug,
								subcategorySlug: speciality.slug,
								topicSlug: topic.slug,
							}}
							preload="intent"
							className="text-[13px] text-muted-foreground transition-colors hover:text-foreground hover:underline"
						>
							{topic.name}
						</Link>
					</li>
				))}
			</ul>
		</div>
	);
}

/**
 * The rest of the taxonomy, in a compact row.
 *
 * The grid above is this category's own specialities now, so without this the
 * page would be a dead end for anyone who wanted a different discipline.
 * Columns rather than a wrapped list, reusing the mega-menu's own splitter.
 */
function AllCategories({ currentSlug }: { currentSlug: string }) {
	const navigationQuery = useMarketplaceCategoryNavigationQuery();
	const categories = navigationQuery.data ?? [];
	if (categories.length === 0) return null;

	return (
		<section className="border-t border-border bg-muted/30 px-4 py-10 sm:px-6 lg:px-8">
			<div className="mx-auto max-w-7xl">
				<h2 className="text-[15px] font-semibold text-foreground">
					All categories
				</h2>
				<div className="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
					{columnize<MarketplaceCategoryNav>(categories, 4).map((column) => (
						<ul key={column[0]?.id ?? "empty"} className="space-y-2">
							{column.map((entry) => (
								<li key={entry.id}>
									<Link
										to="/marketplace/category/$categorySlug"
										params={{ categorySlug: entry.slug }}
										preload="intent"
										aria-current={
											entry.slug === currentSlug ? "page" : undefined
										}
										className={`text-[13.5px] transition-colors hover:text-foreground hover:underline ${
											entry.slug === currentSlug
												? "font-semibold text-foreground"
												: "text-muted-foreground"
										}`}
									>
										{entry.name}
									</Link>
								</li>
							))}
						</ul>
					))}
				</div>
			</div>
		</section>
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
