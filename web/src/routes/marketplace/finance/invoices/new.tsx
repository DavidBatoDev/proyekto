import { createFileRoute, redirect } from "@tanstack/react-router";
import { InvoiceBuilder } from "@/components/invoices/InvoiceBuilder";
import { MarketplaceShell } from "@/components/layout/MarketplaceShell";
import { useAuthStore } from "@/stores/authStore";

export const Route = createFileRoute("/marketplace/finance/invoices/new")({
	beforeLoad: () => {
		if (!useAuthStore.getState().isAuthenticated) {
			throw redirect({ to: "/auth/login" });
		}
	},
	validateSearch: (search: Record<string, unknown>) => ({
		projectId: typeof search.projectId === "string" ? search.projectId : "",
	}),
	component: NewInvoicePage,
});

function NewInvoicePage() {
	const { projectId } = Route.useSearch();
	return (
		<MarketplaceShell>
			<InvoiceBuilder projectId={projectId} />
		</MarketplaceShell>
	);
}
