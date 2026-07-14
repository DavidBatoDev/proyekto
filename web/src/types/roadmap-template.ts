export type RoadmapTemplateScheduleKind = "long_term" | "short_learning";
export type RoadmapTemplateDifficulty =
	| "beginner"
	| "intermediate"
	| "advanced";

export type RoadmapTemplateTask = {
	key: string;
	title: string;
	description?: string;
	priority: string;
	position: number;
	work_type: "real_work" | "training";
	due_day_offset?: number;
	checklist: Array<{ id: string; title: string; completed: false }>;
};

export type RoadmapTemplateFeature = {
	key: string;
	title: string;
	time_label: string;
	description?: string;
	start_day_offset: number;
	end_day_offset: number;
	is_deliverable: boolean;
	tasks: RoadmapTemplateTask[];
};

export type RoadmapTemplateEpic = {
	key: string;
	title: string;
	time_label: string;
	description?: string;
	start_day_offset: number;
	end_day_offset: number;
	priority: string;
	tags: string[];
	features: RoadmapTemplateFeature[];
};

export type RoadmapTemplateVersionContent = {
	contract_version: number;
	schedule_kind: RoadmapTemplateScheduleKind;
	roadmap: {
		name: string;
		description?: string;
		schedule_kind: RoadmapTemplateScheduleKind;
		start_day_offset: number;
		end_day_offset: number;
	};
	milestones: Array<{
		key: string;
		title: string;
		time_label: string;
		description?: string;
		target_day_offset: number;
		feature_keys: string[];
	}>;
	epics: RoadmapTemplateEpic[];
};

export type RoadmapTemplateSummary = {
	id: string;
	slug: string;
	title: string;
	summary: string;
	preview_url: string;
	category: { slug: string; name: string };
	tags: Array<{ slug: string; name: string }>;
	difficulty: RoadmapTemplateDifficulty;
	schedule: {
		kind: RoadmapTemplateScheduleKind;
		estimated_duration_days: number;
	};
	attribution: { name: string; url?: string | null };
	is_featured: boolean;
	published_at: string;
	view_count: number;
	use_count: number;
	duplicate_count: number;
	rating_count: number;
	rating_average: number;
	preview: {
		epics: Array<{
			id: string;
			title: string;
			position: number;
			features: Array<{
				id: string;
				title: string;
				tasks: RoadmapTemplateTask[];
			}>;
		}>;
		milestone_count: number;
	};
};

export type RoadmapTemplateDetail = RoadmapTemplateSummary & {
	version_id: string;
	version_number: number;
	content: RoadmapTemplateVersionContent;
	hierarchy_counts: {
		milestones: number;
		epics: number;
		features: number;
		tasks: number;
	};
};

export type InstantiateRoadmapTemplateRequest = {
	project_id?: string;
	start_date: string;
	idempotency_key: string;
	source_surface?: "landing" | "marketplace" | "roadmap_create" | "consultant";
};

export type ConsultantTemplateAnalytics = {
	template_id: string;
	view_count: number;
	unique_users: number;
	duplicates: number;
	rating_count: number;
	rating_average: number;
	reports_open: number;
	recent_uses: Array<{ day: string; count: number }>;
};

export type ConsultantRoadmapTemplate = {
	id: string;
	slug: string;
	title: string;
	summary: string;
	status: "draft" | "published" | "unlisted" | "archived";
	preview_url: string;
	source_roadmap_id?: string | null;
	view_count: number;
	use_count: number;
	duplicate_count: number;
	rating_count: number;
	rating_average: number;
	category: { slug: string; name: string };
	current_version?: { id: string; version_number: number } | null;
};
