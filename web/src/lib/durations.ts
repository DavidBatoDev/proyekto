/**
 * How long a piece of work is expected to run.
 *
 * One vocabulary, shared by the project brief and the project-create wizard,
 * mirroring the CHECK on `project_postings.duration`
 * (20260829120000_project_posting_duration_options). It used to be four buckets
 * copied by hand into both screens, which meant an author with two weeks of
 * design work or an eleven-month build had to pick something untrue to get past
 * a required field.
 *
 * `custom` is the escape hatch: the author writes the timeline themselves and it
 * is stored beside the bucket in `duration_custom`. That is the shape this
 * codebase already uses for "other" — a closed list with an `other` member plus
 * a separate free-text column (see `payout_methods`, `specialization_category`)
 * — rather than one column holding either a code or a sentence.
 */

export interface DurationOption {
	value: string;
	label: string;
}

/** Offered in the picker, in the order somebody scanning them would expect. */
export const DURATION_OPTIONS: DurationOption[] = [
	{ value: "<1_week", label: "Under 1 week" },
	{ value: "1-2_weeks", label: "1–2 weeks" },
	{ value: "2-4_weeks", label: "2–4 weeks" },
	{ value: "1-3_months", label: "1–3 months" },
	{ value: "3-6_months", label: "3–6 months" },
	{ value: "6-12_months", label: "6–12 months" },
	{ value: "12+_months", label: "More than a year" },
	{ value: "ongoing", label: "Ongoing / no end date" },
	{ value: "unsure", label: "Not sure yet" },
];

export const CUSTOM_DURATION = "custom";

/** The label for the escape hatch, kept out of `DURATION_OPTIONS` so filters never offer it. */
export const CUSTOM_DURATION_OPTION: DurationOption = {
	value: CUSTOM_DURATION,
	label: "Something else",
};

/**
 * Every value that can appear on a row, including two retired before the list
 * was widened. A brief written in August still has to render.
 */
export const DURATION_LABELS: Record<string, string> = {
	...Object.fromEntries(
		[...DURATION_OPTIONS, CUSTOM_DURATION_OPTION].map((option) => [
			option.value,
			option.label,
		]),
	),
	"<1_month": "Less than 1 month",
	"6+_months": "6+ months",
};

/**
 * What to show for a stored timeline: the author's own words when they wrote
 * some, otherwise the bucket's label.
 *
 * Returns `null` rather than the raw code for a value it does not know — every
 * call site treats null as "say nothing", which beats printing `6-12_months` at
 * a reader.
 */
export function describeDuration(
	duration: string | null | undefined,
	custom?: string | null,
): string | null {
	if (!duration) return null;
	if (duration === CUSTOM_DURATION) return custom?.trim() || null;
	return DURATION_LABELS[duration] ?? null;
}
