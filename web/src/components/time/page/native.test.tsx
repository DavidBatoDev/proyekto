/* @vitest-environment jsdom */

// Native copy rules (ux.md › Mobile; web blueprint §4): in the installed app
// the Time page pieces never say contract, rate, payout or invoice, never
// show an amount on agreement time and never link to /engagements.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform", () => ({ isNativeApp: () => true }));
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
vi.mock("@/hooks/useEntitlements", () => ({
	useEntitlements: () => ({
		status: "ready",
		usage: { workspace_id: "w1", features: [] },
		plan: "free",
		upgradePlan: "pro",
		isComplimentary: false,
		hasFeature: () => false,
	}),
}));

vi.mock("@/hooks/useWorkspaceQueries", () => ({
	useMyWorkspacesQuery: () => ({ data: [{ id: "w2", my_role: "owner" }] }),
}));

import { timeService } from "@/services/time.service";
import type {
	ResolvedTimePolicy,
	WorkspaceTimeAdmin,
} from "@/services/time.types";
import { useAuthStore } from "@/stores/authStore";
import { LegacyGroupingBanner } from "./LegacyGroupingBanner";
import { LimitBanner, TimePlanBanner } from "./LimitBanner";
import { PolicyConfirmCard } from "./PolicyConfirmCard";
import { PolicySummaryCards } from "./PolicySummaryCards";
import { type TimeEmptyKind, TimeEmptyState } from "./TimeEmptyStates";
import { TimePrefsMenu } from "./TimePrefsMenu";
import { WhyPersonalPopover } from "./WhyPersonalPopover";

const BANNED = /\b(contracts?|rates?|payouts?|invoices?)\b/i;
const AMOUNT = /\b[A-Z]{3}\s?[\d,]+(\.\d+)?\b|[$€£₱]\s?\d/;

function assertNativeSafe(root: HTMLElement = document.body) {
	const text = root.textContent ?? "";
	expect(text).not.toMatch(BANNED);
	expect(text).not.toMatch(AMOUNT);
	for (const el of Array.from(root.querySelectorAll("[title], [aria-label]"))) {
		expect(el.getAttribute("title") ?? "").not.toMatch(BANNED);
		expect(el.getAttribute("aria-label") ?? "").not.toMatch(BANNED);
	}
	expect(root.querySelector('a[href*="/engagements"]')).toBeNull();
}

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
		retroactive_days: 7,
		rounding_minutes: 15,
		weekly_limit_minutes: 2400,
		reminder_days: 1,
		hidden_presets: [],
		tracking_mode: null,
		sources: { weekly_limit_minutes: "contract" },
		plan: { time_tracking: true, time_team_rules: true },
		policy_workspace_id: "w1",
		team_override_applied: false,
		member: null,
		client_hours_detail_level: null,
		...over,
	};
}

const admins: WorkspaceTimeAdmin[] = [
	{
		workspace_id: "w1",
		name: "Acme",
		slug: "acme",
		has_time_tracking: true,
		policy_unconfirmed: true,
	},
	{
		workspace_id: "w2",
		name: "Pixel Studio",
		slug: "pixel",
		has_time_tracking: false,
		policy_unconfirmed: false,
	},
];

function withClient(children: ReactNode) {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
	window.localStorage.clear();
	useAuthStore.setState({ user: { id: "u1" } as never });
	vi.spyOn(timeService, "getWorkspacePolicy").mockImplementation(
		async (id) => ({
			workspace_id: id,
			policy:
				id === "w1"
					? policy()
					: policy({
							plan: { time_tracking: false, time_team_rules: false },
						}),
			policy_unconfirmed: id === "w1",
			can_edit: true,
		}),
	);
	vi.spyOn(timeService, "getPreferences").mockResolvedValue({
		user_id: "u1",
		timezone: "Asia/Manila",
		week_start: 1,
		updated_at: "2026-10-01T00:00:00Z",
	});
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	useAuthStore.setState({ user: null });
});

