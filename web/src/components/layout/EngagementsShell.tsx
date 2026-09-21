import type { ReactNode } from "react";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { EngagementsSidebarContent } from "./sidebar/EngagementsSidebarContent";

/**
 * Chrome for everything under `/engagements` — the engagement list and detail
 * pages as well as the finance surfaces beneath them.
 *
 * Same structure as MarketplaceShell (the header is global in __root.tsx, and
 * `pt-app-header` reserves its height), but with the engagements navigation:
 * finance moved out of the marketplace so its team sections could be reachable
 * by project admins who are not marketplace consultants, and the shell then
 * rose from `/engagements/finance` to `/engagements` so the list and detail
 * pages stop dropping the sidebar on the way in.
 */
export function EngagementsShell({ children }: { children: ReactNode }) {
	return (
		<ProtectedRoute loadingFallback={null}>
			<div className="app-shell-bg flex min-h-screen bg-background pt-app-header text-foreground">
				<aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-[260px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground backdrop-blur lg:flex">
					<EngagementsSidebarContent />
				</aside>
				<main className="min-w-0 flex-1">{children}</main>
			</div>
		</ProtectedRoute>
	);
}
