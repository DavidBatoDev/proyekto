import apiClient from "@/api/axios";
import { extractApiErrorMessage } from "@/lib/permissionErrors";

export type TeamRole = "owner" | "admin" | "member";
export type ProjectTeamDefaultRole = "admin" | "editor" | "commenter" | "viewer";

export interface Team {
	id: string;
	owner_id: string;
	name: string;
	description: string | null;
	avatar_url: string | null;
	is_personal: boolean;
	created_at: string;
	updated_at: string;
	// Populated by listMyTeams. Other endpoints that return a single
	// Team may leave these undefined.
	members_count?: number;
	members_preview?: Array<ProfileSummary | null>;
	// The caller's own role / position within this team — drives the
	// per-card "what am I here?" chip on /teams.
	viewer_role?: TeamRole | null;
	viewer_position?: string | null;
}

export interface ProfileSummary {
	id: string;
	display_name: string | null;
	avatar_url: string | null;
	email: string | null;
	first_name: string | null;
	last_name: string | null;
}

export interface TeamMember {
	id: string;
	team_id: string;
	user_id: string;
	role: TeamRole;
	position: string | null;
	hourly_rate: number | null;
	currency: string | null;
	custom_id: string | null;
	start_date: string | null;
	end_date: string | null;
	joined_at: string;
	user?: ProfileSummary | null;
}

export interface ProjectTeam {
	project_id: string;
	team_id: string;
	is_primary: boolean;
	attached_by: string | null;
	attached_at: string;
}

export interface ProjectTeamMember {
	project_id: string;
	team_id: string;
	user_id: string;
	added_by: string | null;
	added_at: string;
	user?: ProfileSummary | null;
}

export interface AvailableTeamMember {
	user_id: string;
	role: TeamRole;
	user: ProfileSummary | null;
}

export type TeamInviteStatus =
	| "pending"
	| "accepted"
	| "declined"
	| "cancelled";

export interface TeamInvite {
	id: string;
	team_id: string;
	invited_by: string | null;
	invitee_id: string | null;
	invitee_email: string | null;
	role: TeamRole;
	position: string | null;
	status: TeamInviteStatus;
	message: string | null;
	responded_at: string | null;
	created_at: string;
	updated_at: string;
	team?: { id: string; name: string; avatar_url: string | null } | null;
	invited_by_profile?: ProfileSummary | null;
	invitee?: ProfileSummary | null;
}

export interface InviteTeamMemberInput {
	email: string;
	role?: TeamRole;
	position?: string;
	message?: string;
}

export interface UpdateTeamMemberInput {
	role?: "admin" | "member";
	position?: string;
}

// â”€â”€â”€ Team CRUD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function listMyTeams(): Promise<Team[]> {
	try {
		const { data } = await apiClient.get<{ data: Team[] }>("/api/teams");
		return data.data;
	} catch (err) {
		throw new Error(
			extractApiErrorMessage(
				(err as { response?: { data?: unknown } }).response?.data,
				"Failed to load teams",
			),
		);
	}
}

export async function getTeam(teamId: string): Promise<Team> {
	try {
		const { data } = await apiClient.get<{ data: Team }>(`/api/teams/${teamId}`);
		return data.data;
	} catch (err) {
		throw new Error(
			extractApiErrorMessage(
				(err as { response?: { data?: unknown } }).response?.data,
				"Failed to load team",
			),
		);
	}
}

export async function createTeam(input: {
	name: string;
	description?: string;
	avatar_url?: string;
}): Promise<Team> {
	try {
		const { data } = await apiClient.post<{ data: Team }>("/api/teams", input);
		return data.data;
	} catch (err) {
		throw new Error(
			extractApiErrorMessage(
				(err as { response?: { data?: unknown } }).response?.data,
				"Failed to create team",
			),
		);
	}
}

export async function updateTeam(
	teamId: string,
	patch: { name?: string; description?: string; avatar_url?: string },
): Promise<Team> {
	try {
		const { data } = await apiClient.patch<{ data: Team }>(`/api/teams/${teamId}`, patch);
		return data.data;
	} catch (err) {
		throw new Error(
			extractApiErrorMessage(
				(err as { response?: { data?: unknown } }).response?.data,
				"Failed to update team",
			),
		);
	}
}

