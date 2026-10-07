import { describe, expect, it } from "vitest";
import { classifySurface } from "@/lib/platformSurfaces";
import { toWorkspacePath } from "@/lib/workspacePaths";
import {
	EXECUTION_PRIMARY_NAV_ITEMS,
	isExecutionNavItemActive,
	isTimeNavVisible,
	visibleExecutionNavItems,
} from "./executionNavigation";

function item(key: string) {
	const found = EXECUTION_PRIMARY_NAV_ITEMS.find((entry) => entry.key === key);
	if (!found) throw new Error(`${key} nav item missing`);
	return found;
}

describe("EXECUTION_PRIMARY_NAV_ITEMS", () => {
	it("carries an icon on every item", () => {
		// The icons used to live in a separate map keyed by `key`; a missing
		// entry there rendered nothing instead of failing.
		for (const item of EXECUTION_PRIMARY_NAV_ITEMS) {
			expect(item.icon, `${item.key} has no icon`).toBeTruthy();
		}
	});

	it("keeps the marketplace out of the execution shell entirely", () => {
		// Crossing between the two halves of the product is a top-level move and
		// belongs to the global header nav. Finance left this sidebar when the
		// shells split; the marketplace entry followed it out rather than giving
		// one jump two homes.
		const targets = EXECUTION_PRIMARY_NAV_ITEMS.map((item) => item.to);
		expect(targets.some((to) => to.startsWith("/marketplace"))).toBe(false);
	});

	it("matches exact items only on their own path", () => {
		const dashboard = EXECUTION_PRIMARY_NAV_ITEMS.find(
			(item) => item.key === "dashboard",
		);
		if (!dashboard) throw new Error("dashboard nav item missing");
		expect(isExecutionNavItemActive(dashboard, "/dashboard")).toBe(true);
		expect(isExecutionNavItemActive(dashboard, "/dashboard/extra")).toBe(false);
	});

	it("matches prefix items on whole segments only", () => {
		const time = item("time");
		expect(isExecutionNavItemActive(time, "/time")).toBe(true);
		expect(isExecutionNavItemActive(time, "/time/timesheets/s1")).toBe(true);
		expect(isExecutionNavItemActive(time, "/timeline")).toBe(false);
		expect(isExecutionNavItemActive(item("meetings"), "/meetings")).toBe(true);
		expect(isExecutionNavItemActive(item("inbox"), "/inbox/dm-1")).toBe(true);
	});
});

describe("the two groups", () => {
	it("puts the personal pages first, then the workspace's", () => {
		const keys = (group: string) =>
			EXECUTION_PRIMARY_NAV_ITEMS.filter((entry) => entry.group === group).map(
				(entry) => entry.key,
			);
		expect(keys("personal")).toEqual(["inbox", "meetings"]);
		expect(keys("workspace")).toEqual(["dashboard", "command-center", "time"]);
		expect(EXECUTION_PRIMARY_NAV_ITEMS.map((entry) => entry.group)).toEqual([
			"personal",
			"personal",
			"workspace",
			"workspace",
			"workspace",
		]);
	});
});

describe("the Time item", () => {
	it("sits right after Command center, gated on time", () => {
		const keys = EXECUTION_PRIMARY_NAV_ITEMS.map((entry) => entry.key);
		expect(keys.indexOf("time")).toBe(keys.indexOf("command-center") + 1);
		expect(item("time")).toMatchObject({
			to: "/time",
			label: "Time",
			match: "prefix",
			gate: "time",
		});
	});

	it("stays a bare path the installed app shows", () => {
		// /time is personal (ux.md › Routes): never gains a /w/<slug>/ prefix.
		expect(toWorkspacePath(item("time").to, "acme")).toBe("/time");
		expect(classifySurface(item("time").to)).toBe("app");
	});
});

describe("visibleExecutionNavItems", () => {
	it("hides gated items unless their gate is open", () => {
		const keysFor = (gates: Parameters<typeof visibleExecutionNavItems>[0]) =>
			visibleExecutionNavItems(gates).map((entry) => entry.key);

		expect(keysFor({})).toEqual([
			"inbox",
			"meetings",
			"dashboard",
			"command-center",
		]);
		expect(keysFor({ time: false })).not.toContain("time");
		expect(keysFor({ time: true })).toEqual([
			"inbox",
			"meetings",
			"dashboard",
			"command-center",
			"time",
		]);
	});

	it("filters a caller-supplied list too", () => {
		expect(
			visibleExecutionNavItems({ time: false }, [item("time"), item("inbox")]),
		).toEqual([item("inbox")]);
	});
});

describe("isTimeNavVisible", () => {
	it("opens for loggers, deciders with work waiting, and policy admins", () => {
		expect(isTimeNavVisible({ can_log: true })).toBe(true);
		expect(isTimeNavVisible({ can_log: false, approvals_waiting: 3 })).toBe(
			true,
		);
		expect(
			isTimeNavVisible({
				can_log: false,
				approvals_waiting: 0,
				workspace_time_admin: [{ workspace_id: "w1" }],
			}),
		).toBe(true);
	});

	it("stays closed for guests, empty overviews and while loading", () => {
		// A guest's overview is the empty shape with can_log: false.
		expect(
			isTimeNavVisible({
				can_log: false,
				approvals_waiting: 0,
				workspace_time_admin: [],
			}),
		).toBe(false);
		expect(isTimeNavVisible({})).toBe(false);
		expect(isTimeNavVisible(null)).toBe(false);
		expect(isTimeNavVisible(undefined)).toBe(false);
	});
});
