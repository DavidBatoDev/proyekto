import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Redirect stub: contracts are listed in one place only — Engagements →
 * Contracts. This keeps the old team tab URL working, narrowed to the team.
 */
export const Route = createFileRoute(
	"/_execution/engagements/finance/team/$teamId/contracts",
)({
	beforeLoad: ({ params }) => {
		throw redirect({
			to: "/engagements/contracts",
			search: { view: "team", teamId: params.teamId },
			replace: true,
		});
	},
});
