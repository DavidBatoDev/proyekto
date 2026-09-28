/**
 * Query keys for the public plan-limit matrix (`GET /api/plans`).
 *
 * Kept apart from `workspaceKeys`: the matrix is the same for every visitor,
 * signed in or not. An admin edit to the limits invalidates `planKeys.all`.
 */
export const planKeys = {
	all: ["plans"] as const,
	public: ["plans", "public"] as const,
};
