import { TanStackDevtools } from "@tanstack/react-devtools";
import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { FreelancerSystemStatusLayer } from "../components/layout/FreelancerSystemStatusLayer";
import Header from "../components/layout/Header";
import { MigrationHandler } from "../components/migration";
import { FloatingActiveTimer } from "../components/team-time/FloatingActiveTimer";
import { ToastProvider } from "../contexts/ToastContext";
import TanStackQueryDevtools from "../integrations/tanstack-query/devtools";

interface MyRouterContext {
	queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
	component: RootLayout,
});

function RootLayout() {
	return (
		<ToastProvider>
			<Header />
			<FreelancerSystemStatusLayer />
			<Outlet />
			<FloatingActiveTimer />
			<MigrationHandler />
			<TanStackDevtools
				config={{
					position: "bottom-right",
				}}
				plugins={[
					{
						name: "Tanstack Router",
						render: <TanStackRouterDevtoolsPanel />,
					},
					TanStackQueryDevtools,
				]}
			/>
		</ToastProvider>
	);
}
