import { createFileRoute, redirect } from "@tanstack/react-router";
import { validateTimePageSearch } from "@/lib/timeSearch";

/**
 * Old "My Logs" tab, kept only so old links resolve (ux.md › Routes and
 * Redirects). A member's own time lives on `/time` now:
 *
 * - `…/time/my-logs` → `/time?for=team:<t>`. The old `?member=`, `?preset`,
 *   `?from`, `?to` and cut-off params are dropped.
 * - `…/time/my-logs?log=X` → `/time?for=team:<t>&entry=X` (the entry's detail
 *   opens there). Timer and comment notifications sent before D79 carry this
 *   shape.
 *
 * A non-uuid team id drops the `for` filter, and an unreadable `log` drops the
 * entry, so a mangled link still lands on `/time` rather than an error.
 */
export const Route = createFileRoute(
	"/w/$workspaceSlug/teams/$teamId/time/my-logs",
)({
	validateSearch: (search: Record<string, unknown>): { log?: string } => {
		const raw = search.log;
		const log =
			typeof raw === "string" || typeof raw === "number"
				? String(raw).trim()
				: "";
		return log ? { log } : {};
	},
	beforeLoad: ({ params, search }) => {
		throw redirect({
			to: "/time",
			search: validateTimePageSearch({
				for: `team:${params.teamId}`,
				entry: search.log,
			}),
			replace: true,
		});
	},
});
