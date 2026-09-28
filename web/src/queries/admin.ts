import type { AdminWorkspaceListParams } from "@/services/admin.service";

/**
 * Query keys for the admin console.
 *
 * `me` keeps the bare `["adminMe"]` key the admin shell and the user menu
 * already use, so every reader shares one cached admin profile.
 */
export const adminKeys = {
	me: ["adminMe"] as const,
	all: ["admin"] as const,
	planLimits: ["admin", "plan-limits"] as const,
	workspacesAll: ["admin", "workspaces"] as const,
	workspaces: (params: AdminWorkspaceListParams) =>
		["admin", "workspaces", "list", params] as const,
	workspace: (workspaceId: string) =>
		["admin", "workspaces", "detail", workspaceId] as const,
};
