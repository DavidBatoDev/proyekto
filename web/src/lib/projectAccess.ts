/**
 * Project participation is read from `project_access` rows: a project has
 * members with access, and what each one can do is their `role` plus their
 * `capabilities`.
 *
 * `getProjectConsultantMember` and `isProjectConsultant` used to live here,
 * finding "the consultant" by looking for the row whose origin was
 * 'consultant'. Both are gone along with that origin value — a project does not
 * have a client and a consultant, it has members, and the two parties to a
 * piece of work are recorded on a contract instead.
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

export function isPersonalWorkspace(
	project?: ProjectWithAccess | null,
): boolean {
	return (project?.members ?? []).some(
		(member) => member.origin === "personal_workspace",
	);
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
