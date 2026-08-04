import { describe, expect, it } from "vitest";
import type { FullRoadmapWithProject } from "@/services/roadmap.service";
import {
	applyFilters,
	EMPTY_FILTERS,
	type GlobalBoardFilters,
	pickDefaultProjectId,
	resolveFilters,
} from "./globalBoardFilters";
import type { KanbanTaskContext } from "./types";

function roadmap(
	id: string,
	updatedAt: string,
	project: { id: string; title: string } | null,
): FullRoadmapWithProject {
	return {
		id,
		project_id: project?.id ?? null,
		name: `Roadmap ${id}`,
		owner_id: "owner-1",
		status: "active",
		created_at: "2026-01-01T00:00:00Z",
		updated_at: updatedAt,
		milestones: [],
		epics: [],
		project,
	} as unknown as FullRoadmapWithProject;
}

function row(
	taskId: string,
	opts: {
		projectId?: string | null;
		epicId?: string;
		featureId?: string;
		assigneeId?: string | null;
	} = {},
): KanbanTaskContext {
	const {
		projectId = "p1",
		epicId = "e1",
		featureId = "f1",
		assigneeId = null,
	} = opts;
	return {
		task: {
			id: taskId,
			title: taskId,
			status: "todo",
			assignee_id: assigneeId,
		},
		feature: { id: featureId, title: featureId },
		epic: { id: epicId, title: epicId },
		milestone: null,
		project: projectId ? { id: projectId, title: projectId } : null,
	} as unknown as KanbanTaskContext;
}

describe("pickDefaultProjectId", () => {
	it("returns null for an empty roadmap list", () => {
		expect(pickDefaultProjectId([])).toBeNull();
	});

	it("picks the project owning the most recently updated roadmap", () => {
		const roadmaps = [
			roadmap("r1", "2026-01-05T00:00:00Z", { id: "p1", title: "Alpha" }),
			roadmap("r2", "2026-03-20T00:00:00Z", { id: "p2", title: "Beta" }),
			roadmap("r3", "2026-02-10T00:00:00Z", { id: "p3", title: "Gamma" }),
		];
		expect(pickDefaultProjectId(roadmaps)).toBe("p2");
	});

	it("collapses several roadmaps of the same project to that project", () => {
		const roadmaps = [
			roadmap("r1", "2026-01-05T00:00:00Z", { id: "p1", title: "Alpha" }),
			roadmap("r2", "2026-09-01T00:00:00Z", { id: "p1", title: "Alpha" }),
		];
		expect(pickDefaultProjectId(roadmaps)).toBe("p1");
	});

	it("skips roadmaps with no project, even when they are the newest", () => {
		const roadmaps = [
			roadmap("r1", "2026-01-05T00:00:00Z", { id: "p1", title: "Alpha" }),
			roadmap("r2", "2026-12-31T00:00:00Z", null),
		];
		expect(pickDefaultProjectId(roadmaps)).toBe("p1");
	});

	it("returns null when no roadmap belongs to a project", () => {
		expect(
			pickDefaultProjectId([roadmap("r1", "2026-01-05T00:00:00Z", null)]),
		).toBeNull();
	});

	it("tolerates an unparsable updated_at without dropping the project", () => {
		const roadmaps = [
			roadmap("r1", "not-a-date", { id: "p1", title: "Alpha" }),
		];
		expect(pickDefaultProjectId(roadmaps)).toBe("p1");
	});
});

describe("resolveFilters", () => {
	const roadmaps = [
		roadmap("r1", "2026-01-05T00:00:00Z", { id: "p1", title: "Alpha" }),
		roadmap("r2", "2026-03-20T00:00:00Z", { id: "p2", title: "Beta" }),
	];

	it("coerces a legacy persisted null projectId to the default project", () => {
		const resolved = resolveFilters(EMPTY_FILTERS, roadmaps);
		expect(resolved.projectId).toBe("p2");
	});

	it("keeps a still-valid selection untouched", () => {
		const filters: GlobalBoardFilters = {
			projectId: "p1",
			epicId: "e1",
			featureId: "f1",
			assigneeIds: ["u1"],
			statuses: [],
		};
		expect(resolveFilters(filters, roadmaps)).toBe(filters);
	});

	it("falls back and drops the stale epic/feature when the project vanishes", () => {
		const filters: GlobalBoardFilters = {
			projectId: "gone",
			epicId: "e1",
			featureId: "f1",
			assigneeIds: ["u1"],
			statuses: [],
		};
		expect(resolveFilters(filters, roadmaps)).toEqual({
			projectId: "p2",
			epicId: null,
			featureId: null,
			assigneeIds: ["u1"],
			statuses: [],
		});
	});

	it("leaves the board unscoped when no roadmap has a project", () => {
		const resolved = resolveFilters(EMPTY_FILTERS, [
			roadmap("r1", "2026-01-05T00:00:00Z", null),
		]);
		expect(resolved.projectId).toBeNull();
	});
});

describe("applyFilters", () => {
	const rows = [
		row("t1", { projectId: "p1" }),
		row("t2", { projectId: "p2" }),
		row("t3", { projectId: "p2", epicId: "e2", assigneeId: "u1" }),
	];

	it("treats a null projectId as unscoped", () => {
		expect(applyFilters(rows, EMPTY_FILTERS).map((r) => r.task.id)).toEqual([
			"t1",
			"t2",
			"t3",
		]);
	});

	it("scopes to a single project when projectId is set", () => {
		const filtered = applyFilters(rows, { ...EMPTY_FILTERS, projectId: "p2" });
		expect(filtered.map((r) => r.task.id)).toEqual(["t2", "t3"]);
	});

	it("stacks the epic and assignee filters on top of the project scope", () => {
		const filtered = applyFilters(rows, {
			...EMPTY_FILTERS,
			projectId: "p2",
			epicId: "e2",
			assigneeIds: ["u1"],
		});
		expect(filtered.map((r) => r.task.id)).toEqual(["t3"]);
	});

	it("filters tasks by status", () => {
		const testRows = [
			{ ...row("t1"), task: { id: "t1", title: "t1", status: "todo" } },
			{ ...row("t2"), task: { id: "t2", title: "t2", status: "in_progress" } },
			{ ...row("t3"), task: { id: "t3", title: "t3", status: "done" } },
		] as KanbanTaskContext[];

		const filtered = applyFilters(testRows, {
			...EMPTY_FILTERS,
			statuses: ["in_progress"],
		});
		expect(filtered.map((r) => r.task.id)).toEqual(["t2"]);
	});
});
