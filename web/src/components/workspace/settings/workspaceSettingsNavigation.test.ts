import { describe, expect, it } from "vitest";
import { workspaceSettingsNavItems } from "./workspaceSettingsNavigation";

const labels = (isNative: boolean) =>
	workspaceSettingsNavItems("acme", "/settings", isNative).map(
		(item) => item.label,
	);

describe("workspaceSettingsNavItems", () => {
	it("shows every tab in a browser", () => {
		expect(labels(false)).toEqual(["General", "Members", "Usage", "Billing"]);
	});

	it("drops Usage and Billing in the installed app", () => {
		// Both are commerce surfaces. The layout renders this list twice — the
		// desktop rail and the mobile tab strip — so filtering the data is what
		// stops the two renders drifting apart.
		expect(labels(true)).toEqual(["General", "Members"]);
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
