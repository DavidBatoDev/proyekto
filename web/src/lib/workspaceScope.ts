/**
 * Splitting a list of teams or projects by the workspace currently open.
 *
 * The subtlety this exists for: Proyekto is a marketplace as well as a
 * workspace product. A consultant holds `project_access` on a client's project
 * without being a member of that client's workspace, so filtering strictly by
 * `workspace_id === current` would hide their entire book of work the moment
 * workspaces shipped. Hence three outcomes rather than two:
 *
 *   - in the current workspace  → the main list
 *   - no workspace, or a workspace the viewer does not belong to → "Shared with you"
 *   - in another workspace the viewer DOES belong to → hidden here; it appears
 *     when they switch to it, which is the whole point of switching
 */

export interface WorkspaceScoped {
	workspace_id?: string | null;
}

export interface WorkspaceGrouping<T> {
	current: T[];
	shared: T[];
}

export function groupByWorkspace<T extends WorkspaceScoped>(
	items: T[],
	currentWorkspaceId: string | null,
	myWorkspaceIds: readonly string[],
): WorkspaceGrouping<T> {
	const mine = new Set(myWorkspaceIds);
	const current: T[] = [];
	const shared: T[] = [];

	for (const item of items) {
		const workspaceId = item.workspace_id ?? null;

		if (currentWorkspaceId !== null && workspaceId === currentWorkspaceId) {
			current.push(item);
			continue;
		}

		// Unhomed (a guest's converted work, or a workspace that was deleted) or
		// somebody else's organization: either way the viewer reached it through
		// project access, not membership.
		if (workspaceId === null || !mine.has(workspaceId)) {
			shared.push(item);
			continue;
		}
	}

	// With no workspace selected yet there is nothing to be "current", so showing
	// only the shared pile would read as data loss. Fall back to one flat list.
	if (currentWorkspaceId === null) {
		return { current: items, shared: [] };
	}

	return { current, shared };
}
