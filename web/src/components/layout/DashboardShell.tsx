import type { ReactNode } from "react";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { DashboardSidebar } from "./DashboardSidebar";

/**
 * The app frame: a fixed sidebar, the scrolling page, and optionally a fixed
 * rail on the right.
 *
 * `rail` is a sibling of `<main>`, not something inside the page, so a rail
 * behaves exactly as the sidebar does — full height, pinned, scrolling its own
 * contents while the page scrolls past it. A rail rendered inside the page
 * column can only ever be as tall as the row it sits in.
 */
export function DashboardShell({
	children,
	rail,
}: {
	children: ReactNode;
	rail?: ReactNode;
}) {
	return (
		<ProtectedRoute loadingFallback={null}>
			<div className="app-shell-bg flex min-h-screen bg-background pt-app-header text-foreground">
				<DashboardSidebar />
				{/* `relative` so an AnimatePresence popLayout exit inside the page
				    anchors to this column rather than to the document. */}
				<main className="relative min-w-0 flex-1 overflow-x-clip">
					{children}
				</main>
				{rail}
			</div>
		</ProtectedRoute>
	);
}
