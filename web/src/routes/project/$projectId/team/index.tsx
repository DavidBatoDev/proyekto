import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { PersonAccessDrawerForMember } from "@/components/project/people/PersonAccessDrawerForMember";
import { ProjectTeamsPage } from "@/components/project/people/ProjectTeamsPage";
import { TeamMembersPage } from "@/components/project/people/TeamMembersPage";
import { TeamPageLayout } from "@/components/project/TeamPageLayout";
import { useUser } from "@/stores/authStore";

export const Route = createFileRoute("/project/$projectId/team/")({
	validateSearch: (search: Record<string, unknown>): { memberId?: string } => ({
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
			<div className="space-y-10">
				<ProjectTeamsPage
					projectId={projectId}
					onOpenPerson={(person) =>
						void navigate({
							to: "/project/$projectId/team",
							params: { projectId },
							search: { memberId: person.memberId },
							replace: true,
						})
					}
				/>
				<TeamMembersPage
					projectId={projectId}
					onOpenPerson={(person) =>
						void navigate({
							to: "/project/$projectId/team",
							params: { projectId },
							search: { memberId: person.memberId },
							replace: true,
						})
					}
				/>
			</div>
			{memberId && (
				<PersonAccessDrawerForMember
					projectId={projectId}
					memberId={memberId}
					callerUserId={user?.id ?? null}
					onClose={() =>
						void navigate({
							to: "/project/$projectId/team",
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
