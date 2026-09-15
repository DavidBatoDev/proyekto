import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_execution/task-board")({
	beforeLoad: () => {
		throw redirect({ to: "/command-center", replace: true });
	},
});
