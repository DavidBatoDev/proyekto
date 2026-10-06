/* @vitest-environment jsdom */

import {
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	buildEntitlements,
	type EntitlementsStatus,
	type WorkspaceUsage,
	type WorkspaceUsageFeature,
} from "@/lib/entitlements";
import {
	DEFAULT_PLAN_LIMITS,
	isEnabled,
	LIMIT_DEFINITIONS,
	limitDefinition,
	nextPlanWith,
	type PlanId,
} from "@/lib/planLimits";
import type { Workspace } from "@/services/workspaces.service";
import { WorkspaceUsagePage } from "./WorkspaceUsagePage";

const state = vi.hoisted(() => ({
	role: "owner" as "owner" | "admin" | "member",
	usage: null as WorkspaceUsage | null,
	status: "ready" as EntitlementsStatus,
	refetch: vi.fn(),
}));

function workspace(): Workspace {
	return {
		id: "ws-1",
		name: "Acme",
		slug: "acme",
		previous_slugs: [],
		description: null,
		avatar_url: null,
		created_by: "user-me",
		created_at: "2026-01-01T00:00:00Z",
		updated_at: "2026-01-01T00:00:00Z",
		my_role: state.role,
	};
}

vi.mock("@/hooks/useWorkspaceQueries", () => ({
	useCurrentWorkspace: () => ({
		workspace: workspace(),
		workspaces: [workspace()],
		isLoading: false,
	}),
}));

// Both hooks read the same query in the app; here they read the same fixture.
vi.mock("@/hooks/useEntitlements", () => ({
	useWorkspaceUsageQuery: () => ({
		data: state.usage ?? undefined,
		isLoading: state.status === "loading",
		isError: state.status === "unavailable",
		isFetching: false,
		refetch: state.refetch,
	}),
	useEntitlements: () => buildEntitlements(state.usage, state.status),
}));

vi.mock("@/hooks/usePlanLimits", () => ({
	usePublicPlanLimits: () => ({
		limits: DEFAULT_PLAN_LIMITS,
		isLive: false,
		version: null,
	}),
}));

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
			return createElement("a", { href, className }, children);
		},
	};
});

/** A usage feature; its group is the catalogue's, as the server sends it. */
const feature = (
	key: string,
	label: string,
	enabled: boolean,
	enforced: boolean,
	available_on: WorkspaceUsageFeature["available_on"],
): WorkspaceUsageFeature => ({
	key,
	label,
	group: limitDefinition(key)?.group ?? "governance",
	enabled,
	enforced,
	available_on,
});

/**
 * Every feature key of the catalogue as the usage endpoint lists it for
 * `plan`: in catalogue order, enabled per the seed, `available_on` the first
 * tier above that has it. The backend builds the same list from the DB.
 */
function catalogueFeatures(plan: PlanId): WorkspaceUsageFeature[] {
	return LIMIT_DEFINITIONS.filter((d) => d.kind === "feature").map((d) =>
		feature(
			d.key,
			d.label,
			isEnabled(DEFAULT_PLAN_LIMITS[plan][d.key]),
			d.enforced,
			isEnabled(DEFAULT_PLAN_LIMITS[plan][d.key])
				? null
				: nextPlanWith(d.key, plan, DEFAULT_PLAN_LIMITS),
		),
	);
}

function planUsage(plan: PlanId): WorkspaceUsage {
	return freeUsage({
		plan: { effective: plan, source: "subscription", complimentary: null },
		limits: { ...DEFAULT_PLAN_LIMITS[plan] },
		features: catalogueFeatures(plan),
		upgrade_plan: plan === "enterprise" ? null : "business",
	});
}

/** The Features section, and one of its items by label. */
function featuresSection(): HTMLElement {
	return screen
		.getByRole("heading", { name: "Features" })
		.closest("section") as HTMLElement;
}

function featureItem(label: string): HTMLElement {
	return within(featuresSection())
		.getByText(label)
		.closest("li") as HTMLElement;
}

const PERSONAL_TIME_NOTE = "Everyone can still track time just for themselves.";

