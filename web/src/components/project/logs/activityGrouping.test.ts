import { describe, expect, it } from "vitest";
import type { ActivityEntry } from "@/services/activity.service";
import { groupActivityByDay } from "./activityGrouping";

function at(createdAt: string, id = createdAt): ActivityEntry {
	return {
		id,
		seq: 1,
		project_id: "p-1",
		roadmap_id: null,
		actor_id: null,
		action: "task.created",
		entity_type: "task",
		entity_id: null,
		is_sensitive: false,
		metadata: {},
		created_at: createdAt,
		actor: null,
	};
}

/** Local-midnight boundary for whatever zone the test runs in. */
function localMidnight(offsetDays = 0): Date {
	const d = new Date();
	d.setDate(d.getDate() + offsetDays);
	d.setHours(0, 0, 0, 0);
	return d;
}

describe("groupActivityByDay", () => {
	it("labels today and yesterday", () => {
		const today = new Date(localMidnight().getTime() + 10 * 3600_000);
		const yesterday = new Date(localMidnight(-1).getTime() + 10 * 3600_000);

		const groups = groupActivityByDay([
			at(today.toISOString(), "a"),
			at(yesterday.toISOString(), "b"),
		]);

		expect(groups.map((g) => g.label)).toEqual(["Today", "Yesterday"]);
	});

	/**
	 * The bug this guards: keying on toISOString().slice(0,10) is UTC, so a
	 * 9pm Manila event files under the next day and the feed shows a header
	 * for a day the user never experienced.
	 */
	it("splits on the LOCAL day boundary, not the UTC one", () => {
		const justBefore = new Date(localMidnight().getTime() - 60_000);
		const justAfter = new Date(localMidnight().getTime() + 60_000);

		const groups = groupActivityByDay([
			at(justAfter.toISOString(), "after"),
			at(justBefore.toISOString(), "before"),
		]);

		expect(groups).toHaveLength(2);
		expect(groups[0].items[0].id).toBe("after");
		expect(groups[1].items[0].id).toBe("before");
	});

	it("keeps same-day items in one group", () => {
		const base = localMidnight().getTime() + 9 * 3600_000;
		const groups = groupActivityByDay([
			at(new Date(base + 2000).toISOString(), "a"),
			at(new Date(base + 1000).toISOString(), "b"),
			at(new Date(base).toISOString(), "c"),
		]);
		expect(groups).toHaveLength(1);
		expect(groups[0].items.map((i) => i.id)).toEqual(["a", "b", "c"]);
	});

	/**
	 * Items arrive ordered by the server's keyset. Re-sorting here would
	 * desync the rendered order from the cursor and make paging look like it
	 * skipped rows.
	 */
	it("preserves server order and does not re-sort", () => {
		const base = localMidnight().getTime() + 9 * 3600_000;
		const groups = groupActivityByDay([
			at(new Date(base + 1000).toISOString(), "second"),
			at(new Date(base + 5000).toISOString(), "first-but-later"),
		]);
		expect(groups[0].items.map((i) => i.id)).toEqual([
			"second",
			"first-but-later",
		]);
	});

	it("skips rows with an unparseable timestamp rather than crashing", () => {
		const groups = groupActivityByDay([at("not-a-date", "bad")]);
		expect(groups).toHaveLength(0);
	});

	it("returns nothing for an empty page", () => {
		expect(groupActivityByDay([])).toEqual([]);
	});
});
