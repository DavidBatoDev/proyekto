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
	client: "Added as the client",
	consultant: "Leading this project as consultant",
	invited: "Invited directly",
	personal_workspace: "Owner of this personal workspace",
	legacy: "Added before access tracking",
};

/**
 * Internal or external, from every grant a person holds.
 *
 * Anyone reachable through an attached team is internal — they are staff on a
 * team doing the work. `consultant` and `personal_workspace` are internal by
 * definition. Everyone else — the client, a bare invite, a legacy row — is
 * external, because we cannot show they belong to any team here.
 *
 * A person with *any* internal grant counts as internal: being on the delivery
 * team is the stronger fact, and mislabelling a teammate "external" is the
 * worse error of the two.
 */
export function classifyPerson(rows: ProjectMember[]): PersonKind {
	const internal = rows.some((row) => {
		const origin = row.origin ?? "";
		return (
			origin.startsWith(TEAM_ORIGIN_PREFIX) ||
			origin === "consultant" ||
			origin === "personal_workspace"
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
const EDITOR_ROLES = new Set([
	"owner",
	"admin",
	"editor",
	"consultant",
	"member",
]);

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
