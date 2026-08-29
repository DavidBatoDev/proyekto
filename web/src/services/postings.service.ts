import apiClient from "@/api/axios";
import type { BriefSection } from "@/lib/briefSections";
import { extractApiErrorMessage } from "@/lib/permissionErrors";

/**
 * Project briefs — the marketplace's demand side.
 *
 * "Posting" on the wire and in the database, "brief" in the interface. The two
 * names are deliberate: `project_briefs` already means the brief inside a
 * project, and giving both the same name in code would let two very different
 * authorization models blur together.
 */

export type PostingStatus = "draft" | "published" | "closed";
export type PostingEngagementType = "ongoing" | "one_time";
export type ProposalStatus =
	| "submitted"
	| "withdrawn"
	| "shortlisted"
	| "declined";
export type RateUnit = "project" | "hour" | "month";

export interface PostingPerson {
	id: string;
	first_name: string | null;
	last_name: string | null;
	avatar_url: string | null;
}

export interface PostingAttachment {
	id: string;
	posting_id: string;
	url: string;
	name: string;
	content_type: string | null;
	size: number | null;
	created_at: string;
}

export interface PostingRoadmapSummary {
	id: string;
	name: string;
	epic_count: number;
	feature_count: number;
	task_count: number;
}

export interface ProjectPosting {
	id: string;
	author_id: string;
	title: string;
	engagement_type: PostingEngagementType;
	summary: string | null;
	sections: BriefSection[];
	category_id: string | null;
	subcategory_id: string | null;
	budget_min: number | null;
	budget_max: number | null;
	currency: string;
	duration: string | null;
	duration_custom: string | null;
	roadmap_id: string | null;
	status: PostingStatus;
	published_at: string | null;
	closed_at: string | null;
	created_at: string;
	updated_at: string;
}

export interface PostingProposal {
	id: string;
	posting_id: string;
	consultant_id: string;
	pitch: string;
	indicative_rate: number | null;
	rate_currency: string;
	rate_unit: RateUnit;
	status: ProposalStatus;
	created_at: string;
	updated_at: string;
}

export interface PostingProposalWithConsultant extends PostingProposal {
	consultant: PostingPerson | null;
}

export interface ProjectPostingDetail extends ProjectPosting {
	author: PostingPerson | null;
	attachments: PostingAttachment[];
	roadmap: PostingRoadmapSummary | null;
	proposal_count: number;
	my_proposal: PostingProposal | null;
}

export interface PostingBoardEntry extends ProjectPosting {
	author: PostingPerson | null;
	proposal_count: number;
}

export interface PostingListEntry extends ProjectPosting {
	proposal_count: number;
}

export interface SavePostingPayload {
	title?: string;
	engagement_type?: PostingEngagementType;
	summary?: string | null;
	sections?: BriefSection[];
	category_id?: string | null;
	subcategory_id?: string | null;
	budget_min?: number | null;
	budget_max?: number | null;
	currency?: string;
	duration?: string | null;
	duration_custom?: string | null;
	roadmap_id?: string | null;
}

export interface BoardQuery {
	category_id?: string;
	subcategory_id?: string;
	engagement_type?: PostingEngagementType;
	duration?: string;
	budget_min?: number;
	limit?: number;
	offset?: number;
}

export interface GeneratedBrief {
	title: string;
	engagement_type: PostingEngagementType;
	summary: string;
	sections: BriefSection[];
}

async function request<T>(
	run: () => Promise<{ data: { data: T } }>,
	fallback: string,
): Promise<T> {
	try {
		const { data } = await run();
		return data.data;
	} catch (error) {
		throw new Error(
			extractApiErrorMessage(
				(error as { response?: { data?: unknown } }).response?.data,
				fallback,
			),
		);
	}
}

const base = "/api/postings";

