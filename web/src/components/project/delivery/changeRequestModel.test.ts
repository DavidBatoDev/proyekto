import { describe, expect, it } from "vitest";
import type {
	ChangeRequest,
	ChangeRequestLink,
	ChangeRequestStatus,
} from "@/services/delivery.service";
import {
	awaitingLongest,
	CHANGE_REQUEST_STATUS_LABEL,
	changeRequestReference,
	crLinkSegments,
	crPipelineColumnFor,
	daysWaiting,
	summarizeChangeRequests,
	timelineImpact,
} from "./changeRequestModel";

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

const link = (overrides: Partial<ChangeRequestLink>): ChangeRequestLink => ({
	id: "l1",
	epic_id: null,
	feature_id: null,
	task_id: null,
	deliverable_id: null,
	position: 0,
	...overrides,
});

describe("crPipelineColumnFor", () => {
	// A bounced request belongs where the work is, which is back with its author.
	it("puts changes_requested back in Draft", () => {
		expect(crPipelineColumnFor("changes_requested")).toBe("draft");
	});

	it.each(["draft", "submitted", "approved", "applied"] as const)(
		"maps %s to its own column",
		(status) => {
			expect(crPipelineColumnFor(status)).toBe(status);
		},
	);

	// Endings, not stages — giving them board columns makes a healthy project
	// look half-failed.
	it.each(["rejected", "withdrawn"] as const)(
		"keeps %s off the board entirely",
		(status) => {
			expect(crPipelineColumnFor(status)).toBeNull();
		},
	);
});

describe("summarizeChangeRequests", () => {
	it("reports nothing for an empty list without dividing by zero", () => {
		const stats = summarizeChangeRequests([]);
		expect(stats.total).toBe(0);
		expect(stats.decidedPercent).toBeNull();
	});

	it("groups changes_requested with draft, since that is where the work is", () => {
		const stats = summarizeChangeRequests([
			cr({ id: "a", status: "draft" }),
			cr({ id: "b", status: "changes_requested" }),
		]);
		expect(stats.draft).toBe(2);
	});

	// The load-bearing separation: an applied request's days are already in the
	// roadmap's own dates, so summing the two and comparing to today's schedule
	// would count them twice.
	it("keeps committed and pending schedule impact apart", () => {
		const stats = summarizeChangeRequests([
			cr({ id: "a", status: "applied", impact_timeline_days: 14 }),
			cr({ id: "b", status: "approved", impact_timeline_days: 7 }),
			// Neither counts: not yet decided, and never will be.
			cr({ id: "c", status: "submitted", impact_timeline_days: 100 }),
			cr({ id: "d", status: "rejected", impact_timeline_days: 100 }),
		]);
		expect(stats.committedTimelineDays).toBe(14);
		expect(stats.pendingTimelineDays).toBe(7);
	});

	it("treats a missing day delta as zero rather than NaN", () => {
		const stats = summarizeChangeRequests([
			cr({ id: "a", status: "applied", impact_timeline_days: null }),
			cr({ id: "b", status: "applied", impact_timeline_days: 3 }),
		]);
		expect(stats.committedTimelineDays).toBe(3);
	});

	it("sums a negative delta, which pulls the schedule in", () => {
		const stats = summarizeChangeRequests([
			cr({ id: "a", status: "applied", impact_timeline_days: 10 }),
			cr({ id: "b", status: "applied", impact_timeline_days: -4 }),
		]);
		expect(stats.committedTimelineDays).toBe(6);
	});

	// Withdrawn requests never reached a decision, so counting them as undecided
	// would make a tidy project look permanently behind on its approvals.
	it("excludes withdrawn from the decided denominator", () => {
		const stats = summarizeChangeRequests([
			cr({ id: "a", status: "approved" }),
			cr({ id: "b", status: "withdrawn" }),
		]);
		expect(stats.decidedPercent).toBe(100);
		expect(stats.closed).toBe(1);
	});

	it("counts applied as decided", () => {
		const stats = summarizeChangeRequests([
			cr({ id: "a", status: "applied" }),
			cr({ id: "b", status: "submitted" }),
		]);
		expect(stats.decidedPercent).toBe(50);
	});

	it("counts rejected and withdrawn together as closed", () => {
		const stats = summarizeChangeRequests([
			cr({ id: "a", status: "rejected" }),
			cr({ id: "b", status: "withdrawn" }),
		]);
		expect(stats.closed).toBe(2);
	});
});

describe("timelineImpact", () => {
	it("distinguishes no estimate from an explicit zero", () => {
		expect(timelineImpact(null)).toBeNull();
		expect(timelineImpact(0)).toBe("No timeline change");
	});

	it("signs a slip and singularises one day", () => {
		expect(timelineImpact(5)).toBe("+5 days");
		expect(timelineImpact(1)).toBe("+1 day");
	});

	// A negative delta reads as "earlier", never as "-5 days", which a reader
	// would have to stop and interpret.
	it("says earlier rather than showing a minus sign", () => {
		expect(timelineImpact(-5)).toBe("5 days earlier");
		expect(timelineImpact(-1)).toBe("1 day earlier");
	});
});

