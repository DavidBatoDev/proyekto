import type { ProjectPermissions } from "@/services/project.service";
import type { ClientHoursLevel } from "@/services/time.types";

/**
 * Dotted permission paths the project navigation gates on.
 *
 * Deliberately narrower than the backend's PermissionPath union — widen it as
 * new gates are actually needed. Before this existed the nav could only
 * express `access.*`, which is why the Logs entry was visible to everyone:
 * the permission that governs it, `logs.view`, lives on a sibling section.
 *
 * `time.page` is not a single permission but the Project › Time composite
 * (ux.md › Reports, L22): see `canOpenProjectTime`.
 */
export type ProjectNavGate =
	| `access.${keyof ProjectPermissions["access"] & string}`
	| "logs.view"
	| "time.page";

/**
 * Resolve a dotted gate against a permission set.
 *
 * FAIL-OPEN while permissions are still loading — hiding a nav item and then
 * revealing it a moment later reads as a glitch, and the route itself is
 * gated server-side regardless. This preserves the behaviour the two nav
 * components already had.
 */
export function hasNavGate(
	perms: ProjectPermissions | undefined,
	gate: ProjectNavGate | undefined,
): boolean {
	if (!gate || !perms) return true;
	if (gate === "time.page") return canOpenProjectTime(perms);
	const [section, field] = gate.split(".");
	const sectionValue = (perms as unknown as Record<string, unknown>)[section];
	if (!sectionValue || typeof sectionValue !== "object") return false;
	return (sectionValue as Record<string, unknown>)[field] === true;
}

// ── Project › Time ──────────────────────────────────────────────────────────

/** What the caller may do with time on one project, from `my-permissions`. */
export interface ProjectTimeAccess {
	/** `time.log`: start timers and add time here (editor and above). */
	canLog: boolean;
	/**
	 * `access.time`: the caller may read their own past entries here. Not part
	 * of the Project › Time gate (`canOpenProjectTime`); `/time` lists them.
	 */
	ownTime: boolean;
	/** `time.view_team_logs`: the Everyone view. */
	everyone: boolean;
	/** The least client-hours level over the caller's client-agreement seats here. */
	clientLevel: ClientHoursLevel;
	/** The Client hours view (`clientLevel` is not `none`). */
	client: boolean;
}

function normaliseClientLevel(value: unknown): ClientHoursLevel {
	return value === "summary" || value === "detailed" ? value : "none";
}

/**
 * The caller's time standing on a project. Missing sections read as "no":
 * stored member permissions and older payloads carry no
 * `time_client_hours_level` (and once carried no `time.log`).
 */
export function projectTimeAccess(
	perms: ProjectPermissions | null | undefined,
): ProjectTimeAccess {
	const time = perms?.time as Partial<ProjectPermissions["time"]> | undefined;
	const clientLevel = normaliseClientLevel(perms?.time_client_hours_level);
	return {
		canLog: time?.log === true,
		ownTime: perms?.access?.time === true,
		everyone: time?.view_team_logs === true,
		clientLevel,
		client: clientLevel !== "none",
	};
}

/**
 * The Project › Time nav item and route gate (ux.md › Reports, L22): shown
 * when the caller can log here (`time.log`), can see everyone's time
 * (`time.view_team_logs`), or holds a client-hours level other than `none`.
 */
export function canOpenProjectTime(
	perms: ProjectPermissions | null | undefined,
): boolean {
	const access = projectTimeAccess(perms);
	return access.canLog || access.everyone || access.client;
}
