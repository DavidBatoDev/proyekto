import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { WorkspaceSettingsLayout } from "@/components/workspace/settings/WorkspaceSettingsLayout";
import { useAuthStore } from "@/stores/authStore";

/**
 * Chrome and auth for every workspace settings page — the same split as
 * `routes/settings/route.tsx`: the layout route owns the guard and the rail so
 * each section renders bare content and a deep link still lands with
 * navigation around it.
 *
 * The URL carries no tenant segment: which workspace these pages act on comes
 * from the selection store, not the path.
 */
export const Route = createFileRoute("/workspace")({
	beforeLoad: ({ location }) => {
		if (!useAuthStore.getState().isAuthenticated) {
			throw redirect({ to: "/auth/login" });
		}
		// Bare /workspace has no page of its own — land on General instead of an
		// empty outlet.
		if (
			location.pathname === "/workspace" ||
			location.pathname === "/workspace/"
		) {
			throw redirect({ to: "/workspace/settings" });
		}
	},
	component: WorkspaceLayout,
});

function WorkspaceLayout() {
	return (
		<ProtectedRoute loadingFallback={null}>
			<div className="app-shell-bg flex min-h-screen bg-background pt-app-header text-foreground">
				<div className="min-w-0 flex-1">
					<WorkspaceSettingsLayout>
						<Outlet />
					</WorkspaceSettingsLayout>
				</div>
			</div>
		</ProtectedRoute>
	);
}
