import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_execution")({
	component: Outlet,
});
