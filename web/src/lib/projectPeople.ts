import type { ProjectMember } from "@/services/project.service";

/**
 * Who is on a project, and where their access comes from.
 *
 * There is no `is_external` column anywhere. The only signal is
 * `project_access.origin`, which the API returns per grant:
 *
 *   client | consultant | invited | personal_workspace | legacy | team:<uuid>
 *
 * Everything the People surface says about "internal vs external" is derived
 * here, so there is one place to correct if that vocabulary ever changes.
 */

export type PersonKind = "internal" | "external";

export interface AccessSource {
	kind: "direct" | "team";
	/** Set when kind === "team". */
	teamId?: string;
	/** Plain-language description of where the access comes from. */
	label: string;
}

const TEAM_ORIGIN_PREFIX = "team:";

/** The team id behind a `team:<uuid>` origin, or null for a direct grant. */
export function teamIdFromOrigin(origin?: string | null): string | null {
	if (!origin?.startsWith(TEAM_ORIGIN_PREFIX)) return null;
	return origin.slice(TEAM_ORIGIN_PREFIX.length) || null;
}

const DIRECT_ORIGIN_LABELS: Record<string, string> = {
	direct: "Added directly to this project",
	invited: "Invited directly",
	personal_workspace: "Owner of this personal workspace",
	legacy: "Added before access tracking",
};

/**
 * Whether a person reaches this project through one of your teams.
 *
 * This is the ONLY thing the classification means, and the UI copy says so:
 * "external" is shorthand for "we can't show they're on a team here", not a
 * statement about who they are. A bare invite is external; so is a legacy row.
 *
 * `consultant` used to count as internal alongside `personal_workspace`. That
 * origin is gone — a project has members, not a consultant — and keeping it
 * would have been worse than useless after the migration folded it into
 * `direct`: the person leading the work would have started rendering as
 * "external".
 *
 * A person with *any* team grant counts as internal: being on a team is the
 * stronger fact, and mislabelling a teammate is the worse error of the two.
 */
export function classifyPerson(rows: ProjectMember[]): PersonKind {
	const internal = rows.some((row) => {
		const origin = row.origin ?? "";
		return (
			origin.startsWith(TEAM_ORIGIN_PREFIX) || origin === "personal_workspace"
		);
	});
	return internal ? "internal" : "external";
}

/** Every distinct route by which a person reaches this project. */
export function accessSources(
	rows: ProjectMember[],
	teamNameById: Record<string, string>,
): AccessSource[] {
	const seen = new Set<string>();
	const sources: AccessSource[] = [];
	for (const row of rows) {
		const origin = row.origin ?? "";
		const teamId = teamIdFromOrigin(origin);
		const key = teamId ? `team:${teamId}` : `direct:${origin}`;
		if (seen.has(key)) continue;
		seen.add(key);

		if (teamId) {
			const name = teamNameById[teamId];
			sources.push({
				kind: "team",
				teamId,
				label: name
					? `Member of ${name}, which is attached to this project`
					: "Member of a team attached to this project",
			});
		} else {
			sources.push({
				kind: "direct",
				label: DIRECT_ORIGIN_LABELS[origin] ?? "Added directly to this project",
			});
		}
	}
	return sources;
}

/**
 * Can this person change things, in the sense the summary strip means?
 *
 * Approximate on purpose. The roster only receives `role` plus a `capabilities`
 * *delta*; `permissions_json` is always null on this payload and the
 * origin-based defaults live server-side, so exact effective permissions can't
 * be reproduced here. Role is the dominant term and the yoke invariant keeps it
 * uniform across a person's grants, which makes this right in practice.
 *
 * The access drawer does NOT use this — it fetches the authoritative
 * per-member permissions. Precision where precision is claimed.
 */
// The share_role ladder, from `editor` up. It used to also list "consultant"
// and "member", neither of which is a share_role — so neither ever matched.
const EDITOR_ROLES = new Set(["owner", "admin", "editor"]);

export function likelyCanEdit(rows: ProjectMember[]): boolean {
	return rows.some((row) => {
		// An explicit capability override wins over the role baseline.
		const caps = row.capabilities ?? {};
		if (caps["project.edit_content"] === true) return true;
		if (caps["project.edit_content"] === false) return false;
		return EDITOR_ROLES.has(row.role);
	});
}

export interface PeopleSummary {
	total: number;
	canEdit: number;
	viewOnly: number;
	external: number;
}

export function summarize(groups: ProjectMember[][]): PeopleSummary {
	let canEdit = 0;
	let external = 0;
	for (const rows of groups) {
		if (likelyCanEdit(rows)) canEdit += 1;
		if (classifyPerson(rows) === "external") external += 1;
	}
	return {
		total: groups.length,
		canEdit,
		viewOnly: groups.length - canEdit,
		external,
	};
}
