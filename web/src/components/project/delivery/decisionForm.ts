import type { CreateDecisionBody } from "@/services/delivery.service";
import type { FieldErrors } from "./deliverableForm";

/**
 * Client-side validation for the decision forms.
 *
 * Pure functions kept out of the components, with limits mirroring the backend
 * DTO (`backend/src/modules/execution/delivery/dto/delivery.dto.ts`) so a form
 * can never submit something the global ValidationPipe will 400. When you change
 * a limit here, change it there too.
 */

export const DECISION_TITLE_MAX = 200;
export const DECISION_PROSE_MAX = 4000;
export const OPTION_TITLE_MAX = 200;
export const OPTION_DETAIL_MAX = 2000;
export const CATEGORY_NAME_MAX = 60;

export interface DecisionOptionDraft {
	title: string;
	detail: string;
}

export interface DecisionFormValues {
	title: string;
	/** The decision itself, stated plainly. */
	decision: string;
	context: string;
	rationale: string;
	categoryId: string;
	status: "proposed" | "final";
	visibility: "internal" | "shared";
	/** One row per option — blank rows are dropped, not rejected. */
	options: DecisionOptionDraft[];
	/** Index into `options`, or null if nothing has been chosen yet. */
	selectedOption: number | null;
}

export type DecisionFormErrors = FieldErrors<DecisionFormValues> & {
	/** Keyed by row index so a single bad row can be marked in place. */
	optionRows?: Record<number, string>;
};

export const EMPTY_DECISION_FORM: DecisionFormValues = {
	title: "",
	decision: "",
	context: "",
	rationale: "",
	categoryId: "",
	status: "final",
	visibility: "shared",
	options: [],
	selectedOption: null,
};

export function validateDecisionForm(
	values: DecisionFormValues,
): DecisionFormErrors {
	const errors: DecisionFormErrors = {};

	const title = values.title.trim();
	if (!title) errors.title = "Give the decision a short name.";
	else if (title.length > DECISION_TITLE_MAX)
		errors.title = `Keep this under ${DECISION_TITLE_MAX} characters.`;

	const decision = values.decision.trim();
	if (!decision) errors.decision = "State what was decided.";
	else if (decision.length > DECISION_PROSE_MAX)
		errors.decision = `Keep this under ${DECISION_PROSE_MAX} characters.`;

	if (values.context.trim().length > DECISION_PROSE_MAX)
		errors.context = `Keep this under ${DECISION_PROSE_MAX} characters.`;
	if (values.rationale.trim().length > DECISION_PROSE_MAX)
		errors.rationale = `Keep this under ${DECISION_PROSE_MAX} characters.`;

	const optionRows: Record<number, string> = {};
	const seen = new Set<string>();
	values.options.forEach((option, index) => {
		const label = option.title.trim();
		// A blank row is someone who added one and changed their mind; dropping it
		// silently is kinder than making them delete it before they can save.
		if (!label && !option.detail.trim()) return;
		if (!label) {
			optionRows[index] = "Name this option or clear the row.";
			return;
		}
		if (label.length > OPTION_TITLE_MAX) {
			optionRows[index] = `Keep this under ${OPTION_TITLE_MAX} characters.`;
			return;
		}
		if (option.detail.trim().length > OPTION_DETAIL_MAX) {
			optionRows[index] =
				`Keep the detail under ${OPTION_DETAIL_MAX} characters.`;
			return;
		}
		const key = label.toLowerCase();
		if (seen.has(key)) optionRows[index] = "This option is already listed.";
		seen.add(key);
	});
	if (Object.keys(optionRows).length) errors.optionRows = optionRows;

	return errors;
}

export function hasDecisionErrors(errors: DecisionFormErrors): boolean {
	return (
		Object.keys(errors).filter((key) => key !== "optionRows").length > 0 ||
		Object.keys(errors.optionRows ?? {}).length > 0
	);
}

export function toCreateDecisionPayload(
	values: DecisionFormValues,
): CreateDecisionBody {
	const options = values.options
		.map((option, index) => ({ option, index }))
		.filter(({ option }) => option.title.trim().length > 0)
		.map(({ option, index }) => ({
			title: option.title.trim(),
			detail: option.detail.trim() || undefined,
			is_selected: values.selectedOption === index,
		}));

	return {
		title: values.title.trim(),
		decision: values.decision.trim(),
		context: values.context.trim() || undefined,
		rationale: values.rationale.trim() || undefined,
		category_id: values.categoryId || undefined,
		status: values.status,
		visibility: values.visibility,
		options: options.length ? options : undefined,
	};
}

/**
 * Category names are unique per project case-insensitively — the database
 * enforces it with `uq_decision_categories_name`. Catching it here means the
 * user is told before they submit rather than by a 409.
 */
export function validateCategoryName(
	name: string,
	existing: ReadonlyArray<{ id: string; name: string }>,
	/** Set when renaming, so a category does not collide with itself. */
	ignoreId?: string,
): string | null {
	const trimmed = name.trim();
	if (!trimmed) return "Give the category a name.";
	if (trimmed.length > CATEGORY_NAME_MAX)
		return `Keep this under ${CATEGORY_NAME_MAX} characters.`;
	const clash = existing.some(
		(category) =>
			category.id !== ignoreId &&
			category.name.trim().toLowerCase() === trimmed.toLowerCase(),
	);
	if (clash) return "You already have a category with that name.";
	return null;
}

/** The quick-add on the detail page's Options tab. */
export function validateOptionTitle(
	title: string,
	existing: ReadonlyArray<{ title: string }>,
): string | null {
	const trimmed = title.trim();
	if (!trimmed) return "Name the option.";
	if (trimmed.length > OPTION_TITLE_MAX)
		return `Keep this under ${OPTION_TITLE_MAX} characters.`;
	const clash = existing.some(
		(option) => option.title.trim().toLowerCase() === trimmed.toLowerCase(),
	);
	if (clash) return "This option is already listed.";
	return null;
}
