import { isAxiosError } from "axios";
import apiClient from "@/api/axios";
import { extractApiErrorMessage } from "@/lib/permissionErrors";

/**
 * The in-app account deletion API.
 *
 * Uses the shared `apiClient` (unlike the contact form): every one of these
 * routes is authenticated and acts on the caller, so the auth interceptor is
 * exactly what we want.
 */

export interface DeletionCandidate {
	user_id: string;
	display_name: string | null;
	email: string | null;
	avatar_url: string | null;
	role: string;
	joined_at: string;
}

export interface DeletionDecision {
	kind: "workspace" | "team";
	id: string;
	name: string;
	slug?: string;
	workspace_id?: string;
	member_count: number;
	project_count?: number;
	team_count?: number;
	can_delete: boolean;
	is_paid: boolean;
	candidates: DeletionCandidate[];
}

export interface DeletionPreflight {
	user_id: string;
	generated_at: string;
	decisions: DeletionDecision[];
	will_be_deleted: {
		workspaces: Array<{ id: string; name: string; slug: string }>;
		teams: Array<{ id: string; name: string }>;
		projects: number;
		standalone_roadmaps: number;
		devices: number;
		api_tokens: number;
		identity_documents: number;
	};
	will_transfer: {
		projects: Array<{ id: string; title: string }>;
		workspaces_left: Array<{ id: string; name: string; slug: string }>;
		teams_left: Array<{ id: string; name: string }>;
	};
	will_be_kept: {
		attribution: string;
		archived_teams: number;
		chat_messages: number;
		comments: number;
		decisions: number;
		deliverables: number;
		change_requests: number;
		risks: number;
		activity_entries: number;
		contracts: number;
		invoices: number;
		payouts: number;
	};
	auth: { has_password: boolean; providers: string[] };
	warnings: string[];
	preflight_token: string;
}

export interface ContainerResolution {
	kind: "workspace" | "team";
	id: string;
	action: "transfer" | "delete";
	new_owner_id?: string;
}

export interface DeleteAccountInput {
	confirmation: string;
	password?: string;
	code?: string;
	containers: ContainerResolution[];
}

export interface DeletionFailure {
	code: string | null;
	message: string;
	/**
	 * The single most important field in this contract.
	 *
	 * `true`  — the transaction rolled back; nothing happened; retrying is safe.
	 * `false` — the identity is already gone and only cleanup failed, which from
	 *           the user's point of view is success, so the UI must NOT offer a
	 *           retry: there is nothing to retry into.
	 * `null`  — we never got an answer (the request never completed). The UI has
	 *           to ask the server which of the two it is.
	 */
	accountIntact: boolean | null;
	status: number | null;
}

export async function getDeletionPreflight(): Promise<DeletionPreflight> {
	const { data } = await apiClient.get("/account/deletion/preflight");
	return (data?.data ?? data) as DeletionPreflight;
}

export async function requestDeletionCode(): Promise<{
	sent: boolean;
	expires_at: string;
}> {
	const { data } = await apiClient.post("/account/deletion/challenge");
	return (data?.data ?? data) as { sent: boolean; expires_at: string };
}

export async function deleteAccount(
	input: DeleteAccountInput,
): Promise<{ deleted: true; summary: Record<string, number> }> {
	const { data } = await apiClient.delete("/account/deletion", {
		data: input,
	});
	return (data?.data ?? data) as {
		deleted: true;
		summary: Record<string, number>;
	};
}

/** Normalises anything thrown by the three calls above into one shape. */
export function toDeletionFailure(error: unknown): DeletionFailure {
	if (!isAxiosError(error)) {
		return {
			code: null,
			message: extractApiErrorMessage(error, "Something went wrong."),
			accountIntact: null,
			status: null,
		};
	}

	// No response at all: the request never completed, so we genuinely do not
	// know whether the server ran it. This is the case the status re-check
	// exists for, and guessing here would be the one unforgivable bug.
	if (!error.response) {
		return {
			code: "network",
			message: "We lost the connection.",
			accountIntact: null,
			status: null,
		};
	}

	const body = error.response.data?.error ?? error.response.data ?? {};
	return {
		code: typeof body.code === "string" ? body.code : null,
		message: extractApiErrorMessage(error, "Something went wrong."),
		accountIntact:
			typeof body.accountIntact === "boolean" ? body.accountIntact : true,
		status: error.response.status,
	};
}
