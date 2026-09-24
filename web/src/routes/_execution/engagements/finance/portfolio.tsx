import { createFileRoute, redirect } from "@tanstack/react-router";

/** Redirect stub: the consultant portfolio rollup is now part of My finance. */
export const Route = createFileRoute(
	"/_execution/engagements/finance/portfolio",
)({
	beforeLoad: () => {
		throw redirect({ to: "/engagements/finance", replace: true });
	},
});
