import { createFileRoute } from "@tanstack/react-router";
import { InvoiceBuilder } from "@/components/invoices/InvoiceBuilder";

/**
 * A new invoice. Auth and the finance shell come from
 * `finance/route.tsx`; the builder is a full-page document, so it stays a
 * sibling of the `_portfolio` chrome rather than a child of it.
 */
export const Route = createFileRoute(
	"/_execution/engagements/finance/invoices/new",
)({
	validateSearch: (search: Record<string, unknown>) => ({
		projectId: typeof search.projectId === "string" ? search.projectId : "",
	}),
	component: NewInvoicePage,
});

function NewInvoicePage() {
	const { projectId } = Route.useSearch();
	return <InvoiceBuilder projectId={projectId} />;
}
