import { describe, expect, it } from "vitest";
import type { Roadmap, RoadmapTask } from "@/types/roadmap";
import { buildRoadmapJsonDocument } from "./roadmapJsonDocument";

const ana = { id: "u-ana", display_name: "Ana" };
const ben = { id: "u-ben", display_name: "Ben" };

const task = (overrides: Partial<RoadmapTask> = {}): RoadmapTask => ({
	id: "t-1",
	feature_id: "f-1",
	title: "Task",
	status: "todo",
	priority: "medium",
	position: 0,
	board_order: 0,
	created_at: "2026-01-01T00:00:00.000Z",
	updated_at: "2026-01-01T00:00:00.000Z",
	...overrides,
});

const roadmapWith = (tasks: RoadmapTask[]): Roadmap => ({
	id: "r-1",
	project_id: null,
	name: "Roadmap",
	owner_id: "u-owner",
	status: "draft",
	created_at: "2026-01-01T00:00:00.000Z",
	updated_at: "2026-01-01T00:00:00.000Z",
	epics: [
		{
			id: "e-1",
			roadmap_id: "r-1",
			title: "Epic",
			priority: "medium",
			status: "backlog",
			position: 0,
			created_at: "2026-01-01T00:00:00.000Z",
			updated_at: "2026-01-01T00:00:00.000Z",
			features: [
				{
					id: "f-1",
					roadmap_id: "r-1",
					epic_id: "e-1",
					title: "Feature",
					position: 0,
					is_deliverable: true,
					status: "not_started",
					created_at: "2026-01-01T00:00:00.000Z",
					updated_at: "2026-01-01T00:00:00.000Z",
					tasks,
				},
			],
		},
	],
});

/** What the panel actually shows: the document after JSON serialisation. */
const serializedTasks = (roadmap: Roadmap): Record<string, unknown>[] =>
	JSON.parse(JSON.stringify(buildRoadmapJsonDocument(roadmap))).roadmap_epics[0]
		.roadmap_features[0].roadmap_tasks;

describe("buildRoadmapJsonDocument (task assignees)", () => {
	it("emits only assignee_ids for an assigned task, never assignee_id", () => {
		const [emitted] = serializedTasks(
			roadmapWith([
				task({
					assignee_ids: ["u-ana", "u-ben"],
					assignees: [ana, ben],
					assignee_id: "u-ana",
					assignee: ana,
				}),
			]),
		);
		expect(emitted).toEqual({
			id: "t-1",
			title: "Task",
			status: "todo",
			priority: "medium",
			position: 0,
			assignee_ids: ["u-ana", "u-ben"],
		});
		expect(Object.keys(emitted)).not.toContain("assignee_id");
	});

	it("derives the set from the join rows or the legacy column when assignee_ids is missing", () => {
		const [fromRows, fromColumn] = serializedTasks(
			roadmapWith([
				task({ id: "t-1", assignees: [ben, ana], assignee_id: "u-ben" }),
				task({ id: "t-2", assignee_id: "u-ana" }),
			]),
		);
		expect(fromRows.assignee_ids).toEqual(["u-ben", "u-ana"]);
		expect(fromColumn.assignee_ids).toEqual(["u-ana"]);
		expect(Object.keys(fromRows)).not.toContain("assignee_id");
		expect(Object.keys(fromColumn)).not.toContain("assignee_id");
	});

	it("omits both assignee fields for an unassigned task so a hand-written assignee_id still applies on save", () => {
		const [emitted] = serializedTasks(roadmapWith([task()]));
		expect(Object.keys(emitted)).not.toContain("assignee_ids");
		expect(Object.keys(emitted)).not.toContain("assignee_id");
	});
});
