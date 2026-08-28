import { useQueries, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
	useProjectInvitesQuery,
	useProjectMembersQuery,
	useProjectMyPermissionsQuery,
} from "@/hooks/useProjectQueries";
import { isCallerOwner, isOutranked } from "@/lib/projectMemberRank";
import {
	type AccessSource,
	accessSources,
	classifyPerson,
	likelyCanEdit,
	type PeopleSummary,
	summarize,
	teamIdFromOrigin,
} from "@/lib/projectPeople";
import type { ProjectMember } from "@/services/project.service";
import {
	listCuratedMembers,
	listProjectTeams,
	type ProfileSummary,
	type ProjectTeam,
	type TeamSummary,
} from "@/services/teams.service";

/**
 * One assembly of "who is on this project", for the single People surface.
 *
 * Composes queries that already exist — members, invites, attached teams, team
 * details — rather than adding an endpoint. The roster used to be rebuilt five
 * different ways across four components; this is the one shape they all wanted.
 *
 * Deliberately NOT `useProjectRoster`: that intersects team membership with
 * curation and so misses direct shares entirely, which is exactly the half of
 * the roster the People page must not drop.
 */

export interface PersonAccess {
	/** Grouping key. Falls back to the row id for a row with no user. */
	key: string;
	userId: string | null;
	/** The row to write against — see pickPrimaryRow's rationale below. */
	memberId: string;
	rows: ProjectMember[];
	user: ProfileSummary | null;
	role: string;
	position: string | null;
	isExternal: boolean;
	isSelf: boolean;
	likelyCanEdit: boolean;
	/** Caller may edit this person's permissions. */
	canEditPermissions: boolean;
	/** Caller may edit this person's project position (everyone may edit self). */
	canEditPosition: boolean;
	/** Caller may remove this person from the project. */
	canRemove: boolean;
	sources: AccessSource[];
	teamIds: string[];
}

export interface PeopleTeamGroup {
	attachment: ProjectTeam;
	team: TeamSummary | null;
	people: PersonAccess[];
}

export interface ProjectPeople {
	people: PersonAccess[];
	groups: PeopleTeamGroup[];
	/** People with no team-derived grant — the client, direct invites. */
	direct: PersonAccess[];
	teamNameById: Record<string, string>;
	/** Team identity per attached team — rows need the logo, not just the name. */
	teamById: Record<string, TeamSummary>;
	summary: PeopleSummary;
	canManageMembers: boolean;
	canManageTeams: boolean;
	isPending: boolean;
}

// The share_role ladder, highest first. It used to also carry "consultant",
// "member" and "client" — none of which are share_role values, so none ever
// matched — and they sat in positions that would have mis-sorted the real rungs
// if they had.
const ROLE_ORDER = ["owner", "admin", "editor", "commenter", "viewer"] as const;

/**
 * ProjectMember.user uses `string | undefined` where ProfileSummary uses
 * `string | null`. Same data, two shapes — normalise once here so the row
 * components only ever see ProfileSummary.
 */
function toProfileSummary(
	user: ProjectMember["user"],
	fallbackId: string | null,
): ProfileSummary | null {
	if (!user) return fallbackId ? ({ id: fallbackId } as ProfileSummary) : null;
	return {
		id: user.id,
		display_name: user.display_name ?? null,
		avatar_url: user.avatar_url ?? null,
		email: user.email ?? null,
		first_name: user.first_name ?? null,
		last_name: user.last_name ?? null,
	} as ProfileSummary;
}

function roleRank(role: string): number {
	const i = ROLE_ORDER.indexOf(role as (typeof ROLE_ORDER)[number]);
	return i === -1 ? ROLE_ORDER.length : i;
}

