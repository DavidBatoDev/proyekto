import type { QueryClient } from "@tanstack/react-query";
import {
	createRootRouteWithContext,
	Outlet,
	redirect,
} from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { PlanLimitBridge } from "../components/billing/PlanLimitBridge";
import Header from "../components/layout/Header";
import { NotFoundRoute } from "../components/layout/NotFoundRoute";
import { MigrationHandler } from "../components/migration";
import { AppUpdateGate } from "../components/mobile/AppUpdateGate";
import { FloatingActiveTimer } from "../components/team-time/FloatingActiveTimer";
import { ToastProvider } from "../contexts/ToastContext";
import { ConfirmProvider } from "../hooks/useConfirm";
import { usePushNotifications } from "../hooks/usePushNotifications";
import { isNativeApp } from "../lib/platform";
import { nativeDestinationFor } from "../lib/platformSurfaces";

const DevelopmentDevtools = import.meta.env.DEV
	? lazy(() => import("../integrations/tanstack-query/DevelopmentDevtools"))
	: null;

interface MyRouterContext {
	queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
	/**
	 * The one gate that keeps commerce and the marketplace out of the installed
	 * app (see lib/platformSurfaces.ts for what is hidden and why).
	 *
	 * It lives on the ROOT because the router runs this for every match on
	 * every navigation — first paint, client navigation, `history.replace`, and
	 * a full page load. That one property closes every door at once: a push tap
	 * resolved by `lib/pushLink.ts`, a years-old `notifications.link_url` that
	 * NotificationBell assigns to `window.location`, a `signup_redirect` with
	 * no TTL arriving from an email, and the legacy rewrites NotFoundRoute
	 * forwards. All of them end up as a pathname here, so none of them needs
	 * its own check.
	 *
	 * It also runs BEFORE the matched route's loader, so a hidden page never
	 * mounts and no price is ever painted — a component-level guard would
	 * render a frame first, and that frame is the screenshot in a store
	 * rejection.
	 *
	 * Two rules for whoever edits this next: keep the `isNativeApp()` check
	 * first, so a browser pays one boolean per navigation (this also runs on
	 * hover preloads), and never `return` a value — a root beforeLoad's return
	 * merges into the router context of every route in the app.
	 */
	beforeLoad: ({ location }) => {
		if (!isNativeApp()) return;
		const to = nativeDestinationFor(location.pathname);
		if (to) throw redirect({ href: to, replace: true });
	},
	component: RootLayout,
	// Also the landing spot for URLs that moved under /marketplace — see
	// NotFoundRoute, which forwards legacy paths before showing anything.
	notFoundComponent: NotFoundRoute,
});

function RootLayout() {
	// Native FCM push lifecycle (no-op on web). Lives here so it can navigate on tap.
	usePushNotifications();

	return (
		<ToastProvider>
			<ConfirmProvider>
				{/* Shows the upgrade prompt for any write a plan limit blocked.
				    Inside the toast provider and the router: it does both. */}
				<PlanLimitBridge />
				<Header />
				<Outlet />
				<FloatingActiveTimer />
				<MigrationHandler />
				{/* Native-only; renders nothing on web and nothing unless the
				    backend says this shell is out of date. */}
				<AppUpdateGate />
				{DevelopmentDevtools && (
					<Suspense fallback={null}>
						<DevelopmentDevtools />
					</Suspense>
				)}
			</ConfirmProvider>
		</ToastProvider>
	);
}
