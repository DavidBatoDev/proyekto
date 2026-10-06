import { createFileRoute, redirect } from "@tanstack/react-router";
import { ProjectSettingsLayout } from "@/components/project/ProjectSettingsLayout";
import { ProjectTimeSettings } from "@/components/project/time/ProjectTimeSettings";
import { useAuthStore } from "@/stores/authStore";

/**
 * Project settings › Time (ux.md › Settings › Project Surfaces): who can log
 * time here (A11), what the client sees (read-only), the rate and budget
 * calculator (web only) and the per-member hour limits.
 */
export const Route = createFileRoute(
	"/_execution/project/$projectId/settings/time",
)({
	beforeLoad: () => {
		const { isAuthenticated } = useAuthStore.getState();
		if (!isAuthenticated) throw redirect({ to: "/auth/login" });
	},
	component: ProjectTimeSettingsRoute,
});

function ProjectTimeSettingsRoute() {
	const { projectId } = Route.useParams();
	return (
		<ProjectSettingsLayout projectId={projectId}>
			<ProjectTimeSettings projectId={projectId} />
		</ProjectSettingsLayout>
	);
}
