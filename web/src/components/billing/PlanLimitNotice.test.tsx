/* @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

import { buildEntitlements, type WorkspaceUsage } from "@/lib/entitlements";
import { DEFAULT_PLAN_LIMITS } from "@/lib/planLimits";
import {
	featureLimitInfo,
	PlanLimitNotice,
	type PlanLimitNoticeInfo,
} from "./PlanLimitNotice";

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

// ── The time keys (ux.md › Plan copy) ───────────────────────────────────────

const acme = (role: Workspace["my_role"]) => ({
	slug: "acme",
	my_role: role,
	name: "Acme",
});

const timeInfo = (
	limitKey: PlanLimitNoticeInfo["limitKey"],
	overrides: Partial<PlanLimitNoticeInfo> = {},
): PlanLimitNoticeInfo => ({
	limitKey,
	kind: "feature",
	label: "Timesheets and approvals",
	limit: null,
	used: null,
	plan: "free",
	upgradePlan: "pro",
	...overrides,
});

const TIME_KEYS = [
	"time_tracking",
	"time_billable_invoices",
	"time_team_rules",
	"time_payouts",
	"time_reports_export",
	"time_audit_export",
	"time_approval_chains",
] as const;

/**
 * ux.md › Mobile: the app never names these words, shows no amount and links
 * nowhere under /engagements.
 */
const FORBIDDEN =
	/\b(?:contracts?|rates?|payouts?|invoices?|invoic(?:ed|ing))\b/i;
const AMOUNT = /(?:[$€£₱]|\b[A-Z]{3}\s?)\d/;

describe("PlanLimitNotice: time plan copy on the web", () => {
	it("names the tier and the workspace, over the server's own message", () => {
		render(
			<PlanLimitNotice
				info={timeInfo("time_tracking", {
					message: "Timesheets and approvals are available on Pro and above.",
				})}
				workspace={acme("owner")}
			/>,
		);
		expect(document.body.textContent).toContain(
			"Timesheets and approvals are part of Pro. Upgrade Acme to send time for approval.",
		);
		expect(document.body.textContent).not.toContain(
			"available on Pro and above",
		);
		expect(screen.getByRole("link").textContent).toContain("Upgrade to Pro");
	});

	it("falls back to 'your workspace' without a name, and tells a member who to ask", () => {
		render(
			<PlanLimitNotice
				info={timeInfo("time_tracking")}
				workspace={workspace("member")}
			/>,
		);
		expect(document.body.textContent).toContain(
			"Upgrade your workspace to send time for approval.",
		);
		expect(document.body.textContent).toContain(
			"Ask a workspace owner to upgrade.",
		);
		expect(screen.queryByRole("link")).toBeNull();
	});

	it.each([
		[
			"time_billable_invoices",
			"pro",
			"Billing hours on invoices is part of Pro. You can still sign a retainer or fixed-fee contract.",
		],
		[
			"time_team_rules",
			"business",
			"Team approvers and team time rules are part of Business.",
		],
		["time_payouts", "business", "Payouts are part of Business."],
		[
			"time_reports_export",
			"business",
			"Workspace-wide time reports and export are part of Business.",
		],
		[
			"time_audit_export",
			"enterprise",
			"Time audit export is part of Enterprise.",
		],
		[
			"time_approval_chains",
			"enterprise",
			"Custom approval chains: Enterprise",
		],
	] as const)("%s reads ux.md's line", (key, upgradePlan, line) => {
		render(
			<PlanLimitNotice
				info={timeInfo(key, { upgradePlan })}
				workspace={acme("owner")}
			/>,
		);
		expect(document.body.textContent).toContain(line);
		// Tier names only: no price, digit, "per user" or interval.
		expect(document.body.textContent).not.toMatch(/\$|\d|per user|\/month/i);
	});

	it("uses the cut-off line in the billing and pay cut-off editor", () => {
		for (const key of ["time_billable_invoices", "time_payouts"] as const) {
			render(
				<PlanLimitNotice
					info={timeInfo(key)}
					workspace={acme("owner")}
					planCopyContext="cutoffs"
				/>,
			);
			expect(document.body.textContent).toContain(
				"Billing and pay cut-offs are part of Pro (billing) or Business (payouts).",
			);
			cleanup();
		}
	});

	it("still lets a caller's message win", () => {
		render(
			<PlanLimitNotice
				info={timeInfo("time_tracking")}
				workspace={acme("owner")}
				message="Timesheets and approvals come with Pro."
			/>,
		);
		expect(document.body.textContent).toContain(
			"Timesheets and approvals come with Pro.",
		);
		expect(document.body.textContent).not.toContain("Upgrade Acme");
	});

	it("leaves the other keys on the usage copy", () => {
		render(<PlanLimitNotice info={countInfo} workspace={acme("owner")} />);
		expect(document.body.textContent).toContain("At Free's limit.");
		expect(document.body.textContent).not.toContain("Acme");
	});
});

