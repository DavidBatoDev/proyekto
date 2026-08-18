import type { ReactNode } from "react";
import { ProtectedRoute } from "@/components/auth/ProtectedRoute";
import { MarketplaceSidebarContent } from "./sidebar/MarketplaceSidebarContent";

/**
 * Chrome for authenticated marketplace surfaces.
 *
 * Mirrors DashboardShell's structure (the header is global in __root.tsx, and
 * `pt-app-header` reserves its height) but carries marketplace navigation, so
 * the two halves of the product read as different places.
 *
 * NOT applied at the `_marketplace` layout route: that group also holds the
 * public, account-free `contract/sign/$token` page, which must never be wrapped
 * in ProtectedRoute. Pages opt in until the Phase 3 URL restructure moves the
 * authenticated ones under their own layout.
 */
export function MarketplaceShell({ children }: { children: ReactNode }) {
	return (
		<ProtectedRoute loadingFallback={null}>
			<div className="app-shell-bg flex min-h-screen bg-background pt-app-header text-foreground">
				<aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-[260px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground backdrop-blur lg:flex">
					<MarketplaceSidebarContent />
				</aside>
				<main className="min-w-0 flex-1">{children}</main>
			</div>
		</ProtectedRoute>
	);
}
