import { createFileRoute } from "@tanstack/react-router";
import { InvoiceBuilder } from "@/components/invoices/InvoiceBuilder";

export const Route = createFileRoute(
	"/project/$projectId/invoices/$invoiceId/edit",
)({
	component: EditInvoicePage,
});

function EditInvoicePage() {
	const { projectId, invoiceId } = Route.useParams();
	return <InvoiceBuilder projectId={projectId} invoiceId={invoiceId} />;
}
