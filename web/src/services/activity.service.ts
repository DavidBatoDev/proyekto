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
	/** OR within the list; empty means "all". */
	family?: string[];
	actor_id?: string[];
	roadmap_id?: string;
	/** Narrow to one object's history, e.g. a single deliverable. */
	entity_type?: string;
	entity_id?: string;
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
		// Built by hand rather than via axios' object serializer: multi-value
		// filters must go out as REPEATED keys (`family=task&family=epic`), which
		// is what qs on the Express side parses back into an array. Axios'
		// default bracket form would arrive as a differently-named param.
		const query = new URLSearchParams();
		query.set("limit", String(params.limit ?? 50));
		if (params.cursor) query.set("cursor", params.cursor);
		for (const family of params.family ?? []) query.append("family", family);
		for (const actor of params.actor_id ?? []) query.append("actor_id", actor);
		if (params.roadmap_id) query.set("roadmap_id", params.roadmap_id);
		if (params.entity_type) query.set("entity_type", params.entity_type);
		if (params.entity_id) query.set("entity_id", params.entity_id);
		if (params.from) query.set("from", params.from);
		if (params.to) query.set("to", params.to);

		const res = await apiClient.get<{ data: ActivityPage }>(
			`/api/projects/${projectId}/activity?${query.toString()}`,
		);
		return res.data.data;
	},
};
