import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Redirect to the canonical `/project/new`.
 *
 * Creating a project moved out of the marketplace prefix and into the execution
 * subtree. This shim stays because the old path is not only in bookmarks: it is
 * persisted in `notifications.link_url`, in `signup_redirect` (which has no
 * TTL), and in push payloads already sitting in device trays. `mapLegacyPath`
 * rewrites what it can reach; this catches the rest without a flash.
 */
export const Route = createFileRoute("/marketplace/project-posting")({
	validateSearch: (search: Record<string, unknown>) => ({
		// Passed straight through — `/project/new` is what validates it.
		roadmapId:
			typeof search.roadmapId === "string" ? search.roadmapId : undefined,
	}),
	beforeLoad: ({ search }) => {
		throw redirect({
			to: "/project/new",
			search: { roadmapId: search.roadmapId },
			replace: true,
		});
	},
});
