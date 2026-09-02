import apiClient from "@/api/axios";
import { extractApiErrorMessage } from "@/lib/permissionErrors";

/**
 * A workspace is the organization: the boundary that owns teams, projects, and
 * the billable seat pool. It is NOT an authorization source for project data —
 * a consultant can hold access to a client's project without ever being a
 * member of that client's workspace.
 */
export type WorkspaceRole = "owner" | "admin" | "member";

/** Roles the API hands out. Ownership transfers only through a member update. */
export type WorkspaceAssignableRole = "admin" | "member";

export type WorkspacePlan = "free" | "pro" | "business" | "enterprise";

export interface WorkspaceSubscription {
	workspace_id: string;
	plan: WorkspacePlan;
	status: "active" | "trialing" | "past_due" | "canceled";
	/** Null means unlimited. Nothing enforces it yet. */
	seat_limit: number | null;
	current_period_start: string | null;
	current_period_end: string | null;
}

export interface Workspace {
	id: string;
	name: string;
	description: string | null;
	avatar_url: string | null;
	created_by: string | null;
	created_at: string;
	updated_at: string;
	/** The caller's own standing. Present on list and detail reads. */
	my_role?: WorkspaceRole | null;
	member_count?: number;
	plan?: WorkspacePlan;
	/** Always the live member count, never a stored counter. */
	seats_used?: number;
	/** Owners and admins only — billing is not a plain member's business. */
	subscription?: WorkspaceSubscription | null;
}

export interface WorkspaceMemberProfile {
	id: string;
	display_name: string | null;
	avatar_url: string | null;
	email: string | null;
	first_name: string | null;
	last_name: string | null;
}

export interface WorkspaceMember {
	id: string;
	workspace_id: string;
	user_id: string;
	role: WorkspaceRole;
	joined_at: string;
	user?: WorkspaceMemberProfile | null;
}

/**
 * Whether the invite email actually went out. `sent: false` is a warning, not a
 * failure — the invitation itself is committed and waiting in-app.
 */
export interface EmailDeliveryResult {
	sent: boolean;
	reason?: string;
}

export interface WorkspaceInvite {
	id: string;
	workspace_id: string;
	invited_by: string | null;
	invitee_id: string | null;
	invitee_email: string | null;
	role: WorkspaceRole;
	status: "pending" | "accepted" | "declined" | "cancelled";
	message: string | null;
	responded_at: string | null;
	created_at: string;
	updated_at: string;
	workspace?: { id: string; name: string; avatar_url: string | null } | null;
	invited_by_profile?: {
		id: string;
		display_name: string | null;
		avatar_url: string | null;
		email: string | null;
	} | null;
	email_delivery?: EmailDeliveryResult;
}

export interface CreateWorkspaceInput {
	name: string;
	description?: string;
	avatar_url?: string;
}

export interface UpdateWorkspacePatch {
	name?: string;
	description?: string;
	avatar_url?: string;
}

export interface InviteWorkspaceMemberInput {
	email: string;
	role?: WorkspaceAssignableRole;
	message?: string;
}

export async function listMyWorkspaces(): Promise<Workspace[]> {
	try {
		const { data } = await apiClient.get<{ data: Workspace[] }>(
			"/api/workspaces",
		);
		return data.data;
	} catch (err: any) {
		throw new Error(
			extractApiErrorMessage(err.response?.data, "Failed to load workspaces"),
		);
	}
}

export async function getWorkspace(workspaceId: string): Promise<Workspace> {
	try {
		const { data } = await apiClient.get<{ data: Workspace }>(
			`/api/workspaces/${workspaceId}`,
		);
		return data.data;
	} catch (err: any) {
		throw new Error(
			extractApiErrorMessage(err.response?.data, "Failed to load workspace"),
		);
	}
}

export async function createWorkspace(
	input: CreateWorkspaceInput,
): Promise<Workspace> {
	try {
		const { data } = await apiClient.post<{ data: Workspace }>(
			"/api/workspaces",
			input,
		);
		return data.data;
	} catch (err: any) {
		throw new Error(
			extractApiErrorMessage(err.response?.data, "Failed to create workspace"),
		);
	}
}

