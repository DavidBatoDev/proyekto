import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Redirect stub: the Personal page merged into My finance at
 * `/engagements/finance`, which consolidates every team without needing a
 * personal book.
 */
export const Route = createFileRoute("/_execution/engagements/finance/me/")({
	beforeLoad: () => {
		throw redirect({ to: "/engagements/finance", replace: true });
	},
});
