import { useMemo } from "react";
import {
	useProjectMembersQuery,
	useProjectMyPermissionsQuery,
} from "@/hooks/useProjectQueries";
import { useUser } from "@/stores/authStore";

/**
 * Who may see the administrative pages inside Project > Team — permissions, the
 * permissions catalog, and invites.
 *
 * Gated on `members.manage`, the same permission `ProjectTeamAdminGate`'s deny
 * banner already names as its `path`. It used to be a role set — owner, admin,
 * consultant, client — which asked two questions at once: half of it was the
 * share_role ladder and half was a persona a project does not have. Reading the
 * permission means a member whose capabilities withhold roster management is
 * correctly refused even at owner rung, which the role set could not express.
 */
export function useProjectTeamAccess(projectId: string) {
	const user = useUser();
	const permissionsQuery = useProjectMyPermissionsQuery(projectId);
	const membersQuery = useProjectMembersQuery(projectId);

	const access = useMemo(() => {
		const userId = user?.id;
		if (!userId) return { role: null, canViewAdmin: false };

		const membership = (membersQuery.data ?? []).find(
			(member) => member.user_id === userId,
		);
		return {
			role: membership?.role ?? null,
			canViewAdmin: permissionsQuery.data?.members.manage === true,
		};
	}, [membersQuery.data, permissionsQuery.data, user?.id]);

	return {
		...access,
		isPending: permissionsQuery.isPending || membersQuery.isPending,
	};
}
