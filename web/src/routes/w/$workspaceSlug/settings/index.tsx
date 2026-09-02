import { createFileRoute } from "@tanstack/react-router";
import { WorkspaceGeneralSettings } from "@/components/workspace/settings/WorkspaceGeneralSettings";

export const Route = createFileRoute("/w/$workspaceSlug/settings/")({
	component: WorkspaceGeneralSettings,
});
