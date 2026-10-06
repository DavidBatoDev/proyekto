/* @vitest-environment jsdom */

// Native copy rules (ux.md › Mobile; web blueprint §4) for Team settings ›
// Time: no contract, rate, payout or invoice; no amounts; no /engagements
// links. Team rules stay on the app (a lead sets the team's period there);
// the Money section is web only and renders nothing.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceEntitlements } from "@/lib/entitlements";

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

const toast = vi.hoisted(() => ({
	success: vi.fn(),
	error: vi.fn(),
	warning: vi.fn(),
	info: vi.fn(),
}));
vi.mock("@/hooks/useToast", () => ({ useToast: () => toast }));

const ents = vi.hoisted(() => ({ features: {} as Record<string, boolean> }));
vi.mock("@/hooks/useEntitlements", () => ({
	useEntitlements: (): WorkspaceEntitlements =>
		({
			status: "ready",
			usage: { workspace_id: "w1", features: [] },
			plan: "pro",
			planName: "Pro",
			planSource: null,
			isComplimentary: false,
			limits: null,
			upgradePlan: null,
			usedFor: () => null,
			meter: () => null,
			remaining: () => null,
			canCreate: () => true,
			hasFeature: (key: string) => ents.features[key] ?? true,
		}) as unknown as WorkspaceEntitlements,
}));

import { TimeApiError, timeService } from "@/services/time.service";
import type {
	ResolvedTimePolicy,
	TeamPolicyOverride,
	TeamPolicyView,
} from "@/services/time.types";
import { TeamMoneySection } from "./TeamMoneySection";
import { TEAM_RULES_COPY, TeamRulesSection } from "./TeamRulesSection";

const BANNED = /\b(contracts?|rates?|payouts?|invoices?)\b/i;
const AMOUNT = /\b[A-Z]{3}\s?[\d,]+(\.\d+)?\b|[$€£₱]\s?\d/;

function assertNativeSafe() {
	const text = document.body.textContent ?? "";
	expect(text).not.toMatch(BANNED);
	expect(text).not.toMatch(AMOUNT);
	for (const el of Array.from(
		document.body.querySelectorAll("[title],[aria-label]"),
	)) {
		expect(el.getAttribute("title") ?? "").not.toMatch(BANNED);
		expect(el.getAttribute("aria-label") ?? "").not.toMatch(BANNED);
	}
	expect(document.body.querySelector('a[href*="/engagements"]')).toBeNull();
}

const NOW = new Date("2026-10-06T03:00:00.000Z");
const WORKSPACE = {
	id: "w1",
	name: "Acme",
	slug: "acme",
	my_role: "owner" as const,
};

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
		sources: {},
		plan: { time_tracking: true, time_team_rules: true },
		policy_workspace_id: "w1",
		team_override_applied: false,
		member: null,
		client_hours_detail_level: null,
		...over,
	};
}

function view(over: Partial<TeamPolicyView> = {}): TeamPolicyView {
	return {
		team_id: "t1",
		override: null,
		effective: policy(),
		can_edit_money_fields: true,
		has_team_rules: true,
		...over,
	};
}

let client: QueryClient;

beforeEach(() => {
	client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	ents.features = {};
});

afterEach(() => {
	cleanup();
	client.clear();
	vi.restoreAllMocks();
	vi.clearAllMocks();
});

function renderRules(memberRatesEnabled: boolean) {
	return render(
		<QueryClientProvider client={client}>
			<TeamRulesSection
				teamId="t1"
				workspace={WORKSPACE}
				memberRatesEnabled={memberRatesEnabled}
				now={NOW}
			/>
		</QueryClientProvider>,
	);
}

describe("native: Team settings › Time", () => {
	it("team rules with member rates on say approval stays on without naming rates", async () => {
		vi.spyOn(timeService, "getTeamPolicy").mockResolvedValue(
			view({
				override: {
					approver_scope: "team",
					period_kind: "semi_monthly",
				} as TeamPolicyOverride,
			}),
		);
		renderRules(true);
		await screen.findByTestId("team-rules");
		expect(
			screen.getByText(TEAM_RULES_COPY.approvalStaysOnNative),
		).toBeTruthy();
		expect(screen.queryByText(TEAM_RULES_COPY.approvalStaysOn)).toBeNull();
		// Open every editor the owner can reach, so their labels are swept too.
		for (const button of screen.getAllByRole("button", { name: "Override" })) {
			fireEvent.click(button);
		}
		assertNativeSafe();
	});

	it("the plan notice for team rules is the native line, with saved rules kept", async () => {
		ents.features = { time_team_rules: false };
		vi.spyOn(timeService, "getTeamPolicy").mockResolvedValue(
			view({
				has_team_rules: false,
				override: { rounding_minutes: 15 } as TeamPolicyOverride,
			}),
		);
		renderRules(false);
		await screen.findByTestId("team-rules");
		expect(
			screen.getByText("Team time rules aren't on Acme's current plan."),
		).toBeTruthy();
		expect(
			screen.getByText("Saved rules apply again when Acme is on Business."),
		).toBeTruthy();
		// No upgrade link in the app.
		expect(document.body.querySelector("a")).toBeNull();
		assertNativeSafe();
	});

	it("a refused approval switch toasts the native sentence", async () => {
		vi.spyOn(timeService, "getTeamPolicy").mockResolvedValue(view());
		vi.spyOn(timeService, "updateTeamPolicy").mockRejectedValue(
			new TimeApiError({
				status: 422,
				code: "TEAM_RATES_REQUIRE_APPROVAL",
				message: "Approval stays on while member rates are on.",
			}),
		);
		renderRules(false);
		await screen.findByTestId("team-rules");
		const approvalRow = document.querySelector(
			'[data-row="team-rule-approval"]',
		) as HTMLElement;
		fireEvent.click(
			approvalRow.querySelector("button") as HTMLButtonElement, // Override
		);
		fireEvent.click(
			screen.getByRole("switch", { name: TEAM_RULES_COPY.approval }),
		);
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		await vi.waitFor(() =>
			expect(toast.error).toHaveBeenCalledWith(
				"Approval has to stay on for this team.",
			),
		);
		for (const [message] of toast.error.mock.calls) {
			expect(String(message)).not.toMatch(BANNED);
		}
	});

	it("the Money section renders nothing in the app", () => {
		const { container } = render(
			<QueryClientProvider client={client}>
				<TeamMoneySection
					team={{
						id: "t1",
						member_rates_enabled: true,
						payouts_enabled: true,
						default_currency: "PHP",
						pay_period_config: null,
					}}
					isOwner
					workspace={WORKSPACE}
					workspaceSlug="acme"
				/>
			</QueryClientProvider>,
		);
		expect(container.innerHTML).toBe("");
	});
});