describe("Time page pieces on native", () => {
	it("empty states", () => {
		const kinds: TimeEmptyKind[] = [
			"start",
			"team",
			"caught_up",
			"placed",
			"filtered",
		];
		for (const kind of kinds) {
			render(
				<TimeEmptyState
					kind={kind}
					label="Acme Corp"
					onStartTimer={() => {}}
					onAddTime={() => {}}
				/>,
			);
		}
		assertNativeSafe();
	});

	it("Why? with every ruled-out reason", async () => {
		render(
			<WhyPersonalPopover
				reason="no_governed_option"
				unavailable={[
					{ kind: "team", id: "t1", label: "Design", reason: "team_time_off" },
					{ kind: "workspace", id: "w1", label: "Acme", reason: "plan" },
					{
						kind: "assignment",
						id: "a1",
						label: "Acme Corp",
						reason: "contract_disabled",
					},
					{
						kind: "assignment",
						id: "a2",
						label: "Pixel",
						reason: "engagement_inactive",
					},
					{
						kind: "assignment",
						id: "a3",
						label: "Orbit",
						reason: "no_settings",
					},
				]}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Why?" }));
		const dialog = await screen.findByRole("dialog");
		expect(dialog.textContent).toContain(
			"Time tracking is off in your agreement with Acme Corp.",
		);
		assertNativeSafe();
	});

	it("limit banner: agreement, member and policy limits", () => {
		render(
			<LimitBanner
				readings={[
					{
						source: "agreement",
						window: "weekly",
						label: "Acme Corp",
						limitMinutes: 2400,
						loggedSeconds: 43.5 * 3600,
					},
					{
						source: "member",
						window: "monthly",
						label: "Design",
						limitMinutes: 9600,
						loggedSeconds: 100 * 3600,
					},
					{
						source: "policy",
						window: "weekly",
						label: "Prodigitality",
						limitMinutes: 2400,
						loggedSeconds: 10 * 3600,
					},
				]}
			/>,
		);
		expect(screen.getByTestId("time-limit-banner").textContent).toContain(
			"Weekly limit 40h in the agreement with Acme Corp",
		);
		assertNativeSafe();
	});

	it("plan notice: the native line, no upgrade link", () => {
		render(
			<>
				<TimePlanBanner
					workspace={{ id: "w1", name: "Acme", slug: "acme", my_role: "owner" }}
					logsHere
				/>
				<TimePlanBanner
					workspace={{
						id: "w9",
						name: "Orbit",
						slug: "orbit",
						my_role: "member",
					}}
					downgraded
				/>
			</>,
		);
		const banners = screen.getAllByTestId("time-plan-banner");
		expect(banners[0].textContent).toContain(
			"Timesheets and approvals aren't on Acme's current plan. A workspace owner can change this on the web.",
		);
		expect(banners[1].textContent).toContain(
			"Orbit's plan no longer includes timesheets.",
		);
		expect(screen.queryByRole("link", { name: /Upgrade/ })).toBeNull();
		// The native sentence says where the plan changes; no second line.
		expect(banners[0].textContent).not.toContain(
			"Plan changes aren't available",
		);
		assertNativeSafe();
	});

	it("policy confirm and summary cards", async () => {
		render(
			withClient(
				<>
					<PolicyConfirmCard admins={admins} timeZone="Asia/Manila" />
					<PolicySummaryCards admins={admins} />
				</>,
			),
		);
		expect(
			await screen.findByText(
				"Acme tracks time weekly from Monday in Asia/Manila.",
			),
		).toBeTruthy();
		expect(
			await screen.findByText("Pixel Studio · Workspace time off"),
		).toBeTruthy();
		// The plan notice speaks the app's wording, with no upgrade link.
		expect(screen.queryByRole("link", { name: /Upgrade/ })).toBeNull();
		assertNativeSafe();
	});

	it("legacy banner and the ⚙ menu", async () => {
		render(
			withClient(
				<>
					<LegacyGroupingBanner sheets={[{ origin: "legacy_migration" }]} />
					<TimePrefsMenu />
				</>,
			),
		);
		const trigger = screen.getByRole("button", { name: "Your time settings" });
		await waitFor(() =>
			expect(trigger.getAttribute("title")).toContain("Asia/Manila"),
		);
		fireEvent.click(trigger);
		await screen.findByRole("dialog");
		assertNativeSafe();
	});
});
