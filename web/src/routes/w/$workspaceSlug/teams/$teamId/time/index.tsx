import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { TeamTimeReport } from "@/components/time/report/TeamTimeReport";
import {
	validateTeamTimeReportSearch,
	validateTimePageSearch,
} from "@/lib/timeSearch";
import { getTeam, listTeamMembers } from "@/services/teams.service";
import { useAuthStore } from "@/stores/authStore";

/**
 * `/w/<slug>/teams/<t>/time`: the team Report (ux.md › Routes and Redirects).
 *
 * - A team manager gets the Report in place (this page used to redirect).
 * - A member is sent to their own time for the team, `/time?for=team:<t>`.
 * - Anyone else stays here and the layout shows the refusal card.
 *
 * The decision is made in `beforeLoad` so a member never sees the layout
 * flash. It reads the team and its members under the same keys
 * `useTeamMoneyAccess` uses, so the layout renders from the cache. A failed
 * read decides nothing: the page renders and the layout says what failed.
 */
export const Route = createFileRoute("/w/$workspaceSlug/teams/$teamId/time/")({
	validateSearch: validateTeamTimeReportSearch,
	beforeLoad: async ({ params, context }) => {
		const userId = useAuthStore.getState().user?.id;
		if (!userId) return;
		const standing = await Promise.all([
			context.queryClient.ensureQueryData({
				queryKey: ["team", params.teamId],
				queryFn: () => getTeam(params.teamId),
			}),
			context.queryClient.ensureQueryData({
				queryKey: ["team", params.teamId, "members"],
				queryFn: () => listTeamMembers(params.teamId),
			}),
		]).catch(() => null);
		if (!standing) return;
		const [team, members] = standing;
		const membership = members.find((member) => member.user_id === userId);
		const manages =
			team.owner_id === userId ||
			membership?.role === "owner" ||
			membership?.role === "admin";
		if (manages || !membership) return;
		throw redirect({
			to: "/time",
			search: validateTimePageSearch({ for: `team:${params.teamId}` }),
			replace: true,
		});
	},
	component: TeamTimeReportPage,
});

/**
 * The Report body. The layout (`route.tsx`) has already checked that the
 * caller manages the team and that team time is on, so this only mounts the
 * shared team Report (`components/time/report/TeamTimeReport`).
 */
function TeamTimeReportPage() {
	const { teamId } = Route.useParams();
	const search = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });

	return (
		<TeamTimeReport
			teamId={teamId}
			search={search}
			onSearchChange={(patch) =>
				void navigate({
					search: (prev) => ({ ...prev, ...patch }),
					replace: true,
				})
			}
		/>
	);
}
