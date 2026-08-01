import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo } from "react";
import {
	AppSectionHeader,
	AppSurfaceCard,
} from "@/components/common/AppPrimitives";
import { PermissionDeniedBanner } from "@/components/common/PermissionDeniedBanner";
import {
	ActivityFeed,
	ActivityFeedSkeleton,
} from "@/components/project/logs/ActivityFeed";
import { ActivityFilters } from "@/components/project/logs/ActivityFilters";
import {
	buildLogsSearch,
	hasActiveLogsFilters,
	type LogsSearch,
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
	const search = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });

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
	// Reported by the first page; false means sensitive rows were filtered out
	// server-side for this reader.
	const canViewSensitive = feed.data?.pages[0]?.can_view_sensitive ?? true;
	const hasFilters = hasActiveLogsFilters(search);

	// Gated inline rather than via RequireProjectAccess: that component's
	// `access` prop is typed to the access.* section, which has no `logs` key,
	// and six other routes depend on that contract.
	const canView = permissionsQuery.data?.logs?.view === true;

	return (
		<div className="app-shell-bg h-full w-full overflow-y-auto">
			<div className="mx-auto w-full max-w-5xl px-5 py-6 md:px-8 md:py-8">
				<AppSurfaceCard strong className="mb-6 p-6">
					<AppSectionHeader
						kicker="Audit"
						title="Logs"
						subtitle="Every change to this project's roadmap, people, and access."
					/>
				</AppSurfaceCard>

				{permissionsQuery.isPending ? (
					<AppSurfaceCard className="overflow-hidden">
						<ActivityFeedSkeleton />
					</AppSurfaceCard>
				) : !canView ? (
					<PermissionDeniedBanner
						parsed={{
							path: "logs.view",
							label: getPermissionLabel("logs.view"),
							requiredRole: null,
							message: "You don't have access to this project's activity log.",
						}}
					/>
				) : feed.isError ? (
					<PermissionDeniedBanner error={feed.error} />
				) : (
					<>
						<div className="mb-4">
							<ActivityFilters
								projectId={projectId}
								value={search}
								onChange={setSearch}
							/>
						</div>

						<AppSurfaceCard className="overflow-hidden">
							{feed.isPending ? (
								<ActivityFeedSkeleton />
							) : (
								<ActivityFeed
									items={items}
									hasFilters={hasFilters}
									hasNextPage={Boolean(feed.hasNextPage)}
									isFetchingNextPage={feed.isFetchingNextPage}
									onLoadMore={() => void feed.fetchNextPage()}
									onClearFilters={() =>
										setSearch({
											family: undefined,
											actor: undefined,
											roadmap: undefined,
											since: "all",
										})
									}
									canViewSensitive={canViewSensitive}
								/>
							)}
						</AppSurfaceCard>
					</>
				)}
			</div>
		</div>
	);
}
