import { describe, expect, it } from "vitest";
import {
	buildProjectBottomNav,
	buildProjectNavSections,
	createProjectNavItems,
	ownsSegment,
	type ProjectNavKey,
	resolveProjectPageLabel,
} from "./projectNavItems";

const PROJECT_ID = "p1";
const ROADMAP_ID = "r1";

const items = () => createProjectNavItems({ projectId: PROJECT_ID });

/** Every nav key whose `matches` returns true for `path`. */
const activeKeys = (path: string): ProjectNavKey[] =>
	Object.values(items())
		.filter((item) => item.matches(path))
		.map((item) => item.key);

describe("ownsSegment", () => {
	const owns = ownsSegment(PROJECT_ID, "time");

	it("matches the segment exactly and as a parent", () => {
		expect(owns(`/project/${PROJECT_ID}/time`)).toBe(true);
		expect(owns(`/project/${PROJECT_ID}/time/2026-08`)).toBe(true);
	});

	it("does not match a longer segment that merely starts the same", () => {
		expect(owns(`/project/${PROJECT_ID}/timeline`)).toBe(false);
		expect(owns(`/project/${PROJECT_ID}/timeline/${ROADMAP_ID}`)).toBe(false);
	});

	it("does not leak across projects", () => {
		expect(owns("/project/other/time")).toBe(false);
	});
});

describe("active state", () => {
	// The regression this module exists to prevent: `/time` is a prefix of
	// `/timeline`, so prefix matching lit Time on every Timeline page.
	it("lights Timeline and not Time on a timeline route", () => {
		expect(activeKeys(`/project/${PROJECT_ID}/timeline/${ROADMAP_ID}`)).toEqual(
			["timeline"],
		);
	});

	it("lights Time and not Timeline on the time route", () => {
		expect(activeKeys(`/project/${PROJECT_ID}/time`)).toEqual(["time"]);
	});

	it.each([
		[`/project/${PROJECT_ID}/overview`, "overview"],
		[`/project/${PROJECT_ID}/roadmap/${ROADMAP_ID}`, "roadmap"],
		[`/project/${PROJECT_ID}/work-items/${ROADMAP_ID}`, "board"],
		[`/project/${PROJECT_ID}/team/invites`, "team"],
		[`/project/${PROJECT_ID}/chat/channel-general`, "chat"],
		[`/project/${PROJECT_ID}/resources`, "resources"],
		[`/project/${PROJECT_ID}/logs`, "activity"],
		[`/project/${PROJECT_ID}/settings/general`, "settings"],
	])("%s activates exactly one item (%s)", (path, expected) => {
		expect(activeKeys(path)).toEqual([expected]);
	});
});

describe("createProjectNavItems", () => {
	it("deep-links the roadmap-scoped pages when a roadmap is known", () => {
		const scoped = createProjectNavItems({
			projectId: PROJECT_ID,
			roadmapId: ROADMAP_ID,
		});
		expect(scoped.roadmap.to).toBe(
			`/project/${PROJECT_ID}/roadmap/${ROADMAP_ID}`,
		);
		expect(scoped.timeline.to).toBe(
			`/project/${PROJECT_ID}/timeline/${ROADMAP_ID}`,
		);
		expect(scoped.board.to).toBe(
			`/project/${PROJECT_ID}/work-items/${ROADMAP_ID}`,
		);
	});

	it("falls back to the layout route when no roadmap is linked", () => {
		expect(items().timeline.to).toBe(`/project/${PROJECT_ID}/timeline`);
	});

	it("keeps Activity on the /logs route, since logs.view is a shipped contract", () => {
		expect(items().activity.label).toBe("Activity");
		expect(items().activity.to).toBe(`/project/${PROJECT_ID}/logs`);
		expect(items().activity.gate).toBe("logs.view");
	});
});

describe("buildProjectNavSections", () => {
	const sections = buildProjectNavSections({ projectId: PROJECT_ID });

	it("groups the rail as Project / Collaborate / Management", () => {
		expect(sections.map((s) => s.title)).toEqual([
			"Project",
			"Collaborate",
			"Management",
		]);
	});

	it("puts Overview first", () => {
		expect(sections[0].items[0].key).toBe("overview");
	});

	it("keeps Settings and Time out of the rail — they belong to the gear", () => {
		const railKeys = sections.flatMap((s) => s.items.map((i) => i.key));
		expect(railKeys).not.toContain("settings");
		expect(railKeys).not.toContain("time");
	});
});

describe("delivery governance entries", () => {
	it.each([
		[`/project/${PROJECT_ID}/deliverables`, "deliverables"],
		[`/project/${PROJECT_ID}/change-requests`, "changeRequests"],
		[`/project/${PROJECT_ID}/risks`, "risks"],
		[`/project/${PROJECT_ID}/decisions`, "decisions"],
	])("%s activates exactly one item (%s)", (path, expected) => {
		expect(activeKeys(path)).toEqual([expected]);
	});

	it("gates all four on the single access.delivery permission", () => {
		const built = items();
		for (const key of [
			"deliverables",
			"changeRequests",
			"risks",
			"decisions",
		] as const) {
			expect(built[key].gate).toBe("access.delivery");
		}
	});

	it("places Deliverables in Project and the rest under Management", () => {
		const sections = buildProjectNavSections({ projectId: PROJECT_ID });
		const byTitle = (title: string) =>
			sections
				.find((section) => section.title === title)
				?.items.map((item) => item.key) ?? [];

		expect(byTitle("Project")).toContain("deliverables");
		expect(byTitle("Management")).toEqual([
			"changeRequests",
			"decisions",
			"risks",
			"activity",
		]);
	});
});

describe("buildProjectBottomNav", () => {
	const { primary, more } = buildProjectBottomNav({ projectId: PROJECT_ID });

	it("keeps the bar to five items", () => {
		expect(primary.length).toBeLessThanOrEqual(5);
	});

	it("lists every item exactly once across the bar and the sheet", () => {
		const keys = [...primary, ...more].map((i) => i.key);
		expect(new Set(keys).size).toBe(keys.length);
	});
});

describe("resolveProjectPageLabel", () => {
	it("reads Timeline, not Time, on a timeline route", () => {
		expect(
			resolveProjectPageLabel(
				`/project/${PROJECT_ID}/timeline/${ROADMAP_ID}`,
				PROJECT_ID,
			),
		).toBe("Timeline");
	});

	it("falls back to Overview on the bare layout route", () => {
		expect(resolveProjectPageLabel(`/project/${PROJECT_ID}`, PROJECT_ID)).toBe(
			"Overview",
		);
	});
});
