import apiClient from "@/api/axios";

/**
 * Report content and block people (App Store guideline 1.2).
 *
 * Authenticated routes that act on the caller, so the shared `apiClient` (with
 * its auth interceptor) is the right client.
 */

export type ReportTargetType =
	| "chat_message"
	| "task_comment"
	| "epic_comment"
	| "feature_comment"
	| "user";

export type ReportReason =
	| "spam"
	| "harassment"
	| "hate"
	| "sexual"
	| "violence"
	| "self_harm"
	| "other";

export interface ReportInput {
	target_type: ReportTargetType;
	target_id: string;
	reason: ReportReason;
	details?: string;
	also_block?: boolean;
}

export interface BlockedPerson {
	user_id: string;
	blocked_at: string;
	display_name: string | null;
	avatar_url: string | null;
}

function unwrap<T>(data: unknown): T {
	if (data && typeof data === "object" && "data" in data) {
		return (data as { data: T }).data;
	}
	return data as T;
}

export const safetyService = {
	async report(input: ReportInput): Promise<{ id: string; blocked: boolean }> {
		const { data } = await apiClient.post("/api/safety/reports", input);
		return unwrap(data);
	},

	async listBlocks(): Promise<BlockedPerson[]> {
		const { data } = await apiClient.get("/api/safety/blocks");
		return unwrap<BlockedPerson[]>(data) ?? [];
	},

	async block(userId: string): Promise<void> {
		await apiClient.post("/api/safety/blocks", { user_id: userId });
	},

	async unblock(userId: string): Promise<void> {
		await apiClient.delete(`/api/safety/blocks/${userId}`);
	},
};
