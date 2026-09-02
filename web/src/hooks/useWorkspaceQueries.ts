import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { useMemo } from "react";
import { workspaceKeys } from "@/queries/workspaces";
import {
	type CreateWorkspaceInput,
	cancelWorkspaceInvite,
	createWorkspace,
	createWorkspaceInvite,
	getWorkspace,
	type InviteWorkspaceMemberInput,
	listMyWorkspaceInvites,
	listMyWorkspaces,
	listWorkspaceInvites,
	listWorkspaceMembers,
	removeWorkspaceMember,
	respondWorkspaceInvite,
	type UpdateWorkspacePatch,
	updateWorkspace,
	updateWorkspaceMember,
	type Workspace,
	type WorkspaceRole,
} from "@/services/workspaces.service";
import { useUser } from "@/stores/authStore";
import { useWorkspaceStore } from "@/stores/workspaceStore";

const STALE_30S = 30 * 1000;
const STALE_60S = 60 * 1000;

export function useMyWorkspacesQuery() {
	const user = useUser();
	return useQuery({
		queryKey: workspaceKeys.mine(user?.id),
		queryFn: () => listMyWorkspaces(),
		enabled: Boolean(user?.id),
		staleTime: STALE_30S,
		refetchOnWindowFocus: true,
		retry: 1,
	});
}

export function useWorkspaceQuery(workspaceId: string | null | undefined) {
	return useQuery({
		queryKey: workspaceKeys.detail(workspaceId ?? ""),
		queryFn: () => getWorkspace(workspaceId as string),
		enabled: Boolean(workspaceId),
		staleTime: STALE_60S,
		refetchOnWindowFocus: true,
		retry: 1,
	});
}

export function useWorkspaceMembersQuery(
	workspaceId: string | null | undefined,
) {
	return useQuery({
		queryKey: workspaceKeys.members(workspaceId ?? ""),
		queryFn: () => listWorkspaceMembers(workspaceId as string),
		enabled: Boolean(workspaceId),
		staleTime: STALE_60S,
		refetchOnWindowFocus: true,
		retry: 1,
	});
}

export function useWorkspaceInvitesQuery(
	workspaceId: string | null | undefined,
) {
	return useQuery({
		queryKey: workspaceKeys.invites(workspaceId ?? ""),
		queryFn: () => listWorkspaceInvites(workspaceId as string),
		enabled: Boolean(workspaceId),
		staleTime: STALE_30S,
		retry: 1,
	});
}

export function useMyWorkspaceInvitesQuery() {
	const user = useUser();
	return useQuery({
		queryKey: workspaceKeys.myInvites,
		queryFn: () => listMyWorkspaceInvites(),
		enabled: Boolean(user?.id),
		staleTime: STALE_30S,
		retry: 1,
	});
}

/**
 * The workspace the user is looking at.
 *
 * Under /w/<slug>/ the URL decides — two tabs on different workspaces stay
 * independent, and a reload lands where the address bar says. Everywhere else
 * (project pages, the inbox) the selection store's "last visited" workspace
 * stands in. Null while the list is loading or when the user belongs to none;
 * callers treat null as "omit workspace_id and let the backend default".
 *
 * Must only be called under the router: it reads route params.
 */
export function useCurrentWorkspace(): {
	workspace: Workspace | null;
	workspaces: Workspace[];
	isLoading: boolean;
} {
	const { workspaceSlug } = useParams({ strict: false }) as {
		workspaceSlug?: string;
	};
	const currentWorkspaceId = useWorkspaceStore(
		(state) => state.currentWorkspaceId,
	);
	const { data, isLoading } = useMyWorkspacesQuery();

	return useMemo(() => {
		const workspaces = data ?? [];
		const fromUrl = workspaceSlug
			? (workspaces.find((item) => item.slug === workspaceSlug) ?? null)
			: null;
		const workspace =
			fromUrl ??
			workspaces.find((item) => item.id === currentWorkspaceId) ??
			null;
		return { workspace, workspaces, isLoading };
	}, [data, workspaceSlug, currentWorkspaceId, isLoading]);
}

export function useCreateWorkspaceMutation() {
	const queryClient = useQueryClient();
	const user = useUser();
	const setCurrentWorkspace = useWorkspaceStore(
		(state) => state.setCurrentWorkspace,
	);

	return useMutation({
		mutationFn: (input: CreateWorkspaceInput) => createWorkspace(input),
		onSuccess: (workspace) => {
			// Creating a workspace is an act of switching into it — nobody creates
			// one to then keep working somewhere else.
			if (user?.id) setCurrentWorkspace(workspace.id, user.id);
			void queryClient.invalidateQueries({ queryKey: workspaceKeys.all });
		},
	});
}

export function useUpdateWorkspaceMutation(workspaceId: string) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (patch: UpdateWorkspacePatch) =>
			updateWorkspace(workspaceId, patch),
		onSuccess: () => {
			void queryClient.invalidateQueries({ queryKey: workspaceKeys.all });
		},
	});
}

export function useWorkspaceInviteMutation(workspaceId: string) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (input: InviteWorkspaceMemberInput) =>
			createWorkspaceInvite(workspaceId, input),
		onSuccess: () => {
			void queryClient.invalidateQueries({
				queryKey: workspaceKeys.invites(workspaceId),
			});
		},
	});
}

export function useCancelWorkspaceInviteMutation(workspaceId: string) {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (inviteId: string) =>
			cancelWorkspaceInvite(workspaceId, inviteId),
		onSuccess: () => {
			void queryClient.invalidateQueries({
				queryKey: workspaceKeys.invites(workspaceId),
			});
		},
	});
}

export function useRespondWorkspaceInviteMutation() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({
			inviteId,
			status,
		}: {
			inviteId: string;
			status: "accepted" | "declined";
		}) => respondWorkspaceInvite(inviteId, status),
		onSuccess: () => {
			// Accepting adds a workspace to the switcher, so both the invite list
			// and the workspace list are stale.
			void queryClient.invalidateQueries({ queryKey: workspaceKeys.all });
		},
	});
}

export function useWorkspaceMemberMutations(workspaceId: string) {
	const queryClient = useQueryClient();

	const invalidate = () => {
		void queryClient.invalidateQueries({
			queryKey: workspaceKeys.members(workspaceId),
		});
		void queryClient.invalidateQueries({ queryKey: workspaceKeys.all });
	};

	const updateRole = useMutation({
		mutationFn: ({ userId, role }: { userId: string; role: WorkspaceRole }) =>
			updateWorkspaceMember(workspaceId, userId, { role }),
		onSuccess: invalidate,
	});

	const removeMember = useMutation({
		mutationFn: (userId: string) => removeWorkspaceMember(workspaceId, userId),
		onSuccess: invalidate,
	});

	return { updateRole, removeMember };
}
