import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_execution/work-items")({
	beforeLoad: () => {
		throw redirect({ to: "/task-board", replace: true });
	},
});
