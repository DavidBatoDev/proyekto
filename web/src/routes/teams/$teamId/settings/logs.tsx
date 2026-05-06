import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ClipboardList } from "lucide-react";
import { TeamSettingsLayout } from "@/components/team/TeamSettingsLayout";
import { useAuthStore } from "@/stores/authStore";
import { getTeam } from "@/services/teams.service";

export const Route = createFileRoute("/teams/$teamId/settings/logs")({
	beforeLoad: () => {
		const { isAuthenticated } = useAuthStore.getState();
		if (!isAuthenticated) {
			throw redirect({ to: "/auth/login" });
		}
	},
	component: TeamLogsSettings,
});

function TeamLogsSettings() {
	const { teamId } = Route.useParams();
	const teamQuery = useQuery({
		queryKey: ["teams", "detail", teamId],
		queryFn: () => getTeam(teamId),
	});

	return (
		<TeamSettingsLayout teamId={teamId} teamName={teamQuery.data?.name}>
			<section className="space-y-3">
				<div className="flex items-center gap-2">
					<ClipboardList className="h-5 w-5 text-slate-700" />
					<h2 className="text-[30px] font-semibold leading-none text-slate-900">
						Activity logs
					</h2>
				</div>
				<div className="app-surface-card-strong overflow-hidden rounded-2xl">
					<div className="px-5 py-10 text-center text-sm text-slate-500">
						Audit log of team membership changes, invites, and project
						attachment events will appear here. Backed by the existing
						project-level activity feed once we wire team-scoped filtering.
					</div>
				</div>
			</section>
		</TeamSettingsLayout>
	);
}
