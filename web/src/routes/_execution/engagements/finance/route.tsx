import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { FinanceShell } from "@/components/layout/FinanceShell";
import { useAuthStore } from "@/stores/authStore";

/**
 * Auth and chrome for everything under `/engagements/finance`.
 *
 * Moved from `/marketplace/finance` so team finance could sit next to the
 * consultant's personal book without inheriting the marketplace's consultant
 * gate. The layout owns the guard and shell so every child renders bare
 * content, following `routes/settings/route.tsx`.
 *
 * The finance-specific chrome (section tabs, filters, breadcrumbs) is NOT here:
 * it belongs to the `_portfolio` layout nested inside, because the contract and
 * invoice editors are full-page documents that must not inherit a tab bar.
 *
 * Deliberately not an `engagements/route.tsx`: the engagements list and detail
 * pages carry their own ProtectedRoute + shell inline and must stay full-page.
 */
export const Route = createFileRoute("/_execution/engagements/finance")({
	beforeLoad: () => {
		if (!useAuthStore.getState().isAuthenticated) {
			throw redirect({ to: "/auth/login" });
		}
	},
	component: FinanceLayout,
});

function FinanceLayout() {
	return (
		<FinanceShell>
			<Outlet />
		</FinanceShell>
	);
}