export function useProjectPeople(
	projectId: string,
	callerUserId: string | null,
): ProjectPeople {
	const membersQuery = useProjectMembersQuery(projectId);
	const invitesQuery = useProjectInvitesQuery(projectId);
	const permissionsQuery = useProjectMyPermissionsQuery(projectId);
	const teamsQuery = useQuery({
		queryKey: ["project", projectId, "teams"],
		queryFn: () => listProjectTeams(projectId),
	});

	const attachments = useMemo(() => teamsQuery.data ?? [], [teamsQuery.data]);

	// `project_access.origin` is only rewritten to `team:<id>` when a person is
	// curated fresh onto a team. Someone who already had a project_access row
	// (the project owner, granted at creation; anyone added directly before
	// being curated onto a team) keeps their old origin forever, even though
	// project_team_members — the actual curation record — lists them
	// correctly. Querying it directly here is the only way to see them.
	const curatedQueries = useQueries({
		queries: attachments.map((a) => ({
			queryKey: ["project", projectId, "teams", a.team_id, "curated-members"],
			queryFn: () => listCuratedMembers(projectId, a.team_id),
		})),
	});

	const curatedTeamIdsByUserId = useMemo(() => {
		const map = new Map<string, Set<string>>();
		attachments.forEach((a, i) => {
			const rows = curatedQueries[i]?.data ?? [];
			for (const row of rows) {
				const set = map.get(row.user_id) ?? new Set<string>();
				set.add(a.team_id);
				map.set(row.user_id, set);
			}
		});
		return map;
	}, [attachments, curatedQueries]);

	// Identity comes from the attachment itself, not from GET /api/teams/:id.
	// That endpoint gates on team membership, so for a team brought in through
	// "Invite a team" — one this viewer is deliberately not on — it 403s and the
	// card silently rendered the literal string "Team" with no logo. The list
	// endpoint joins the summary, which the viewer is already entitled to.
	const teamById = useMemo(() => {
		const map: Record<string, TeamSummary> = {};
		for (const a of attachments) {
			if (a.team) map[a.team_id] = a.team;
		}
		return map;
	}, [attachments]);

	const teamNameById = useMemo(() => {
		const map: Record<string, string> = {};
		for (const [id, team] of Object.entries(teamById)) {
			if (team.name) map[id] = team.name;
		}
		return map;
	}, [teamById]);

	const members = useMemo(() => membersQuery.data ?? [], [membersQuery.data]);
	const callerIsOwner = isCallerOwner(members, callerUserId);
	const canManageMembers = Boolean(permissionsQuery.data?.members.manage);
	const canEditPermissionsGrant = Boolean(
		permissionsQuery.data?.members.edit_permissions,
	);
	const canEditPositionGrant = Boolean(
		permissionsQuery.data?.members.edit_position,
	);
	const canManageTeams = Boolean(permissionsQuery.data?.teams.manage);

	const people = useMemo<PersonAccess[]>(() => {
		// Group by user. `project_access` is one row per (project,user) since the
		// 20260507000130 collapse, but the yoke migrations left the multi-row
		// shape reachable, so grouping stays defensive.
		const byUser = new Map<string, ProjectMember[]>();
		for (const row of members) {
			const key = row.user_id ?? `row:${row.id}`;
			const bucket = byUser.get(key);
			if (bucket) bucket.push(row);
			else byUser.set(key, [row]);
		}

		const result: PersonAccess[] = [];
		for (const [key, rows] of byUser) {
			// Write against the highest-ranked row: the one whose role the server
			// will treat as this person's effective role.
			const ranked = [...rows].sort(
				(a, b) => roleRank(a.role) - roleRank(b.role),
			);
			const primary = ranked[0];
			const teamIds = new Set(
				rows
					.map((r) => teamIdFromOrigin(r.origin))
					.filter((id): id is string => Boolean(id)),
			);
			if (primary.user_id) {
				for (const id of curatedTeamIdsByUserId.get(primary.user_id) ?? []) {
					teamIds.add(id);
				}
			}

			const isSelf = Boolean(callerUserId && primary.user_id === callerUserId);
			const outrankedForPerms = isOutranked(
				{ isOwner: callerIsOwner },
				primary,
				"members.edit_permissions",
			);
			const outrankedForManage = isOutranked(
				{ isOwner: callerIsOwner },
				primary,
				"members.manage",
			);

			result.push({
				key,
				userId: primary.user_id,
				memberId: primary.id,
				rows,
				user: toProfileSummary(primary.user, primary.user_id),
				role: primary.role,
				position:
					rows.find((r) => r.position?.trim())?.position?.trim() ?? null,
				isExternal: classifyPerson(rows) === "external",
				isSelf,
				likelyCanEdit: likelyCanEdit(rows),
				// You cannot edit your own permissions or remove yourself here, and
				// you cannot act on someone who outranks you — mirrors the server.
				canEditPermissions:
					canEditPermissionsGrant && !isSelf && !outrankedForPerms,
				canEditPosition: isSelf || canEditPositionGrant,
				canRemove: canManageMembers && !isSelf && !outrankedForManage,
				sources: accessSources(rows, teamNameById),
				teamIds: Array.from(teamIds),
			});
		}

		result.sort((a, b) => {
			const byRole = roleRank(a.role) - roleRank(b.role);
			if (byRole !== 0) return byRole;
			return (a.user?.display_name ?? "").localeCompare(
				b.user?.display_name ?? "",
			);
		});
		return result;
	}, [
		members,
		callerUserId,
		callerIsOwner,
		canEditPermissionsGrant,
		canEditPositionGrant,
		canManageMembers,
		teamNameById,
		curatedTeamIdsByUserId,
	]);

	const groups = useMemo<PeopleTeamGroup[]>(
		() =>
			attachments.map((attachment) => ({
				attachment,
				team: teamById[attachment.team_id] ?? null,
				people: people.filter((p) => p.teamIds.includes(attachment.team_id)),
			})),
		[attachments, teamById, people],
	);

	// Anyone with no team-derived grant at all: the client, direct invites, the
	// consultant. They would otherwise be invisible on a team-grouped page.
	const direct = useMemo(
		() => people.filter((p) => p.teamIds.length === 0),
		[people],
	);

	const summary = useMemo(() => summarize(people.map((p) => p.rows)), [people]);

	return {
		people,
		groups,
		direct,
		teamNameById,
		teamById,
		summary,
		canManageMembers,
		canManageTeams,
		isPending:
			membersQuery.isPending ||
			teamsQuery.isPending ||
			invitesQuery.isPending ||
			curatedQueries.some((q) => q.isPending),
	};
}
