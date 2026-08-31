import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import Header from "../components/layout/Header";
import { NotFoundRoute } from "../components/layout/NotFoundRoute";
import { MigrationHandler } from "../components/migration";
import { AppUpdateGate } from "../components/mobile/AppUpdateGate";
import { FloatingActiveTimer } from "../components/team-time/FloatingActiveTimer";
import { ToastProvider } from "../contexts/ToastContext";
import { ConfirmProvider } from "../hooks/useConfirm";
import { usePushNotifications } from "../hooks/usePushNotifications";

const DevelopmentDevtools = import.meta.env.DEV
	? lazy(() => import("../integrations/tanstack-query/DevelopmentDevtools"))
	: null;

interface MyRouterContext {
	queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
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
