import { createFileRoute } from "@tanstack/react-router";
import { WorkspaceBillingPlaceholder } from "@/components/workspace/settings/WorkspaceBillingPlaceholder";

export const Route = createFileRoute("/workspace/settings/billing")({
	component: WorkspaceBillingPlaceholder,
});
