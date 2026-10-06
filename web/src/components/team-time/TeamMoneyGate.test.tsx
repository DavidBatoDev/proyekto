/* @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TeamMoneyAccess } from "@/components/team-time/useTeamMoneyAccess";

const mocks = vi.hoisted(() => ({
	native: false,
	access: null as unknown as TeamMoneyAccess,
}));

vi.mock("@/lib/platform", () => ({ isNativeApp: () => mocks.native }));
vi.mock("@/components/team-time/useTeamMoneyAccess", () => ({
	useTeamMoneyAccess: () => mocks.access,
}));

import {
	TEAM_MONEY_GATE_COPY,
	TEAM_MONEY_GATE_NATIVE_COPY,
	TeamMoneyGate,
} from "./TeamMoneyGate";

function access(overrides: Partial<TeamMoneyAccess> = {}): TeamMoneyAccess {
	return {
		isLoading: false,
		error: null,
		team: undefined,
		isApprover: true,
		isTeamMember: true,
		timeTrackingEnabled: true,
		hasRates: true,
		canPay: true,
		planWorkspaceId: "ws-1",
		planWorkspace: null,
		isComplimentary: false,
		planStatus: "ready",
		payoutsPlanLimit: null,
		teamRulesPlanLimit: null,
		...overrides,
	};
}

function renderGate(need: "approver" | "rates" | "payouts") {
	return render(
		<TeamMoneyGate
			teamId="team-1"
			need={need}
			settingsLink={
				<a href="/teams/team-1/settings/time">Open time settings</a>
			}
		>
			<p>money panel</p>
		</TeamMoneyGate>,
	);
}

afterEach(() => {
	cleanup();
	mocks.native = false;
});

describe("TeamMoneyGate", () => {
	it("renders the panel for a manager when the switch is on", () => {
		mocks.access = access();
		renderGate("payouts");
		expect(screen.getByText("money panel")).toBeTruthy();
	});

	it("names the switch that's off, with the settings link", () => {
		mocks.access = access({ canPay: false });
		renderGate("payouts");
		expect(screen.getByText(TEAM_MONEY_GATE_COPY.payouts.title)).toBeTruthy();
		expect(screen.getByText("Open time settings")).toBeTruthy();
		expect(screen.queryByText("money panel")).toBeNull();

		cleanup();
		mocks.access = access({ hasRates: false });
		renderGate("rates");
		expect(screen.getByText(TEAM_MONEY_GATE_COPY.rates.title)).toBeTruthy();
	});

	it("tells a non-manager they have no access, with no settings link", () => {
		mocks.access = access({ isApprover: false });
		renderGate("rates");
		expect(screen.getByText(TEAM_MONEY_GATE_COPY.access.title)).toBeTruthy();
		expect(screen.queryByText("Open time settings")).toBeNull();
	});

	it("never gates on the plan (history and rates stay reachable)", () => {
		mocks.access = access({
			payoutsPlanLimit: {
				limitKey: "time_payouts",
				kind: "feature",
				label: "Payouts",
				limit: null,
				used: null,
				plan: "pro",
				upgradePlan: "business",
				workspaceId: "ws-1",
				workspaceSlug: null,
				context: "enable",
				message: "",
			},
		});
		renderGate("payouts");
		expect(screen.getByText("money panel")).toBeTruthy();
	});

	it("uses no stale per-log wording", () => {
		for (const copy of Object.values(TEAM_MONEY_GATE_COPY)) {
			expect(`${copy.title} ${copy.body}`).not.toMatch(
				/\blogs?\b|cut-off periods/i,
			);
		}
	});

	it("in the app, keeps rates and payouts on the web", () => {
		mocks.native = true;
		mocks.access = access();
		renderGate("payouts");
		expect(
			screen.getByText("Open Proyekto on the web to see this."),
		).toBeTruthy();
		expect(screen.queryByText("money panel")).toBeNull();
	});

	it("in the app, lets the team report through and words its blocks without money", () => {
		mocks.native = true;
		mocks.access = access();
		renderGate("approver");
		expect(screen.getByText("money panel")).toBeTruthy();

		cleanup();
		mocks.access = access({ isApprover: false });
		renderGate("approver");
		expect(
			screen.getByText(TEAM_MONEY_GATE_NATIVE_COPY.access.title),
		).toBeTruthy();
		const text = document.body.textContent ?? "";
		expect(text).not.toMatch(/\b(contract|rate|payout|invoice)s?\b/i);
	});
});
