import { createFileRoute } from "@tanstack/react-router";

/**
 * Empty shell. The old "My Logs" tab lives on as the redirect stub
 * /w/<slug>/teams/$teamId/time/my-logs, which sends it on to
 * `/time?for=team:<t>`. This file only keeps the bare path a real route (so
 * persisted links and typed `to`s still compile) while the parent,
 * routes/_execution/teams/$teamId.tsx, redirects every bare URL to its
 * workspace-scoped twin before this ever renders.
 */
export const Route = createFileRoute("/_execution/teams/$teamId/time/my-logs")(
	{},
);
