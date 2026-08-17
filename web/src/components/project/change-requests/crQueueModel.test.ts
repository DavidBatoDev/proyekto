import { describe, expect, it } from "vitest";
import type { ChangeRequest } from "@/services/delivery.service";
import {
	type CrQueueGroupKey,
	groupForStatus,
	queueGroups,
	scheduleLedger,
} from "./crQueueModel";

function request(overrides: Partial<ChangeRequest> = {}): ChangeRequest {
	return {
		id: "cr-1",
		project_id: "p1",
		roadmap_id: null,
		reference: 1,
		title: "Add Google OAuth",
		description: null,
		requested_by: "user-1",
		impact_scope: null,
		impact_timeline_days: null,
		target_date_before: null,
		target_date_after: null,
		status: "submitted",
		decided_by: null,
		decided_at: null,
		decision_note: null,
		applied_change_id: null,
		applied_by: null,
		applied_at: null,
		created_at: "2026-08-10T00:00:00Z",
		updated_at: "2026-08-10T00:00:00Z",
		links: [],
		...overrides,
	};
}

const groupOf = (
	groups: ReturnType<typeof queueGroups>,
	key: CrQueueGroupKey,
) => groups.find((group) => group.key === key);

describe("queueGroups", () => {
	it("orders groups by what needs a human, not by lifecycle", () => {
		// Awaiting a decision comes before approved-not-applied, which comes before
		// unfinished drafts; endings sink to the bottom.
		expect(queueGroups([]).map((group) => group.key)).toEqual([
			"awaiting",
			"approved",
			"draft",
			"applied",
			"closed",
		]);
	});

	it("returns empty groups rather than dropping them", () => {
		// "Draft (0)" is information; a missing group reads as a bug.
		const groups = queueGroups([]);
		expect(groups).toHaveLength(5);
		expect(groups.every((group) => group.requests.length === 0)).toBe(true);
	});

	it("keeps endings collapsed and open work expanded by default", () => {
		const groups = queueGroups([]);
		expect(groupOf(groups, "awaiting")?.defaultOpen).toBe(true);
		expect(groupOf(groups, "approved")?.defaultOpen).toBe(true);
		expect(groupOf(groups, "draft")?.defaultOpen).toBe(true);
		expect(groupOf(groups, "applied")?.defaultOpen).toBe(false);
		expect(groupOf(groups, "closed")?.defaultOpen).toBe(false);
	});

	it("files a bounced request under Draft, where the work actually is", () => {
		const groups = queueGroups([
			request({ id: "a", status: "changes_requested" }),
			request({ id: "b", status: "draft" }),
		]);
		expect(groupOf(groups, "draft")?.requests).toHaveLength(2);
	});

	it("separates approved from applied — the two-phase commit", () => {
		const groups = queueGroups([
			request({ id: "a", status: "approved" }),
			request({ id: "b", status: "applied" }),
		]);
		expect(groupOf(groups, "approved")?.requests.map((r) => r.id)).toEqual([
			"a",
		]);
		expect(groupOf(groups, "applied")?.requests.map((r) => r.id)).toEqual([
			"b",
		]);
	});

	it("puts rejected and withdrawn together under Closed", () => {
		const groups = queueGroups([
			request({ id: "a", status: "rejected" }),
			request({ id: "b", status: "withdrawn" }),
		]);
		expect(groupOf(groups, "closed")?.requests).toHaveLength(2);
	});

	it("sorts the awaiting group oldest first", () => {
		// The group exists to surface what has been sitting.
		const groups = queueGroups([
			request({ id: "new", status: "submitted", updated_at: "2026-08-16" }),
			request({ id: "old", status: "submitted", updated_at: "2026-08-01" }),
		]);
		expect(groupOf(groups, "awaiting")?.requests.map((r) => r.id)).toEqual([
			"old",
			"new",
		]);
	});

	it("sorts every other group newest first", () => {
		const groups = queueGroups([
			request({ id: "old", status: "applied", updated_at: "2026-08-01" }),
			request({ id: "new", status: "applied", updated_at: "2026-08-16" }),
		]);
		expect(groupOf(groups, "applied")?.requests.map((r) => r.id)).toEqual([
			"new",
			"old",
		]);
	});

	it("does not mutate the array it was given", () => {
		const requests = [
			request({ id: "a", status: "submitted", updated_at: "2026-08-16" }),
			request({ id: "b", status: "submitted", updated_at: "2026-08-01" }),
		];
		queueGroups(requests);
		expect(requests.map((r) => r.id)).toEqual(["a", "b"]);
	});

	it("accounts for every request exactly once", () => {
		const statuses: ChangeRequest["status"][] = [
			"draft",
			"submitted",
			"approved",
			"rejected",
			"changes_requested",
			"withdrawn",
			"applied",
		];
		const requests = statuses.map((status, i) =>
			request({ id: `r${i}`, status }),
		);
		const placed = queueGroups(requests).flatMap((group) => group.requests);
		expect(placed).toHaveLength(statuses.length);
		expect(new Set(placed.map((r) => r.id)).size).toBe(statuses.length);
	});
});

describe("groupForStatus", () => {
	it("maps every status to the group that holds it", () => {
		expect(groupForStatus("submitted")).toBe("awaiting");
		expect(groupForStatus("approved")).toBe("approved");
		expect(groupForStatus("draft")).toBe("draft");
		expect(groupForStatus("changes_requested")).toBe("draft");
		expect(groupForStatus("applied")).toBe("applied");
		expect(groupForStatus("rejected")).toBe("closed");
		expect(groupForStatus("withdrawn")).toBe("closed");
	});
});

describe("scheduleLedger", () => {
	it("keeps pending and committed days apart", () => {
		// Summing these double-counts the applied days, which are already inside
		// the roadmap's own dates.
		const ledger = scheduleLedger([
			request({ id: "a", status: "approved", impact_timeline_days: 5 }),
			request({ id: "b", status: "approved", impact_timeline_days: 7 }),
			request({ id: "c", status: "applied", impact_timeline_days: 6 }),
		]);
		expect(ledger).toEqual({ pending: 12, committed: 6 });
	});

	it("counts negative days, which pull the schedule in", () => {
		const ledger = scheduleLedger([
			request({ status: "approved", impact_timeline_days: -3 }),
		]);
		expect(ledger.pending).toBe(-3);
	});

	it("treats a missing day count as zero", () => {
		const ledger = scheduleLedger([
			request({ status: "approved", impact_timeline_days: null }),
		]);
		expect(ledger.pending).toBe(0);
	});

	it("ignores requests nobody has decided yet", () => {
		// A submitted request's days are a proposal, not a liability.
		const ledger = scheduleLedger([
			request({ status: "submitted", impact_timeline_days: 40 }),
			request({ status: "draft", impact_timeline_days: 40 }),
			request({ status: "rejected", impact_timeline_days: 40 }),
		]);
		expect(ledger).toEqual({ pending: 0, committed: 0 });
	});
});
