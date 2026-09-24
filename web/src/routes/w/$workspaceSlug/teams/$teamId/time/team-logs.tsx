import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
	TeamLogsPanel,
	type TeamLogsSearch,
	validateTeamLogsSearch,
} from "@/components/team-time/TeamLogsPanel";

export const Route = createFileRoute(
	"/w/$workspaceSlug/teams/$teamId/time/team-logs",
)({
	validateSearch: validateTeamLogsSearch,
	component: TeamLogsRoute,
});

// Page body lives in TeamLogsPanel so the Engagements → Finance → Team page
// can render the same implementation; the Time layout (route.tsx) owns the
// chrome and gating here.
function TeamLogsRoute() {
	const { teamId } = Route.useParams();
	const search = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });

	const onSearchChange = (patch: Partial<TeamLogsSearch>) => {
		void navigate({
			search: (prev) => ({ ...prev, ...patch }),
			replace: true,
		});
	};

	return (
		<TeamLogsPanel
			teamId={teamId}
			search={search}
			onSearchChange={onSearchChange}
		/>
	);
}
