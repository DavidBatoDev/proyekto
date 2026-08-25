import apiClient from "@/api/axios";
import { extractApiErrorMessage } from "@/lib/permissionErrors";

/** Coarse scopes a Personal Access Token can carry (mirrors the backend
 * mcp-scopes module). Read scopes are safe defaults; write scopes let a host
 * modify data and are opt-in. */
export const MCP_READ_SCOPES = [
	"projects:read",
	"roadmaps:read",
	"knowledge:read",
	"chat:read",
	"ai-sessions:read",
	"delivery:read",
] as const;

export const MCP_WRITE_SCOPES = [
	"roadmaps:write",
	"tasks:write",
	"tasks:assign",
	"chat:write",
	"delivery:write",
] as const;

export type McpReadScope = (typeof MCP_READ_SCOPES)[number];
export type McpWriteScope = (typeof MCP_WRITE_SCOPES)[number];
export type McpScope = McpReadScope | McpWriteScope;

export const MCP_SCOPE_LABELS: Record<McpScope, string> = {
	"projects:read": "Read projects",
	"roadmaps:read": "Read roadmaps & tasks",
	"knowledge:read": "Search project knowledge",
	"chat:read": "Read chat channels",
	"ai-sessions:read": "Read your AI planning threads",
	"delivery:read": "Read delivery registers",
	"roadmaps:write": "Edit roadmaps",
	"tasks:write": "Create & edit tasks",
	"tasks:assign": "Assign tasks",
	"chat:write": "Post & delete chat messages",
	"delivery:write": "Edit delivery registers",
};

/** Non-secret token metadata returned by the list endpoint. */
export interface McpTokenSummary {
	id: string;
	name: string;
	token_prefix: string;
	scopes: string[];
	last_used_at: string | null;
	expires_at: string | null;
	revoked_at: string | null;
	created_at: string;
}

/** Issue response — the raw `token` is shown to the user exactly once. */
export interface McpTokenIssued extends McpTokenSummary {
	token: string;
}

function toError(err: unknown, fallback: string): Error {
	return new Error(
		extractApiErrorMessage(
			(err as { response?: { data?: unknown } }).response?.data,
			fallback,
		),
	);
}

export async function listMcpTokens(): Promise<McpTokenSummary[]> {
	try {
		const { data } = await apiClient.get<{ data: McpTokenSummary[] }>(
			"/api/mcp/tokens",
		);
		return data.data;
	} catch (err) {
		throw toError(err, "Failed to load access tokens");
	}
}

/**
 * Which scopes a token may currently be issued for.
 *
 * A scope can exist in the shared enum but still be switched off server-side, so
 * the picker asks rather than assuming — otherwise it offers a checkbox whose
 * only possible outcome is an error. Falls back to the full set if the call
 * fails, so a blip degrades to today's behaviour rather than an empty picker.
 */
export async function listAvailableMcpScopes(): Promise<McpScope[]> {
	try {
		const { data } = await apiClient.get<{ data: { scopes: McpScope[] } }>(
			"/api/mcp/tokens/scopes",
		);
		return data.data.scopes;
	} catch {
		return [...MCP_READ_SCOPES, ...MCP_WRITE_SCOPES];
	}
}

export async function createMcpToken(input: {
	name: string;
	scopes: McpScope[];
	expires_at?: string | null;
}): Promise<McpTokenIssued> {
	try {
		const { data } = await apiClient.post<{ data: McpTokenIssued }>(
			"/api/mcp/tokens",
			input,
		);
		return data.data;
	} catch (err) {
		throw toError(err, "Failed to create access token");
	}
}

export async function revokeMcpToken(tokenId: string): Promise<void> {
	try {
		await apiClient.delete(`/api/mcp/tokens/${tokenId}`);
	} catch (err) {
		throw toError(err, "Failed to revoke access token");
	}
}
