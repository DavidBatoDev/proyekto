import { describe, expect, it } from "vitest";
import type { AssigneeProfile, RoadmapTask } from "@/types/roadmap";
import {
	addTaskAssignee,
	assigneeIdsFromPatch,
	getTaskAssigneeIds,
	getTaskAssigneeProfiles,
	normalizeAssigneeIds,
	withTaskAssignees,
} from "./taskAssignees";

const ana: AssigneeProfile = { id: "u-ana", display_name: "Ana" };
const ben: AssigneeProfile = { id: "u-ben", display_name: "Ben" };
const cid: AssigneeProfile = { id: "u-cid", display_name: "Cid" };

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

describe("normalizeAssigneeIds", () => {
	it("keeps order, drops duplicates, blanks and non-strings", () => {
		expect(normalizeAssigneeIds(["a", "b", "a", " ", null, 3, " c "])).toEqual([
			"a",
			"b",
			"c",
		]);
	});

	it("returns an empty list for non-arrays", () => {
		expect(normalizeAssigneeIds("a")).toEqual([]);
		expect(normalizeAssigneeIds(undefined)).toEqual([]);
	});
});

describe("getTaskAssigneeIds", () => {
	it("prefers the explicit assignee_ids set", () => {
		expect(
			getTaskAssigneeIds(
				task({
					assignee_ids: ["u-ben", "u-ana"],
					assignees: [ana],
					assignee_id: "u-ana",
				}),
			),
		).toEqual(["u-ben", "u-ana"]);
	});

	it("falls back to the embedded join rows, then the primary column", () => {
		expect(
			getTaskAssigneeIds(task({ assignees: [ana, ben], assignee_id: "u-ana" })),
		).toEqual(["u-ana", "u-ben"]);
		// A legacy row whose join table was never populated still reports its
		// primary assignee.
		expect(
			getTaskAssigneeIds(task({ assignees: [], assignee_id: "u-ana" })),
		).toEqual(["u-ana"]);
		expect(getTaskAssigneeIds(task({ assignee: ben }))).toEqual(["u-ben"]);
		expect(getTaskAssigneeIds(task())).toEqual([]);
	});
});

describe("getTaskAssigneeProfiles", () => {
	it("returns the join-row profiles, else the primary profile", () => {
		expect(getTaskAssigneeProfiles(task({ assignees: [ana, ben] }))).toEqual([
			ana,
			ben,
		]);
		expect(getTaskAssigneeProfiles(task({ assignee: cid }))).toEqual([cid]);
		expect(getTaskAssigneeProfiles(task())).toEqual([]);
	});
});

describe("assigneeIdsFromPatch (precedence)", () => {
	it("assignee_ids wins when present, even alongside assignee_id", () => {
		expect(
			assigneeIdsFromPatch({
				assignee_ids: ["u-ben", "u-ben"],
				assignee_id: "u-ana",
			}),
		).toEqual(["u-ben"]);
	});

	it("assignee_id: X means [X]", () => {
		expect(assigneeIdsFromPatch({ assignee_id: "u-ana" })).toEqual(["u-ana"]);
	});

	it("assignee_id: null (or empty) means []", () => {
		expect(assigneeIdsFromPatch({ assignee_id: null })).toEqual([]);
		expect(assigneeIdsFromPatch({ assignee_id: "" })).toEqual([]);
	});

	it("an explicit empty assignee_ids unassigns everyone", () => {
		expect(
			assigneeIdsFromPatch({ assignee_ids: [], assignee_id: "u-ana" }),
		).toEqual([]);
	});

	it("is undefined when the patch does not touch assignment", () => {
		expect(assigneeIdsFromPatch({ title: "Renamed" })).toBeUndefined();
		expect(assigneeIdsFromPatch({ assignee_ids: null })).toBeUndefined();
		expect(assigneeIdsFromPatch(undefined)).toBeUndefined();
	});

	it("treats assignee_ids: null as absent (assignment unchanged), so only [] unassigns", () => {
		// null is NOT an unassign: with no scalar alias the patch leaves the
		// assignment alone ...
		expect(
			assigneeIdsFromPatch({ assignee_ids: null, title: "Renamed" }),
		).toBeUndefined();
		// ... and with one, the scalar alias applies exactly as if
		// assignee_ids had been omitted.
		expect(
			assigneeIdsFromPatch({ assignee_ids: null, assignee_id: "u-ana" }),
		).toEqual(["u-ana"]);
		expect(
			assigneeIdsFromPatch({ assignee_ids: null, assignee_id: null }),
		).toEqual([]);
	});
});

describe("withTaskAssignees (mirror rule)", () => {
	it("writes the set, mirrors the primary and orders known profiles by the set", () => {
		const next = withTaskAssignees(
			task({ assignees: [ana, ben], assignee_id: "u-ana", assignee: ana }),
			["u-ben", "u-cid", "u-ana"],
		);
		expect(next.assignee_ids).toEqual(["u-ben", "u-cid", "u-ana"]);
		expect(next.assignee_id).toBe("u-ben");
		// u-cid's profile is unknown locally; it fills in on the full reload.
		expect(next.assignees).toEqual([ben, ana]);
		expect(next.assignee).toEqual(ben);
	});

	it("clears every assignment field for an empty set", () => {
		const next = withTaskAssignees(
			task({ assignees: [ana], assignee_id: "u-ana", assignee: ana }),
			[],
		);
		expect(next.assignee_ids).toEqual([]);
		expect(next.assignee_id).toBeNull();
		expect(next.assignees).toEqual([]);
		expect(next.assignee).toBeUndefined();
	});

	it("accepts extra known profiles for ids the task did not carry", () => {
		const next = withTaskAssignees(
			task({ assignees: [ana] }),
			["u-ana", "u-cid"],
			[ana, cid],
		);
		expect(next.assignees).toEqual([ana, cid]);
	});
});

describe("addTaskAssignee (dock drop)", () => {
	it("adds the member to the set and keeps everyone already assigned", () => {
		const next = addTaskAssignee(
			task({
				assignees: [ana, ben],
				assignee_ids: ["u-ana", "u-ben"],
				assignee_id: "u-ana",
				assignee: ana,
			}),
			cid,
		);
		expect(next).not.toBeNull();
		expect(next?.assignee_ids).toEqual(["u-ana", "u-ben", "u-cid"]);
		expect(next?.assignees).toEqual([ana, ben, cid]);
		// The primary does not change when someone is added.
		expect(next?.assignee_id).toBe("u-ana");
		expect(next?.assignee).toEqual(ana);
	});

	it("becomes the primary on an unassigned task", () => {
		const next = addTaskAssignee(task(), ben);
		expect(next?.assignee_ids).toEqual(["u-ben"]);
		expect(next?.assignee_id).toBe("u-ben");
		expect(next?.assignees).toEqual([ben]);
	});

	it("is a no-op (null) when the member is already assigned", () => {
		expect(
			addTaskAssignee(task({ assignees: [ana], assignee_id: "u-ana" }), ana),
		).toBeNull();
		// Legacy primary-only rows count as assigned too.
		expect(addTaskAssignee(task({ assignee_id: "u-ana" }), ana)).toBeNull();
	});
});
