import { createFileRoute } from "@tanstack/react-router";
import { Clock } from "lucide-react";
import { AppEmptyState } from "@/components/common/AppPrimitives";
import { validateWorkspaceTimeSettingsSearch } from "@/lib/timeSearch";

/**
 * `/w/<slug>/settings/time[?tab=report]`: the workspace time policy and the
 * workspace time report (ux.md › Settings › Workspace Time Policy). Auth and
 * the workspace come from the parent `/w/$workspaceSlug` layout. Search params
 * are final (`tab`); the body is a placeholder until the settings package
 * replaces it.
 */
export const Route = createFileRoute("/w/$workspaceSlug/settings/time")({
	validateSearch: validateWorkspaceTimeSettingsSearch,
	component: WorkspaceTimeSettingsPlaceholder,
});

function WorkspaceTimeSettingsPlaceholder() {
	return (
		<AppEmptyState
			icon={Clock}
			title="Coming together"
			description="Workspace time settings are being set up here."
		/>
	);
}
