import { createFileRoute } from "@tanstack/react-router";
import { PermissionsLanding } from "@/components/project/people/PermissionsLanding";
import { ProjectPermissionsEditor } from "@/components/project/people/ProjectPermissions";
import { ProjectTeamAdminGate } from "@/components/project/people/ProjectTeamAdminGate";
import { TeamPageLayout } from "@/components/project/TeamPageLayout";

export const Route = createFileRoute(
	"/_execution/project/$projectId/team/permissions",
)({
	validateSearch: (search: Record<string, unknown>): { memberId?: string } => ({
		memberId: (search.memberId as string) || undefined,
	}),
	component: RouteComponent,
});

function RouteComponent() {
	const { projectId } = Route.useParams();
	const { memberId } = Route.useSearch();

	return (
		<TeamPageLayout projectId={projectId}>
			<ProjectTeamAdminGate projectId={projectId}>
				{memberId ? (
					<ProjectPermissionsEditor projectId={projectId} memberId={memberId} />
				) : (
					<PermissionsLanding projectId={projectId} />
				)}
			</ProjectTeamAdminGate>
		</TeamPageLayout>
	);
}
