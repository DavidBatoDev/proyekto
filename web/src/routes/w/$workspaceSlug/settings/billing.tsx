import { createFileRoute } from "@tanstack/react-router";
import { WorkspaceBillingPlaceholder } from "@/components/workspace/settings/WorkspaceBillingPlaceholder";

export const Route = createFileRoute("/w/$workspaceSlug/settings/billing")({
	component: WorkspaceBillingPlaceholder,
});