function freeUsage(overrides: Partial<WorkspaceUsage> = {}): WorkspaceUsage {
	return {
		workspace_id: "ws-1",
		plan: { effective: "free", source: "default", complimentary: null },
		subscription: { plan: "free", status: null },
		limits: { ...DEFAULT_PLAN_LIMITS.free },
		usage: { members: 3, pending_invites: 2, projects: 2, teams: 1 },
		counts_pending_invites: true,
		roadmaps: {
			largest: {
				roadmap_id: "rm-1",
				name: "Launch plan",
				project_id: "proj-1",
				project_title: "Website",
				nodes: 240,
			},
			near_limit: [
				{
					roadmap_id: "rm-1",
					name: "Launch plan",
					project_id: "proj-1",
					project_title: "Website",
					nodes: 240,
				},
				{
					roadmap_id: "rm-2",
					name: null,
					project_id: "proj-2",
					project_title: null,
					nodes: 210,
				},
				{
					roadmap_id: "rm-3",
					name: "Personal backlog",
					project_id: null,
					project_title: null,
					nodes: 205,
				},
			],
		},
		features: [
			feature("deliverables", "Deliverables", false, true, "pro"),
			feature("change_requests", "Change requests", false, true, "pro"),
			feature("time_tracking", "Timesheets and approvals", false, true, "pro"),
			feature("saml_scim", "SAML and SCIM", false, false, "enterprise"),
		],
		retention_days: 7,
		upgrade_plan: "pro",
		generated_at: "2026-09-22T00:00:00Z",
		...overrides,
	};
}

function proComped(): WorkspaceUsage {
	return freeUsage({
		plan: {
			effective: "pro",
			source: "complimentary",
			complimentary: {
				plan: "pro",
				since: "2026-09-01T00:00:00Z",
				until: null,
			},
		},
		limits: { ...DEFAULT_PLAN_LIMITS.pro },
		roadmaps: { largest: null, near_limit: [] },
		features: [
			feature("deliverables", "Deliverables", true, true, null),
			feature("time_tracking", "Timesheets and approvals", true, true, null),
		],
		retention_days: 90,
		upgrade_plan: "business",
	});
}

/**
 * Matches a whole reading ("2 of 10", "7 days"). The figure and its
 * qualifier are drawn in separate spans, so the phrase is the reading
 * element's full text rather than any one text node.
 */
function reading(text: string) {
	return (_content: string, element: Element | null) =>
		element?.hasAttribute("data-reading") === true &&
		element.textContent === text;
}

/** The Limits row whose label is `label`. */
function limitRow(label: string): HTMLElement {
	const limits = screen
		.getByRole("heading", { name: "Limits" })
		.closest("section") as HTMLElement;
	const row = within(limits).getByText(label).closest("li");
	if (!row) throw new Error(`No limit row for ${label}`);
	return row as HTMLElement;
}

beforeEach(() => {
	state.role = "owner";
	state.usage = freeUsage();
	state.status = "ready";
	state.refetch.mockReset();
});

afterEach(cleanup);

