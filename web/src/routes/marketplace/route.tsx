import { createFileRoute, Outlet } from "@tanstack/react-router";

/**
 * The `/marketplace` layout.
 *
 * Deliberately renders nothing but an `Outlet`. It cannot own `MarketplaceShell`
 * because the shell includes `ProtectedRoute`, and this subtree holds genuinely
 * public pages — the consultant landing at `/marketplace/consultant` and the
 * public profile at `/marketplace/consultant/$profileId`, both of which must
 * render for anonymous visitors and stay indexable. Authenticated pages opt
 * into the shell themselves.
 *
 * `_execution` stays pathless by contrast: execution is the surface every user
 * lands on after signup, so `/dashboard` should not become
 * `/execution/dashboard`. The asymmetry is intentional.
 */
export const Route = createFileRoute("/marketplace")({
	component: Outlet,
});
