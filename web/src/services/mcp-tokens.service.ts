import apiClient from "@/api/axios";
import { extractApiErrorMessage } from "@/lib/permissionErrors";

/** Coarse read scopes a Personal Access Token can carry (mirrors the backend
 * mcp-scopes module). Write scopes arrive in a later MCP phase. */
export const MCP_READ_SCOPES = [
	"projects:read",
	"roadmaps:read",
	"knowledge:read",
	"chat:read",
] as const;

export type McpScope = (typeof MCP_READ_SCOPES)[number];

export const MCP_SCOPE_LABELS: Record<McpScope, string> = {
	"projects:read": "Read projects",
	"roadmaps:read": "Read roadmaps & tasks",
	"knowledge:read": "Search project knowledge",
	"chat:read": "Read chat channels",
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
