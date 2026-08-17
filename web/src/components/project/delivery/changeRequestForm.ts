import type { ChangeRequest } from "@/services/delivery.service";
import { type FieldErrors, todayIsoDate } from "./deliverableForm";

/**
 * Client-side validation for the change-request form.
 *
 * Limits mirror the backend DTO (`CreateChangeRequestDto` /
 * `UpdateChangeRequestDto` in
 * `backend/src/modules/execution/delivery/dto/delivery.dto.ts`) so the form can
 * never submit something the global ValidationPipe will 400. Change a limit here
 * and change it there too.
 *
 * `todayIsoDate` is reused from `deliverableForm` rather than re-derived — it
 * exists specifically because `toISOString()` shifts the day for anyone east of
 * UTC, and that bug should be fixed in one place.
 */

export const CR_TITLE_MAX = 200;
export const CR_DESCRIPTION_MAX = 8000;
export const CR_SCOPE_MAX = 4000;

/**
 * Bounds on the day delta.
 *
 * The column is a plain `integer`, so anything beyond ±10 years is a typo — most
 * often a date pasted into a number field. Rejecting it here beats storing
 * "+20260817 days".
 */
export const CR_DAYS_MIN = -3650;
export const CR_DAYS_MAX = 3650;

export interface ChangeRequestFormValues {
	title: string;
	description: string;
	impactScope: string;
	/** Kept as a string so a half-typed "-" or "" is representable. */
	impactDays: string;
	targetDateBefore: string;
	targetDateAfter: string;
}

export type ChangeRequestFormErrors = FieldErrors<ChangeRequestFormValues>;

export const EMPTY_CHANGE_REQUEST_FORM: ChangeRequestFormValues = {
	title: "",
	description: "",
	impactScope: "",
	impactDays: "",
	targetDateBefore: "",
	targetDateAfter: "",
};

/** Populate the form for editing, so Edit opens on the current values. */
export function changeRequestToForm(
	request: ChangeRequest,
): ChangeRequestFormValues {
	return {
		title: request.title,
		description: request.description ?? "",
		impactScope: request.impact_scope ?? "",
		impactDays:
			request.impact_timeline_days === null
				? ""
				: String(request.impact_timeline_days),
		targetDateBefore: request.target_date_before ?? "",
		targetDateAfter: request.target_date_after ?? "",
	};
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function validateChangeRequestForm(
	values: ChangeRequestFormValues,
): ChangeRequestFormErrors {
	const errors: ChangeRequestFormErrors = {};

	const title = values.title.trim();
	if (!title) errors.title = "Say what is being asked for.";
	else if (title.length > CR_TITLE_MAX)
		errors.title = `Keep this under ${CR_TITLE_MAX} characters.`;

	if (values.description.trim().length > CR_DESCRIPTION_MAX)
		errors.description = `Keep this under ${CR_DESCRIPTION_MAX} characters.`;

	if (values.impactScope.trim().length > CR_SCOPE_MAX)
		errors.impactScope = `Keep this under ${CR_SCOPE_MAX} characters.`;

	if (values.impactDays.trim()) {
		// Deliberately not parseInt: "5 days" would parse to 5 and silently drop
		// the rest, so the whole string has to look like an integer.
		if (!/^-?\d+$/.test(values.impactDays.trim())) {
			errors.impactDays = "Use a whole number of days, or leave it blank.";
		} else {
			const days = Number(values.impactDays);
			if (days < CR_DAYS_MIN || days > CR_DAYS_MAX)
				errors.impactDays = "That does not look like a number of days.";
		}
	}

	for (const field of ["targetDateBefore", "targetDateAfter"] as const) {
		if (values[field] && !DATE_PATTERN.test(values[field]))
			errors[field] = "Use a real date.";
	}

	// Only checked when both are present and well-formed: the pair is what makes
	// the claim, and flagging one alone would be noise while the other is typed.
	if (
		!errors.targetDateBefore &&
		!errors.targetDateAfter &&
		values.targetDateBefore &&
		values.targetDateAfter &&
		values.targetDateAfter < values.targetDateBefore &&
		values.impactDays.trim() &&
		Number(values.impactDays) > 0
	) {
		errors.targetDateAfter =
			"This pulls the date earlier, but the day impact is positive.";
	}

	return errors;
}

export function hasChangeRequestErrors(
	errors: ChangeRequestFormErrors,
): boolean {
	return Object.keys(errors).length > 0;
}

/** The create body, built only from values that already passed validation. */
export function toChangeRequestCreatePayload(
	values: ChangeRequestFormValues,
	options: { submit: boolean; roadmapId?: string | null },
) {
	return {
		title: values.title.trim(),
		description: values.description.trim() || undefined,
		impact_scope: values.impactScope.trim() || undefined,
		impact_timeline_days: values.impactDays.trim()
			? Number(values.impactDays)
			: undefined,
		target_date_before: values.targetDateBefore || undefined,
		target_date_after: values.targetDateAfter || undefined,
		roadmap_id: options.roadmapId ?? undefined,
		submit: options.submit,
	};
}

/**
 * The update body.
 *
 * Cleared fields send `null` rather than `undefined`, because the backend's
 * `pick` drops undefined keys — so `undefined` would mean "leave it alone" and
 * a user emptying a field would watch the old value come back.
 */
export function toChangeRequestUpdatePayload(values: ChangeRequestFormValues) {
	return {
		title: values.title.trim(),
		description: values.description.trim(),
		impact_scope: values.impactScope.trim(),
		impact_timeline_days: values.impactDays.trim()
			? Number(values.impactDays)
			: null,
		target_date_before: values.targetDateBefore || null,
		target_date_after: values.targetDateAfter || null,
	};
}

export { todayIsoDate };
