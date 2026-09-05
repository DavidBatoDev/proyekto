import { describe, expect, it } from "vitest";
import type { KanbanBoardFilters } from "@/stores/roadmapStore";
import type { RoadmapTask } from "@/types/roadmap";
import { applyBoardFilters } from "./selectors";
import type { KanbanTaskContext } from "./types";

const NO_FILTERS: KanbanBoardFilters = {
	epicIds: [],
	featureIds: [],
	milestoneIds: [],
	assigneeIds: [],
};

function row(
	taskId: string,
	task: Partial<RoadmapTask> = {},
): KanbanTaskContext {
	return {
		task: { id: taskId, title: taskId, status: "todo", ...task },
		feature: { id: "f1", title: "f1" },
		epic: { id: "e1", title: "e1" },
		milestone: null,
	} as unknown as KanbanTaskContext;
}

const ids = (rows: KanbanTaskContext[]) => rows.map((r) => r.task.id);

describe("applyBoardFilters assignee filter", () => {
	const rows = [
		// Ana is the primary, Ben a co-assignee (join rows only).
		row("t-join", {
			assignee_id: "u-ana",
			assignees: [{ id: "u-ana" }, { id: "u-ben" }],
		}),
		// Explicit set on the task (the AI optimistic apply shape).
		row("t-ids", { assignee_id: "u-cid", assignee_ids: ["u-cid", "u-ben"] }),
		// Legacy primary-only row.
		row("t-legacy", { assignee_id: "u-dan" }),
		row("t-none"),
	];

	it("returns every row when no assignee is selected", () => {
		expect(ids(applyBoardFilters(rows, NO_FILTERS))).toEqual([
			"t-join",
			"t-ids",
			"t-legacy",
			"t-none",
		]);
	});

	it("matches a co-assignee, not just the primary column", () => {
		expect(
			ids(applyBoardFilters(rows, { ...NO_FILTERS, assigneeIds: ["u-ben"] })),
		).toEqual(["t-join", "t-ids"]);
	});

	it("still matches the primary and legacy primary-only rows", () => {
		expect(
			ids(applyBoardFilters(rows, { ...NO_FILTERS, assigneeIds: ["u-ana"] })),
		).toEqual(["t-join"]);
		expect(
			ids(applyBoardFilters(rows, { ...NO_FILTERS, assigneeIds: ["u-dan"] })),
		).toEqual(["t-legacy"]);
	});

	it("ors several selected assignees and drops unassigned rows", () => {
		expect(
			ids(
				applyBoardFilters(rows, {
					...NO_FILTERS,
					assigneeIds: ["u-ana", "u-dan"],
				}),
			),
		).toEqual(["t-join", "t-legacy"]);
	});
});