export async function deleteTeam(teamId: string): Promise<void> {
	try {
		await apiClient.delete(`/api/teams/${teamId}`);
	} catch (err) {
		throw new Error(
			extractApiErrorMessage(
				(err as { response?: { data?: unknown } }).response?.data,
				"Failed to delete team",
			),
		);
	}
}

// â”€â”€â”€ Team members â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function listTeamMembers(teamId: string): Promise<TeamMember[]> {
	try {
		const { data } = await apiClient.get<{ data: TeamMember[] }>(`/api/teams/${teamId}/members`,
		);
		return data.data;
	} catch (err) {
		throw new Error(
			extractApiErrorMessage(
				(err as { response?: { data?: unknown } }).response?.data,
				"Failed to load team members",
			),
		);
	}
}

// Direct add by user_id is no longer exposed by the backend. New
// members arrive via invite + accept; see inviteTeamMemberByEmail.

export async function updateTeamMember(
	teamId: string,
	userId: string,
	patch: {
		role?: "admin" | "member";
		position?: string;
		hourly_rate?: number;
		currency?: string;
		custom_id?: string;
		start_date?: string;
		end_date?: string;
	},
): Promise<TeamMember> {
	try {
		const { data } = await apiClient.patch<{ data: TeamMember }>(`/api/teams/${teamId}/members/${userId}`,
			patch,
		);
		return data.data;
	} catch (err) {
		throw new Error(
			extractApiErrorMessage(
				(err as { response?: { data?: unknown } }).response?.data,
				"Failed to update team member",
			),
		);
	}
}

export async function removeTeamMember(
	teamId: string,
	userId: string,
): Promise<void> {
	try {
		await apiClient.delete(`/api/teams/${teamId}/members/${userId}`);
	} catch (err) {
		throw new Error(
			extractApiErrorMessage(
				(err as { response?: { data?: unknown } }).response?.data,
				"Failed to remove team member",
			),
		);
	}
}

export interface TeamProjectAttachment {
	project_id: string;
	team_id: string;
	is_primary: boolean;
	attached_at: string;
	project: {
		id: string;
		title: string | null;
	} | null;
}

export async function listTeamProjects(
	teamId: string,
): Promise<TeamProjectAttachment[]> {
	try {
		const { data } = await apiClient.get<{ data: TeamProjectAttachment[] }>(
			`/api/teams/${teamId}/projects`,
		);
		return data.data;
	} catch (err) {
		throw new Error(
			extractApiErrorMessage(
				(err as { response?: { data?: unknown } }).response?.data,
				"Failed to load attached projects",
			),
		);
	}
}

// â”€â”€â”€ Project â†” team attachments â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function listProjectTeams(
	projectId: string,
): Promise<ProjectTeam[]> {
	try {
		const { data } = await apiClient.get<{ data: ProjectTeam[] }>(`/api/projects/${projectId}/teams`,
		);
		return data.data;
	} catch (err) {
		throw new Error(
			extractApiErrorMessage(
				(err as { response?: { data?: unknown } }).response?.data,
				"Failed to load project teams",
			),
		);
	}
}

export async function attachTeam(
	projectId: string,
	input: {
		team_id: string;
		is_primary?: boolean;
		members?: Array<{ user_id: string; role: ProjectTeamDefaultRole }>;
	},
): Promise<ProjectTeam> {
	try {
		const { data } = await apiClient.post<{ data: ProjectTeam }>(`/api/projects/${projectId}/teams`,
			input,
		);
		return data.data;
	} catch (err) {
		throw new Error(
			extractApiErrorMessage(
				(err as { response?: { data?: unknown } }).response?.data,
				"Failed to attach team",
			),
		);
	}
}

export async function detachTeam(
	projectId: string,
	teamId: string,
): Promise<void> {
	try {
		await apiClient.delete(`/api/projects/${projectId}/teams/${teamId}`);
	} catch (err) {
		throw new Error(
			extractApiErrorMessage(
				(err as { response?: { data?: unknown } }).response?.data,
				"Failed to detach team",
			),
		);
	}
}

export async function updateProjectTeam(
	projectId: string,
	teamId: string,
	patch: {
		is_primary?: boolean;
	},
): Promise<ProjectTeam> {
	try {
		const { data } = await apiClient.patch<{ data: ProjectTeam }>(`/api/projects/${projectId}/teams/${teamId}`,
			patch,
		);
		return data.data;
	} catch (err) {
		throw new Error(
			extractApiErrorMessage(
				(err as { response?: { data?: unknown } }).response?.data,
				"Failed to update project team attachment",
			),
		);
	}
}

