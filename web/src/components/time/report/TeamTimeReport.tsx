// web/src/components/time/report/TeamTimeReport.tsx
//
// The team Report (ux.md › Reports), shared by its two homes:
//
//   /w/<slug>/teams/<t>/time                      Team › Time › Report
//   /engagements/finance/team/<t>/time-logs       Finance › team › Time
//
// Both pages mount this once their own gate has seen a team manager with team
// time on (the Team › Time layout, or the finance shell's TeamMoneyGate). It
// reads the team's policy for the timezone and week start, mounts the shared
// `TimeReport` on the team scope and opens entries in place, read-only (a team
// manager can open the team-context entries, D49).
//
// Old Team Logs links (the finance tab keeps the `time-logs` id): the route
// reads `?member=` as `person` and keeps a uuid `?log=`
// (`validateLegacyTeamTimeReportSearch`); the route passes that entry here as
// `legacyEntryId`, it opens over the Report, and closing it calls
// `onLegacyEntryClose` so the route drops the param and it doesn't reopen.

import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { useTeamMoneyAccess } from "@/components/team-time/useTeamMoneyAccess";
import type { TeamTimeReportSearch } from "@/lib/timeSearch";
import { timeQueries } from "@/queries/time";
import type { TimeEntryView } from "@/services/time.types";
import { TimeEntryDetailModal } from "../entries/TimeEntryDetailModal";
import { TimeReport } from "./TimeReport";

export const TEAM_TIME_REPORT_COPY = {
	loading: "Loading",
} as const;

export interface TeamTimeReportProps {
	teamId: string;
	/** The Report's own filters (never the legacy `log`). */
	search: TeamTimeReportSearch;
	/** Merges `patch` into the URL (the routes replace history). */
	onSearchChange: (patch: Partial<TeamTimeReportSearch>) => void;
	/** An old `?log=` entry to open over the Report. */
	legacyEntryId?: string | null;
	/** The legacy entry was closed: drop `?log=` so it doesn't reopen. */
	onLegacyEntryClose?: () => void;
}

export function TeamTimeReport({
	teamId,
	search,
	onSearchChange,
	legacyEntryId = null,
	onLegacyEntryClose,
}: TeamTimeReportProps) {
	const access = useTeamMoneyAccess(teamId);
	const [openEntry, setOpenEntry] = useState<TimeEntryView | null>(null);

	// Team policy reads are manager-only (404 otherwise). Both hosts mount
	// this for managers only; the guard keeps a stray mount quiet.
	const policyQuery = useQuery(
		timeQueries.teamPolicy(access.isApprover ? teamId : null),
	);

	// The default range is counted in the team's timezone, so wait for it
	// once; a failed read falls back to the device's.
	if (policyQuery.isLoading) {
		return (
			<div className="flex justify-center p-12" role="status">
				<Loader2
					className="h-6 w-6 animate-spin text-muted-foreground"
					aria-hidden="true"
				/>
				<span className="sr-only">{TEAM_TIME_REPORT_COPY.loading}</span>
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
				onSearchChange={onSearchChange}
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
				// The pay cut-offs are presets only where the team records payments.
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
					if (legacyEntryId) onLegacyEntryClose?.();
				}}
			/>
		</>
	);
}
