import { Capacitor } from "@capacitor/core";
import { CapacitorUpdater } from "@capgo/capacitor-updater";
import { StrictMode } from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider, createRouter } from "@tanstack/react-router";

import * as TanStackQueryProvider from "./integrations/tanstack-query/root-provider.tsx";
import { AuthInitializer } from "./components/auth/AuthInitializer";

// Tell the OTA updater the web bundle booted OK, so it commits the new bundle
// instead of rolling back after appReadyTimeout. Fire as early as possible.
// No-op/harmless on web (native bridge absent → rejects), so the browser build
// and Vercel deploy are unaffected.
CapacitorUpdater.notifyAppReady().catch(() => {});

// Android 15 draws edge-to-edge; this plugin pads the WebView below the status bar
// and above the gesture nav (the Android WebView's env(safe-area-inset-*) is
// unreliable on Capacitor 7). Android-only — never loaded on iOS/web.
if (Capacitor.getPlatform() === "android") {
  void import("@capawesome/capacitor-android-edge-to-edge-support")
    .then(({ EdgeToEdge }) => EdgeToEdge.enable())
    .catch(() => {});
}

// Import the generated route tree
import { routeTree } from "./routeTree.gen";

import "./styles.css";
import "react-data-grid/lib/styles.css";
import reportWebVitals from "./reportWebVitals.ts";

// Create a new router instance

const TanStackQueryProviderContext = TanStackQueryProvider.getContext();
const router = createRouter({
  routeTree,
  context: {
    ...TanStackQueryProviderContext,
  },
  defaultPreload: "intent",
  scrollRestoration: true,
  defaultStructuralSharing: true,
  defaultPreloadStaleTime: 0,
});

// Register the router instance for type safety
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

// Render the app
const rootElement = document.getElementById("app");
if (rootElement && !rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <StrictMode>
      <TanStackQueryProvider.Provider {...TanStackQueryProviderContext}>
        <AuthInitializer>
          <RouterProvider router={router} />
        </AuthInitializer>
      </TanStackQueryProvider.Provider>
    </StrictMode>
  );
}

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
