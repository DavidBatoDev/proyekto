import { createFileRoute, Outlet } from "@tanstack/react-router";
import { MarketplaceCategoryBar } from "@/components/marketplace/home/MarketplaceCategoryBar";
import { MarketplaceFooter } from "@/components/marketplace/MarketplaceFooter";

/**
 * The `/marketplace/category` layout.
 *
 * Carries the same category strip and footer as the marketplace home so
 * browsing stays continuous, and deliberately does not opt into
 * `MarketplaceShell`: these pages are public, indexable, and must render for
 * anonymous visitors, which the shell's `ProtectedRoute` would prevent.
 */
export const Route = createFileRoute("/marketplace/category")({
	component: MarketplaceCategoryLayout,
});

function MarketplaceCategoryLayout() {
	return (
		<div className="min-h-screen bg-background pt-app-header">
			<MarketplaceCategoryBar />
			<Outlet />
			<MarketplaceFooter />
		</div>
	);
}
