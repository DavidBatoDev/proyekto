import type { ConsultantDirectoryParams } from "@/queries/consultants";

/**
 * The browse page's filter state, as it is carried in the URL.
 *
 * Kept separate from `ConsultantDirectoryParams` on purpose: the URL speaks in
 * the rail's vocabulary (a budget *bracket*, a delivery *promise*), and the API
 * speaks in bounds. Translating between the two in one pure function is what
 * keeps a shareable URL from encoding four numbers nobody can read, and lets
 * the mapping be tested without rendering anything.
 */
export interface ConsultantBrowseSearch {
	q?: string;
	category?: string;
	subcategory?: string;
	country?: string;
	/** An ISO code from the facets endpoint, never a display name. */
	language?: string;
	/** A key from `BUDGET_BRACKETS`. */
	budget?: string;
	/** "Delivers within N days", from `DELIVERY_OPTIONS`. */
	delivery?: number;
	/** Only consultants who publish an hourly rate. */
	hourly?: boolean;
	hourlyMin?: number;
	hourlyMax?: number;
	/** Rate card says available rather than busy. */
	available?: boolean;
	/** Only consultants with a published service catalog. */
	catalog?: boolean;
}

export const BUDGET_BRACKETS = [
	{ key: "under-1k", label: "Under $1,000", min: undefined, max: 1000 },
	{ key: "1k-5k", label: "$1,000 – $5,000", min: 1000, max: 5000 },
	{ key: "5k-20k", label: "$5,000 – $20,000", min: 5000, max: 20000 },
	{ key: "20k-plus", label: "$20,000 and up", min: 20000, max: undefined },
] as const;

export const DELIVERY_OPTIONS = [
	{ value: 7, label: "Up to 1 week" },
	{ value: 14, label: "Up to 2 weeks" },
	{ value: 30, label: "Up to 1 month" },
	{ value: 90, label: "Up to 3 months" },
] as const;

/** A number that survived the URL as a number, or nothing. */
function readNumber(value: unknown): number | undefined {
	if (value === undefined || value === null || value === "") return undefined;
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
	if (value === true || value === "true") return true;
	return undefined;
}

function readString(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed.slice(0, 80) : undefined;
}

/**
 * Anything the address bar hands us, narrowed to the filters we understand.
 *
 * Unknown keys and unparseable values are dropped rather than passed through,
 * so a hand-edited URL cannot smuggle a parameter into the API call.
 */
export function parseConsultantBrowseSearch(
	search: Record<string, unknown>,
): ConsultantBrowseSearch {
	const budget = readString(search.budget);
	const delivery = readNumber(search.delivery);

	return {
		q: readString(search.q),
		category: readString(search.category),
		// A speciality is only resolvable inside its category, so it cannot
		// outlive one being cleared.
		subcategory: search.category ? readString(search.subcategory) : undefined,
		country: readString(search.country),
		language: readString(search.language)?.toLowerCase(),
		budget: BUDGET_BRACKETS.some((bracket) => bracket.key === budget)
			? budget
			: undefined,
		delivery: DELIVERY_OPTIONS.some((option) => option.value === delivery)
			? delivery
			: undefined,
		hourly: readBoolean(search.hourly),
		hourlyMin: readBoolean(search.hourly)
			? readNumber(search.hourlyMin)
			: undefined,
		hourlyMax: readBoolean(search.hourly)
			? readNumber(search.hourlyMax)
			: undefined,
		available: readBoolean(search.available),
		catalog: readBoolean(search.catalog),
	};
}

/** The rail's vocabulary translated into the directory endpoint's. */
export function toDirectoryParams(
	search: ConsultantBrowseSearch,
): Omit<ConsultantDirectoryParams, "limit" | "offset"> {
	const bracket = BUDGET_BRACKETS.find((entry) => entry.key === search.budget);

	return {
		category: search.category,
		subcategory: search.subcategory,
		q: search.q,
		country: search.country,
		language: search.language,
		budgetMin: bracket?.min,
		budgetMax: bracket?.max,
		deliveryDays: search.delivery,
		offersHourly: search.hourly || undefined,
		hourlyMin: search.hourly ? search.hourlyMin : undefined,
		hourlyMax: search.hourly ? search.hourlyMax : undefined,
		availableNow: search.available || undefined,
		hasServices: search.catalog || undefined,
	};
}

/**
 * How many filters are on, for the "Filters (3)" button on narrow screens and
 * the "Clear all" affordance. The free-text search is deliberately excluded —
 * it has its own visible input, and counting it there would read as a filter
 * the visitor cannot find.
 */
export function countActiveFilters(search: ConsultantBrowseSearch): number {
	return [
		search.category,
		search.subcategory,
		search.country,
		search.language,
		search.budget,
		search.delivery,
		search.hourly,
		search.available,
		search.catalog,
	].filter(Boolean).length;
}
