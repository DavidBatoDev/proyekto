import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { TeamFinanceChrome } from "@/components/finance/team/TeamFinanceChrome";
import { TimeSettingsLink } from "@/components/finance/team/TimeSettingsLink";
import {
	TeamLogsPanel,
	type TeamLogsSearch,
	validateTeamLogsSearch,
} from "@/components/team-time/TeamLogsPanel";
import { TeamMoneyGate } from "@/components/team-time/TeamMoneyGate";

/**
 * Team time logs inside Engagements → Finance, so reviewing hours never leaves
 * the finance shell. The body is the same panel Teams → Time renders.
 */
export const Route = createFileRoute(
	"/_execution/engagements/finance/team/$teamId/time-logs",
)({
	validateSearch: validateTeamLogsSearch,
	component: TeamTimeLogsPage,
});

function TeamTimeLogsPage() {
	const { teamId } = Route.useParams();
	const search = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });

	const onSearchChange = (patch: Partial<TeamLogsSearch>) =>
		void navigate({
			search: (prev) => ({ ...prev, ...patch }),
			replace: true,
		});

	return (
		<TeamFinanceChrome teamId={teamId} section="time-logs">
			<TeamMoneyGate
				teamId={teamId}
				need="approver"
				settingsLink={<TimeSettingsLink teamId={teamId} />}
			>
				<TeamLogsPanel
					teamId={teamId}
					search={search}
					onSearchChange={onSearchChange}
				/>
			</TeamMoneyGate>
		</TeamFinanceChrome>
	);
}
