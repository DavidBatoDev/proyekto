import { describe, expect, it } from "vitest";
import type { Deliverable } from "@/services/delivery.service";
import {
	isOptimisticId,
	optimisticDeliverable,
	recomputeProgress,
	removeDeliverable,
	replaceDeliverable,
	resolveReviewOutcome,
	upsertDeliverable,
	withCriterionAdded,
	withCriterionRemoved,
	withCriterionToggled,
	withEvidenceAdded,
	withLinkRemoved,
	withReviewDecision,
	withReviewerAdded,
	withReviewerRemoved,
	withSubmitted,
} from "./deliverableCache";

const ME = "user-me";
const OTHER = "user-other";

function makeDeliverable(overrides: Partial<Deliverable> = {}): Deliverable {
	return {
		id: "d1",
		project_id: "p1",
		roadmap_id: null,
		title: "Backend API",
		description: null,
		acceptance_criteria: null,
		status: "in_progress",
		owner_id: null,
		due_date: null,
		position: 0,
		submitted_by: null,
		submitted_at: null,
		reviewed_by: null,
		reviewed_at: null,
		review_note: null,
		created_at: "2026-08-01T00:00:00.000Z",
		updated_at: "2026-08-01T00:00:00.000Z",
		links: [],
		attachments: [],
		criteria: [],
		reviewers: [],
		progress: {
			tasks_total: 0,
			tasks_done: 0,
			percent: null,
			criteria_total: 0,
			criteria_met: 0,
		},
		...overrides,
	};
}

function criterion(id: string, isMet = false) {
	return {
		id,
		deliverable_id: "d1",
		label: id,
		is_met: isMet,
		met_by: null,
		met_at: null,
		position: 0,
	};
}

function reviewer(
	reviewerId: string,
	decision: "pending" | "approved" | "changes_requested" = "pending",
) {
	return {
		id: `r-${reviewerId}`,
		deliverable_id: "d1",
		reviewer_id: reviewerId,
		decision,
		note: null,
		decided_at: decision === "pending" ? null : "2026-08-01T00:00:00.000Z",
		reviewer: null,
	};
}

describe("list membership", () => {
	it("appends an unknown deliverable and replaces a known one", () => {
		const a = makeDeliverable({ id: "a" });
		const b = makeDeliverable({ id: "b" });
		expect(upsertDeliverable([a], b).map((d) => d.id)).toEqual(["a", "b"]);
		expect(
			upsertDeliverable([a, b], { ...a, title: "Renamed" }).map((d) => d.title),
		).toEqual(["Renamed", "Backend API"]);
	});

	it("swaps a temp row for the real one in place, keeping its position", () => {
		const temp = makeDeliverable({ id: "temp-deliverable-1" });
		const other = makeDeliverable({ id: "z" });
		const real = makeDeliverable({ id: "real-1" });
		expect(
			replaceDeliverable([temp, other], temp.id, real).map((d) => d.id),
		).toEqual(["real-1", "z"]);
	});

	it("removes by id", () => {
		expect(removeDeliverable([makeDeliverable({ id: "a" })], "a")).toEqual([]);
	});
});

describe("recomputeProgress", () => {
	it("uses linked tasks when there are any, ignoring criteria", () => {
		const next = recomputeProgress(
			makeDeliverable({
				criteria: [criterion("c1", true), criterion("c2", true)],
				progress: {
					tasks_total: 4,
					tasks_done: 1,
					percent: 25,
					criteria_total: 2,
					criteria_met: 0,
				},
			}),
		);
		// 2/2 criteria met, but linked work is the measure: still 1/4.
		expect(next.progress?.percent).toBe(25);
		expect(next.progress?.criteria_met).toBe(2);
	});

	it("falls back to criteria when nothing is linked", () => {
		const next = recomputeProgress(
			makeDeliverable({
				criteria: [criterion("c1", true), criterion("c2"), criterion("c3")],
			}),
		);
		expect(next.progress?.percent).toBe(33);
	});

	it("is null when there is nothing to measure at all", () => {
		expect(recomputeProgress(makeDeliverable()).progress?.percent).toBeNull();
	});
});

describe("criteria", () => {
	it("adds an unmet criterion with a temp id and moves the meter", () => {
		const next = withCriterionAdded(makeDeliverable(), "Deployed");
		expect(next.criteria).toHaveLength(1);
		expect(isOptimisticId(next.criteria?.[0].id ?? "")).toBe(true);
		expect(next.progress?.percent).toBe(0);
	});

	it("stamps who ticked a criterion and clears the stamp on untick", () => {
		const base = makeDeliverable({ criteria: [criterion("c1")] });
		const ticked = withCriterionToggled(base, "c1", true, ME);
		expect(ticked.criteria?.[0].met_by).toBe(ME);
		expect(ticked.criteria?.[0].met_at).not.toBeNull();
		expect(ticked.progress?.percent).toBe(100);

		const unticked = withCriterionToggled(ticked, "c1", false, ME);
		expect(unticked.criteria?.[0].met_by).toBeNull();
		expect(unticked.criteria?.[0].met_at).toBeNull();
		expect(unticked.progress?.percent).toBe(0);
	});

	it("recomputes after a removal", () => {
		const base = makeDeliverable({
			criteria: [criterion("c1", true), criterion("c2")],
		});
		expect(withCriterionRemoved(base, "c2").progress?.percent).toBe(100);
	});
});

