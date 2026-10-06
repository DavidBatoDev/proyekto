import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useMemo } from "react";
import { AppTabs } from "@/components/common/AppTabs";
import { TimeReasonCard } from "@/components/time/shared/TimeReasonCard";
import {
	SettingsPageHeader,
	SettingsSkeleton,
	settingsButton,
} from "@/components/workspace/settings/SettingsPrimitives";
import { timeErrorCopy } from "@/lib/timeErrors";
import { type WorkspaceTimeTab, workspaceTimeTab } from "@/lib/timeSearch";
import { timeQueries } from "@/queries/time";
import { browserTimeZone as readBrowserTimeZone } from "@/services/time.service";
import type { TimeEntryView } from "@/services/time.types";
import { PolicyHistory } from "./PolicyHistory";
import {
	type TimeSettingsWorkspace,
	WorkspaceTimePolicyForm,
} from "./WorkspaceTimePolicyForm";
import {
	type WorkspaceTimePageSearch,
	WorkspaceTimeReportTab,
} from "./WorkspaceTimeReportTab";

/**
 * `/w/<slug>/settings/time[?tab=report]` (ux.md › Settings › Workspace Time
 * Policy): "Time policy · Acme [Policy | Report]".
 *
 * - The policy is read with the editor's browser timezone (`?tz=`), which
 *   only seeds a missing row for owners and admins (CHANGE-11); members read
 *   it as it stands (A4) and never see the Report tab.
 * - Policy: `WorkspaceTimePolicyForm` (editable for owners and admins,
 *   read-only for members) and, for owners and admins, `PolicyHistory` (A7).
 * - Report: `WorkspaceTimeReportTab` (the workspace `TimeReport`, Business).
 * - Every refusal renders a reason card; a 404 reads "This doesn't exist or
 *   you can't open it."
 */

export const WORKSPACE_TIME_SETTINGS_COPY = {
	policyTitle: "Time policy",
	reportTitle: "Time report",
	policyTab: "Policy",
	reportTab: "Report",
	loading: "Loading the time policy",
	retry: "Try again",
} as const;

/** "Time policy · Acme" / "Time report · Acme". */
export function workspaceTimeTitle(
	tab: WorkspaceTimeTab,
	workspaceName: string | null | undefined,
): string {
	const head =
		tab === "report"
			? WORKSPACE_TIME_SETTINGS_COPY.reportTitle
			: WORKSPACE_TIME_SETTINGS_COPY.policyTitle;
	const name = workspaceName?.trim();
	return name ? `${head} · ${name}` : head;
}

/** Owners and admins manage the workspace (the server's `can_edit` decides once known). */
export function managesWorkspace(
	role: TimeSettingsWorkspace["my_role"],
): boolean {
	return role === "owner" || role === "admin";
}

export interface WorkspaceTimeSettingsProps {
	/** The workspace from the `/w/$workspaceSlug` route context. */
	workspace: TimeSettingsWorkspace;
	search: WorkspaceTimePageSearch;
	/** Replace the page's search (tab switch, report filters). */
	onSearchChange: (
		next: WorkspaceTimePageSearch,
		options?: { replace?: boolean },
	) => void;
	/** Opens a report entry (`/time?entry=<id>`). */
	onOpenEntry?: (entry: TimeEntryView) => void;
	/** Overrides the browser timezone (tests). */
	browserTimeZone?: string | null;
	now?: Date;
}

export function WorkspaceTimeSettings({
	workspace,
	search,
	onSearchChange,
	onOpenEntry,
	browserTimeZone,
	now,
}: WorkspaceTimeSettingsProps) {
	const browserTz = useMemo(
		() =>
			browserTimeZone === undefined ? readBrowserTimeZone() : browserTimeZone,
		[browserTimeZone],
	);
	const policyQuery = useQuery(
		timeQueries.workspacePolicy(workspace.id, { tz: browserTz ?? undefined }),
	);
	const view = policyQuery.data;
	const canManage = view ? view.can_edit : managesWorkspace(workspace.my_role);
	const tab = workspaceTimeTab(search);

	const showTab = (next: WorkspaceTimeTab) => {
		if (next === tab) return;
		onSearchChange(next === "report" ? { tab: "report" } : {});
	};

	const tabs = canManage ? (
		<AppTabs<WorkspaceTimeTab>
			items={[
				{ key: "policy", label: WORKSPACE_TIME_SETTINGS_COPY.policyTab },
				{ key: "report", label: WORKSPACE_TIME_SETTINGS_COPY.reportTab },
			]}
			active={tab}
			onChange={showTab}
			size="sm"
		/>
	) : null;

	let body: ReactNode;
	if (policyQuery.isPending) {
		body = (
			<SettingsSkeleton
				bands={4}
				label={WORKSPACE_TIME_SETTINGS_COPY.loading}
			/>
		);
	} else if (tab === "report") {
		body = (
			<WorkspaceTimeReportTab
				workspace={workspace}
				canManage={canManage}
				policy={view?.policy ?? null}
				search={search}
				onSearchChange={(next) => onSearchChange(next, { replace: true })}
				onShowPolicy={() => showTab("policy")}
				onOpenEntry={onOpenEntry}
				now={now}
			/>
		);
	} else if (!view) {
		const copy = timeErrorCopy(policyQuery.error, {
			subject: "scope",
			operation: "read",
			label: workspace.name,
		});
		body = (
			<div className="pt-8" data-testid="workspace-time-policy-error">
				<TimeReasonCard
					variant="inline"
					role="alert"
					tone={copy.notFound ? "not-found" : "danger"}
					title={copy.message}
					action={
						copy.notFound ? null : (
							<button
								type="button"
								className={settingsButton.secondary}
								disabled={policyQuery.isFetching}
								onClick={() => void policyQuery.refetch()}
							>
								{WORKSPACE_TIME_SETTINGS_COPY.retry}
							</button>
						)
					}
				/>
			</div>
		);
	} else {
		body = (
			<>
				<WorkspaceTimePolicyForm
					workspace={workspace}
					view={view}
					browserTimeZone={browserTz}
					now={now}
				/>
				<PolicyHistory
					workspaceId={workspace.id}
					enabled={view.can_edit}
					now={now}
				/>
			</>
		);
	}

	return (
		<div className="app-fade-in" data-testid="workspace-time-settings">
			<SettingsPageHeader
				title={workspaceTimeTitle(tab, workspace.name)}
				actions={tabs}
			/>
			{body}
		</div>
	);
}
