import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import type { Workspace } from "@/services/workspaces.service";
import { useUser } from "@/stores/authStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";

/**
 * Entering a workspace — by switching, creating, or accepting an invitation —
 * is one move: remember it, clear the dashboard so its skeletons show, and
 * land on that workspace's dashboard.
 *
 * Reset, not invalidate: an invalidation keeps the previous workspace's rows on
 * screen while it refetches, so the switch would look like nothing happened.
 * A reset returns the caches to their pending state, which is what every
 * dashboard section keys its skeleton on. The workspace list itself is left
 * alone — resetting it would blank the switcher mid-switch.
 */
export function useEnterWorkspace() {
	const user = useUser();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const setCurrentWorkspace = useWorkspaceStore(
		(state) => state.setCurrentWorkspace,
	);

	return useCallback(
		(workspace: Pick<Workspace, "id" | "slug">) => {
			if (user?.id) setCurrentWorkspace(workspace.id, user.id);
			void queryClient.resetQueries({ queryKey: ["dashboard"] });
			void queryClient.resetQueries({ queryKey: ["teams", "mine"] });
			void queryClient.resetQueries({ queryKey: ["teams", "my-invites"] });
			void navigate({
				to: "/w/$workspaceSlug/dashboard",
				params: { workspaceSlug: workspace.slug },
			});
		},
		[user?.id, setCurrentWorkspace, queryClient, navigate],
	);
}
