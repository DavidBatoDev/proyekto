import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Clock } from "lucide-react";
import { TeamSettingsLayout } from "@/components/team/TeamSettingsLayout";
import { useAuthStore } from "@/stores/authStore";
import { getTeam } from "@/services/teams.service";

export const Route = createFileRoute("/teams/$teamId/settings/time")({
	beforeLoad: () => {
		const { isAuthenticated } = useAuthStore.getState();
		if (!isAuthenticated) {
			throw redirect({ to: "/auth/login" });
		}
	},
	component: TeamTimeSettings,
});

function TeamTimeSettings() {
	const { teamId } = Route.useParams();
	const teamQuery = useQuery({
		queryKey: ["teams", "detail", teamId],
		queryFn: () => getTeam(teamId),
	});

	return (
		<TeamSettingsLayout teamId={teamId} teamName={teamQuery.data?.name}>
			<section className="space-y-3">
				<div className="flex items-center gap-2">
					<Clock className="h-5 w-5 text-slate-700" />
					<h2 className="text-[30px] font-semibold leading-none text-slate-900">
						Time tracking
					</h2>
				</div>
				<div className="app-surface-card-strong overflow-hidden rounded-2xl">
					<div className="px-5 py-10 text-center text-sm text-slate-500">
						Time tracking summaries for this team will appear here. Coming
						soon — we'll surface logged hours per member, billable totals, and
						project breakdowns scoped to this team.
					</div>
				</div>
			</section>
		</TeamSettingsLayout>
	);
}
