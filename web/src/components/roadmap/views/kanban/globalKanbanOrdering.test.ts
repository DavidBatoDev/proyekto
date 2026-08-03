import { describe, expect, it } from "vitest";
import {
	groupGlobalRowsByStatus,
	moveGlobalTaskForDrag,
	roadmapTaskIds,
} from "./globalKanbanOrdering";
import type { KanbanTaskContext } from "./types";

function row(
	id: string,
	status: KanbanTaskContext["task"]["status"],
	boardOrder: number,
	roadmapId = "roadmap-1",
): KanbanTaskContext {
	return {
		task: {
			id,
			feature_id: "feature-1",
			title: id,
			status,
			priority: "medium",
			position: boardOrder,
			board_order: boardOrder,
			created_at: "2026-01-01T00:00:00.000Z",
			updated_at: "2026-01-01T00:00:00.000Z",
		},
		feature: {
			id: "feature-1",
			roadmap_id: roadmapId,
			epic_id: "epic-1",
			title: "Feature",
			position: 0,
			is_deliverable: false,
			created_at: "2026-01-01T00:00:00.000Z",
			updated_at: "2026-01-01T00:00:00.000Z",
		},
		epic: {
			id: "epic-1",
			roadmap_id: roadmapId,
			title: "Epic",
			priority: "medium",
			status: "backlog",
			position: 0,
			created_at: "2026-01-01T00:00:00.000Z",
			updated_at: "2026-01-01T00:00:00.000Z",
		},
		milestone: null,
		project: { id: "project-1", title: "Project" },
		roadmapId,
	};
}

describe("global Kanban ordering", () => {
	it("sorts server rows by the persisted board order", () => {
		const columns = groupGlobalRowsByStatus([
			row("task-3", "todo", 2),
			row("task-1", "todo", 0),
			row("task-2", "todo", 1),
		]);

		expect(columns.todo?.map((item) => item.task.id)).toEqual([
			"task-1",
			"task-2",
			"task-3",
		]);
	});

	it("reorders cards within the same column", () => {
		const columns = groupGlobalRowsByStatus([
			row("task-1", "todo", 0),
			row("task-2", "todo", 1),
			row("task-3", "todo", 2),
		]);

		const reordered = moveGlobalTaskForDrag(columns, "task-1", "task-3");

		expect(reordered.todo?.map((item) => item.task.id)).toEqual([
			"task-2",
			"task-3",
			"task-1",
		]);
	});

	it("builds a persistence order only for the task's roadmap", () => {
		const rows = [
			row("task-a", "todo", 0, "roadmap-1"),
			row("task-b", "todo", 0, "roadmap-2"),
			row("task-c", "todo", 1, "roadmap-1"),
		];

		expect(roadmapTaskIds(rows, "roadmap-1")).toEqual(["task-a", "task-c"]);
	});
});
