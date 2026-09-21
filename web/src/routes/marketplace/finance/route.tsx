import { createFileRoute, Outlet } from "@tanstack/react-router";

/**
 * Redirect shims for the old finance URLs.
 *
 * Finance moved to `/engagements/finance` so its team sections could sit
 * outside the marketplace's consultant gate, but `/marketplace/finance…` is
 * written into `notifications.link_url` by the invoice scheduler and the
 * contracts service, and rows already exist with it — old URLs are kept alive
 * permanently, not temporarily (docs/04-web/routing-and-access.md). Every
 * child of this layout is a `beforeLoad` redirect onto the new path, so this
 * layout renders no chrome and performs no auth: the destination owns both.
 */
export const Route = createFileRoute("/marketplace/finance")({
	component: Outlet,
});
