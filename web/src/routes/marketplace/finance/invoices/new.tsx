import { createFileRoute, redirect } from "@tanstack/react-router";

/** Redirect stub: `/marketplace/finance/invoices/new` → `/engagements/finance/invoices/new`. */
export const Route = createFileRoute("/marketplace/finance/invoices/new")({
	validateSearch: (search: Record<string, unknown>) => ({
		projectId: typeof search.projectId === "string" ? search.projectId : "",
	}),
	beforeLoad: ({ search }) => {
		throw redirect({ to: "/engagements/finance/invoices/new", search });
	},
});
