import { createFileRoute, redirect } from "@tanstack/react-router";
import { teamTimeService } from "@/services/team-time.service";
import { useAuthStore } from "@/stores/authStore";

/**
 * Legacy deep link to a log's detail *page*.
 *
 * The detail is now a dialog over the log list (see TimeLogDetailModal): the
 * page version rendered its own `DashboardShell` inside the one the Time layout
 * already renders, which is where the duplicated sidebar came from. This route
 * survives only to keep existing links working — it resolves which list the log
 * belongs to and hands off to it with `?log=<id>`, which opens the dialog.
 */
export const Route = createFileRoute(
	"/_execution/teams/$teamId/time/log/$logId",
)({
	beforeLoad: async ({ params }) => {
		const { isAuthenticated, user } = useAuthStore.getState();
		if (!isAuthenticated) throw redirect({ to: "/auth/login" });

		// Own logs belong under My Logs, anyone else's under Team Logs (which only
		// approvers can open — the API enforces that either way). A lookup failure
		// falls back to My Logs rather than dead-ending on an error page.
		let isOwn = true;
		try {
			const log = await teamTimeService.getLog(params.logId);
			isOwn = !user?.id || log.member_user_id === user.id;
		} catch {
			isOwn = true;
		}

		if (isOwn) {
			throw redirect({
				to: "/teams/$teamId/time/my-logs",
				params: { teamId: params.teamId },
				search: { log: params.logId },
				replace: true,
			});
		}
		throw redirect({
			to: "/teams/$teamId/time/team-logs",
			params: { teamId: params.teamId },
			search: { log: params.logId },
			replace: true,
		});
	},
});
