import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { AppSurfaceCard } from "@/components/common/AppPrimitives";
import { useUser } from "@/stores/authStore";
import { getTeam, listTeamMembers } from "@/services/teams.service";

export const Route = createFileRoute("/teams/$teamId/time/")({
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
	const { teamId } = Route.useParams();
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

	const team = teamQuery.data;
	const myMembership = membersQuery.data?.find((m) => m.user_id === user?.id);
	const isApprover =
		team?.owner_id === user?.id ||
		myMembership?.role === "admin" ||
		myMembership?.role === "owner";
	const hasOwnRate = myMembership?.hourly_rate != null;

	const target:
		| "/teams/$teamId/time/my-logs"
		| "/teams/$teamId/time/manage-rates"
		| null =
		teamQuery.isSuccess && membersQuery.isSuccess
			? hasOwnRate
				? "/teams/$teamId/time/my-logs"
				: isApprover
					? "/teams/$teamId/time/manage-rates"
					: null
			: null;

	useEffect(() => {
		if (target) {
			void navigate({
				to: target,
				params: { teamId },
				replace: true,
			});
		}
	}, [target, navigate, teamId]);

	if (teamQuery.isPending || membersQuery.isPending || target) {
		return (
			<div className="flex justify-center p-12">
				<Loader2 className="h-6 w-6 animate-spin text-slate-400" />
			</div>
		);
	}

	return (
		<AppSurfaceCard>
			<div className="space-y-3 p-6 text-sm text-slate-600">
				<p>
					You don't have a rate set on this team yet, and you're not an admin.
					Ask the team owner to give you a rate so you can start logging time.
				</p>
				<Link
					to="/teams/$teamId"
					params={{ teamId }}
					className="text-sky-600 hover:underline"
				>
					Back to team
				</Link>
			</div>
		</AppSurfaceCard>
	);
}
