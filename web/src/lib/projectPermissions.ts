import type { ProjectPermissions } from "@/services/project.service";

/**
 * Dotted permission paths the project navigation gates on.
 *
 * Deliberately narrower than the backend's PermissionPath union — widen it as
 * new gates are actually needed. Before this existed the nav could only
 * express `access.*`, which is why the Logs entry was visible to everyone:
 * the permission that governs it, `logs.view`, lives on a sibling section.
 */
export type ProjectNavGate =
	| `access.${keyof ProjectPermissions["access"] & string}`
	| "logs.view";

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
	const [section, field] = gate.split(".");
	const sectionValue = (perms as unknown as Record<string, unknown>)[section];
	if (!sectionValue || typeof sectionValue !== "object") return false;
	return (sectionValue as Record<string, unknown>)[field] === true;
}
