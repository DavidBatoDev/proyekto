import type { EvidenceCategory } from "@/services/delivery.service";

/**
 * Client-side validation for the delivery forms.
 *
 * Pure functions, deliberately kept out of the components: the same rules are
 * asserted in unit tests, and the limits mirror the backend DTO
 * (`backend/src/modules/execution/delivery/dto/delivery.dto.ts`) so a form can
 * never submit something the global ValidationPipe will 400. When you change a
 * limit here, change it there too.
 */

export const TITLE_MAX = 200;
export const DESCRIPTION_MAX = 4000;
export const CRITERION_MAX = 300;
export const EVIDENCE_LABEL_MAX = 200;

export interface DeliverableFormValues {
	title: string;
	description: string;
	dueDate: string;
	/** One row per criterion — blank rows are dropped, not rejected. */
	criteria: string[];
}

export type FieldErrors<T> = Partial<Record<keyof T, string>>;

export type DeliverableFormErrors = FieldErrors<DeliverableFormValues> & {
	/** Keyed by row index so a single bad row can be marked in place. */
	criteriaRows?: Record<number, string>;
};

export const EMPTY_DELIVERABLE_FORM: DeliverableFormValues = {
	title: "",
	description: "",
	dueDate: "",
	criteria: [""],
};

/** `YYYY-MM-DD` in local time — `toISOString()` would shift the day for anyone east of UTC. */
export function todayIsoDate(now: Date = new Date()): string {
	const month = `${now.getMonth() + 1}`.padStart(2, "0");
	const day = `${now.getDate()}`.padStart(2, "0");
	return `${now.getFullYear()}-${month}-${day}`;
}

export function validateDeliverableForm(
	values: DeliverableFormValues,
	today: string = todayIsoDate(),
): DeliverableFormErrors {
	const errors: DeliverableFormErrors = {};

	const title = values.title.trim();
	if (!title) errors.title = "Give the deliverable a name.";
	else if (title.length > TITLE_MAX)
		errors.title = `Keep this under ${TITLE_MAX} characters.`;

	if (values.description.trim().length > DESCRIPTION_MAX)
		errors.description = `Keep this under ${DESCRIPTION_MAX} characters.`;

	if (values.dueDate) {
		if (!/^\d{4}-\d{2}-\d{2}$/.test(values.dueDate)) {
			errors.dueDate = "Use a real date.";
		} else if (values.dueDate < today) {
			// A warning, not a block, would be kinder — but a past due date on a
			// brand-new deliverable is always a typo, never an intent.
			errors.dueDate = "The due date is in the past.";
		}
	}

	const rows: Record<number, string> = {};
	const seen = new Set<string>();
	values.criteria.forEach((raw, index) => {
		const criterion = raw.trim();
		if (!criterion) return; // Blank rows are ignored on submit.
		if (criterion.length > CRITERION_MAX) {
			rows[index] = `Keep this under ${CRITERION_MAX} characters.`;
			return;
		}
		const key = criterion.toLowerCase();
		if (seen.has(key)) rows[index] = "This criterion is already listed.";
		seen.add(key);
	});
	if (Object.keys(rows).length > 0) errors.criteriaRows = rows;

	return errors;
}

export function hasErrors(errors: DeliverableFormErrors): boolean {
	return Object.keys(errors).length > 0;
}

/** The request body, built only from values that already passed validation. */
export function toCreatePayload(values: DeliverableFormValues) {
	return {
		title: values.title.trim(),
		description: values.description.trim() || undefined,
		due_date: values.dueDate || undefined,
		criteria: values.criteria.map((c) => c.trim()).filter(Boolean),
	};
}

// ─── Evidence ───────────────────────────────────────────────────────────────

export interface EvidenceFormValues {
	url: string;
	label: string;
	category: EvidenceCategory;
}

export type EvidenceFormErrors = FieldErrors<EvidenceFormValues>;

export function validateEvidenceForm(
	values: EvidenceFormValues,
): EvidenceFormErrors {
	const errors: EvidenceFormErrors = {};
	const url = values.url.trim();

	if (!url) {
		errors.url = "Paste the link to the proof.";
	} else {
		let parsed: URL | null = null;
		try {
			parsed = new URL(url);
		} catch {
			parsed = null;
		}
		// Only http(s): a `javascript:` or `data:` href in an anchor the whole
		// project clicks through is a real hazard, not a style preference.
		if (
			!parsed ||
			(parsed.protocol !== "http:" && parsed.protocol !== "https:")
		)
			errors.url = "Enter a full URL starting with http:// or https://.";
	}

	if (values.label.trim().length > EVIDENCE_LABEL_MAX)
		errors.label = `Keep this under ${EVIDENCE_LABEL_MAX} characters.`;

	return errors;
}

// ─── Criteria quick-add (detail page) ───────────────────────────────────────

export function validateCriterionLabel(
	label: string,
	existing: string[],
): string | null {
	const trimmed = label.trim();
	if (!trimmed) return "Type the criterion first.";
	if (trimmed.length > CRITERION_MAX)
		return `Keep this under ${CRITERION_MAX} characters.`;
	if (existing.some((e) => e.trim().toLowerCase() === trimmed.toLowerCase()))
		return "This criterion is already listed.";
	return null;
}
