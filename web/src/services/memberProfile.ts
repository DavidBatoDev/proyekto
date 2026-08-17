import type { ProjectMember } from "@/services/project.service";
import type { ProfileSummary } from "@/services/teams.service";

/**
 * Bridge a `ProjectMember` to the `ProfileSummary` that `Avatar` and the member
 * pickers take.
 *
 * The two shapes disagree on absence: `ProjectMember.user` leaves its fields
 * `undefined`, `ProfileSummary` uses `null`. Returns null when the member has no
 * user at all — an invite that has not been accepted yet.
 *
 * Lives in its own module because three surfaces now need it and each had begun
 * writing the mapping inline.
 */
export function toProfileSummary(member: ProjectMember): ProfileSummary | null {
	if (!member.user) return null;
	return {
		id: member.user.id,
		display_name: member.user.display_name ?? null,
		avatar_url: member.user.avatar_url ?? null,
		email: member.user.email ?? null,
		first_name: member.user.first_name ?? null,
		last_name: member.user.last_name ?? null,
	};
}

/** Members indexed by user id, for rows that show who did something. */
export function profilesByUserId(
	members: ProjectMember[] | undefined,
): Map<string, ProfileSummary> {
	const map = new Map<string, ProfileSummary>();
	for (const member of members ?? []) {
		const profile = toProfileSummary(member);
		if (profile && member.user_id) map.set(member.user_id, profile);
	}
	return map;
}
