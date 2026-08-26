import { createFileRoute } from "@tanstack/react-router";
import { InvoiceBuilder } from "@/components/invoices/InvoiceBuilder";

/**
 * An existing invoice. Auth and the finance shell come from
 * `finance/route.tsx`; see `invoices/new.tsx` for why this sits outside the
 * `_portfolio` chrome.
 */
export const Route = createFileRoute(
	"/_execution/engagements/finance/invoices/$invoiceId/edit",
)({
	validateSearch: (search: Record<string, unknown>) => ({
		projectId: typeof search.projectId === "string" ? search.projectId : "",
	}),
	component: EditInvoicePage,
});

function EditInvoicePage() {
	const { invoiceId } = Route.useParams();
	const { projectId } = Route.useSearch();
	return <InvoiceBuilder projectId={projectId} invoiceId={invoiceId} />;
}
