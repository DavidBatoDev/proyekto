import { format, parseISO } from "date-fns";
import type { Decision } from "@/services/delivery.service";

export interface DecisionMonthGroup {
	/** Local calendar month, `yyyy-MM`. */
	key: string;
	label: string;
	decisions: Decision[];
}

/**
 * Group the log into calendar months.
 *
 * Deliberately parallel to `groupActivityByDay`, and it inherits both of that
 * function's rules:
 *
 *  - **Key on the local calendar**, never `toISOString().slice(0, 7)`. `decided_on`
 *    is already a plain `yyyy-MM-dd` date with no zone, so it is parsed with
 *    `parseISO` rather than `new Date()`, which would read it as UTC midnight and
 *    file the 1st of a month under the previous one for anyone behind UTC.
 *
 *  - **Never re-sort.** The server returns `decided_on DESC, created_at DESC`;
 *    re-sorting here would silently disagree with the order the API paginates in.
 *    Runs of the same month are collected as they arrive, so an unsorted input
 *    produces repeated month bands — which is the honest rendering of unsorted
 *    data, not a bug to paper over.
 */
export function groupDecisionsByMonth(
	decisions: Decision[],
): DecisionMonthGroup[] {
	const groups: DecisionMonthGroup[] = [];

	for (const decision of decisions) {
		const date = parseISO(decision.decided_on);
		if (Number.isNaN(date.getTime())) continue;

		const key = format(date, "yyyy-MM");
		const last = groups[groups.length - 1];
		if (last && last.key === key) {
			last.decisions.push(decision);
			continue;
		}
		groups.push({ key, label: monthLabel(date), decisions: [decision] });
	}

	return groups;
}

/** "August 2026" — the band a reader scans for when scrolling back. */
export function monthLabel(date: Date): string {
	return format(date, "MMMM yyyy");
}

/**
 * The log's facets.
 *
 * Multi-select, which is what the checkboxes promise: "Technical **and** Design"
 * is a question people actually ask of a decision log, and the old
 * one-value-or-nothing rail could not express it. An empty list means the facet
 * is not filtering — there is no "Any" row to select, because unchecking
 * everything already says that.
 */
export interface DecisionFilters {
	statuses: Decision["status"][];
	/** Category ids. The empty string is the uncategorised bucket. */
	categoryIds: string[];
}

export const NO_DECISION_FILTERS: DecisionFilters = {
	statuses: [],
	categoryIds: [],
};

export function hasActiveDecisionFilters(filters: DecisionFilters): boolean {
	return filters.statuses.length > 0 || filters.categoryIds.length > 0;
}

/**
 * Facets are ANDed with each other and ORed within themselves — the standard
 * faceted-search reading, and the only one that makes the counts beside each row
 * mean what they look like they mean.
 */
export function filterDecisions(
	decisions: Decision[],
	filters: DecisionFilters,
): Decision[] {
	return decisions.filter((decision) => {
		if (
			filters.statuses.length > 0 &&
			!filters.statuses.includes(decision.status)
		) {
			return false;
		}
		if (filters.categoryIds.length > 0) {
			// A decision with no category matches the "" bucket, not its own id.
			const bucket = decision.category_id ?? "";
			if (!filters.categoryIds.includes(bucket)) return false;
		}
		return true;
	});
}

/**
 * Which decisions in this page are replaced by a later one.
 *
 * The log draws a thread from a decision to the one it supersedes, but only when
 * both are on screen — a connector pointing at a row that was filtered out is
 * worse than no connector. Returns the ids present in the given set.
 */
export function supersededWithin(decisions: Decision[]): Set<string> {
	const present = new Set(decisions.map((decision) => decision.id));
	const replaced = new Set<string>();
	for (const decision of decisions) {
		const target = decision.supersedes_decision_id;
		if (target && present.has(target)) replaced.add(target);
	}
	return replaced;
}
