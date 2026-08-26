import { createFileRoute, redirect } from "@tanstack/react-router";

/** Redirect stub: old invoice editor URL → `/engagements/finance/invoices/<id>/edit`. */
export const Route = createFileRoute(
	"/marketplace/finance/invoices/$invoiceId/edit",
)({
	validateSearch: (search: Record<string, unknown>) => ({
		projectId: typeof search.projectId === "string" ? search.projectId : "",
	}),
	beforeLoad: ({ params, search }) => {
		throw redirect({
			to: "/engagements/finance/invoices/$invoiceId/edit",
			params: { invoiceId: params.invoiceId },
			search,
		});
	},
});
