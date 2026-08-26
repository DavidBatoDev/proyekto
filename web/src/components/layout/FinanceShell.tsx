import type { ReactNode } from "react";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { FinanceSidebarContent } from "./sidebar/FinanceSidebarContent";

/**
 * Chrome for the finance surfaces under `/engagements/finance`.
 *
 * Same structure as MarketplaceShell (the header is global in __root.tsx, and
 * `pt-app-header` reserves its height), but with finance-specific navigation:
 * finance moved out of the marketplace so its team sections could be reachable
 * by project admins who are not marketplace consultants.
 */
export function FinanceShell({ children }: { children: ReactNode }) {
	return (
		<ProtectedRoute loadingFallback={null}>
			<div className="app-shell-bg flex min-h-screen bg-background pt-app-header text-foreground">
				<aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-[260px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground backdrop-blur lg:flex">
					<FinanceSidebarContent />
				</aside>
				<main className="min-w-0 flex-1">{children}</main>
			</div>
		</ProtectedRoute>
	);
}
