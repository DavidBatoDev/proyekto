import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { billingKeys } from "@/queries/billing";
import { workspaceKeys } from "@/queries/workspaces";
import {
	type BillingInterval,
	type BillingSummary,
	createCheckoutSession,
	createPortalSession,
	getBillingSummary,
} from "@/services/billing.service";

/**
 * Only owners and admins may read this — a plain member gets a 403 — so callers
 * must pass a workspace id only when the viewer can manage it. Firing a doomed
 * request would surface the global 403 toast on a page that is otherwise fine.
 */
export function useBillingSummaryQuery(workspaceId?: string | null) {
	return useQuery<BillingSummary>({
		queryKey: billingKeys.summary(workspaceId ?? ""),
		queryFn: () => getBillingSummary(workspaceId as string),
		enabled: Boolean(workspaceId),
		staleTime: 1000 * 30,
		refetchOnWindowFocus: true,
	});
}

/**
 * Refresh billing and, with it, every workspace's usage: a checkout that has
 * just landed changes the plan, and so the limits the Usage page reads.
 */
export function useInvalidateBilling() {
	const queryClient = useQueryClient();
	return useCallback(
		() =>
			Promise.all([
				queryClient.invalidateQueries({ queryKey: billingKeys.all }),
				queryClient.invalidateQueries({ queryKey: workspaceKeys.usageAll }),
			]),
		[queryClient],
	);
}

export function useCreateCheckoutSessionMutation(workspaceId?: string | null) {
	return useMutation({
		mutationFn: (body: {
			plan: "pro" | "business";
			interval: BillingInterval;
			success_path?: string;
			cancel_path?: string;
		}) => createCheckoutSession(workspaceId as string, body),
	});
}

export function useCreatePortalSessionMutation(workspaceId?: string | null) {
	return useMutation({
		mutationFn: (body: { return_path?: string } = {}) =>
			createPortalSession(workspaceId as string, body),
	});
}
