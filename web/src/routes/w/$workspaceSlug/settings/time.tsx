import { createFileRoute } from "@tanstack/react-router";
import { validateWorkspaceTimePageSearch } from "@/components/workspace/settings/time/WorkspaceTimeReportTab";
import { WorkspaceTimeSettings } from "@/components/workspace/settings/time/WorkspaceTimeSettings";

/**
 * `/w/<slug>/settings/time[?tab=report]`: the workspace time policy and the
 * workspace time report (ux.md › Settings › Workspace Time Policy). Auth and
 * the workspace come from the parent `/w/$workspaceSlug` layout; the settings
 * rail from `settings/route.tsx`. Search: `tab` (W0-C's
 * `validateWorkspaceTimeSettingsSearch`), plus the report's filters on the
 * Report tab only (`person, project, for, status, from, to, group`).
 */
export const Route = createFileRoute("/w/$workspaceSlug/settings/time")({
	validateSearch: validateWorkspaceTimePageSearch,
	component: WorkspaceTimeSettingsRoute,
});

function WorkspaceTimeSettingsRoute() {
	const { workspace } = Route.useRouteContext();
	const search = Route.useSearch();
	const navigate = Route.useNavigate();
	return (
		<WorkspaceTimeSettings
			workspace={workspace}
			search={search}
			onSearchChange={(next, options) => {
				void navigate({ search: next, replace: options?.replace });
			}}
			onOpenEntry={(entry) => {
				void navigate({ to: "/time", search: { entry: entry.id } });
			}}
		/>
	);
}
