import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Redirect to the canonical `/invites`.
 *
 * This route no longer renders anything. It exists because invitation emails
 * carrying `/freelancer/invites` are already in people's inboxes and will keep
 * being opened for months — and because the persona in that path was wrong for
 * every client and consultant who ever received one.
 *
 * `beforeLoad` runs before the (now absent) component, so the redirect happens
 * without a flash. Deleting this file breaks live links; keep it.
 */
export const Route = createFileRoute("/freelancer/invites")({
	validateSearch: (search: Record<string, unknown>): { inviteId?: string } => ({
		// Passed straight through — `/invites` is what validates it.
		inviteId: typeof search.inviteId === "string" ? search.inviteId : undefined,
	}),
	beforeLoad: ({ search }) => {
		throw redirect({
			to: "/invites",
			search: search.inviteId ? { inviteId: search.inviteId } : {},
			replace: true,
		});
	},
});
