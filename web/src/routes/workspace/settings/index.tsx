import { createFileRoute } from "@tanstack/react-router";
import { WorkspaceGeneralSettings } from "@/components/workspace/settings/WorkspaceGeneralSettings";

export const Route = createFileRoute("/workspace/settings/")({
	component: WorkspaceGeneralSettings,
});
