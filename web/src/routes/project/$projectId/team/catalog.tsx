import { createFileRoute } from "@tanstack/react-router";
import { TeamPageLayout } from "@/components/project/TeamPageLayout";
import { PermissionCatalogPage } from "@/components/project/people/PermissionCatalogPage";

export const Route = createFileRoute("/project/$projectId/team/catalog")({
	component: RouteComponent,
});

function RouteComponent() {
	const { projectId } = Route.useParams();

	return (
		<TeamPageLayout projectId={projectId}>
			<PermissionCatalogPage />
		</TeamPageLayout>
	);
}
