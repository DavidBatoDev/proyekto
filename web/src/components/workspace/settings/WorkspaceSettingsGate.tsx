import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { useCurrentWorkspace } from "@/hooks/useWorkspaceQueries";
import type { Workspace } from "@/services/workspaces.service";

interface WorkspaceSettingsGateProps {
	children: (workspace: Workspace) => ReactNode;
}

/**
 * Hands each workspace settings page its workspace once the list is in.
 *
 * Under /w/<slug>/ the parent layout has already resolved the slug against the
 * membership list, so `workspace` is null only while that list is loading —
 * never because "nothing is selected". An account with no workspace at all
 * cannot reach these pages; it lands on the bare /dashboard stub, which offers
 * to create one.
 */
export function WorkspaceSettingsGate({
	children,
}: WorkspaceSettingsGateProps) {
	const { workspace, isLoading } = useCurrentWorkspace();

	if (isLoading || !workspace) {
		return (
			<div className="flex items-center justify-center py-24">
				<Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
			</div>
		);
	}

	return <>{children(workspace)}</>;
}
