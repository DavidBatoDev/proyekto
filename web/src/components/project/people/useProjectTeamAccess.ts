import { useMemo } from "react";
import {
	useProjectDetailQuery,
	useProjectMembersQuery,
} from "@/hooks/useProjectQueries";
import { hasProjectAdminAccess } from "@/lib/projectAccess";
import { useUser } from "@/stores/authStore";

const ADMIN_ROLES = new Set(["owner", "admin", "consultant", "client"]);

/**
 * Coarse persona gate for the administrative pages inside Project > Team.
 * Freelancers still see the combined people/team roster, but not permissions,
 * the permissions catalog, or invites.
 */
export function useProjectTeamAccess(projectId: string) {
	const user = useUser();
	const projectQuery = useProjectDetailQuery(projectId);
	const membersQuery = useProjectMembersQuery(projectId);

	const access = useMemo(() => {
		const project = projectQuery.data;
		const userId = user?.id;
		if (!project || !userId) {
			return { role: null, isFreelancer: false, canViewAdmin: false };
		}

		const isProjectPrincipal = hasProjectAdminAccess(project, userId);
		const membership = (membersQuery.data ?? []).find(
			(member) => member.user_id === userId,
		);
		const role = membership?.role ?? null;
		const canViewAdmin =
			isProjectPrincipal || (role ? ADMIN_ROLES.has(role) : false);

		return {
			role,
			isFreelancer: !canViewAdmin,
			canViewAdmin,
		};
	}, [membersQuery.data, projectQuery.data, user?.id]);

	return {
		...access,
		isPending: projectQuery.isPending || membersQuery.isPending,
	};
}
