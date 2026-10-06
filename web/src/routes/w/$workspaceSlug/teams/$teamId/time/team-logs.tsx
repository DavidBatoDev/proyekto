import { createFileRoute, redirect } from "@tanstack/react-router";
import {
	isUuid,
	validateTeamTimeReportSearch,
	validateTimePageSearch,
} from "@/lib/timeSearch";
import { timeQueries } from "@/queries/time";
import { useAuthStore } from "@/stores/authStore";

/**
 * Old "Team Logs" tab, kept only so old links resolve (ux.md › Routes and
 * Redirects). Approving moved to `/time`, the team's figures to the Report:
 *
 * - `?log=X` → `/time/timesheets/<sheet holding X>?entry=X` when the caller
 *   can open that sheet, else `/time?entry=X` (the Time page shows the entry,
 *   or its "doesn't exist or you can't open it" card). Comment notifications
 *   sent before D79 carry this shape.
 * - `?member=U` → the Report filtered to that person,
 *   `/w/<s>/teams/<t>/time?person=U` (the Report's own index sends anyone who
 *   does not manage the team on to `/time`).
 * - No `log` or `member` (the stored approval-request links): a decider with
 *   timesheets waiting → `/time#waiting`; anyone else → `/time`.
 *
 * Every lookup failure falls through to `/time`, never to an error page.
 */
export const Route = createFileRoute(
	"/w/$workspaceSlug/teams/$teamId/time/team-logs",
)({
	validateSearch: (
		search: Record<string, unknown>,
	): { log?: string; member?: string } => {
		const read = (value: unknown) =>
			typeof value === "string" || typeof value === "number"
				? String(value).trim()
				: "";
		const log = read(search.log);
		const member = read(search.member);
		return {
			...(log ? { log } : {}),
			...(member ? { member } : {}),
		};
	},
	beforeLoad: async ({ params, search, context }) => {
		const { queryClient } = context;

		if (search.log) {
			const entryId = search.log;
			const fallback = redirect({
				to: "/time",
				search: validateTimePageSearch({ entry: entryId }),
				replace: true,
			});
			if (!isUuid(entryId)) throw fallback;
			const entry = await queryClient
				.fetchQuery({ ...timeQueries.entry(entryId), retry: false })
				.catch(() => null);
			const sheetId = entry?.timesheet_id ?? entry?.timesheet?.id ?? null;
			if (!sheetId) throw fallback;
			// can_view_timesheet: the sheet read answers 404 when the caller
			// cannot open it (a team manager on a workspace sheet, D49).
			const canView = await queryClient
				.fetchQuery({ ...timeQueries.timesheet(sheetId), retry: false })
				.then(() => true)
				.catch(() => false);
			if (!canView) throw fallback;
			throw redirect({
				to: "/time/timesheets/$timesheetId",
				params: { timesheetId: sheetId },
				search: { entry: entryId },
				replace: true,
			});
		}

		if (search.member) {
			throw redirect({
				to: "/w/$workspaceSlug/teams/$teamId/time",
				params: { workspaceSlug: params.workspaceSlug, teamId: params.teamId },
				search: validateTeamTimeReportSearch({ person: search.member }),
				replace: true,
			});
		}

		const userId = useAuthStore.getState().user?.id ?? null;
		const waiting = userId
			? await queryClient
					.fetchQuery({ ...timeQueries.approvalsCount(userId), retry: false })
					.then((count) => count.waiting)
					.catch(() => 0)
			: 0;
		if (waiting > 0) {
			throw redirect({ to: "/time", hash: "waiting", replace: true });
		}
		throw redirect({ to: "/time", replace: true });
	},
});
