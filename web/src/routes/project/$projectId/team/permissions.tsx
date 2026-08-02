import { createFileRoute } from "@tanstack/react-router";
import { TeamPageLayout } from "@/components/project/TeamPageLayout";
import { PermissionsLanding } from "@/components/project/people/PermissionsLanding";
import { ProjectPermissionsEditor } from "@/components/project/people/ProjectPermissions";

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
			{memberId || role ? (
				<ProjectPermissionsEditor
					projectId={projectId}
					memberId={memberId}
					role={role}
				/>
			) : (
				<PermissionsLanding projectId={projectId} />
			)}
		</TeamPageLayout>
	);
}
