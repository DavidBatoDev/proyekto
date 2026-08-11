import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import Header from "../components/layout/Header";
import { MigrationHandler } from "../components/migration";
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
				{DevelopmentDevtools && (
					<Suspense fallback={null}>
						<DevelopmentDevtools />
					</Suspense>
				)}
			</ConfirmProvider>
		</ToastProvider>
	);
}
