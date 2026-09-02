import { createFileRoute, redirect } from "@tanstack/react-router";
import { PrimaryFlow } from "@/components/home/LeftSide";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { TourRunner } from "@/components/tour/TourRunner";
import { useProfileQuery } from "@/hooks/useProfileQuery";
import { DASHBOARD_TOUR_KEY } from "@/lib/tours/dashboardTour";
import { TourDemoProvider } from "@/lib/tours/demo/TourDemoContext";
import { useAuthStore } from "@/stores/authStore";

export const Route = createFileRoute("/w/$workspaceSlug/dashboard")({
	beforeLoad: () => {
		const { isAuthenticated } = useAuthStore.getState();
		if (!isAuthenticated) {
			throw redirect({ to: "/auth/login" });
		}
	},
	component: DashboardPage,
});

function DashboardPage() {
	useProfileQuery();
	return (
		// The demo provider wraps the content, not the shell: a tour replay swaps
		// the dashboard's own data for fixtures, but the sidebar and header keep
		// showing the user's real workspace.
		<TourDemoProvider>
			<DashboardShell>
				<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 pb-10 app-slide-up">
					<PrimaryFlow />
				</div>
				<TourRunner tourKey={DASHBOARD_TOUR_KEY} />
			</DashboardShell>
		</TourDemoProvider>
	);
}
