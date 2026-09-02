/**
 * Query keys for the workspace (organization) tier.
 *
 * A factory rather than keys inlined at call sites — the teams domain grew the
 * latter way and its keys are now spelled out in five components, which is how
 * an invalidation quietly stops matching.
 */
export const workspaceKeys = {
	all: ["workspaces"] as const,
	mine: (userId: string | undefined) =>
		["workspaces", "mine", userId ?? "anonymous"] as const,
	detail: (workspaceId: string) =>
		["workspaces", "detail", workspaceId] as const,
	members: (workspaceId: string) =>
		["workspaces", "members", workspaceId] as const,
	invites: (workspaceId: string) =>
		["workspaces", "invites", workspaceId] as const,
	myInvites: ["workspaces", "my-invites"] as const,
};
