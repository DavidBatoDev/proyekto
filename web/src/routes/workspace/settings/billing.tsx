import { createFileRoute } from "@tanstack/react-router";

/**
 * Empty shell. The page moved to /w/<slug>/settings/billing — this
 * file only keeps the bare path a real route (so persisted links and typed
 * `to`s still compile) while the parent, routes/workspace/route.tsx, redirects
 * every bare URL to its workspace-scoped twin before this ever renders.
 */
export const Route = createFileRoute("/workspace/settings/billing")({});
