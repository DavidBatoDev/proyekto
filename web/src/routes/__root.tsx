import { TanStackDevtools } from "@tanstack/react-devtools";
import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import TanStackQueryDevtools from "../integrations/tanstack-query/devtools";
import { ToastProvider } from "../contexts/ToastContext";
import { MigrationHandler } from "../components/migration";
import Header from "../components/layout/Header";
import { FreelancerSystemStatusLayer } from "../components/layout/FreelancerSystemStatusLayer";

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
