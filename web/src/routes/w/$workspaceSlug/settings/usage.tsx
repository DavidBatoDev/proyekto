import { createFileRoute } from "@tanstack/react-router";
import { WorkspaceUsagePage } from "@/components/workspace/settings/WorkspaceUsagePage";

export const Route = createFileRoute("/w/$workspaceSlug/settings/usage")({
	component: WorkspaceUsagePage,
});
