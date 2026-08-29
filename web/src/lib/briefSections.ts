/**
 * The vocabulary of a project brief: which sections we suggest, and what makes
 * one ready to publish.
 *
 * The recommended list is a starting point, not a schema. A brief's sections are
 * free-form `{key, value, position}` rows — the same shape as
 * `project_briefs.custom_fields` — so an author can add their own heading and
 * delete any of ours. What we do insist on is the handful of STRUCTURED fields
 * the board filters run against: a brief nobody can filter for is a brief nobody
 * finds, which hurts its author more than being asked for a budget does.
 *
 * `missingPublishFields` mirrors `missingPublishFields` in
 * backend/src/modules/marketplace/postings/postings.service.ts. The server is
 * the authority — publish is rejected there — and this copy exists so the editor
 * can show "2 missing fields" without a round trip. Change one, change both.
 */

import { CUSTOM_DURATION } from "@/lib/durations";
import { isRichTextEmpty } from "@/lib/richText";

export interface BriefSection {
	key: string;
	value: string;
	position: number;
}

export interface RecommendedSection {
	key: string;
	/** What the author is being asked for, shown under the heading while empty. */
	hint: string;
}

/**
 * Ordered as a consultant reads them: what the work is, what lands, who it
 * suits, then the supporting detail. Overview is absent because it is the
 * brief's `summary` column rather than a section — it is the one piece of prose
 * every brief has, so it gets a first-class field instead of a removable row.
 */
export const RECOMMENDED_SECTIONS: RecommendedSection[] = [
	{
		key: "Scope of work",
		hint: "What is in scope, and just as usefully, what is not.",
	},
	{
		key: "Deliverables",
		hint: "What you expect to have in hand when the work is done.",
	},
	{
		key: "Ideal consultant",
		hint: "The experience that would make someone a good fit here.",
	},
	{
		key: "Technical considerations",
		hint: "Stack, integrations, or constraints a consultant should know up front.",
	},
	{
		key: "Success criteria",
		hint: "How you will judge whether this went well.",
	},
	{
		key: "References",
		hint: "Links, competitors, or examples of what you have in mind.",
	},
	{
		key: "Company details",
		hint: "Who you are and what your team already looks like.",
	},
	{
		key: "Additional information",
		hint: "Anything else that does not fit above.",
	},
];

export const ENGAGEMENT_TYPES = [
	{
		value: "one_time" as const,
		label: "One-time",
		description: "Deadline-oriented",
	},
	{
		value: "ongoing" as const,
		label: "Ongoing",
		description: "Continuous collaboration",
	},
];

export interface PublishReadiness {
	summary?: string | null;
	budget_min?: number | null;
	budget_max?: number | null;
	duration?: string | null;
	duration_custom?: string | null;
	category_id?: string | null;
}

/**
 * Re-exported, not redefined: brief sections and service sections ask the same
 * question ("did the author actually write anything?"), and two copies would
 * eventually disagree about `<p><br></p>`. It lives in lib/richText with the
 * rest of the editor's rules; the brief surfaces still import it from here.
 */
export { isRichTextEmpty };

/** The labels shown in "N missing fields", in the order the editor lists them. */
export function missingPublishFields(brief: PublishReadiness): string[] {
	const missing: string[] = [];
	if (isRichTextEmpty(brief.summary)) missing.push("Overview");
	if (
		(brief.budget_min ?? null) === null &&
		(brief.budget_max ?? null) === null
	) {
		missing.push("Budget");
	}
	// "Something else" with nothing typed beside it says less than leaving the
	// field alone, so it does not count as answered. Mirrors the server.
	if (
		!brief.duration ||
		(brief.duration === CUSTOM_DURATION && !brief.duration_custom?.trim())
	) {
		missing.push("Timeline");
	}
	if (!brief.category_id) missing.push("Category");
	return missing;
}

/** Append a section, keeping positions dense so nothing can collide. */
export function addSection(
	sections: BriefSection[],
	key: string,
	value = "",
): BriefSection[] {
	return compactSections([
		...sections,
		{ key, value, position: Number.MAX_SAFE_INTEGER },
	]);
}

export function removeSection(
	sections: BriefSection[],
	index: number,
): BriefSection[] {
	return compactSections(sections.filter((_, at) => at !== index));
}

export function updateSection(
	sections: BriefSection[],
	index: number,
	patch: Partial<Omit<BriefSection, "position">>,
): BriefSection[] {
	return sections.map((section, at) =>
		at === index ? { ...section, ...patch } : section,
	);
}

/** Re-number so a delete cannot leave a gap and an append cannot duplicate. */
export function compactSections(sections: BriefSection[]): BriefSection[] {
	return [...sections]
		.sort((a, b) => a.position - b.position)
		.map((section, index) => ({ ...section, position: index }));
}

/** Which recommended chips are still on offer, given what the brief already has. */
export function availableRecommendations(
	sections: BriefSection[],
): RecommendedSection[] {
	const used = new Set(
		sections.map((section) => section.key.trim().toLowerCase()),
	);
	return RECOMMENDED_SECTIONS.filter(
		(recommended) => !used.has(recommended.key.toLowerCase()),
	);
}
