/**
 * Project participation is read from `project_access` rows, never from a
 * consultant field on the project — a project has members with access, and
 * "consultant" is the position one of those rows records via its origin.
 */

/** Top of the share_role ladder: the roles that administer a project. */
const ADMIN_ACCESS_ROLES = new Set(["owner", "admin"]);

export interface ProjectAccessMember {
	user_id?: string | null;
	role?: string | null;
	origin?: string | null;
	has_direct_grant?: boolean;
	granted_at?: string;
	user?: { id: string; display_name?: string | null } | null;
}

export interface ProjectWithAccess {
	owner_id?: string | null;
	members?: ProjectAccessMember[] | null;
}

/**
 * The consultant of record: the access row whose origin is 'consultant'.
 * Ties (possible after a reassignment whose revoke failed) resolve to the
 * direct grant, then the most recent one — matching the backend helper.
 */
export function getProjectConsultantMember(
	project?: ProjectWithAccess | null,
): ProjectAccessMember | null {
	const consultants = (project?.members ?? []).filter(
		(member) => member.origin === "consultant" && Boolean(member.user_id),
	);
	if (consultants.length === 0) return null;

	return [...consultants].sort((a, b) => {
		const directDelta =
			Number(b.has_direct_grant === true) - Number(a.has_direct_grant === true);
		if (directDelta !== 0) return directDelta;
		return (b.granted_at ?? "").localeCompare(a.granted_at ?? "");
	})[0];
}

export function isProjectConsultant(
	project?: ProjectWithAccess | null,
	userId?: string | null,
): boolean {
	if (!userId) return false;
	return getProjectConsultantMember(project)?.user_id === userId;
}

/** Owner of the project row, or an owner/admin access row on it. */
export function hasProjectAdminAccess(
	project?: ProjectWithAccess | null,
	userId?: string | null,
): boolean {
	if (!project || !userId) return false;
	if (project.owner_id === userId) return true;
	return (project.members ?? []).some(
		(member) =>
			member.user_id === userId &&
			ADMIN_ACCESS_ROLES.has((member.role ?? "").toLowerCase()),
	);
}
