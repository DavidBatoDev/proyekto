import { create } from "zustand";

/**
 * Which workspace the user is currently looking at.
 *
 * The store holds the SELECTION only; the workspace list itself stays in
 * TanStack Query. Mirroring server rows into Zustand would give the app two
 * sources of truth for the same data and no rule for which one is stale.
 *
 * Persistence is per-user localStorage rather than `profiles.settings`: it is a
 * per-device preference (the same person may want a different workspace open on
 * their laptop and their phone), a write per switch is not worth a round trip,
 * and `settings.workspace_defaults` already means something else — the sidebar's
 * default team/project, which predates this tier.
 */

const STORAGE_PREFIX = "proyekto_current_workspace";

function storageKey(userId: string): string {
	return `${STORAGE_PREFIX}:${userId}`;
}

function readStored(userId: string): string | null {
	try {
		return window.localStorage.getItem(storageKey(userId));
	} catch {
		// Private mode, blocked site data, SSR-ish contexts: a missing selection
		// is recoverable (the sync component picks a default), a throw is not.
		return null;
	}
}

function writeStored(userId: string, workspaceId: string | null): void {
	try {
		if (workspaceId === null) {
			window.localStorage.removeItem(storageKey(userId));
		} else {
			window.localStorage.setItem(storageKey(userId), workspaceId);
		}
	} catch {
		// Selection still works for this session; it just will not survive a
		// reload.
	}
}

interface WorkspaceSelectionState {
	currentWorkspaceId: string | null;
	/**
	 * Which user the current selection belongs to. Without this, signing in as
	 * someone else on a shared machine would inherit the previous account's
	 * workspace id until the next reconcile.
	 */
	hydratedForUserId: string | null;
	setCurrentWorkspace: (workspaceId: string | null, userId: string) => void;
	hydrateForUser: (userId: string) => void;
	clear: () => void;
}

export const useWorkspaceStore = create<WorkspaceSelectionState>((set) => ({
	currentWorkspaceId: null,
	hydratedForUserId: null,

	setCurrentWorkspace: (workspaceId, userId) => {
		writeStored(userId, workspaceId);
		set({ currentWorkspaceId: workspaceId, hydratedForUserId: userId });
	},

	hydrateForUser: (userId) => {
		set({
			currentWorkspaceId: readStored(userId),
			hydratedForUserId: userId,
		});
	},

	clear: () => set({ currentWorkspaceId: null, hydratedForUserId: null }),
}));

/** Read the selection outside React (creation flows, route loaders). */
export function getCurrentWorkspaceId(): string | null {
	return useWorkspaceStore.getState().currentWorkspaceId;
}
