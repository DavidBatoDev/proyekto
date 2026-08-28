import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { MarketplaceShell } from "@/components/layout/MarketplaceShell";
import { useAuthStore } from "@/stores/authStore";

/**
 * Auth and chrome for everything under `/marketplace/finance`.
 *
 * The four section pages, the contract editor, and the two invoice editors each
 * used to repeat this `beforeLoad` and wrap themselves in `MarketplaceShell`.
 * Six copies of one rule is how a page ends up with the sidebar but no guard,
 * or the reverse — so the layout owns both and every child renders bare
 * content, following `routes/settings/route.tsx`.
 *
 * The finance-specific chrome (section tabs, filters, breadcrumbs) is NOT here:
 * it belongs to the `_portfolio` layout nested inside, because the contract and
 * invoice editors are full-page documents that must not inherit a tab bar.
 */
export const Route = createFileRoute("/marketplace/finance")({
	beforeLoad: () => {
		if (!useAuthStore.getState().isAuthenticated) {
			throw redirect({ to: "/auth/login" });
		}
	},
	component: FinanceLayout,
});

function FinanceLayout() {
	return (
		<MarketplaceShell>
			<Outlet />
		</MarketplaceShell>
	);
}
