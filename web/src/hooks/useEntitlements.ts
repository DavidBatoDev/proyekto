import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import {
	buildEntitlements,
	type EntitlementsStatus,
	type WorkspaceEntitlements,
} from "@/lib/entitlements";
import { workspaceKeys } from "@/queries/workspaces";
import {
	getWorkspaceUsage,
	type WorkspaceUsage,
} from "@/services/entitlements.service";

const STALE_30S = 30 * 1000;

/** Readable by any workspace member, so it is safe to fire on any page. */
export function useWorkspaceUsageQuery(workspaceId?: string | null) {
	return useQuery<WorkspaceUsage>({
		queryKey: workspaceKeys.usage(workspaceId ?? ""),
		queryFn: () => getWorkspaceUsage(workspaceId as string),
		enabled: Boolean(workspaceId),
		staleTime: STALE_30S,
		refetchOnWindowFocus: true,
		retry: 1,
	});
}

/**
 * The workspace's plan and limits for early warnings. Every answer fails open
 * while usage is loading or unavailable — the server re-checks each write.
 */
export function useEntitlements(
	workspaceId?: string | null,
): WorkspaceEntitlements {
	const query = useWorkspaceUsageQuery(workspaceId);
	const status: EntitlementsStatus = query.data
		? "ready"
		: !workspaceId || query.isError
			? "unavailable"
			: "loading";
	return useMemo(
		() => buildEntitlements(query.data ?? null, status),
		[query.data, status],
	);
}

/** Refresh one workspace's usage, or every workspace's when no id is given. */
export function useInvalidateUsage() {
	const queryClient = useQueryClient();
	return useCallback(
		(workspaceId?: string | null) =>
			queryClient.invalidateQueries({
				queryKey: workspaceId
					? workspaceKeys.usage(workspaceId)
					: workspaceKeys.usageAll,
			}),
		[queryClient],
	);
}
