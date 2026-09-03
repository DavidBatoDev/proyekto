import { createFileRoute, redirect } from "@tanstack/react-router";
import { AnimatePresence } from "framer-motion";
import { startTransition, useMemo } from "react";
import {
	AssistantModeSwitcher,
	DashboardAiFullscreen,
	DashboardAiRail,
} from "@/components/home/DashboardAiPanel";
import { PrimaryFlow } from "@/components/home/LeftSide";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { TourRunner } from "@/components/tour/TourRunner";
import { useProfileQuery } from "@/hooks/useProfileQuery";
import { DASHBOARD_TOUR_KEY } from "@/lib/tours/dashboardTour";
import { TourDemoProvider } from "@/lib/tours/demo/TourDemoContext";
import { useAuthStore } from "@/stores/authStore";

export const Route = createFileRoute("/w/$workspaceSlug/dashboard")({
	/**
	 * `?assistant=full` puts the expanded assistant in the URL, so it survives a
	 * refresh and can be linked to (`/w/acme/dashboard?assistant=full`).
	 *
	 * A search param rather than its own route on purpose: a route change would
	 * unmount the dashboard, and the whole point of the circular reveal is that
	 * the page underneath is never taken down. Staying on this route keeps it
	 * mounted and scrolled where it was. Anything unrecognised falls back to the
	 * collapsed view rather than erroring — a mangled link should still land you
	 * on a working dashboard.
	 */
	validateSearch: (search: Record<string, unknown>): { assistant?: "full" } =>
		// Returned as an absent key rather than an explicit `undefined`: a key
		// that is always present — even holding undefined — makes `search`
		// mandatory on every `Link` and `navigate` that targets this route, and
		// there are a dozen of those across the app.
		search.assistant === "full" ? { assistant: "full" } : {},
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

	// The URL is the source of truth for which shape the assistant is in, so a
	// refresh keeps it open and Back collapses it — no `replace`, because
	// closing an overlay is exactly what people expect Back to do.
	const { assistant } = Route.useSearch();
	const navigate = Route.useNavigate();
	const isAssistantFullscreen = assistant === "full";

	const setAssistantFullscreen = (open: boolean) => {
		// `startTransition` marks the router update as non-urgent, so React is
		// allowed to keep painting the opening animation instead of blocking on
		// the re-render the navigation causes. Without it the first frames of the
		// slide compete with a full route render — which is most of the lag on a
		// phone, where that render is not cheap.
		startTransition(() => {
			void navigate({
				search: (prev) => ({ ...prev, assistant: open ? "full" : undefined }),
			});
		});
	};

	// The dashboard body does not depend on anything that changes when the
	// assistant opens, so it is built once. Without this, every toggle re-renders
	// the whole grid tree — teams, projects, roadmap previews and their SVG
	// canvases — on the same frame the animation starts.
	const dashboardBody = useMemo(
		() => (
			<div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 pb-10 app-slide-up">
				<PrimaryFlow />
			</div>
		),
		[],
	);

	return (
		// The demo provider wraps the content, not the shell: a tour replay swaps
		// the dashboard's own data for fixtures, but the sidebar and header keep
		// showing the user's real workspace.
		<TourDemoProvider>
			{/* Nothing is unmounted when the assistant expands — not the
			    dashboard, not the rail. Both stay exactly as they are and the
			    fullscreen overlay is drawn on top of them, so the circular reveal
			    is the only thing that moves and it lands back on a page that never
			    went away. */}
			<DashboardShell
				rail={<DashboardAiRail onExpand={() => setAssistantFullscreen(true)} />}
			>
				{/* The dashboard is never taken down. The assistant is a fixed
				    overlay on top of it, so the circular reveal uncovers the real
				    page on the way in and lands back on it — already rendered, still
				    scrolled where it was — on the way out. Swapping the two would
				    replay the dashboard's entrance animations under a closing
				    circle, which is what makes a reveal look like a stutter. */}
				{dashboardBody}

				<AnimatePresence initial={false}>
					{isAssistantFullscreen && (
						<DashboardAiFullscreen
							key="assistant"
							onCollapse={() => setAssistantFullscreen(false)}
						/>
					)}
				</AnimatePresence>

				{/* Below xl there is no rail, so this is the only way to the
				    assistant — and the only way back. */}
				<AssistantModeSwitcher
					isAssistantOpen={isAssistantFullscreen}
					onChange={setAssistantFullscreen}
				/>
				<TourRunner tourKey={DASHBOARD_TOUR_KEY} />
			</DashboardShell>
		</TourDemoProvider>
	);
}
