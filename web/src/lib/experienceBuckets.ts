/**
 * Years-of-experience buckets for consultant expertise placements.
 *
 * Stored as the bucket floor in years (SMALLINT server-side), so the value is
 * comparable and the labels can be reworded without a migration. Shared by
 * the apply wizard's speciality rows and the admin review panel — one
 * vocabulary, rendered identically on both sides of the review.
 */
export const EXPERIENCE_BUCKETS: { value: number; label: string }[] = [
	{ value: 0, label: "<1 yr" },
	{ value: 1, label: "1–3 yrs" },
	{ value: 3, label: "3–5 yrs" },
	{ value: 5, label: "5–10 yrs" },
	{ value: 10, label: "10+ yrs" },
];

/** Label for a stored bucket floor; em dash for unset/unknown values. */
export function experienceLabel(years: number | null | undefined): string {
	if (years === null || years === undefined) return "—";
	return (
		EXPERIENCE_BUCKETS.find((bucket) => bucket.value === years)?.label ??
		`${years} yrs`
	);
}
