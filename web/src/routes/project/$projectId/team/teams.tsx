import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { TeamPageLayout } from "@/components/project/TeamPageLayout";
import { PersonAccessDrawerForMember } from "@/components/project/people/PersonAccessDrawerForMember";
import { ProjectTeamsPage } from "@/components/project/people/ProjectTeamsPage";
import { useUser } from "@/stores/authStore";

export const Route = createFileRoute("/project/$projectId/team/teams")({
	validateSearch: (
		search: Record<string, unknown>,
	): { memberId?: string } => ({
		memberId: (search.memberId as string) || undefined,
	}),
	component: RouteComponent,
});

function RouteComponent() {
	const { projectId } = Route.useParams();
	const { memberId } = Route.useSearch();
	const navigate = useNavigate();
	const user = useUser();

	return (
		<TeamPageLayout projectId={projectId}>
			<ProjectTeamsPage
				projectId={projectId}
				onOpenPerson={(person) =>
					void navigate({
						to: "/project/$projectId/team/teams",
						params: { projectId },
						search: { memberId: person.memberId },
						replace: true,
					})
				}
			/>
			{memberId && (
				<PersonAccessDrawerForMember
					projectId={projectId}
					memberId={memberId}
					callerUserId={user?.id ?? null}
					onClose={() =>
						void navigate({
							to: "/project/$projectId/team/teams",
							params: { projectId },
							search: {},
							replace: true,
						})
					}
				/>
			)}
		</TeamPageLayout>
	);
}