export async function updateWorkspace(
	workspaceId: string,
	patch: UpdateWorkspacePatch,
): Promise<Workspace> {
	try {
		const { data } = await apiClient.patch<{ data: Workspace }>(
			`/api/workspaces/${workspaceId}`,
			patch,
		);
		return data.data;
	} catch (err: any) {
		throw new Error(
			extractApiErrorMessage(err.response?.data, "Failed to update workspace"),
		);
	}
}

export async function listWorkspaceMembers(
	workspaceId: string,
): Promise<WorkspaceMember[]> {
	try {
		const { data } = await apiClient.get<{ data: WorkspaceMember[] }>(
			`/api/workspaces/${workspaceId}/members`,
		);
		return data.data;
	} catch (err: any) {
		throw new Error(
			extractApiErrorMessage(err.response?.data, "Failed to load members"),
		);
	}
}

export async function updateWorkspaceMember(
	workspaceId: string,
	userId: string,
	patch: { role: WorkspaceRole },
): Promise<WorkspaceMember> {
	try {
		const { data } = await apiClient.patch<{ data: WorkspaceMember }>(
			`/api/workspaces/${workspaceId}/members/${userId}`,
			patch,
		);
		return data.data;
	} catch (err: any) {
		throw new Error(
			extractApiErrorMessage(err.response?.data, "Failed to update member"),
		);
	}
}

export async function removeWorkspaceMember(
	workspaceId: string,
	userId: string,
): Promise<void> {
	try {
		await apiClient.delete(`/api/workspaces/${workspaceId}/members/${userId}`);
	} catch (err: any) {
		throw new Error(
			extractApiErrorMessage(err.response?.data, "Failed to remove member"),
		);
	}
}

export async function listWorkspaceInvites(
	workspaceId: string,
): Promise<WorkspaceInvite[]> {
	try {
		const { data } = await apiClient.get<{ data: WorkspaceInvite[] }>(
			`/api/workspaces/${workspaceId}/invites`,
		);
		return data.data;
	} catch (err: any) {
		throw new Error(
			extractApiErrorMessage(err.response?.data, "Failed to load invitations"),
		);
	}
}

export async function createWorkspaceInvite(
	workspaceId: string,
	input: InviteWorkspaceMemberInput,
): Promise<WorkspaceInvite> {
	try {
		const { data } = await apiClient.post<{ data: WorkspaceInvite }>(
			`/api/workspaces/${workspaceId}/invites`,
			input,
		);
		return data.data;
	} catch (err: any) {
		throw new Error(
			extractApiErrorMessage(err.response?.data, "Failed to send invitation"),
		);
	}
}

export async function cancelWorkspaceInvite(
	workspaceId: string,
	inviteId: string,
): Promise<WorkspaceInvite> {
	try {
		const { data } = await apiClient.delete<{ data: WorkspaceInvite }>(
			`/api/workspaces/${workspaceId}/invites/${inviteId}`,
		);
		return data.data;
	} catch (err: any) {
		throw new Error(
			extractApiErrorMessage(err.response?.data, "Failed to cancel invitation"),
		);
	}
}

export async function listMyWorkspaceInvites(): Promise<WorkspaceInvite[]> {
	try {
		const { data } = await apiClient.get<{ data: WorkspaceInvite[] }>(
			"/api/workspaces/me/invites",
		);
		return data.data;
	} catch (err: any) {
		throw new Error(
			extractApiErrorMessage(err.response?.data, "Failed to load invitations"),
		);
	}
}

export async function respondWorkspaceInvite(
	inviteId: string,
	status: "accepted" | "declined",
): Promise<WorkspaceInvite> {
	try {
		const { data } = await apiClient.post<{ data: WorkspaceInvite }>(
			`/api/workspaces/me/invites/${inviteId}/respond`,
			{ status },
		);
		return data.data;
	} catch (err: any) {
		throw new Error(
			extractApiErrorMessage(err.response?.data, "Failed to respond to invite"),
		);
	}
}
