/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform", () => ({ isNativeApp: () => false }));
vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@tanstack/react-router")>();
	return {
		...actual,
		Link: ({
			children,
			to,
			params,
			className,
		}: {
			children?: ReactNode;
			to: string;
			params?: Record<string, string>;
			className?: string;
		}) => {
			let href = to;
			for (const [key, value] of Object.entries(params ?? {})) {
				href = href.replace(`$${key}`, value);
			}
			return (
				<a href={href} className={className}>
					{children}
				</a>
			);
		},
	};
});

// Usage is unknown unless a test says otherwise (the plain sentence stands in).
const ent = vi.hoisted(() => ({
	value: null as null | Record<string, unknown>,
}));
vi.mock("@/hooks/useEntitlements", () => ({
	useEntitlements: () =>
		ent.value ?? {
			status: "unavailable",
			usage: null,
			plan: null,
			isComplimentary: false,
			hasFeature: () => true,
		},
}));
const mine = vi.hoisted(() => ({
	data: [] as Array<{ id: string; my_role: string }>,
}));
vi.mock("@/hooks/useWorkspaceQueries", () => ({
	useMyWorkspacesQuery: () => ({ data: mine.data }),
}));

import { timeService } from "@/services/time.service";
import type {
	ResolvedTimePolicy,
	WorkspacePolicyView,
	WorkspaceTimeAdmin,
} from "@/services/time.types";
import { PolicySummaryCards, policySummaryParts } from "./PolicySummaryCards";

function policy(over: Partial<ResolvedTimePolicy> = {}): ResolvedTimePolicy {
	return {
		tracking_enabled: true,
		period_kind: "weekly",
		week_start: 1,
		timezone: "Asia/Manila",
		period_anchor: null,
		approval_required: true,
		approver_scope: "workspace",
		allow_manual_entries: true,
		retroactive_days: null,
		rounding_minutes: 0,
		weekly_limit_minutes: null,
		reminder_days: 1,
		hidden_presets: [],
		tracking_mode: null,
		sources: {},
		plan: { time_tracking: true, time_team_rules: false },
		policy_workspace_id: "w1",
		team_override_applied: false,
		member: null,
		client_hours_detail_level: null,
		...over,
	};
}

function view(id: string, over: Partial<ResolvedTimePolicy> = {}) {
	return {
		workspace_id: id,
		policy: policy(over),
		policy_unconfirmed: false,
		can_edit: true,
	} satisfies WorkspacePolicyView;
}

function admin(over: Partial<WorkspaceTimeAdmin> = {}): WorkspaceTimeAdmin {
	return {
		workspace_id: "w1",
		name: "Acme",
		slug: "acme",
		has_time_tracking: true,
		policy_unconfirmed: false,
		...over,
	};
}

function withClient(children: ReactNode) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	ent.value = null;
	mine.data = [];
});

const freePlan = {
	status: "ready",
	usage: { workspace_id: "w1", features: [] },
	plan: "free",
	isComplimentary: false,
	hasFeature: () => false,
};

describe("policySummaryParts", () => {
	it("reads like the ux.md card", () => {
		expect(policySummaryParts("Acme", policy()).join(" · ")).toBe(
			"Acme · Weekly · starts Monday · Asia/Manila · Approval required",
		);
	});

	it("drops the week start for half-month and monthly periods", () => {
		expect(
			policySummaryParts(
				"Acme",
				policy({ period_kind: "semi_monthly", approval_required: false }),
			),
		).toEqual(["Acme", "Twice a month", "Asia/Manila", "Approval off"]);
		expect(
			policySummaryParts(
				"Acme",
				policy({ period_kind: "biweekly", week_start: 7 }),
			),
		).toEqual([
			"Acme",
			"Every two weeks",
			"starts Sunday",
			"Asia/Manila",
			"Approval required",
		]);
	});

	it("workspace time off, by switch or by plan", () => {
		expect(
			policySummaryParts("Prodigitality", policy({ tracking_enabled: false })),
		).toEqual(["Prodigitality", "Workspace time off"]);
		expect(
			policySummaryParts(
				"Acme",
				policy({ plan: { time_tracking: false, time_team_rules: false } }),
			),
		).toEqual(["Acme", "Workspace time off"]);
	});
});

