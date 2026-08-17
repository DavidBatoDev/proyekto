import type { Deliverable, RiskEntry } from "@/services/delivery.service";
import type { Roadmap, RoadmapMilestone } from "@/types/roadmap";
import { isPastDate } from "./utils";

/**
 * Derives the Overview health summary.
 *
 * Deliberately pure and separate from the page: a health badge is only useful
 * if it can account for itself, so every verdict carries the `reasons` that
 * produced it and the page discloses them. A free-text status field would be
 * cheaper and would get ignored.
 *
 * Execution only — nothing here reads budget, cost, or contract value. Those
 * live in the consultant-only finance surface.
 */

export type HealthVerdict = "on_track" | "at_risk" | "off_track";

export interface ProjectHealth {
	verdict: HealthVerdict;
	/** Plain-language inputs behind the verdict, strongest first. */
	reasons: string[];
	/** Completed share of all tasks, 0-100. Null when there is nothing to count. */
	progressPct: number | null;
	tasksDone: number;
	tasksTotal: number;
	blockedCount: number;
	/** Deliverables sitting in review, waiting on someone to accept them. */
	pendingApprovals: number;
	currentMilestone: RoadmapMilestone | null;
	nextMilestone: RoadmapMilestone | null;
	overdueMilestones: number;
}

const plural = (count: number, one: string, many = `${one}s`) =>
	`${count} ${count === 1 ? one : many}`;

/** A milestone is overdue when its target has passed and it never completed. */
function isOverdue(milestone: RoadmapMilestone): boolean {
	if (milestone.status === "completed") return false;
	if (milestone.status === "missed") return true;
	return isPastDate(milestone.target_date);
}

export function deriveProjectHealth(
	roadmap: Roadmap | null | undefined,
	deliverables: Deliverable[] = [],
	risks: RiskEntry[] = [],
): ProjectHealth {
	let tasksTotal = 0;
	let tasksDone = 0;
	let blockedCount = 0;

	for (const epic of roadmap?.epics ?? []) {
		for (const feature of epic.features ?? []) {
			if (feature.status === "blocked") blockedCount += 1;
			for (const task of feature.tasks ?? []) {
				tasksTotal += 1;
				if (task.status === "done") tasksDone += 1;
				if (task.status === "blocked") blockedCount += 1;
			}
		}
	}

	const milestones = [...(roadmap?.milestones ?? [])].sort(
		(a, b) =>
			new Date(a.target_date).getTime() - new Date(b.target_date).getTime(),
	);

	const overdue = milestones.filter(isOverdue);
	// "Current" is the one being worked; failing that, the earliest still open.
	const currentMilestone =
		milestones.find((m) => m.status === "in_progress") ??
		milestones.find((m) => m.status !== "completed") ??
		null;
	const nextMilestone =
		milestones.find(
			(m) => m.status !== "completed" && m.id !== currentMilestone?.id,
		) ?? null;

	const pendingApprovals = deliverables.filter(
		(d) => d.status === "in_review",
	).length;

	const openRisks = risks.filter(
		(r) => !["resolved", "closed", "accepted"].includes(r.status),
	);
	const criticalRisks = openRisks.filter((r) => r.severity === "critical");
	const highRisks = openRisks.filter((r) => r.severity === "high");

	// Ordered strongest-first so the page can show the headline reason.
	const reasons: string[] = [];
	let verdict: HealthVerdict = "on_track";

	if (overdue.length > 0) {
		verdict = "off_track";
		reasons.push(`${plural(overdue.length, "milestone")} past its target date`);
	}
	if (criticalRisks.length > 0) {
		verdict = "off_track";
		reasons.push(`${plural(criticalRisks.length, "critical risk")} open`);
	}

	if (verdict !== "off_track") {
		if (blockedCount > 0) {
			verdict = "at_risk";
			reasons.push(`${plural(blockedCount, "item")} blocked`);
		}
		if (highRisks.length > 0) {
			verdict = "at_risk";
			reasons.push(`${plural(highRisks.length, "high risk")} open`);
		}
		if (milestones.some((m) => m.status === "at_risk")) {
			verdict = "at_risk";
			const count = milestones.filter((m) => m.status === "at_risk").length;
			reasons.push(`${plural(count, "milestone")} flagged at risk`);
		}
	} else {
		// Still worth listing, just not what decided the verdict.
		if (blockedCount > 0)
			reasons.push(`${plural(blockedCount, "item")} blocked`);
		if (highRisks.length > 0) {
			reasons.push(`${plural(highRisks.length, "high risk")} open`);
		}
	}

	if (reasons.length === 0) {
		reasons.push(
			milestones.length > 0 || tasksTotal > 0
				? "No overdue milestones, blocked work, or open high risks"
				: "Not enough planned work to assess yet",
		);
	}

	return {
		verdict,
		reasons,
		progressPct:
			tasksTotal > 0 ? Math.round((tasksDone / tasksTotal) * 100) : null,
		tasksDone,
		tasksTotal,
		blockedCount,
		pendingApprovals,
		currentMilestone,
		nextMilestone,
		overdueMilestones: overdue.length,
	};
}

export const HEALTH_LABEL: Record<HealthVerdict, string> = {
	on_track: "On track",
	at_risk: "At risk",
	off_track: "Off track",
};
