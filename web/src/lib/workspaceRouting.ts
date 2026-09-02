import type { QueryClient } from "@tanstack/react-query";
import { redirect } from "@tanstack/react-router";
import { toWorkspacePath } from "@/lib/workspacePaths";
import { workspaceKeys } from "@/queries/workspaces";
import {
	listMyWorkspaces,
	type Workspace,
} from "@/services/workspaces.service";
import { useAuthStore } from "@/stores/authStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";

/**
 * Non-React resolution of "which workspace", for route `beforeLoad`s.
 *
 * Route guards run before any component mounts, so they cannot use hooks; they
 * read the stores directly, exactly as the auth guards already do. The
 * workspace list goes through the query client so the first page render finds
 * it already cached.
 */

export function requireAuthenticatedUserId(location: { href: string }): string {
	const { isAuthenticated, user } = useAuthStore.getState();
	if (!isAuthenticated || !user?.id) {
		throw redirect({ to: "/auth/login", search: { redirect: location.href } });
	}
	return user.id;
}

export function ensureMyWorkspaces(
	queryClient: QueryClient,
	userId: string,
): Promise<Workspace[]> {
	return queryClient.ensureQueryData({
		queryKey: workspaceKeys.mine(userId),
		queryFn: listMyWorkspaces,
	});
}

/**
 * A real round trip, ignoring the client's default 30s freshness window.
 * `fetchQuery` alone would hand back a list cached at boot — before the
 * welcome deck created the workspace, or before another owner renamed it.
 * Dedupes with any refetch an invalidation already has in flight.
 */
export function refetchMyWorkspaces(
	queryClient: QueryClient,
	userId: string,
): Promise<Workspace[]> {
	return queryClient.fetchQuery({
		queryKey: workspaceKeys.mine(userId),
		queryFn: listMyWorkspaces,
		staleTime: 0,
	});
}

/**
 * The default workspace when nothing has been chosen: one the user owns, in
 * the server's order (`workspace_members.joined_at`, which is also the
 * backend's definition of the default), else the first they belong to.
 */
export function pickDefaultWorkspace(list: Workspace[]): Workspace | null {
	return (
		list.find((workspace) => workspace.my_role === "owner") ?? list[0] ?? null
	);
}

/**
 * Resolve a slug against the caller's own memberships. A slug that is nobody's
 * — or belongs to a workspace the caller is not in — is simply not found,
 * which is what keeps the URL from enumerating organizations.
 */
export function resolveWorkspaceSlug(
	list: Workspace[],
	slug: string,
): { current: Workspace | null; renamedTo: Workspace | null } {
	const current = list.find((workspace) => workspace.slug === slug) ?? null;
	if (current) return { current, renamedTo: null };
	const renamedTo =
		list.find((workspace) => workspace.previous_slugs.includes(slug)) ?? null;
	return { current: null, renamedTo };
}

/**
 * The workspace a bare organizational URL should forward to: the last one the
 * user visited on this device, else their default.
 *
 * Hydrates the selection store itself. `WorkspaceSelectionSync` does the same
 * in an effect after first paint, but a guard for the initial location runs
 * earlier than that; the read is synchronous and idempotent, so doing it here
 * too costs nothing.
 */
export async function resolveLastVisitedWorkspace(
	queryClient: QueryClient,
	location: { href: string },
): Promise<Workspace | null> {
	const userId = requireAuthenticatedUserId(location);
	const store = useWorkspaceStore.getState();
	if (store.hydratedForUserId !== userId) store.hydrateForUser(userId);

	let list = await ensureMyWorkspaces(queryClient, userId);
	// An empty list is more likely a cache from before signup provisioning
	// than a genuinely workspace-less account: confirm before offering to
	// create one.
	if (list.length === 0) list = await refetchMyWorkspaces(queryClient, userId);
	const storedId = useWorkspaceStore.getState().currentWorkspaceId;
	return (
		list.find((workspace) => workspace.id === storedId) ??
		pickDefaultWorkspace(list)
	);
}

/**
 * Redirect a bare organizational URL to its workspace-scoped twin, keeping
 * the rest of the path and the query string. The destination is computed, so
 * it cannot be a typed `to`; the cast is confined to this one helper.
 * (`redirect({ href })` is not an option: in this router version it implies a
 * full document reload.)
 */
export function throwWorkspacePathRedirect(
	barePath: string,
	slug: string,
): never {
	throw redirect({
		to: toWorkspacePath(barePath, slug) as "/",
		search: true,
		replace: true,
	});
}
