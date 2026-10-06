import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { useAuthStore } from "@/stores/authStore";

/**
 * Auth and chrome for everything under the bare `/time` (ux.md › The Time
 * Page, CHANGE-10): the Time page itself and the timesheet review screen.
 *
 * A layout route rather than a sibling `time.tsx`: a sibling would become the
 * parent of `time/timesheets/$timesheetId` and swallow it. The guard and the
 * shell live here, so both children render bare content inside the same
 * `_execution` frame as `/meetings` and `/command-center`. Accounts with no
 * workspace still reach it — nothing here reads one.
 *
 * Guests never get this far: they are not authenticated, and the API answers
 * 404 for them on every time route anyway (L44).
 */
export const Route = createFileRoute("/_execution/time")({
	beforeLoad: ({ location }) => {
		if (!useAuthStore.getState().isAuthenticated) {
			// Keep the deep link: notifications and emails point at
			// /time/timesheets/<id> and /time?entry=<id>.
			throw redirect({
				to: "/auth/login",
				search: { redirect: location.href },
			});
		}
	},
	component: TimeLayout,
});

function TimeLayout() {
	return (
		<DashboardShell>
			<Outlet />
		</DashboardShell>
	);
}
