/**
 * Query keys for team data, mirroring `queries/project.ts`.
 *
 * Team keys were literal arrays typed at ~30 call sites before this existed,
 * which is how the codebase ended up with two unrelated families for the same
 * row — see `legacyDetail` below.
 */
export const teamKeys = {
	all: ["teams"] as const,
	detail: (teamId: string) => ["teams", "detail", teamId] as const,
	members: (teamId: string) => ["teams", "members", teamId] as const,
	projects: (teamId: string) => ["teams", "projects", teamId] as const,
	invites: (teamId: string) => ["teams", "invites", teamId] as const,
	resources: (teamId: string) => ["teams", "resources", teamId] as const,
	mine: (userId: string) => ["teams", "mine", userId] as const,

	/**
	 * The older singular family, still used by the `/teams/$teamId/time/*`
	 * subtree, `useProjectRoster`, `ProjectHeader` and the contract surfaces.
	 * It holds the same team row that `detail` does, but it is NOT under the
	 * `"teams"` prefix — so `invalidateQueries({ queryKey: ["teams"] })` misses
	 * it entirely, which is why renaming a team used to leave a stale name on
	 * the time pages.
	 *
	 * Do not add new call sites. Use `invalidateTeamEverywhere` for writes.
	 */
	legacyDetail: (teamId: string) => ["team", teamId] as const,
};
