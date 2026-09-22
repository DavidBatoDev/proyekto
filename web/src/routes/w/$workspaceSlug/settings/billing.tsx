import { createFileRoute } from "@tanstack/react-router";
import { WorkspaceBillingPage } from "@/components/workspace/settings/WorkspaceBillingPage";

export const Route = createFileRoute("/w/$workspaceSlug/settings/billing")({
	// `?checkout=` is our own return marker, handed to the provider as part of the
	// success and cancel URLs. Validated rather than trusted: anything else is
	// dropped so a hand-edited URL cannot fake a "payment received" banner.
	validateSearch: (
		search: Record<string, unknown>,
	): { checkout?: "success" | "cancelled" } =>
		search.checkout === "success" || search.checkout === "cancelled"
			? { checkout: search.checkout }
			: {},
	component: WorkspaceBillingPage,
});
