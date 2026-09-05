import { describe, expect, it } from "vitest";
import {
	buildCuratedToolRequestedMessage,
	buildCuratedToolResultMessage,
	buildFriendlyMinimalToolLabel,
	containsUuidLikeText,
	isSupportedTraceToolName,
	SUPPORTED_TRACE_TOOL_NAMES,
} from "./aiToolMessaging";

describe("roadmap AI tool messaging catalog", () => {
	it("covers every supported tool with curated request/result messaging", () => {
		for (const toolName of SUPPORTED_TRACE_TOOL_NAMES) {
			const requested = buildCuratedToolRequestedMessage(toolName, {
				status: "running",
				summary: "",
				details: {
					tool_name: toolName,
					tool_args: {},
				},
			});
			const result = buildCuratedToolResultMessage(toolName, {
				status: "success",
				summary: "",
				details: {
					tool_name: toolName,
					result_summary: {
						operations_count: 1,
					},
				},
			});

			expect(requested.usedFallback).toBe(false);
			expect(result.usedFallback).toBe(false);
			expect(requested.title.length).toBeGreaterThan(0);
			expect(result.title.length).toBeGreaterThan(0);
			expect(result.summary.split(". ").length).toBeGreaterThanOrEqual(2);
		}
	});

	it("falls back gracefully for unknown tools", () => {
		const requested = buildCuratedToolRequestedMessage("unknown_tool_name", {
			status: "running",
			summary: "",
			details: {
				tool_name: "unknown_tool_name",
			},
		});
		const result = buildCuratedToolResultMessage("unknown_tool_name", {
			status: "success",
			summary: "",
			details: {
				tool_name: "unknown_tool_name",
			},
		});

		expect(requested.usedFallback).toBe(true);
		expect(result.usedFallback).toBe(true);
		expect(requested.title).toBe("Working on your request");
		expect(result.title).toBe("Completed a request step");
	});

	it("humanizes bulk_update_tasks_by_filter request args without exposing ids", () => {
		const message = buildCuratedToolRequestedMessage(
			"bulk_update_tasks_by_filter",
			{
				status: "running",
				summary: "",
				details: {
					tool_name: "bulk_update_tasks_by_filter",
					tool_args: {
						filters: {
							parent_type: "epic",
							parent_id: "55e431e2-e416-468c-a973-94d97280e97d",
							status: "todo",
							keyword: "login",
							include_completed: false,
						},
						update: {
							status: "in_progress",
							assignee_id: null,
						},
						limit: 2000,
					},
				},
			},
		);

		expect(message.usedFallback).toBe(false);
		expect(message.summary).toContain("under the selected epic");
		expect(message.summary).toContain("with status todo");
		expect(message.summary).toContain('matching "login"');
		expect(message.summary).toContain("excluding completed tasks");
		expect(message.summary).toContain("set status to in progress");
		expect(message.summary).toContain("clear assignee");
		expect(containsUuidLikeText(message.summary)).toBe(false);
	});

	it("humanizes bulk_assign_tasks unassign request", () => {
		const message = buildCuratedToolRequestedMessage("bulk_assign_tasks", {
			status: "running",
			summary: "",
			details: {
				tool_name: "bulk_assign_tasks",
				tool_args: {
					task_ids: ["a", "b", "c"],
					assignee_id: null,
				},
			},
		});

		expect(message.summary).toContain("unassigning 3 selected tasks");
	});

	it("narrates a multi-assignee set on bulk_assign_tasks without leaking ids", () => {
		const message = buildCuratedToolRequestedMessage("bulk_assign_tasks", {
			status: "running",
			summary: "",
			details: {
				tool_name: "bulk_assign_tasks",
				tool_args: {
					task_ids: ["a", "b"],
					assignee_ids: [
						"55e431e2-e416-468c-a973-94d97280e97d",
						"7d0b8f1e-5c2a-4c3b-9a1e-2f6d8c4b1a90",
						"55e431e2-e416-468c-a973-94d97280e97d",
					],
				},
			},
		});

		expect(message.summary).toContain(
			"assigning 2 selected tasks to 2 teammates",
		);
		expect(containsUuidLikeText(message.summary)).toBe(false);
	});

	it("treats an empty assignee_ids set as clearing every assignee", () => {
		const bulk = buildCuratedToolRequestedMessage("bulk_assign_tasks", {
			status: "running",
			summary: "",
			details: {
				tool_name: "bulk_assign_tasks",
				tool_args: { task_ids: ["a"], assignee_ids: [] },
			},
		});
		expect(bulk.summary).toContain("unassigning 1 selected tasks");

		const single = buildCuratedToolRequestedMessage("update_task_assignee", {
			status: "running",
			summary: "",
			details: {
				tool_name: "update_task_assignee",
				tool_args: { task_id: "t", assignee_ids: [] },
			},
		});
		expect(single.summary).toContain(
			"removing all assignees from the selected task",
		);
	});

	it("narrates update_task_assignee with several teammates", () => {
		const message = buildCuratedToolRequestedMessage("update_task_assignee", {
			status: "running",
			summary: "",
			details: {
				tool_name: "update_task_assignee",
				tool_args: { task_id: "t", assignee_ids: ["u1", "u2", "u3"] },
			},
		});
		expect(message.summary).toContain(
			"assigning the selected task to 3 teammates",
		);

		const one = buildCuratedToolRequestedMessage("update_task_assignee", {
			status: "running",
			summary: "",
			details: {
				tool_name: "update_task_assignee",
				tool_args: { task_id: "t", assignee_ids: ["u1"] },
			},
		});
		expect(one.summary).toContain(
			"assigning the selected task to the selected teammate",
		);
	});

	it("narrates assignee_ids in bulk_update_tasks_by_filter update and filters", () => {
		const message = buildCuratedToolRequestedMessage(
			"bulk_update_tasks_by_filter",
			{
				status: "running",
				summary: "",
				details: {
					tool_name: "bulk_update_tasks_by_filter",
					tool_args: {
						filters: { assignee_ids: ["u1", "u2"] },
						update: { assignee_ids: ["u3", "u4"] },
					},
				},
			},
		);
		expect(message.summary).toContain(
			"assigned to any of 2 selected teammates",
		);
		expect(message.summary).toContain("assign to 2 teammates");

		const clearing = buildCuratedToolRequestedMessage(
			"bulk_update_tasks_by_filter",
			{
				status: "running",
				summary: "",
				details: {
					tool_name: "bulk_update_tasks_by_filter",
					tool_args: {
						filters: { assignee_ids: ["u1"] },
						update: { assignee_ids: [] },
					},
				},
			},
		);
		expect(clearing.summary).toContain("assigned to the selected teammate");
		expect(clearing.summary).toContain("clear assignees");
	});

	it("never leaks operation codes in curated plan result text", () => {
		const message = buildCuratedToolResultMessage("plan_roadmap_operations", {
			status: "success",
			summary:
				"Tool plan_roadmap_operations completed (operations_count=19, operation_types=['mark_status'])",
			details: {
				tool_name: "plan_roadmap_operations",
				result_summary: {
					operations_count: 19,
					operation_types: ["mark_status"],
				},
			},
		});

		expect(message.summary.toLowerCase()).not.toContain("mark_status");
		expect(message.summary.toLowerCase()).not.toContain(
			"plan_roadmap_operations",
		);
		expect(message.summary).toContain("I prepared your roadmap changes.");
		expect(message.summary).toContain("prepared 19 roadmap changes");
	});

	it("builds balanced outcome + context for assigned task results", () => {
		const message = buildCuratedToolResultMessage("get_tasks_assigned_to_me", {
			status: "success",
			summary: "",
			details: {
				tool_name: "get_tasks_assigned_to_me",
				tool_args: {
					status: "all",
					limit: 500,
				},
				result_summary: {
					tasks_count: 19,
					item_titles: ["Task A", "Task B"],
					item_titles_shown_count: 2,
					item_titles_total_count: 19,
					item_titles_has_more: true,
				},
			},
		});

		expect(message.summary).toContain("I reviewed your assigned tasks.");
		expect(message.summary).toContain("across all statuses");
		expect(message.summary).toContain("(up to 500)");
		expect(message.summary).toContain("found 19 assigned tasks");
		expect(message.summary).toContain("listed the matching titles below");
		expect(message.titleList?.items).toEqual(["Task A", "Task B"]);
		expect(message.titleList?.totalCount).toBe(19);
		expect(message.titleList?.shownCount).toBe(2);
		expect(message.titleList?.hasMore).toBe(true);
		expect(message.summary.toLowerCase()).not.toContain(
			"get_tasks_assigned_to_me",
		);
	});

	it("returns simple minimal labels for known and unknown tools", () => {
		const known = buildFriendlyMinimalToolLabel("resolve_node_reference");
		const unknown = buildFriendlyMinimalToolLabel("totally_unknown_tool");

		expect(known.requested).toBe("Finding the right roadmap item");
		expect(known.completed).toBe("Found the right roadmap item");
		expect(unknown.requested).toBe("Working on your request");
		expect(unknown.completed).toBe("Completed a request step");
	});

	it("marks supported tool names correctly", () => {
		expect(isSupportedTraceToolName("bulk_update_tasks_by_filter")).toBe(true);
		expect(isSupportedTraceToolName("unknown")).toBe(false);
	});

	it("uses a negative title when resolve_node_reference finds zero matches", () => {
		const message = buildCuratedToolResultMessage("resolve_node_reference", {
			status: "success",
			summary: "",
			details: {
				tool_name: "resolve_node_reference",
				tool_args: { label: "Nonexistent Module", node_type: "feature" },
				result_summary: { matches_count: 0 },
			},
		});

		expect(message.title).toBe("No matching roadmap item found");
		expect(message.usedFallback).toBe(false);
	});

	it("uses a positive title when resolve_node_reference finds matches", () => {
		const message = buildCuratedToolResultMessage("resolve_node_reference", {
			status: "success",
			summary: "",
			details: {
				tool_name: "resolve_node_reference",
				tool_args: { label: "Auth Module", node_type: "epic" },
				result_summary: { matches_count: 2 },
			},
		});

		expect(message.title).toBe("Found the right roadmap item");
	});

	it("uses a negative title when plan_roadmap_operations has zero operations", () => {
		const message = buildCuratedToolResultMessage("plan_roadmap_operations", {
			status: "success",
			summary: "",
			details: {
				tool_name: "plan_roadmap_operations",
				result_summary: { operations_count: 0 },
			},
		});

		expect(message.title).toBe("No roadmap changes needed");
	});

	it("covers the run-era terminal tools with curated copy", () => {
		expect(isSupportedTraceToolName("stage_edits")).toBe(true);
		expect(isSupportedTraceToolName("propose")).toBe(true);
		expect(isSupportedTraceToolName("revise_proposal")).toBe(true);
		// The old planning tool name stays so persisted history rows keep copy.
		expect(isSupportedTraceToolName("plan_roadmap_operations")).toBe(true);

		const staged = buildCuratedToolResultMessage("stage_edits", {
			status: "success",
			summary: "Tool stage_edits completed (operations_count=4).",
			details: {
				tool_name: "stage_edits",
				result_summary: { operations_count: 4, roadmap_id: "rm-1" },
			},
		});
		expect(staged.usedFallback).toBe(false);
		expect(staged.title).toBe("Prepared your roadmap changes");
		expect(staged.summary).toContain("prepared 4 roadmap changes");
		expect(staged.summary.toLowerCase()).not.toContain("stage_edits");
		expect(staged.summary.toLowerCase()).not.toContain("rm-1");

		const stagedNothing = buildCuratedToolResultMessage("stage_edits", {
			status: "success",
			summary: "",
			details: {
				tool_name: "stage_edits",
				result_summary: { operations_count: 0 },
			},
		});
		expect(stagedNothing.title).toBe("No roadmap changes needed");

		const proposed = buildCuratedToolRequestedMessage("propose", {
			status: "running",
			summary: "",
			details: { tool_name: "propose", tool_args: { targets: [] } },
		});
		expect(proposed.title).toBe("Drafting a proposal");
		expect(proposed.usedFallback).toBe(false);

		const revised = buildFriendlyMinimalToolLabel("revise_proposal");
		expect(revised.requested).toBe("Revising the proposal");
		expect(revised.completed).toBe("Revised the proposal");
	});

	it("uses a positive title when plan_roadmap_operations has operations", () => {
		const message = buildCuratedToolResultMessage("plan_roadmap_operations", {
			status: "success",
			summary: "",
			details: {
				tool_name: "plan_roadmap_operations",
				result_summary: { operations_count: 5 },
			},
		});

		expect(message.title).toBe("Prepared your roadmap changes");
	});
});
