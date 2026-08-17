import { describe, expect, it } from "vitest";
import type { ChangeRequest } from "@/services/delivery.service";
import {
	canDecide,
	canMarkApplied,
	canWithdraw,
	isOpen,
	isOptimisticId,
	optimisticChangeRequest,
	removeChangeRequest,
	replaceChangeRequest,
	upsertChangeRequest,
	withApplied,
	withDecision,
	withLinkRemoved,
	withSubmitted,
	withWithdrawn,
} from "./changeRequestCache";

function cr(overrides: Partial<ChangeRequest> = {}): ChangeRequest {
	return {
		id: "cr-1",
		project_id: "p1",
		roadmap_id: null,
		reference: 1,
		title: "Add Google OAuth",
		description: null,
		requested_by: "u1",
		impact_scope: null,
		impact_timeline_days: null,
		target_date_before: null,
		target_date_after: null,
		status: "draft",
		decided_by: null,
		decided_at: null,
		decision_note: null,
		applied_change_id: null,
		applied_by: null,
		applied_at: null,
		created_at: "2026-08-01T00:00:00Z",
		updated_at: "2026-08-01T00:00:00Z",
		links: [],
		applied_change: null,
		...overrides,
	};
}

/**
 * These predicates mirror the backend guards in `change-requests.service.ts`.
 * If one drifts, the UI offers a button whose write the server refuses — so
 * these cases are the mirror, stated once.
 */
describe("status predicates mirror the backend guards", () => {
	it.each(["draft", "changes_requested"] as const)(
		"treats %s as still open",
		(status) => {
			expect(isOpen(cr({ status }))).toBe(true);
		},
	);

	it.each([
		"submitted",
		"approved",
		"rejected",
		"withdrawn",
		"applied",
	] as const)("treats %s as closed to editing", (status) => {
		expect(isOpen(cr({ status }))).toBe(false);
	});

	it("only allows deciding a submitted request", () => {
		expect(canDecide(cr({ status: "submitted" }))).toBe(true);
		for (const status of [
			"draft",
			"approved",
			"rejected",
			"changes_requested",
			"withdrawn",
			"applied",
		] as const) {
			expect(canDecide(cr({ status }))).toBe(false);
		}
	});

	it("only allows marking applied from approved", () => {
		expect(canMarkApplied(cr({ status: "approved" }))).toBe(true);
		expect(canMarkApplied(cr({ status: "submitted" }))).toBe(false);
		expect(canMarkApplied(cr({ status: "applied" }))).toBe(false);
	});

	it("allows withdrawing anything not already finished", () => {
		expect(canWithdraw(cr({ status: "draft" }))).toBe(true);
		expect(canWithdraw(cr({ status: "submitted" }))).toBe(true);
		expect(canWithdraw(cr({ status: "approved" }))).toBe(true);
		expect(canWithdraw(cr({ status: "applied" }))).toBe(false);
		expect(canWithdraw(cr({ status: "withdrawn" }))).toBe(false);
	});
});

describe("list membership", () => {
	// The list is newest-first, so a freshly raised request belongs at the top —
	// appending would file it below older rows and look like it failed.
	it("prepends a new request rather than appending it", () => {
		const list = [cr({ id: "old" })];
		expect(
			upsertChangeRequest(list, cr({ id: "new" })).map((r) => r.id),
		).toEqual(["new", "old"]);
	});

	it("replaces in place without reordering", () => {
		const list = [cr({ id: "a" }), cr({ id: "b" }), cr({ id: "c" })];
		const updated = upsertChangeRequest(
			list,
			cr({ id: "b", title: "Renamed" }),
		);
		expect(updated.map((r) => r.id)).toEqual(["a", "b", "c"]);
		expect(updated[1].title).toBe("Renamed");
	});

	// The whole point of tracking previousId: the temp row must be swapped, not
	// joined by a duplicate carrying the real id.
	it("swaps a temp row for the server row it became", () => {
		const draft = optimisticChangeRequest("p1", { title: "Draft" }, "u1");
		const list = [draft, cr({ id: "other" })];
		const saved = cr({ id: "cr-real", reference: 14, title: "Draft" });

		const updated = replaceChangeRequest(list, draft.id, saved);

		expect(updated).toHaveLength(2);
		expect(updated.map((r) => r.id)).toEqual(["cr-real", "other"]);
	});

	it("falls back to inserting when the previous row has gone", () => {
		const list = [cr({ id: "other" })];
		const updated = replaceChangeRequest(list, "vanished", cr({ id: "new" }));
		expect(updated.map((r) => r.id)).toEqual(["new", "other"]);
	});

	it("removes by id and leaves the rest alone", () => {
		const list = [cr({ id: "a" }), cr({ id: "b" })];
		expect(removeChangeRequest(list, "a").map((r) => r.id)).toEqual(["b"]);
		expect(removeChangeRequest(list, "missing")).toHaveLength(2);
	});
});