describe("PolicySummaryCards", () => {
	it("one card per workspace with Edit time policy", async () => {
		vi.spyOn(timeService, "getWorkspacePolicy").mockImplementation(
			async (id) =>
				id === "w1"
					? view("w1")
					: view(id, {
							tracking_enabled: false,
						}),
		);
		render(
			withClient(
				<PolicySummaryCards
					admins={[
						admin(),
						admin({ workspace_id: "w2", name: "Prodigitality", slug: "pdg" }),
					]}
				/>,
			),
		);
		expect(
			await screen.findByText(
				"Acme · Weekly · starts Monday · Asia/Manila · Approval required",
			),
		).toBeTruthy();
		expect(
			await screen.findByText("Prodigitality · Workspace time off"),
		).toBeTruthy();
		const links = screen.getAllByRole("link", { name: "Edit time policy" });
		expect(links.map((link) => link.getAttribute("href"))).toEqual([
			"/w/acme/settings/time",
			"/w/pdg/settings/time",
		]);
	});

	it("a workspace whose plan has no timesheets says so under the line", async () => {
		vi.spyOn(timeService, "getWorkspacePolicy").mockResolvedValue(
			view("w1", { plan: { time_tracking: false, time_team_rules: false } }),
		);
		render(
			withClient(
				<PolicySummaryCards admins={[admin({ has_time_tracking: false })]} />,
			),
		);
		expect(await screen.findByText("Acme · Workspace time off")).toBeTruthy();
		expect(
			screen.getByText(
				"Timesheets and approvals are part of Pro. Upgrade Acme to send time for approval.",
			),
		).toBeTruthy();
	});

	it("with usage known, the plan line is the plan notice: the owner gets the upgrade link", async () => {
		ent.value = freePlan;
		mine.data = [{ id: "w1", my_role: "owner" }];
		vi.spyOn(timeService, "getWorkspacePolicy").mockResolvedValue(
			view("w1", { plan: { time_tracking: false, time_team_rules: false } }),
		);
		render(
			withClient(
				<PolicySummaryCards admins={[admin({ has_time_tracking: false })]} />,
			),
		);
		expect(
			await screen.findByText(
				"Timesheets and approvals are part of Pro. Upgrade Acme to send time for approval.",
			),
		).toBeTruthy();
		expect(
			screen.getByRole("link", { name: /Upgrade to Pro/ }).getAttribute("href"),
		).toBe("/w/acme/settings/billing");
	});

	it("an admin who isn't the owner is told to ask one", async () => {
		ent.value = freePlan;
		mine.data = [{ id: "w1", my_role: "admin" }];
		vi.spyOn(timeService, "getWorkspacePolicy").mockResolvedValue(
			view("w1", { plan: { time_tracking: false, time_team_rules: false } }),
		);
		render(
			withClient(
				<PolicySummaryCards admins={[admin({ has_time_tracking: false })]} />,
			),
		);
		expect(
			await screen.findByText("Ask a workspace owner to upgrade."),
		).toBeTruthy();
		expect(screen.queryByRole("link", { name: /Upgrade to/ })).toBeNull();
	});

	it("names the workspace while its policy loads, and renders nothing without admins", () => {
		vi.spyOn(timeService, "getWorkspacePolicy").mockReturnValue(
			new Promise(() => {}),
		);
		const { rerender, container } = render(
			withClient(<PolicySummaryCards admins={[admin()]} />),
		);
		expect(screen.getByTestId("policy-summary-card").textContent).toContain(
			"Acme",
		);
		rerender(withClient(<PolicySummaryCards admins={[]} />));
		expect(container.innerHTML).toBe("");
	});
});
