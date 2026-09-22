import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
	DEFAULT_PLAN_LIMITS,
	type PlanId,
	type PlanLimits,
} from "@/lib/planLimits";
import { planKeys } from "@/queries/plans";
import { getPublicPlanLimits } from "@/services/entitlements.service";

export interface PublicPlanLimitsState {
	limits: Record<PlanId, PlanLimits>;
	/** False while loading or after a failed fetch — the defaults are showing. */
	isLive: boolean;
	version: string | null;
}

/**
 * The limit matrix for /pricing and "Available on Pro" hints.
 *
 * Falls back to `DEFAULT_PLAN_LIMITS` (the seed) by hand rather than through
 * `placeholderData`: in React Query v5 placeholder data disappears once the
 * query errors, so an API outage would blank the pricing table. Because the
 * defaults equal the seed, nothing visibly changes when live data arrives
 * unless an admin has edited a limit.
 */
export function usePublicPlanLimits(): PublicPlanLimitsState {
	const query = useQuery({
		queryKey: planKeys.public,
		queryFn: getPublicPlanLimits,
		staleTime: 5 * 60 * 1000,
		retry: 1,
		refetchOnWindowFocus: false,
	});
	const data = query.data;
	return useMemo(
		() =>
			data
				? { limits: data.limits, isLive: true, version: data.version }
				: { limits: DEFAULT_PLAN_LIMITS, isLive: false, version: null },
		[data],
	);
}
