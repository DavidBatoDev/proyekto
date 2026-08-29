/**
 * Date and enum wording shared by the public seller profiles (consultant +
 * talent). Dates render as a month, never a clock reading — a profile carries
 * no timezone to compute a "local time" from, and the page this convention
 * replaced showed the VIEWER's clock labelled as the seller's.
 */

/**
 * `availability_status` is a snake_case enum; the public profiles are the only
 * place it is shown to a reader, so the wording lives here rather than the DB.
 */
export function formatAvailability(value: string): string {
	switch (value) {
		case "available":
			return "Available for new work";
		case "partially_available":
			return "Partly available";
		case "unavailable":
			return "Not taking new work";
		default:
			return value;
	}
}

export function formatMonthYear(value: string | null): string | null {
	if (!value) return null;
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return null;
	return new Intl.DateTimeFormat(undefined, {
		month: "long",
		year: "numeric",
	}).format(date);
}
