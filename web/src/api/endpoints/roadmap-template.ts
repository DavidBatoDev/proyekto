import type {
	ConsultantRoadmapTemplate,
	ConsultantTemplateAnalytics,
	InstantiateRoadmapTemplateRequest,
	RoadmapTemplateDetail,
	RoadmapTemplateDifficulty,
	RoadmapTemplateScheduleKind,
	RoadmapTemplateSummary,
} from "@/types/roadmap-template";
import apiClient from "../axios";

type ApiResponse<T> = { data: T };

export type RoadmapTemplateCatalogQuery = {
	search?: string;
	category?: string;
	tags?: string;
	difficulty?: RoadmapTemplateDifficulty;
	schedule_kind?: RoadmapTemplateScheduleKind;
	sort?: "featured" | "newest" | "popular" | "rating";
	cursor?: string;
	limit?: number;
};

export async function getRoadmapTemplates(
	query: RoadmapTemplateCatalogQuery = {},
) {
	const response = await apiClient.get<
		ApiResponse<{ items: RoadmapTemplateSummary[]; next_cursor: string | null }>
	>("/api/roadmap-templates", { params: query });
	return response.data.data;
}

export async function getFeaturedRoadmapTemplates() {
	const response = await apiClient.get<
		ApiResponse<{ items: RoadmapTemplateSummary[] }>
	>("/api/roadmap-templates/featured");
	return response.data.data;
}

export async function getRoadmapTemplate(slug: string) {
	const response = await apiClient.get<ApiResponse<RoadmapTemplateDetail>>(
		`/api/roadmap-templates/${slug}`,
	);
	return response.data.data;
}

export async function getRoadmapTemplateCategories() {
	const response = await apiClient.get<
		ApiResponse<
			Array<{ id: string; slug: string; name: string; description?: string }>
		>
	>("/api/roadmap-templates/categories");
	return response.data.data;
}

export async function recordRoadmapTemplateView(id: string) {
	const storageKey = "proyekto_template_visitor_key";
	let visitorKey = localStorage.getItem(storageKey);
	if (!visitorKey) {
		visitorKey = `${crypto.randomUUID()}-${crypto.randomUUID()}`;
		localStorage.setItem(storageKey, visitorKey);
	}
	await apiClient.post(`/api/roadmap-templates/${id}/views`, {
		visitor_key: visitorKey,
	});
}

export async function instantiateRoadmapTemplate(
	id: string,
	request: InstantiateRoadmapTemplateRequest,
) {
	const response = await apiClient.post<
		ApiResponse<{
			roadmap_id: string;
			project_id: string | null;
			template_id: string;
			template_version_id: string;
			idempotent_replay: boolean;
		}>
	>(`/api/roadmap-templates/${id}/instantiate`, request);
	return response.data.data;
}

export async function rateRoadmapTemplate(
	id: string,
	rating: number,
	review?: string,
) {
	const response = await apiClient.put<ApiResponse<unknown>>(
		`/api/roadmap-templates/${id}/rating`,
		{ rating, review },
	);
	return response.data.data;
}

export async function reportRoadmapTemplate(
	id: string,
	reason: "copyright" | "unsafe" | "misleading" | "spam" | "other",
	details: string,
) {
	const response = await apiClient.post<ApiResponse<unknown>>(
		`/api/roadmap-templates/${id}/reports`,
		{ reason, details },
	);
	return response.data.data;
}

export async function getMyRoadmapTemplates() {
	const response = await apiClient.get<
		ApiResponse<ConsultantRoadmapTemplate[]>
	>("/api/roadmap-templates/mine");
	return response.data.data;
}

export type CreateConsultantTemplateRequest = {
	title: string;
	summary: string;
	category: string;
	tags?: string;
	preview_url: string;
	difficulty: RoadmapTemplateDifficulty;
	schedule_kind: RoadmapTemplateScheduleKind;
	estimated_duration_days: number;
	rights_attested: boolean;
	attribution_url?: string;
};

export async function createRoadmapTemplateFromRoadmap(
	roadmapId: string,
	request: CreateConsultantTemplateRequest,
) {
	const response = await apiClient.post<ApiResponse<ConsultantRoadmapTemplate>>(
		`/api/roadmap-templates/from-roadmap/${roadmapId}`,
		request,
	);
	return response.data.data;
}

export async function publishRoadmapTemplate(id: string) {
	const response = await apiClient.post<ApiResponse<unknown>>(
		`/api/roadmap-templates/${id}/publish`,
	);
	return response.data.data;
}

export async function reviseRoadmapTemplate(
	id: string,
	roadmapId?: string,
	scheduleKind?: RoadmapTemplateScheduleKind,
) {
	const response = await apiClient.post<ApiResponse<unknown>>(
		`/api/roadmap-templates/${id}/revisions/from-roadmap`,
		{ roadmap_id: roadmapId, schedule_kind: scheduleKind },
	);
	return response.data.data;
}

export async function unlistRoadmapTemplate(id: string) {
	await apiClient.post(`/api/roadmap-templates/${id}/unlist`);
}

export async function archiveRoadmapTemplate(id: string) {
	await apiClient.post(`/api/roadmap-templates/${id}/archive`);
}

export async function getRoadmapTemplateAnalytics(id: string) {
	const response = await apiClient.get<
		ApiResponse<ConsultantTemplateAnalytics>
	>(`/api/roadmap-templates/${id}/analytics`);
	return response.data.data;
}
