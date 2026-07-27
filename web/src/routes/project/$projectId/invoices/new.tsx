import { createFileRoute } from "@tanstack/react-router";
import { InvoiceBuilder } from "@/components/invoices/InvoiceBuilder";

export const Route = createFileRoute("/project/$projectId/invoices/new")({
	component: NewInvoicePage,
});

function NewInvoicePage() {
	const { projectId } = Route.useParams();
	return <InvoiceBuilder projectId={projectId} />;
}
