import { createFileRoute, Outlet } from "@tanstack/react-router";

/**
 * Pathless passthrough kept only so the redirect stubs below it keep their
 * historical route IDs. See `finance/route.tsx` for why the stubs exist.
 */
export const Route = createFileRoute("/marketplace/finance/_portfolio")({
	component: Outlet,
});