export async function listCuratedMembers(
	projectId: string,
	teamId: string,
): Promise<ProjectTeamMember[]> {
	try {
		const { data } = await apiClient.get<{ data: ProjectTeamMember[] }>(`/api/projects/${projectId}/teams/${teamId}/members`,
		);
		return data.data;
	} catch (err) {
		throw new Error(
			extractApiErrorMessage(
				(err as { response?: { data?: unknown } }).response?.data,
				"Failed to load curated members",
			),
		);
	}
}

export async function listAvailableTeamMembers(
	projectId: string,
	teamId: string,
): Promise<AvailableTeamMember[]> {
	try {
		const { data } = await apiClient.get<{ data: AvailableTeamMember[] }>(`/api/projects/${projectId}/teams/${teamId}/available-members`,
		);
		return data.data;
	} catch (err) {
		throw new Error(
			extractApiErrorMessage(
				(err as { response?: { data?: unknown } }).response?.data,
				"Failed to load available members",
			),
		);
	}
}

export async function addCuratedMember(
	projectId: string,
	teamId: string,
	input: { user_id: string; role?: ProjectTeamDefaultRole },
): Promise<ProjectTeamMember> {
	try {
		const { data } = await apiClient.post<{ data: ProjectTeamMember }>(`/api/projects/${projectId}/teams/${teamId}/members`,
			input,
		);
		return data.data;
	} catch (err) {
		throw new Error(
			extractApiErrorMessage(
				(err as { response?: { data?: unknown } }).response?.data,
				"Failed to add member",
			),
		);
	}
}

export async function removeCuratedMember(
	projectId: string,
	teamId: string,
	userId: string,
): Promise<void> {
	try {
		await apiClient.delete(`/api/projects/${projectId}/teams/${teamId}/members/${userId}`,
		);
	} catch (err) {
		throw new Error(
			extractApiErrorMessage(
				(err as { response?: { data?: unknown } }).response?.data,
				"Failed to remove curated member",
			),
		);
	}
}

// ─── Team invites (email-based) ──────────────────────────────────────────

export async function inviteTeamMemberByEmail(
	teamId: string,
	input: InviteTeamMemberInput,
): Promise<TeamInvite> {
	try {
		const { data } = await apiClient.post<{ data: TeamInvite }>(
			`/api/teams/${teamId}/invites`,
			input,
		);
		return data.data;
	} catch (err) {
		throw new Error(
			extractApiErrorMessage(
				(err as { response?: { data?: unknown } }).response?.data,
				"Failed to send invite",
			),
		);
	}
}

export async function listTeamInvites(teamId: string): Promise<TeamInvite[]> {
	try {
		const { data } = await apiClient.get<{ data: TeamInvite[] }>(
			`/api/teams/${teamId}/invites`,
		);
		return data.data;
	} catch (err) {
		throw new Error(
			extractApiErrorMessage(
				(err as { response?: { data?: unknown } }).response?.data,
				"Failed to load team invites",
			),
		);
	}
}

export async function cancelTeamInvite(
	teamId: string,
	inviteId: string,
): Promise<TeamInvite> {
	try {
		const { data } = await apiClient.delete<{ data: TeamInvite }>(
			`/api/teams/${teamId}/invites/${inviteId}`,
		);
		return data.data;
	} catch (err) {
		throw new Error(
			extractApiErrorMessage(
				(err as { response?: { data?: unknown } }).response?.data,
				"Failed to cancel invite",
			),
		);
	}
}

export async function listMyTeamInvites(): Promise<TeamInvite[]> {
	try {
		const { data } = await apiClient.get<{ data: TeamInvite[] }>(
			`/api/teams/me/invites`,
		);
		return data.data;
	} catch (err) {
		throw new Error(
			extractApiErrorMessage(
				(err as { response?: { data?: unknown } }).response?.data,
				"Failed to load your invites",
			),
		);
	}
}

export async function respondTeamInvite(
	inviteId: string,
	status: "accepted" | "declined",
): Promise<TeamInvite> {
	try {
		const { data } = await apiClient.post<{ data: TeamInvite }>(
			`/api/teams/me/invites/${inviteId}/respond`,
			{ status },
		);
		return data.data;
	} catch (err) {
		throw new Error(
			extractApiErrorMessage(
				(err as { response?: { data?: unknown } }).response?.data,
				"Failed to respond to invite",
			),
		);
	}
}
