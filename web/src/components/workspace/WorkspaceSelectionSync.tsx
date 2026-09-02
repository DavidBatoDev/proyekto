import { useEffect } from "react";
import { useMyWorkspacesQuery } from "@/hooks/useWorkspaceQueries";
import { pickDefaultWorkspace } from "@/lib/workspaceRouting";
import { useUser } from "@/stores/authStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";

/**
 * Keeps the stored workspace selection honest.
 *
 * The stored id is a hint, never a fact: it can name a workspace the user has
 * since left, one that was deleted, or one belonging to a different account on
 * a shared machine. So the selection is always reconciled against the list the
 * server actually returned, and a stale id is replaced rather than trusted.
 *
 * On a /w/<slug>/ page the URL is the source of truth and the layout mirrors
 * it into the store; this component never fights that — it only ever replaces
 * an id that is absent from the list.
 *
 * Renders nothing; mounted once beside the router, outside it, so it must not
 * read route params.
 */
export function WorkspaceSelectionSync() {
	const user = useUser();
	const { data: workspaces } = useMyWorkspacesQuery();
	const currentWorkspaceId = useWorkspaceStore(
		(state) => state.currentWorkspaceId,
	);
	const hydratedForUserId = useWorkspaceStore(
		(state) => state.hydratedForUserId,
	);
	const hydrateForUser = useWorkspaceStore((state) => state.hydrateForUser);
	const setCurrentWorkspace = useWorkspaceStore(
		(state) => state.setCurrentWorkspace,
	);
	const clear = useWorkspaceStore((state) => state.clear);

	// Load this user's stored selection, and drop it entirely on sign-out so the
	// next account does not inherit it.
	useEffect(() => {
		if (!user?.id) {
			if (hydratedForUserId !== null) clear();
			return;
		}
		if (hydratedForUserId !== user.id) hydrateForUser(user.id);
	}, [user?.id, hydratedForUserId, hydrateForUser, clear]);

	// Reconcile once the server list arrives.
	useEffect(() => {
		if (!user?.id || hydratedForUserId !== user.id) return;
		if (!workspaces) return;

		const stillAMember = workspaces.some(
			(workspace) => workspace.id === currentWorkspaceId,
		);
		if (stillAMember) return;

		const fallback = pickDefaultWorkspace(workspaces);
		if (!fallback) {
			// Genuinely none — the provisioning backstop failed or the user left
			// every workspace. Leave the selection null; consumers read that as
			// "omit workspace_id and let the backend default".
			if (currentWorkspaceId !== null) setCurrentWorkspace(null, user.id);
			return;
		}
		setCurrentWorkspace(fallback.id, user.id);
	}, [
		user?.id,
		hydratedForUserId,
		workspaces,
		currentWorkspaceId,
		setCurrentWorkspace,
	]);

	return null;
}
