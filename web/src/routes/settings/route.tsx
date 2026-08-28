import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { AccountSettingsLayout } from "@/components/settings/AccountSettingsLayout";
import { useAuthStore } from "@/stores/authStore";

/**
 * Chrome and auth for every settings page.
 *
 * Settings belongs to neither shell — it is reachable from execution and from
 * the marketplace alike — so it owns its own layout rather than being forced
 * under `_execution`. Making it a child of one shell would turn a cross-shell
 * jump into a mode switch the moment the two chromes diverge.
 *
 * Owning the layout here is also what lets each page render bare content: the
 * three settings routes used to import DashboardShell individually, which is
 * how a page ends up with the sidebar but no auth guard, or the reverse.
 *
 * It also owns the settings nav (AccountSettingsLayout), so every section -
 * including one reached by a deep link from email - lands with the rail around
 * it rather than as a bare page with no way back to the rest of settings.
 */
export const Route = createFileRoute("/settings")({
	beforeLoad: () => {
		if (!useAuthStore.getState().isAuthenticated) {
			throw redirect({ to: "/auth/login" });
		}
	},
	component: SettingsLayout,
});

function SettingsLayout() {
	return (
		<DashboardShell>
			<AccountSettingsLayout>
				<Outlet />
			</AccountSettingsLayout>
		</DashboardShell>
	);
}
