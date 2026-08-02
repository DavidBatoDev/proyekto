import { createFileRoute } from "@tanstack/react-router";
import { TeamPageLayout } from "@/components/project/TeamPageLayout";
import { ProjectInvitesPage } from "@/components/project/people/ProjectInvitesPage";

export const Route = createFileRoute("/project/$projectId/team/invites")({
	component: RouteComponent,
});

function RouteComponent() {
	const { projectId } = Route.useParams();

	return (
		<TeamPageLayout projectId={projectId}>
			<ProjectInvitesPage projectId={projectId} />
		</TeamPageLayout>
	);
}