describe("reviewers", () => {
	it("adds a pending reviewer and ignores a duplicate", () => {
		const once = withReviewerAdded(makeDeliverable(), ME, null);
		expect(once.reviewers?.[0].decision).toBe("pending");
		expect(withReviewerAdded(once, ME, null).reviewers).toHaveLength(1);
	});

	it("removes by reviewer id, not row id", () => {
		const base = makeDeliverable({ reviewers: [reviewer(ME)] });
		expect(withReviewerRemoved(base, ME).reviewers).toEqual([]);
	});
});

// These mirror backend/src/modules/execution/delivery/deliverable-review.spec.ts.
// If one side changes, this file should fail.
describe("resolveReviewOutcome", () => {
	it("accepts only when every reviewer has approved", () => {
		expect(
			resolveReviewOutcome([
				{ decision: "approved" },
				{ decision: "approved" },
			]),
		).toBe("approved");
		expect(
			resolveReviewOutcome([{ decision: "approved" }, { decision: "pending" }]),
		).toBe("in_review");
	});

	it("lets one objection outweigh any number of approvals", () => {
		expect(
			resolveReviewOutcome([
				{ decision: "approved" },
				{ decision: "approved" },
				{ decision: "changes_requested" },
			]),
		).toBe("changes_requested");
	});

	it("stays in review with nobody named", () => {
		expect(resolveReviewOutcome([])).toBe("in_review");
	});
});

describe("withReviewDecision", () => {
	it("keeps the deliverable in review while a second sign-off is owed", () => {
		const base = makeDeliverable({
			status: "in_review",
			reviewers: [reviewer(ME), reviewer(OTHER)],
		});
		const next = withReviewDecision(base, ME, "approved");
		expect(next.status).toBe("in_review");
		expect(next.reviewers?.find((r) => r.reviewer_id === ME)?.decision).toBe(
			"approved",
		);
		expect(next.reviewers?.find((r) => r.reviewer_id === OTHER)?.decision).toBe(
			"pending",
		);
		// No stamps until the deliverable itself moves — the DB CHECK ties them
		// to a non-in_review status.
		expect(next.reviewed_at).toBeNull();
	});

	it("accepts once the last reviewer approves, stamping who decided", () => {
		const base = makeDeliverable({
			status: "in_review",
			reviewers: [reviewer(OTHER, "approved"), reviewer(ME)],
		});
		const next = withReviewDecision(base, ME, "approved");
		expect(next.status).toBe("approved");
		expect(next.reviewed_by).toBe(ME);
		expect(next.reviewed_at).not.toBeNull();
	});

	it("bounces on changes requested and keeps the note", () => {
		const base = makeDeliverable({
			status: "in_review",
			reviewers: [reviewer(OTHER, "approved"), reviewer(ME)],
		});
		const next = withReviewDecision(
			base,
			ME,
			"changes_requested",
			"Needs docs",
		);
		expect(next.status).toBe("changes_requested");
		expect(next.review_note).toBe("Needs docs");
	});

	it("decides outright when nobody is named", () => {
		const base = makeDeliverable({ status: "in_review", reviewers: [] });
		const next = withReviewDecision(base, ME, "approved");
		expect(next.status).toBe("approved");
		expect(next.reviewed_by).toBe(ME);
	});
});

describe("withSubmitted", () => {
	it("moves to in review and clears every prior decision", () => {
		const base = makeDeliverable({
			status: "changes_requested",
			reviewers: [
				reviewer(ME, "approved"),
				reviewer(OTHER, "changes_requested"),
			],
		});
		const next = withSubmitted(base, ME);
		expect(next.status).toBe("in_review");
		expect(next.submitted_by).toBe(ME);
		expect(next.reviewers?.every((r) => r.decision === "pending")).toBe(true);
		expect(next.reviewers?.every((r) => r.decided_at === null)).toBe(true);
	});
});

describe("evidence and links", () => {
	it("adds evidence with the given category, defaulting to other", () => {
		const next = withEvidenceAdded(makeDeliverable(), {
			url: "https://example.test",
		});
		expect(next.attachments?.[0].category).toBe("other");
		expect(next.attachments?.[0].kind).toBe("link");
	});

	it("removes a link without touching progress", () => {
		const base = makeDeliverable({
			links: [
				{
					id: "l1",
					feature_id: "f1",
					task_id: null,
					milestone_id: null,
					position: 0,
				},
			],
			progress: {
				tasks_total: 3,
				tasks_done: 3,
				percent: 100,
				criteria_total: 0,
				criteria_met: 0,
			},
		});
		const next = withLinkRemoved(base, "l1");
		expect(next.links).toEqual([]);
		// Still 100 until the server recounts — the client can't expand features.
		expect(next.progress?.percent).toBe(100);
	});
});

describe("optimisticDeliverable", () => {
	it("builds a temp row carrying its criteria and due date", () => {
		const draft = optimisticDeliverable("p1", {
			title: "Backend API",
			due_date: "2026-09-01",
			criteria: ["Deployed", "Documented"],
		});
		expect(isOptimisticId(draft.id)).toBe(true);
		expect(draft.status).toBe("not_started");
		expect(draft.criteria).toHaveLength(2);
		expect(draft.progress?.percent).toBe(0);
		expect(draft.due_date).toBe("2026-09-01");
	});
});
