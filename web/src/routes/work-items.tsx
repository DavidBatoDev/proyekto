import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/work-items")({
	beforeLoad: () => {
		throw redirect({ to: "/command-center", replace: true });
	},
});
