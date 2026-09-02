import {
	createFileRoute,
	notFound,
	Outlet,
	redirect,
} from "@tanstack/react-router";
import { useEffect } from "react";
import { NotFoundRoute } from "@/components/layout/NotFoundRoute";
import { stripWorkspacePrefix } from "@/lib/workspacePaths";
import {
	ensureMyWorkspaces,
	refetchMyWorkspaces,
	requireAuthenticatedUserId,
	resolveWorkspaceSlug,
} from "@/lib/workspaceRouting";
import { useUser } from "@/stores/authStore";
import {
	getCurrentWorkspaceId,
	useWorkspaceStore,
} from "@/stores/workspaceStore";

/**
 * The workspace segment: every organizational page lives under /w/<slug>/.
 *
 * The slug is resolved against the caller's OWN memberships, so a slug that
 * is nobody's — or belongs to a workspace the caller is not in — is simply
 * not found. That is what keeps the URL from enumerating organizations: there
 * is no lookup that answers "does this workspace exist" for an outsider.
 *
 * Entity pages (/project/…) stay outside this tree on purpose: a consultant
 * reaches a client's project through project access without holding a seat in
 * that workspace, so a tenant segment there would assert a context they do
 * not have.
 */
export const Route = createFileRoute("/w/$workspaceSlug")({
	notFoundComponent: NotFoundRoute,
	beforeLoad: async ({ params, context, location }) => {
		const userId = requireAuthenticatedUserId(location);
		let workspaces = await ensureMyWorkspaces(context.queryClient, userId);
		let resolved = resolveWorkspaceSlug(workspaces, params.workspaceSlug);

		// The cached list may predate this workspace entirely (fetched at boot,
		// before the welcome deck created it) or a rename made elsewhere. One
		// real refetch before deciding "not found", so a fresh slug is never a
		// false 404.
		if (!resolved.current && !resolved.renamedTo) {
			workspaces = await refetchMyWorkspaces(context.queryClient, userId);
			resolved = resolveWorkspaceSlug(workspaces, params.workspaceSlug);
		}

		if (resolved.renamedTo) {
			// Same route, same search, current slug. No `to` means "this match's
			// template", so the rest of the path survives the redirect.
			const nextSlug = resolved.renamedTo.slug;
			throw redirect({
				params: (prev) => ({ ...prev, workspaceSlug: nextSlug }),
				search: true,
				replace: true,
			});
		}

		if (!resolved.current) throw notFound();

		if (stripWorkspacePrefix(location.pathname) === "/") {
			throw redirect({
				to: "/w/$workspaceSlug/dashboard",
				params: { workspaceSlug: resolved.current.slug },
				replace: true,
			});
		}

		return { workspace: resolved.current };
	},
	component: WorkspaceLayout,
});

function WorkspaceLayout() {
	const { workspace } = Route.useRouteContext();
	const user = useUser();
	const setCurrentWorkspace = useWorkspaceStore(
		(state) => state.setCurrentWorkspace,
	);

	// Mirror the URL's workspace into the selection store from here, not from
	// beforeLoad: the router preloads on hover, so beforeLoad also runs for a
	// link the user merely pointed at. The store is the "last visited" memory
	// that bare URLs and non-React readers (project/new, CreateTeamModal) fall
	// back on; none of them read it during first paint, so an effect is soon
	// enough.
	useEffect(() => {
		if (user?.id && getCurrentWorkspaceId() !== workspace.id) {
			setCurrentWorkspace(workspace.id, user.id);
		}
	}, [workspace.id, user?.id, setCurrentWorkspace]);

	return <Outlet />;
}
