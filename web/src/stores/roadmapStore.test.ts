/* @vitest-environment jsdom */

import { beforeEach, describe, expect, it } from "vitest";
import type {
	AgentCommitImpactedItem,
	AgentOperation,
} from "@/services/roadmap-agent.service";
import type {
	AssigneeProfile,
	Roadmap,
	RoadmapEpic,
	RoadmapFeature,
	RoadmapTask,
} from "@/types/roadmap";
import { useRoadmapStore } from "./roadmapStore";

const ana: AssigneeProfile = { id: "u-ana", display_name: "Ana" };
const ben: AssigneeProfile = { id: "u-ben", display_name: "Ben" };

const makeTask = (overrides: Partial<RoadmapTask> = {}): RoadmapTask => ({
	id: "task-1",
	feature_id: "feature-1",
	title: "Ship it",
	status: "todo",
	priority: "medium",
	position: 0,
	board_order: 0,
	created_at: "2026-01-01T00:00:00.000Z",
	updated_at: "2026-01-01T00:00:00.000Z",
	assignee_id: "u-ana",
	assignee: ana,
	assignee_ids: ["u-ana", "u-ben"],
	assignees: [ana, ben],
	...overrides,
});

const seed = (task: RoadmapTask = makeTask()) => {
	const feature: RoadmapFeature = {
		id: "feature-1",
		roadmap_id: "rm-1",
		epic_id: "epic-1",
		title: "Feature",
		description: "",
		position: 0,
		is_deliverable: false,
		status: "not_started",
		created_at: "2026-01-01T00:00:00.000Z",
		updated_at: "2026-01-01T00:00:00.000Z",
		tasks: [task],
	};
	const epic: RoadmapEpic = {
		id: "epic-1",
		roadmap_id: "rm-1",
		title: "Epic",
		description: "",
		priority: "medium",
		status: "planned",
		position: 0,
		created_at: "2026-01-01T00:00:00.000Z",
		updated_at: "2026-01-01T00:00:00.000Z",
		features: [feature],
	};
	useRoadmapStore.setState({
		roadmap: { id: "rm-1", name: "Roadmap" } as unknown as Roadmap,
		epics: [epic],
		milestones: [],
	});
};

const findTask = (taskId: string): RoadmapTask | undefined =>
	useRoadmapStore
		.getState()
		.epics.flatMap((epic) => epic.features ?? [])
		.flatMap((feature) => feature.tasks ?? [])
		.find((task) => task.id === taskId);

const modified = (
	nodeId: string,
	title = "Ship it",
): AgentCommitImpactedItem => ({
	node_id: nodeId,
	node_type: "task",
	title,
	impact: "modified",
});

const updateTask = (patch: Record<string, unknown>): AgentOperation => ({
	op: "update_node",
	node_type: "task",
	node_id: "task-1",
	patch,
});

describe("roadmapStore.applyAiCommitImpactedItems assignment", () => {
	beforeEach(() => {
		useRoadmapStore.getState().resetRoadmap();
		seed();
	});

	it("applies an assignee_ids patch as the full set with the mirror rule", () => {
		useRoadmapStore
			.getState()
			.applyAiCommitImpactedItems(
				[updateTask({ assignee_ids: ["u-ben", "u-cid"] })],
				[modified("task-1")],
			);
		const task = findTask("task-1");
		expect(task?.assignee_ids).toEqual(["u-ben", "u-cid"]);
		expect(task?.assignee_id).toBe("u-ben");
		// Ana was dropped; Cid's profile is unknown until the full reload.
		expect(task?.assignees).toEqual([ben]);
		expect(task?.assignee).toEqual(ben);
	});

	it("treats an assignee_id-only patch as [X]", () => {
		useRoadmapStore
			.getState()
			.applyAiCommitImpactedItems(
				[updateTask({ assignee_id: "u-ben" })],
				[modified("task-1")],
			);
		const task = findTask("task-1");
		expect(task?.assignee_ids).toEqual(["u-ben"]);
		expect(task?.assignee_id).toBe("u-ben");
		expect(task?.assignees).toEqual([ben]);
		expect(task?.assignee).toEqual(ben);
	});

	it("clears every assignee for assignee_id: null", () => {
		useRoadmapStore
			.getState()
			.applyAiCommitImpactedItems(
				[updateTask({ assignee_id: null })],
				[modified("task-1")],
			);
		const task = findTask("task-1");
		expect(task?.assignee_ids).toEqual([]);
		expect(task?.assignee_id).toBeNull();
		expect(task?.assignees).toEqual([]);
		expect(task?.assignee).toBeUndefined();
	});

	it("lets assignee_ids win when both fields are patched", () => {
		useRoadmapStore
			.getState()
			.applyAiCommitImpactedItems(
				[updateTask({ assignee_ids: [], assignee_id: "u-ben" })],
				[modified("task-1")],
			);
		const task = findTask("task-1");
		expect(task?.assignee_ids).toEqual([]);
		expect(task?.assignee_id).toBeNull();
	});

	it("leaves assignment untouched when the patch does not mention it", () => {
		useRoadmapStore
			.getState()
			.applyAiCommitImpactedItems(
				[updateTask({ title: "Renamed" })],
				[modified("task-1", "Renamed")],
			);
		const task = findTask("task-1");
		expect(task?.title).toBe("Renamed");
		expect(task?.assignee_ids).toEqual(["u-ana", "u-ben"]);
		expect(task?.assignee_id).toBe("u-ana");
		expect(task?.assignees).toEqual([ana, ben]);
	});

	it("gives an AI-created task its assignee set from data.assignee_ids", () => {
		useRoadmapStore.getState().applyAiCommitImpactedItems(
			[
				{
					op: "add_task",
					parent_id: "feature-1",
					temp_id: "tmp-1",
					data: {
						title: "New task",
						assignee_ids: ["u-ben", "u-ana", "u-ben"],
						assignee_id: "u-cid",
					},
				},
			],
			[
				{
					node_id: "task-new",
					node_type: "task",
					title: "New task",
					impact: "created",
				},
			],
		);
		const task = findTask("task-new");
		expect(task?.feature_id).toBe("feature-1");
		expect(task?.assignee_ids).toEqual(["u-ben", "u-ana"]);
		expect(task?.assignee_id).toBe("u-ben");
	});

	it("falls back to data.assignee_id for an AI-created task", () => {
		useRoadmapStore.getState().applyAiCommitImpactedItems(
			[
				{
					op: "add_task",
					parent_id: "feature-1",
					data: { title: "Solo task", assignee_id: "u-ana" },
				},
			],
			[
				{
					node_id: "task-solo",
					node_type: "task",
					title: "Solo task",
					impact: "created",
				},
			],
		);
		const task = findTask("task-solo");
		expect(task?.assignee_ids).toEqual(["u-ana"]);
		expect(task?.assignee_id).toBe("u-ana");
	});
});
