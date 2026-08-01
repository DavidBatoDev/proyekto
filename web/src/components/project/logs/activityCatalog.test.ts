import { describe, expect, it } from "vitest";
import type { ActivityEntry } from "@/services/activity.service";
import {
	ACTIVITY_ACTIONS,
	ACTIVITY_COPY,
	activityCopyFor,
} from "./activityCatalog";

function entry(overrides: Partial<ActivityEntry> = {}): ActivityEntry {
	return {
		id: "row-1",
		seq: 1,
		project_id: "p-1",
		roadmap_id: null,
		actor_id: "u-1",
		action: "task.created",
		entity_type: "task",
		entity_id: "t-1",
		is_sensitive: false,
		metadata: {},
		created_at: "2026-08-01T10:00:00.000Z",
		actor: null,
		...overrides,
	};
}

const ALL_ACTIONS = Object.values(ACTIVITY_ACTIONS);

describe("activityCatalog", () => {
	it("has copy for every declared action", () => {
		for (const action of ALL_ACTIONS) {
			expect(ACTIVITY_COPY[action], `missing copy for ${action}`).toBeDefined();
		}
	});

	it("never throws on empty metadata", () => {
		// `object` is contractually total. A row whose metadata was truncated by
		// the recorder must still render.
		for (const action of ALL_ACTIONS) {
			const copy = activityCopyFor(action);
			expect(() => copy.object(entry({ action, metadata: {} }))).not.toThrow();
		}
	});

	it("uses the write-time title so deleted entities stay named", () => {
		const copy = activityCopyFor("task.deleted");
		const text = copy.object(
			entry({ action: "task.deleted", metadata: { title: "Wire up Stripe" } }),
		);
		expect(text).toContain("Wire up Stripe");
	});

	it("never synthesises a name from entity_id", () => {
		// "epic 7f3a-…" is noise; an unnamed entity should read generically.
		const copy = activityCopyFor("epic.deleted");
		const text = copy.object(
			entry({ action: "epic.deleted", entity_id: "7f3a-1111", metadata: {} }),
		);
		expect(text).not.toContain("7f3a");
		expect(text).toBe("an epic");
	});

	describe("unknown actions", () => {
		// Backend and web deploy independently, so the API can legitimately
		// return an action newer than this bundle.
		it("falls back rather than throwing", () => {
			expect(() => activityCopyFor("totally.unknown")).not.toThrow();
			const copy = activityCopyFor("totally.unknown");
			expect(copy.verb).toBeTruthy();
			expect(copy.object(entry({ action: "totally.unknown" }))).toBe(
				"totally.unknown",
			);
		});

		it("renders the MCP connector actions as real events", () => {
			// These existed in production before they were declared; they must
			// not read as anonymous.
			const copy = activityCopyFor("mcp.task_update");
			expect(copy.verb).toContain("AI connector");
			expect(copy.tone).toBe("ai");
		});
	});

	describe("tones", () => {
		it("marks access and membership changes sensitive", () => {
			for (const action of [
				"access.granted",
				"access.revoked",
				"roadmap.share_created",
				"member.role_changed",
				"project.owner_transferred",
			]) {
				expect(activityCopyFor(action).tone, action).toBe("sensitive");
			}
		});

		it("marks deletions destructive", () => {
			for (const action of [
				"epic.deleted",
				"task.deleted",
				"feature.deleted",
			]) {
				expect(activityCopyFor(action).tone, action).toBe("destroy");
			}
		});
	});

	describe("counted objects", () => {
		it("summarises a reorder by item count, not per item", () => {
			const copy = activityCopyFor("task.reordered");
			expect(copy.object(entry({ metadata: { item_count: 12 } }))).toBe(
				"12 tasks",
			);
			expect(copy.object(entry({ metadata: { item_count: 1 } }))).toBe(
				"1 task",
			);
		});

		it("summarises an AI commit by operation count", () => {
			const copy = activityCopyFor("roadmap.committed");
			expect(copy.object(entry({ metadata: { operation_count: 9 } }))).toBe(
				"9 roadmap changes",
			);
		});
	});

	it("quotes a comment excerpt when present", () => {
		const copy = activityCopyFor("task_comment.created");
		const text = copy.object(entry({ metadata: { excerpt: "Looks good" } }));
		expect(text).toContain("Looks good");
	});
});

describe("count-free reorders", () => {
	it("milestone.reordered names the milestone instead of counting", () => {
		// MilestonesService.reorder moves ONE milestone and emits no item_count,
		// so a count-based renderer produced "reordered 0 milestones".
		const copy = activityCopyFor("milestone.reordered");
		expect(copy.object(entry({ metadata: { title: "Beta", position: 2 } }))).toBe(
			'milestone “Beta”',
		);
		expect(copy.object(entry({ metadata: {} }))).toBe("a milestone");
	});
});
