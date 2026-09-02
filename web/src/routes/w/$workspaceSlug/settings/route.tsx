import { createFileRoute, Outlet } from "@tanstack/react-router";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { WorkspaceSettingsLayout } from "@/components/workspace/settings/WorkspaceSettingsLayout";

/**
 * Chrome for every workspace settings page — the same rail/content split as
 * `routes/settings/route.tsx`. Auth and the workspace itself are already
 * settled by the parent `/w/$workspaceSlug` layout; this one only adds the
 * rail. `settings/index.tsx` is the General page, so bare …/settings needs no
 * redirect.
 */
export const Route = createFileRoute("/w/$workspaceSlug/settings")({
	component: WorkspaceSettingsRouteLayout,
});

function WorkspaceSettingsRouteLayout() {
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
