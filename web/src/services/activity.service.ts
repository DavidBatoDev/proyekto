import apiClient from "@/api/axios";

export interface ActivityActor {
	id: string;
	display_name: string | null;
	avatar_url: string | null;
}

export interface ActivityEntry {
	id: string;
	seq: number;
	project_id: string;
	roadmap_id: string | null;
	actor_id: string | null;
	action: string;
	entity_type: string;
	entity_id: string | null;
	is_sensitive: boolean;
	metadata: Record<string, unknown>;
	created_at: string;
	actor: ActivityActor | null;
}

export interface ActivityPage {
	items: ActivityEntry[];
	next_cursor: string | null;
	/** False when sensitive rows were filtered out server-side. */
	can_view_sensitive: boolean;
}

export interface ActivityFilters {
	family?: string;
	actor_id?: string;
	roadmap_id?: string;
	from?: string;
	to?: string;
}

/**
 * The project activity feed. Keyset-paginated: pass the previous page's
 * `next_cursor` back as `cursor`. There is no `offset` — sending one is a 400.
 */
export const activityService = {
	async list(
		projectId: string,
		params: ActivityFilters & { cursor?: string; limit?: number } = {},
	): Promise<ActivityPage> {
		const res = await apiClient.get<{ data: ActivityPage }>(
			`/api/projects/${projectId}/activity`,
			{
				params: {
					limit: params.limit ?? 50,
					...(params.cursor ? { cursor: params.cursor } : {}),
					...(params.family ? { family: params.family } : {}),
					...(params.actor_id ? { actor_id: params.actor_id } : {}),
					...(params.roadmap_id ? { roadmap_id: params.roadmap_id } : {}),
					...(params.from ? { from: params.from } : {}),
					...(params.to ? { to: params.to } : {}),
				},
			},
		);
		return res.data.data;
	},
};
