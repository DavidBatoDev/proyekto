/**
 * Who keeps and who loses project access when a team is detached.
 *
 * Mirrors the DB trigger `tg_project_team_members_sync_shares` (latest
 * body: migration 20260901154357): on detach every curation row for the
 * team is deleted, and a person's `project_access` row survives only if
 * they hold a direct grant, are curated by another attached team, or are
 * the project owner (owners are always kept, and self-healed to a direct
 * grant). Keep this in sync with that trigger — the modal's preview is a
 * prediction, the trigger is the authority.
 */

export type DetachKeepReason =
	| "owner"
	| "direct"
	| "other-team"
	| "not-curated";

export interface DetachCandidate {
	userId: string | null;
	/** Effective share_role on the project. */
	role: string;
	/** Any project_access row with has_direct_grant = true. */
	hasDirectGrant: boolean;
	/** Teams with a project_team_members (curation) row for this user. */
	curatedTeamIds: readonly string[];
}

export interface DetachOutcomes<P extends DetachCandidate> {
	/** Curated only by this team, with no direct grant: removed on detach. */
	losesAccess: P[];
	keepsAccess: Array<{ person: P; reason: DetachKeepReason }>;
}

export function computeDetachOutcomes<P extends DetachCandidate>(
	people: readonly P[],
	teamId: string,
	ownerUserId?: string | null,
): DetachOutcomes<P> {
	const losesAccess: P[] = [];
	const keepsAccess: Array<{ person: P; reason: DetachKeepReason }> = [];

	for (const person of people) {
		if (!person.curatedTeamIds.includes(teamId)) {
			// No curation row for this team, so the detach deletes nothing
			// of theirs and the trigger never evaluates them.
			keepsAccess.push({ person, reason: "not-curated" });
			continue;
		}
		if (
			person.role === "owner" ||
			(ownerUserId != null && person.userId === ownerUserId)
		) {
			keepsAccess.push({ person, reason: "owner" });
			continue;
		}
		if (person.hasDirectGrant) {
			keepsAccess.push({ person, reason: "direct" });
			continue;
		}
		if (person.curatedTeamIds.some((id) => id !== teamId)) {
			keepsAccess.push({ person, reason: "other-team" });
			continue;
		}
		losesAccess.push(person);
	}

	return { losesAccess, keepsAccess };
}
