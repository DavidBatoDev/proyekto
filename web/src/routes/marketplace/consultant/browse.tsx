import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChevronRight, Search, SlidersHorizontal } from "lucide-react";
import { useEffect, useState } from "react";
import {
	BrowseAbout,
	BrowseFaq,
	RelatedSpecialities,
	WaysToStartBand,
} from "@/components/marketplace/browse/BrowseSections";
import { ConsultantFilterRail } from "@/components/marketplace/browse/ConsultantFilterRail";
import { ConsultantResultCard } from "@/components/marketplace/browse/ConsultantResultCard";
import { CategoryEmptyState } from "@/components/marketplace/category/CategoryEmptyState";
import { MarketplaceCategoryBar } from "@/components/marketplace/home/MarketplaceCategoryBar";
import { MarketplaceFooter } from "@/components/marketplace/MarketplaceFooter";
import {
	useConsultantDirectoryFacetsQuery,
	useConsultantDirectoryQuery,
} from "@/hooks/useConsultants";
import {
	type ConsultantBrowseSearch,
	countActiveFilters,
	parseConsultantBrowseSearch,
	toDirectoryParams,
} from "@/lib/consultantBrowseFilters";

const PAGE_SIZE = 12;
/** The directory endpoint rejects a larger page, so the growth stops here. */
const MAX_LIMIT = 48;

export const Route = createFileRoute("/marketplace/consultant/browse")({
	component: BrowseConsultants,
	validateSearch: parseConsultantBrowseSearch,
});

/**
 * The consultant directory.
 *
 * Filter state lives in the URL rather than in component state, so a filtered
 * view is shareable, survives a reload, and lands somebody back where they were
 * when they come out of a profile with the back button.
 *
 * Pagination grows `limit` instead of stepping `offset`, matching
 * `ConsultantDirectoryGrid`: "Load more" then appends rather than replacing the
 * page, and a refetch cannot make earlier results disappear.
 */
function BrowseConsultants() {
	const navigate = useNavigate({ from: Route.fullPath });
	const search = Route.useSearch();
	const [limit, setLimit] = useState(PAGE_SIZE);
	const [railOpen, setRailOpen] = useState(false);
	const [searchDraft, setSearchDraft] = useState(search.q ?? "");

	const params = toDirectoryParams(search);
	const query = useConsultantDirectoryQuery({ ...params, limit, offset: 0 });
	const facetsQuery = useConsultantDirectoryFacetsQuery();

	// A new filter set is a new result list, so the "Load more" depth resets
	// with it — otherwise switching category would silently fetch 48 rows.
	const filterFingerprint = JSON.stringify(params);
	useEffect(() => {
		setLimit(PAGE_SIZE);
	}, [filterFingerprint]);

	useEffect(() => {
		setSearchDraft(search.q ?? "");
	}, [search.q]);

	const applyFilters = (next: Partial<ConsultantBrowseSearch>) => {
		void navigate({
			search: (current) => ({ ...current, ...next }),
			replace: true,
		});
	};

	const clearFilters = () => {
		void navigate({ search: search.q ? { q: search.q } : {}, replace: true });
	};

	const items = query.data?.items ?? [];
	const total = query.data?.total ?? 0;
	const activeCount = countActiveFilters(search);

	return (
		<div className="min-h-screen bg-background pt-app-header">
			<MarketplaceCategoryBar />

			<main className="mx-auto max-w-[1280px] px-4 py-8 sm:px-6 lg:px-8">
				<nav aria-label="Breadcrumb" className="mb-3">
					<ol className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
						<li>
							<Link to="/marketplace" className="hover:text-foreground">
								Marketplace
							</Link>
						</li>
						<ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
						<li className="text-foreground">Consultants</li>
					</ol>
				</nav>

				<header>
					<h1 className="text-[26px] font-bold tracking-tight text-foreground sm:text-[30px]">
						Hire a vetted consultant to lead your project
					</h1>
					<p className="mt-1.5 max-w-2xl text-[14px] text-muted-foreground">
						One accountable lead who scopes the work, builds the team and
						delivers it.
					</p>
				</header>

				<div className="mt-6 flex flex-col gap-8 lg:flex-row">
					<aside className="lg:w-[268px] lg:shrink-0">
						<button
							type="button"
							onClick={() => setRailOpen((open) => !open)}
							aria-expanded={railOpen}
							className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-card py-2.5 text-[13px] font-semibold text-foreground lg:hidden"
						>
							<SlidersHorizontal className="h-4 w-4" />
							Filters
							{activeCount > 0 && ` (${activeCount})`}
						</button>

						{/*
						 * Sticky, and scrolls within itself once it outgrows the
						 * viewport — on a short screen the last filters would otherwise
						 * be unreachable while the results column scrolled past them. The
						 * scrollbar is the app's thin one so the rail does not gain a
						 * second visual edge.
						 */}
						<div
							className={`${railOpen ? "mt-4 block" : "hidden"} panel-scrollbar lg:sticky lg:top-20 lg:mt-0 lg:block lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:pr-1.5`}
						>
							<ConsultantFilterRail
								search={search}
								facets={facetsQuery.data}
								onChange={applyFilters}
								onClear={clearFilters}
							/>
						</div>
					</aside>

					<section className="min-w-0 flex-1 lg:max-w-[1000px]">
						<form
							onSubmit={(event) => {
								event.preventDefault();
								applyFilters({ q: searchDraft.trim() || undefined });
							}}
							className="relative"
						>
							<Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
							<input
								type="search"
								value={searchDraft}
								onChange={(event) => setSearchDraft(event.target.value)}
								placeholder="Search consultants by name, headline or focus"
								aria-label="Search consultants"
								className="w-full rounded-xl border border-border bg-card py-2.5 pl-9 pr-3 text-[13.5px] text-foreground outline-none transition-colors focus:border-primary"
							/>
						</form>

						<p className="mt-3 text-[12.5px] text-muted-foreground">
							{query.isPending
								? "Loading consultants…"
								: `${total} ${total === 1 ? "consultant" : "consultants"} available`}
						</p>

						<div className="mt-4 space-y-4">
							{query.isPending &&
								Array.from({ length: 3 }, (_, index) => (
									<div
										key={`browse-skeleton-${index}`}
										className="h-[260px] animate-pulse rounded-xl border border-border bg-card"
									/>
								))}

							{query.isError && (
								<div className="rounded-xl border border-destructive/30 bg-destructive/10 p-6 text-[13px] text-destructive">
									Could not load consultants right now. Try again shortly.
								</div>
							)}

							{!query.isPending && !query.isError && items.length === 0 && (
								<CategoryEmptyState
									label={
										activeCount > 0 || search.q
											? "this search"
											: "the marketplace"
									}
								/>
							)}

							{items.map((consultant) => (
								<ConsultantResultCard
									key={consultant.id}
									consultant={consultant}
								/>
							))}
						</div>

						{items.length < total && limit < MAX_LIMIT && (
							<div className="mt-6 text-center">
								<button
									type="button"
									onClick={() =>
										setLimit((current) =>
											Math.min(current + PAGE_SIZE, MAX_LIMIT),
										)
									}
									disabled={query.isFetching}
									className="rounded-xl border border-border px-4 py-2 text-[13px] font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-60"
								>
									{query.isFetching ? "Loading…" : "Load more"}
								</button>
							</div>
						)}
					</section>
				</div>
			</main>

			<BrowseAbout />
			<RelatedSpecialities categorySlug={search.category} />
			<BrowseFaq />
			<WaysToStartBand />
			<MarketplaceFooter />
		</div>
	);
}
