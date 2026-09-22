/* @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Workspace } from "@/services/workspaces.service";

const mocks = vi.hoisted(() => ({ native: false }));

vi.mock("@/lib/platform", () => ({ isNativeApp: () => mocks.native }));
// The notice renders a router Link for the upgrade action; the test only cares
// whether an anchor exists, not where the router would take it.
vi.mock("@tanstack/react-router", () => ({
	Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
		<a href={to}>{children}</a>
	),
}));

import { PlanLimitNotice, type PlanLimitNoticeInfo } from "./PlanLimitNotice";

const workspace = (role: Workspace["my_role"]) =>
	({ slug: "acme", my_role: role }) as Pick<Workspace, "slug" | "my_role">;

const countInfo: PlanLimitNoticeInfo = {
	limitKey: "projects",
	kind: "count",
	label: "Projects",
	limit: 2,
	used: 2,
	plan: "free",
	upgradePlan: "pro",
};

const featureInfo: PlanLimitNoticeInfo = {
	limitKey: "time_tracking",
	kind: "feature",
	label: "Time tracking",
	limit: null,
	used: null,
	plan: "free",
	upgradePlan: "pro",
};

afterEach(() => {
	cleanup();
	mocks.native = false;
});

describe("PlanLimitNotice", () => {
	it("gives an owner an upgrade link in a browser", () => {
		render(<PlanLimitNotice info={countInfo} workspace={workspace("owner")} />);

		const link = screen.getByRole("link");
		expect(link).toHaveProperty("textContent", expect.stringContaining("Pro"));
		expect(link.getAttribute("href")).toBe(
			"/w/$workspaceSlug/settings/billing",
		);
	});

	describe("in the installed app", () => {
		// Billing is not in the app, so this component must render no route out
		// of here. It is mounted in five places (members panel, create-team
		// modal, teams list, team time settings, new project), so covering it
		// once covers all of them.
		it.each([
			["a count limit", countInfo],
			["a feature limit", featureInfo],
		])("renders no link at all for %s", (_label, info) => {
			mocks.native = true;
			render(<PlanLimitNotice info={info} workspace={workspace("owner")} />);

			expect(screen.queryByRole("link")).toBeNull();
			expect(document.body.textContent).toContain(
				"Plan changes aren't available",
			);
			expect(document.body.textContent).not.toMatch(/upgrade to/i);
		});

		it("does not repeat a server message it cannot vouch for", () => {
			mocks.native = true;
			render(
				<PlanLimitNotice
					info={{ ...featureInfo, message: "Upgrade to Pro for $10/seat." }}
					workspace={workspace("owner")}
				/>,
			);

			expect(document.body.textContent).not.toContain("$10");
			expect(screen.queryByRole("link")).toBeNull();
		});

		it("still names what was blocked", () => {
			mocks.native = true;
			render(
				<PlanLimitNotice info={countInfo} workspace={workspace("owner")} />,
			);

			expect(document.body.textContent).toMatch(/project/i);
		});
	});
});
