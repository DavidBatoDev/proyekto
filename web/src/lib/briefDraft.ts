import type { BriefSection } from "@/lib/briefSections";
import type {
	PostingEngagementType,
	ProjectPostingDetail,
	SavePostingPayload,
} from "@/services/postings.service";

/**
 * A project brief as it exists while somebody is writing it.
 *
 * Shared by both authoring routes so `/brief/new` can run the full editor with
 * no database row behind it: the draft is the state, and a row is only created
 * when the author saves or publishes.
 *
 * Budgets are strings because the inputs are free text — "" is a real state
 * that `null` cannot express, and coercing on every keystroke fights the typist.
 * The roadmap is carried here too, rather than read off the server row, since
 * an unsaved brief has no row to read.
 */

export interface BriefRoadmapChip {
	id: string;
	name: string;
	/** Only the server can count these, so they are absent until the first save. */
	epic_count?: number;
	feature_count?: number;
	task_count?: number;
}

export interface BriefDraft {
	title: string;
	engagement_type: PostingEngagementType;
	summary: string;
	sections: BriefSection[];
	category_id: string | null;
	budget_min: string;
	budget_max: string;
	duration: string | null;
	/** Free text, and only beside `duration: "custom"`. See `lib/durations.ts`. */
	duration_custom: string | null;
	roadmap_id: string | null;
	roadmap: BriefRoadmapChip | null;
}

export const EMPTY_BRIEF_DRAFT: BriefDraft = {
	title: "",
	engagement_type: "one_time",
	summary: "",
	sections: [],
	category_id: null,
	budget_min: "",
	budget_max: "",
	duration: null,
	duration_custom: null,
	roadmap_id: null,
	roadmap: null,
};

export function toNumberOrNull(value: string): number | null {
	const trimmed = value.trim();
	if (trimmed === "") return null;
	const parsed = Number(trimmed);
	return Number.isFinite(parsed) ? parsed : null;
}

export function toDraft(brief: ProjectPostingDetail): BriefDraft {
	return {
		title: brief.title,
		engagement_type: brief.engagement_type,
		summary: brief.summary ?? "",
		sections: brief.sections,
		category_id: brief.category_id,
		budget_min: brief.budget_min === null ? "" : String(brief.budget_min),
		budget_max: brief.budget_max === null ? "" : String(brief.budget_max),
		duration: brief.duration,
		duration_custom: brief.duration_custom,
		roadmap_id: brief.roadmap_id,
		roadmap: brief.roadmap,
	};
}

/**
 * The single place a nameless brief becomes "Untitled brief".
 *
 * It happens at save time, not at creation time, which is the point: a page the
 * author opened and walked away from can no longer mint one.
 */
export function toPayload(
	draft: BriefDraft,
): SavePostingPayload & { title: string } {
	return {
		title: draft.title.trim() || "Untitled brief",
		engagement_type: draft.engagement_type,
		summary: draft.summary,
		sections: draft.sections,
		category_id: draft.category_id,
		budget_min: toNumberOrNull(draft.budget_min),
		budget_max: toNumberOrNull(draft.budget_max),
		duration: draft.duration,
		duration_custom: draft.duration_custom,
		roadmap_id: draft.roadmap_id,
	};
}

/**
 * Is there anything here worth restoring?
 *
 * Decides whether a stored draft resumes the editor or is quietly ignored, so
 * an author who opened the editor and typed nothing is not handed their own
 * blank page back a week later.
 */
export function isBriefDraftEmpty(draft: BriefDraft): boolean {
	return (
		draft.title.trim() === "" &&
		draft.summary.replace(/<[^>]*>/g, "").trim() === "" &&
		draft.sections.length === 0 &&
		draft.category_id === null &&
		draft.budget_min.trim() === "" &&
		draft.budget_max.trim() === "" &&
		draft.duration === null &&
		draft.roadmap_id === null
	);
}
