import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { TeamFinanceChrome } from "@/components/finance/team/TeamFinanceChrome";
import { TimeSettingsLink } from "@/components/finance/team/TimeSettingsLink";
import { TeamMoneyGate } from "@/components/team-time/TeamMoneyGate";
import { useTeamMoneyAccess } from "@/components/team-time/useTeamMoneyAccess";
import { TimeEntryDetailModal } from "@/components/time/entries/TimeEntryDetailModal";
import { TimeReport } from "@/components/time/report/TimeReport";
import {
	isUuid,
	type TeamTimeReportSearch,
	validateTeamTimeReportSearch,
} from "@/lib/timeSearch";
import { timeQueries } from "@/queries/time";
import type { TimeEntryView } from "@/services/time.types";

/**
 * Finance › team › Time (ux.md › Reports): the team Report inside the
 * Engagements finance shell, so reviewing a team's hours and cost never leaves
 * it. Same scope, filters and URL (`?person&project&for&status&from&to&group`)
 * as Team › Time; the tab id stays `time-logs` so old links keep working.
 * The Rates and Payouts tabs link here with `{person}` / `{person, from, to}`.
 *
 * Old Team Logs links keep working (ux.md › Routes and Redirects): `?member=U`
 * filters to that person (as `team-logs?member=` does), and `?log=X` opens
 * that entry over the Report.
 */
export const Route = createFileRoute(
	"/_execution/engagements/finance/team/$teamId/time-logs",
)({
	validateSearch: (
		search: Record<string, unknown>,
	): TeamTimeReportSearch & { log?: string } => {
		const report = validateTeamTimeReportSearch({
			...search,
			person: search.person ?? search.member,
		});
		const log = typeof search.log === "string" ? search.log.trim() : "";
		return isUuid(log) ? { ...report, log } : report;
	},
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
	const access = useTeamMoneyAccess(teamId);
	const [openEntry, setOpenEntry] = useState<TimeEntryView | null>(null);
	const policyQuery = useQuery(timeQueries.teamPolicy(teamId));

	// The default range is counted in the team's timezone; a failed read
	// falls back to the device's.
	if (policyQuery.isLoading) {
		return (
			<div className="flex justify-center p-12" role="status">
				<Loader2
					className="h-6 w-6 animate-spin text-muted-foreground"
					aria-hidden="true"
				/>
				<span className="sr-only">Loading</span>
			</div>
		);
	}

	const policy = policyQuery.data?.effective;
	const planWorkspace = access.planWorkspace;

	return (
		<>
			<TimeReport
				scope={{ kind: "team", id: teamId }}
				search={search}
				onSearchChange={(patch) =>
					void navigate({
						search: (prev) => ({ ...prev, ...patch }),
						replace: true,
					})
				}
				timezone={policy?.timezone ?? null}
				weekStart={policy?.week_start ?? null}
				planWorkspace={
					access.planWorkspaceId
						? {
								id: access.planWorkspaceId,
								name: planWorkspace?.name,
								slug: planWorkspace?.slug,
								my_role: planWorkspace?.my_role,
							}
						: null
				}
				cutoffs={
					access.canPay
						? { config: access.team?.pay_period_config ?? null }
						: null
				}
				onOpenEntry={setOpenEntry}
			/>
			<TimeEntryDetailModal
				entryId={openEntry?.id ?? legacyEntryId ?? null}
				entry={openEntry}
				mode="readonly"
				timeZone={policy?.timezone}
				onClose={() => {
					setOpenEntry(null);
					// An old `?log=` link: closing drops it, so it doesn't reopen.
					if (legacyEntryId) {
						void navigate({
							search: ({ log: _log, ...rest }) => rest,
							replace: true,
						});
					}
				}}
			/>
		</>
	);
}
