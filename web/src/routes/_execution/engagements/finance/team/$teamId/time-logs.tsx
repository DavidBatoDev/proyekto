import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { TeamFinanceChrome } from "@/components/finance/team/TeamFinanceChrome";
import { TimeSettingsLink } from "@/components/finance/team/TimeSettingsLink";
import { TeamMoneyGate } from "@/components/team-time/TeamMoneyGate";
import { TeamTimeReport } from "@/components/time/report/TeamTimeReport";
import { validateLegacyTeamTimeReportSearch } from "@/lib/timeSearch";

/**
 * Finance › team › Time (ux.md › Reports): the team Report inside the
 * Engagements finance shell, so reviewing a team's hours and cost never leaves
 * it. Same scope, filters and URL (`?person&project&for&status&from&to&group`)
 * as Team › Time, through the same `TeamTimeReport`; the tab id stays
 * `time-logs` so old links keep working. The Rates and Payouts tabs link here
 * with `{person}` / `{person, from, to}`.
 *
 * Old Team Logs links keep working (ux.md › Routes and Redirects): `?member=U`
 * filters to that person (as `team-logs?member=` does), and `?log=X` opens
 * that entry over the Report (`validateLegacyTeamTimeReportSearch`).
 */
export const Route = createFileRoute(
	"/_execution/engagements/finance/team/$teamId/time-logs",
)({
	validateSearch: validateLegacyTeamTimeReportSearch,
	component: TeamTimeReportFinancePage,
});

function TeamTimeReportFinancePage() {
	const { teamId } = Route.useParams();

	return (
		<TeamFinanceChrome teamId={teamId} section="time-logs">
			<TeamMoneyGate
				teamId={teamId}
				need="approver"
				settingsLink={<TimeSettingsLink teamId={teamId} />}
			>
				<FinanceTeamReport teamId={teamId} />
			</TeamMoneyGate>
		</TeamFinanceChrome>
	);
}

/** Mounted only once the gate has seen a team manager with team time on. */
function FinanceTeamReport({ teamId }: { teamId: string }) {
	const { log: legacyEntryId, ...search } = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });

	return (
		<TeamTimeReport
			teamId={teamId}
			search={search}
			onSearchChange={(patch) =>
				void navigate({
					search: (prev) => ({ ...prev, ...patch }),
					replace: true,
				})
			}
			legacyEntryId={legacyEntryId ?? null}
			// An old `?log=` link: closing drops it, so it doesn't reopen.
			onLegacyEntryClose={() =>
				void navigate({
					search: ({ log: _log, ...rest }) => rest,
					replace: true,
				})
			}
		/>
	);
}
