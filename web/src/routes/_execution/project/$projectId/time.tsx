import { createFileRoute, redirect } from "@tanstack/react-router";
import { useCallback } from "react";
import { ProjectTimePage } from "@/components/project/time/ProjectTimePage";
import {
	type ProjectTimeSearch,
	projectTimeRedirect,
	validateProjectTimeSearch,
} from "@/components/project/time/projectTimeModel";
import { isUuid } from "@/lib/timeSearch";
import { useAuthStore } from "@/stores/authStore";

/**
 * Project › Time (ux.md › Reports › Project › Time page). Everyone and
 * Client hours views; the old "Mine" tab and its `?view=mine` links go to the
 * caller's own Time page (`/time?project=`), `?view=team` is now
 * `?view=everyone`. The gate is the composite (L22) the nav item uses, not
 * `access.time` alone: see `ProjectTimePage`. Report rows are read-only here
 * (the entry read doesn't follow `time.view_team_logs`).
 */
export const Route = createFileRoute("/_execution/project/$projectId/time")({
	validateSearch: validateProjectTimeSearch,
	beforeLoad: ({ search, params, location }) => {
		const { isAuthenticated } = useAuthStore.getState();
		if (!isAuthenticated) {
			throw redirect({
				to: "/auth/login",
				search: { redirect: location.href },
			});
		}
		const next = projectTimeRedirect(search, params.projectId);
		if (next?.kind === "view") {
			throw redirect({
				to: "/project/$projectId/time",
				params: { projectId: params.projectId },
				search: next.search,
				replace: true,
			});
		}
		if (next?.kind === "mine") {
			throw redirect({
				to: "/time",
				search: next.project ? { project: next.project } : {},
				replace: true,
			});
		}
	},
	component: ProjectTimeRoute,
});

/** Patches merge into the URL; `undefined` drops a param. */
function mergeSearch(
	prev: ProjectTimeSearch,
	patch: Partial<ProjectTimeSearch>,
): ProjectTimeSearch {
	const next: Record<string, unknown> = { ...prev, ...patch };
	for (const key of Object.keys(next)) {
		if (next[key] === undefined) delete next[key];
	}
	return next as ProjectTimeSearch;
}

function ProjectTimeRoute() {
	const { projectId } = Route.useParams();
	const search = Route.useSearch();
	const navigate = Route.useNavigate();

	const onSearchChange = useCallback(
		(patch: Partial<ProjectTimeSearch>) => {
			void navigate({
				search: (prev) => mergeSearch(prev, patch),
				replace: true,
			});
		},
		[navigate],
	);

	const onRedirectMine = useCallback(() => {
		void navigate({
			to: "/time",
			search: isUuid(projectId) ? { project: projectId } : {},
			replace: true,
		});
	}, [navigate, projectId]);

	return (
		<div className="app-shell-bg h-full w-full overflow-y-auto">
			<ProjectTimePage
				projectId={projectId}
				search={search}
				onSearchChange={onSearchChange}
				onRedirectMine={onRedirectMine}
			/>
		</div>
	);
}
