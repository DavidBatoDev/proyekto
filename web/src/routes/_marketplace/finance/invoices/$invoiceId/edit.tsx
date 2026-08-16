import { createFileRoute, redirect } from "@tanstack/react-router";
import { InvoiceBuilder } from "@/components/invoices/InvoiceBuilder";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { useAuthStore } from "@/stores/authStore";

export const Route = createFileRoute(
	"/_marketplace/finance/invoices/$invoiceId/edit",
)({
	beforeLoad: () => {
		if (!useAuthStore.getState().isAuthenticated) {
			throw redirect({ to: "/auth/login" });
		}
	},
	validateSearch: (search: Record<string, unknown>) => ({
		projectId: typeof search.projectId === "string" ? search.projectId : "",
	}),
	component: EditInvoicePage,
});

function EditInvoicePage() {
	const { invoiceId } = Route.useParams();
	const { projectId } = Route.useSearch();
	return (
		<DashboardShell>
			<InvoiceBuilder projectId={projectId} invoiceId={invoiceId} />
		</DashboardShell>
	);
}
