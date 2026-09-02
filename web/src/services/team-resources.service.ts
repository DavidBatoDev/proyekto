import apiClient from "@/api/axios";
import { extractApiErrorMessage } from "@/lib/permissionErrors";

/**
 * Team resources: one level of folders holding hyperlinks, plus links outside
 * any folder. Links only — there is no file upload on this surface.
 *
 * Shapes mirror the project resources payload exactly, because the Overview's
 * Resources section renders through the same shared components. Kept in its own
 * module rather than added to the already-large `teams.service.ts`.
 *
 * Note this goes through `apiClient` (axios), like the rest of the teams
 * service. `project.service.ts` hand-rolls `fetch` plus a manual bearer token
 * for its resource calls; that is the older pattern, not the one to copy.
 */

export interface TeamResourceLink {
	id: string;
	team_id: string;
	folder_id?: string | null;
	title: string;
	url: string;
	description?: string | null;
	position: number;
	created_at: string;
	updated_at: string;
}

export interface TeamResourceFolder {
	id: string;
	team_id: string;
	name: string;
	/** Lucide icon token — see `components/resources/resourceTokens.ts`. */
	icon?: string;
	/** Accent colour token driving the folder card's top border. */
	color?: string;
	position: number;
	created_at: string;
	updated_at: string;
	links: TeamResourceLink[];
}

export interface TeamResourcesPayload {
	folders: TeamResourceFolder[];
	uncategorized_links: TeamResourceLink[];
}

export interface ResourceReorderItem {
	id: string;
	position: number;
}

function fail(err: unknown, fallback: string): never {
	throw new Error(
		extractApiErrorMessage(
			(err as { response?: { data?: unknown } }).response?.data,
			fallback,
		),
	);
}

/**
 * Defensive: a folder with no `links` array, or a payload missing either
 * collection, would otherwise crash the grid on first render rather than
 * showing an empty board.
 */
function normalizeResourcesPayload(raw: unknown): TeamResourcesPayload {
	const payload = (raw ?? {}) as Partial<TeamResourcesPayload>;
	return {
		folders: Array.isArray(payload.folders)
			? payload.folders.map((folder) => ({
					...folder,
					links: Array.isArray(folder?.links) ? folder.links : [],
				}))
			: [],
		uncategorized_links: Array.isArray(payload.uncategorized_links)
			? payload.uncategorized_links
			: [],
	};
}

export async function getTeamResources(
	teamId: string,
): Promise<TeamResourcesPayload> {
	try {
		const { data } = await apiClient.get<{ data: unknown }>(
			`/api/teams/${teamId}/resources`,
		);
		return normalizeResourcesPayload(data.data);
	} catch (err) {
		return fail(err, "Failed to load team resources");
	}
}

export async function createTeamResourceFolder(
	teamId: string,
	input: { name: string; icon?: string; color?: string },
): Promise<TeamResourceFolder> {
	try {
		const { data } = await apiClient.post<{ data: TeamResourceFolder }>(
			`/api/teams/${teamId}/resources/folders`,
			input,
		);
		return data.data;
	} catch (err) {
		return fail(err, "Failed to create folder");
	}
}

export async function updateTeamResourceFolder(
	teamId: string,
	folderId: string,
	patch: { name?: string; icon?: string; color?: string },
): Promise<TeamResourceFolder> {
	try {
		const { data } = await apiClient.patch<{ data: TeamResourceFolder }>(
			`/api/teams/${teamId}/resources/folders/${folderId}`,
			patch,
		);
		return data.data;
	} catch (err) {
		return fail(err, "Failed to update folder");
	}
}

export async function deleteTeamResourceFolder(
	teamId: string,
	folderId: string,
): Promise<void> {
	try {
		await apiClient.delete(
			`/api/teams/${teamId}/resources/folders/${folderId}`,
		);
	} catch (err) {
		return fail(err, "Failed to delete folder");
	}
}

export async function reorderTeamResourceFolders(
	teamId: string,
	items: ResourceReorderItem[],
): Promise<TeamResourceFolder[]> {
	try {
		const { data } = await apiClient.patch<{ data: TeamResourceFolder[] }>(
			`/api/teams/${teamId}/resources/folders/reorder`,
			{ items },
		);
		return data.data;
	} catch (err) {
		return fail(err, "Failed to reorder folders");
	}
}

export async function createTeamResourceLink(
	teamId: string,
	input: {
		title: string;
		url: string;
		description?: string;
		folder_id?: string | null;
	},
): Promise<TeamResourceLink> {
	try {
		const { data } = await apiClient.post<{ data: TeamResourceLink }>(
			`/api/teams/${teamId}/resources/links`,
			input,
		);
		return data.data;
	} catch (err) {
		return fail(err, "Failed to add link");
	}
}

export async function updateTeamResourceLink(
	teamId: string,
	linkId: string,
	patch: {
		title?: string;
		url?: string;
		description?: string;
		/** Explicit `null` moves the link to uncategorized; omit to leave it. */
		folder_id?: string | null;
	},
): Promise<TeamResourceLink> {
	try {
		const { data } = await apiClient.patch<{ data: TeamResourceLink }>(
			`/api/teams/${teamId}/resources/links/${linkId}`,
			patch,
		);
		return data.data;
	} catch (err) {
		return fail(err, "Failed to update link");
	}
}

export async function deleteTeamResourceLink(
	teamId: string,
	linkId: string,
): Promise<void> {
	try {
		await apiClient.delete(`/api/teams/${teamId}/resources/links/${linkId}`);
	} catch (err) {
		return fail(err, "Failed to delete link");
	}
}

export async function reorderTeamResourceLinks(
	teamId: string,
	input: { folder_id?: string | null; items: ResourceReorderItem[] },
): Promise<TeamResourceLink[]> {
	try {
		const { data } = await apiClient.patch<{ data: TeamResourceLink[] }>(
			`/api/teams/${teamId}/resources/links/reorder`,
			input,
		);
		return data.data;
	} catch (err) {
		return fail(err, "Failed to reorder links");
	}
}
