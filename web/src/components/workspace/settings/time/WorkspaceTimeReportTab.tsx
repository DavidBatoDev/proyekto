import { TimeReport } from "@/components/time/report/TimeReport";
import { TimeReasonCard } from "@/components/time/shared/TimeReasonCard";
import { settingsButton } from "@/components/workspace/settings/SettingsPrimitives";
import {
	type TeamTimeReportSearch,
	validateTeamTimeReportSearch,
	validateWorkspaceTimeSettingsSearch,
	type WorkspaceTimeSettingsSearch,
	workspaceTimeTab,
} from "@/lib/timeSearch";
import type { ResolvedTimePolicy, TimeEntryView } from "@/services/time.types";
import type { TimeSettingsWorkspace } from "./WorkspaceTimePolicyForm";

/**
 * Workspace settings › Time › Report (`?tab=report`, ux.md › Reports ›
 * Workspace report): the one `TimeReport` over sheets whose policy workspace
 * is this one. Workspace owners and admins only, and only with
 * `time_reports_export` (Business); `TimeReport` checks the plan itself and
 * shows the notice ("Workspace-wide time reports and export are part of
 * Business."). Costs follow `view_costs`; names are shown; project, task and
 * note follow the server's redaction (L21).
 */

export const WORKSPACE_REPORT_COPY = {
	membersOnly:
		"Only workspace owners and admins can open the workspace time report.",
	backToPolicy: "Back to the time policy",
} as const;

// ── Search ──────────────────────────────────────────────────────────────────

/**
 * The page's search: `tab` (W0-C) plus, on the Report tab only, the report's
 * filters (`person, project, for, status, from, to, group`, the same params
 * as Team › Time), so a filtered report is a link that can be shared.
 */
export type WorkspaceTimePageSearch = WorkspaceTimeSettingsSearch &
	TeamTimeReportSearch;

export function validateWorkspaceTimePageSearch(
	search: Record<string, unknown>,
): WorkspaceTimePageSearch {
	const base = validateWorkspaceTimeSettingsSearch(search);
	return workspaceTimeTab(base) === "report"
		? { ...base, ...validateTeamTimeReportSearch(search) }
		: base;
}

/** The report filters alone (no `tab`). */
export function reportSearchOf(
	search: WorkspaceTimePageSearch,
): TeamTimeReportSearch {
	const { tab: _tab, ...report } = search;
	return report;
}

/**
 * The next search after a report filter change: `undefined` removes a
 * param, and the page stays on the Report tab.
 */
export function mergeReportSearch(
	search: WorkspaceTimePageSearch,
	patch: Partial<TeamTimeReportSearch>,
): WorkspaceTimePageSearch {
	const next: Record<string, unknown> = {
		...reportSearchOf(search),
		...patch,
	};
	for (const key of Object.keys(next)) {
		if (next[key] === undefined || next[key] === "") delete next[key];
	}
	return { tab: "report", ...(next as TeamTimeReportSearch) };
}

// ── Component ───────────────────────────────────────────────────────────────

export interface WorkspaceTimeReportTabProps {
	workspace: TimeSettingsWorkspace;
	/** Null while the policy view is unknown; false shows the members-only card. */
	canManage: boolean | null;
	/** The workspace policy, for the report's timezone and week start. */
	policy?: Pick<ResolvedTimePolicy, "timezone" | "week_start"> | null;
	search: WorkspaceTimePageSearch;
	onSearchChange: (next: WorkspaceTimePageSearch) => void;
	/** Back to the Policy tab (the members-only card's action). */
	onShowPolicy?: () => void;
	/** Opens an entry: `/time?entry=<id>` (D82). */
	onOpenEntry?: (entry: TimeEntryView) => void;
	now?: Date;
}

export function WorkspaceTimeReportTab({
	workspace,
	canManage,
	policy,
	search,
	onSearchChange,
	onShowPolicy,
	onOpenEntry,
	now,
}: WorkspaceTimeReportTabProps) {
	if (canManage === false) {
		return (
			<div className="pt-8" data-testid="workspace-time-report-refused">
				<TimeReasonCard
					variant="inline"
					tone="neutral"
					title={WORKSPACE_REPORT_COPY.membersOnly}
					action={
						onShowPolicy ? (
							<button
								type="button"
								className={settingsButton.secondary}
								onClick={onShowPolicy}
							>
								{WORKSPACE_REPORT_COPY.backToPolicy}
							</button>
						) : null
					}
				/>
			</div>
		);
	}

	return (
		<div className="pt-8" data-testid="workspace-time-report">
			<TimeReport
				scope={{ kind: "workspace", id: workspace.id }}
				search={reportSearchOf(search)}
				onSearchChange={(patch) =>
					onSearchChange(mergeReportSearch(search, patch))
				}
				planWorkspace={{
					id: workspace.id,
					name: workspace.name,
					slug: workspace.slug,
					my_role: workspace.my_role ?? null,
				}}
				timezone={policy?.timezone ?? null}
				weekStart={policy?.week_start ?? null}
				onOpenEntry={onOpenEntry}
				now={now}
			/>
		</div>
	);
}
