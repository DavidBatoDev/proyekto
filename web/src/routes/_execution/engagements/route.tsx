import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { EngagementsShell } from "@/components/layout/EngagementsShell";
import { useAuthStore } from "@/stores/authStore";

/**
 * Auth and chrome for everything under `/engagements`.
 *
 * The shell used to start one level down, at `/engagements/finance`, so the
 * engagement list and detail pages rendered full-page and the sidebar
 * disappeared the moment you left finance — from inside the same section. It
 * now wraps the whole subtree: the guard and shell live here and every child
 * renders bare content, following `routes/settings/route.tsx`.
 *
 * The finance-specific chrome (section tabs, filters, breadcrumbs) is NOT
 * here: it belongs to the `finance/_portfolio` layout further in, because the
 * contract and invoice editors are full-page documents that must not inherit a
 * tab bar.
 */
export const Route = createFileRoute("/_execution/engagements")({
	beforeLoad: ({ location }) => {
		if (!useAuthStore.getState().isAuthenticated) {
			throw redirect({
				to: "/auth/login",
				search: { redirect: location.href },
			});
		}
	},
	component: EngagementsLayout,
});

function EngagementsLayout() {
	return (
		<EngagementsShell>
			<Outlet />
		</EngagementsShell>
	);
}