describe("WorkspaceUsagePage", () => {
	it("reads a project count at the limit as blocked, with a danger bar", () => {
		render(<WorkspaceUsagePage />);
		const projects = limitRow("Projects");
		expect(within(projects).getByText(reading("2 of 2"))).toBeTruthy();
		expect(within(projects).getByText(/At Free's limit\./)).toBeTruthy();
		const fill = within(projects)
			.getByRole("progressbar")
			.querySelector("[data-tone]");
		expect(fill?.className).toContain("bg-destructive");
	});

	it("counts pending invites toward members and says so", () => {
		render(<WorkspaceUsagePage />);
		const members = limitRow("Members");
		expect(within(members).getByText(reading("5 of 10"))).toBeTruthy();
		expect(
			within(members).getByText(/Includes 2 pending invites\./),
		).toBeTruthy();
	});

	it("shows Unlimited without a bar when the plan has no cap", () => {
		state.usage = proComped();
		render(<WorkspaceUsagePage />);
		const members = limitRow("Members");
		expect(within(members).getByText("Unlimited")).toBeTruthy();
		expect(within(members).queryByRole("progressbar")).toBeNull();
	});

	it("gives an owner the upgrade link to billing and a plan comparison", () => {
		render(<WorkspaceUsagePage />);
		const upgrade = screen.getByRole("link", { name: "Upgrade to Pro" });
		expect(upgrade.getAttribute("href")).toBe("/w/acme/settings/billing");
		expect(
			screen.getByRole("link", { name: "Compare plans" }).getAttribute("href"),
		).toBe("/pricing");
	});

	it.each(["member", "admin"] as const)(
		"points a %s at a workspace owner instead",
		(role) => {
			state.role = role;
			render(<WorkspaceUsagePage />);
			expect(
				screen.getByText("Ask a workspace owner to upgrade."),
			).toBeTruthy();
			expect(screen.queryByRole("link", { name: /Upgrade to/ })).toBeNull();
		},
	);

	it("badges a complimentary plan and offers no upgrade", () => {
		state.usage = proComped();
		render(<WorkspaceUsagePage />);
		expect(screen.getByText("Complimentary")).toBeTruthy();
		expect(
			screen.getByText(/Proyekto covers this workspace's Pro plan\./),
		).toBeTruthy();
		expect(screen.queryByRole("link", { name: /Upgrade to/ })).toBeNull();
		expect(screen.queryByText(/Ask a workspace owner/)).toBeNull();
	});

	it("offers nothing on Enterprise, where there is no plan above", () => {
		state.usage = freeUsage({
			plan: {
				effective: "enterprise",
				source: "subscription",
				complimentary: null,
			},
			limits: { ...DEFAULT_PLAN_LIMITS.enterprise },
			upgrade_plan: null,
		});
		render(<WorkspaceUsagePage />);
		expect(screen.queryByRole("link", { name: /Upgrade to/ })).toBeNull();
		expect(screen.queryByText(/Ask a workspace owner/)).toBeNull();
	});

	it("lists only enforced features, with the plan that brings each one", () => {
		render(<WorkspaceUsagePage />);
		const features = screen
			.getByRole("heading", { name: "Features" })
			.closest("section") as HTMLElement;
		const deliverables = within(features)
			.getByText("Deliverables")
			.closest("li") as HTMLElement;
		expect(within(deliverables).getByText("Available on Pro")).toBeTruthy();
		expect(within(features).queryByText("SAML and SCIM")).toBeNull();
	});

	it("marks features the plan includes", () => {
		state.usage = proComped();
		render(<WorkspaceUsagePage />);
		const features = screen
			.getByRole("heading", { name: "Features" })
			.closest("section") as HTMLElement;
		expect(within(features).getAllByText("Included")).toHaveLength(2);
	});

	it("shows the largest roadmap and the others near the limit", () => {
		render(<WorkspaceUsagePage />);
		const largest = screen.getByRole("link", { name: "Launch plan" });
		expect(largest.getAttribute("href")).toBe("/project/proj-1/roadmap/rm-1");
		// Once only, although the payload lists it under near_limit as well.
		expect(screen.getAllByText("Launch plan")).toHaveLength(1);
		expect(screen.getByText(reading("240 of 250"))).toBeTruthy();
		expect(screen.getByText("Also near the limit")).toBeTruthy();

		// A roadmap the viewer cannot open is named as such and never linked.
		const hidden = screen.getByText("A roadmap you can't open");
		expect(hidden.closest("a")).toBeNull();
		// An unlinked roadmap has no project to link into.
		expect(screen.getByText("Personal backlog").closest("a")).toBeNull();
		expect(screen.getByText(reading("205 of 250"))).toBeTruthy();
	});

	it("says there are no roadmaps when the workspace has none", () => {
		state.usage = proComped();
		render(<WorkspaceUsagePage />);
		expect(screen.getByText("No roadmaps in this workspace yet.")).toBeTruthy();
	});

	it("explains activity retention without implying anything is lost", () => {
		render(<WorkspaceUsagePage />);
		expect(
			screen.getByText(/Free shows the last 7 days of activity\./),
		).toBeTruthy();
		expect(screen.getByText(/Older activity is kept/)).toBeTruthy();
	});

	it("reads the visible activity history as a value", () => {
		render(<WorkspaceUsagePage />);
		const history = screen
			.getByText("Visible history")
			.closest("section") as HTMLElement;
		expect(within(history).getByText(reading("7 days"))).toBeTruthy();
	});

	it("lays the page out without card chrome", () => {
		const { container } = render(<WorkspaceUsagePage />);
		expect(container.querySelector(".rounded-2xl")).toBeNull();
		expect(container.querySelector(".bg-card")).toBeNull();
		expect(container.querySelector("[class*='shadow']")).toBeNull();
		expect(container.querySelector("[class*='bg-primary-dark']")).toBeNull();
	});

	it("shows a skeleton while usage loads", () => {
		state.usage = null;
		state.status = "loading";
		render(<WorkspaceUsagePage />);
		expect(screen.getByRole("status").textContent).toBe("Loading usage");
		expect(screen.queryByText("Current plan")).toBeNull();
	});

	it("shows an error notice with a retry when usage cannot load", () => {
		state.usage = null;
		state.status = "unavailable";
		render(<WorkspaceUsagePage />);
		expect(screen.getByText(/Usage is unavailable right now\./)).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Try again" }));
		expect(state.refetch).toHaveBeenCalledTimes(1);
	});
});

describe("WorkspaceUsagePage: the time ladder", () => {
	const TIME_LADDER: [label: string, arrivesOn: string][] = [
		["Timesheets and approvals", "Available on Pro"],
		["Billable hours on invoices", "Available on Pro"],
		["Team approvers and time rules", "Available on Business"],
		["Payouts", "Available on Business"],
		["Workspace time reports and export", "Available on Business"],
		["Time audit export", "Available on Enterprise"],
	];

	it("lists each enforced time key on Free with the tier that brings it", () => {
		state.usage = planUsage("free");
		render(<WorkspaceUsagePage />);
		for (const [label, arrivesOn] of TIME_LADDER) {
			expect([label, within(featureItem(label)).getByText(arrivesOn)]).toEqual([
				label,
				expect.anything(),
			]);
		}
		// Reserved (enforced: false), so it describes no gate and is not listed.
		expect(
			within(featuresSection()).queryByText("Custom approval chains"),
		).toBeNull();
	});

	it("says the personal timer stays when timesheets are not on the plan", () => {
		state.usage = planUsage("free");
		render(<WorkspaceUsagePage />);
		expect(
			within(featureItem("Timesheets and approvals")).getByText(
				PERSONAL_TIME_NOTE,
			),
		).toBeTruthy();
		// Only under that one key.
		expect(screen.getAllByText(PERSONAL_TIME_NOTE)).toHaveLength(1);
	});

	it("marks Pro's time keys included and points at Business for the rest", () => {
		state.usage = planUsage("pro");
		render(<WorkspaceUsagePage />);
		for (const label of [
			"Timesheets and approvals",
			"Billable hours on invoices",
		]) {
			expect(within(featureItem(label)).getByText("Included")).toBeTruthy();
		}
		expect(
			within(featureItem("Payouts")).getByText("Available on Business"),
		).toBeTruthy();
		expect(screen.queryByText(PERSONAL_TIME_NOTE)).toBeNull();
	});

	it("includes every time key on Enterprise", () => {
		state.usage = planUsage("enterprise");
		render(<WorkspaceUsagePage />);
		for (const [label] of TIME_LADDER) {
			expect(within(featureItem(label)).getByText("Included")).toBeTruthy();
		}
	});

	it("groups the features under headings, in catalogue order", () => {
		state.usage = planUsage("free");
		render(<WorkspaceUsagePage />);
		const headings = within(featuresSection())
			.getAllByRole("heading", { level: 3 })
			.map((heading) => heading.textContent);
		expect(headings).toEqual([
			"Delivery governance",
			"Teams and time",
			"Platform",
		]);
		const time = within(featuresSection()).getByRole("list", {
			name: "Teams and time",
		});
		expect(
			within(time)
				.getAllByRole("listitem")
				.map((item) => item.querySelector("p")?.textContent),
		).toEqual(TIME_LADDER.map(([label]) => label));
	});

	it("draws no group heading when only one group is listed", () => {
		state.usage = freeUsage({
			features: [
				feature("deliverables", "Deliverables", false, true, "pro"),
				feature("risks", "Risks and issues register", false, true, "pro"),
			],
		});
		render(<WorkspaceUsagePage />);
		expect(
			within(featuresSection()).queryAllByRole("heading", { level: 3 }),
		).toHaveLength(0);
	});

	it("builds the ladder from the catalogue when an older payload has no list", () => {
		state.usage = freeUsage({ features: [] });
		render(<WorkspaceUsagePage />);
		expect(
			within(featuresSection()).getByRole("list", { name: "Teams and time" }),
		).toBeTruthy();
		expect(
			within(featureItem("Team approvers and time rules")).getByText(
				"Available on Business",
			),
		).toBeTruthy();
		expect(
			within(featureItem("Time audit export")).getByText(
				"Available on Enterprise",
			),
		).toBeTruthy();
	});
});