export const postingsService = {
	listMine(): Promise<PostingListEntry[]> {
		return request(
			() => apiClient.get<{ data: PostingListEntry[] }>(`${base}/mine`),
			"Failed to load your briefs.",
		);
	},

	get(id: string): Promise<ProjectPostingDetail> {
		return request(
			() => apiClient.get<{ data: ProjectPostingDetail }>(`${base}/${id}`),
			"Failed to load this brief.",
		);
	},

	create(payload: SavePostingPayload & { title: string }) {
		return request(
			() => apiClient.post<{ data: ProjectPosting }>(base, payload),
			"Failed to create the brief.",
		);
	},

	update(id: string, payload: SavePostingPayload) {
		return request(
			() => apiClient.patch<{ data: ProjectPosting }>(`${base}/${id}`, payload),
			"Failed to save the brief.",
		);
	},

	publish(id: string) {
		return request(
			() => apiClient.post<{ data: ProjectPosting }>(`${base}/${id}/publish`),
			"Failed to publish the brief.",
		);
	},

	close(id: string) {
		return request(
			() => apiClient.post<{ data: ProjectPosting }>(`${base}/${id}/close`),
			"Failed to close the brief.",
		);
	},

	remove(id: string): Promise<void> {
		return request(
			() => apiClient.delete<{ data: void }>(`${base}/${id}`),
			"Failed to delete the brief.",
		);
	},

	/** Draft sections from one paragraph. Never creates or publishes anything. */
	generate(description: string, categoryHint?: string) {
		return request(
			() =>
				apiClient.post<{ data: GeneratedBrief }>(`${base}/generate`, {
					description,
					...(categoryHint ? { category_hint: categoryHint } : {}),
				}),
			"The brief generator is unavailable right now.",
		);
	},

	addAttachment(
		id: string,
		payload: {
			url: string;
			name: string;
			content_type?: string;
			size?: number;
		},
	) {
		return request(
			() =>
				apiClient.post<{ data: PostingAttachment }>(
					`${base}/${id}/attachments`,
					payload,
				),
			"Failed to attach the file.",
		);
	},

	removeAttachment(id: string, attachmentId: string): Promise<void> {
		return request(
			() =>
				apiClient.delete<{ data: void }>(
					`${base}/${id}/attachments/${attachmentId}`,
				),
			"Failed to remove the file.",
		);
	},

	board(query: BoardQuery = {}): Promise<PostingBoardEntry[]> {
		return request(
			() =>
				apiClient.get<{ data: PostingBoardEntry[] }>(`${base}/board`, {
					params: query,
				}),
			"Failed to load the brief board.",
		);
	},

	listProposals(id: string): Promise<PostingProposalWithConsultant[]> {
		return request(
			() =>
				apiClient.get<{ data: PostingProposalWithConsultant[] }>(
					`${base}/${id}/proposals`,
				),
			"Failed to load the applicants.",
		);
	},

	listMyProposals(): Promise<PostingProposal[]> {
		return request(
			() =>
				apiClient.get<{ data: PostingProposal[] }>(`${base}/proposals/mine`),
			"Failed to load your proposals.",
		);
	},

	submitProposal(
		id: string,
		payload: {
			pitch: string;
			indicative_rate?: number | null;
			rate_currency?: string;
			rate_unit?: RateUnit;
		},
	) {
		return request(
			() =>
				apiClient.post<{ data: PostingProposal }>(
					`${base}/${id}/proposals`,
					payload,
				),
			"Failed to send your proposal.",
		);
	},

	withdrawProposal(proposalId: string) {
		return request(
			() =>
				apiClient.post<{ data: PostingProposal }>(
					`${base}/proposals/${proposalId}/withdraw`,
				),
			"Failed to withdraw your proposal.",
		);
	},

	triageProposal(proposalId: string, status: "shortlisted" | "declined") {
		return request(
			() =>
				apiClient.patch<{ data: PostingProposal }>(
					`${base}/proposals/${proposalId}`,
					{ status },
				),
			"Failed to update the applicant.",
		);
	},
};
