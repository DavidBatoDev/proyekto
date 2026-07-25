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
	if (scope === OFFLINE_ACCESS) return "Stay connected without re-approving";
	return MCP_SCOPE_LABELS[scope as McpScope] ?? scope;
}

export function isWriteScope(scope: string): boolean {
	return scope.endsWith(":write") || scope === "tasks:assign";
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
