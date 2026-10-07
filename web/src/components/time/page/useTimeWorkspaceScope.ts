// web/src/components/time/page/useTimeWorkspaceScope.ts
//
// The current workspace's view of the person's time, shared by the sidebar
// (Time gate and badge), the workspace switcher (waiting elsewhere) and the
// /time page. Reads only cached queries the app already makes: the overview,
// the workspaces, the person's teams, and the first page of Waiting for you
// (the same request the Waiting list makes). Rules: workspaceGroups.ts.

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useCurrentWorkspace } from "@/hooks/useWorkspaceQueries";
import { pickDefaultWorkspace } from "@/lib/workspaceRouting";
import { teamKeys } from "@/queries/teams";
import { timeQueries, useTimeOverview } from "@/queries/time";
import { listMyTeams } from "@/services/teams.service";
import type { ApprovalRow } from "@/services/time.types";
import { useAuthStore } from "@/stores/authStore";
import { APPROVAL_FLAGS_PAGE_MAX } from "../approvals/WaitingForYouList";
import {
	type ElsewhereWaiting,
	type TeamWorkspaces,
	timeVisibleInWorkspace,
	type WorkspaceScope,
	waitingElsewhere,
	waitingHereCount,
} from "./workspaceGroups";

/** The Waiting for you request the list, the sidebar and the switcher share. */
export function waitingFirstPage(userId: string | null) {
	return timeQueries.approvals(userId, {
		status: "submitted",
		page: 1,
		limit: APPROVAL_FLAGS_PAGE_MAX,
	});
}

export interface TimeWorkspaceScope {
	scope: WorkspaceScope;
	workspaceName: string | null;
	/** Workspace names by id. */
	names: Record<string, string>;
	waitingRows: ApprovalRow[];
	/** Waiting in this workspace (the badge). */
	waitingHere: number;
	elsewhere: ElsewhereWaiting[];
	/** The sidebar's Time gate for this workspace. Null while unknown. */
	visible: boolean | null;
}

export function useTimeWorkspaceScope(): TimeWorkspaceScope {
	const userId = useAuthStore((state) => state.user?.id ?? null);
	const overview = useTimeOverview().data ?? null;
	const { workspace, workspaces, isLoading } = useCurrentWorkspace();
	const teamsQuery = useQuery({
		queryKey: teamKeys.mine(userId ?? "anonymous"),
		queryFn: listMyTeams,
		enabled: Boolean(userId),
		staleTime: 30 * 1000,
	});
	const anyWaiting = (overview?.approvals_waiting ?? 0) > 0;
	const waitingQuery = useQuery({
		...waitingFirstPage(userId),
		enabled: Boolean(userId) && anyWaiting,
	});

	const teams = useMemo(() => {
		const out: Record<string, string | null> = {};
		for (const team of teamsQuery.data ?? []) {
			if (team?.id) out[team.id] = team.workspace_id ?? null;
		}
		return out as TeamWorkspaces;
	}, [teamsQuery.data]);
	const defaultId = useMemo(
		() => pickDefaultWorkspace(workspaces)?.id ?? null,
		[workspaces],
	);
	const current = isLoading ? undefined : (workspace?.id ?? null);
	// Only once the list has loaded may anything count as "outside".
	const members = useMemo(
		() => (isLoading ? undefined : workspaces.map((item) => item.id)),
		[isLoading, workspaces],
	);
	const scope = useMemo<WorkspaceScope>(
		() => ({
			current,
			isDefault: Boolean(current) && current === defaultId,
			teams,
			members,
			defaultId,
		}),
		[current, defaultId, teams, members],
	);
	// A9's cached list: a project shared from outside opens the default
	// workspace's Time.
	const projectsQuery = useQuery({
		...timeQueries.myProjects(userId),
		enabled: Boolean(userId),
	});
	const names = useMemo(() => {
		const out: Record<string, string> = {};
		for (const item of workspaces) out[item.id] = item.name;
		return out;
	}, [workspaces]);
	const waitingRows = useMemo(
		() => (anyWaiting ? (waitingQuery.data?.items ?? []) : []),
		[anyWaiting, waitingQuery.data],
	);

	return useMemo(() => {
		// No workspace at all: the account-wide gate (can log, waiting, admin).
		const visible =
			!overview || current === undefined
				? null
				: current === null
					? overview.can_log === true ||
						(overview.approvals_waiting ?? 0) > 0 ||
						(overview.workspace_time_admin?.length ?? 0) > 0
					: timeVisibleInWorkspace({
							scope,
							contexts: overview.contexts,
							admins: overview.workspace_time_admin,
							waiting: waitingRows,
							projects: projectsQuery.data?.projects,
							canLog: overview.can_log,
						});
		return {
			scope,
			workspaceName: workspace?.name ?? null,
			names,
			waitingRows,
			waitingHere: waitingHereCount(waitingRows, scope),
			elsewhere: waitingElsewhere(waitingRows, scope, names),
			visible,
		};
	}, [
		overview,
		current,
		scope,
		workspace?.name,
		names,
		waitingRows,
		projectsQuery.data,
	]);
}
