import { Link } from "@tanstack/react-router";
import { ArrowRight, Users } from "lucide-react";
import { RoadmapStartOptions } from "@/components/roadmap/RoadmapStartDialog";
import { useCurrentWorkspace } from "@/hooks/useWorkspaceQueries";
import { useAuthStore } from "@/stores/authStore";

/**
 * The whole dashboard, for an account with nothing on it yet.
 *
 * What used to render here was Teams, Projects, Roadmaps, Meetings and
 * Activity — five panels, all of them saying some version of "nothing here",
 * with the actual way in tucked behind a button in the corner. The sections
 * are worth their space the moment they have something to show and not one
 * second before, so on a blank account they do not render at all and this
 * takes the page.
 *
 * The three cards are the same `RoadmapStartOptions` the "Create roadmap"
 * button opens in a dialog, so the first thing a new user sees and the thing
 * every later button offers are the same three doors, described the same way.
 */
export function DashboardEmptyState() {
	const { profile } = useAuthStore();
	const { workspace } = useCurrentWorkspace();

	const greetingName =
		profile?.display_name ||
		profile?.first_name ||
		(profile?.email ? profile.email.split("@")[0] : "there");

	return (
		<div className="app-surface-card-strong p-5 sm:p-8">
			<div className="mb-6 max-w-xl">
				<h2 className="text-lg font-semibold tracking-tight text-slate-900 sm:text-[22px]">
					Welcome, {greetingName} — let's get your first project moving
				</h2>
				<p className="mt-1 text-sm text-slate-600">
					Start with a roadmap: it is the plan everything else in Proyekto hangs
					off. Projects, teams and meetings appear here as you add them.
				</p>
			</div>

			<RoadmapStartOptions />

			{workspace ? (
				<div className="mt-6 border-t border-border pt-4">
					<Link
						to="/w/$workspaceSlug/teams"
						params={{ workspaceSlug: workspace.slug }}
						className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
					>
						<Users className="h-4 w-4" />
						Or invite your team first
						<ArrowRight className="h-3.5 w-3.5" />
					</Link>
				</div>
			) : null}
		</div>
	);
}