describe("PlanLimitNotice: dismissible", () => {
	it("reports a dismiss and keeps the caller's spacing on the outer box", () => {
		const onDismiss = vi.fn();
		const { container } = render(
			<PlanLimitNotice
				info={timeInfo("time_tracking")}
				workspace={acme("owner")}
				message="Timesheets and approvals come with Pro."
				onDismiss={onDismiss}
				className="mt-4"
			/>,
		);
		const outer = container.firstElementChild as HTMLElement;
		expect(outer.className).toContain("mt-4");
		expect(outer.querySelector('[role="status"]')?.className).not.toContain(
			"mt-4",
		);
		fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
		expect(onDismiss).toHaveBeenCalledTimes(1);
	});

	it("has no dismiss button unless asked", () => {
		render(
			<PlanLimitNotice
				info={timeInfo("time_tracking")}
				workspace={acme("owner")}
			/>,
		);
		expect(screen.queryByRole("button")).toBeNull();
	});
});

describe("PlanLimitNotice: time plan copy in the installed app", () => {
	it("says the workspace's plan lacks it and that an owner changes it on the web", () => {
		mocks.native = true;
		render(
			<PlanLimitNotice
				info={timeInfo("time_tracking")}
				workspace={acme("owner")}
			/>,
		);
		expect(document.body.textContent).toContain(
			"Timesheets and approvals aren't on Acme's current plan. A workspace owner can change this on the web.",
		);
		expect(screen.queryByRole("link")).toBeNull();
	});

	it.each([
		"time_billable_invoices",
		"time_payouts",
		"time_audit_export",
	] as const)(
		"renders nothing at all for %s, whose surface the app hides",
		(key) => {
			mocks.native = true;
			const { container } = render(
				<PlanLimitNotice
					info={timeInfo(key)}
					workspace={acme("owner")}
					message="Payouts are part of Business."
				/>,
			);
			expect(container.innerHTML).toBe("");
		},
	);

	it("never shows a forbidden word, an amount or a link for any time key", () => {
		mocks.native = true;
		for (const key of TIME_KEYS) {
			for (const role of ["owner", "member"] as const) {
				const { container } = render(
					<PlanLimitNotice
						info={timeInfo(key, {
							message: "Upgrade to Business for $20 to record payouts.",
						})}
						workspace={acme(role)}
					/>,
				);
				const text = container.textContent ?? "";
				expect({ key, role, forbidden: FORBIDDEN.test(text) }).toEqual({
					key,
					role,
					forbidden: false,
				});
				expect(text).not.toMatch(AMOUNT);
				expect(container.querySelector('a[href*="/engagements"]')).toBeNull();
				expect(container.querySelector("a")).toBeNull();
				cleanup();
			}
		}
	});

	it("describes a money- or agreement-named feature by its plan alone", () => {
		mocks.native = true;
		render(
			<PlanLimitNotice
				info={{
					limitKey: "contract_counterparty_authoring",
					kind: "feature",
					label: "Client and talent contract authoring",
					limit: null,
					used: null,
					plan: "free",
					upgradePlan: "pro",
				}}
				workspace={acme("owner")}
			/>,
		);
		const text = document.body.textContent ?? "";
		expect(text).toContain("This isn't on the Free plan.");
		expect(text).toContain("It's available on Pro and above.");
		expect(text).not.toMatch(FORBIDDEN);
	});
});

describe("featureLimitInfo for a time key", () => {
	function usage(plan: "free" | "pro"): WorkspaceUsage {
		return {
			workspace_id: "ws-1",
			plan: { effective: plan, source: "default", complimentary: null },
			subscription: null,
			limits: { ...DEFAULT_PLAN_LIMITS[plan] },
			usage: { members: 1, pending_invites: 0, projects: 0, teams: 0 },
			counts_pending_invites: true,
			roadmaps: { largest: null, near_limit: [] },
			features: [
				{
					key: "time_team_rules",
					label: "Team approvers and time rules",
					group: "team",
					enabled: false,
					enforced: true,
					available_on: "business",
				},
			],
			retention_days: 7,
			upgrade_plan: plan === "free" ? "pro" : "business",
			generated_at: "",
		};
	}

	it("names the tier the key arrives on, not the next plan up", () => {
		const info = featureLimitInfo(
			buildEntitlements(usage("free"), "ready"),
			"time_team_rules",
		);
		expect(info).toMatchObject({
			limitKey: "time_team_rules",
			label: "Team approvers and time rules",
			upgradePlan: "business",
		});
		// Without the server's answer, the seed's ladder says the same.
		const fromSeed = featureLimitInfo(
			buildEntitlements(usage("free"), "ready"),
			"time_audit_export",
		);
		expect(fromSeed).toMatchObject({
			label: "Time audit export",
			upgradePlan: "enterprise",
		});
	});

	it("is null where the plan has it, and while usage is unknown", () => {
		expect(
			featureLimitInfo(
				buildEntitlements(usage("pro"), "ready"),
				"time_tracking",
			),
		).toBeNull();
		expect(
			featureLimitInfo(buildEntitlements(null, "loading"), "time_tracking"),
		).toBeNull();
	});
});
