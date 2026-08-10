import { createFileRoute } from "@tanstack/react-router";
import { PermissionCatalogPage } from "@/components/project/people/PermissionCatalogPage";
import { ProjectTeamAdminGate } from "@/components/project/people/ProjectTeamAdminGate";
import { TeamPageLayout } from "@/components/project/TeamPageLayout";

export const Route = createFileRoute("/project/$projectId/team/catalog")({
	component: RouteComponent,
});

function RouteComponent() {
	const { projectId } = Route.useParams();

	return (
		<TeamPageLayout projectId={projectId}>
			<ProjectTeamAdminGate projectId={projectId}>
				<PermissionCatalogPage />
			</ProjectTeamAdminGate>
		</TeamPageLayout>
	);
}
