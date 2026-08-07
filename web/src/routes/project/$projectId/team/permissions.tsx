import { createFileRoute } from "@tanstack/react-router";
import { PermissionsLanding } from "@/components/project/people/PermissionsLanding";
import { ProjectPermissionsEditor } from "@/components/project/people/ProjectPermissions";
import { ProjectTeamAdminGate } from "@/components/project/people/ProjectTeamAdminGate";
import { TeamPageLayout } from "@/components/project/TeamPageLayout";

export const Route = createFileRoute("/project/$projectId/team/permissions")({
	validateSearch: (
		search: Record<string, unknown>,
	): { memberId?: string; role?: string } => ({
		memberId: (search.memberId as string) || undefined,
		role: (search.role as string) || undefined,
	}),
	component: RouteComponent,
});

function RouteComponent() {
	const { projectId } = Route.useParams();
	const { memberId, role } = Route.useSearch();

	return (
		<TeamPageLayout projectId={projectId}>
			<ProjectTeamAdminGate projectId={projectId}>
				{memberId || role ? (
					<ProjectPermissionsEditor
						projectId={projectId}
						memberId={memberId}
						role={role}
					/>
				) : (
					<PermissionsLanding projectId={projectId} />
				)}
			</ProjectTeamAdminGate>
		</TeamPageLayout>
	);
}
