import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useEffect } from "react";
import { AppSurfaceCard } from "@/components/common/AppPrimitives";
import {
	getTeam,
	hasAnyActiveRate,
	listTeamMembers,
} from "@/services/teams.service";
import { useUser } from "@/stores/authStore";

export const Route = createFileRoute("/w/$workspaceSlug/teams/$teamId/time/")({
	component: TimeIndexRedirect,
});

/**
 * Resolves which tab the caller should land on for /teams/$teamId/time:
 *   - "my-logs" if the caller has a rate set
 *   - else "manage-rates" if owner/admin
 *   - else render the no-access fallback
 *
 * Uses useNavigate inside an effect rather than `throw redirect()` —
 * the latter is only valid from `loader`/`beforeLoad`. The required
 * data (team + members) is async, so doing it in beforeLoad would
 * mean blocking on a fetch before the route mounts; redirecting after
 * mount is simpler and the layout already renders the same data.
 */
function TimeIndexRedirect() {
	const { workspaceSlug, teamId } = Route.useParams();
	const user = useUser();
	const navigate = useNavigate();

	const teamQuery = useQuery({
		queryKey: ["team", teamId],
		queryFn: () => getTeam(teamId),
	});
	const membersQuery = useQuery({
		queryKey: ["team", teamId, "members"],
		queryFn: () => listTeamMembers(teamId),
	});
	const myActiveRateQuery = useQuery({
		queryKey: ["team", teamId, "rates", "anyActive", user?.id],
		queryFn: () => hasAnyActiveRate(teamId, user!.id),
		enabled: Boolean(user?.id),
	});

	const team = teamQuery.data;
	const myMembership = membersQuery.data?.find((m) => m.user_id === user?.id);
	const isApprover =
		team?.owner_id === user?.id ||
		myMembership?.role === "admin" ||
		myMembership?.role === "owner";
	const isTeamMember = Boolean(myMembership);

	const allLoaded =
		teamQuery.isSuccess &&
		membersQuery.isSuccess &&
		(!user?.id || myActiveRateQuery.isFetched);

	const target:
		| "/w/$workspaceSlug/teams/$teamId/time/my-logs"
		| "/w/$workspaceSlug/teams/$teamId/time/team-logs"
		| "/w/$workspaceSlug/teams/$teamId/time/manage-rates"
		| null = allLoaded
		? isTeamMember
			? "/w/$workspaceSlug/teams/$teamId/time/my-logs"
			: isApprover
				? "/w/$workspaceSlug/teams/$teamId/time/team-logs"
				: null
		: null;

	useEffect(() => {
		if (target) {
			void navigate({
				to: target,
				params: { workspaceSlug, teamId },
				replace: true,
			});
		}
	}, [target, navigate, teamId]);

	if (!allLoaded || target) {
		return (
			<div className="flex justify-center p-12">
				<Loader2 className="h-6 w-6 animate-spin text-slate-400" />
			</div>
		);
	}

	return (
		<AppSurfaceCard>
			<div className="space-y-3 p-6 text-sm text-slate-600">
				<p>You don't have access to time tracking on this team.</p>
				<Link
					to="/w/$workspaceSlug/teams/$teamId"
					params={{ workspaceSlug, teamId }}
					className="text-sky-600 hover:underline"
				>
					Back to team
				</Link>
			</div>
		</AppSurfaceCard>
	);
}
