import { createFileRoute } from "@tanstack/react-router";

/**
 * Empty shell. The page moved to /w/<slug>/teams/$teamId/time/manage-rates — this
 * file only keeps the bare path a real route (so persisted links and typed
 * `to`s still compile) while the parent, routes/_execution/teams/$teamId.tsx, redirects
 * every bare URL to its workspace-scoped twin before this ever renders.
 */
export const Route = createFileRoute(
	"/_execution/teams/$teamId/time/manage-rates/",
)({});
