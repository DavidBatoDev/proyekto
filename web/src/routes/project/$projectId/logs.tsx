import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { SlidersHorizontal } from "lucide-react";
import { useMemo, useState } from "react";
import { PermissionDeniedBanner } from "@/components/common/PermissionDeniedBanner";
import {
	ActivityFeed,
	ActivityFeedSkeleton,
} from "@/components/project/logs/ActivityFeed";
import { LogsFilterSidebar } from "@/components/project/logs/LogsFilterSidebar";
import {
	buildLogsSearch,
	EMPTY_LOGS_SEARCH,
	hasActiveLogsFilters,
	type LogsSearch,
	normalizeLogsSearch,
	parseLogsSearch,
	presetToFrom,
} from "@/components/project/logs/logsSearch";
import { useProjectActivityQuery } from "@/hooks/useActivityQueries";
import { useProjectMyPermissionsQuery } from "@/hooks/useProjectQueries";
import { getPermissionLabel } from "@/lib/permissionErrors";

export const Route = createFileRoute("/project/$projectId/logs")({
	validateSearch: parseLogsSearch,
	component: ProjectLogsPage,
});

function ProjectLogsPage() {
	const { projectId } = Route.useParams();
	const rawSearch = Route.useSearch();
	const search = useMemo(() => normalizeLogsSearch(rawSearch), [rawSearch]);
	const navigate = useNavigate({ from: Route.fullPath });
	const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

	const permissionsQuery = useProjectMyPermissionsQuery(projectId);

	const filters = useMemo(
		() => ({
			family: search.family,
			actor_id: search.actor,
			roadmap_id: search.roadmap,
			from: presetToFrom(search.since),
		}),
		[search.family, search.actor, search.roadmap, search.since],
	);

	const feed = useProjectActivityQuery(projectId, filters);

	const setSearch = (next: Partial<LogsSearch>) => {
		void navigate({
			search: buildLogsSearch({ ...search, ...next }) as never,
			replace: true,
		});
	};

	const items = feed.data?.pages.flatMap((page) => page.items) ?? [];
	const canViewSensitive = feed.data?.pages[0]?.can_view_sensitive ?? true;
	const hasFilters = hasActiveLogsFilters(search);

	// Gated inline rather than via RequireProjectAccess: that component's
	// `access` prop is typed to the access.* section, which has no `logs` key,
	// and six other routes depend on that contract.
	const canView = permissionsQuery.data?.logs?.view === true;

	if (permissionsQuery.isPending) {
		return (
			<div className="app-shell-bg h-full w-full overflow-y-auto p-6">
				<ActivityFeedSkeleton />
			</div>
		);
	}

	if (!canView) {
		return (
			<div className="app-shell-bg h-full w-full overflow-y-auto p-6">
				<PermissionDeniedBanner
					parsed={{
						path: "logs.view",
						label: getPermissionLabel("logs.view"),
						requiredRole: null,
						message: "You don't have access to this project's activity log.",
					}}
				/>
			</div>
		);
	}

	const sidebar = (
		<LogsFilterSidebar
			projectId={projectId}
			value={search}
			onChange={setSearch}
			onReset={() => setSearch(EMPTY_LOGS_SEARCH)}
		/>
	);

	return (
		// Two independently-scrolling panes: the filter rail stays put while the
		// feed scrolls, which is the whole point of a rail over a toolbar.
		<div className="app-shell-bg flex h-full w-full overflow-hidden">
			<aside className="hidden w-60 shrink-0 border-r border-border bg-card/40 md:block">
				{sidebar}
			</aside>

			{/* Mobile: the rail becomes a slide-over sheet. */}
			{mobileFiltersOpen ? (
				<div className="fixed inset-0 z-50 md:hidden">
					<button
						type="button"
						aria-label="Close filters"
						onClick={() => setMobileFiltersOpen(false)}
						className="absolute inset-0 bg-black/40"
					/>
					<div className="absolute inset-y-0 left-0 w-72 border-r border-border bg-card shadow-xl">
						{sidebar}
					</div>
				</div>
			) : null}

			<main className="flex min-w-0 flex-1 flex-col overflow-hidden">
				<header className="flex items-center gap-3 border-b border-border px-4 py-3 md:px-6">
					<button
						type="button"
						onClick={() => setMobileFiltersOpen(true)}
						className="inline-flex items-center gap-1.5 rounded-lg border border-input px-2.5 py-1.5 text-sm font-medium md:hidden"
					>
						<SlidersHorizontal className="h-3.5 w-3.5" />
						Filters
						{hasFilters ? (
							<span className="h-1.5 w-1.5 rounded-full bg-primary" />
						) : null}
					</button>

					<div className="min-w-0 flex-1">
						<h1 className="text-sm font-semibold text-foreground">Logs</h1>
						<p className="truncate text-xs text-muted-foreground">
							Every change to this project's roadmap, people, and access.
						</p>
					</div>

					{feed.isFetching && !feed.isFetchingNextPage ? (
						<span className="text-xs text-muted-foreground">Refreshing…</span>
					) : null}
				</header>

				<div className="min-h-0 flex-1 overflow-y-auto">
					{feed.isError ? (
						<div className="p-6">
							<PermissionDeniedBanner error={feed.error} />
						</div>
					) : feed.isPending ? (
						<ActivityFeedSkeleton />
					) : (
						<ActivityFeed
							items={items}
							hasFilters={hasFilters}
							hasNextPage={Boolean(feed.hasNextPage)}
							isFetchingNextPage={feed.isFetchingNextPage}
							onLoadMore={() => void feed.fetchNextPage()}
							onClearFilters={() => setSearch(EMPTY_LOGS_SEARCH)}
							canViewSensitive={canViewSensitive}
						/>
					)}
				</div>
			</main>
		</div>
	);
}
