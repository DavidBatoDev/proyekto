import { describe, expect, it } from "vitest";
import type { Deliverable, RiskEntry } from "@/services/delivery.service";
import type { Roadmap } from "@/types/roadmap";
import { deriveProjectHealth } from "./projectHealth";

// Fixtures are shaped only as far as deriveProjectHealth reads them; the real
// types carry far more, so each cast is narrowed at the boundary rather than
// forcing the whole object to be built.
const roadmap = (options: {
	tasks?: Array<{ status: string }>;
	blockedFeatures?: number;
	milestones?: Array<{
		id: string;
		status: string;
		target_date: string;
		title?: string;
	}>;
}): Roadmap =>
	({
		epics: [
			{
				features: [
					{
						status: "in_progress",
						tasks: options.tasks ?? [],
					},
					...Array.from({ length: options.blockedFeatures ?? 0 }, () => ({
						status: "blocked",
						tasks: [],
					})),
				],
			},
		],
		milestones: options.milestones ?? [],
	}) as unknown as Roadmap;

const PAST = "2020-01-01T00:00:00.000Z";
const FUTURE = "2999-01-01T00:00:00.000Z";

const deliverable = (status: string) => ({ status }) as unknown as Deliverable;
const risk = (severity: string, status = "open") =>
	({ severity, status }) as unknown as RiskEntry;

describe("progress", () => {
	it("counts completed tasks", () => {
		const health = deriveProjectHealth(
			roadmap({
				tasks: [
					{ status: "done" },
					{ status: "done" },
					{ status: "todo" },
					{ status: "in_progress" },
				],
			}),
		);
		expect(health.tasksDone).toBe(2);
		expect(health.tasksTotal).toBe(4);
		expect(health.progressPct).toBe(50);
	});

	it("reports null rather than 0% when there is nothing to count", () => {
		expect(deriveProjectHealth(roadmap({})).progressPct).toBeNull();
	});

	it("survives a null roadmap", () => {
		const health = deriveProjectHealth(null);
		expect(health.verdict).toBe("on_track");
		expect(health.progressPct).toBeNull();
	});
});

describe("verdict", () => {
	it("is on_track with nothing wrong", () => {
		const health = deriveProjectHealth(
			roadmap({
				tasks: [{ status: "done" }],
				milestones: [{ id: "m1", status: "in_progress", target_date: FUTURE }],
			}),
		);
		expect(health.verdict).toBe("on_track");
	});

	it("is at_risk when work is blocked", () => {
		const health = deriveProjectHealth(
			roadmap({ tasks: [{ status: "blocked" }, { status: "todo" }] }),
		);
		expect(health.verdict).toBe("at_risk");
		expect(health.blockedCount).toBe(1);
		expect(health.reasons).toContain("1 item blocked");
	});

	it("counts blocked features alongside blocked tasks", () => {
		const health = deriveProjectHealth(
			roadmap({ tasks: [{ status: "blocked" }], blockedFeatures: 2 }),
		);
		expect(health.blockedCount).toBe(3);
	});

	it("is off_track when a milestone is past its target", () => {
		const health = deriveProjectHealth(
			roadmap({
				milestones: [{ id: "m1", status: "open", target_date: PAST }],
			}),
		);
		expect(health.verdict).toBe("off_track");
		expect(health.overdueMilestones).toBe(1);
	});

	it("does not count a completed milestone as overdue", () => {
		const health = deriveProjectHealth(
			roadmap({
				milestones: [{ id: "m1", status: "completed", target_date: PAST }],
			}),
		);
		expect(health.verdict).toBe("on_track");
		expect(health.overdueMilestones).toBe(0);
	});

	it("is off_track on an open critical risk", () => {
		const health = deriveProjectHealth(roadmap({}), [], [risk("critical")]);
		expect(health.verdict).toBe("off_track");
	});

	it("ignores risks that are already resolved or accepted", () => {
		const health = deriveProjectHealth(
			roadmap({}),
			[],
			[risk("critical", "resolved"), risk("high", "accepted")],
		);
		expect(health.verdict).toBe("on_track");
	});

	// off_track must win over at_risk, and still surface the lesser problems.
	it("keeps off_track when blocked work is also present", () => {
		const health = deriveProjectHealth(
			roadmap({
				tasks: [{ status: "blocked" }],
				milestones: [{ id: "m1", status: "open", target_date: PAST }],
			}),
		);
		expect(health.verdict).toBe("off_track");
		expect(health.reasons).toContain("1 item blocked");
	});

	it("always explains itself", () => {
		expect(deriveProjectHealth(roadmap({})).reasons.length).toBeGreaterThan(0);
	});
});

describe("milestones and approvals", () => {
	it("prefers an in_progress milestone as current", () => {
		const health = deriveProjectHealth(
			roadmap({
				milestones: [
					{ id: "a", status: "not_started", target_date: FUTURE },
					{ id: "b", status: "in_progress", target_date: FUTURE },
				],
			}),
		);
		expect(health.currentMilestone?.id).toBe("b");
		expect(health.nextMilestone?.id).toBe("a");
	});

	it("counts only deliverables awaiting a decision", () => {
		const health = deriveProjectHealth(roadmap({}), [
			deliverable("in_review"),
			deliverable("in_review"),
			deliverable("approved"),
			deliverable("in_progress"),
		]);
		expect(health.pendingApprovals).toBe(2);
	});
});
