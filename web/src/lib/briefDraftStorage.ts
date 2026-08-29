import {
	type BriefDraft,
	type BriefRoadmapChip,
	EMPTY_BRIEF_DRAFT,
} from "@/lib/briefDraft";
import type { BriefSection } from "@/lib/briefSections";

/**
 * The unsaved brief, kept where a refresh cannot take it.
 *
 * `sessionStorage` rather than `localStorage` on purpose: two tabs each get
 * their own unsaved brief, which is the honest model — each one will create its
 * own row. Merging two half-written briefs would be worse than keeping them
 * apart, so there is deliberately no cross-tab listener here.
 *
 * Attachment bytes cannot live in here (a Blob is not JSON); they are in
 * `@/lib/pendingFileStore` and this record carries only their ids.
 *
 * Every access is wrapped: storage throws outright in some privacy modes, and
 * an unreadable draft must degrade to "start empty", never to a broken editor.
 */

const DRAFT_KEY = "proyekto_brief_draft";

export interface StoredBriefDraft {
	/**
	 * Set the instant the row is created, before any attachment is uploaded, so
	 * a failed save is retried as an update instead of creating a second brief.
	 */
	briefId: string | null;
	draft: BriefDraft;
	pendingFileIds: string[];
	updatedAt: string;
}

function isSection(value: unknown): value is BriefSection {
	if (!value || typeof value !== "object") return false;
	const section = value as Record<string, unknown>;
	return (
		typeof section.key === "string" &&
		typeof section.value === "string" &&
		typeof section.position === "number"
	);
}

function str(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function strOrNull(value: unknown): string | null {
	return typeof value === "string" && value !== "" ? value : null;
}

function parseRoadmap(value: unknown): BriefRoadmapChip | null {
	if (!value || typeof value !== "object") return null;
	const chip = value as Record<string, unknown>;
	if (typeof chip.id !== "string" || typeof chip.name !== "string") return null;
	return {
		id: chip.id,
		name: chip.name,
		...(typeof chip.epic_count === "number"
			? {
					epic_count: chip.epic_count,
					feature_count: Number(chip.feature_count) || 0,
					task_count: Number(chip.task_count) || 0,
				}
			: {}),
	};
}

/**
 * Rebuild a draft field by field rather than casting.
 *
 * This JSON was written by a previous version of the app on somebody else's
 * machine; one renamed field should not put `undefined` into a controlled
 * input and blank the editor.
 */
export function parseStoredBriefDraft(raw: unknown): StoredBriefDraft | null {
	if (!raw || typeof raw !== "object") return null;
	const value = raw as Record<string, unknown>;
	const draft = (value.draft ?? {}) as Record<string, unknown>;
	if (typeof draft.title !== "string") return null;
	return {
		briefId: typeof value.briefId === "string" ? value.briefId : null,
		draft: {
			...EMPTY_BRIEF_DRAFT,
			title: draft.title,
			engagement_type:
				draft.engagement_type === "ongoing" ? "ongoing" : "one_time",
			summary: str(draft.summary),
			sections: Array.isArray(draft.sections)
				? draft.sections.filter(isSection)
				: [],
			category_id: strOrNull(draft.category_id),
			budget_min: str(draft.budget_min),
			budget_max: str(draft.budget_max),
			duration: strOrNull(draft.duration),
			duration_custom: strOrNull(draft.duration_custom),
			roadmap_id: strOrNull(draft.roadmap_id),
			roadmap: parseRoadmap(draft.roadmap),
		},
		pendingFileIds: Array.isArray(value.pendingFileIds)
			? value.pendingFileIds.filter(
					(entry): entry is string => typeof entry === "string",
				)
			: [],
		updatedAt: str(value.updatedAt) || new Date().toISOString(),
	};
}

export function readBriefDraft(): StoredBriefDraft | null {
	try {
		const raw = window.sessionStorage.getItem(DRAFT_KEY);
		if (!raw) return null;
		const parsed = parseStoredBriefDraft(JSON.parse(raw));
		// A value we cannot read is one we will never read: delete it rather than
		// leave it to fail again on every mount.
		if (!parsed) window.sessionStorage.removeItem(DRAFT_KEY);
		return parsed;
	} catch {
		clearBriefDraft();
		return null;
	}
}

export function writeBriefDraft(
	value: Omit<StoredBriefDraft, "updatedAt">,
): void {
	try {
		window.sessionStorage.setItem(
			DRAFT_KEY,
			JSON.stringify({ ...value, updatedAt: new Date().toISOString() }),
		);
	} catch {
		// Quota or privacy mode. The editor keeps working; the draft just will
		// not survive a refresh.
	}
}

export function clearBriefDraft(): void {
	try {
		window.sessionStorage.removeItem(DRAFT_KEY);
	} catch {
		// Storage is unavailable entirely; there is nothing to clean up.
	}
}