describe("changeRequestReference", () => {
	it("pads to three digits", () => {
		expect(changeRequestReference(cr({ reference: 14 }))).toBe("CR-014");
		expect(changeRequestReference(cr({ reference: 1 }))).toBe("CR-001");
	});

	it("does not invent a number for an unsaved row", () => {
		// The server allocates from max(reference)+1, so a draft cannot know it.
		expect(changeRequestReference(cr({ reference: 0 }))).toBe("CR-—");
	});

	it("does not truncate a reference past three digits", () => {
		expect(changeRequestReference(cr({ reference: 1234 }))).toBe("CR-1234");
	});
});

describe("crLinkSegments", () => {
	it("builds the full trail from a task", () => {
		const segments = crLinkSegments(
			link({
				task_id: "t1",
				task: {
					id: "t1",
					title: "Callback endpoint",
					status: "todo",
					feature: {
						id: "f1",
						title: "Google OAuth",
						status: "in_progress",
						epic: { id: "e1", title: "Authentication", status: "in_progress" },
					},
				},
			}),
		);
		expect(segments.map((s) => s.title)).toEqual([
			"Authentication",
			"Google OAuth",
			"Callback endpoint",
		]);
		expect(segments.map((s) => s.kind)).toEqual(["epic", "feature", "task"]);
	});

	it("handles an epic linked directly, which deliverables cannot do", () => {
		const segments = crLinkSegments(
			link({
				epic_id: "e1",
				epic: { id: "e1", title: "Authentication", status: "todo" },
			}),
		);
		expect(segments).toEqual([{ kind: "epic", title: "Authentication" }]);
	});

	it("renders a linked deliverable rather than dropping it", () => {
		const segments = crLinkSegments(
			link({
				deliverable_id: "d1",
				deliverable: { id: "d1", title: "Auth Module", status: "in_review" },
			}),
		);
		expect(segments.map((s) => s.title)).toEqual(["Auth Module"]);
	});

	// A deleted target, or an older payload without embedded parents: render
	// nothing rather than "undefined".
	it("returns no segments when parents were not embedded", () => {
		expect(crLinkSegments(link({ feature_id: "f1" }))).toEqual([]);
	});

	it("omits a missing ancestor instead of leaving a gap", () => {
		const segments = crLinkSegments(
			link({
				feature_id: "f1",
				feature: {
					id: "f1",
					title: "Google OAuth",
					status: "todo",
					epic: null,
				},
			}),
		);
		expect(segments).toEqual([{ kind: "feature", title: "Google OAuth" }]);
	});
});

describe("awaitingLongest", () => {
	it("returns only submitted requests, longest-waiting first", () => {
		const list = [
			cr({
				id: "new",
				status: "submitted",
				updated_at: "2026-08-10T00:00:00Z",
			}),
			cr({
				id: "old",
				status: "submitted",
				updated_at: "2026-08-01T00:00:00Z",
			}),
			cr({ id: "draft", status: "draft", updated_at: "2026-07-01T00:00:00Z" }),
			cr({
				id: "done",
				status: "approved",
				updated_at: "2026-07-01T00:00:00Z",
			}),
		];
		expect(awaitingLongest(list).map((r) => r.id)).toEqual(["old", "new"]);
	});

	it("respects the limit", () => {
		const list = Array.from({ length: 6 }, (_, i) =>
			cr({
				id: `cr-${i}`,
				status: "submitted" as ChangeRequestStatus,
				updated_at: `2026-08-0${i + 1}T00:00:00Z`,
			}),
		);
		expect(awaitingLongest(list, 2)).toHaveLength(2);
	});

	it("does not mutate the list it was given", () => {
		const list = [
			cr({ id: "b", status: "submitted", updated_at: "2026-08-10T00:00:00Z" }),
			cr({ id: "a", status: "submitted", updated_at: "2026-08-01T00:00:00Z" }),
		];
		awaitingLongest(list);
		expect(list.map((r) => r.id)).toEqual(["b", "a"]);
	});
});

describe("daysWaiting", () => {
	const now = Date.parse("2026-08-17T00:00:00Z");

	it("counts whole days since the last movement", () => {
		expect(daysWaiting(cr({ updated_at: "2026-08-10T00:00:00Z" }), now)).toBe(
			7,
		);
	});

	it("floors a partial day to zero rather than rounding up to one", () => {
		expect(daysWaiting(cr({ updated_at: "2026-08-16T18:00:00Z" }), now)).toBe(
			0,
		);
	});

	// Clock skew between client and server should not render "-1 days".
	it("never returns a negative age", () => {
		expect(daysWaiting(cr({ updated_at: "2026-09-01T00:00:00Z" }), now)).toBe(
			0,
		);
	});

	it("returns zero for an unparseable timestamp", () => {
		expect(daysWaiting(cr({ updated_at: "not a date" }), now)).toBe(0);
	});
});

describe("CHANGE_REQUEST_STATUS_LABEL", () => {
	// `submitted` is stored, but "Submitted" tells the reader nothing about who
	// owes what — the label names the state the request is actually in.
	it("labels submitted as awaiting a decision", () => {
		expect(CHANGE_REQUEST_STATUS_LABEL.submitted).toBe("Awaiting decision");
	});

	it("covers every status", () => {
		const statuses: ChangeRequestStatus[] = [
			"draft",
			"submitted",
			"approved",
			"rejected",
			"changes_requested",
			"withdrawn",
			"applied",
		];
		for (const status of statuses) {
			expect(CHANGE_REQUEST_STATUS_LABEL[status]).toBeTruthy();
		}
	});
});
