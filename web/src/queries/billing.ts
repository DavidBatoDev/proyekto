/**
 * Query keys for platform billing (Proyekto's own subscriptions), not contract
 * billing periods.
 */
export const billingKeys = {
	all: ["billing"] as const,
	summary: (workspaceId: string) =>
		[...billingKeys.all, "summary", workspaceId] as const,
};
