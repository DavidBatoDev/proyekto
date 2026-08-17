import { describe, expect, it } from "vitest";
import type { Deliverable, DeliverableLink } from "@/services/delivery.service";
import {
	linkSegments,
	linkTrail,
	pipelineColumnFor,
	signOffSummary,
	summarize,
	upcomingDeliveries,
} from "./deliveryModel";

const deliverable = (partial: Partial<Deliverable>): Deliverable =>
	({ id: "d1", status: "not_started", ...partial }) as Deliverable;

describe("pipelineColumnFor", () => {
	// Bounced work is still work in progress — giving it its own column would
	// imply a stage that the status enum doesn't have.
	it("files changes_requested under In progress", () => {
		expect(pipelineColumnFor("changes_requested")).toBe("in_progress");
	});

	it.each(["not_started", "in_progress", "in_review", "approved"] as const)(
		"maps %s to its own column",
		(status) => {
			expect(pipelineColumnFor(status)).toBe(status);
		},
	);
});

describe("summarize", () => {
	it("reports acceptance as a share of everything planned", () => {
		const stats = summarize([
			deliverable({ status: "approved" }),
			deliverable({ status: "approved" }),
			deliverable({ status: "in_review" }),
			deliverable({ status: "not_started" }),
		]);
		expect(stats.total).toBe(4);
		expect(stats.accepted).toBe(2);
		expect(stats.acceptedPercent).toBe(50);
	});

	it("returns null, not 0%, when nothing is planned", () => {
		expect(summarize([]).acceptedPercent).toBeNull();
	});

	it("counts changes_requested separately from in_progress", () => {
		const stats = summarize([
			deliverable({ status: "changes_requested" }),
			deliverable({ status: "in_progress" }),
		]);
		expect(stats.changesRequested).toBe(1);
		expect(stats.inProgress).toBe(1);
	});
});

describe("signOffSummary", () => {
	it("is null when nobody is named", () => {
		expect(signOffSummary(deliverable({ reviewers: [] }))).toBeNull();
	});

	it("counts approvals and who is still owed", () => {
		const summary = signOffSummary(
			deliverable({
				reviewers: [
					{ decision: "approved" },
					{ decision: "pending" },
					{ decision: "pending" },
				],
			} as Partial<Deliverable>),
		);
		expect(summary?.label).toBe("1 of 3 sign-offs");
		expect(summary?.pending).toBe(2);
	});

	it("singularises a lone reviewer", () => {
		const summary = signOffSummary(
			deliverable({
				reviewers: [{ decision: "pending" }],
			} as Partial<Deliverable>),
		);
		expect(summary?.label).toBe("0 of 1 sign-off");
	});
});

describe("linkTrail", () => {
	it("builds Epic → Feature → Task for a task link", () => {
		const link = {
			task: {
				id: "t",
				title: "Login API",
				status: "done",
				feature: {
					id: "f",
					title: "Email auth",
					status: "in_progress",
					epic: { id: "e", title: "Authentication", status: "in_progress" },
				},
			},
		} as DeliverableLink;
		expect(linkTrail(link)).toEqual([
			"Authentication",
			"Email auth",
			"Login API",
		]);
	});

	it("omits missing ancestors rather than rendering blanks", () => {
		const link = {
			feature: { id: "f", title: "Orphan feature", status: "in_progress" },
		} as DeliverableLink;
		expect(linkTrail(link)).toEqual(["Orphan feature"]);
	});

	// A link whose target was deleted arrives with no embedded parent; callers
	// need null so they render nothing instead of "undefined".
	it("returns null when nothing was embedded", () => {
		expect(linkTrail({ id: "l", position: 0 } as DeliverableLink)).toBeNull();
	});
});

describe("upcomingDeliveries", () => {
	it("sorts by due date and drops accepted work", () => {
		const upcoming = upcomingDeliveries([
			deliverable({ id: "late", due_date: "2026-09-01" }),
			deliverable({ id: "done", due_date: "2026-08-01", status: "approved" }),
			deliverable({ id: "soon", due_date: "2026-08-20" }),
			deliverable({ id: "undated" }),
		]);
		expect(upcoming.map((d) => d.id)).toEqual(["soon", "late"]);
	});
});

describe("linkSegments", () => {
	it("tags each level of a task trail with its kind, outermost first", () => {
		const link = {
			id: "l1",
			feature_id: null,
			task_id: "t",
			milestone_id: null,
			position: 0,
			task: {
				id: "t",
				title: "Login API",
				status: "done",
				feature: {
					id: "f",
					title: "Auth",
					status: "in_progress",
					epic: { id: "e", title: "Platform", status: "in_progress" },
				},
			},
		} as DeliverableLink;

		expect(linkSegments(link)).toEqual([
			{ kind: "epic", title: "Platform" },
			{ kind: "feature", title: "Auth" },
			{ kind: "task", title: "Login API" },
		]);
	});

	it("drops levels whose parents were not embedded", () => {
		const link = {
			id: "l2",
			feature_id: "f",
			task_id: null,
			milestone_id: null,
			position: 0,
			feature: { id: "f", title: "Auth", status: "in_progress", epic: null },
		} as DeliverableLink;

		expect(linkSegments(link)).toEqual([{ kind: "feature", title: "Auth" }]);
	});

	it("returns a single milestone segment", () => {
		const link = {
			id: "l3",
			feature_id: null,
			task_id: null,
			milestone_id: "m",
			position: 0,
			milestone: {
				id: "m",
				title: "Beta",
				status: "planned",
				target_date: null,
			},
		} as DeliverableLink;

		expect(linkSegments(link)).toEqual([{ kind: "milestone", title: "Beta" }]);
	});

	it("is empty when nothing was embedded, so the row renders nothing", () => {
		expect(
			linkSegments({
				id: "l4",
				feature_id: null,
				task_id: null,
				milestone_id: null,
				position: 0,
			} as DeliverableLink),
		).toEqual([]);
	});
});
