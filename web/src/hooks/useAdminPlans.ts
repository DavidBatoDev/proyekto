import {
	keepPreviousData,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import type { UpdatePlanLimitsInput } from "@/lib/planLimitsAdmin";
import { adminKeys } from "@/queries/admin";
import { billingKeys } from "@/queries/billing";
import { planKeys } from "@/queries/plans";
import { workspaceKeys } from "@/queries/workspaces";
import {
	type AdminPlanLimits,
	type AdminWorkspaceListParams,
	adminService,
	type SetWorkspaceCompInput,
} from "@/services/admin.service";

/**
 * Data hooks for the staff pages: the plan-limits editor and complimentary
 * workspace plans. Reads are open to any active admin; the writes need a super
 * admin, which the pages check with `useIsSuperAdmin` before offering them
 * (the API enforces it regardless).
 */

/** The signed-in admin's profile; shares the admin shell's cached query. */
export function useAdminMe() {
	return useQuery({
		queryKey: adminKeys.me,
		queryFn: () => adminService.getMe(),
		staleTime: 5 * 60 * 1000,
	});
}

export function useIsSuperAdmin(): boolean {
	return useAdminMe().data?.access_level === "super_admin";
}

export function useAdminPlanLimitsQuery() {
	return useQuery({
		queryKey: adminKeys.planLimits,
		queryFn: () => adminService.getPlanLimits(),
		// A focus refetch would move `version` under an open draft and hide the
		// very conflict the stale check exists to surface.
		refetchOnWindowFocus: false,
	});
}

export function useUpdatePlanLimitsMutation() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: (input: UpdatePlanLimitsInput) =>
			adminService.updatePlanLimits(input),
		onSuccess: ({ warnings: _warnings, ...matrix }) => {
			queryClient.setQueryData<AdminPlanLimits>(adminKeys.planLimits, matrix);
			// Public pricing and every "Available on Pro" hint read these.
			void queryClient.invalidateQueries({ queryKey: planKeys.all });
			void queryClient.invalidateQueries({ queryKey: workspaceKeys.usageAll });
			// Over-limit flags on the workspace list follow the new limits.
			void queryClient.invalidateQueries({
				queryKey: adminKeys.workspacesAll,
			});
		},
	});
}

export function useAdminWorkspacesQuery(params: AdminWorkspaceListParams) {
	return useQuery({
		queryKey: adminKeys.workspaces(params),
		queryFn: () => adminService.listWorkspaces(params),
		// Keep the current page on screen while the next search or page loads.
		placeholderData: keepPreviousData,
	});
}

export function useAdminWorkspaceQuery(workspaceId: string | null) {
	return useQuery({
		queryKey: adminKeys.workspace(workspaceId ?? ""),
		queryFn: () => adminService.getWorkspace(workspaceId as string),
		enabled: !!workspaceId,
	});
}

/** A comp changes the workspace's plan everywhere it is read. */
function invalidateWorkspacePlan(
	queryClient: ReturnType<typeof useQueryClient>,
) {
	void queryClient.invalidateQueries({ queryKey: adminKeys.workspacesAll });
	void queryClient.invalidateQueries({ queryKey: workspaceKeys.all });
	void queryClient.invalidateQueries({ queryKey: billingKeys.all });
}

export function useSetWorkspaceCompMutation() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({
			workspaceId,
			input,
		}: {
			workspaceId: string;
			input: SetWorkspaceCompInput;
		}) => adminService.setWorkspaceComp(workspaceId, input),
		onSuccess: () => invalidateWorkspacePlan(queryClient),
	});
}

export function useClearWorkspaceCompMutation() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: ({
			workspaceId,
			note,
		}: {
			workspaceId: string;
			note?: string;
		}) => adminService.clearWorkspaceComp(workspaceId, note),
		onSuccess: () => invalidateWorkspacePlan(queryClient),
	});
}
