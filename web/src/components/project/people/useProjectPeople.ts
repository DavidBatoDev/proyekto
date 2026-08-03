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
	getTeam,
	listProjectTeams,
	type ProfileSummary,
	type ProjectTeam,
	type Team,
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
	/** Caller may remove this person from the project. */
	canRemove: boolean;
	sources: AccessSource[];
	teamIds: string[];
}

export interface PeopleTeamGroup {
	attachment: ProjectTeam;
	team: Team | null;
	people: PersonAccess[];
}

export interface ProjectPeople {
	people: PersonAccess[];
	groups: PeopleTeamGroup[];
	/** People with no team-derived grant — the client, direct invites. */
	direct: PersonAccess[];
	teamNameById: Record<string, string>;
	/** Full team records — rows need the logo, not just the name. */
	teamById: Record<string, Team>;
	summary: PeopleSummary;
	canManageMembers: boolean;
	canManageTeams: boolean;
	isPending: boolean;
}

// Highest first — the effective role when someone holds several grants.
const ROLE_ORDER = [
	"owner",
	"consultant",
	"admin",
	"member",
	"editor",
	"commenter",
	"client",
	"viewer",
] as const;

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

	const teamDetailQueries = useQueries({
		queries: attachments.map((a) => ({
			queryKey: ["teams", "detail", a.team_id],
			queryFn: () => getTeam(a.team_id),
			staleTime: 5 * 60_000,
		})),
	});

	const teamById = useMemo(() => {
		const map: Record<string, Team> = {};
		teamDetailQueries.forEach((q, i) => {
			const id = attachments[i]?.team_id;
			if (id && q.data) map[id] = q.data;
		});
		return map;
	}, [teamDetailQueries, attachments]);

	const teamNameById = useMemo(() => {
		const map: Record<string, string> = {};
		for (const [id, team] of Object.entries(teamById)) map[id] = team.name;
		return map;
	}, [teamById]);

	const members = useMemo(() => membersQuery.data ?? [], [membersQuery.data]);
	const callerIsOwner = isCallerOwner(members, callerUserId);
	const canManageMembers = Boolean(permissionsQuery.data?.members.manage);
	const canEditPermissionsGrant = Boolean(
		permissionsQuery.data?.members.edit_permissions,
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
			const teamIds = rows
				.map((r) => teamIdFromOrigin(r.origin))
				.filter((id): id is string => Boolean(id));

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
				canRemove: canManageMembers && !isSelf && !outrankedForManage,
				sources: accessSources(rows, teamNameById),
				teamIds,
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
		canManageMembers,
		teamNameById,
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
			membersQuery.isPending || teamsQuery.isPending || invitesQuery.isPending,
	};
}
