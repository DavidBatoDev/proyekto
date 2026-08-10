import { createFileRoute } from "@tanstack/react-router";
import { ProjectInvitesPage } from "@/components/project/people/ProjectInvitesPage";
import { ProjectTeamAdminGate } from "@/components/project/people/ProjectTeamAdminGate";
import { TeamPageLayout } from "@/components/project/TeamPageLayout";

export const Route = createFileRoute("/project/$projectId/team/invites")({
	component: RouteComponent,
});

function RouteComponent() {
	const { projectId } = Route.useParams();

	return (
		<TeamPageLayout projectId={projectId}>
			<ProjectTeamAdminGate projectId={projectId}>
				<ProjectInvitesPage projectId={projectId} />
			</ProjectTeamAdminGate>
		</TeamPageLayout>
	);
}
