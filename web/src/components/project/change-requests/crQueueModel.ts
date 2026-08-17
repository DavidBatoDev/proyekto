import type { ChangeRequest } from "@/services/delivery.service";

/**
 * The review queue's grouping, as pure data.
 *
 * The queue is not the pipeline board rearranged. The board treated the four
 * live statuses as equal columns; the queue is ordered by **what needs a human**,
 * which puts the two-phase commit at the top where it belongs:
 *
 *   1. someone must decide           (submitted)
 *   2. someone must apply it         (approved — decided, but the plan hasn't moved)
 *   3. someone must finish writing   (draft, changes_requested)
 *   4. done, on the roadmap          (applied)
 *   5. over                          (rejected, withdrawn)
 *
 * Groups 4 and 5 collapse by default: a healthy project accumulates them, and
 * giving endings the same weight as open work makes the page read as a backlog
 * that never shrinks.
 */

export type CrQueueGroupKey =
	| "awaiting"
	| "approved"
	| "draft"
	| "applied"
	| "closed";

export interface CrQueueGroup {
	key: CrQueueGroupKey;
	label: string;
	/** Shown under the label when the group needs explaining, not decorating. */
	hint?: string;
	requests: ChangeRequest[];
	/** Whether the group starts open. Endings start closed. */
	defaultOpen: boolean;
}

const GROUPS: ReadonlyArray<{
	key: CrQueueGroupKey;
	label: string;
	hint?: string;
	statuses: ReadonlyArray<ChangeRequest["status"]>;
	defaultOpen: boolean;
}> = [
	{
		key: "awaiting",
		label: "Awaiting decision",
		hint: "Oldest first",
		statuses: ["submitted"],
		defaultOpen: true,
	},
	{
		key: "approved",
		label: "Approved — not yet on the roadmap",
		// The sentence the whole page exists to make impossible to miss.
		hint: "Approving does not change the plan; someone still has to apply it",
		statuses: ["approved"],
		defaultOpen: true,
	},
	{
		key: "draft",
		label: "Draft",
		statuses: ["draft", "changes_requested"],
		defaultOpen: true,
	},
	{
		key: "applied",
		label: "On the roadmap",
		statuses: ["applied"],
		defaultOpen: false,
	},
	{
		key: "closed",
		label: "Closed",
		statuses: ["rejected", "withdrawn"],
		defaultOpen: false,
	},
];

/**
 * Oldest-first inside "Awaiting decision", newest-first everywhere else.
 *
 * The aging sort is the whole point of that group — it exists to surface what has
 * been sitting, and newest-first would bury exactly that. Every other group is
 * read as a record, where recent is more interesting.
 */
function sortFor(key: CrQueueGroupKey) {
	return (a: ChangeRequest, b: ChangeRequest) =>
		key === "awaiting"
			? a.updated_at.localeCompare(b.updated_at)
			: b.updated_at.localeCompare(a.updated_at);
}

/**
 * Group requests for the queue.
 *
 * Empty groups are returned rather than dropped, so the page can show "Draft (0)"
 * — a collapsed empty group is information ("nothing is waiting on you"), whereas
 * a missing one reads as a rendering bug.
 */
export function queueGroups(requests: ChangeRequest[]): CrQueueGroup[] {
	return GROUPS.map((group) => ({
		key: group.key,
		label: group.label,
		hint: group.hint,
		defaultOpen: group.defaultOpen,
		requests: requests
			.filter((request) => group.statuses.includes(request.status))
			.sort(sortFor(group.key)),
	}));
}

/** Which group a status lands in — used to deep-link `?status=` to a group. */
export function groupForStatus(
	status: ChangeRequest["status"],
): CrQueueGroupKey {
	const found = GROUPS.find((group) => group.statuses.includes(status));
	// Every status is covered by the table above; the fallback keeps this total
	// rather than returning undefined for a status added later.
	return found?.key ?? "closed";
}

/**
 * The two schedule numbers for the header.
 *
 * Returned as a pair, never a sum. An applied request's days are already inside
 * the roadmap's own dates, so adding the two and comparing against the current
 * schedule counts them twice — see `ChangeRequestStats.committedTimelineDays`.
 */
export interface CrScheduleLedger {
	pending: number;
	committed: number;
}

export function scheduleLedger(requests: ChangeRequest[]): CrScheduleLedger {
	const days = (status: ChangeRequest["status"]) =>
		requests
			.filter((request) => request.status === status)
			.reduce((sum, request) => sum + (request.impact_timeline_days ?? 0), 0);

	return { pending: days("approved"), committed: days("applied") };
}
