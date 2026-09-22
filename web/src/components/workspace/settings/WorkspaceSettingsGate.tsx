import type { ReactNode } from "react";
import { SettingsSkeleton } from "@/components/workspace/settings/SettingsPrimitives";
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
 *
 * While it loads, the placeholder takes the shape of the page that is coming
 * (a header over ruled bands) rather than a boxed spinner, so nothing jumps
 * when the page arrives.
 */
export function WorkspaceSettingsGate({
	children,
}: WorkspaceSettingsGateProps) {
	const { workspace, isLoading } = useCurrentWorkspace();

	if (isLoading || !workspace) {
		return (
			<div>
				<div
					aria-hidden="true"
					className="animate-pulse border-b border-border pb-6"
				>
					<div className="h-7 w-48 rounded bg-muted" />
					<div className="mt-3 h-3.5 w-72 max-w-full rounded bg-muted" />
				</div>
				<SettingsSkeleton />
			</div>
		);
	}

	return <>{children(workspace)}</>;
}
