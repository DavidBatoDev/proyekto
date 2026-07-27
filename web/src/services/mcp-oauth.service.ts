import apiClient from "@/api/axios";
import { extractApiErrorMessage } from "@/lib/permissionErrors";
import { MCP_SCOPE_LABELS, type McpScope } from "@/services/mcp-tokens.service";

/**
 * `offline_access` is an OAuth signal (give me a refresh token), not a Proyekto
 * permission — it grants no data access, so the consent screen shows it apart
 * from the real scopes.
 */
export const OFFLINE_ACCESS = "offline_access";

export function scopeLabel(scope: string): string {
	if (scope === OFFLINE_ACCESS) return "Stay connected";
	return MCP_SCOPE_LABELS[scope as McpScope] ?? scope;
}

/**
 * Plain-language consequence of each grant. The consent screen leads with these
 * rather than the scope token — "projects:read" tells a non-developer nothing
 * about what the app is actually about to see.
 */
const SCOPE_DESCRIPTIONS: Record<string, string> = {
	"projects:read": "The projects you belong to, their details and members",
	"roadmaps:read": "Roadmaps, epics, features, tasks and milestones",
	"knowledge:read": "Search across chat, comments, briefs and activity",
	"chat:read": "Messages in the channels you're a member of",
	"ai-sessions:read":
		"Your own AI planning threads for a roadmap — never a teammate's",
	"roadmaps:write": "Add, edit, move and delete roadmap items",
	"tasks:write": "Create and update tasks, and post comments on them",
	"tasks:assign": "Change who a task is assigned to — this notifies them",
	"chat:write":
		"Post, edit and delete messages in channels — people will see them",
	[OFFLINE_ACCESS]: "Keep working without asking you to approve again",
};

export function scopeDescription(scope: string): string {
	return SCOPE_DESCRIPTIONS[scope] ?? scope;
}

export function isWriteScope(scope: string): boolean {
	return scope.endsWith(":write") || scope === "tasks:assign";
}

/**
 * How the app proved who it is.
 *
 * CIMD means the client_id is an https URL we fetched and checked for
 * self-consistency, so the hostname is a real attestation. DCR means the app
 * registered itself and named itself whatever it liked — worth flagging, since
 * anything can claim to be "Claude" through that path.
 */
export function clientOrigin(request: ConsentRequest): {
	host: string | null;
	verified: boolean;
} {
	if (request.client_source !== "cimd") return { host: null, verified: false };
	try {
		return { host: new URL(request.client_id).hostname, verified: true };
	} catch {
		return { host: null, verified: false };
	}
}

/** What the consent screen renders: which app is asking, and for what. */
export interface ConsentRequest {
	request_id: string;
	client_name: string;
	client_source: "cimd" | "dcr";
	client_id: string;
	requested_scopes: string[];
	resource: string;
}

/** An app connected over OAuth, as shown in settings. */
export interface McpConnection {
	id: string;
	client_name: string | null;
	client_id: string;
	scopes: string[];
	last_used_at: string | null;
	created_at: string;
}

function toError(err: unknown, fallback: string): Error {
	return new Error(
		extractApiErrorMessage(
			(err as { response?: { data?: unknown } }).response?.data,
			fallback,
		),
	);
}

export async function getConsentRequest(
	requestId: string,
): Promise<ConsentRequest> {
	try {
		const { data } = await apiClient.get<{ data: ConsentRequest }>(
			"/api/mcp/oauth/consent",
			{ params: { request_id: requestId } },
		);
		return data.data;
	} catch (err) {
		throw toError(err, "This authorization request is no longer valid");
	}
}

/** Approve — returns where the browser must go next (back to the app). */
export async function approveConsent(input: {
	request_id: string;
	granted_scopes: string[];
}): Promise<string> {
	try {
		const { data } = await apiClient.post<{ data: { redirect_to: string } }>(
			"/api/mcp/oauth/consent",
			input,
		);
		return data.data.redirect_to;
	} catch (err) {
		throw toError(err, "Failed to approve the request");
	}
}

export async function denyConsent(requestId: string): Promise<string> {
	try {
		const { data } = await apiClient.post<{ data: { redirect_to: string } }>(
			"/api/mcp/oauth/consent/deny",
			{ request_id: requestId },
		);
		return data.data.redirect_to;
	} catch (err) {
		throw toError(err, "Failed to cancel the request");
	}
}

export async function listMcpConnections(): Promise<McpConnection[]> {
	try {
		const { data } = await apiClient.get<{ data: McpConnection[] }>(
			"/api/mcp/oauth/grants",
		);
		return data.data;
	} catch (err) {
		throw toError(err, "Failed to load connected apps");
	}
}

export async function revokeMcpConnection(grantId: string): Promise<void> {
	try {
		await apiClient.delete(`/api/mcp/oauth/grants/${grantId}`);
	} catch (err) {
		throw toError(err, "Failed to disconnect the app");
	}
}