describe("status patches", () => {
	it("moves to submitted and bumps updated_at", () => {
		const before = cr();
		const after = withSubmitted(before);
		expect(after.status).toBe("submitted");
		expect(after.updated_at).not.toBe(before.updated_at);
	});

	it("moves to withdrawn", () => {
		expect(withWithdrawn(cr()).status).toBe("withdrawn");
	});

	// The DB CHECK requires decided_by AND decided_at on every decided state, so
	// patching status alone would render a decided card with no attribution for
	// one round trip — visibly different from the row that arrives next.
	it.each(["approved", "rejected", "changes_requested"] as const)(
		"stamps who decided and when for %s",
		(decision) => {
			const after = withDecision(
				cr({ status: "submitted" }),
				decision,
				"why",
				"u9",
			);
			expect(after.status).toBe(decision);
			expect(after.decided_by).toBe("u9");
			expect(after.decided_at).toBeTruthy();
			expect(after.decision_note).toBe("why");
		},
	);

	it("stores a missing decision note as null, not undefined", () => {
		const after = withDecision(
			cr({ status: "submitted" }),
			"approved",
			undefined,
			"u9",
		);
		expect(after.decision_note).toBeNull();
	});

	it("stamps the commit when marking applied", () => {
		const after = withApplied(cr({ status: "approved" }), "change-1", "u9");
		expect(after.status).toBe("applied");
		expect(after.applied_change_id).toBe("change-1");
		expect(after.applied_by).toBe("u9");
		expect(after.applied_at).toBeTruthy();
	});

	// `applied_change` carries commit metadata (operation counts) only the server
	// can supply. Faking it with zeroes would display "0 operations" and then
	// correct itself.
	it("leaves applied_change for the server rather than inventing counts", () => {
		expect(
			withApplied(cr({ status: "approved" }), "change-1", "u9").applied_change,
		).toBeNull();
	});

	it("drops a link by id", () => {
		const before = cr({
			links: [
				{
					id: "l1",
					epic_id: "e1",
					feature_id: null,
					task_id: null,
					deliverable_id: null,
					position: 0,
				},
				{
					id: "l2",
					epic_id: null,
					feature_id: "f1",
					task_id: null,
					deliverable_id: null,
					position: 1,
				},
			],
		});
		expect(withLinkRemoved(before, "l1").links?.map((l) => l.id)).toEqual([
			"l2",
		]);
	});

	it("tolerates removing a link from a request with none", () => {
		expect(withLinkRemoved(cr({ links: undefined }), "l1").links).toEqual([]);
	});

	it("does not mutate the row it patches", () => {
		const before = cr();
		withSubmitted(before);
		expect(before.status).toBe("draft");
	});
});

describe("optimisticChangeRequest", () => {
	it("is recognisable as a temp row", () => {
		const draft = optimisticChangeRequest("p1", { title: "T" }, "u1");
		expect(isOptimisticId(draft.id)).toBe(true);
		expect(isOptimisticId("cr-real")).toBe(false);
	});

	// The human number comes from max(reference)+1 server-side. Guessing "CR-001"
	// and then correcting to CR-014 is worse than showing no number at all.
	it("leaves the reference unallocated", () => {
		expect(optimisticChangeRequest("p1", { title: "T" }, "u1").reference).toBe(
			0,
		);
	});

	it("reflects submit-on-create in the status", () => {
		expect(
			optimisticChangeRequest("p1", { title: "T", submit: true }, "u1").status,
		).toBe("submitted");
		expect(optimisticChangeRequest("p1", { title: "T" }, "u1").status).toBe(
			"draft",
		);
	});

	it("carries the fields the form supplied", () => {
		const draft = optimisticChangeRequest(
			"p1",
			{
				title: "Add OAuth",
				description: "Reduce signup friction",
				impact_scope: "One new feature",
				impact_timeline_days: 5,
				roadmap_id: "r1",
			},
			"u1",
		);
		expect(draft).toMatchObject({
			project_id: "p1",
			title: "Add OAuth",
			description: "Reduce signup friction",
			impact_scope: "One new feature",
			impact_timeline_days: 5,
			roadmap_id: "r1",
			requested_by: "u1",
		});
	});

	it("nulls absent optional fields rather than leaving them undefined", () => {
		const draft = optimisticChangeRequest("p1", { title: "T" }, null);
		expect(draft.description).toBeNull();
		expect(draft.impact_timeline_days).toBeNull();
		expect(draft.requested_by).toBeNull();
	});

	it("mints a distinct id each time", () => {
		const a = optimisticChangeRequest("p1", { title: "T" }, "u1");
		const b = optimisticChangeRequest("p1", { title: "T" }, "u1");
		expect(a.id).not.toBe(b.id);
	});
});
