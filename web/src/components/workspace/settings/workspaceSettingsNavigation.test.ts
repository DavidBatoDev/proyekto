import { describe, expect, it } from "vitest";
import { workspaceSettingsNavItems } from "./workspaceSettingsNavigation";

const labels = (isNative: boolean) =>
	workspaceSettingsNavItems("acme", "/settings", isNative).map(
		(item) => item.label,
	);

describe("workspaceSettingsNavItems", () => {
	it("shows every tab in a browser", () => {
		expect(labels(false)).toEqual([
			"General",
			"Members",
			"Time",
			"Usage",
			"Billing",
		]);
	});

	it("drops Usage and Billing in the installed app", () => {
		// Both are commerce surfaces. The layout renders this list twice — the
		// desktop rail and the mobile tab strip — so filtering the data is what
		// stops the two renders drifting apart.
		expect(labels(true)).toEqual(["General", "Members", "Time"]);
	});

	it("puts Time between Members and Usage and keeps it in the app", () => {
		// ux.md › Workspace Time Policy: owners and admins edit, members read.
		// `/settings` is an app surface, so the time policy stays on mobile.
		const items = workspaceSettingsNavItems("acme", "/settings", false);
		const index = items.findIndex((item) => item.label === "Time");
		expect(items[index - 1]?.label).toBe("Members");
		expect(items[index + 1]?.label).toBe("Usage");
		expect(items[index]?.to).toBe("/w/acme/settings/time");
		expect(
			workspaceSettingsNavItems("acme", "/settings", true).some(
				(item) => item.to === "/w/acme/settings/time",
			),
		).toBe(true);
	});

	it("lights Time on its own page only", () => {
		const active = (path: string) =>
			workspaceSettingsNavItems("acme", path, false)
				.filter((item) => item.active)
				.map((item) => item.label);
		expect(active("/settings/time")).toEqual(["Time"]);
		expect(active("/settings/time/")).toEqual(["Time"]);
		// Segment-safe: a sibling that merely starts with "time" is not Time.
		expect(active("/settings/timeline")).toEqual([]);
		expect(active("/settings/usage")).toEqual(["Usage"]);
	});

	it("keeps the workspace slug in every link", () => {
		for (const item of workspaceSettingsNavItems("acme", "/settings", false)) {
			expect(item.to.startsWith("/w/acme/settings")).toBe(true);
		}
	});

	it("marks only the current tab active", () => {
		const onMembers = workspaceSettingsNavItems(
			"acme",
			"/settings/members",
			false,
		);
		expect(onMembers.filter((item) => item.active).map((i) => i.label)).toEqual(
			["Members"],
		);

		// General is exact: the pages below it must not light it up.
		const general = onMembers.find((item) => item.label === "General");
		expect(general?.active).toBe(false);
		expect(general?.exact).toBe(true);
	});
});
