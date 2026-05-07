/**
 * Frontend mirror of the backend's `assertActionOutranks` rule.
 *
 * Used to hide/disable Edit and Remove controls so the UI matches
 * what the server will accept. The backend is the source of truth —
 * this is purely cosmetic.
 *
 * Rule: a non-owner caller can act on a target only if the target
 * does NOT hold the gating capability themselves. Owner is always
 * allowed.
 */
import { ROLE_PRESETS } from "@/components/project/permissions/roleTemplates";
import type { ProjectMember } from "@/services/project.service";

export type GatePath = "members.edit_permissions" | "members.manage";

export function memberHasGate(
	member: Pick<ProjectMember, "role" | "capabilities">,
	gate: GatePath,
): boolean {
	const override = member.capabilities?.[gate];
	if (override === true) return true;
	if (override === false) return false;

	const role = member.role;
	if (role === "owner") return true;
	const preset =
		role === "admin" || role === "editor" || role === "viewer"
			? ROLE_PRESETS[role]
			: null;
	if (!preset) return false;
	const [section, field] = gate.split(".") as [
		keyof typeof preset,
		string,
	];
	const sectionRecord = preset[section] as Record<string, boolean>;
	return Boolean(sectionRecord?.[field]);
}

export function findCallerRow(
	members: ProjectMember[],
	callerUserId: string | null,
): ProjectMember | null {
	if (!callerUserId) return null;
	return members.find((m) => m.user_id === callerUserId) ?? null;
}

export function isCallerOwner(
	members: ProjectMember[],
	callerUserId: string | null,
): boolean {
	return findCallerRow(members, callerUserId)?.role === "owner";
}

export function isOutranked(
	caller: { isOwner: boolean },
	target: Pick<ProjectMember, "role" | "capabilities">,
	gate: GatePath,
): boolean {
	if (caller.isOwner) return false;
	return memberHasGate(target, gate);
}
